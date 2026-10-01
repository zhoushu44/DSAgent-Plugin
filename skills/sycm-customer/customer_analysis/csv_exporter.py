from __future__ import annotations

import csv
from pathlib import Path

from .types import OverviewMetric, ProfileDimension, SkillOutput

OVERVIEW_HEADERS = [
    "数据类型",
    "指标键",
    "指标名称",
    "指标值",
    "环比",
    "说明",
]

PROFILE_HEADERS = [
    "统计日期",
    "客户类型",
    "画像类型",
    "画像维度",
    "属性值",
    "店铺客户数",
    "占比",
]


def _format_metric_value(metric: OverviewMetric) -> str:
    value = metric.value
    if value is None:
        return ""
    fmt = metric.format or ","
    if isinstance(value, float):
        if ".2%" in fmt:
            return f"{value * 100:.2f}%"
        if ".2f" in fmt:
            return f"{value:,.2f}"
        if value == int(value):
            return f"{int(value):,}"
        return f"{value:,.2f}"
    if isinstance(value, int):
        return f"{value:,}"
    return str(value)


def _format_cycle_crc(value: float | None) -> str:
    if value is None:
        return ""
    return f"{value * 100:.2f}%"


def _format_ratio(value: float | None) -> str:
    if value is None:
        return ""
    return f"{value * 100:.2f}%"


def export_csv(result: SkillOutput, output_path: Path) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(["# 客户概览"])
        writer.writerow(OVERVIEW_HEADERS)
        for group_key, group_label, metric_keys in _overview_groups():
            for metric_key in metric_keys:
                raw = (result.overview or {}).get(metric_key)
                if not raw:
                    continue
                metric = OverviewMetric(**raw) if isinstance(raw, dict) else raw
                writer.writerow([
                    group_label,
                    metric.key,
                    metric.label,
                    _format_metric_value(metric),
                    _format_cycle_crc(metric.cycle_crc),
                    metric.explanation,
                ])

        writer.writerow([])
        writer.writerow(["# 客户画像"])
        writer.writerow(PROFILE_HEADERS)
        for dimension in result.profiles or []:
            crowd_label = str(dimension.get("crowd_label") or dimension.get("crowd_type") or "")
            kind_label = str(dimension.get("profile_kind_label") or dimension.get("profile_kind") or "")
            attr_label = str(dimension.get("attribute_label") or dimension.get("attribute_name") or "")
            for row in dimension.get("rows") or []:
                writer.writerow([
                    result.stat_date,
                    crowd_label,
                    kind_label,
                    attr_label,
                    row.get("attr_value") or "",
                    row.get("shop_customer_cnt") or 0,
                    _format_ratio(row.get("ratio")),
                ])
    return str(output_path)


def _overview_groups():
    from .config import OVERVIEW_GROUPS

    return OVERVIEW_GROUPS
