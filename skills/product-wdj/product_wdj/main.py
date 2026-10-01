from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Sequence

from .api_client import TaobaoWdjClient
from .config import (
    DEFAULT_PAGE_SIZE,
    EXIT_API_ERROR,
    EXIT_COOKIE_INVALID,
    EXIT_PARAM_ERROR,
    EXIT_SUCCESS,
    TAOBAO_PLATFORM,
    TIME_BUDGET_SECONDS,
    artifacts_dir,
    print_output_files,
)
from .csv_exporter import export_csv
from .fetch_options import merge_fetch_options
from .insights import enrich_result_insights, insights_requirement_message
from .io import emit_json, emit_results, write_result_json
from .parser import (
    _safe_int,
    api_user_id_from_binding,
    extract_item_id,
    load_jsonp_file,
    parse_answer_detail_payload,
    parse_question_list_payload,
)
from .report_generator import generate_wdj_report
from .types import AnswerRecord, QuestionRecord, SkillError, SkillOutput

logger = logging.getLogger(__name__)


def sanitize_filename(value: str) -> str:
    value = re.sub(r"[\\\\/:*?\"<>|]+", "_", value.strip())
    value = re.sub(r"\s+", "_", value)
    return value or "product_wdj"


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="淘宝问大家获取 — 导出问答 CSV/JSON/HTML",
        prog="product_wdj",
    )
    parser.add_argument("item", nargs="?", default="", help="商品 ID 或商品链接")
    parser.add_argument("--item_id", default="", help="商品 ID")
    parser.add_argument("--page_size", type=int, default=DEFAULT_PAGE_SIZE, help="每页问题数")
    parser.add_argument(
        "--max_pages",
        type=int,
        default=None,
        help="最多获取页数（默认 5；与 --all_pages 互斥）",
    )
    parser.add_argument(
        "--all_pages",
        action="store_true",
        help="获取全部问题（仅当用户明确要求全部数据时使用）",
    )
    parser.add_argument("--tag_id", default="", help="标签筛选 propertyId")
    parser.add_argument("--search_text", default="", help="问题搜索关键词")
    parser.add_argument(
        "--skip_answers",
        action="store_true",
        help="仅获取问题列表，不拉取回答详情",
    )
    parser.add_argument(
        "--intent",
        default="",
        help="自然语言补充：如「获取3页」「获取全部问大家」",
    )
    parser.add_argument(
        "--from-json",
        dest="from_json",
        default="",
        help="从本地 JSONP/JSON 文件解析问大家列表（调试用）",
    )
    parser.add_argument(
        "--from-detail-json",
        dest="from_detail_json",
        default="",
        help="从本地 JSONP/JSON 解析回答详情（与 --from-json 联调）",
    )
    return parser.parse_args(list(argv))


def parse_report_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="从获取 JSON 重新生成含分析结论的 HTML 报告",
        prog="product_wdj report",
    )
    parser.add_argument("--input", required=True, help="collect 输出的 JSON 文件")
    parser.add_argument("--output", default="", help="HTML 输出路径（默认覆盖原 report_path）")
    return parser.parse_args(list(argv))


def ensure_binding_context() -> tuple[dict, str]:
    from ._runtime import BindingContextError, fetch_binding_context

    try:
        ctx = fetch_binding_context(platform=TAOBAO_PLATFORM)
    except BindingContextError as exc:
        raise SkillError(EXIT_COOKIE_INVALID, exc.message) from exc
    source = f"gateway:{ctx.get('source', 'dsagent')}"
    return ctx, source


def _fetch_parsed_page(
    client: TaobaoWdjClient,
    *,
    item_id: str,
    user_id: int | str,
    page: int,
    page_size: int,
    tag_id: str,
    search_text: str,
    start_index: int,
) -> tuple[list[QuestionRecord], bool, int, dict[str, Any]]:
    payload = client.fetch_question_page(
        item_id=item_id,
        user_id=user_id,
        page=page,
        page_size=page_size,
        tag_id=tag_id,
        search_text=search_text,
    )
    return parse_question_list_payload(
        payload,
        item_id=item_id,
        start_index=start_index,
    )


def _hydrate_answers(
    client: TaobaoWdjClient,
    questions: list[QuestionRecord],
    *,
    user_id: int | str,
    deadline: float | None = None,
) -> tuple[int, int]:
    """逐题拉取回答详情，返回 (已拉取问题数, 因时间预算跳过的问题数)。

    宿主对技能有 300 秒总超时（skill-service.ts），超时 SIGKILL 且零输出。
    回答详情按问题串行请求 + 每请求 4~6 秒节流，默认 5 页约 50 条问题必然破 300 秒，
    因此这里必须自管 deadline：超预算即停止拉取并在结果里标记截断，让用户拿到
    已获取的部分数据，而不是被宿主硬杀成「0 条数据」。
    """
    total = len(questions)
    fetched = 0
    skipped = 0
    for index, question in enumerate(questions, start=1):
        if deadline is not None and time.monotonic() >= deadline:
            skipped = total - index + 1
            logger.info(
                "[回答详情] 时间预算已用尽，跳过剩余 %d 条问题的回答（已拉取 %d 条）",
                skipped,
                fetched,
            )
            break

        # 心跳必须逐条输出：拉回答详情按问题逐个请求，配合 4~6 秒节流，
        # 50 条问题可静默数分钟，宿主 60 秒 idle 看门狗会误判为卡死并 kill。
        logger.info("[回答详情] %d/%d question_id=%s", index, total, question.question_id)

        if _safe_int(question.answer_count) <= 0:
            question.answers = []
            continue

        first_answer_id = ""
        if question.answers:
            first_answer_id = question.answers[0].answer_id
        if not first_answer_id:
            question.answers = []
            continue

        answer_dicts = client.fetch_all_answers(
            question_id=question.question_id,
            user_id=user_id,
            first_answer_id=first_answer_id,
            deadline=deadline,
        )
        question.answers = [AnswerRecord(**item) for item in answer_dicts]
        fetched += 1

    return fetched, skipped


def collect_wdj(
    item_id: str,
    *,
    binding_source: str,
    page_size: int,
    max_pages: int,
    fetch_all: bool = False,
    tag_id: str = "",
    search_text: str = "",
    fetch_answers: bool = True,
    from_json: str = "",
    from_detail_json: str = "",
    binding: dict[str, Any] | None = None,
    deadline: float | None = None,
) -> SkillOutput:
    questions: list[QuestionRecord] = []
    total_count = 0
    collected_pages = 0
    answers_fetched = 0
    answers_skipped = 0
    summary: dict[str, Any] = {}
    tag_id = str(tag_id or "").strip()

    if from_json:
        payload = load_jsonp_file(Path(from_json))
        page_questions, _, total_count, summary = parse_question_list_payload(
            payload,
            item_id=item_id,
            start_index=1,
        )
        questions.extend(page_questions)
        collected_pages = 1
        if from_detail_json and fetch_answers:
            detail_payload = load_jsonp_file(Path(from_detail_json))
            detail_data = detail_payload.get("data") or {}
            question_id = str(detail_data.get("id") or "")
            detail_answers, _, _ = parse_answer_detail_payload(
                detail_payload,
                question_id=question_id,
            )
            for question in questions:
                if question.question_id == question_id:
                    question.answers = detail_answers
                    break
    else:
        if not binding:
            raise SkillError(EXIT_COOKIE_INVALID, "缺少淘宝绑定上下文")
        try:
            user_id = api_user_id_from_binding(binding)
        except ValueError as exc:
            raise SkillError(EXIT_COOKIE_INVALID, str(exc)) from exc

        client = TaobaoWdjClient()
        page = 1
        while page <= max_pages:
            if deadline is not None and time.monotonic() >= deadline:
                logger.info(
                    "[问大家列表] 时间预算已用尽，停止翻页（已获取 %d 页）",
                    collected_pages,
                )
                break
            logger.info("[问大家列表] 第 %d/%d 页 item_id=%s", page, max_pages, item_id)
            page_questions, has_next, current_total, page_summary = _fetch_parsed_page(
                client,
                item_id=item_id,
                user_id=user_id,
                page=page,
                page_size=page_size,
                tag_id=tag_id,
                search_text=search_text,
                start_index=len(questions) + 1,
            )
            if page == 1:
                summary = page_summary
            if current_total:
                total_count = current_total
            if not page_questions:
                break
            questions.extend(page_questions)
            collected_pages += 1
            if not has_next:
                break
            page += 1

        if fetch_answers:
            answers_fetched, answers_skipped = _hydrate_answers(
                client,
                questions,
                user_id=user_id,
                deadline=deadline,
            )

    output_dir = artifacts_dir()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_name = f"问大家_{sanitize_filename(item_id)}_{timestamp}.csv"
    csv_path = export_csv(questions, output_dir / csv_name)

    result = SkillOutput(
        status="success",
        item_id=item_id,
        binding_source=binding_source,
        total_count=total_count,
        collected_count=len(questions),
        collected_pages=collected_pages,
        fetch_all=fetch_all,
        max_pages_limit=max_pages,
        fetch_answers=fetch_answers,
        answers_fetched=answers_fetched,
        answers_skipped=answers_skipped,
        answers_truncated=answers_skipped > 0,
        tag_id=tag_id,
        search_text=search_text,
        summary=summary,
        questions=[question.to_dict() for question in questions],
        csv_path=csv_path,
        stage="collect",
    )

    enrich_result_insights(result, require=False)

    report_name = f"问大家报告_{sanitize_filename(item_id)}_{timestamp}.html"
    result.report_path = generate_wdj_report(result, output_dir / report_name)

    json_name = f"问大家_{sanitize_filename(item_id)}_{timestamp}.json"
    result.json_path = write_result_json(result, output_dir / json_name)

    if binding:
        from .storage import WdjStorage

        with WdjStorage(shop_key=str(binding.get("shop_key") or "")) as store:
            store.save_run(run_id=timestamp, result=result)
            store.upsert_questions(item_id=item_id, questions=result.questions)
            store.upsert_answers(item_id=item_id, questions=result.questions)

    return result


def load_result_json(path: str) -> SkillOutput:
    json_path = Path(path)
    if not json_path.is_file():
        raise SkillError(EXIT_PARAM_ERROR, f"找不到输入文件: {json_path}")
    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SkillError(EXIT_PARAM_ERROR, f"JSON 解析失败: {exc}") from exc
    if not isinstance(data, dict):
        raise SkillError(EXIT_PARAM_ERROR, "输入 JSON 必须是对象")
    if not data.get("questions"):
        raise SkillError(EXIT_API_ERROR, "输入 JSON 不含问大家数据")
    return SkillOutput.from_dict(data)


def resolve_report_path(result: SkillOutput, output: str) -> Path:
    if output:
        return Path(output)
    if result.report_path:
        return Path(result.report_path)
    item_id = sanitize_filename(result.item_id or "unknown")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return artifacts_dir() / f"问大家报告_{item_id}_{timestamp}.html"


def run_report(argv: Sequence[str]) -> int:
    args = parse_report_args(argv)
    try:
        result = load_result_json(args.input)
        err = enrich_result_insights(result, require=True)
        if err:
            msg = insights_requirement_message(result) or err
            emit_json({
                "status": "error",
                "error_code": EXIT_PARAM_ERROR,
                "error_message": msg,
                **{k: v for k, v in result.to_dict().items() if k != "insights_review"},
            })
            return EXIT_PARAM_ERROR

        report_path = resolve_report_path(result, args.output)
        result.report_path = generate_wdj_report(result, report_path)
        result.stage = "report"
        result.status = "success"

        emit_json(result.to_dict())
        print_output_files(HTML=result.report_path)
        return EXIT_SUCCESS
    except SkillError as exc:
        emit_json({
            "status": "error",
            "error_code": exc.exit_code,
            "error_message": str(exc),
        })
        return exc.exit_code


def run(argv: Sequence[str]) -> int:
    args = parse_args(argv)

    item_id = extract_item_id(args.item_id or args.item or "")
    if not item_id and args.from_json:
        item_id = "unknown"

    if not item_id:
        emit_json({
            "status": "error",
            "error_code": EXIT_PARAM_ERROR,
            "error_message": "请提供商品 ID 或商品链接",
        })
        return EXIT_PARAM_ERROR

    try:
        # 自管时间预算：必须早于任何网络请求开始计时，确保在宿主 300 秒硬超时前收尾。
        deadline = time.monotonic() + TIME_BUDGET_SECONDS
        binding: dict[str, Any] | None = None
        binding_source = "local-json" if args.from_json else ""
        fetch_opts = merge_fetch_options(
            intent=args.intent,
            max_pages=args.max_pages,
            fetch_all=args.all_pages,
            tag_id=args.tag_id,
            search_text=args.search_text,
            fetch_answers=False if args.skip_answers else None,
        )

        if not args.from_json:
            binding, binding_source = ensure_binding_context()

        result = collect_wdj(
            item_id,
            binding_source=binding_source,
            page_size=args.page_size,
            max_pages=fetch_opts.max_pages,
            fetch_all=fetch_opts.fetch_all,
            tag_id=fetch_opts.tag_id,
            search_text=fetch_opts.search_text,
            fetch_answers=fetch_opts.fetch_answers,
            from_json=args.from_json,
            from_detail_json=args.from_detail_json,
            binding=binding,
            deadline=deadline,
        )

        emit_results([result])
        print_output_files(
            JSON=result.json_path,
            CSV=result.csv_path,
            HTML=result.report_path,
        )
        return EXIT_SUCCESS
    except SkillError as exc:
        emit_json({
            "status": "error",
            "error_code": exc.exit_code,
            "error_message": str(exc),
        })
        return exc.exit_code


def main(argv: Sequence[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="[%(levelname)s] %(message)s",
        stream=sys.stderr,
    )
    args = list(argv if argv is not None else sys.argv[1:])
    if args and args[0] == "report":
        if len(args) == 1:
            print(
                "用法: python -m product_wdj report --input <json> [--output <html>]",
                file=sys.stderr,
            )
            return EXIT_SUCCESS
        return run_report(args[1:])
    if not args:
        print(
            "用法:\n"
            "  python -m product_wdj 762128994852\n"
            "  python -m product_wdj \"https://detail.tmall.com/item.htm?id=762128994852\"\n"
            "  python -m product_wdj 762128994852 --max_pages 3\n"
            "  python -m product_wdj 762128994852 --all_pages\n"
            "  python -m product_wdj 762128994852 --tag_id 100003264\n"
            "  python -m product_wdj 762128994852 --skip_answers\n"
            "  python -m product_wdj --from-json ../问大家.js --item_id 762128994852\n"
            "  python -m product_wdj report --input artifacts/问大家_xxx.json",
            file=sys.stderr,
        )
        return EXIT_SUCCESS
    return run(args)
