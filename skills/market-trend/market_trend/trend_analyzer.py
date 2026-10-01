"""市场排行趋势分析 — 数据聚合与趋势分析

移植自浏览器扩展 trendApiService.ts 的 aggregateWeeksData + analyzeTrend。
"""

from .config import RANK_TYPE_CONFIGS
from .types import MarketRankItem, PeriodData, TrendItem

# 指标字段名 → MarketRankItem 属性名
_FIELD_TO_ATTR = {
    "payByrCnt": "pay_byr_cnt",
    "uv": "uv",
    "searchUv": "search_uv",
    "cartByrCnt": "cart_byr_cnt",
    "cltByrCnt": "clt_byr_cnt",
}


def _get_metric_value(item: MarketRankItem, field: str) -> str:
    """获取指标值"""
    attr = _FIELD_TO_ATTR.get(field, field)
    return getattr(item, attr, "")


def _analyze_trend(ranks: dict) -> tuple[str, int | None, int | None]:
    """分析趋势类型。

    Args:
        ranks: {"period1": rank_or_None, "period2": ..., "period3": ..., "period4": ...}

    Returns:
        (trend, rank_change, first_appear_period)
        trend: "up" | "down" | "stable" | "new" | "drop"
    """
    rank_values = [ranks.get(f"period{i}") for i in range(1, 5)]
    valid_ranks = [r for r in rank_values if r is not None]

    # 找到首次上榜周期
    first_appear: int | None = None
    for i, r in enumerate(rank_values):
        if r is not None:
            first_appear = i + 1
            break

    # 当前周期（period4）未上榜
    if rank_values[3] is None:
        if valid_ranks:
            return "drop", None, first_appear
        return "drop", None, None

    # 当前周期上榜
    if len(valid_ranks) == 1:
        return "new", None, 4

    # 计算排名变化（第一个有效排名 vs 当前排名）
    first_valid_rank = valid_ranks[0]
    current_rank = rank_values[3]
    rank_change = current_rank - first_valid_rank

    if rank_change < 0:
        return "up", rank_change, first_appear
    if rank_change > 0:
        return "down", rank_change, first_appear
    return "stable", 0, first_appear


def aggregate_periods_data(
    periods: list[PeriodData],
    rank_type: str = "gmv",
) -> list[TrendItem]:
    """将 4 个周期的数据按 itemId 聚合，分析趋势。

    Args:
        periods: 4 个周期的 PeriodData
        rank_type: 榜单类型

    Returns:
        排序后的 TrendItem 列表
    """
    config = RANK_TYPE_CONFIGS[rank_type]
    item_map: dict[str, TrendItem] = {}

    for period in periods:
        period_key = f"period{period.period_index + 1}"

        for dto in period.items:
            if not dto.item_id:
                continue

            if dto.item_id not in item_map:
                item_map[dto.item_id] = TrendItem(
                    item_id=dto.item_id,
                    title=dto.title,
                    pict_url=dto.pict_url,
                    detail_url=dto.detail_url,
                    shop_title=dto.shop_title,
                    is_tmall=dto.is_tmall,
                    shop_url=dto.shop_url,
                    ranks={f"period{i}": None for i in range(1, 5)},
                    weekly_metrics={f"period{i}": {} for i in range(1, 5)},
                )

            item = item_map[dto.item_id]
            item.ranks[period_key] = dto.rank

            # 收集各指标
            metrics = {}
            for metric_cfg in config["metrics"]:
                field = metric_cfg["field"]
                metrics[field] = _get_metric_value(dto, field)
            item.weekly_metrics[period_key] = metrics

            # 最后一个周期的数据作为当前值
            if period.period_index == 3:
                item.core_keyword = dto.core_keyword
                item.current_rank = dto.rank

    # 分析趋势
    items = list(item_map.values())
    for item in items:
        trend, rank_change, first_appear = _analyze_trend(item.ranks)
        item.trend = trend
        item.rank_change = rank_change
        item.first_appear_period = first_appear

    # 排序：按当前排名升序，未上榜放最后
    items.sort(key=lambda x: (x.current_rank is None, x.current_rank or 0))

    return items


def compute_summary(trend_items: list[TrendItem]) -> dict:
    """计算趋势统计摘要"""
    summary = {
        "total": len(trend_items),
        "rising_count": 0,
        "falling_count": 0,
        "new_count": 0,
        "dropped_count": 0,
        "stable_count": 0,
        "continuously_rising": 0,
    }

    for item in trend_items:
        if item.trend == "up":
            summary["rising_count"] += 1
        elif item.trend == "down":
            summary["falling_count"] += 1
        elif item.trend == "new":
            summary["new_count"] += 1
        elif item.trend == "drop":
            summary["dropped_count"] += 1
        elif item.trend == "stable":
            summary["stable_count"] += 1

        # 检查连续上涨
        if _is_continuously_rising(item.ranks):
            summary["continuously_rising"] += 1

    return summary


def _is_continuously_rising(ranks: dict) -> bool:
    """判断是否连续 4 周期排名上升（数值严格变小）"""
    rank_values = [ranks.get(f"period{i}") for i in range(1, 5)]

    # 找到首次上榜
    first_valid_idx = None
    for i, r in enumerate(rank_values):
        if r is not None:
            first_valid_idx = i
            break

    if first_valid_idx is None:
        return False

    prev_rank = None
    for i in range(first_valid_idx, 4):
        current = rank_values[i]
        if current is None:
            return False
        if prev_rank is not None and prev_rank <= current:
            return False
        prev_rank = current

    return True
