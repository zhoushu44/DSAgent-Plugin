from __future__ import annotations

import json
import math
import re
from collections import Counter
from datetime import date, datetime
from html import escape
from pathlib import Path
from typing import Any

from .csv_exporter import HEADERS
from .parser import classify_rate_level
from .types import SkillOutput
from .word_cloud import (
    build_keyword_index_map,
    render_keyword_table_panel,
    render_word_cloud_panel,
)
from .insights import render_insights_block

_COLUMN_KEYS = (
    "index",
    "user",
    "sku_name",
    "tags",
    "feedback_date",
    "media",
    "feedback",
    "append_feedback",
    "append_media",
    "like_count",
)

REVIEWS_PAGE_SIZE = 20

_RATING_LEVELS: tuple[tuple[str, str], ...] = (
    ("好评", "#2563eb"),
    ("中评", "#60a5fa"),
    ("差评", "#dc2626"),
)

_SKU_COLORS = (
    "#2563eb",
    "#1d4ed8",
    "#60a5fa",
    "#3b82f6",
    "#93c5fd",
    "#bfdbfe",
)


def generate_reviews_report(result: SkillOutput, output_path: Path) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(_build_html(result), encoding="utf-8")
    return str(output_path)


def _split_media(value: str) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split("|") if part.strip()]


def _is_image_url(url: str) -> bool:
    lowered = url.lower()
    return any(ext in lowered for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"))


def _render_cell(column: str, value: Any) -> str:
    text = str(value or "").strip()
    if column in {"晒图/视频", "追评晒图/视频"}:
        return _render_media_cell(text)
    if column == "序号":
        if not text:
            return '<span class="muted">-</span>'
        return f'<span class="cell-index">{escape(text)}</span>'
    if not text:
        return '<span class="muted">-</span>'
    return f'<div class="cell-text">{escape(text)}</div>'


def _render_media_cell(media_text: str) -> str:
    urls = _split_media(media_text)
    if not urls:
        return '<span class="muted">-</span>'

    items: list[str] = []
    for url in urls:
        safe_url = escape(url)
        if _is_image_url(url):
            items.append(
                f'<a class="media-thumb" href="{safe_url}" target="_blank" rel="noreferrer" title="查看大图">'
                f'<img src="{safe_url}" alt="" loading="lazy"></a>'
            )
        else:
            items.append(
                f'<a class="media-link" href="{safe_url}" target="_blank" rel="noreferrer">视频</a>'
            )
    return f'<div class="media-cell">{"".join(items)}</div>'


def _parse_feedback_date(text: str) -> date | None:
    match = re.match(r"(\d{4})年(\d{1,2})月(\d{1,2})日", str(text or "").strip())
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def _build_cumulative_series(
    reviews: list[dict[str, Any]],
) -> tuple[list[str], list[int], list[int]]:
    daily = Counter[date]()
    for review in reviews:
        parsed = _parse_feedback_date(str(review.get("feedback_date") or ""))
        if parsed:
            daily[parsed] += 1

    if not daily:
        return [], [], []

    labels: list[str] = []
    daily_counts: list[int] = []
    cumulative: list[int] = []
    running = 0
    for day in sorted(daily):
        count = daily[day]
        running += count
        labels.append(f"{day.month}/{day.day}")
        daily_counts.append(count)
        cumulative.append(running)
    return labels, daily_counts, cumulative


def _render_trend_series_svg(
    labels: list[str],
    values: list[int],
    *,
    svg_id: str,
    gradient_id: str,
    aria_label: str,
) -> str:
    width = 480
    height = 220
    pad_l, pad_r, pad_t, pad_b = 44, 16, 24, 44
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b
    n = len(labels)
    y_max = max(values) or 1
    y_min = 0
    y_span = y_max - y_min or 1

    def x_at(index: int) -> float:
        if n <= 1:
            return pad_l + plot_w / 2
        return pad_l + index / (n - 1) * plot_w

    def y_at(value: int) -> float:
        return pad_t + plot_h - (value - y_min) / y_span * plot_h

    grid_lines: list[str] = []
    tick_count = 4
    for step in range(tick_count + 1):
        value = y_min + y_span * step / tick_count
        y = y_at(value)
        grid_lines.append(
            f'<line class="grid-line" x1="{pad_l:.1f}" y1="{y:.1f}" '
            f'x2="{pad_l + plot_w:.1f}" y2="{y:.1f}"></line>'
        )
        grid_lines.append(
            f'<text class="axis-label y-label" x="{pad_l - 10:.1f}" y="{y + 4:.1f}" '
            f'text-anchor="end">{int(round(value))}</text>'
        )

    points: list[tuple[float, float, int]] = []
    for index, value in enumerate(values):
        points.append((x_at(index), y_at(value), value))

    line_path = " ".join(f"{x:.1f},{y:.1f}" for x, y, _ in points)
    area_path = (
        f"M {points[0][0]:.1f},{pad_t + plot_h:.1f} "
        + " ".join(f"L {x:.1f},{y:.1f}" for x, y, _ in points)
        + f" L {points[-1][0]:.1f},{pad_t + plot_h:.1f} Z"
    )

    dots: list[str] = []
    value_labels: list[str] = []
    x_labels: list[str] = []
    label_step = max(1, (n + 11) // 12)
    for index, (x, y, value) in enumerate(points):
        dots.append(f'<circle class="chart-dot" cx="{x:.1f}" cy="{y:.1f}" r="4"></circle>')
        value_labels.append(
            f'<text class="value-label" x="{x:.1f}" y="{y - 10:.1f}" '
            f'text-anchor="middle">{value}</text>'
        )
        if index % label_step == 0 or index == n - 1:
            x_labels.append(
                f'<text class="axis-label x-label" x="{x:.1f}" y="{pad_t + plot_h + 22:.1f}" '
                f'text-anchor="middle">{escape(labels[index])}</text>'
            )

    return f"""
<svg id="{svg_id}" class="trend-chart" viewBox="0 0 {width} {height}" role="img"
     aria-label="{escape(aria_label)}">
  <defs>
    <linearGradient id="{gradient_id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2563eb" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#2563eb" stop-opacity="0"/>
    </linearGradient>
  </defs>
  {"".join(grid_lines)}
  <path fill="url(#{gradient_id})" d="{area_path}"></path>
  <polyline class="chart-line" points="{line_path}"></polyline>
  {"".join(dots)}
  {"".join(value_labels)}
  {"".join(x_labels)}
</svg>"""


def _render_trend_chart(reviews: list[dict[str, Any]]) -> str:
    labels, daily_counts, cumulative = _build_cumulative_series(reviews)
    if not labels:
        return '<p class="empty muted">暂无有效初评日期，无法生成趋势图。</p>'

    daily_svg = _render_trend_series_svg(
        labels,
        daily_counts,
        svg_id="trend-chart-daily",
        gradient_id="trendAreaDaily",
        aria_label="单日评价数折线图",
    )
    cumulative_svg = _render_trend_series_svg(
        labels,
        cumulative,
        svg_id="trend-chart-cumulative",
        gradient_id="trendAreaCumulative",
        aria_label="累计评价数折线图",
    )

    return f"""
<div class="chart-wrap trend-chart-wrap">
  <div class="trend-chart-panel" data-mode="cumulative">{cumulative_svg}</div>
  <div class="trend-chart-panel is-hidden" data-mode="daily">{daily_svg}</div>
</div>"""


def _review_search_text(review: dict[str, Any]) -> str:
    return " ".join(
        str(review.get(key) or "").strip()
        for key in ("feedback", "append_feedback")
    )


def _review_rate_level(review: dict[str, Any]) -> str:
    return classify_rate_level(str(review.get("rate_type") or ""))


def _sku_catalog(result: SkillOutput) -> dict[str, Any]:
    return (result.summary or {}).get("sku_catalog") or {}


def _split_catalog_props(catalog: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    spec_props: list[dict[str, Any]] = []
    color_props: list[dict[str, Any]] = []
    for prop in catalog.get("sku_props") or []:
        if not isinstance(prop, dict):
            continue
        if prop.get("kind") == "color":
            color_props.append(prop)
        else:
            spec_props.append(prop)
    return spec_props, color_props


def _render_prop_filter_group(prop: dict[str, Any], *, section: str) -> str:
    prop_name = str(prop.get("name") or "").strip()
    values = prop.get("values") or []
    items: list[str] = []
    for value in values:
        if not isinstance(value, dict):
            continue
        value_name = str(value.get("name") or "").strip()
        if not value_name:
            continue
        image = str(value.get("image") or "").strip()
        thumb = ""
        if image:
            thumb = (
                f'<img class="sku-filter-thumb" src="{escape(image)}" alt="" loading="lazy">'
            )
        short_name = value_name if len(value_name) <= 28 else f"{value_name[:27]}…"
        items.append(
            '<label class="sku-filter-item" title="'
            f'{escape(value_name)}">'
            '<input type="checkbox" class="sku-filter" '
            f'data-section="{escape(section)}" data-prop="{escape(prop_name)}" '
            f'data-value="{escape(value_name)}">'
            f"{thumb}"
            f'<span class="sku-filter-label">{escape(short_name)}</span>'
            "</label>"
        )
    if not items:
        return ""
    return (
        f'<div class="sku-filter-group" data-prop="{escape(prop_name)}">'
        f'<h3 class="sku-filter-title">{escape(prop_name)}</h3>'
        f'<div class="sku-filter-list">{"".join(items)}</div>'
        "</div>"
    )


def _render_spec_filter_panel(result: SkillOutput) -> str:
    catalog = _sku_catalog(result)
    spec_props, _ = _split_catalog_props(catalog)
    if not spec_props:
        return (
            '<div class="insight-left sku-filter-panel sku-filter-spec">'
            '<h2 class="insight-title">SKU 规格</h2>'
            '<p class="empty muted">暂无规格数据。</p>'
            "</div>"
        )
    groups = "".join(
        _render_prop_filter_group(prop, section="spec") for prop in spec_props
    )
    return (
        '<div class="insight-left sku-filter-panel sku-filter-spec">'
        '<h2 class="insight-title">SKU 规格</h2>'
        '<p class="insight-hint muted">勾选规格，联动筛选全页图表与评价明细</p>'
        f"{groups}"
        "</div>"
    )


def _render_color_filter_panel(result: SkillOutput) -> str:
    catalog = _sku_catalog(result)
    _, color_props = _split_catalog_props(catalog)
    if not color_props:
        return (
            '<div class="insight-right sku-filter-panel sku-filter-color">'
            '<h2 class="insight-title">颜色分类</h2>'
            '<p class="empty muted">暂无颜色分类数据。</p>'
            "</div>"
        )
    groups = "".join(
        _render_prop_filter_group(prop, section="color") for prop in color_props
    )
    return (
        '<div class="insight-right sku-filter-panel sku-filter-color">'
        '<h2 class="insight-title">颜色分类</h2>'
        '<p class="insight-hint muted">勾选颜色，联动筛选全页图表与评价明细</p>'
        f"{groups}"
        "</div>"
    )


def _render_reviews_table(reviews: list[dict[str, Any]]) -> str:
    if not reviews:
        return '<p class="empty">当前没有抓到评价数据。</p>'

    head = "".join(f"<th>{escape(label)}</th>" for label in HEADERS)
    rows: list[str] = []
    for review in reviews:
        cells = "".join(
            f"<td>{_render_cell(header, review.get(key, ''))}</td>"
            for header, key in zip(HEADERS, _COLUMN_KEYS, strict=True)
        )
        search_text = escape(_review_search_text(review))
        review_index = int(review.get("index") or 0) - 1
        sku_map_json = escape(json.dumps(review.get("sku_map") or {}, ensure_ascii=False))
        rate_level = escape(_review_rate_level(review))
        rows.append(
            f'<tr data-review-index="{review_index}" data-rate-level="{rate_level}" '
            f'data-sku-name="{escape(str(review.get("sku_name") or ""))}" '
            f'data-sku-map="{sku_map_json}" data-search-text="{search_text}">{cells}</tr>'
        )

    return (
        '<div class="table-wrap">'
        '<table class="review-table" id="review-table">'
        f"<thead><tr>{head}</tr></thead>"
        f'<tbody id="review-table-body">{"".join(rows)}</tbody>'
        "</table>"
        "</div>"
        '<div class="table-pagination" id="table-pagination">'
        '<button type="button" class="page-btn" id="page-prev" disabled>上一页</button>'
        '<span class="page-info" id="page-info">第 1 / 1 页</span>'
        '<button type="button" class="page-btn" id="page-next" disabled>下一页</button>'
        "</div>"
    )


def _parse_impression_count(text: str) -> int:
    try:
        return int(str(text).replace("+", "").strip())
    except ValueError:
        return 0


def _build_rate_counts(reviews: list[dict[str, Any]]) -> Counter[str]:
    counter: Counter[str] = Counter()
    for review in reviews:
        level = classify_rate_level(str(review.get("rate_type") or ""))
        if level:
            counter[level] += 1
    return counter


def _build_sku_counts(reviews: list[dict[str, Any]]) -> list[tuple[str, int]]:
    counter: Counter[str] = Counter()
    for review in reviews:
        sku = str(review.get("sku_name") or "").strip() or "未知 SKU"
        counter[sku] += 1
    return counter.most_common()


def _render_rate_donut_svg(rate_counts: Counter[str], *, total: int) -> str:
    size = 188
    cx = cy = size / 2
    radius = 58
    stroke = 20
    circumference = 2 * math.pi * radius
    offset = 0.0
    rings: list[str] = []

    for label, color in _RATING_LEVELS:
        count = rate_counts.get(label, 0)
        if count <= 0:
            continue
        length = circumference * count / total
        gap = circumference - length
        rings.append(
            f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{radius}" fill="none" '
            f'stroke="{color}" stroke-width="{stroke}" '
            f'stroke-dasharray="{length:.2f} {gap:.2f}" '
            f'stroke-dashoffset="{(-offset):.2f}" '
            f'transform="rotate(-90 {cx:.1f} {cy:.1f})">'
            f"<title>{escape(label)} · {count}</title></circle>"
        )
        offset += length

    return (
        f'<svg class="donut-chart" viewBox="0 0 {size} {size}" role="img" '
        f'aria-label="好评中评差评分布">'
        f'{"".join(rings)}'
        f'<text class="donut-total" x="{cx:.1f}" y="{cy - 2:.1f}" text-anchor="middle">'
        f"{total}</text>"
        f'<text class="donut-sub" x="{cx:.1f}" y="{cy + 14:.1f}" text-anchor="middle">'
        f"条评价</text>"
        f"</svg>"
    )


def _render_rate_filter_legend(rate_counts: Counter[str], *, total: int) -> str:
    items: list[str] = []
    for label, color in _RATING_LEVELS:
        count = rate_counts.get(label, 0)
        pct = (count / total * 100) if total else 0
        items.append(
            '<label class="rate-filter-item">'
            f'<input type="checkbox" class="rate-filter" data-level="{escape(label)}">'
            f'<span class="donut-dot" style="background:{color}"></span>'
            f'<span class="rate-filter-label">{escape(label)}</span>'
            f'<span class="rate-filter-value">{count}</span>'
            f'<span class="rate-filter-pct">{pct:.0f}%</span>'
            "</label>"
        )
    return f'<div class="rate-filter-list" id="rate-filter-list">{"".join(items)}</div>'


def _render_rating_panel(reviews: list[dict[str, Any]]) -> str:
    rate_counts = _build_rate_counts(reviews)
    total = sum(rate_counts.values())
    if not total:
        return (
            '<div class="insight-left">'
            '<h2 class="insight-title">评价等级</h2>'
            '<p class="empty muted">暂无评价等级数据。</p>'
            "</div>"
        )

    donut = _render_rate_donut_svg(rate_counts, total=total)
    legend = _render_rate_filter_legend(rate_counts, total=total)
    return (
        '<div class="insight-left">'
        '<h2 class="insight-title">评价等级</h2>'
        '<p class="insight-hint muted">勾选等级，联动筛选全页图表与评价明细</p>'
        '<div class="donut-wrap" id="rate-donut-wrap">'
        f'<div class="donut-chart-box" id="rate-donut-chart">{donut}</div>'
        f'<div class="rate-filter-side" id="rate-donut-legend">{legend}</div>'
        "</div>"
        "</div>"
    )


def _render_sku_donut_svg(
    sku_items: list[tuple[str, int]],
    *,
    total: int,
    svg_class: str = "donut-chart",
) -> str:
    size = 188
    cx = cy = size / 2
    radius = 58
    stroke = 20
    circumference = 2 * math.pi * radius
    offset = 0.0
    rings: list[str] = []

    for index, (sku, count) in enumerate(sku_items):
        if count <= 0:
            continue
        length = circumference * count / total
        gap = circumference - length
        color = _SKU_COLORS[index % len(_SKU_COLORS)]
        rings.append(
            f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{radius}" fill="none" '
            f'stroke="{color}" stroke-width="{stroke}" '
            f'stroke-dasharray="{length:.2f} {gap:.2f}" '
            f'stroke-dashoffset="{(-offset):.2f}" '
            f'transform="rotate(-90 {cx:.1f} {cy:.1f})">'
            f"<title>{escape(sku)} · {count}</title></circle>"
        )
        offset += length

    return (
        f'<svg class="{svg_class}" viewBox="0 0 {size} {size}" role="img" '
        f'aria-label="SKU 分布环状图">'
        f'{"".join(rings)}'
        f'<text class="donut-total" x="{cx:.1f}" y="{cy - 2:.1f}" text-anchor="middle">'
        f"{total}</text>"
        f'<text class="donut-sub" x="{cx:.1f}" y="{cy + 14:.1f}" text-anchor="middle">'
        f"条评价</text>"
        f"</svg>"
    )


def _render_sku_legend(
    sku_items: list[tuple[str, int]],
    *,
    total: int,
) -> str:
    items: list[str] = []
    for index, (sku, count) in enumerate(sku_items):
        pct = (count / total * 100) if total else 0
        color = _SKU_COLORS[index % len(_SKU_COLORS)]
        short_sku = sku if len(sku) <= 16 else f"{sku[:15]}…"
        items.append(
            '<li class="donut-legend-item">'
            f'<span class="donut-dot" style="background:{color}"></span>'
            f'<span class="donut-label" title="{escape(sku)}">{escape(short_sku)}</span>'
            f'<span class="donut-value">{count}</span>'
            f'<span class="donut-pct">{pct:.0f}%</span>'
            "</li>"
        )
    return f'<ul class="donut-legend sku-legend">{"".join(items)}</ul>'


def _render_sku_panel(reviews: list[dict[str, Any]]) -> str:
    sku_items = _build_sku_counts(reviews)
    if not sku_items:
        return (
            '<div class="insight-right">'
            '<h2 class="insight-title">SKU 分布</h2>'
            '<p class="empty muted">暂无 SKU 数据。</p>'
            "</div>"
        )

    total = sum(count for _, count in sku_items)
    donut = _render_sku_donut_svg(sku_items, total=total)
    legend = _render_sku_legend(sku_items, total=total)
    return (
        '<div class="insight-right">'
        '<h2 class="insight-title">SKU 分布</h2>'
        '<div class="donut-wrap" id="sku-donut-wrap">'
        f'<div class="donut-chart-box" id="sku-donut-chart">{donut}</div>'
        f'<div id="sku-donut-legend">{legend}</div>'
        "</div>"
        "</div>"
    )


def _render_distribution_section(result: SkillOutput) -> str:
    reviews = result.reviews or []
    if not reviews:
        return ""

    spec_html = _render_spec_filter_panel(result)
    color_html = _render_color_filter_panel(result)
    rating_html = _render_rating_panel(reviews)
    sku_html = _render_sku_panel(reviews)
    return (
        '<section class="insight-panel">'
        '<div class="insight-split">'
        f"{spec_html}"
        f"{color_html}"
        "</div>"
        '<div class="insight-split insight-split-charts">'
        f"{rating_html}"
        f"{sku_html}"
        "</div>"
        "</section>"
    )


def _render_trend_panel(reviews: list[dict[str, Any]]) -> str:
    chart_html = _render_trend_chart(reviews)
    has_chart = "trend-chart-wrap" in chart_html
    mode_switch = ""
    if has_chart:
        mode_switch = (
            '<div class="chart-mode-switch" role="tablist" aria-label="趋势图模式">'
            '<button type="button" class="chart-mode-btn" data-mode="daily" '
            'role="tab" aria-selected="false">单日评价数</button>'
            '<button type="button" class="chart-mode-btn is-active" data-mode="cumulative" '
            'role="tab" aria-selected="true">累计评价数</button>'
            "</div>"
        )
    return (
        '<div class="insight-left">'
        '<div class="insight-head">'
        '<h2 class="insight-title">评价趋势</h2>'
        f"{mode_switch}"
        "</div>"
        f"{chart_html}"
        "</div>"
    )


def _render_impression_chart(result: SkillOutput) -> str:
    tags = (result.summary or {}).get("impression_tags") or []
    valid = [tag for tag in tags if isinstance(tag, dict) and tag.get("title")]
    if not valid:
        return (
            '<div class="insight-right">'
            '<h2 class="insight-title">买家印象标签</h2>'
            '<p class="empty muted">暂无买家印象标签数据。</p>'
            "</div>"
        )
    labels = [str(tag["title"]) for tag in valid]
    values = [_parse_impression_count(str(tag.get("count") or "")) for tag in valid]
    display_values = [str(tag.get("count") or values[i]) for i, tag in enumerate(valid)]
    max_value = max(values) or 1

    width = 480
    height = 220
    pad_l, pad_r, pad_t, pad_b = 32, 12, 20, 72
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b
    count = len(labels)
    gap_ratio = 0.28
    bar_width = plot_w / max(count, 1) * (1 - gap_ratio)
    slot_width = plot_w / max(count, 1)

    bars: list[str] = []
    x_labels: list[str] = []
    value_labels: list[str] = []

    for index, (label, value, display) in enumerate(zip(labels, values, display_values)):
        center_x = pad_l + slot_width * index + slot_width / 2
        bar_h = (value / max_value) * plot_h if value > 0 else 0
        x = center_x - bar_width / 2
        y = pad_t + plot_h - bar_h
        bars.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" '
            f'width="{bar_width:.1f}" height="{bar_h:.1f}" rx="3" '
            f'fill="url(#imprGrad)" opacity="0.92"></rect>'
        )
        if value > 0:
            value_labels.append(
                f'<text class="impr-value" x="{center_x:.1f}" y="{y - 6:.1f}" '
                f'text-anchor="middle">{escape(display)}</text>'
            )
        short_label = label if len(label) <= 6 else f"{label[:5]}…"
        x_labels.append(
            f'<text class="impr-x-label" x="{center_x:.1f}" y="{pad_t + plot_h + 18:.1f}" '
            f'text-anchor="middle">{escape(short_label)}'
            f'<title>{escape(label)}</title></text>'
        )

    grid_lines = []
    for step in range(5):
        value = max_value * step / 4
        y = pad_t + plot_h - (value / max_value) * plot_h
        grid_lines.append(
            f'<line class="impr-grid" x1="{pad_l}" y1="{y:.1f}" '
            f'x2="{pad_l + plot_w:.1f}" y2="{y:.1f}"></line>'
        )
        grid_lines.append(
            f'<text class="impr-y-label" x="{pad_l - 8:.1f}" y="{y + 4:.1f}" '
            f'text-anchor="end">{int(round(value))}</text>'
        )

    chart_svg = f"""
<svg class="impr-chart" viewBox="0 0 {width} {height}" role="img" aria-label="买家印象标签柱状图">
  <defs>
    <linearGradient id="imprGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
  </defs>
  {"".join(grid_lines)}
  <line class="impr-axis" x1="{pad_l}" y1="{pad_t + plot_h:.1f}" x2="{pad_l + plot_w:.1f}" y2="{pad_t + plot_h:.1f}"></line>
  {"".join(bars)}
  {"".join(value_labels)}
  {"".join(x_labels)}
</svg>"""

    return (
        '<div class="insight-right">'
        '<h2 class="insight-title">买家印象标签</h2>'
        f'<div class="impr-chart-wrap">{chart_svg}</div>'
        "</div>"
    )


def _render_overview_section(result: SkillOutput) -> str:
    reviews = result.reviews or []
    left_html = _render_trend_panel(reviews)
    right_html = _render_impression_chart(result)
    has_trend = "trend-chart" in left_html
    has_impression = "impr-chart" in right_html
    if not has_trend and not has_impression:
        return ""

    return (
        '<section class="insight-panel">'
        '<div class="insight-split">'
        f"{left_html}"
        f"{right_html}"
        "</div>"
        "</section>"
    )


def _render_keywords_section(result: SkillOutput) -> str:
    reviews = result.reviews or []
    left_html = render_keyword_table_panel(reviews)
    right_html = render_word_cloud_panel(reviews)
    has_keywords = "kw-table" in left_html
    has_cloud = "word-cloud" in right_html
    if not has_keywords and not has_cloud:
        return ""

    return (
        '<section class="insight-panel">'
        '<div class="insight-split">'
        f"{left_html}"
        f"{right_html}"
        "</div>"
        "</section>"
    )


def _render_header(
    result: SkillOutput,
    *,
    hero_title: str,
    generated_at: str,
    item_link_html: str,
) -> str:
    item_id = str(result.item_id or "").strip()
    collected = result.collected_count or len(result.reviews or [])
    subtitle_parts = [hero_title]
    if item_id:
        subtitle_parts.append(f"ID {item_id}")
    if collected:
        subtitle_parts.append(f"共 {collected} 条")
    subtitle = " · ".join(part for part in subtitle_parts if part)

    meta_parts = [f'<span>生成于 <strong>{escape(generated_at)}</strong></span>']
    if item_link_html:
        meta_parts.append(f'<span class="accent">{item_link_html}</span>')

    return f"""
  <header class="report-header">
    <div class="report-header-left">
      <div class="report-logo" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </div>
      <div class="report-header-title">
        <h1>商品评价报告</h1>
        <p class="report-header-sub">{escape(subtitle)}</p>
      </div>
    </div>
    <div class="report-header-meta">
      {"".join(meta_parts)}
    </div>
  </header>"""


def _hero_title(result: SkillOutput) -> str:
    title = str((result.summary or {}).get("auction_title") or "").strip()
    if title:
        return title
    if result.item_id:
        return f"商品 {result.item_id}"
    return "商品评价报告"


def _build_report_embed_data(result: SkillOutput) -> str:
    reviews = result.reviews or []
    embed_reviews: list[dict[str, Any]] = []
    for review in reviews:
        embed_reviews.append({
            "index": int(review.get("index") or 0) - 1,
            "sku_name": review.get("sku_name") or "",
            "sku_map": review.get("sku_map") or {},
            "rate_level": _review_rate_level(review),
            "feedback_date": review.get("feedback_date") or "",
            "feedback": review.get("feedback") or "",
            "append_feedback": review.get("append_feedback") or "",
        })

    labels, daily_counts, cumulative = _build_cumulative_series(reviews)
    payload = {
        "reviews": embed_reviews,
        "skuColors": list(_SKU_COLORS),
        "ratingColors": {label: color for label, color in _RATING_LEVELS},
        "trend": {"labels": labels, "daily": daily_counts, "cumulative": cumulative},
        "keywords": build_keyword_index_map(reviews),
        "pageSize": REVIEWS_PAGE_SIZE,
    }
    return json.dumps(payload, ensure_ascii=False)


def _render_page_script(embed_data: str) -> str:
    return f"""
  <script>
    window.REPORT_DATA = {embed_data};
    (function () {{
      var data = window.REPORT_DATA || {{}};
      var allReviews = data.reviews || [];
      var skuColors = data.skuColors || [];
      var ratingColors = data.ratingColors || {{}};
      var pageSize = data.pageSize || 20;
      var currentPage = 1;

      var skuChecks = Array.prototype.slice.call(document.querySelectorAll(".sku-filter"));
      var rateChecks = Array.prototype.slice.call(document.querySelectorAll(".rate-filter"));
      var kwChecks = Array.prototype.slice.call(document.querySelectorAll(".kw-filter"));
      var rows = Array.prototype.slice.call(document.querySelectorAll("#review-table-body tr"));
      var kwRows = Array.prototype.slice.call(document.querySelectorAll(".kw-table tbody tr"));
      var wcWords = Array.prototype.slice.call(document.querySelectorAll(".wc-word"));
      var countEl = document.getElementById("review-count");
      var pageInfo = document.getElementById("page-info");
      var pagePrev = document.getElementById("page-prev");
      var pageNext = document.getElementById("page-next");
      var pagination = document.getElementById("table-pagination");

      function selectedSkuBySection() {{
        var spec = [];
        var color = [];
        skuChecks.forEach(function (cb) {{
          if (!cb.checked) return;
          var section = cb.dataset.section || "";
          var value = cb.dataset.value || "";
          if (!value) return;
          if (section === "color") color.push(value);
          else spec.push(value);
        }});
        return {{ spec: spec, color: color }};
      }}

      function skuValueMatches(value, selected) {{
        if (!value || !selected.length) return false;
        return selected.some(function (target) {{
          if (!target) return false;
          if (value === target) return true;
          if (value.indexOf(target) >= 0) return true;
          if (target.indexOf(value) >= 0) return true;
          return false;
        }});
      }}

      function reviewMatchesSku(review, sections) {{
        var specSelected = sections.spec || [];
        var colorSelected = sections.color || [];
        if (!specSelected.length && !colorSelected.length) return true;

        var skuName = review.sku_name || "";
        var skuMap = review.sku_map || {{}};
        var specValues = [];
        var colorValues = [];
        Object.keys(skuMap).forEach(function (prop) {{
          var value = skuMap[prop] || "";
          if (!value) return;
          if (prop.indexOf("颜色") >= 0) colorValues.push(value);
          else specValues.push(value);
        }});

        function matchesSection(selected, scopedValues) {{
          if (!selected.length) return true;
          if (skuName && skuValueMatches(skuName, selected)) return true;
          if (scopedValues.some(function (value) {{ return skuValueMatches(value, selected); }})) {{
            return true;
          }}
          var allValues = Object.keys(skuMap).map(function (key) {{ return skuMap[key]; }});
          return allValues.some(function (value) {{ return skuValueMatches(value, selected); }});
        }}

        return matchesSection(specSelected, specValues)
          && matchesSection(colorSelected, colorValues);
      }}

      function reviewMatchesKeyword(review, keywords) {{
        if (!keywords.length) return true;
        var text = (review.feedback || "") + " " + (review.append_feedback || "");
        return keywords.some(function (kw) {{ return kw && text.indexOf(kw) >= 0; }});
      }}

      function selectedKeywords() {{
        var selected = [];
        kwChecks.forEach(function (cb) {{
          if (cb.checked) selected.push(cb.dataset.keyword || "");
        }});
        return selected;
      }}

      function selectedRateLevels() {{
        var selected = [];
        rateChecks.forEach(function (cb) {{
          if (cb.checked) selected.push(cb.dataset.level || "");
        }});
        return selected;
      }}

      function reviewMatchesRate(review, levels) {{
        if (!levels.length) return true;
        return levels.indexOf(review.rate_level || "") >= 0;
      }}

      function filteredReviews() {{
        var sections = selectedSkuBySection();
        var keywords = selectedKeywords();
        var rateLevels = selectedRateLevels();
        return allReviews.filter(function (review) {{
          return reviewMatchesSku(review, sections)
            && reviewMatchesKeyword(review, keywords)
            && reviewMatchesRate(review, rateLevels);
        }});
      }}

      function filteredIndexSet(filtered) {{
        var set = {{}};
        filtered.forEach(function (review) {{ set[review.index] = true; }});
        return set;
      }}

      function renderRateDonut(filtered) {{
        var chartBox = document.getElementById("rate-donut-chart");
        var legendBox = document.getElementById("rate-donut-legend");
        if (!chartBox || !legendBox) return;
        var counts = {{ "好评": 0, "中评": 0, "差评": 0 }};
        filtered.forEach(function (review) {{
          if (counts[review.rate_level] !== undefined) counts[review.rate_level] += 1;
        }});
        var levels = ["好评", "中评", "差评"];
        var total = levels.reduce(function (sum, level) {{ return sum + (counts[level] || 0); }}, 0);
        if (!total) {{
          chartBox.innerHTML = '<p class="empty muted">无匹配评价</p>';
          rateChecks.forEach(function (cb) {{
            var item = cb.closest(".rate-filter-item");
            if (!item) return;
            var valueEl = item.querySelector(".rate-filter-value");
            var pctEl = item.querySelector(".rate-filter-pct");
            if (valueEl) valueEl.textContent = "0";
            if (pctEl) pctEl.textContent = "0%";
          }});
          return;
        }}
        var size = 188, cx = size / 2, cy = size / 2, radius = 58, stroke = 20;
        var circumference = 2 * Math.PI * radius;
        var offset = 0;
        var rings = [];
        levels.forEach(function (level) {{
          var count = counts[level] || 0;
          if (count <= 0) return;
          var color = ratingColors[level] || "#2563eb";
          var length = circumference * count / total;
          var gap = circumference - length;
          rings.push(
            '<circle cx="' + cx + '" cy="' + cy + '" r="' + radius + '" fill="none" ' +
            'stroke="' + color + '" stroke-width="' + stroke + '" ' +
            'stroke-dasharray="' + length + ' ' + gap + '" stroke-dashoffset="' + (-offset) + '" ' +
            'transform="rotate(-90 ' + cx + ' ' + cy + ')"><title>' + level + ' · ' + count + '</title></circle>'
          );
          offset += length;
        }});
        chartBox.innerHTML =
          '<svg class="donut-chart" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="好评中评差评分布">' +
          rings.join("") +
          '<text class="donut-total" x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle">' + total + '</text>' +
          '<text class="donut-sub" x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle">条评价</text></svg>';
        rateChecks.forEach(function (cb) {{
          var level = cb.dataset.level || "";
          var item = cb.closest(".rate-filter-item");
          if (!item) return;
          var count = counts[level] || 0;
          var pct = total ? Math.round(count / total * 100) : 0;
          var valueEl = item.querySelector(".rate-filter-value");
          var pctEl = item.querySelector(".rate-filter-pct");
          if (valueEl) valueEl.textContent = String(count);
          if (pctEl) pctEl.textContent = pct + "%";
        }});
      }}

      function renderSkuDonut(filtered) {{
        var chartBox = document.getElementById("sku-donut-chart");
        var legendBox = document.getElementById("sku-donut-legend");
        if (!chartBox || !legendBox) return;
        var counter = {{}};
        filtered.forEach(function (review) {{
          var sku = (review.sku_name || "").trim() || "未知 SKU";
          counter[sku] = (counter[sku] || 0) + 1;
        }});
        var items = Object.keys(counter).map(function (key) {{
          return [key, counter[key]];
        }}).sort(function (a, b) {{ return b[1] - a[1]; }});
        var total = filtered.length;
        if (!total) {{
          chartBox.innerHTML = '<p class="empty muted">无匹配评价</p>';
          legendBox.innerHTML = "";
          return;
        }}
        var size = 188, cx = size / 2, cy = size / 2, radius = 58, stroke = 20;
        var circumference = 2 * Math.PI * radius;
        var offset = 0;
        var rings = [];
        items.forEach(function (entry, index) {{
          var sku = entry[0], count = entry[1];
          var length = circumference * count / total;
          var gap = circumference - length;
          var color = skuColors[index % skuColors.length] || "#2563eb";
          rings.push(
            '<circle cx="' + cx + '" cy="' + cy + '" r="' + radius + '" fill="none" ' +
            'stroke="' + color + '" stroke-width="' + stroke + '" ' +
            'stroke-dasharray="' + length + ' ' + gap + '" stroke-dashoffset="' + (-offset) + '" ' +
            'transform="rotate(-90 ' + cx + ' ' + cy + ')"><title>' + sku + ' · ' + count + '</title></circle>'
          );
          offset += length;
        }});
        chartBox.innerHTML =
          '<svg class="donut-chart" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="SKU 分布环状图">' +
          rings.join("") +
          '<text class="donut-total" x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle">' + total + '</text>' +
          '<text class="donut-sub" x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle">条评价</text></svg>';
        legendBox.innerHTML = '<ul class="donut-legend sku-legend">' + items.map(function (entry, index) {{
          var sku = entry[0], count = entry[1];
          var pct = Math.round(count / total * 100);
          var color = skuColors[index % skuColors.length] || "#2563eb";
          var shortSku = sku.length <= 16 ? sku : sku.slice(0, 15) + "…";
          return '<li class="donut-legend-item"><span class="donut-dot" style="background:' + color +
            '"></span><span class="donut-label" title="' + sku + '">' + shortSku +
            '</span><span class="donut-value">' + count + '</span><span class="donut-pct">' + pct + '%</span></li>';
        }}).join("") + '</ul>';
      }}

      function buildTrendSeries(filtered) {{
        var daily = {{}};
        filtered.forEach(function (review) {{
          var m = (review.feedback_date || "").match(/(\\d{{4}})年(\\d{{1,2}})月(\\d{{1,2}})日/);
          if (!m) return;
          var key = m[1] + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[3]).padStart(2, "0");
          daily[key] = (daily[key] || 0) + 1;
        }});
        var keys = Object.keys(daily).sort();
        var labels = [], dailyCounts = [], cumulative = [], running = 0;
        keys.forEach(function (key) {{
          var parts = key.split("-");
          labels.push(parseInt(parts[1], 10) + "/" + parseInt(parts[2], 10));
          var count = daily[key];
          dailyCounts.push(count);
          running += count;
          cumulative.push(running);
        }});
        return {{ labels: labels, daily: dailyCounts, cumulative: cumulative }};
      }}

      function renderTrendSvg(labels, values, svgId, gradientId, ariaLabel) {{
        if (!labels.length) return '<p class="empty muted">暂无有效初评日期，无法生成趋势图。</p>';
        var width = 480, height = 220;
        var padL = 44, padR = 16, padT = 24, padB = 44;
        var plotW = width - padL - padR, plotH = height - padT - padB;
        var n = labels.length;
        var yMax = Math.max.apply(null, values.concat([1]));
        function xAt(i) {{ return n <= 1 ? padL + plotW / 2 : padL + i / (n - 1) * plotW; }}
        function yAt(v) {{ return padT + plotH - v / yMax * plotH; }}
        var points = values.map(function (v, i) {{ return [xAt(i), yAt(v), v]; }});
        var linePath = points.map(function (p) {{ return p[0] + "," + p[1]; }}).join(" ");
        var areaPath = "M " + points[0][0] + "," + (padT + plotH) + " " +
          points.map(function (p) {{ return "L " + p[0] + "," + p[1]; }}).join(" ") +
          " L " + points[points.length - 1][0] + "," + (padT + plotH) + " Z";
        var labelStep = Math.max(1, Math.floor((n + 11) / 12));
        var dots = points.map(function (p) {{
          return '<circle class="chart-dot" cx="' + p[0] + '" cy="' + p[1] + '" r="4"></circle>';
        }}).join("");
        var valueLabels = points.map(function (p) {{
          return '<text class="value-label" x="' + p[0] + '" y="' + (p[1] - 10) + '" text-anchor="middle">' + p[2] + '</text>';
        }}).join("");
        var xLabels = points.map(function (p, i) {{
          if (i % labelStep !== 0 && i !== n - 1) return "";
          return '<text class="axis-label x-label" x="' + p[0] + '" y="' + (padT + plotH + 22) + '" text-anchor="middle">' + labels[i] + '</text>';
        }}).join("");
        return '<svg id="' + svgId + '" class="trend-chart" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + ariaLabel + '">' +
          '<defs><linearGradient id="' + gradientId + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#2563eb" stop-opacity="0.14"/><stop offset="100%" stop-color="#2563eb" stop-opacity="0"/></linearGradient></defs>' +
          '<path fill="url(#' + gradientId + ')" d="' + areaPath + '"></path>' +
          '<polyline class="chart-line" points="' + linePath + '"></polyline>' + dots + valueLabels + xLabels + '</svg>';
      }}

      function updateTrendCharts(filtered) {{
        var wrap = document.querySelector(".trend-chart-wrap");
        if (!wrap) return;
        var series = buildTrendSeries(filtered);
        if (!series.labels.length) {{
          wrap.innerHTML = '<p class="empty muted">暂无有效初评日期，无法生成趋势图。</p>';
          return;
        }}
        var activeMode = "cumulative";
        var activeBtn = document.querySelector(".chart-mode-btn.is-active");
        if (activeBtn) activeMode = activeBtn.getAttribute("data-mode") || "cumulative";
        wrap.innerHTML =
          '<div class="trend-chart-panel' + (activeMode === "cumulative" ? "" : " is-hidden") + '" data-mode="cumulative">' +
          renderTrendSvg(series.labels, series.cumulative, "trend-chart-cumulative", "trendAreaCumulative", "累计评价数折线图") +
          '</div><div class="trend-chart-panel' + (activeMode === "daily" ? "" : " is-hidden") + '" data-mode="daily">' +
          renderTrendSvg(series.labels, series.daily, "trend-chart-daily", "trendAreaDaily", "单日评价数折线图") +
          "</div>";
      }}

      function updateKeywordPanel(indexSet, filtered) {{
        kwRows.forEach(function (row) {{
          var indices = [];
          try {{ indices = JSON.parse(row.getAttribute("data-indices") || "[]"); }} catch (e) {{}}
          var visibleCount = indices.filter(function (i) {{ return indexSet[i]; }}).length;
          row.classList.toggle("is-hidden", visibleCount <= 0);
          var countCell = row.querySelector(".kw-count");
          if (countCell) countCell.textContent = visibleCount;
        }});
        wcWords.forEach(function (node) {{
          var word = node.getAttribute("data-word") || "";
          var item = (data.keywords || []).find(function (entry) {{ return entry.word === word; }});
          var visible = false;
          if (item && item.indices) {{
            visible = item.indices.some(function (i) {{ return indexSet[i]; }});
          }}
          node.style.opacity = visible ? "1" : "0.12";
        }});
      }}

      function applyPagination(matchedIndices) {{
        var total = allReviews.length;
        var matched = matchedIndices;
        var totalPages = Math.max(1, Math.ceil(matched.length / pageSize));
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;
        var start = (currentPage - 1) * pageSize;
        var end = start + pageSize;
        var visibleAt = {{}};
        matched.slice(start, end).forEach(function (idx) {{ visibleAt[idx] = true; }});

        rows.forEach(function (row) {{
          var idx = parseInt(row.getAttribute("data-review-index") || "-1", 10);
          var matchedRow = matchedIndices.indexOf(idx) >= 0;
          row.classList.toggle("is-hidden", !matchedRow);
          if (!matchedRow) {{
            row.classList.add("is-paged-out");
            return;
          }}
          row.classList.toggle("is-paged-out", !visibleAt[idx]);
        }});

        if (pageInfo) pageInfo.textContent = "第 " + currentPage + " / " + totalPages + " 页";
        if (pagePrev) pagePrev.disabled = currentPage <= 1;
        if (pageNext) pageNext.disabled = currentPage >= totalPages;
        if (pagination) pagination.style.display = matched.length > pageSize ? "flex" : "none";
        if (countEl) {{
          if (!matched.length) {{
            var sections = selectedSkuBySection();
            var hasFilter = sections.spec.length || sections.color.length
              || selectedKeywords().length || selectedRateLevels().length;
            countEl.textContent = hasFilter
              ? "无匹配 · 共 " + total + " 条"
              : "共 " + total + " 条";
            return;
          }}
          var from = start + 1;
          var to = Math.min(end, matched.length);
          countEl.textContent = "第 " + from + "-" + to + " 条 · 匹配 " + matched.length + " / 共 " + total + " 条";
        }}
      }}

      function applyFilters() {{
        var filtered = filteredReviews();
        var indexSet = filteredIndexSet(filtered);
        var matchedIndices = filtered.map(function (r) {{ return r.index; }});
        renderRateDonut(filtered);
        renderSkuDonut(filtered);
        updateTrendCharts(filtered);
        updateKeywordPanel(indexSet, filtered);
        applyPagination(matchedIndices);
      }}

      function onFilterChange() {{
        currentPage = 1;
        applyFilters();
      }}

      skuChecks.forEach(function (cb) {{
        cb.addEventListener("change", function () {{
          cb.closest(".sku-filter-item").classList.toggle("is-active", cb.checked);
          onFilterChange();
        }});
      }});
      rateChecks.forEach(function (cb) {{
        cb.addEventListener("change", function () {{
          cb.closest(".rate-filter-item").classList.toggle("is-active", cb.checked);
          onFilterChange();
        }});
      }});
      kwChecks.forEach(function (cb) {{
        cb.addEventListener("change", function () {{
          var row = cb.closest("tr");
          if (row) row.classList.toggle("is-active", cb.checked);
          onFilterChange();
        }});
      }});
      if (pagePrev) {{
        pagePrev.addEventListener("click", function () {{
          if (currentPage > 1) {{ currentPage -= 1; applyFilters(); }}
        }});
      }}
      if (pageNext) {{
        pageNext.addEventListener("click", function () {{
          currentPage += 1; applyFilters();
        }});
      }}

      document.querySelectorAll(".chart-mode-btn").forEach(function (btn) {{
        btn.addEventListener("click", function () {{
          var mode = btn.getAttribute("data-mode");
          if (!mode) return;
          document.querySelectorAll(".chart-mode-btn").forEach(function (item) {{
            var active = item === btn;
            item.classList.toggle("is-active", active);
            item.setAttribute("aria-selected", active ? "true" : "false");
          }});
          document.querySelectorAll(".trend-chart-panel").forEach(function (panel) {{
            panel.classList.toggle("is-hidden", panel.getAttribute("data-mode") !== mode);
          }});
        }});
      }});

      applyFilters();
    }})();
  </script>"""


def _render_insights_section(result: SkillOutput) -> str:
    insights_md = str(result.insights_review or "").strip()
    artifacts = result.insights_artifacts or {}
    md_path = str(artifacts.get("review_md") or "").strip()

    if insights_md:
        body = render_insights_block(insights_md)
        if body:
            return (
                '<section class="panel insights-panel">'
                '<div class="panel-head insights-panel-head">'
                '<h2>分析结论</h2>'
                '<span class="report-ai-badge">AI 洞察</span>'
                "</div>"
                f"{body}"
                "</section>"
            )

    hint = (
        f"请将评价 AI 分析写入：<code>{escape(md_path)}</code>，"
        "然后执行 <code>python -m product_reviews report --input &lt;json&gt;</code> 重新生成报告。"
        if md_path
        else "请先写入评价分析 Markdown 文件后执行 report 子命令。"
    )
    return (
        '<section class="panel insights-panel insights-panel-pending">'
        '<div class="panel-head insights-panel-head">'
        '<h2>分析结论</h2>'
        "</div>"
        '<div class="placeholder-box">'
        "<strong>待补充 AI 分析结论</strong>"
        f"<p>{hint}</p>"
        "</div>"
        "</section>"
    )


def _build_html(result: SkillOutput) -> str:
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    reviews = result.reviews or []
    table_html = _render_reviews_table(reviews)
    hero_title = _hero_title(result)
    overview_html = _render_overview_section(result)
    distribution_html = _render_distribution_section(result)
    insights_html = _render_insights_section(result)
    keywords_html = _render_keywords_section(result)

    item_link = (
        f"https://detail.tmall.com/item.htm?id={escape(result.item_id)}"
        if result.item_id
        else ""
    )
    item_link_html = (
        f'<a class="item-link" href="{item_link}" target="_blank" rel="noreferrer">查看商品页</a>'
        if item_link
        else ""
    )
    header_html = _render_header(
        result,
        hero_title=hero_title,
        generated_at=generated_at,
        item_link_html=item_link_html,
    )
    embed_data = _build_report_embed_data(result)
    page_script = _render_page_script(embed_data)

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(hero_title)} 评价报告</title>
  <style>
    :root {{
      --bg: #eef4fb;
      --panel: rgba(255, 255, 255, 0.96);
      --line: #d4e3f4;
      --line-strong: #bfdbfe;
      --text: #1e293b;
      --text-secondary: #475569;
      --muted: #64748b;
      --muted-light: #94a3b8;
      --accent: #2563eb;
      --accent-strong: #1d4ed8;
      --accent-hover: #1d4ed8;
      --accent-soft: #dbeafe;
      --accent-muted: #bfdbfe;
      --chip: #eff6ff;
      --warn: #dc2626;
      --shadow: 0 18px 48px rgba(37, 99, 235, 0.1);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: #f8fafc;
      color: var(--text);
      font: 14px/1.65 "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      -webkit-font-smoothing: antialiased;
    }}
    .report-header {{
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 24px;
      border-bottom: 1px solid #dbeafe;
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(12px);
    }}
    .report-header-left {{
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      min-width: 0;
    }}
    .report-logo {{
      width: 28px;
      height: 28px;
      border-radius: 4px;
      background: #2563eb;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }}
    .report-header-title {{
      min-width: 0;
    }}
    .report-header h1 {{
      margin: 0;
      font-size: 16px;
      font-weight: 500;
      letter-spacing: -0.01em;
      line-height: 1.35;
    }}
    .report-header-sub {{
      margin: 2px 0 0;
      font-size: 12px;
      color: var(--muted);
      line-height: 1.4;
      max-width: min(640px, 52vw);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }}
    .report-header-meta {{
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 16px;
      font-size: 14px;
      color: var(--muted);
    }}
    .report-header-meta strong {{
      color: #1e293b;
      font-weight: 600;
    }}
    .report-header-meta .accent {{
      color: #1d4ed8;
    }}
    .page {{
      width: min(1200px, calc(100vw - 24px));
      margin: 0 auto;
      padding: 20px 0 32px;
    }}
    .panel, .insight-panel {{
      background: var(--panel);
      border: 1px solid rgba(212, 227, 244, 0.95);
      border-radius: 16px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(8px);
    }}
    .insight-panel {{
      padding: 0;
      margin-bottom: 12px;
      overflow: hidden;
    }}
    .insight-split {{
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }}
    .insight-split + .insight-split {{
      border-top: 1px solid var(--line);
    }}
    .insight-left {{
      padding: 14px 18px 12px;
      border-right: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(239,246,255,0.45) 100%);
    }}
    .insight-right {{
      padding: 14px 18px 12px;
      background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(239,246,255,0.45) 100%);
    }}
    .insight-hint {{
      margin: 0 0 8px;
      font-size: 11px;
      color: var(--muted);
    }}
    .insight-title,
    .panel-head h2 {{
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 10px;
      font-size: 13px;
      line-height: 1.3;
      font-weight: 600;
      color: var(--text);
    }}
    .insight-title::before,
    .panel-head h2::before {{
      content: "";
      width: 3px;
      height: 13px;
      border-radius: 2px;
      background: linear-gradient(180deg, #60a5fa, #2563eb);
      flex-shrink: 0;
    }}
    .insight-head {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }}
    .insight-head .insight-title {{
      margin: 0;
    }}
    .count-badge {{
      font-size: 11px;
      color: var(--text-secondary);
      font-variant-numeric: tabular-nums;
      padding: 3px 10px;
      background: var(--chip);
      border: 1px solid var(--accent-muted);
      border-radius: 999px;
      color: var(--muted);
    }}
    .kw-table-wrap {{
      overflow: auto;
      max-height: 252px;
      border: 1px solid rgba(212, 227, 244, 0.95);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.94);
    }}
    .kw-table {{
      width: 100%;
      border-collapse: collapse;
    }}
    .kw-table th,
    .kw-table td {{
      border-bottom: 1px solid var(--line);
      padding: 6px 10px;
      text-align: left;
      vertical-align: middle;
      font-size: 12px;
    }}
    .kw-table tr:last-child td {{
      border-bottom: none;
    }}
    .kw-table th {{
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--chip);
      color: var(--text-secondary);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
    }}
    .kw-table tbody tr {{
      transition: background 0.15s ease;
    }}
    .kw-table tbody tr:hover {{
      background: rgba(239, 246, 255, 0.85);
    }}
    .kw-table tbody tr.is-active {{
      background: var(--accent-soft);
    }}
    .kw-table tbody tr.is-active .kw-word label {{
      color: var(--accent-strong);
      font-weight: 600;
    }}
    .kw-table .kw-check {{
      width: 32px;
      text-align: center;
    }}
    .kw-table .kw-count {{
      width: 64px;
      text-align: center;
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      font-weight: 600;
      color: var(--accent-strong);
    }}
    .kw-table .kw-word label {{
      cursor: pointer;
      color: var(--text-secondary);
      transition: color 0.15s ease;
    }}
    .kw-filter {{
      width: 14px;
      height: 14px;
      cursor: pointer;
      accent-color: var(--accent);
      border-radius: 3px;
    }}
    .review-table tbody tr.is-hidden,
    .review-table tbody tr.is-paged-out {{
      display: none;
    }}
    .word-cloud-wrap {{
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 200px;
      background: radial-gradient(ellipse at center, rgba(239,246,255,0.95) 0%, #fff 72%);
      border-radius: 10px;
      border: 1px solid rgba(212, 227, 244, 0.6);
    }}
    .word-cloud {{
      width: 100%;
      height: auto;
      display: block;
    }}
    .wc-word {{
      font-family: inherit;
      font-weight: 500;
      cursor: default;
    }}
    .impr-chart-wrap,
    .chart-wrap {{
      margin-top: 2px;
    }}
    .chart-mode-switch {{
      display: inline-flex;
      padding: 2px;
      background: var(--chip);
      border: 1px solid var(--accent-muted);
      border-radius: 8px;
      gap: 2px;
      flex-shrink: 0;
    }}
    .chart-mode-btn {{
      padding: 3px 10px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.4;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
    }}
    .chart-mode-btn:hover {{
      color: var(--text-secondary);
    }}
    .chart-mode-btn.is-active {{
      background: #fff;
      color: var(--accent-strong);
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(37, 99, 235, 0.12);
    }}
    .trend-chart-panel.is-hidden {{
      display: none;
    }}
    .impr-chart,
    .trend-chart {{
      width: 100%;
      height: auto;
      display: block;
    }}
    .impr-grid,
    .grid-line {{
      stroke: rgba(219, 234, 254, 0.85);
      stroke-width: 1;
    }}
    .impr-axis {{
      stroke: var(--line-strong);
      stroke-width: 1;
    }}
    .impr-value,
    .value-label {{
      fill: var(--accent-strong);
      font-size: 10px;
      font-weight: 600;
    }}
    .impr-x-label,
    .impr-y-label,
    .axis-label {{
      fill: var(--muted);
      font-size: 10px;
    }}
    .panel {{
      padding: 14px 18px 16px;
    }}
    .panel-head {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }}
    .panel-head h2 {{
      margin: 0;
    }}
    .insights-panel {{
      margin-bottom: 12px;
    }}
    .insights-panel-head {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }}
    .insights-panel-head h2 {{
      margin: 0;
    }}
    .report-ai-badge {{
      font-size: 12px;
      font-weight: 500;
      color: #2563eb;
      background: #eff6ff;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid #bfdbfe;
      white-space: nowrap;
    }}
    .insights-block {{
      padding: 2px 0 0;
    }}
    .insights-section {{
      margin-bottom: 16px;
    }}
    .insights-section:last-child {{
      margin-bottom: 0;
    }}
    .insights-section-title {{
      margin: 0 0 8px;
      font-size: 14px;
      font-weight: 700;
      color: var(--accent-strong);
    }}
    .insights-section-body {{
      font-size: 13px;
      color: var(--text);
      line-height: 1.65;
    }}
    .insights-section-body p {{
      margin: 0 0 6px;
    }}
    .insights-section-body p:last-child {{
      margin-bottom: 0;
    }}
    .insights-section-body ul,
    .insights-section-body ol {{
      margin: 0;
      padding-left: 1.2em;
    }}
    .insights-section-body li {{
      margin-bottom: 4px;
    }}
    .insights-section-body li:last-child {{
      margin-bottom: 0;
    }}
    .insights-section-body strong {{
      font-weight: 700;
      color: var(--accent-strong);
    }}
    .insights-section-body table {{
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0 12px;
      font-size: 12px;
      line-height: 1.5;
    }}
    .insights-section-body th,
    .insights-section-body td {{
      border: 1px solid rgba(212, 227, 244, 0.95);
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }}
    .insights-section-body th {{
      background: rgba(239, 246, 255, 0.9);
      font-weight: 600;
      color: var(--accent-strong);
      white-space: nowrap;
    }}
    .insights-section-body tr:nth-child(even) td {{
      background: rgba(248, 250, 255, 0.6);
    }}
    .placeholder-box {{
      padding: 28px 20px;
      text-align: center;
      border-radius: 12px;
      border: 1px dashed rgba(212, 227, 244, 0.95);
      background: rgba(248, 250, 255, 0.72);
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
    }}
    .placeholder-box strong {{
      display: block;
      margin-bottom: 8px;
      color: var(--text);
      font-size: 15px;
    }}
    .placeholder-box code {{
      font-size: 12px;
      color: var(--accent-strong);
      word-break: break-all;
    }}
    .chart-line {{
      fill: none;
      stroke: var(--accent-strong);
      stroke-width: 2;
      stroke-linejoin: round;
      stroke-linecap: round;
    }}
    .chart-dot {{
      fill: #fff;
      stroke: var(--accent-strong);
      stroke-width: 1.5;
    }}
    .table-wrap {{
      overflow: auto;
      border: 1px solid rgba(212, 227, 244, 0.95);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.94);
    }}
    .review-table {{
      width: 100%;
      min-width: 1080px;
      border-collapse: collapse;
      background: #fff;
    }}
    .review-table th,
    .review-table td {{
      border-bottom: 1px solid var(--line);
      padding: 7px 10px;
      vertical-align: top;
      text-align: left;
      font-size: 12px;
    }}
    .review-table tr:last-child td {{
      border-bottom: none;
    }}
    .review-table th {{
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--chip);
      color: var(--text-secondary);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.03em;
      white-space: nowrap;
    }}
    .review-table tbody tr {{
      transition: background 0.12s ease;
    }}
    .review-table tbody tr:nth-child(even) {{
      background: rgba(239, 246, 255, 0.55);
    }}
    .review-table tbody tr:hover {{
      background: rgba(219, 234, 254, 0.65) !important;
    }}
    .review-table th:first-child,
    .review-table td:first-child {{
      width: 36px;
      max-width: 40px;
      padding: 7px 4px;
      text-align: center;
    }}
    .review-table td:first-child {{
      color: var(--accent-strong);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }}
    .cell-index {{
      display: inline-block;
      min-width: 0;
      font-variant-numeric: tabular-nums;
    }}
    .cell-text {{
      white-space: pre-wrap;
      word-break: break-word;
      min-width: 80px;
      max-width: 240px;
      color: var(--text-secondary);
      line-height: 1.5;
    }}
    .review-table td:nth-child(3) .cell-text {{
      min-width: 100px;
      max-width: 160px;
    }}
    .review-table td:nth-child(7) .cell-text,
    .review-table td:nth-child(8) .cell-text {{
      min-width: 220px;
      max-width: 420px;
    }}
    .review-table td:nth-child(6),
    .review-table td:nth-child(9) {{
      white-space: nowrap;
    }}
    .review-table td:last-child {{
      white-space: nowrap;
      text-align: center;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }}
    .muted {{
      color: var(--muted);
    }}
    .media-cell {{
      display: inline-flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: 5px;
      max-width: none;
      overflow-x: auto;
      vertical-align: top;
    }}
    .media-thumb {{
      display: block;
      width: 30px;
      height: 30px;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid var(--line);
      background: #fff;
      flex: 0 0 auto;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }}
    .media-thumb:hover {{
      border-color: var(--accent-muted);
      box-shadow: 0 0 0 2px var(--accent-soft);
    }}
    .media-thumb img {{
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }}
    .media-link {{
      color: var(--accent);
      font-size: 11px;
      font-weight: 500;
    }}
    .empty {{
      color: var(--muted);
      text-align: center;
      padding: 20px 12px;
      font-size: 12px;
    }}
    .table-pagination {{
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 12px;
      margin-top: 10px;
      padding-top: 2px;
    }}
    .page-btn {{
      padding: 4px 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text-secondary);
      font-size: 12px;
      cursor: pointer;
      transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
    }}
    .page-btn:hover:not(:disabled) {{
      border-color: var(--accent-muted);
      color: var(--accent-strong);
      background: var(--accent-soft);
    }}
    .page-btn:disabled {{
      opacity: 0.45;
      cursor: not-allowed;
    }}
    .page-info {{
      font-size: 12px;
      color: var(--text-secondary);
      font-variant-numeric: tabular-nums;
      min-width: 72px;
      text-align: center;
    }}
    .donut-wrap {{
      display: flex;
      align-items: center;
      gap: 16px;
      min-height: 188px;
    }}
    .donut-chart-box {{
      flex: 0 0 188px;
    }}
    .rate-filter-side {{
      flex: 1;
      min-width: 0;
    }}
    .rate-filter-list {{
      display: flex;
      flex-direction: column;
      gap: 4px;
    }}
    .rate-filter-item {{
      display: grid;
      grid-template-columns: auto 10px 1fr auto auto;
      gap: 8px;
      align-items: center;
      padding: 6px 8px;
      border-radius: 8px;
      border: 1px solid transparent;
      font-size: 12px;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s, border-color 0.15s;
    }}
    .rate-filter-item:hover {{
      background: rgba(239, 246, 255, 0.8);
    }}
    .rate-filter-item.is-active {{
      background: rgba(239, 246, 255, 0.95);
      border-color: rgba(191, 219, 254, 0.95);
    }}
    .rate-filter-item input {{
      margin: 0;
      accent-color: #2563eb;
    }}
    .rate-filter-label {{
      color: var(--text-secondary);
      font-weight: 500;
    }}
    .rate-filter-value {{
      color: var(--text);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }}
    .rate-filter-pct {{
      color: var(--muted);
      font-variant-numeric: tabular-nums;
      min-width: 32px;
      text-align: right;
    }}
    .donut-chart {{
      width: 188px;
      height: 188px;
      display: block;
    }}
    .donut-total {{
      fill: var(--text);
      font-size: 22px;
      font-weight: 700;
    }}
    .donut-sub {{
      fill: var(--muted);
      font-size: 10px;
    }}
    .donut-legend {{
      list-style: none;
      margin: 0;
      padding: 0;
      flex: 1;
      min-width: 0;
    }}
    .donut-legend-item {{
      display: grid;
      grid-template-columns: 10px 1fr auto auto;
      gap: 8px;
      align-items: center;
      padding: 5px 0;
      font-size: 12px;
      border-bottom: 1px solid var(--line);
    }}
    .donut-legend-item:last-child {{
      border-bottom: none;
    }}
    .donut-dot {{
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: block;
    }}
    .donut-label {{
      color: var(--text-secondary);
    }}
    .donut-value {{
      color: var(--text);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }}
    .donut-pct {{
      color: var(--muted);
      font-variant-numeric: tabular-nums;
      min-width: 32px;
      text-align: right;
    }}
    .sku-legend {{
      max-height: 188px;
      overflow-y: auto;
      padding-right: 2px;
    }}
    .sku-legend .donut-label {{
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }}
    .sku-filter-panel {{
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 300px;
      overflow: auto;
      padding-right: 4px;
    }}
    .sku-filter-panel .insight-title {{
      margin-bottom: 4px;
    }}
    .sku-filter-group {{
      border: 1px solid rgba(212, 227, 244, 0.95);
      border-radius: 10px;
      padding: 8px 10px;
      background: rgba(255, 255, 255, 0.94);
    }}
    .sku-filter-title {{
      margin: 0 0 6px;
      font-size: 11px;
      font-weight: 600;
      color: var(--muted);
      letter-spacing: 0.03em;
    }}
    .sku-filter-list {{
      display: flex;
      flex-direction: column;
      gap: 4px;
    }}
    .sku-filter-item {{
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 6px;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.12s ease;
    }}
    .sku-filter-item:hover {{
      background: rgba(239, 246, 255, 0.9);
    }}
    .sku-filter-item.is-active {{
      background: rgba(219, 234, 254, 0.85);
    }}
    .sku-filter-thumb {{
      width: 24px;
      height: 24px;
      border-radius: 4px;
      object-fit: cover;
      border: 1px solid var(--line);
      flex-shrink: 0;
    }}
    .sku-filter-label {{
      font-size: 12px;
      color: var(--text-secondary);
      line-height: 1.35;
    }}
    .kw-table tr.is-hidden {{
      display: none;
    }}
    .item-link {{
      color: inherit;
      text-decoration: none;
      font-weight: 500;
    }}
    .item-link:hover {{
      text-decoration: underline;
    }}
    @media (max-width: 1024px) {{
      .report-header {{
        flex-direction: column;
        align-items: flex-start;
      }}
    }}
    @media (max-width: 720px) {{
      .page {{ width: calc(100vw - 16px); }}
      .report-header {{ padding: 14px 16px; }}
      .report-header-sub {{ max-width: 100%; }}
    }}
  </style>
</head>
<body>
  {header_html}
  <main class="page">
    {insights_html}

    {distribution_html}

    {overview_html}

    {keywords_html}

    <section class="panel">
      <div class="panel-head">
        <h2>评价明细</h2>
        <span class="count-badge" id="review-count">共 {escape(str(result.collected_count))} 条</span>
      </div>
      {table_html}
    </section>
  </main>
  {page_script}
</body>
</html>"""
