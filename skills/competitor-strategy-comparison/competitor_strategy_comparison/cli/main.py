"""CLI 编排：原子取数、组合分析、报告重建与历史查询。"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .._api_client import DmpStrategyClient, get_strategy_client
from ..cli_utils import (
    default_report_file,
    emit_json,
    item_id,
    validate_period,
)
from ..config import EXIT_API_ERROR, EXIT_PARAM_ERROR, EXIT_SUCCESS, print_output_files
from ..fetch import fetch_audience, fetch_flow, fetch_scope
from ..fetch.overall import fetch_key_metrics
from ..insights import (
    data_modules,
    enrich_module_meta,
    insights_requirement_message,
    insights_required_modules,
    load_insights_into_result,
    validate_result,
)
from ..parse import build_result
from ..report import generate_strategy_report, write_business_report
from ..storage import AnalysisStorage


class SkillArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        self.print_usage(sys.stderr)
        emit_json({"status": "error", "error_code": EXIT_PARAM_ERROR, "message": message})
        raise SystemExit(EXIT_PARAM_ERROR)


def _add_query_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--item-id", required=True, help="本店商品 ID")
    parser.add_argument("--competitor-id", required=True, help="同叶子类目竞品 ID")
    parser.add_argument("--start-date", required=True, help="开始日期 YYYY-MM-DD")
    parser.add_argument("--end-date", required=True, help="结束日期 YYYY-MM-DD")


def parse_args() -> argparse.Namespace:
    parser = SkillArgumentParser(
        description="DMP 竞品策略对比",
        prog="competitor_strategy_comparison",
    )
    sub = parser.add_subparsers(dest="command")

    products = sub.add_parser("list-products", help="列出本店可分析商品")
    products.add_argument("--page", type=int, default=1)
    products.add_argument("--page-size", type=int, default=10)
    products.add_argument("--keyword", default="")

    for name, help_text in (
        ("overall", "核心经营指标"),
        ("flow", "推广渠道、计划与关键词"),
        ("audience", "人群经营对比"),
        ("analyze", "组合完整竞品策略分析"),
    ):
        command = sub.add_parser(name, help=help_text)
        _add_query_args(command)

    report = sub.add_parser("report", help="从内部 JSON 生成 HTML 报告")
    report.add_argument("--input", required=True)
    report.add_argument("--output", default="")

    history = sub.add_parser("history", help="查看已生成的分析产物")
    history.add_argument("--competitor-id", default="")
    history.add_argument("--limit", type=int, default=50)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        raise SystemExit(EXIT_PARAM_ERROR)
    return args


def _query(args: argparse.Namespace) -> dict[str, str]:
    start, end = validate_period(args.start_date, args.end_date)
    return {
        "own_id": item_id(args.item_id, "本店商品 ID"),
        "competitor_id": item_id(args.competitor_id, "竞品 ID"),
        "start": start,
        "end": end,
    }


def _scope(client: DmpStrategyClient, query: dict[str, str]) -> dict[str, Any]:
    return fetch_scope(
        client,
        own_id=query["own_id"],
        competitor_id=query["competitor_id"],
    )


def _single_module(
    *,
    stage: str,
    client: DmpStrategyClient,
    shop_key: str,
    query: dict[str, str],
    loader: Callable[[DmpStrategyClient, dict[str, str]], Any],
    key: str,
) -> dict[str, Any]:
    scope = _scope(client, query)
    value = loader(client, query)
    result = build_result(
        shop_key=shop_key,
        query=query,
        scope=scope,
        modules={key: value},
        errors={},
    )
    return {
        "status": "success",
        "error_code": EXIT_SUCCESS,
        "stage": stage,
        "data_modules": data_modules(result),
        **result,
    }


def _resolve_report_path(result: dict[str, Any], output: str) -> Path:
    if output:
        return Path(output)
    own_id = result["own_item"]["item_id"]
    competitor_id = result["competitor_item"]["item_id"]
    return default_report_file(own_id, competitor_id)


def _finalize_report(
    result: dict[str, Any],
    *,
    output: str = "",
    markdown_path: Path | None = None,
) -> tuple[Path, Path]:
    modules = data_modules(result)
    required = insights_required_modules(modules, result)
    if required:
        msg = insights_requirement_message(result)
        if msg:
            raise ValueError(msg)
        err = load_insights_into_result(result, required_modules=required)
        if err:
            raise ValueError(err)

    if markdown_path is None:
        _, markdown_path = AnalysisStorage().artifact_paths(result)
    write_business_report(result, markdown_path)
    html_path = _resolve_report_path(result, output)
    generate_strategy_report(result, html_path)
    return markdown_path, html_path


def analyze(
    client: DmpStrategyClient,
    shop_key: str,
    query: dict[str, str],
) -> dict[str, Any]:
    scope = _scope(client, query)
    modules: dict[str, Any] = {}
    errors: dict[str, str] = {}
    loaders = {
        "key_metrics": lambda: fetch_key_metrics(client, **query),
        "promotion_strategy": lambda: fetch_flow(client, query),
        "audience_comparison": lambda: fetch_audience(client, query),
    }
    for name, loader in loaders.items():
        try:
            modules[name] = loader()
        except Exception as exc:  # noqa: BLE001 - 单模块失败需保留其他成功模块
            errors[name] = str(exc)

    result = build_result(
        shop_key=shop_key,
        query=query,
        scope=scope,
        modules=modules,
        errors=errors,
    )
    issues = validate_result(result)
    artifact_path, _ = AnalysisStorage().artifact_paths(result)
    artifact_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        markdown_path, html_path = _finalize_report(result, markdown_path=artifact_path.with_suffix(".md"))
    except ValueError as exc:
        meta = enrich_module_meta(result)
        return {
            "status": "partial" if not errors else "error",
            "error_code": EXIT_PARAM_ERROR,
            "stage": "analyze",
            "message": str(exc),
            "artifact_path": str(artifact_path),
            "shop_key": shop_key,
            "own_item_id": query["own_id"],
            "competitor_id": query["competitor_id"],
            "period": result["period"],
            "available_modules": data_modules(result),
            "module_errors": errors,
            "validation_issues": issues,
            **meta,
        }
    return {
        "status": "success" if not errors else "partial",
        "error_code": EXIT_SUCCESS,
        "stage": "analyze",
        "artifact_path": str(artifact_path),
        "report_path": str(markdown_path),
        "html_path": str(html_path),
        "shop_key": shop_key,
        "own_item_id": query["own_id"],
        "competitor_id": query["competitor_id"],
        "period": result["period"],
        "available_modules": data_modules(result),
        "module_errors": errors,
        "validation_issues": issues,
        **enrich_module_meta(result),
    }


def cmd_report(args: argparse.Namespace) -> dict[str, Any]:
    input_path = Path(args.input)
    if not input_path.is_file():
        raise ValueError(f"找不到输入文件: {input_path}")
    result = json.loads(input_path.read_text(encoding="utf-8"))
    markdown_path, html_path = _finalize_report(result, output=args.output, markdown_path=input_path.with_suffix(".md"))
    payload = {
        "status": "success",
        "error_code": EXIT_SUCCESS,
        "stage": "report",
        "artifact_path": str(input_path),
        "report_path": str(markdown_path),
        "html_path": str(html_path),
        **enrich_module_meta(result),
    }
    print_output_files(HTML=str(html_path), Markdown=str(markdown_path))
    return payload


def main() -> int:
    args = parse_args()
    try:
        if args.command == "report":
            emit_json(cmd_report(args))
            return EXIT_SUCCESS
        if args.command == "history":
            emit_json({
                "status": "success",
                "error_code": EXIT_SUCCESS,
                "stage": "history",
                "records": AnalysisStorage().history(args.competitor_id, args.limit),
            })
            return EXIT_SUCCESS

        if args.command == "list-products":
            client, _shop_key = get_strategy_client()
            emit_json({
                "status": "success",
                "error_code": EXIT_SUCCESS,
                "stage": "list-products",
                **client.list_products(args.page, args.page_size, args.keyword),
            })
            return EXIT_SUCCESS

        query = _query(args)
        client, shop_key = get_strategy_client()
        if args.command == "overall":
            payload = _single_module(
                stage="overall",
                client=client,
                shop_key=shop_key,
                query=query,
                loader=lambda c, q: fetch_key_metrics(c, **q),
                key="key_metrics",
            )
        elif args.command == "flow":
            payload = _single_module(
                stage="flow",
                client=client,
                shop_key=shop_key,
                query=query,
                loader=fetch_flow,
                key="promotion_strategy",
            )
        elif args.command == "audience":
            payload = _single_module(
                stage="audience",
                client=client,
                shop_key=shop_key,
                query=query,
                loader=fetch_audience,
                key="audience_comparison",
            )
        else:
            payload = analyze(client, shop_key, query)
        emit_json(payload)
        if payload.get("html_path"):
            print_output_files(HTML=str(payload["html_path"]), Markdown=str(payload.get("report_path", "")))
        return EXIT_SUCCESS
    except (ValueError, json.JSONDecodeError) as exc:
        emit_json({
            "status": "error",
            "error_code": EXIT_PARAM_ERROR,
            "stage": args.command,
            "message": str(exc),
        })
        return EXIT_PARAM_ERROR
    except Exception as exc:  # noqa: BLE001 - CLI 边界统一输出结构化错误
        emit_json({
            "status": "error",
            "error_code": EXIT_API_ERROR,
            "stage": args.command,
            "message": str(exc),
        })
        return EXIT_API_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
