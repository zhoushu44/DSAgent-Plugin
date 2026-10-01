"""CLI 编排：整体分析 + 流量分析 + 一键 analyze。"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

from .._runtime import BindingContextError
from ..cli_utils import (
    default_report_file,
    emit_json,
    parse_audience_actions,
    parse_audience_days,
    parse_competitor_ids,
    parse_date,
)
from ..config import (
    COMPETITION_TYPE_PRODUCT,
    EXIT_API_ERROR,
    EXIT_COOKIE_INVALID,
    EXIT_PARAM_ERROR,
    EXIT_RATE_LIMIT,
    EXIT_SUCCESS,
    print_output_files,
)
from .._api_client import (
    DmpCompetitionClient,
    DmpError,
    DmpRateLimitError,
    get_dmp_client,
)
from ..fetch import (
    fetch_audience,
    fetch_flow,
    fetch_overall,
)
from ..insights import (
    apply_insights_to_result,
    enrich_module_meta,
    insights_requirement_message,
    insights_required_modules,
)
from ..parse import (
    build_audience_result,
    build_flow_result,
    build_overall_result,
    build_result,
    has_audience_data,
    has_competitor_metrics,
    has_flow_metrics,
    has_overall_metrics,
)
from ..report import generate_competitor_report
from ..storage import CompetitorStorage


class SkillArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        self.print_usage(sys.stderr)
        print(f"{self.prog}: error: {message}", file=sys.stderr)
        sys.exit(EXIT_PARAM_ERROR)


def _add_query_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--competitor-ids", required=True, help="竞品商品 ID，多个用逗号分隔")
    parser.add_argument(
        "--entity-id",
        type=int,
        required=True,
        help="达摩盘 API 对比基准商品 ID（仅用于请求，报告只展示竞品）",
    )
    parser.add_argument("--begin-date", required=True, help="分析周期开始 YYYY-MM-DD")
    parser.add_argument("--end-date", required=True, help="分析周期结束 YYYY-MM-DD")
    parser.add_argument("--peer-begin-date", required=True, help="对比周期开始 YYYY-MM-DD")
    parser.add_argument("--peer-end-date", required=True, help="对比周期结束 YYYY-MM-DD")
    parser.add_argument(
        "--competition-type",
        default=COMPETITION_TYPE_PRODUCT,
        help="竞争类型，默认 2=商品",
    )


def _add_audience_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--audience-action",
        default="",
        help="人群行为，默认搜索+购买。支持：浏览/搜索/收藏/加购/购买 或 1~5，多项用逗号分隔",
    )
    parser.add_argument(
        "--audience-days",
        default="",
        help="人群时间窗，默认30。支持：7/15/30/90 或 最近30天",
    )


def parse_args() -> argparse.Namespace:
    parser = SkillArgumentParser(
        description="达摩盘竞品商品核心指标对比",
        prog="competitor_indicator",
    )
    sub = parser.add_subparsers(dest="command")

    for name, help_text in (
        ("analyze", "一键：拉取竞品数据 + AI 分析 → HTML 报告"),
        ("overall", "整体分析（shop + base）"),
        ("flow", "流量分析（flow 渠道树）"),
        ("audience", "人群画像（insight tag/chart）"),
    ):
        cmd = sub.add_parser(name, help=help_text)
        _add_query_args(cmd)
        if name in ("analyze", "audience"):
            _add_audience_args(cmd)

    p_report = sub.add_parser("report", help="从 JSON 生成 HTML 报告")
    p_report.add_argument("--input", required=True, help="analyze 输出的 JSON 文件")
    p_report.add_argument("--output", default="", help="HTML 输出路径")

    p_hist = sub.add_parser("history", help="查看本地已抓取的竞品分析")
    p_hist.add_argument("--competitor-id", default="", help="竞品 ID 模糊筛选")
    p_hist.add_argument("--limit", type=int, default=50)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(EXIT_PARAM_ERROR)
    return args


def _err(code: int, message: str, **extra) -> int:
    emit_json({"status": "error", "error_code": code, "error_message": message, **extra})
    return code


def _validate_dates(args: argparse.Namespace) -> None:
    parse_date(args.begin_date, "begin-date")
    parse_date(args.end_date, "end-date")
    parse_date(args.peer_begin_date, "peer-begin-date")
    parse_date(args.peer_end_date, "peer-end-date")
    if args.begin_date > args.end_date:
        raise ValueError("begin-date 不能晚于 end-date")
    if args.peer_begin_date > args.peer_end_date:
        raise ValueError("peer-begin-date 不能晚于 peer-end-date")


def _parse_query_args(
    args: argparse.Namespace,
    *,
    with_audience: bool = False,
) -> tuple[list[int], dict[str, Any]]:
    competitor_ids = parse_competitor_ids(args.competitor_ids)
    _validate_dates(args)
    query: dict[str, Any] = {
        "competitor_ids": competitor_ids,
        "entity_id": args.entity_id,
        "begin_date": args.begin_date,
        "end_date": args.end_date,
        "peer_begin_date": args.peer_begin_date,
        "peer_end_date": args.peer_end_date,
        "competition_type": args.competition_type,
    }
    if with_audience:
        query["audience_action_values"] = parse_audience_actions(args.audience_action or None)
        query["audience_time_range"] = parse_audience_days(args.audience_days or None)
    return competitor_ids, query


def _query_kwargs(query: dict[str, Any]) -> dict[str, Any]:
    return {
        "competitor_ids": query["competitor_ids"],
        "entity_id": query["entity_id"],
        "begin_date": query["begin_date"],
        "end_date": query["end_date"],
        "peer_begin_date": query["peer_begin_date"],
        "peer_end_date": query["peer_end_date"],
    }


def _success_payload(parsed: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {"status": "success", "error_code": EXIT_SUCCESS, **parsed, **extra, **enrich_module_meta(parsed)}


def _persist(parsed: dict[str, Any], query: dict[str, Any], report_path: str, shop_key: str) -> None:
    try:
        with CompetitorStorage(shop_key=shop_key) as store:
            for cid in parsed["competitor_ids"]:
                store.upsert_analysis(
                    competitor_id=cid,
                    entity_id=str(query["entity_id"]),
                    begin_date=query["begin_date"],
                    end_date=query["end_date"],
                    peer_begin_date=query["peer_begin_date"],
                    peer_end_date=query["peer_end_date"],
                    competition_type=query["competition_type"],
                    metrics=parsed["competitors"].get(cid, {}),
                    report_path=report_path,
                )
    except Exception as exc:
        logging.getLogger(__name__).warning("入库失败（不影响主流程）: %s", exc)


def _load_parsed_json(path: str) -> tuple[dict[str, Any], int | None]:
    json_path = Path(path)
    if not json_path.is_file():
        return {}, _err(EXIT_PARAM_ERROR, f"找不到输入文件: {json_path}")
    try:
        return json.loads(json_path.read_text(encoding="utf-8")), None
    except json.JSONDecodeError as exc:
        return {}, _err(EXIT_PARAM_ERROR, f"JSON 解析失败: {exc}")


def _resolve_report_path(parsed: dict[str, Any], output: str) -> Path:
    if output:
        return Path(output)
    competitor_ids = parsed.get("competitor_ids") or []
    cid = str(competitor_ids[0]) if competitor_ids else "report"
    return default_report_file(cid)


def _insights_required(parsed: dict[str, Any]) -> list[str]:
    return insights_required_modules(enrich_module_meta(parsed)["data_modules"])


def _finalize_report(
    parsed: dict[str, Any],
    *,
    output: str = "",
) -> tuple[Path | None, int | None]:
    required = _insights_required(parsed)
    if required:
        msg = insights_requirement_message(parsed)
        if msg:
            return None, _err(EXIT_PARAM_ERROR, msg, **parsed, **enrich_module_meta(parsed))

    if required:
        err_msg = apply_insights_to_result(parsed, required_modules=required)
        if err_msg:
            return None, _err(EXIT_PARAM_ERROR, err_msg, **parsed, **enrich_module_meta(parsed))

    report_path = _resolve_report_path(parsed, output)
    generate_competitor_report(parsed, report_path)
    return report_path, None


def cmd_overall(args: argparse.Namespace, client: DmpCompetitionClient) -> int:
    try:
        _, query = _parse_query_args(args)
    except ValueError as exc:
        return _err(EXIT_PARAM_ERROR, str(exc))

    raw = fetch_overall(client, query)
    parsed = build_overall_result(
        **_query_kwargs(query),
        shop_data=raw["shop_data"],
        base_data=raw["base_data"],
    )
    if not has_overall_metrics(parsed):
        return _err(EXIT_API_ERROR, "未解析到整体指标数据")

    emit_json(_success_payload(parsed))
    return EXIT_SUCCESS


def cmd_flow(args: argparse.Namespace, client: DmpCompetitionClient) -> int:
    try:
        _, query = _parse_query_args(args)
    except ValueError as exc:
        return _err(EXIT_PARAM_ERROR, str(exc))

    raw = fetch_flow(client, query)
    parsed = build_flow_result(**_query_kwargs(query), flow_data=raw["flow_data"])
    if not has_flow_metrics(parsed):
        return _err(EXIT_API_ERROR, "未解析到流量指标数据")

    emit_json(_success_payload(parsed))
    return EXIT_SUCCESS


def cmd_audience(args: argparse.Namespace, client: DmpCompetitionClient) -> int:
    try:
        _, query = _parse_query_args(args, with_audience=True)
    except ValueError as exc:
        return _err(EXIT_PARAM_ERROR, str(exc))

    raw = fetch_audience(
        client,
        competitor_ids=query["competitor_ids"],
        action_values=query.get("audience_action_values"),
        time_range=query.get("audience_time_range"),
    )
    parsed = build_audience_result(
        **_query_kwargs(query),
        audience_raw=raw["audience_raw"],
        action_values=query.get("audience_action_values"),
        time_range=query.get("audience_time_range"),
    )
    if not has_audience_data(parsed):
        return _err(EXIT_API_ERROR, "未解析到人群画像数据")

    emit_json(_success_payload(parsed))
    return EXIT_SUCCESS


def cmd_analyze(args: argparse.Namespace, client: DmpCompetitionClient, shop_key: str) -> int:
    try:
        competitor_ids, query = _parse_query_args(args, with_audience=True)
    except ValueError as exc:
        return _err(EXIT_PARAM_ERROR, str(exc))

    overall_raw = fetch_overall(client, query)
    flow_raw = fetch_flow(client, query)
    audience_raw = fetch_audience(
        client,
        competitor_ids=query["competitor_ids"],
        action_values=query.get("audience_action_values"),
        time_range=query.get("audience_time_range"),
    )
    raw = {**overall_raw, **flow_raw, **audience_raw}
    parsed = build_result(**_query_kwargs(query), raw_response=raw)

    if not has_competitor_metrics(parsed):
        return _err(
            EXIT_API_ERROR,
            "未解析到竞品指标数据，请检查商品 ID 与日期范围",
            raw_keys={
                "shop": list(raw["shop_data"].keys()),
                "base": list(raw["base_data"].keys()),
                "flow": list(raw["flow_data"].keys()),
            },
        )

    report_path, err = _finalize_report(parsed)
    if err is not None:
        return err

    assert report_path is not None
    _persist(parsed, query, str(report_path), shop_key)
    emit_json(_success_payload(parsed, stage="analyze", report_path=str(report_path)))
    print_output_files(HTML=str(report_path))
    return EXIT_SUCCESS


def cmd_report(args: argparse.Namespace) -> int:
    parsed, err = _load_parsed_json(args.input)
    if err is not None:
        return err

    if not has_competitor_metrics(parsed):
        return _err(EXIT_API_ERROR, "输入 JSON 不含竞品指标数据")

    report_path, err = _finalize_report(parsed, output=args.output)
    if err is not None:
        return err

    assert report_path is not None
    emit_json(_success_payload(parsed, stage="report", report_path=str(report_path)))
    print_output_files(HTML=str(report_path))
    return EXIT_SUCCESS


def cmd_history(args: argparse.Namespace, shop_key: str) -> int:
    with CompetitorStorage(shop_key=shop_key) as store:
        rows = store.query_history(args.competitor_id, limit=args.limit)
    emit_json({"status": "success", "records": rows, "error_code": EXIT_SUCCESS})
    return EXIT_SUCCESS


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="[%(levelname)s] %(message)s",
        stream=sys.stderr,
    )
    args = parse_args()
    try:
        if args.command == "report":
            return cmd_report(args)

        client, shop_key = get_dmp_client()
        handlers = {
            "overall": lambda a: cmd_overall(a, client),
            "flow": lambda a: cmd_flow(a, client),
            "audience": lambda a: cmd_audience(a, client),
            "analyze": lambda a: cmd_analyze(a, client, shop_key),
            "history": lambda a: cmd_history(a, shop_key),
        }
        return handlers[args.command](args)
    except BindingContextError as exc:
        return _err(EXIT_COOKIE_INVALID, str(exc))
    except DmpRateLimitError as exc:
        return _err(EXIT_RATE_LIMIT, str(exc), details=getattr(exc, 'details', None))
    except DmpError as exc:
        return _err(EXIT_API_ERROR, str(exc), details=getattr(exc, 'details', None))
