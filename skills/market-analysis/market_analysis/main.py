from __future__ import annotations

import argparse
import logging
import math
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Sequence

from .config import (
    BATCH_TIME_BUDGET_SEC,
    artifacts_dir,
    DEFAULT_ITEM_LIMIT,
    EXIT_COOKIE_INVALID,
    EXIT_PARAM_ERROR,
    EXIT_SUCCESS,
    SEARCH_PAGE_SIZE,
    SORT_LABEL_MAP,
    SORT_PARAM_MAP,
    TAOBAO_PLATFORM,
    print_output_files,
)
from ._runtime import BindingContextError, fetch_binding_context
from .io import emit_json, emit_results, write_result_json
from .prompt_parser import normalize_sort, resolve_request
from .types import PageSummary, SearchProduct, SkillError, SkillOutput

if TYPE_CHECKING:
    from .api_client import TaobaoMarketAnalysisClient

logger = logging.getLogger(__name__)

GUIDE_QUERY_MARKERS = (
    "怎么用",
    "如何用",
    "使用指南",
    "使用说明",
    "帮助",
    "help",
    "guide",
    "usage",
)


class SkillArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        self.print_usage(sys.stderr)
        print(f"{self.prog}: error: {message}", file=sys.stderr)
        print(
            "\n用法示例:\n"
            "  查看说明: python -m market_analysis guide\n"
            "  获取数据: python -m market_analysis \"帮我查看手机的趋势\"\n"
            "  登录凭证: 请在 DeepSeek Agent「平台连接」中登录淘宝并绑定当前智能体\n",
            file=sys.stderr,
        )
        raise SystemExit(EXIT_PARAM_ERROR)


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.WARNING,
        format="[%(levelname)s] %(message)s",
        stream=sys.stderr,
    )


def build_usage_guide() -> str:
    return (
        "这个 skill 用来查看淘宝搜索页里某个词的市场情况。\n\n"
        "你直接说想看什么就行，比如“帮我看看手机的趋势”、“分析耳机市场”，"
        "它会自动获取商品数据，并生成数据文件、CSV 表格和 HTML 网页报告。\n\n"
        "默认行为：\n"
        "- 排序方式：综合排序\n"
        "- 发货地：不限\n"
        "- 数据数量：自动按你的描述去取，不需要你自己算页数\n"
        "- 输出文件：自动保存到 skill 对应的结果目录\n\n"
        "你可以这样说：\n"
        "- 基础分析：帮我看看手机的趋势 / 分析耳机市场\n"
        "- 排序方式：按综合排序看看手机壳 / 按销量排序看看耳机市场 / "
        "按信用排序看看女装 / 按价格从低到高看看水杯 / 按价格从高到低看看电脑桌\n"
        "- 发货地：帮我看浙江发货的女装\n"
        "- 最低价格：帮我看100元以上的手机壳\n"
        "- 最高价格：帮我看300元以下的手机壳\n"
        "- 价格区间：帮我看200到500元的蓝牙耳机\n"
        "- 获取数量：帮我分析前200个商品手机壳市场\n\n"
        "支持的排序方式一共有 5 种：\n"
        "- 综合排序\n"
        "- 销量排序\n"
        "- 信用排序\n"
        "- 价格从低到高\n"
        "- 价格从高到低\n\n"
        "分析完成后，我会直接告诉你真实生成的文件路径，包括：\n"
        "- 数据文件路径\n"
        "- CSV 文件路径\n"
        "- HTML 报告路径\n\n"
        f"当前默认输出目录：{artifacts_dir()}\n"
    )


def wants_usage_guide(text: str) -> bool:
    normalized = re.sub(r"\s+", "", text.strip().lower())
    if not normalized:
        return True
    return any(marker in normalized for marker in GUIDE_QUERY_MARKERS)


def parse_search_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = SkillArgumentParser(
        description="淘宝商品市场分析 Skill - 通过淘宝搜索页获取关键词下的商品市场数据",
        prog="market_analysis",
    )
    parser.add_argument(
        "queries", nargs="+", help="关键词或自然语言请求，例如：手机 / 帮我查看手机的趋势"
    )
    parser.add_argument(
        "--sort",
        default="",
        help="排序方式：default|sale|credit|price-asc|price-desc，默认综合排序",
    )
    parser.add_argument("--location", default="", help="发货地，例如：浙江")
    parser.add_argument(
        "--item_limit",
        type=int,
        default=None,
        help=f"最多分析多少个商品，默认 {DEFAULT_ITEM_LIMIT}",
    )
    parser.add_argument("--page_size", type=int, default=SEARCH_PAGE_SIZE, help=argparse.SUPPRESS)
    parser.add_argument("--max_pages", type=int, default=None, help=argparse.SUPPRESS)
    parser.add_argument("--price_min", type=float, default=None, help="最低价格")
    parser.add_argument("--price_max", type=float, default=None, help="最高价格")
    return parser.parse_args(list(argv))


def sanitize_filename(value: str) -> str:
    value = re.sub(r"[\\\\/:*?\"<>|]+", "_", value.strip())
    value = re.sub(r"\s+", "_", value)
    return value or "market_analysis"


def ensure_binding_context() -> tuple[dict, str]:
    try:
        ctx = fetch_binding_context(platform=TAOBAO_PLATFORM)
    except BindingContextError as exc:
        raise SkillError(EXIT_COOKIE_INVALID, exc.message) from exc
    source = f"gateway:{ctx.get('source', 'dsagent')}"
    return ctx, source


def collect_keyword_data(
    client: "TaobaoMarketAnalysisClient",
    raw_query: str,
    *,
    binding_source: str,
    sort_override: str | None,
    location_override: str | None,
    item_limit: int | None,
    max_pages: int,
    page_size: int,
    price_min: float | None,
    price_max: float | None,
    output_dir: Path,
    shop_key: str,
) -> SkillOutput:
    from .analyzer import build_market_analysis
    from .csv_exporter import export_csv
    from .report_generator import generate_market_analysis_report

    request = resolve_request(
        raw_query,
        sort_override=sort_override,
        location_override=location_override,
        item_limit_override=item_limit,
        max_pages=max_pages,
        page_size=page_size,
        price_min=price_min,
        price_max=price_max,
    )

    if not request.keyword:
        raise SkillError(EXIT_PARAM_ERROR, f"无法从输入中提取关键词: {raw_query}")

    sort = normalize_sort(request.sort)
    if sort not in SORT_PARAM_MAP:
        raise SkillError(EXIT_PARAM_ERROR, f"不支持的排序方式: {request.sort}")

    import time as _time

    class _TimeBudget:
        def __init__(self, total_seconds: float):
            self._deadline = _time.time() + total_seconds
        def check(self, label: str = "") -> bool:
            return _time.time() >= self._deadline

    budget = _TimeBudget(BATCH_TIME_BUDGET_SEC)

    total_count = 0
    products: list[SearchProduct] = []
    page_summaries: list[PageSummary] = []

    target_item_limit = max(request.item_limit, 1)
    required_pages = max(1, math.ceil(target_item_limit / max(request.page_size, 1)))

    for page in range(1, max(request.max_pages, required_pages) + 1):
        if budget.check(f"collect_keyword_data({request.keyword})"):
            break
        payload = client.fetch_page(
            keyword=request.keyword,
            page=page,
            page_size=request.page_size,
            sort=SORT_PARAM_MAP[sort],
            location=request.location,
            price_min=request.price_min,
            price_max=request.price_max,
        )
        page_products, current_total = client.parse_products(payload, page)
        if page == 1:
            total_count = current_total
        if not page_products:
            break

        remaining_count = target_item_limit - len(products)
        if remaining_count <= 0:
            break
        if len(page_products) > remaining_count:
            page_products = page_products[:remaining_count]

        base_rank = len(products)
        for index, product in enumerate(page_products, start=1):
            product.global_rank = base_rank + index
        products.extend(page_products)
        page_summaries.append(PageSummary(page=page, item_count=len(page_products)))

        if total_count and len(products) >= total_count:
            break

    # 写入 Connect skill-cache
    from .storage import ProductStorage

    with ProductStorage(shop_key=shop_key) as store:
        store.upsert_products(
            [p.to_dict() for p in products],
            keyword=request.keyword,
            sort_method=sort,
        )

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_name = f"淘宝市场分析_{sanitize_filename(request.keyword)}_{timestamp}.csv"
    csv_path = export_csv(products, output_dir / csv_name)
    analysis = build_market_analysis(
        request.keyword,
        products,
        total_count=total_count,
        collected_pages=len(page_summaries),
    )

    result = SkillOutput(
        status="success",
        raw_query=request.raw_query,
        keyword=request.keyword,
        binding_source=binding_source,
        requested_config={
            "sort": sort,
            "sort_label": SORT_LABEL_MAP.get(sort, sort),
            "sort_param": SORT_PARAM_MAP[sort],
            "location": request.location,
            "item_limit": request.item_limit,
            "page_size": request.page_size,
            "max_pages": request.max_pages,
            "price_min": request.price_min,
            "price_max": request.price_max,
        },
        total_count=total_count,
        collected_pages=len(page_summaries),
        collected_count=len(products),
        page_summaries=[item.to_dict() for item in page_summaries],
        products=[product.to_dict() for product in products],
        csv_path=csv_path,
        analysis=analysis,
    )
    report_name = f"淘宝市场分析报告_{sanitize_filename(request.keyword)}_{timestamp}.html"
    report_path = output_dir / report_name
    result.report_path = str(report_path)
    generate_market_analysis_report(result, report_path)

    json_name = f"淘宝市场分析_{sanitize_filename(request.keyword)}_{timestamp}.json"
    result.json_path = write_result_json(result, output_dir / json_name)
    return result


def execute_queries(
    args: argparse.Namespace,
    binding: dict,
    binding_source: str,
    *,
    output_dir: Path,
) -> list[SkillOutput]:
    from .api_client import TaobaoMarketAnalysisClient

    client = TaobaoMarketAnalysisClient(cna=str(binding.get("cna") or ""))
    shop_key = str(binding.get("shop_key") or "").strip()
    return [
        collect_keyword_data(
            client,
            raw_query=query,
            binding_source=binding_source,
            sort_override=args.sort or None,
            location_override=args.location or None,
            item_limit=args.item_limit,
            max_pages=args.max_pages,
            page_size=args.page_size,
            price_min=args.price_min,
            price_max=args.price_max,
            output_dir=output_dir,
            shop_key=shop_key,
        )
        for query in args.queries
    ]


def run_search(argv: Sequence[str]) -> int:
    args = parse_search_args(argv)
    if len(args.queries) == 1 and wants_usage_guide(args.queries[0]):
        print(build_usage_guide())
        return EXIT_SUCCESS
    setup_logging()

    try:
        output_dir = artifacts_dir()
        binding, binding_source = ensure_binding_context()
        try:
            results = execute_queries(
                args,
                binding,
                binding_source,
                output_dir=output_dir,
            )
        except SkillError as exc:
            if exc.exit_code != EXIT_COOKIE_INVALID:
                raise
            binding, binding_source = ensure_binding_context()
            results = execute_queries(
                args,
                binding,
                binding_source,
                output_dir=output_dir,
            )

        emit_results(results)

        # 统一打印所有生成文件的绝对路径
        first = results[0] if results else None
        print_output_files(
            JSON=first.json_path if first else "",
            CSV=first.csv_path if first else "",
            HTML=first.report_path if first else "",
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
    args = list(argv if argv is not None else sys.argv[1:])
    if not args:
        print(build_usage_guide())
        return EXIT_SUCCESS
    if args[0].startswith("-"):
        return run_search(args)
    if len(args) == 1 and wants_usage_guide(args[0]):
        print(build_usage_guide())
        return EXIT_SUCCESS
    return run_search(args)
