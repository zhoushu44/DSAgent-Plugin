"""
关键词流量解析 CLI

Usage:
    python -m keyword_traffic categories "关键词"
    python -m keyword_traffic trend "关键词" [--cate_id N] [--months 13]
    python -m keyword_traffic summary "关键词"
    python -m keyword_traffic history [--keyword 片段]
"""

from __future__ import annotations

import argparse
import io
import logging
import sys
from datetime import datetime

if sys.platform == "win32":
    for _name in ("stdout", "stderr"):
        _stream = getattr(sys, _name)
        if hasattr(_stream, "buffer"):
            setattr(
                sys,
                _name,
                io.TextIOWrapper(_stream.buffer, encoding="utf-8", errors="replace"),
            )

from .alimama_client import (
    AlimamaError,
    AlimamaInsightClient,
    AlimamaRateLimitError,
)
from ._runtime import get_alimama_client
from .analyzer import build_trend_analysis
from .cli_utils import resolve_cate_id, sanitize_filename
from .report_generator import generate_keyword_traffic_report
from .config import (
    EXIT_API_ERROR,
    EXIT_COOKIE_INVALID,
    EXIT_PARAM_ERROR,
    EXIT_RATE_LIMIT,
    EXIT_SUCCESS,
    SYCM_PLATFORM,
    artifacts_dir,
    print_output_files,
)
from ._runtime import BindingContextError, fetch_binding_context
from .csv_exporter import export_trend_csv
from .io import emit_json
from .storage import TrafficStorage
from .trend_fetcher import TrendFetcher


class SkillArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        self.print_usage(sys.stderr)
        print(f"{self.prog}: error: {message}", file=sys.stderr)
        sys.exit(EXIT_PARAM_ERROR)


def parse_args() -> argparse.Namespace:
    parser = SkillArgumentParser(
        description="万相台无界版 关键词流量趋势分析",
        prog="keyword_traffic",
    )
    sub = parser.add_subparsers(dest="command")

    p_cat = sub.add_parser("categories", help="查询关键词匹配的行业类目")
    p_cat.add_argument("keyword")

    p_trend = sub.add_parser("trend", help="获取关键词流量趋势（最多13个月）")
    p_trend.add_argument("keyword")
    p_trend.add_argument("--cate_id", type=int, default=0)
    p_trend.add_argument("--months", type=int, default=13)

    p_sum = sub.add_parser("summary", help="获取市场数据总结")
    p_sum.add_argument("keyword")
    p_sum.add_argument("--cate_id", type=int, default=0)

    p_hist = sub.add_parser("history", help="查看 Connect skill-cache 中已抓取的关键词")
    p_hist.add_argument("--keyword", default="", help="关键词模糊筛选")
    p_hist.add_argument("--limit", type=int, default=50)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(EXIT_PARAM_ERROR)
    return args


def _ensure_shop_key() -> str:
    ctx = fetch_binding_context(platform=SYCM_PLATFORM)
    key = str(ctx.get("shop_key") or "").strip()
    if not key:
        raise BindingContextError("未绑定店铺")
    return key


def _client() -> AlimamaInsightClient:
    client, _shop_key = get_alimama_client()
    return client


def _err(code: int, message: str, **extra) -> int:
    emit_json({"status": "error", "error_code": code, "error_message": message, **extra})
    return code


def cmd_categories(args: argparse.Namespace) -> int:
    fetcher = TrendFetcher(_client())
    result = {
        "status": "success",
        "keyword": args.keyword,
        "categories": fetcher.get_categories(args.keyword),
        "error_code": EXIT_SUCCESS,
    }
    emit_json(result)
    return EXIT_SUCCESS


def cmd_trend(args: argparse.Namespace) -> int:
    if not (1 <= args.months <= 13):
        return _err(EXIT_PARAM_ERROR, "months 必须在 1~13 之间")

    fetcher = TrendFetcher(_client())
    cate_id, cate_name = resolve_cate_id(fetcher, args.keyword, args.cate_id)

    result = fetcher.fetch_trend(args.keyword, cate_id, args.months)
    analysis = build_trend_analysis(
        args.keyword,
        result.get("trend_data", []),
        months=args.months,
    )

    summary = fetcher.fetch_summary(args.keyword, cate_id)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_name = f"关键词流量报告_{sanitize_filename(args.keyword)}_{timestamp}.html"
    report_path = artifacts_dir() / report_name
    generate_keyword_traffic_report(
        {
            **result,
            "cate_name": cate_name,
            "analysis": analysis,
            "summary": summary,
        },
        report_path,
    )

    result.update(
        status="success",
        cate_name=cate_name,
        analysis=analysis,
        summary=summary,
        error_code=EXIT_SUCCESS,
        report_path=str(report_path),
    )

    csv_path = export_trend_csv(
        result.get("trend_data", []),
        keyword=args.keyword,
        cate_name=cate_name,
        date_range=result.get("date_range", ""),
    )
    if csv_path:
        result["csv_path"] = csv_path

    shop_key = _ensure_shop_key()
    with TrafficStorage(shop_key=shop_key) as store:
        store.upsert_trend(
            result.get("trend_data", []),
            keyword=args.keyword,
            cate_id=str(cate_id),
            date_range=result.get("date_range", ""),
        )
        if summary:
            store.upsert_summary(summary, keyword=args.keyword, cate_id=str(cate_id))

    emit_json(result)
    print_output_files(CSV=csv_path, HTML=str(report_path))
    return EXIT_SUCCESS


def cmd_summary(args: argparse.Namespace) -> int:
    fetcher = TrendFetcher(_client())
    cate_id, cate_name = resolve_cate_id(fetcher, args.keyword, args.cate_id)

    summary = fetcher.fetch_summary(args.keyword, cate_id)
    result = {
        "status": "success",
        "keyword": args.keyword,
        "cate_id": cate_id,
        "cate_name": cate_name,
        "summary": summary,
        "error_code": EXIT_SUCCESS,
    }

    with TrafficStorage(shop_key=_ensure_shop_key()) as store:
        store.upsert_summary(summary, keyword=args.keyword, cate_id=str(cate_id))

    emit_json(result)
    return EXIT_SUCCESS


def cmd_history(args: argparse.Namespace) -> int:
    with TrafficStorage(shop_key=_ensure_shop_key()) as store:
        rows = store.query_keywords(args.keyword, limit=args.limit)
    emit_json({"status": "success", "keywords": rows, "error_code": EXIT_SUCCESS})
    return EXIT_SUCCESS


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="[%(levelname)s] %(message)s",
        stream=sys.stderr,
    )
    args = parse_args()
    handlers = {
        "categories": cmd_categories,
        "trend": cmd_trend,
        "summary": cmd_summary,
        "history": cmd_history,
    }
    try:
        return handlers[args.command](args)
    except BindingContextError as exc:
        return _err(EXIT_COOKIE_INVALID, str(exc))
    except AlimamaRateLimitError as exc:
        return _err(EXIT_RATE_LIMIT, exc.message, details=exc.details)
    except AlimamaError as exc:
        return _err(EXIT_API_ERROR, exc.message, details=exc.details)


if __name__ == "__main__":
    sys.exit(main())
