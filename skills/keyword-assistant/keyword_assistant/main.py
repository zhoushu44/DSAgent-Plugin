"""
关键词助手 CLI 入口 — Agent 平台集成接口

Usage:
    python -m keyword_assistant <keyword1> [keyword2] [--cate_id ID] [--output_format json|text|table] [--max_pages N] [--date_range START|END]
    python -m keyword_assistant --mode rank [--rank_type hot|rise|new] [--kw_type search|category]
    python -m keyword_assistant inject-report --insights_md <path> [--mode expand|rank] [--seed_keyword 词]

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
from datetime import datetime, timedelta

from .config import (
    BATCH_TIME_BUDGET_SEC,
    DEFAULT_MAX_PAGES,
    SYCM_PLATFORM,
    TOP_KEYWORDS_COUNT,
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
from .keyword_expander import TimeBudget
from .csv_exporter import export_csv, export_rank_csv
from .keyword_expander import expand_keyword, fetch_hot_rank, get_fallback_keywords
from .report_generator import generate_report_with_insights
from .insights_validate import sanitize_insights, validate_insights
from .io import emit_json, emit_results
from .types import (
    EXIT_API_ERROR,
    EXIT_COOKIE_INVALID,
    EXIT_NO_PERMISSION,
    EXIT_PARAM_ERROR,
    EXIT_SUCCESS,
    RankOutput,
    SkillOutput,
)


class SkillArgumentParser(argparse.ArgumentParser):
    """自定义 ArgumentParser，参数错误返回 exit(1) 而非默认的 exit(2)"""

    def error(self, message: str) -> None:
        self.print_usage(sys.stderr)
        print(f"{self.prog}: error: {message}", file=sys.stderr)
        print(
            "\n用法提示:\n"
            '  关联词拓展:  python -m keyword_assistant "关键词"\n'
            "  搜索排行榜:  python -m keyword_assistant --mode rank\n"
            "  生成报告:    python -m keyword_assistant inject-report --insights_md 洞察.md\n"
            "  详见 SKILL.md 三步流程说明",
            file=sys.stderr,
        )
        sys.exit(EXIT_PARAM_ERROR)


def setup_logging(output_format: str) -> None:
    """配置日志。始终输出 INFO+ 到 stderr。

    进度日志必须逐条输出：本技能 expand 模式可跑 10 页 × 每请求 2~3 秒，
    总耗时逼近甚至超过宿主 60 秒 idle 看门狗阈值。若在 JSON 模式下压掉 INFO，
    运行期间 stdout / stderr 双空 → 看门狗判定卡死并 SIGKILL（FIX-LOG #34 / #55.4 同类）。
    日志本来就写 stderr，不会污染 stdout 的 JSON 结果，因此无需按 output_format 降级。
    """
    logging.basicConfig(
        level=logging.INFO,
        format="[%(levelname)s] %(message)s",
        stream=sys.stderr,
    )


def parse_args() -> argparse.Namespace:
    parser = SkillArgumentParser(
        description="生意参谋关键词助手 - Agent Skill",
        prog="keyword_assistant",
    )
    parser.add_argument(
        "keywords",
        nargs="*",
        help="种子关键词列表（如：卫衣 连衣裙）。rank 模式下可省略",
    )
    parser.add_argument(
        "--mode",
        choices=["expand", "rank"],
        default="expand",
        help="查询模式：expand=关联词拓展（默认）| rank=搜索排行榜",
    )
    parser.add_argument(
        "--rank_type",
        choices=["hot", "rise", "new"],
        default="hot",
        help="排行榜类型（仅 rank 模式）：hot=热搜 | rise=飙升 | new=新词（默认 hot）",
    )
    parser.add_argument(
        "--kw_type",
        choices=["search", "category"],
        default="search",
        help="搜索词类型（仅 rank 模式）：search=搜索词 | category=类目词（默认 search）",
    )
    parser.add_argument(
        "--order_by",
        choices=["seIpvUvHits", "payByrCnt", "clickThroughRate"],
        default="seIpvUvHits",
        help="排序字段：seIpvUvHits=搜索人气（默认）| payByrCnt=支付买家数 | clickThroughRate=点击率",
    )
    parser.add_argument(
        "--cate_id",
        default="",
        help="淘宝类目 ID（可选，解决权限问题）",
    )
    parser.add_argument(
        "--output_format",
        choices=["json", "text", "table"],
        default="json",
        help="输出格式（默认 json）",
    )
    parser.add_argument(
        "--max_pages",
        type=int,
        default=DEFAULT_MAX_PAGES,
        help=f"最大页数（默认 {DEFAULT_MAX_PAGES}）。expand 模式每页 10 条，rank 模式每页 50 条",
    )
    parser.add_argument(
        "--date_range",
        default="",
        help="日期范围，格式: YYYY-MM-DD|YYYY-MM-DD（默认近7天，排除今天）。可选 'recent30' 快捷指定近30天",
    )
    return parser.parse_args()


def build_date_range(custom_range: str) -> str:
    """构建日期范围字符串。"""
    today = datetime.now()
    yesterday = today - timedelta(days=1)

    if not custom_range or custom_range == "recent7":
        start = yesterday - timedelta(days=6)
        return f"{start.strftime('%Y-%m-%d')}|{yesterday.strftime('%Y-%m-%d')}"

    if custom_range == "recent30":
        start = yesterday - timedelta(days=29)
        return f"{start.strftime('%Y-%m-%d')}|{yesterday.strftime('%Y-%m-%d')}"

    return custom_range


def output_text(seed_keyword: str, results: list, top_n: int = TOP_KEYWORDS_COUNT) -> None:
    """输出人类可读的文本格式"""
    print(f"\n{'=' * 50}")
    print(f"种子词 【{seed_keyword}】 相关词拓展结果 (展示前 {top_n} 条):")
    print("=" * 50)
    for idx, item in enumerate(results[:top_n]):
        print(
            f" {idx + 1}. 【{item.related_keyword}】 => "
            f"支付买家数: {item.pay_buyer_cnt}, "
            f"人气: {item.search_popularity}, "
            f"点击率: {item.click_rate}, "
            f"转化率: {item.pay_conv_rate}, "
            f"供需比: {item.demand_supply_ratio}"
        )


def output_table(seed_keyword: str, results: list, top_n: int = TOP_KEYWORDS_COUNT) -> None:
    """输出表格格式"""
    print(f"\n种子词: {seed_keyword}")
    header = f"{'#':>3} | {'拓展词':<20} | {'搜索人气':>12} | {'点击率':>8} | {'买家数':>12} | {'转化率':>10} | {'供需比':>8}"
    print(header)
    print("-" * len(header))
    for idx, item in enumerate(results[:top_n]):
        print(
            f"{idx + 1:>3} | {item.related_keyword:<20} | "
            f"{item.search_popularity:>12} | {item.click_rate:>8} | "
            f"{item.pay_buyer_cnt:>12} | {item.pay_conv_rate:>10} | "
            f"{item.demand_supply_ratio:>8}"
        )


def output_rank_text(results: list, top_n: int = TOP_KEYWORDS_COUNT) -> None:
    """输出排行榜文本格式"""
    print(f"\n{'=' * 60}")
    print(f"搜索排行榜 (展示前 {min(top_n, len(results))} 条):")
    print("=" * 60)
    for item in results[:top_n]:
        print(
            f" {item.rank:>3}. 【{item.keyword}】 => "
            f"人气: {item.search_popularity}, "
            f"点击率: {item.click_rate}, "
            f"转化率: {item.pay_rate}"
        )


def output_rank_table(results: list, top_n: int = TOP_KEYWORDS_COUNT) -> None:
    """输出排行榜表格格式"""
    print("\n搜索排行榜:")
    header = f"{'排名':>4} | {'搜索词':<20} | {'搜索人气':>15} | {'点击率':>8} | {'支付转化率':>10}"
    print(header)
    print("-" * len(header))
    for item in results[:top_n]:
        print(
            f"{item.rank:>4} | {item.keyword:<20} | "
            f"{item.search_popularity:>15} | {item.click_rate:>8} | "
            f"{item.pay_rate:>10}"
        )


def inject_report(args: list[str]) -> int:
    """inject-report 子命令：将 AI 洞察注入 HTML 报告。"""
    parser = SkillArgumentParser(
        description="将 AI 洞察注入关键词报告",
        prog="keyword_assistant inject-report",
    )
    parser.add_argument(
        "--insights_md",
        required=True,
        help="Agent 生成的 Markdown 洞察文件路径",
    )
    parser.add_argument(
        "--mode",
        choices=["expand", "rank"],
        default="expand",
        help="对应的数据获取模式（默认 expand）",
    )
    parser.add_argument(
        "--run_id",
        default="",
        help="指定 run_id（默认取该 mode 最近一次）",
    )
    parser.add_argument(
        "--seed_keyword",
        default="",
        help="expand 模式下仅报告该种子词（默认使用全部种子词）",
    )
    parsed = parser.parse_args(args)

    logging.basicConfig(
        level=logging.WARNING,
        format="[%(levelname)s] %(message)s",
        stream=sys.stderr,
    )

    from .storage import KeywordStorage

    try:
        ctx = fetch_binding_context(platform=SYCM_PLATFORM)
        with KeywordStorage(shop_key=str(ctx.get("shop_key") or "")) as store:
            raw_data = store.load_run_payload(
                mode=parsed.mode,
                run_id=parsed.run_id or None,
            )
    except Exception as e:
        emit_json({"error": f"读取缓存数据失败: {e}"})
        return EXIT_API_ERROR

    if raw_data is None:
        emit_json({
            "error": "未找到可生成报告的数据，请先运行数据获取命令",
            "hint": f"先执行 keyword_assistant --mode {parsed.mode} ...",
        })
        return EXIT_PARAM_ERROR

    if parsed.seed_keyword and parsed.mode == "expand":
        items = raw_data if isinstance(raw_data, list) else [raw_data]
        filtered = [
            item for item in items
            if item.get("seed_keyword") == parsed.seed_keyword
        ]
        if not filtered:
            emit_json({"error": f"未找到种子词 [{parsed.seed_keyword}] 的缓存数据"})
            return EXIT_PARAM_ERROR
        raw_data = filtered[0] if len(filtered) == 1 else filtered

    try:
        with open(parsed.insights_md, "r", encoding="utf-8") as f:
            insights_md = f.read()
    except OSError as e:
        emit_json({"error": f"读取 insights_md 失败: {e}"})
        return EXIT_PARAM_ERROR

    if not insights_md.strip():
        emit_json({"error": "insights_md 内容为空，请先生成 AI 洞察 Markdown"})
        return EXIT_PARAM_ERROR

    fixed_md, fixes = sanitize_insights(insights_md)
    if fixes:
        for fix in fixes:
            print(f"[AUTO-FIX] {fix}", file=sys.stderr)
        with open(parsed.insights_md, "w", encoding="utf-8") as f:
            f.write(fixed_md)
        insights_md = fixed_md

    errors = validate_insights(insights_md)
    if errors:
        for err in errors:
            print(f"[ERROR] {err}", file=sys.stderr)
        emit_json({"error": "insights_md 格式校验失败", "details": errors})
        return EXIT_PARAM_ERROR

    # 将 CLI JSON 输出转换为 report_data 格式
    report_data = _build_report_data_from_json(raw_data)

    # 生成报告
    report_path = generate_report_with_insights(report_data, insights_md)
    if not report_path:
        emit_json({"error": "报告生成失败"})
        return EXIT_API_ERROR

    # 从 JSON 数据中提取 xlsx 路径
    items = raw_data if isinstance(raw_data, list) else [raw_data]
    csv_path = ""
    for item in items:
        csv_path = item.get("csv_path", "")
        if csv_path:
            break

    result = {"report_path": report_path}
    if csv_path:
        result["csv_path"] = csv_path
    emit_json(result)
    return EXIT_SUCCESS


def _build_report_data_from_json(raw_data: dict | list) -> dict:
    """将第1次 CLI 调用的 JSON 输出转换为 report_data 格式。"""
    items = raw_data if isinstance(raw_data, list) else [raw_data]

    sections = []
    date_range = ""
    for item in items:
        if not date_range:
            dr = item.get("date_range", "")
            if dr and "|" in dr:
                start, end = dr.split("|")
                date_range = f"{start} — {end}"

        keywords = []
        for kw in item.get("top_keywords", []):
            keywords.append({
                "rank": kw.get("rank", 0),
                "keyword": kw.get("keyword", ""),
                "searchPop": str(kw.get("search_popularity", "-")),
                "ctr": _safe_float_str(kw.get("click_rate", "-")),
                "buyers": str(kw.get("pay_buyer_cnt", "-")),
                "cvr": str(kw.get("pay_conv_rate", "-")),
                "dsRatio": _safe_float_str(kw.get("demand_supply_ratio", "-")),
                "tmallCtr": _safe_float_str(kw.get("tmall_click_ratio", "-")),
            })

        sections.append({
            "seedKeyword": item.get("seed_keyword", ""),
            "totalResults": item.get("total_results", 0),
            "keywords": keywords,
        })

    return {
        "dateRange": date_range or "未知",
        "generatedAt": datetime.now().strftime("%Y-%m-%d"),
        "sections": sections,
    }


def _safe_float_str(value: str) -> float:
    """安全将字符串转为 float"""
    try:
        return float(value) if value != "-" else 0.0
    except (ValueError, TypeError):
        return 0.0


def _run_expand_mode(
    args: argparse.Namespace,
    client: SycmClient,
    date_range: str,
    logger: logging.Logger,
    *,
    shop_key: str,
) -> int:
    """执行关联词拓展模式"""
    # 获取种子关键词
    seed_keywords = args.keywords
    if not seed_keywords:
        if args.output_format != "json":
            print("[INFO] 未传入种子关键词，自动获取排行榜前 3 名作为测试...")
        seed_keywords = get_fallback_keywords(client, date_range, args.cate_id)
        if not seed_keywords:
                if args.output_format == "json":
                    emit_results([SkillOutput(
                        status="error",
                        error_code=EXIT_API_ERROR,
                        error_message="未能获取兜底关键词，请检查绑定是否有效或手动传入关键词。",
                    )])
                else:
                    print("[ERROR] 未能获取兜底关键词。")
                return EXIT_API_ERROR

    # 执行关键词拓展
    budget = TimeBudget(BATCH_TIME_BUDGET_SEC)
    all_results: dict[str, list] = {}
    for kw in seed_keywords:
        if budget.check("expand_keyword"):
            break
        results = expand_keyword(
            client, kw, date_range, args.cate_id, args.max_pages, args.order_by,
            budget=budget,
        )
        all_results[kw] = results

    # 生成 csv
    csv_path = ""
    if any(all_results.values()):
        csv_path = export_csv(all_results, date_range)

    # 输出结果
    has_failure = any(not results for results in all_results.values())

    skill_outputs: list[SkillOutput] = []
    for kw, results in all_results.items():
        top_kws = [
            {
                "rank": idx + 1,
                "keyword": r.related_keyword,
                "search_popularity": str(r.search_popularity),
                "click_rate": r.click_rate,
                "pay_buyer_cnt": str(r.pay_buyer_cnt),
                "pay_conv_rate": str(r.pay_conv_rate),
                "demand_supply_ratio": r.demand_supply_ratio,
                "tmall_click_ratio": r.tmall_click_ratio,
                "free_click_rate": r.free_click_rate,
                "search_popularity_change": r.search_popularity_change,
                "click_rate_change": r.click_rate_change,
            }
            for idx, r in enumerate(results)
        ]
        skill_outputs.append(SkillOutput(
            status="success" if results else "error",
            seed_keyword=kw,
            date_range=date_range,
            total_results=len(results),
            top_keywords=top_kws,
            csv_path=csv_path,
            error_code=EXIT_SUCCESS if results else EXIT_API_ERROR,
            error_message="" if results else f"种子词 【{kw}】 未获取到拓展词",
        ))

    from .storage import KeywordStorage

    date_type = "recent7" if "|" in date_range and (
        len(date_range.split("|")[0]) == 10
    ) else ""
    payload = [r.to_dict() for r in skill_outputs]
    run_payload = payload[0] if len(payload) == 1 else payload
    with KeywordStorage(shop_key=shop_key) as store:
        for kw, results in all_results.items():
            if results:
                store.upsert_keywords(
                    [vars(r) for r in results],
                    seed_keyword=kw,
                    date_range=date_range,
                    date_type=date_type,
                )
        store.upsert_run(
            mode="expand",
            run_id=date_range,
            payload=run_payload,
            csv_path=csv_path,
        )

    if args.output_format == "json":
        emit_results(skill_outputs)
    elif args.output_format == "table":
        for kw, results in all_results.items():
            output_table(kw, results)
    else:
        for kw, results in all_results.items():
            if results:
                output_text(kw, results)
            else:
                print(f"\n[-] 种子词 【{kw}】 未能获取到拓展词数据。")

    print_output_files(CSV=csv_path)

    return EXIT_API_ERROR if has_failure else EXIT_SUCCESS


def _run_rank_mode(
    args: argparse.Namespace,
    client: SycmClient,
    date_range: str,
    logger: logging.Logger,
    *,
    shop_key: str,
) -> int:
    """执行搜索排行榜模式"""
    budget = TimeBudget(BATCH_TIME_BUDGET_SEC)
    results = fetch_hot_rank(
        client,
        date_range,
        cate_id=args.cate_id,
        max_pages=args.max_pages,
        rank_type=args.rank_type,
        kw_type=args.kw_type,
        order_by=args.order_by,
        budget=budget,
    )

    # 生成 csv
    csv_path = ""
    if results:
        csv_path = export_rank_csv(results, date_range, args.rank_type, args.kw_type)

    rank_output = RankOutput(
        status="success" if results else "error",
        rank_type=args.rank_type,
        kw_type=args.kw_type,
        date_range=date_range,
        total_results=len(results),
        keywords=[r.to_dict() for r in results],
        csv_path=csv_path,
        error_code=EXIT_SUCCESS if results else EXIT_API_ERROR,
        error_message="" if results else "未获取到排行榜数据",
    )
    from .storage import KeywordStorage

    with KeywordStorage(shop_key=shop_key) as store:
        store.upsert_run(
            mode="rank",
            run_id=f"{args.rank_type}:{args.kw_type}:{date_range}",
            payload=rank_output.to_dict(),
            csv_path=csv_path,
        )

    if args.output_format == "json":
        emit_json(rank_output.to_dict())
    elif args.output_format == "table":
        output_rank_table(results, top_n=len(results))
    else:
        output_rank_text(results, top_n=len(results))

    print_output_files(CSV=csv_path)

    return EXIT_SUCCESS if results else EXIT_API_ERROR


def main() -> int:
    args = parse_args()
    setup_logging(args.output_format)
    logger = logging.getLogger(__name__)

    try:
        client, shop_key = get_sycm_client()
    except BindingContextError as e:
        if args.output_format == "json":
            emit_results([SkillOutput(
                status="error",
                error_code=EXIT_COOKIE_INVALID,
                error_message=e.message,
            )])
        else:
            print(f"[ERROR] {e.message}")
        return EXIT_COOKIE_INVALID

    # 2. 构建日期范围
    date_range = build_date_range(args.date_range)
    logger.info(f"查询日期范围: {date_range}")

    # 3. 按模式执行
    try:
        if args.mode == "rank":
            return _run_rank_mode(args, client, date_range, logger, shop_key=shop_key)
        return _run_expand_mode(args, client, date_range, logger, shop_key=shop_key)
    except ApiPermissionError as e:
        msg = f"当前账号无权访问该数据，请切换到有权限的账号后重试: {e.message}"
        logger.error(msg)
        if args.output_format == "json":
            emit_results([SkillOutput(
                status="error",
                error_code=EXIT_NO_PERMISSION,
                error_message=msg,
            )])
        else:
            print(f"[ERROR] {msg}")
        return EXIT_NO_PERMISSION
    except ApiSessionExpiredError as e:
        msg = f"登录态已过期，请重新登录生意参谋后重试: {e.message}"
        logger.error(msg)
        if args.output_format == "json":
            emit_results([SkillOutput(
                status="error",
                error_code=EXIT_COOKIE_INVALID,
                error_message=msg,
            )])
        else:
            print(f"[ERROR] {msg}")
        return EXIT_COOKIE_INVALID
    except (SycmApiError, SycmRequestError) as e:
        msg = str(getattr(e, "message", e))
        logger.error(msg)
        if args.output_format == "json":
            emit_results([SkillOutput(
                status="error",
                error_code=EXIT_API_ERROR,
                error_message=msg,
            )])
        else:
            print(f"[ERROR] {msg}")
        return EXIT_API_ERROR


if __name__ == "__main__":
    sys.exit(main())
