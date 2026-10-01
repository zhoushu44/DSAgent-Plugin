from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Sequence

from .parser import extract_item_id, load_jsonp_file, parse_rate_payload
from .detail_parser import parse_detail_payload
from .config import (
    DEFAULT_PAGE_SIZE,
    EXIT_API_ERROR,
    EXIT_COOKIE_INVALID,
    EXIT_PARAM_ERROR,
    EXIT_SUCCESS,
    TAOBAO_PLATFORM,
    artifacts_dir,
    print_output_files,
)
from .csv_exporter import export_csv
from .fetch_options import DEFAULT_ORDER_TYPE, merge_fetch_options
from .io import emit_json, emit_results, write_result_json
from .insights import enrich_result_insights, insights_requirement_message
from .types import ReviewRecord, SkillError, SkillOutput

logger = logging.getLogger(__name__)


def sanitize_filename(value: str) -> str:
    value = re.sub(r"[\\\\/:*?\"<>|]+", "_", value.strip())
    value = re.sub(r"\s+", "_", value)
    return value or "product_reviews"


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="淘宝商品评价抓取 — 导出评价 CSV",
        prog="product_reviews",
    )
    parser.add_argument(
        "item",
        nargs="?",
        default="",
        help="商品 ID 或商品链接",
    )
    parser.add_argument("--item_id", default="", help="商品 ID（auctionNumId）")
    parser.add_argument("--page_size", type=int, default=DEFAULT_PAGE_SIZE, help="每页条数")
    parser.add_argument(
        "--max_pages",
        type=int,
        default=None,
        help="最多抓取页数（默认 5；与 --all_pages 或 intent 中「全部」互斥）",
    )
    parser.add_argument(
        "--all_pages",
        action="store_true",
        help="获取全部（仅当用户明确要求全部数据时使用）",
    )
    parser.add_argument(
        "--order_type",
        choices=("searchImpr", "feedbackdate"),
        default=None,
        help="排序：searchImpr 综合排序（默认）、feedbackdate 最新时间",
    )
    parser.add_argument(
        "--intent",
        default="",
        help="自然语言补充：如「按时间排序翻3页」「获取全部评价」",
    )
    parser.add_argument(
        "--from-json",
        dest="from_json",
        default="",
        help="从本地 JSONP/JSON 文件解析评价（调试用，跳过评价 API）",
    )
    parser.add_argument(
        "--from-detail-json",
        dest="from_detail_json",
        default="",
        help="从本地 JSONP/JSON 文件解析商品 SKU 详情（调试用）",
    )
    return parser.parse_args(list(argv))


def parse_report_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="从抓取 JSON 重新生成含分析结论的 HTML 报告",
        prog="product_reviews report",
    )
    parser.add_argument("--input", required=True, help="collect 输出的 JSON 文件")
    parser.add_argument("--output", default="", help="HTML 输出路径（默认覆盖原 report_path）")
    return parser.parse_args(list(argv))


def load_sku_catalog(item_id: str, *, from_detail_json: str = "") -> dict[str, Any]:
    if from_detail_json:
        payload = load_jsonp_file(Path(from_detail_json))
    else:
        from .api_client import TaobaoDetailClient

        payload = TaobaoDetailClient().fetch_detail(item_id=item_id)

    catalog = parse_detail_payload(payload)
    if not catalog.get("sku_props"):
        raise SkillError(EXIT_API_ERROR, "商品详情未返回 SKU 规格数据，无法生成筛选面板。")
    return catalog


def ensure_binding_context() -> tuple[dict, str]:
    from ._runtime import BindingContextError, fetch_binding_context

    try:
        ctx = fetch_binding_context(platform=TAOBAO_PLATFORM)
    except BindingContextError as exc:
        raise SkillError(EXIT_COOKIE_INVALID, exc.message) from exc
    source = f"gateway:{ctx.get('source', 'dsagent')}"
    return ctx, source


def collect_reviews(
    item_id: str,
    *,
    binding_source: str,
    page_size: int,
    max_pages: int,
    order_type: str = DEFAULT_ORDER_TYPE,
    fetch_all: bool = False,
    from_json: str = "",
    from_detail_json: str = "",
    shop_key: str = "",
) -> SkillOutput:
    reviews: list[ReviewRecord] = []
    total_count = 0
    collected_pages = 0
    summary: dict[str, Any] = {}

    sku_catalog = load_sku_catalog(item_id, from_detail_json=from_detail_json)

    if from_json:
        payload = load_jsonp_file(Path(from_json))
        page_reviews, _, total_count, summary = parse_rate_payload(
            payload,
            item_id=item_id,
            start_index=1,
        )
        reviews.extend(page_reviews)
        collected_pages = 1
    else:
        from .api_client import TaobaoRateListClient

        client = TaobaoRateListClient()
        page_no = 1
        while page_no <= max_pages:
            payload = client.fetch_page(
                item_id=item_id,
                page_no=page_no,
                page_size=page_size,
                order_type=order_type,
            )
            page_reviews, has_next, current_total, page_summary = parse_rate_payload(
                payload,
                item_id=item_id,
                start_index=len(reviews) + 1,
            )
            if page_no == 1:
                summary = page_summary
            if current_total:
                total_count = current_total
            if not page_reviews:
                break
            reviews.extend(page_reviews)
            collected_pages += 1
            if not has_next:
                break
            page_no += 1

    if sku_catalog.get("item_title"):
        summary = {**summary, "auction_title": sku_catalog["item_title"]}
    summary["sku_catalog"] = sku_catalog

    output_dir = artifacts_dir()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_name = f"商品评价_{sanitize_filename(item_id)}_{timestamp}.csv"
    csv_path = export_csv(reviews, output_dir / csv_name)

    result = SkillOutput(
        status="success",
        item_id=item_id,
        binding_source=binding_source,
        total_count=total_count,
        collected_count=len(reviews),
        collected_pages=collected_pages,
        order_type=order_type,
        fetch_all=fetch_all,
        max_pages_limit=max_pages,
        summary=summary,
        reviews=[review.to_dict() for review in reviews],
        csv_path=csv_path,
        stage="collect",
    )

    enrich_result_insights(result, require=False)

    from .report_generator import generate_reviews_report

    report_name = f"商品评价报告_{sanitize_filename(item_id)}_{timestamp}.html"
    result.report_path = generate_reviews_report(result, output_dir / report_name)

    json_name = f"商品评价_{sanitize_filename(item_id)}_{timestamp}.json"
    result.json_path = write_result_json(result, output_dir / json_name)

    if shop_key:
        from .storage import ReviewStorage

        with ReviewStorage(shop_key=shop_key) as store:
            store.save_run(run_id=timestamp, result=result)
            store.upsert_reviews(item_id=item_id, reviews=result.reviews)

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
    if not data.get("reviews"):
        raise SkillError(EXIT_API_ERROR, "输入 JSON 不含评价数据")
    return SkillOutput.from_dict(data)


def resolve_report_path(result: SkillOutput, output: str) -> Path:
    if output:
        return Path(output)
    if result.report_path:
        return Path(result.report_path)
    item_id = sanitize_filename(result.item_id or "unknown")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return artifacts_dir() / f"商品评价报告_{item_id}_{timestamp}.html"


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

        from .report_generator import generate_reviews_report

        report_path = resolve_report_path(result, args.output)
        result.report_path = generate_reviews_report(result, report_path)
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
        binding: dict[str, Any] | None = None
        shop_key = ""
        local_mode = bool(args.from_json)
        binding_source = "local-json" if local_mode else ""
        fetch_opts = merge_fetch_options(
            intent=args.intent,
            order_type=args.order_type,
            max_pages=args.max_pages,
            fetch_all=args.all_pages,
        )
        if not local_mode:
            binding, src = ensure_binding_context()
            shop_key = str(binding.get("shop_key") or "").strip()
            binding_source = src

        result = collect_reviews(
            item_id,
            binding_source=binding_source,
            page_size=args.page_size,
            max_pages=fetch_opts.max_pages,
            order_type=fetch_opts.order_type,
            fetch_all=fetch_opts.fetch_all,
            from_json=args.from_json,
            from_detail_json=args.from_detail_json,
            shop_key=shop_key,
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
                "用法: python -m product_reviews report --input <json> [--output <html>]",
                file=sys.stderr,
            )
            return EXIT_SUCCESS
        return run_report(args[1:])
    if not args:
        print(
            "用法:\n"
            "  python -m product_reviews 614498626290\n"
            "  python -m product_reviews \"https://detail.tmall.com/item.htm?id=614498626290\"\n"
            "  python -m product_reviews 614498626290 --order_type feedbackdate --max_pages 3\n"
            "  python -m product_reviews 614498626290 --intent \"按时间排序翻10页\"\n"
            "  python -m product_reviews 614498626290 --all_pages\n"
            "  python -m product_reviews --from-json ../1.json --from-detail-json ../2.json --item_id 614498626290\n"
            "  python -m product_reviews report --input artifacts/商品评价_xxx.json",
            file=sys.stderr,
        )
        return EXIT_SUCCESS
    return run(args)
