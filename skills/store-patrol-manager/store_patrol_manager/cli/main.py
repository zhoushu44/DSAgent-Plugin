"""巡店证据冻结、汇总、校验和紧凑摘要 CLI。"""
from __future__ import annotations

import argparse
from pathlib import Path

from ..cli_utils import emit_json, load_json
from ..config import EXIT_PARAM_ERROR, EXIT_SUCCESS, EXIT_VALIDATION_ERROR
from ..insights import build_compact_summary
from ..parse import aggregate, prepare, validate
from .._runtime import require_dsagent_runtime


def _raw_args(args: argparse.Namespace) -> list[str]:
    values = [
        "--shop-name", args.shop_name,
        "--display-start", args.display_start,
        "--display-end", args.display_end,
    ]
    for key in ("shop_raw", "item_raw", "promotion_raw", "refund_raw", "industry_raw"):
        for path in getattr(args, key):
            values += ["--" + key.replace("_", "-"), path]
    if args.category_map:
        values += ["--category-map", args.category_map]
    values += ["--output", args.evidence]
    return values


def _add_raw(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--shop-name", required=True)
    parser.add_argument("--display-start", required=True)
    parser.add_argument("--display-end", required=True)
    for name in ("shop-raw", "item-raw", "promotion-raw", "refund-raw", "industry-raw"):
        parser.add_argument("--" + name, action="append", default=[])
    parser.add_argument("--category-map", default="")
    parser.add_argument("--evidence", default="artifacts/patrol_evidence.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="store_patrol_manager", description="巡店管家确定性事实流水线")
    sub = parser.add_subparsers(dest="command", required=True)
    p_prepare = sub.add_parser("prepare", help="从本次原始 JSON 冻结证据")
    _add_raw(p_prepare)
    p_aggregate = sub.add_parser("aggregate", help="从证据生成事实")
    p_aggregate.add_argument("--evidence", required=True)
    p_aggregate.add_argument("--facts", default="artifacts/patrol_facts.json")
    p_validate = sub.add_parser("validate", help="校验证据和事实")
    p_validate.add_argument("--evidence", required=True)
    p_validate.add_argument("--facts", required=True)
    p_validate.add_argument("--validation", default="artifacts/patrol_validation.json")
    p_analyze = sub.add_parser("analyze", help="一次完成冻结、汇总和校验")
    _add_raw(p_analyze)
    p_analyze.add_argument("--facts", default="artifacts/patrol_facts.json")
    p_analyze.add_argument("--validation", default="artifacts/patrol_validation.json")
    p_summary = sub.add_parser("summary", help="输出供模型读取的紧凑事实目录")
    p_summary.add_argument("--facts", required=True)
    return parser.parse_args()


def main() -> int:
    try:
        require_dsagent_runtime()
    except RuntimeError as exc:
        emit_json({"status": "error", "error_code": EXIT_PARAM_ERROR, "error_message": str(exc)})
        return EXIT_PARAM_ERROR
    args = parse_args()
    if args.command == "prepare":
        code, message = prepare(_raw_args(args))
        emit_json({"status": "success" if code == 0 else "error", "evidence_path": args.evidence, "message": message})
        return code
    if args.command == "aggregate":
        code, message = aggregate(["--evidence", args.evidence, "--output", args.facts])
        emit_json({"status": "success" if code == 0 else "error", "facts_path": args.facts, "message": message})
        return code
    if args.command == "validate":
        code, message = validate(["--evidence", args.evidence, "--facts", args.facts, "--output", args.validation])
        emit_json({"status": "success" if code == 0 else "error", "validation_path": args.validation, "message": message})
        return code
    if args.command == "summary":
        emit_json({"status": "success", **build_compact_summary(load_json(args.facts))})
        return EXIT_SUCCESS
    if args.command == "analyze":
        Path(args.evidence).parent.mkdir(parents=True, exist_ok=True)
        code, message = prepare(_raw_args(args))
        if code != 0:
            emit_json({"status": "error", "stage": "prepare", "message": message})
            return EXIT_PARAM_ERROR
        code, message = aggregate(["--evidence", args.evidence, "--output", args.facts])
        if code != 0:
            emit_json({"status": "error", "stage": "aggregate", "message": message})
            return EXIT_PARAM_ERROR
        code, message = validate(["--evidence", args.evidence, "--facts", args.facts, "--output", args.validation])
        if code != 0:
            emit_json({"status": "error", "stage": "validate", "message": message})
            return EXIT_VALIDATION_ERROR
        emit_json({
            "status": "success",
            "evidence_path": args.evidence,
            "facts_path": args.facts,
            "validation_path": args.validation,
            **build_compact_summary(load_json(args.facts)),
        })
        return EXIT_SUCCESS
    return EXIT_PARAM_ERROR
