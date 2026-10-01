"""关键词流量趋势数据分析。"""

from __future__ import annotations

from statistics import mean, median
from typing import Any, Sequence


def _parse_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    text = text.rstrip("%")
    try:
        return float(text)
    except ValueError:
        return None


def _format_number(value: float | None, *, digits: int = 0) -> str:
    if value is None:
        return "-"
    if digits == 0 and float(value).is_integer():
        return f"{int(value):,}"
    return f"{value:,.{digits}f}"


def _format_percent(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value:.2f}%"


def _metric_values(trend_data: Sequence[dict], field: str) -> list[float]:
    values: list[float] = []
    for row in trend_data:
        parsed = _parse_number(row.get(field))
        if parsed is not None:
            values.append(parsed)
    return values


def _slice_recent(values: list[float], days: int) -> list[float]:
    if not values:
        return []
    return values[-days:]


def _change_rate(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None or previous == 0:
        return None
    return (current - previous) / previous


def _trend_label(change: float | None) -> str:
    if change is None:
        return "持平"
    if change >= 0.08:
        return "明显上升"
    if change >= 0.02:
        return "小幅上升"
    if change <= -0.08:
        return "明显下降"
    if change <= -0.02:
        return "小幅下降"
    return "基本平稳"


def _peak_info(trend_data: Sequence[dict], field: str) -> dict[str, Any]:
    best_date = ""
    best_value: float | None = None
    for row in trend_data:
        value = _parse_number(row.get(field))
        if value is None:
            continue
        if best_value is None or value > best_value:
            best_value = value
            best_date = str(row.get("date", ""))
    return {"date": best_date, "value": best_value}


def build_trend_analysis(
    keyword: str,
    trend_data: Sequence[dict],
    *,
    months: int = 13,
) -> dict[str, Any]:
    """基于日趋势数据生成概览指标与文字洞察。"""
    if not trend_data:
        return {
            "overview": {},
            "insights": ["当前没有可分析的趋势数据。"],
            "recent_changes": {},
        }

    metrics = {
        "impression_index": "展现指数",
        "click_index": "点击指数",
        "ctr": "点击率",
        "cvr": "点击转化率",
        "competition_index": "竞争指数",
        "avg_price": "市场均价",
    }

    overview: dict[str, Any] = {
        "total_days": len(trend_data),
        "months": months,
        "date_start": trend_data[0].get("date", ""),
        "date_end": trend_data[-1].get("date", ""),
    }

    metric_stats: dict[str, Any] = {}
    for field, label in metrics.items():
        values = _metric_values(trend_data, field)
        recent_7 = _slice_recent(values, 7)
        recent_30 = _slice_recent(values, 30)
        metric_stats[field] = {
            "label": label,
            "avg": mean(values) if values else None,
            "median": median(values) if values else None,
            "max": max(values) if values else None,
            "min": min(values) if values else None,
            "recent_7_avg": mean(recent_7) if recent_7 else None,
            "recent_30_avg": mean(recent_30) if recent_30 else None,
            "peak": _peak_info(trend_data, field),
        }
    overview["metrics"] = metric_stats

    recent_changes: dict[str, Any] = {}
    for field, label in metrics.items():
        values = _metric_values(trend_data, field)
        recent_7 = _slice_recent(values, 7)
        previous_7 = values[-14:-7] if len(values) >= 14 else []
        recent_30 = _slice_recent(values, 30)
        previous_30 = values[-60:-30] if len(values) >= 60 else []

        change_7 = _change_rate(
            mean(recent_7) if recent_7 else None,
            mean(previous_7) if previous_7 else None,
        )
        change_30 = _change_rate(
            mean(recent_30) if recent_30 else None,
            mean(previous_30) if previous_30 else None,
        )
        recent_changes[field] = {
            "label": label,
            "change_7d": change_7,
            "change_30d": change_30,
            "trend_7d": _trend_label(change_7),
            "trend_30d": _trend_label(change_30),
        }

    insights: list[str] = []
    impression = metric_stats["impression_index"]
    click = metric_stats["click_index"]
    competition = metric_stats["competition_index"]
    avg_price = metric_stats["avg_price"]
    ctr = metric_stats["ctr"]
    cvr = metric_stats["cvr"]

    insights.append(
        f"样本覆盖 {overview['date_start']} 至 {overview['date_end']}，共 {overview['total_days']} 天，"
        f"对应约 {months} 个月的关键词流量趋势。"
    )
    insights.append(
        f"全周期展现指数均值 {_format_number(impression['avg'])}，"
        f"点击指数均值 {_format_number(click['avg'])}，"
        f"竞争指数均值 {_format_number(competition['avg'])}。"
    )

    imp_change = recent_changes["impression_index"]["change_7d"]
    if imp_change is not None:
        insights.append(
            f"近 7 日展现指数较前一周期 {recent_changes['impression_index']['trend_7d']}，"
            f"变化幅度约 {_format_percent(imp_change * 100)}。"
        )

    comp_change = recent_changes["competition_index"]["change_30d"]
    if comp_change is not None:
        insights.append(
            f"近 30 日竞争指数较前一周期 {recent_changes['competition_index']['trend_30d']}，"
            f"变化幅度约 {_format_percent(comp_change * 100)}。"
        )

    if impression["peak"]["date"]:
        insights.append(
            f"展现指数峰值出现在 {impression['peak']['date']}，"
            f"数值约 {_format_number(impression['peak']['value'])}。"
        )

    if avg_price["recent_7_avg"] is not None:
        insights.append(
            f"近 7 日市场均价均值约 {_format_number(avg_price['recent_7_avg'], digits=2)}，"
            f"CTR 均值 {_format_percent(ctr['recent_7_avg'])}，"
            f"CVR 均值 {_format_percent(cvr['recent_7_avg'])}。"
        )

    return {
        "keyword": keyword,
        "overview": overview,
        "insights": insights,
        "recent_changes": recent_changes,
    }


SUMMARY_FIELD_LABELS = {
    "keyword_trait": "词的特性",
    "traffic_trend": "流量趋势",
    "traffic_trend_tag": "流量趋势标签",
    "competition": "竞争情况",
    "competition_tag": "竞争标签",
    "audience": "人群特征",
    "geography": "地域特征",
    "time_pattern": "时间特征",
}


def normalize_summary_cards(summary: dict[str, Any]) -> list[dict[str, str]]:
    cards: list[dict[str, str]] = []
    for key, label in SUMMARY_FIELD_LABELS.items():
        if key.endswith("_tag"):
            continue
        content = str(summary.get(key, "") or "").strip()
        if not content:
            continue
        tag_key = f"{key}_tag" if f"{key}_tag" in SUMMARY_FIELD_LABELS else ""
        tag = str(summary.get(tag_key, "") or "").strip() if tag_key else ""
        cards.append({"title": label, "content": content, "tag": tag})
    return cards
