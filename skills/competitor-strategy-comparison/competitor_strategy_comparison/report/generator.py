"""生成供大模型分析与排版的业务 Markdown；不内置固定 HTML。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..parse import (
    active_channels,
    audience_rows,
    keyword_rows,
    metric_rows,
    opened_plans,
    promotion_rows,
    strategy_rows,
)
from .insights import report_scope


def write_business_report(result: dict[str, Any], path: Path) -> None:
    scope = report_scope(result)
    period = result["period"]
    lines = [
        "# 竞品策略对比",
        "",
        f"- 本品：{scope['own_name']}（{scope['own_id']}）",
        f"- 竞品：{scope['competitor_name']}（{scope['competitor_id']}）",
        f"- 时间：{period['start_date']} 至 {period['end_date']}（{period['day_count']}天）",
        "- 口径：所有结论仅代表上述周期累计表现，不代表其他周期的投放历史。",
        "",
        "## 核心经营数据",
        "",
        "| 指标 | 本品 | 竞品 | 差异 |",
        "|---|---:|---:|---:|",
    ]
    for row in metric_rows(result.get("key_metrics")):
        lines.append("| " + " | ".join(row) + " |")

    lines += [
        "",
        "## 人群经营数据",
        "",
        "| 人群类型 | 本品人数 | 竞品人数 | 本品成交订单数 | 竞品成交订单数 | 本品支付转化率 | 竞品支付转化率 | 本品收藏加购率 | 竞品收藏加购率 |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    audience = audience_rows(result.get("audience_comparison"))
    if audience:
        lines.extend("| " + " | ".join(row) + " |" for row in audience)
    else:
        lines.append("| 本周期未返回可确认的人群数据 | - | - | - | - | - | - | - | - |")

    promotion = result.get("promotion_strategy")
    lines += [
        "",
        "## 推广渠道数据",
        "",
        "| 推广场景 | 本品消耗 | 竞品消耗 | 本品消耗占比 | 竞品消耗占比 | 本品点击率 | 竞品点击率 | 本品直接ROI | 竞品直接ROI |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    channels = promotion_rows(promotion)
    if channels:
        lines.extend("| " + " | ".join(row) + " |" for row in channels)
    else:
        lines.append("| 本周期未返回可确认的推广渠道数据 | - | - | - | - | - | - | - | - |")

    plans = strategy_rows(promotion)
    if plans:
        lines += [
            "",
            "### 场景投放策略明细",
            "",
            "| 一级场景 | 投放方案 | 本品 | 竞品 |",
            "|---|---|---|---|",
        ]
        lines.extend("| " + " | ".join(row) + " |" for row in plans)

    lines += ["", "### 已开启的计划", ""]
    own_plans = opened_plans(promotion, "own")
    competitor_plans = opened_plans(promotion, "competitor")
    lines.append("- 本品：" + ("；".join(own_plans) if own_plans else "本周期未返回可确认的计划"))
    lines.append("- 竞品：" + ("；".join(competitor_plans) if competitor_plans else "本周期未返回可确认的计划"))

    lines += ["", "### 竞品实际投放渠道", ""]
    competitor_channels = active_channels(promotion, "competitor")
    lines.append("- " + ("；".join(competitor_channels) if competitor_channels else "本周期未返回可确认的渠道消耗"))

    lines += ["", "### TOP关键词", ""]
    for label, side in (("本品", "own"), ("竞品", "competitor")):
        rows = keyword_rows(promotion, side)
        lines += [f"#### {label}", ""]
        if not rows:
            lines += ["- 本周期未返回可确认的TOP关键词。", ""]
            continue
        lines += [
            "| 关键词 | 类型 | 展现 | 点击 | 点击率 | 转化率 |",
            "|---|---|---:|---:|---:|---:|",
        ]
        lines.extend("| " + " | ".join(row) + " |" for row in rows)
        lines.append("")

    if isinstance(promotion, dict) and promotion.get("scene_errors"):
        lines.append("- 有部分场景本次未取得明细，不能据此判断未投放。")
    if result.get("module_errors"):
        lines += ["", "## 数据限制", "", "- 本次有部分数据未取得，请在分析时保留该限制。"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
