from __future__ import annotations

import json
from html import escape
from pathlib import Path
from typing import Any

from .conversion_analyzer import generate_conversion_analysis_html
from .csv_exporter import _format_metric_value, _format_ratio
from .config import HIDDEN_PROFILE_ATTRIBUTES, PIE_CHART_ATTRIBUTES, CROWD_EXTRA_DISPLAY_ATTRIBUTES
from .types import OverviewMetric, SkillOutput

# 概览分群：group_key -> crowd_type
OVERVIEW_SEGMENT_MAP: tuple[tuple[str, str, str], ...] = (
    ("newVisitor", "new_crowd", "客户新访"),
    ("noPurchase", "unpur_crowd", "未购客户回访"),
    ("hasPurchase", "purch_crowd", "已购客户回访"),
)

SEGMENT_CARD_LAYOUT: dict[str, dict[str, str]] = {
    "new_crowd": {
        "title": "客户新访",
        "main": "newVisitorCnt",
        "left_key": "newVisitorBuyCnt",
        "left_label": "新访成交",
        "right_key": "newVisitorInShopCnt",
        "right_label": "新访未成交",
        "fans": "newVisitorFansRate",
        "vip": "newVisitorVipRate",
        "pay_rate": "newVisitorPayRate",
        "pay_amt_ratio": "newVisitorPayAmtRatio",
        "avg_order": "newVisitorPct",
        "recall": "newVisitorReCall",
        "recall_text": "平台客户 | 潜在客户 召回率",
    },
    "unpur_crowd": {
        "title": "未购客户回访",
        "main": "noPurchaseCnt",
        "left_key": "noPurchaseBuyCnt",
        "left_label": "回访成交",
        "right_key": "noBuyInShopCnt",
        "right_label": "回访未成交",
        "fans": "noPurchaseFansRate",
        "vip": "noPurchaseVipRate",
        "pay_rate": "noPurchasePayRate",
        "pay_amt_ratio": "noPurchasePayAmtRatio",
        "avg_order": "noPurchasePct",
        "recall": "noPurchaseReCall",
        "recall_text": "未购客户 召回率",
    },
    "purch_crowd": {
        "title": "已购客户回访",
        "main": "hasPurchaseCnt",
        "left_key": "hasPurchaseUbyCnt",
        "left_label": "老客复购",
        "right_key": "hasBuyInShopCnt",
        "right_label": "老客未复购",
        "fans": "hasPurchaseFansRate",
        "vip": "hasPurchaseVipRate",
        "pay_rate": "hasPurchasePayRate",
        "pay_amt_ratio": "hasPurchasePayAmtRatio",
        "avg_order": "hasPurchasePct",
        "recall": "hasPurchaseReCall",
        "recall_text": "已购客户 召回率",
    },
}


def generate_customer_report(result: SkillOutput, output_path: Path) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(_build_html(result), encoding="utf-8")
    return str(output_path)


def _metric_from_dict(raw: dict[str, Any]) -> OverviewMetric:
    return OverviewMetric(
        key=str(raw.get("key") or ""),
        label=str(raw.get("label") or ""),
        value=raw.get("value"),
        cycle_crc=raw.get("cycle_crc"),
        explanation=str(raw.get("explanation") or ""),
        format=str(raw.get("format") or ","),
    )


def _yoy_class(value: float | None) -> str:
    if value is None:
        return "flat"
    if value > 0:
        return "up"
    if value < 0:
        return "down"
    return "flat"


def _yoy_text(value: float | None) -> str:
    if value is None:
        return "环比 —"
    prefix = "+" if value > 0 else ""
    return f"环比 {prefix}{value * 100:.2f}%"


def _get_metric(overview: dict[str, Any], key: str) -> OverviewMetric:
    raw = overview.get(key)
    if not raw or not isinstance(raw, dict):
        return OverviewMetric(key=key)
    return _metric_from_dict(raw)


def _fmt_count_metric(metric: OverviewMetric) -> str:
    if metric.value is None:
        return "—"
    return _format_metric_value(metric)


def _fmt_percent_metric(metric: OverviewMetric) -> str:
    if metric.value is None:
        return "—"
    value = float(metric.value)
    fmt = metric.format or ""
    if ".2%" in fmt or abs(value) <= 1.5:
        return f"{value * 100:.2f}%"
    return _format_metric_value(metric)


def _fmt_price_metric(metric: OverviewMetric) -> str:
    if metric.value is None:
        return "—"
    return f"{float(metric.value):,.2f}"


def _mini_rate_bar(label: str, metric: OverviewMetric) -> str:
    pct = max(0.0, min(100.0, float(metric.value or 0) * 100))
    return (
        f'<div class="rate-mini">'
        f'<span class="rate-mini-label">{escape(label)}</span>'
        f'<div class="rate-mini-track"><div class="rate-mini-fill" style="width:{pct:.1f}%"></div></div>'
        f'</div>'
    )


def _split_box(label: str, metric: OverviewMetric) -> str:
    return (
        f'<div class="split-box">'
        f'<div class="split-box-label">{escape(label)}</div>'
        f'<div class="split-box-value">{escape(_fmt_count_metric(metric))}</div>'
        f'</div>'
    )


def _segment_card_html(overview: dict[str, Any], crowd_type: str) -> str:
    cfg = SEGMENT_CARD_LAYOUT[crowd_type]
    main = _get_metric(overview, cfg["main"])
    left = _get_metric(overview, cfg["left_key"])
    right = _get_metric(overview, cfg["right_key"])
    recall = _get_metric(overview, cfg["recall"])

    return (
        f'<div class="segment-card">'
        f'<div class="segment-card-head">'
        f'<div class="segment-card-title">{escape(cfg["title"])}</div>'
        f'<div class="segment-card-rates">'
        f'{_mini_rate_bar("粉丝", _get_metric(overview, cfg["fans"]))}'
        f'{_mini_rate_bar("会员", _get_metric(overview, cfg["vip"]))}'
        f'</div>'
        f'</div>'
        f'<div class="segment-main-value">{escape(_fmt_count_metric(main))}</div>'
        f'<div class="segment-split-row">'
        f'{_split_box(cfg["left_label"], left)}'
        f'<div class="split-union"><span>并集</span></div>'
        f'{_split_box(cfg["right_label"], right)}'
        f'</div>'
        f'<div class="segment-kpi-row">'
        f'<div class="segment-kpi"><div class="segment-kpi-label">支付转化率</div>'
        f'<div class="segment-kpi-value">{escape(_fmt_percent_metric(_get_metric(overview, cfg["pay_rate"])))}</div></div>'
        f'<div class="segment-kpi"><div class="segment-kpi-label">支付金额占比</div>'
        f'<div class="segment-kpi-value">{escape(_fmt_percent_metric(_get_metric(overview, cfg["pay_amt_ratio"])))}</div></div>'
        f'<div class="segment-kpi"><div class="segment-kpi-label">客单价</div>'
        f'<div class="segment-kpi-value">{escape(_fmt_price_metric(_get_metric(overview, cfg["avg_order"])))}</div></div>'
        f'</div>'
        f'</div>'
        f'<div class="segment-recall-footer">'
        f'<span class="recall-arrow">↑</span>'
        f'<span>{escape(cfg["recall_text"])} <strong>{escape(_fmt_percent_metric(recall))}</strong></span>'
        f'</div>'
    )


def _shop_total_html(overview: dict[str, Any]) -> str:
    shop = _get_metric(overview, "shopCustomer")
    new_cnt = _fmt_count_metric(_get_metric(overview, "newVisitorCnt"))
    unpur_cnt = _fmt_count_metric(_get_metric(overview, "noPurchaseCnt"))
    purch_cnt = _fmt_count_metric(_get_metric(overview, "hasPurchaseCnt"))
    yoy_text = _yoy_text(shop.cycle_crc)
    yoy_cls = _yoy_class(shop.cycle_crc)
    return (
        f'<div class="shop-total-card">'
        f'<a href="#customer-profile" class="profile-link">画像 &gt;</a>'
        f'<div class="shop-total-body">'
        f'<div class="shop-total-icon" aria-hidden="true">'
        f'<svg viewBox="0 0 48 48" width="32" height="32"><circle cx="24" cy="16" r="8" fill="#93c5fd"/>'
        f'<path d="M8 42c0-8.8 7.2-16 16-16s16 7.2 16 16" fill="#60a5fa"/></svg>'
        f'</div>'
        f'<div class="shop-total-main">'
        f'<div class="shop-total-label">店铺客户数</div>'
        f'<div class="shop-total-metrics">'
        f'<div class="shop-total-value">{escape(_fmt_count_metric(shop))}</div>'
        f'<div class="metric-yoy {yoy_cls}">{escape(yoy_text)}</div>'
        f'</div>'
        f'<div class="shop-sum-hint muted">新访 {escape(new_cnt)} + 未购回访 {escape(unpur_cnt)} + 已购回访 {escape(purch_cnt)}</div>'
        f'</div>'
        f'</div>'
        f'</div>'
    )


def _overview_section(result: SkillOutput) -> str:
    overview = result.overview or {}
    columns: list[str] = []
    crowd_items = [
        (crowd_type, _label)
        for _group_key, crowd_type, _label in OVERVIEW_SEGMENT_MAP
        if crowd_type in SEGMENT_CARD_LAYOUT
    ]

    for index, (crowd_type, _label) in enumerate(crowd_items):
        columns.append(
            f'<div class="segment-card-col">{_segment_card_html(overview, crowd_type)}</div>'
        )
        if index < len(crowd_items) - 1:
            columns.append(
                '<div class="segment-union-between" aria-hidden="true"><span>并集</span></div>'
            )

    if not columns:
        return ""

    return (
        f'<section class="panel segment-overview-panel">'
        f'{_shop_total_html(overview)}'
        f'<h2 class="segment-overview-title">客户分群概览</h2>'
        f'<div class="segment-cards-row">{"".join(columns)}</div>'
        f'</section>'
    )


CHART_PALETTE: tuple[str, ...] = (
    "#7c9fd4",
    "#7fb095",
    "#d4a06a",
    "#a08bc4",
    "#c47a7a",
    "#6baab8",
    "#c48aa8",
    "#b8a56e",
    "#8894c4",
    "#6da896",
    "#d4956a",
    "#9a8bc4",
)


def _contrast_text(hex_color: str) -> str:
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return "#ffffff" if luminance < 0.55 else "#1e293b"


def _chart_color(index: int) -> tuple[str, str]:
    """按序号返回图表色与对比文字色。"""
    bg = CHART_PALETTE[index % len(CHART_PALETTE)]
    return bg, _contrast_text(bg)


def _row_share(item: dict[str, Any], total_cnt: float) -> float:
    ratio = item.get("ratio")
    if ratio is not None:
        return max(0.0, float(ratio))
    cnt = float(item.get("shop_customer_cnt") or 0)
    return cnt / total_cnt if total_cnt > 0 else 0.0


def _bar_chart_html(rows_sorted: list[dict[str, Any]]) -> str:
    max_cnt = max(float(item.get("shop_customer_cnt") or 0) for item in rows_sorted) or 1

    chart_rows: list[str] = []
    for rank, item in enumerate(rows_sorted):
        cnt = float(item.get("shop_customer_cnt") or 0)
        ratio = item.get("ratio")
        width = max(8, int(cnt / max_cnt * 100))
        name = str(item.get("attr_value") or "")
        count_text = f"{cnt:,.0f}"
        ratio_text = _format_ratio(ratio)
        bg_color, text_color = _chart_color(rank)
        chart_rows.append(
            f'<div class="bar-row">'
            f'<div class="bar-label" title="{escape(name)}">{escape(name)}</div>'
            f'<div class="bar-track">'
            f'<div class="bar-fill" style="width:{width}%;background:{bg_color}">'
            f'<span class="bar-fill-text" style="color:{text_color}">{escape(count_text)}</span>'
            f'</div>'
            f'</div>'
            f'<div class="bar-value">{escape(ratio_text)}</div>'
            f'</div>'
        )
    return f'<div class="bar-chart">{"".join(chart_rows)}</div>'


def _pie_chart_html(rows_sorted: list[dict[str, Any]]) -> str:
    total_cnt = sum(float(item.get("shop_customer_cnt") or 0) for item in rows_sorted) or 1.0
    segments: list[str] = []
    legend_items: list[str] = []
    start_pct = 0.0

    for idx, item in enumerate(rows_sorted):
        share = _row_share(item, total_cnt)
        end_pct = start_pct + share * 100
        color = CHART_PALETTE[idx % len(CHART_PALETTE)]
        if share > 0:
            segments.append(f"{color} {start_pct:.4f}% {end_pct:.4f}%")
        name = str(item.get("attr_value") or "")
        cnt = float(item.get("shop_customer_cnt") or 0)
        ratio_text = _format_ratio(item.get("ratio") if item.get("ratio") is not None else share)
        legend_items.append(
            f'<li class="pie-legend-item">'
            f'<span class="pie-legend-dot" style="background:{color}"></span>'
            f'<span class="pie-legend-name" title="{escape(name)}">{escape(name)}</span>'
            f'<span class="pie-legend-count">{cnt:,.0f}</span>'
            f'<span class="pie-legend-pct">{escape(ratio_text)}</span>'
            f'</li>'
        )
        start_pct = end_pct

    gradient = ", ".join(segments) if segments else "#e2e8f0 0% 100%"
    return (
        f'<div class="pie-chart-wrap">'
        f'<div class="pie-chart" style="background:conic-gradient(from -90deg, {gradient})"></div>'
        f'<ul class="pie-legend">{"".join(legend_items)}</ul>'
        f'</div>'
    )


def _is_visible_dimension(dimension: dict[str, Any]) -> bool:
    attr_name = str(dimension.get("attribute_name") or "")
    return attr_name not in HIDDEN_PROFILE_ATTRIBUTES


def _dimension_block_html(dimension: dict[str, Any]) -> str:
    if not _is_visible_dimension(dimension):
        return ""
    attr_name = str(dimension.get("attribute_name") or "")
    attr_label = str(dimension.get("attribute_label") or dimension.get("attribute_name") or "画像")
    rows = list(dimension.get("rows") or [])
    if not rows:
        return ""
    rows_sorted = sorted(rows, key=lambda item: float(item.get("shop_customer_cnt") or 0), reverse=True)

    if attr_name in PIE_CHART_ATTRIBUTES:
        chart_html = _pie_chart_html(rows_sorted)
        chart_class = "profile-dimension profile-dimension--pie"
    else:
        chart_html = _bar_chart_html(rows_sorted)
        chart_class = "profile-dimension"

    return (
        f'<div class="{chart_class}">'
        f'<h4>{escape(attr_label)}</h4>'
        f'{chart_html}'
        f'</div>'
    )


def _sorted_dimension_rows(dimension: dict[str, Any]) -> list[dict[str, Any]]:
    rows = list(dimension.get("rows") or [])
    return sorted(rows, key=lambda item: float(item.get("shop_customer_cnt") or 0), reverse=True)


def _gender_age_combo_html(gender_dim: dict[str, Any], age_dim: dict[str, Any]) -> str:
    gender_rows = _sorted_dimension_rows(gender_dim)
    age_rows = _sorted_dimension_rows(age_dim)
    if not gender_rows and not age_rows:
        return ""

    parts: list[str] = []
    if gender_rows:
        parts.append(
            f'<div class="combo-chart-item">'
            f'<h4>性别</h4>'
            f'{_pie_chart_html(gender_rows)}'
            f'</div>'
        )
    if age_rows:
        parts.append(
            f'<div class="combo-chart-item">'
            f'<h4>年龄</h4>'
            f'{_pie_chart_html(age_rows)}'
            f'</div>'
        )
    return (
        f'<div class="profile-dimension profile-dimension--combo">'
        f'<div class="combo-charts">{"".join(parts)}</div>'
        f'</div>'
    )


def _combo_bar_item(label: str, dimension: dict[str, Any]) -> str:
    rows = _sorted_dimension_rows(dimension)
    if not rows:
        return ""
    return (
        f'<div class="combo-chart-item combo-chart-item--bar">'
        f'<h4>{escape(label)}</h4>'
        f'{_bar_chart_html(rows)}'
        f'</div>'
    )


def _geo_interest_combo_html(
    interest_dim: dict[str, Any] | None,
    province_dim: dict[str, Any] | None,
    city_dim: dict[str, Any] | None,
) -> str:
    parts: list[str] = []
    if interest_dim:
        parts.append(_combo_bar_item("兴趣爱好", interest_dim))
    if province_dim:
        parts.append(_combo_bar_item("省份", province_dim))
    if city_dim:
        parts.append(_combo_bar_item("城市", city_dim))
    if not parts:
        return ""
    return (
        f'<div class="profile-dimension profile-dimension--combo profile-dimension--combo-triple">'
        f'<div class="combo-charts combo-charts--triple">{"".join(parts)}</div>'
        f'</div>'
    )


def _dimension_blocks_for_crowd(crowd_dims: list[dict[str, Any]]) -> list[str]:
    by_name = {str(dimension.get("attribute_name") or ""): dimension for dimension in crowd_dims}
    gender_dim = by_name.get("gender")
    age_dim = by_name.get("age")
    interest_dim = by_name.get("interest")
    province_dim = by_name.get("province")
    city_dim = by_name.get("city")
    merge_gender_age = bool(gender_dim and age_dim)
    merge_geo_interest = bool(interest_dim or province_dim or city_dim)
    gender_age_added = False
    geo_interest_added = False
    blocks: list[str] = []

    for dimension in crowd_dims:
        name = str(dimension.get("attribute_name") or "")
        if merge_gender_age and name in {"gender", "age"}:
            if not gender_age_added:
                combo = _gender_age_combo_html(gender_dim, age_dim)
                if combo:
                    blocks.append(combo)
                gender_age_added = True
            continue
        if merge_geo_interest and name in {"interest", "province", "city"}:
            if not geo_interest_added:
                combo = _geo_interest_combo_html(interest_dim, province_dim, city_dim)
                if combo:
                    blocks.append(combo)
                geo_interest_added = True
            continue
        block = _dimension_block_html(dimension)
        if block:
            blocks.append(block)

    return blocks


def _dimension_grid_html(dim_blocks: list[str]) -> str:
    blocks = [block for block in dim_blocks if block]
    if not blocks:
        return ""
    return f'<div class="profile-dimension-grid">{"".join(blocks)}</div>'


def _profile_source_header_html(*, title: str, hint: str = "") -> str:
    hint_html = f'<p class="muted kind-hint">{escape(hint)}</p>' if hint else ""
    return (
        f'<div class="profile-source-header">'
        f'<h3 class="profile-source-title">{escape(title)}</h3>'
        f'{hint_html}'
        f'</div>'
    )


def _summary_profile_dims(
    profiles: list[dict[str, Any]],
    *,
    crowd_type: str,
) -> list[dict[str, Any]]:
    dims = [
        dimension for dimension in profiles
        if str(dimension.get("crowd_type") or "") == crowd_type
        and str(dimension.get("profile_kind") or "summary") == "summary"
        and _is_visible_dimension(dimension)
    ]
    extra_dims = [
        dimension for dimension in profiles
        if str(dimension.get("crowd_type") or "") == crowd_type
        and str(dimension.get("profile_kind") or "") == "detail"
        and str(dimension.get("attribute_name") or "") in CROWD_EXTRA_DISPLAY_ATTRIBUTES
        and _is_visible_dimension(dimension)
    ]
    if not extra_dims:
        return dims

    present = {str(dimension.get("attribute_name") or "") for dimension in dims}
    for dimension in extra_dims:
        name = str(dimension.get("attribute_name") or "")
        if name not in present:
            dims.append(dimension)
    return dims


def _swap_interest_purchase_power(dims: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """消费层级与兴趣爱好卡片互换位置。"""
    indices = {
        str(dimension.get("attribute_name") or ""): index
        for index, dimension in enumerate(dims)
    }
    interest_idx = indices.get("interest")
    purchase_idx = indices.get("purchase_power")
    if interest_idx is None or purchase_idx is None:
        return dims
    swapped = list(dims)
    swapped[interest_idx], swapped[purchase_idx] = swapped[purchase_idx], swapped[interest_idx]
    return swapped


DEFAULT_PROFILE_CROWD = "shop_crowd"

PROFILE_CROWD_OPTIONS: tuple[tuple[str, str, str, str], ...] = (
    (
        "shop_crowd",
        "店铺客户",
        "店铺客户汇总画像",
        "由客户新访、未购客户回访、已购客户回访三类人群汇总整理而成的店铺画像",
    ),
    ("new_crowd", "客户新访", "客户新访画像", "客户新访人群的具体画像拆分"),
    ("unpur_crowd", "未购客户回访", "未购客户回访画像", "未购客户回访人群的具体画像拆分"),
    ("purch_crowd", "已购客户回访", "已购客户回访画像", "已购客户回访人群的具体画像拆分"),
)


def _profile_crowd_filter_html(*, active: str = DEFAULT_PROFILE_CROWD) -> str:
    options: list[str] = []
    for crowd_type, filter_label, _title, _hint in PROFILE_CROWD_OPTIONS:
        checked = " checked" if crowd_type == active else ""
        options.append(
            f'<label class="profile-crowd-radio">'
            f'<input type="radio" name="profile-crowd" value="{escape(crowd_type)}"{checked}>'
            f'<span>{escape(filter_label)}</span>'
            f'</label>'
        )
    return (
        f'<div class="profile-filter-block">'
        f'<div class="profile-filter-label">客户类型</div>'
        f'<div class="profile-crowd-radios" role="radiogroup" aria-label="客户类型">'
        f'{"".join(options)}'
        f'</div>'
        f'</div>'
    )


def _profile_section(result: SkillOutput) -> str:
    profiles = list(result.profiles or [])
    if not profiles:
        return '<section class="panel"><p class="muted">暂无客户画像数据</p></section>'

    panes: list[str] = []
    for crowd_type, _filter_label, title, hint in PROFILE_CROWD_OPTIONS:
        crowd_dims = _swap_interest_purchase_power(
            _summary_profile_dims(profiles, crowd_type=crowd_type)
        )
        dim_blocks = _dimension_blocks_for_crowd(crowd_dims)
        if not dim_blocks:
            continue
        hidden = "" if crowd_type == DEFAULT_PROFILE_CROWD else " hidden"
        panes.append(
            f'<div class="profile-pane" data-crowd="{escape(crowd_type)}"{hidden}>'
            f'{_profile_source_header_html(title=title, hint=hint)}'
            f'{_dimension_grid_html(dim_blocks)}'
            f'</div>'
        )

    if not panes:
        return '<section id="customer-profile" class="panel"><p class="muted">暂无客户画像数据</p></section>'

    return (
        f'<section id="customer-profile" class="panel profile-panel">'
        f'<h2>客户画像</h2>'
        f'{_profile_crowd_filter_html(active=DEFAULT_PROFILE_CROWD)}'
        f'<div class="profile-pane-group">{"".join(panes)}</div>'
        f'</section>'
    )


def _build_html(result: SkillOutput) -> str:
    title = f"店铺客户分析报告 {escape(result.stat_date or result.date_range)}"
    profile_hint = ""
    if result.profile_date_range:
        profile_hint = (
            f'<p class="muted">客户画像统计区间：{escape(result.profile_date_range)}'
            f'（{escape(result.profile_date_type)}）</p>'
        )
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
:root {{
  --bg: #f8fafc;
  --panel: #ffffff;
  --text: #0f172a;
  --muted: #64748b;
  --border: #e2e8f0;
  --primary: #2563eb;
  --up: #16a34a;
  --down: #dc2626;
  --flat: #64748b;
}}
* {{ box-sizing: border-box; }}
body {{
  margin: 0;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
}}
.wrap {{ max-width: 1200px; margin: 0 auto; padding: 24px 16px 48px; }}
.hero {{
  background: linear-gradient(135deg, #1d4ed8, #2563eb);
  color: #fff;
  border-radius: 16px;
  padding: 24px 28px;
  margin-bottom: 20px;
}}
.hero h1 {{ margin: 0 0 8px; font-size: 24px; }}
.hero .muted {{ color: rgba(255,255,255,.85); margin: 4px 0 0; }}
.panel {{
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px;
  margin-bottom: 16px;
}}
.panel-header {{
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}}
.panel-header h2 {{ margin: 0; font-size: 18px; }}
.panel > h2 {{ margin: 0 0 16px; font-size: 18px; }}
.panel h3 {{ margin: 0 0 12px; font-size: 16px; }}
.panel h4 {{ margin: 0 0 12px; font-size: 14px; color: var(--muted); }}
.crowd-filter {{
  padding: 7px 32px 7px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 14px;
  background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M2 4l4 4 4-4'/%3E%3C/svg%3E") no-repeat right 10px center;
  color: var(--text);
  min-width: 168px;
  cursor: pointer;
  appearance: none;
}}
.crowd-filter:focus {{
  outline: 2px solid rgba(37, 99, 235, 0.25);
  border-color: var(--primary);
}}
.crowd-pane[hidden] {{ display: none; }}
.profile-pane[hidden] {{ display: none; }}
.profile-filter-block {{
  margin: 0 0 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}}
.profile-filter-label {{
  font-size: 14px;
  color: var(--text);
  margin-bottom: 12px;
}}
.profile-crowd-radios {{
  display: flex;
  flex-wrap: wrap;
  gap: 20px 28px;
}}
.profile-crowd-radio {{
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text);
  user-select: none;
}}
.profile-crowd-radio input {{
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--primary);
  cursor: pointer;
}}
.profile-pane-group {{
  min-height: 120px;
}}
.profile-pane .profile-source-header {{
  margin-top: 4px;
}}
.segment-overview-panel {{ padding-top: 0; overflow: hidden; }}
.shop-total-card {{
  position: relative;
  padding: 12px 20px;
  background: linear-gradient(180deg, #eff6ff 0%, #f8fbff 100%);
  border-bottom: 1px solid var(--border);
  margin: 0 -20px 0;
}}
.shop-total-body {{
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}}
.shop-total-main {{
  min-width: 0;
  text-align: center;
}}
.profile-link {{
  position: absolute;
  top: 10px;
  right: 16px;
  color: var(--primary);
  text-decoration: none;
  font-size: 13px;
}}
.profile-link:hover {{ text-decoration: underline; }}
.shop-total-icon {{
  flex-shrink: 0;
  line-height: 0;
}}
.shop-total-label {{
  color: var(--muted);
  font-size: 12px;
  margin-bottom: 2px;
}}
.shop-total-metrics {{
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}}
.shop-total-value {{
  font-size: 28px;
  font-weight: 700;
  color: #1e3a8a;
  line-height: 1.1;
}}
.shop-total-main .metric-yoy {{
  font-size: 12px;
}}
.shop-sum-hint {{
  margin-top: 4px;
  font-size: 11px;
}}
.segment-overview-title {{ margin: 10px 0 12px; font-size: 17px; }}
.segment-cards-row {{
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 0;
  align-items: stretch;
}}
.segment-card-col {{ min-width: 0; display: flex; flex-direction: column; }}
.segment-union-between {{
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  color: var(--primary);
}}
.segment-union-between span {{
  font-size: 11px;
  padding: 8px 5px;
  border: 1px dashed #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
  writing-mode: vertical-rl;
  letter-spacing: 2px;
}}
.segment-card {{
  border: 1px solid #dbeafe;
  border-radius: 12px;
  background: #fcfdff;
  padding: 16px 18px 14px;
}}
.segment-card-head {{
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}}
.segment-card-title {{ font-size: 14px; font-weight: 600; color: #1e40af; }}
.segment-card-rates {{ display: flex; gap: 8px; flex-shrink: 0; flex-wrap: wrap; }}
.rate-mini {{ min-width: 56px; }}
.rate-mini-label {{ display: block; font-size: 11px; color: var(--muted); margin-bottom: 4px; }}
.rate-mini-track {{ height: 6px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }}
.rate-mini-fill {{ height: 100%; background: linear-gradient(90deg, #93c5fd, #3b82f6); border-radius: 999px; }}
.segment-main-value {{
  font-size: 30px;
  font-weight: 700;
  color: #0f172a;
  text-align: center;
  margin: 4px 0 14px;
}}
.segment-split-row {{
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 10px;
  align-items: stretch;
  margin-bottom: 14px;
}}
.split-box {{
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
  padding: 12px 10px;
  text-align: center;
}}
.split-box-label {{ font-size: 12px; color: var(--muted); margin-bottom: 6px; }}
.split-box-value {{ font-size: 18px; font-weight: 700; }}
.split-union {{
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary);
  font-size: 12px;
}}
.split-union span {{
  writing-mode: vertical-rl;
  padding: 4px 0;
  border: 1px dashed #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
  letter-spacing: 2px;
}}
.segment-kpi-row {{
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  border-top: 1px dashed var(--border);
  padding-top: 12px;
}}
.segment-kpi {{ text-align: center; }}
.segment-kpi-label {{ font-size: 12px; color: var(--muted); margin-bottom: 4px; }}
.segment-kpi-value {{ font-size: 14px; font-weight: 600; }}
.segment-recall-footer {{
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 12px;
  padding: 8px 12px;
  background: #f8fafc;
  border-radius: 8px;
  font-size: 13px;
  color: var(--muted);
}}
.segment-recall-footer strong {{ color: var(--primary); font-weight: 700; }}
.recall-arrow {{ color: #93c5fd; font-size: 14px; }}
.profile-source-header {{ margin-bottom: 16px; }}
.profile-source-title {{
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--primary);
}}
.section-hint {{ margin: -4px 0 20px; }}
.profile-dimension-grid {{
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px 24px;
}}
.profile-dimension {{
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
  background: #fcfdff;
}}
.profile-dimension h4 {{
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
}}
.profile-dimension--combo:not(.profile-dimension--combo-triple) .combo-charts {{
  display: flex;
  flex-direction: column;
  gap: 0;
}}
.profile-dimension--combo:not(.profile-dimension--combo-triple) .combo-chart-item {{
  padding: 4px 0;
}}
.profile-dimension--combo:not(.profile-dimension--combo-triple) .combo-chart-item + .combo-chart-item {{
  margin-top: 14px;
  padding-top: 16px;
  border-top: 1px dashed var(--border);
}}
.combo-chart-item h4 {{
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
}}
.profile-dimension--combo:not(.profile-dimension--combo-triple) .pie-chart-wrap {{
  gap: 12px;
  align-items: flex-start;
  width: 100%;
}}
.profile-dimension--combo:not(.profile-dimension--combo-triple) .pie-chart {{
  width: 96px;
  height: 96px;
  flex-shrink: 0;
}}
.profile-dimension--combo:not(.profile-dimension--combo-triple) .pie-legend {{
  flex: 1;
  min-width: 0;
}}
.profile-dimension--combo:not(.profile-dimension--combo-triple) .pie-legend-item {{
  margin-bottom: 6px;
  font-size: 12px;
}}
.profile-dimension--combo:not(.profile-dimension--combo-triple) .pie-legend-item:last-child {{
  margin-bottom: 0;
}}
.profile-dimension--combo-triple {{
  grid-column: 1 / -1;
}}
.profile-dimension--combo-triple .combo-charts {{
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}}
.profile-dimension--combo-triple .combo-chart-item {{
  padding: 0;
  min-width: 0;
}}
.profile-dimension--combo-triple .combo-chart-item + .combo-chart-item {{
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}}
.profile-dimension--combo-triple .bar-row {{
  grid-template-columns: minmax(52px, 68px) 1fr 46px;
  gap: 6px;
  margin-bottom: 8px;
}}
.profile-dimension--combo-triple .bar-label {{
  font-size: 11px;
}}
.profile-dimension--combo-triple .bar-value {{
  font-size: 11px;
}}
.profile-dimension--combo-triple .bar-fill-text {{
  font-size: 11px;
}}
.profile-dimension--combo-triple .bar-track {{
  height: 24px;
}}
.ai-analysis-panel {{
  margin-top: 24px;
}}
.ai-analysis-header {{
  margin-bottom: 18px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}}
.ai-analysis-body {{
  font-size: 14px;
  line-height: 1.75;
  color: var(--text);
}}
.ai-h2, .ai-h3, .ai-h4, .ai-h5 {{
  color: var(--primary);
  margin: 20px 0 10px;
}}
.ai-h2 {{ font-size: 20px; margin-top: 0; }}
.ai-h3 {{ font-size: 17px; }}
.ai-h4 {{ font-size: 15px; }}
.ai-h5 {{ font-size: 14px; color: var(--text); }}
.ai-quote {{
  margin: 0 0 16px;
  padding: 10px 14px;
  background: #f8fafc;
  border-left: 3px solid #93c5fd;
  color: var(--muted);
}}
.ai-list {{
  margin: 8px 0 12px 18px;
  padding: 0;
}}
.ai-list li {{ margin-bottom: 6px; }}
.ai-p {{ margin: 8px 0; }}
.ai-table {{
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0 18px;
  font-size: 13px;
}}
.ai-table th, .ai-table td {{
  border: 1px solid var(--border);
  padding: 10px 12px;
  text-align: left;
  vertical-align: top;
}}
.ai-table th {{
  background: #f8fafc;
  color: var(--primary);
}}
.ai-analysis-body strong {{
  color: #1d4ed8;
}}
.kind-hint {{ margin: -6px 0 12px; }}
.metric-grid {{
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}}
.metric-card {{
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px;
  background: #fcfdff;
}}
.metric-label {{ color: var(--muted); font-size: 13px; margin-bottom: 6px; }}
.metric-value {{ font-size: 22px; font-weight: 700; }}
.metric-yoy {{ font-size: 12px; margin-top: 6px; }}
.metric-yoy.up {{ color: var(--up); }}
.metric-yoy.down {{ color: var(--down); }}
.metric-yoy.flat {{ color: var(--flat); }}
.bar-chart {{ width: 100%; }}
.bar-row {{
  display: grid;
  grid-template-columns: minmax(100px, 140px) 1fr 64px;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}}
.bar-label {{
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}}
.bar-track {{
  height: 30px;
  background: #f1f5f9;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
}}
.bar-fill {{
  height: 100%;
  min-width: max(56px, 8%);
  border-radius: 8px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  box-sizing: border-box;
  transition: background 0.2s ease;
}}
.bar-fill-text {{
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}}
.bar-value {{
  font-size: 12px;
  color: var(--muted);
  text-align: right;
  font-variant-numeric: tabular-nums;
}}
.pie-chart-wrap {{
  display: flex;
  align-items: center;
  gap: 16px;
}}
.pie-chart {{
  width: 132px;
  height: 132px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.06);
}}
.pie-legend {{
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  min-width: 0;
}}
.pie-legend-item {{
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
}}
.pie-legend-item:last-child {{ margin-bottom: 0; }}
.pie-legend-dot {{
  width: 10px;
  height: 10px;
  border-radius: 2px;
}}
.pie-legend-name {{
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}}
.pie-legend-count {{
  color: var(--text);
  font-variant-numeric: tabular-nums;
}}
.pie-legend-pct {{
  color: var(--muted);
  text-align: right;
  font-variant-numeric: tabular-nums;
  min-width: 52px;
}}
.profile-dimension--pie .pie-chart-wrap {{
  min-height: 132px;
}}
.muted {{ color: var(--muted); font-size: 13px; }}
@media (max-width: 1100px) {{
  .segment-cards-row {{
    grid-template-columns: 1fr;
    gap: 12px;
  }}
  .segment-union-between span {{
    writing-mode: horizontal-tb;
    letter-spacing: 0;
    width: 100%;
    text-align: center;
  }}
}}
@media (max-width: 900px) {{
  .profile-dimension-grid {{ grid-template-columns: 1fr; }}
  .profile-dimension--combo-triple {{ grid-column: auto; }}
  .profile-dimension--combo-triple .combo-charts {{ grid-template-columns: 1fr; }}
  .profile-crowd-radios {{ flex-direction: column; gap: 12px; }}
  .panel-header {{ flex-direction: column; align-items: flex-start; }}
  .crowd-filter {{ width: 100%; }}
  .bar-row {{ grid-template-columns: 1fr; gap: 4px; }}
  .bar-label {{ white-space: normal; }}
  .bar-value {{ text-align: left; padding-left: 2px; }}
  .segment-card-head {{ flex-direction: column; }}
  .segment-kpi-row {{ grid-template-columns: 1fr; }}
  .segment-split-row {{ grid-template-columns: 1fr; }}
  .split-union span {{ writing-mode: horizontal-tb; letter-spacing: 0; }}
}}
</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <h1>店铺客户分析报告</h1>
    <p class="muted">统计日期：{escape(result.stat_date or result.date_range)}</p>
    {profile_hint}
  </header>
  {_overview_section(result)}
  {_profile_section(result)}
  {generate_conversion_analysis_html(result)}
</div>
<script>
(function () {{
  var radios = document.querySelectorAll('input[name="profile-crowd"]');
  if (!radios.length) return;
  function applyProfileCrowd(crowd) {{
    document.querySelectorAll(".profile-pane").forEach(function (pane) {{
      pane.hidden = pane.dataset.crowd !== crowd;
    }});
  }}
  radios.forEach(function (radio) {{
    radio.addEventListener("change", function (event) {{
      if (event.target.checked) {{
        applyProfileCrowd(event.target.value);
      }}
    }});
  }});
}})();
window.__REPORT_DATA__ = {json.dumps(result.to_dict(), ensure_ascii=False)};
</script>
</body>
</html>"""
