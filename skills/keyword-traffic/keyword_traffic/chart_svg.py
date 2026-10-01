"""纯 SVG 折线图生成（无 JS / 无 CDN 依赖）。"""

from __future__ import annotations

from html import escape
from typing import Any, Sequence


def _valid_values(values: Sequence[float | None]) -> list[float]:
    return [v for v in values if v is not None]


def _format_tick(value: float, *, percent: bool = False) -> str:
    if percent:
        return f"{value:.1f}%"
    if abs(value) >= 1000:
        return f"{value / 1000:.1f}k"
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.1f}"


def _format_raw(value: float | None, *, is_percent: bool = False) -> str:
    if value is None:
        return "-"
    if is_percent:
        return f"{value:.2f}%"
    if abs(value) >= 1000:
        return f"{value:,.0f}"
    if float(value).is_integer():
        return f"{int(value):,}"
    return f"{value:,.2f}"


def _normalize_series(values: Sequence[float | None]) -> list[float | None]:
    valid = _valid_values(values)
    if not valid:
        return [None] * len(values)
    vmin, vmax = min(valid), max(valid)
    if vmin == vmax:
        vmin -= abs(vmin) * 0.1 or 1.0
        vmax += abs(vmax) * 0.1 or 1.0
    span = vmax - vmin
    return [((v - vmin) / span * 100.0 if v is not None else None) for v in values]


def render_interactive_combined_chart(
    labels: Sequence[str],
    series: Sequence[dict[str, Any]],
    *,
    height: int = 420,
    empty_message: str = "暂无趋势数据",
) -> str:
    """生成单张可交互合并趋势图（Python + SVG + CSS，无需 JS）。

    交互：点击图例勾选切换指标；悬停数据点显示原始数值（SVG title）。
    各指标归一化到 0–100% 同屏对比，tooltip 展示真实值。

    series item: {"label", "values", "color", "is_percent"?: bool}
    """
    if not labels or not series:
        return f'<p class="muted chart-empty">{escape(empty_message)}</p>'

    normalized = []
    has_data = False
    for s in series:
        norm = _normalize_series(s.get("values", []))
        normalized.append(norm)
        if _valid_values(norm):
            has_data = True
    if not has_data:
        return f'<p class="muted chart-empty">{escape(empty_message)}</p>'

    width = 960
    pad_l, pad_r, pad_t, pad_b = 58, 24, 36, 48
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b
    n = len(labels)
    y_min, y_max = 0.0, 100.0

    def x_at(i: int) -> float:
        if n <= 1:
            return pad_l + plot_w / 2
        return pad_l + (i / (n - 1)) * plot_w

    def y_at(v: float) -> float:
        return pad_t + plot_h - ((v - y_min) / (y_max - y_min)) * plot_h

    toggle_inputs: list[str] = []
    legend_labels: list[str] = []
    toggle_css: list[str] = []
    svg_groups: list[str] = []

    for idx, s in enumerate(series):
        color = str(s.get("color", "#2563eb"))
        label = str(s.get("label", ""))
        is_percent = bool(s.get("is_percent", False))
        raw_values: list[float | None] = list(s.get("values", []))
        norm_values = normalized[idx]
        sid = f"series-{idx}"

        toggle_inputs.append(
            f'<input type="checkbox" id="{sid}" class="series-toggle" checked>'
        )
        legend_labels.append(
            f'<label for="{sid}" class="legend-item legend-{idx}" '
            f'style="--series-color:{color}">{escape(label)}</label>'
        )
        toggle_css.append(
            f"#{sid}:not(:checked) ~ .chart-area .{sid} {{ display: none; }}\n"
            f"#{sid}:not(:checked) ~ .chart-toolbar .legend-{idx} "
            f"{{ opacity: 0.42; text-decoration: line-through; }}"
        )

        points: list[tuple[int, float, float, float | None]] = []
        for i, (raw, norm) in enumerate(zip(raw_values, norm_values)):
            if norm is not None:
                points.append((i, x_at(i), y_at(norm), raw))

        if len(points) < 1:
            svg_groups.append(f'<g class="series {sid}"></g>')
            continue

        line_d = "M " + " L ".join(f"{x:.1f},{y:.1f}" for _, x, y, _ in points)
        area_d = (
            f"M {points[0][1]:.1f},{pad_t + plot_h} "
            + " L ".join(f"{x:.1f},{y:.1f}" for _, x, y, _ in points)
            + f" L {points[-1][1]:.1f},{pad_t + plot_h} Z"
        )

        dot_step = max(1, n // 50)
        dots: list[str] = []
        for i, x, y, raw in points:
            if i % dot_step and i != points[-1][0]:
                continue
            date_label = labels[i] if i < len(labels) else ""
            tip = f"{date_label}  {label}: {_format_raw(raw, is_percent=is_percent)}"
            dots.append(
                f'<circle class="chart-dot" cx="{x:.1f}" cy="{y:.1f}" r="7" '
                f'fill="{color}" fill-opacity="0">'
                f"<title>{escape(tip)}</title></circle>"
            )

        svg_groups.append(
            f'<g class="series {sid}">'
            f'<path class="series-area" d="{area_d}" fill="{color}" opacity="0.10"/>'
            f'<path class="series-line" d="{line_d}" fill="none" stroke="{color}" '
            f'stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>'
            f'<g class="chart-dots">{"".join(dots)}</g>'
            f"</g>"
        )

    grid_lines = []
    for i in range(5):
        gy = pad_t + (i / 4) * plot_h
        val = y_max - (i / 4) * (y_max - y_min)
        grid_lines.append(
            f'<line x1="{pad_l}" y1="{gy:.1f}" x2="{pad_l + plot_w}" y2="{gy:.1f}" '
            f'class="chart-grid"/>'
            f'<text x="{pad_l - 10}" y="{gy + 4:.1f}" class="chart-axis" text-anchor="end">'
            f"{escape(_format_tick(val, percent=True))}</text>"
        )

    x_ticks = []
    tick_count = min(10, n)
    if tick_count > 0:
        step = max(1, (n - 1) // (tick_count - 1)) if tick_count > 1 else 1
        seen: set[int] = set()
        for i in range(0, n, step):
            if i in seen:
                continue
            seen.add(i)
            tick = labels[i][5:] if len(labels[i]) >= 10 else labels[i]
            x_ticks.append(
                f'<text x="{x_at(i):.1f}" y="{height - 14}" class="chart-axis" '
                f'text-anchor="middle">{escape(tick)}</text>'
            )
        if (n - 1) not in seen and n > 1:
            tick = labels[-1][5:] if len(labels[-1]) >= 10 else labels[-1]
            x_ticks.append(
                f'<text x="{x_at(n - 1):.1f}" y="{height - 14}" class="chart-axis" '
                f'text-anchor="middle">{escape(tick)}</text>'
            )

    svg = (
        f'<svg viewBox="0 0 {width} {height}" class="chart-svg combined-chart-svg" '
        f'preserveAspectRatio="xMidYMid meet" role="img" '
        f'aria-label="关键词多指标趋势图">'
        + "".join(grid_lines)
        + f'<rect x="{pad_l}" y="{pad_t}" width="{plot_w}" height="{plot_h}" '
        f'fill="none" stroke="rgba(212,227,244,0.6)" stroke-width="1"/>'
        + "".join(svg_groups)
        + "".join(x_ticks)
        + "</svg>"
    )

    return (
        f'<div class="combined-chart-wrap">'
        f'<style>{"".join(toggle_css)}</style>'
        + "".join(toggle_inputs)
        + '<div class="chart-toolbar">'
        + '<p class="chart-hint muted">点击图例切换指标 · 悬停圆点查看原始数值 · 无需联网</p>'
        + f'<div class="chart-legend">{"".join(legend_labels)}</div>'
        + "</div>"
        + f'<div class="chart-area">{svg}</div>'
        + '<p class="chart-note muted">Y 轴为各指标独立归一化（0–100%），便于同屏对比趋势；'
        + "悬停数据点显示万相台原始值。</p>"
        + "</div>"
    )
