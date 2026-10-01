"""
市场排行趋势分析 CLI 入口

Usage:
    python -m market_trend --cate_id <ID> [options]
    python -m market_trend inject-report --insights_md <PATH> [--cate_id ID] [--rank_type gmv] [--trend_mode week]

Exit Codes:
    0 - 成功
    1 - 参数错误
    2 - 会话无效
    3 - API 限流
    4 - API 错误
"""

import argparse
import logging
import sys
import time

from .config import (
    BATCH_TIME_BUDGET_SEC,
    DEFAULT_MAX_PAGES,
    DEFAULT_RANK_TYPE,
    RANK_TYPE_CONFIGS,
    SYCM_PLATFORM,
    print_output_files,
)
from ._api_client import (
    ApiPermissionError,
    ApiSessionExpiredError,
    SycmApiError,
    SycmClient,
    SycmRequestError,
    get_sycm_client,
)
from ._runtime import BindingContextError, fetch_binding_context

from .csv_exporter import export_trend_csv
from .insights_validate import sanitize_insights
from .io import emit_json
from .report_generator import generate_trend_report
from .trend_analyzer import aggregate_periods_data, compute_summary
from .trend_fetcher import (
    TimeBudget,
    fetch_four_periods,
    get_default_month_range,
    get_default_week_range,
)
from .types import (
    EXIT_API_ERROR,
    EXIT_COOKIE_INVALID,
    EXIT_NO_PERMISSION,
    EXIT_PARAM_ERROR,
    EXIT_SUCCESS,
    SkillOutput,
)


class SkillArgumentParser(argparse.ArgumentParser):
    """参数错误返回 exit(1)，并提供友好的引导信息"""

    def error(self, message: str) -> None:
        self.print_usage(sys.stderr)
        print(f"\n[FAIL] 参数错误: {message}", file=sys.stderr)
        print(
            "\n正确用法:\n"
            "  查类目ID:  python -m market_trend list-categories --keyword 宠物\n"
            "  获取趋势:  python -m market_trend --cate_id 29\n"
            "  指定榜单:  python -m market_trend --cate_id 29 --rank_type growth\n"
            "  生成报告:  python -m market_trend inject-report --insights_md 洞察.md\n"
            "\n[NOTE] 注意: 参数名用下划线（--cate_id）或连字符（--cate-id）均可\n"
            "  详见 SKILL.md",
            file=sys.stderr,
        )
        sys.exit(EXIT_PARAM_ERROR)


def setup_logging(output_format: str) -> None:
    """配置日志 — 所有模式都输出进度信息到 stderr"""
    logging.basicConfig(
        level=logging.INFO,
        format="[%(levelname)s] %(message)s",
        stream=sys.stderr,
    )


def parse_args() -> argparse.Namespace:
    parser = SkillArgumentParser(
        description="生意参谋市场排行趋势分析 - Agent Skill",
        prog="market_trend",
    )
    # 所有参数同时支持下划线和连字符格式
    parser.add_argument(
        "--cate_id", "--cate-id",
        dest="cate_id",
        required=True,
        help="类目 ID（必填，如 29）。不知道ID？先用 list-categories --keyword 查询",
    )
    parser.add_argument(
        "--cate_flag", "--cate-flag",
        dest="cate_flag",
        default="",
        help="类目标记（可选）",
    )
    parser.add_argument(
        "--rank_type", "--rank-type", "--board-type", "--board_type",
        dest="rank_type",
        choices=list(RANK_TYPE_CONFIGS.keys()),
        default=DEFAULT_RANK_TYPE,
        help=f"榜单类型（默认 {DEFAULT_RANK_TYPE}）",
    )
    parser.add_argument(
        "--trend_mode", "--trend-mode",
        dest="trend_mode",
        choices=["week", "month"],
        default="week",
        help="趋势模式: week=周趋势（默认）| month=月趋势",
    )
    parser.add_argument(
        "--date_range", "--date-range",
        dest="date_range",
        default="",
        help="基准日期范围 YYYY-MM-DD|YYYY-MM-DD（默认自动计算上周/上月）",
    )
    parser.add_argument(
        "--max_pages", "--max-pages",
        dest="max_pages",
        type=int,
        default=DEFAULT_MAX_PAGES,
        help=f"每个周期最大页数，每页 20 条，0=全部（默认 {DEFAULT_MAX_PAGES}）",
    )
    parser.add_argument(
        "--seller_type", "--seller-type",
        dest="seller_type",
        default="-1",
        help="店铺类型: -1=全部（默认）| 0=淘宝 | 1=天猫",
    )
    parser.add_argument(
        "--price_seg", "--price-seg",
        dest="price_seg",
        default="",
        help="价格带筛选（默认不限）",
    )
    parser.add_argument(
        "--cate_name", "--cate-name",
        dest="cate_name",
        default="",
        help="类目名称（可选，不传则自动从 cate_id 反查）",
    )
    parser.add_argument(
        "--output_format", "--output-format",
        dest="output_format",
        choices=["json", "text", "table"],
        default="json",
        help="输出格式（默认 json）",
    )
    return parser.parse_args()


def _resolve_cate_name(client: SycmClient, cate_id: str) -> str:
    """从 cate_id 反查类目名称"""
    from .category_fetcher import fetch_all_categories

    try:
        categories = fetch_all_categories(client)
        for cat in categories:
            if str(cat["cate_id"]) == str(cate_id):
                return cat["cate_name"]
    except Exception as exc:
        logger.warning("类目名称解析失败 cate_id=%s: %s", cate_id, exc)
    return ""


def _format_trend_label(trend: str) -> str:
    """趋势中文标签"""
    mapping = {
        "up": "↑上升",
        "down": "↓下降",
        "stable": "→持平",
        "new": "[NEW]上榜",
        "drop": "[OUT]跌出",
    }
    return mapping.get(trend, trend)


def _output_text(trend_items: list, periods: list, rank_type: str, summary: dict) -> None:
    """输出人类可读的文本格式"""
    config = RANK_TYPE_CONFIGS[rank_type]
    period_labels = [p.date_label for p in periods]

    print(f"\n{'=' * 70}")
    print(f"市场排行趋势分析 — {config['label']}")
    print(f"周期: {' → '.join(period_labels)}")
    print(f"共 {summary['total']} 个商品，"
          f"上升 {summary['rising_count']}，下降 {summary['falling_count']}，"
          f"新上榜 {summary['new_count']}，跌出榜 {summary['dropped_count']}，"
          f"持平 {summary['stable_count']}")
    print("=" * 70)

    for item in trend_items[:30]:
        rank_str = f"#{item.current_rank}" if item.current_rank else "未上榜"
        print(f"  {rank_str:>6} {_format_trend_label(item.trend):>8}  {item.title[:40]}")


def _output_table(trend_items: list, periods: list, rank_type: str, summary: dict) -> None:
    """输出表格格式"""
    config = RANK_TYPE_CONFIGS[rank_type]

    print(f"\n市场排行趋势分析 — {config['label']}")
    print(f"共 {summary['total']} 个商品")

    header = f"{'排名':>6} | {'趋势':>8} | {'变化':>6} | {'商品名称':<30} | {'店铺':>15}"
    print(header)
    print("-" * len(header))

    for item in trend_items[:50]:
        rank_str = str(item.current_rank) if item.current_rank else "-"
        change_str = "-"
        if item.rank_change is not None:
            if item.rank_change < 0:
                change_str = f"↑{abs(item.rank_change)}"
            elif item.rank_change > 0:
                change_str = f"↓{item.rank_change}"
            else:
                change_str = "0"

        print(f"{rank_str:>6} | {_format_trend_label(item.trend):>8} | {change_str:>6} | "
              f"{item.title[:30]:<30} | {item.shop_title[:15]:>15}")


def main() -> int:
    args = parse_args()
    setup_logging(args.output_format)
    logger = logging.getLogger(__name__)

    try:
        client, shop_key = get_sycm_client()
    except BindingContextError as e:
        if args.output_format == "json":
            emit_json(SkillOutput(
                status="error",
                error_code=EXIT_COOKIE_INVALID,
                error_message=e.message,
            ).to_dict())
        else:
            print(f"[ERROR] {e.message}")
        return EXIT_COOKIE_INVALID

    # 2. 获取类目名称
    cate_name = args.cate_name
    if not cate_name:
        cate_name = _resolve_cate_name(client, args.cate_id)
    logger.info(f"类目: {cate_name or '(未知)'} (ID: {args.cate_id})")

    # 3. 确定基准日期范围
    if args.date_range:
        base_date_range = args.date_range
    elif args.trend_mode == "month":
        base_date_range = get_default_month_range()
    else:
        base_date_range = get_default_week_range()

    logger.info(f"基准日期范围: {base_date_range}")
    logger.info(f"榜单类型: {RANK_TYPE_CONFIGS[args.rank_type]['label']}")
    logger.info(f"趋势模式: {'月趋势' if args.trend_mode == 'month' else '周趋势'}")

    # 4. 获取 4 个周期数据
    budget = TimeBudget(BATCH_TIME_BUDGET_SEC)
    try:
        periods = fetch_four_periods(
            client,
            rank_type=args.rank_type,
            trend_mode=args.trend_mode,
            base_date_range=base_date_range,
            cate_id=args.cate_id,
            max_pages=args.max_pages,
            cate_flag=args.cate_flag,
            seller_type=args.seller_type,
            price_seg=args.price_seg,
            budget=budget,
        )
    except ApiPermissionError as e:
        msg = f"当前账号无权访问类目 {args.cate_id}（{cate_name or '未知'}），请切换到有该类目权限的账号后重试"
        logger.error(msg)
        if args.output_format == "json":
            emit_json(SkillOutput(
                status="error",
                error_code=EXIT_NO_PERMISSION,
                error_message=msg,
            ).to_dict())
        else:
            print(f"[ERROR] {msg}")
        return EXIT_NO_PERMISSION
    except ApiSessionExpiredError as e:
        msg = f"登录态已过期，请在平台连接重新登录 sycm: {e.message}"
        logger.error(msg)
        if args.output_format == "json":
            emit_json(SkillOutput(
                status="error",
                error_code=EXIT_COOKIE_INVALID,
                error_message=msg,
            ).to_dict())
        else:
            print(f"[ERROR] {msg}")
        return EXIT_COOKIE_INVALID
    except (SycmApiError, SycmRequestError) as e:
        msg = str(getattr(e, "message", e))
        logger.error(msg)
        if args.output_format == "json":
            emit_json(SkillOutput(
                status="error",
                error_code=EXIT_API_ERROR,
                error_message=msg,
            ).to_dict())
        else:
            print(f"[ERROR] {msg}")
        return EXIT_API_ERROR
    except Exception as e:
        logger.error(f"数据获取失败: {e}")
        if args.output_format == "json":
            emit_json(SkillOutput(
                status="error",
                error_code=EXIT_API_ERROR,
                error_message=f"数据获取失败: {e}",
            ).to_dict())
        else:
            print(f"[ERROR] 数据获取失败: {e}")
        return EXIT_API_ERROR

    # 5. 聚合 + 趋势分析
    trend_items = aggregate_periods_data(periods, args.rank_type)
    summary = compute_summary(trend_items)

    logger.info(f"聚合完成：共 {len(trend_items)} 个商品")

    # 5.5 导出 CSV
    csv_path = export_trend_csv(trend_items, periods, args.rank_type, args.trend_mode, cate_name=cate_name)

    # 6. 构建输出并入库
    config = RANK_TYPE_CONFIGS[args.rank_type]
    output = SkillOutput(
        status="success",
        rank_type=args.rank_type,
        rank_type_label=config["label"],
        trend_mode=args.trend_mode,
        date_ranges=[p.date_range for p in periods],
        cate_id=args.cate_id,
        cate_name=cate_name,
        total_items=len(trend_items),
        trend_items=[item.to_dict() for item in trend_items],
        periods_summary=[p.to_dict() for p in periods],
        summary=summary,
        csv_path=csv_path,
        error_code=EXIT_SUCCESS,
    )
    from .storage import MarketTrendStorage

    with MarketTrendStorage(shop_key=shop_key) as store:
        stored = store.upsert_periods(
            periods,
            rank_type=args.rank_type,
            cate_id=args.cate_id,
            trend_mode=args.trend_mode,
        )
        store.upsert_run(
            cate_id=args.cate_id,
            rank_type=args.rank_type,
            trend_mode=args.trend_mode,
            payload=output.to_dict(),
            csv_path=csv_path,
        )
        logger.info(f"排行数据已入库: {stored} 条")

    # 7. 输出结果
    if args.output_format == "json":
        emit_json(output.to_dict())
    elif args.output_format == "table":
        _output_table(trend_items, periods, args.rank_type, summary)
    else:
        _output_text(trend_items, periods, args.rank_type, summary)

    print_output_files(CSV=csv_path)

    return EXIT_SUCCESS


# ---------- inject-report 子命令 ----------


def inject_report(args: list[str]) -> int:
    """inject-report 子命令：生成蓝白主题 HTML 报告。"""
    parser = SkillArgumentParser(
        description="将 AI 洞察注入市场排行趋势报告",
        prog="market_trend inject-report",
    )
    parser.add_argument(
        "--insights_md", "--insights-md",
        dest="insights_md",
        default="",
        help="Agent 生成的 Markdown 洞察文件路径（可选，不提供则跳过洞察注入）",
    )
    parser.add_argument(
        "--cate_id", "--cate-id",
        dest="cate_id",
        default="",
        help="类目 ID（默认取最近一次趋势抓取）",
    )
    parser.add_argument(
        "--rank_type", "--rank-type",
        dest="rank_type",
        default="",
        help="榜单类型（默认取最近一次）",
    )
    parser.add_argument(
        "--trend_mode", "--trend-mode",
        dest="trend_mode",
        default="",
        help="趋势模式 week|month（默认取最近一次）",
    )
    parsed = parser.parse_args(args)

    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s", stream=sys.stderr)

    from .storage import MarketTrendStorage

    try:
        ctx = fetch_binding_context(platform=SYCM_PLATFORM)
        with MarketTrendStorage(shop_key=str(ctx.get("shop_key") or "")) as store:
            raw_data = store.load_run_payload(
                cate_id=parsed.cate_id,
                rank_type=parsed.rank_type,
                trend_mode=parsed.trend_mode,
            )
    except Exception as e:
        emit_json({"error": f"读取缓存数据失败: {e}"})
        return EXIT_API_ERROR

    if raw_data is None:
        emit_json({"error": "未找到可生成报告的趋势数据，请先运行 market_trend --cate_id ..."})
        return EXIT_PARAM_ERROR

    # 读取 Markdown（可选）
    insights_md = ""
    if parsed.insights_md:
        try:
            with open(parsed.insights_md, "r", encoding="utf-8") as f:
                insights_md = f.read()
        except OSError as e:
            emit_json({"error": f"读取 insights_md 失败: {e}"})
            return EXIT_PARAM_ERROR

        if not insights_md.strip():
            emit_json({"error": "insights_md 内容为空"})
            return EXIT_PARAM_ERROR

        fixed_md, fixes = sanitize_insights(insights_md)
        if fixes:
            for fix in fixes:
                print(f"[AUTO-FIX] {fix}", file=sys.stderr)
            with open(parsed.insights_md, "w", encoding="utf-8") as f:
                f.write(fixed_md)
            insights_md = fixed_md

    if raw_data.get("status") != "success":
        emit_json({"error": "缓存数据状态非 success，无法生成报告"})
        return EXIT_API_ERROR

    try:
        report_path = generate_trend_report(raw_data, insights_md)
    except OSError as e:
        emit_json({"error": f"报告生成失败: {e}"})
        return EXIT_API_ERROR

    csv_path = raw_data.get("csv_path", "")
    result = {"status": "success", "report_path": report_path}
    if csv_path:
        result["csv_path"] = csv_path
    if insights_md:
        result["insights_injected"] = True

    emit_json(result)
    print_output_files(HTML=report_path, CSV=csv_path)
    return EXIT_SUCCESS


# ---------- list-categories 子命令 ----------


def list_categories(args: list[str]) -> int:
    """list-categories 子命令：查询当前账号在市场排行中可用的类目，支持按名称搜索。"""
    parser = SkillArgumentParser(
        description="查询当前账号在市场排行中可用的类目列表",
        prog="market_trend list-categories",
    )
    parser.add_argument(
        "--keyword", "--kw",
        dest="keyword",
        default="",
        help="类目名称搜索关键词（模糊匹配，支持空格分隔多关键词 AND 匹配）",
    )
    parsed = parser.parse_args(args)

    logging.basicConfig(
        level=logging.INFO,
        format="[%(levelname)s] %(message)s",
        stream=sys.stderr,
    )

    try:
        client, _shop_key = get_sycm_client()
    except BindingContextError as e:
        result = {"status": "error", "error_code": EXIT_COOKIE_INVALID, "error_message": e.message}
        emit_json(result)
        return EXIT_COOKIE_INVALID

    # 2. 获取类目数据
    from .category_fetcher import (
        build_category_tree,
        fetch_all_categories,
        list_all_categories_flat,
        search_categories,
    )

    try:
        flat_items = fetch_all_categories(client)
    except Exception as e:
        result = {"status": "error", "error_code": EXIT_API_ERROR, "error_message": f"获取类目失败: {e}"}
        emit_json(result)
        return EXIT_API_ERROR

    if not flat_items:
        result = {"status": "error", "error_code": EXIT_API_ERROR, "error_message": "未获取到类目数据，请检查绑定是否有效"}
        emit_json(result)
        return EXIT_API_ERROR

    # 3. 搜索或列出全部
    tree = build_category_tree(flat_items)

    if parsed.keyword:
        categories = search_categories(flat_items, parsed.keyword, tree)
    else:
        categories = list_all_categories_flat(flat_items, tree)

    # 4. 输出结果
    result = {
        "status": "success",
        "keyword": parsed.keyword,
        "total": len(categories),
        "categories": categories,
    }

    emit_json(result)
    return EXIT_SUCCESS
