"""关键词流量趋势 HTML 可视化报告。"""

from __future__ import annotations

from datetime import datetime
from html import escape
from pathlib import Path
from typing import Any, Iterable, Sequence

from .analyzer import normalize_summary_cards
from .chart_svg import render_interactive_combined_chart


def generate_keyword_traffic_report(result: dict[str, Any], output_path: Path) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(_build_html(result), encoding="utf-8")
    return str(output_path)


def _build_html(result: dict[str, Any]) -> str:
    keyword = str(result.get("keyword", ""))
    cate_name = str(result.get("cate_name", "") or "未指定类目")
    cate_id = result.get("cate_id", "")
    date_range = str(result.get("date_range", ""))
    months = result.get("months", 13)
    trend_data = list(result.get("trend_data") or [])
    analysis = result.get("analysis") or {}
    summary = result.get("summary") or {}
    overview = analysis.get("overview", {})
    metrics = overview.get("metrics", {})
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if "|" in date_range:
        start_date, end_date = date_range.split("|", 1)
    else:
        start_date = end_date = date_range

    chart_payload = _build_chart_payload(trend_data)
    chart_html = _render_combined_chart(chart_payload)
    summary_cards = normalize_summary_cards(summary)

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(keyword)} 关键词流量趋势报告</title>
  <style>
    :root {{
      --bg: #eef4fb;
      --bg-deep: #e3edf9;
      --panel: rgba(255, 255, 255, 0.96);
      --line: #d4e3f4;
      --text: #1e293b;
      --muted: #64748b;
      --accent: #2563eb;
      --accent-strong: #1d4ed8;
      --accent-soft: #dbeafe;
      --chip: #eff6ff;
      --good: #059669;
      --warn: #dc2626;
      --shadow: 0 18px 48px rgba(37, 99, 235, 0.1);
    }}
    * {{ box-sizing: border-box; }}
    html, body {{ margin: 0; overflow-x: hidden; }}
    body {{
      background:
        radial-gradient(circle at top left, rgba(37, 99, 235, 0.12), transparent 28%),
        radial-gradient(circle at right 12%, rgba(96, 165, 250, 0.14), transparent 20%),
        linear-gradient(180deg, #ffffff 0%, var(--bg) 46%, var(--bg-deep) 100%);
      color: var(--text);
      font: 14px/1.65 "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    }}
    .page {{
      width: min(1680px, calc(100vw - 28px));
      margin: 0 auto;
      padding: clamp(16px, 2.4vw, 34px) 0 42px;
    }}
    .hero, .panel, .card {{
      border: 1px solid rgba(212, 227, 244, 0.95);
      border-radius: 24px;
      background: var(--panel);
      box-shadow: var(--shadow);
      backdrop-filter: blur(8px);
    }}
    .hero {{
      padding: clamp(18px, 3vw, 30px);
      position: relative;
      overflow: hidden;
    }}
    .hero::after {{
      content: "";
      position: absolute;
      inset: auto -60px -80px auto;
      width: 220px;
      height: 220px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(37, 99, 235, 0.16), transparent 66%);
      pointer-events: none;
    }}
    .eyebrow {{
      display: inline-flex;
      padding: 6px 12px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent-strong);
      font-size: 12px;
      letter-spacing: 0.06em;
    }}
    h1, h2, h3 {{
      font-family: "Iowan Old Style", "Noto Serif SC", "Songti SC", "STSong", serif;
      letter-spacing: 0.01em;
    }}
    h1 {{
      margin: 14px 0 10px;
      font-size: clamp(30px, 4.5vw, 48px);
      line-height: 1.08;
    }}
    h2 {{ margin: 0; font-size: clamp(22px, 2.2vw, 30px); }}
    h3 {{ margin: 0; font-size: 18px; }}
    p {{ margin: 0; color: var(--muted); }}
    .hero-copy {{ max-width: 960px; }}
    .meta {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 22px;
    }}
    .meta-item, .card {{ min-width: 0; }}
    .meta-item {{
      padding: 14px 16px;
      border-radius: 18px;
      background: rgba(248, 250, 255, 0.92);
      border: 1px solid rgba(212, 227, 244, 0.95);
    }}
    .meta-item strong {{
      display: block;
      margin-top: 8px;
      color: var(--text);
      font-size: 16px;
      font-weight: 600;
      word-break: break-word;
    }}
    .card-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
      margin-top: 18px;
    }}
    .card {{ padding: 18px; }}
    .card strong {{
      display: block;
      margin-top: 10px;
      font-size: clamp(22px, 2.8vw, 32px);
      line-height: 1.1;
      color: var(--text);
    }}
    .sections {{ display: grid; gap: 18px; margin-top: 18px; }}
    .panel {{ padding: clamp(18px, 2.4vw, 28px); overflow: hidden; }}
    .section-head {{
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 14px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }}
    .section-kicker {{
      display: inline-block;
      margin-bottom: 8px;
      color: var(--accent-strong);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }}
    .tag-row {{ display: flex; gap: 8px; flex-wrap: wrap; }}
    .tag {{
      display: inline-flex;
      padding: 5px 11px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent-strong);
      font-size: 12px;
    }}
    .insight-list {{
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 12px;
    }}
    .insight-list li {{
      padding: 14px 16px;
      border-radius: 18px;
      background: linear-gradient(180deg, rgba(248, 250, 255, 0.96), rgba(239, 246, 255, 0.92));
      border: 1px solid rgba(212, 227, 244, 0.95);
      color: var(--text);
    }}
    .combined-chart-wrap {{
      position: relative;
    }}
    .combined-chart-wrap .series-toggle {{
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }}
    .chart-toolbar {{
      margin-bottom: 14px;
    }}
    .chart-hint {{
      margin-bottom: 10px;
      font-size: 13px;
    }}
    .chart-legend {{
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }}
    .legend-item {{
      cursor: pointer;
      user-select: none;
      display: inline-flex;
      align-items: center;
      padding: 7px 14px;
      border-radius: 999px;
      border: 1px solid rgba(212, 227, 244, 0.95);
      background: #fff;
      color: var(--text);
      font-size: 13px;
      font-weight: 600;
      box-shadow: inset 3px 0 0 var(--series-color);
      transition: opacity 0.15s ease, transform 0.15s ease;
    }}
    .legend-item:hover {{
      transform: translateY(-1px);
      border-color: rgba(37, 99, 235, 0.35);
    }}
    .chart-area {{
      width: 100%;
      overflow-x: auto;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.94);
      border: 1px solid rgba(212, 227, 244, 0.95);
      padding: 8px 4px 4px;
    }}
    .combined-chart-svg {{
      display: block;
      width: 100%;
      min-height: 420px;
      height: auto;
    }}
    .combined-chart-wrap .series-line {{
      transition: stroke-width 0.15s ease;
    }}
    .combined-chart-wrap .series:hover .series-line {{
      stroke-width: 3.2;
    }}
    .combined-chart-wrap .chart-dot {{
      cursor: crosshair;
      transition: fill-opacity 0.12s ease;
    }}
    .combined-chart-wrap .chart-dot:hover {{
      fill-opacity: 0.85;
      r: 5;
    }}
    .chart-note {{
      margin-top: 10px;
      font-size: 12px;
    }}
    .chart-svg {{
      display: block;
      width: 100%;
      min-height: 280px;
      height: auto;
    }}
    .chart-grid {{
      stroke: rgba(100, 116, 139, 0.16);
      stroke-width: 1;
    }}
    .chart-axis {{
      fill: #64748b;
      font-size: 11px;
      font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
    }}
    .chart-legend {{
      fill: #475569;
      font-size: 12px;
      font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
    }}
    .chart-empty {{
      padding: 40px 20px;
      text-align: center;
    }}
    .change-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
    }}
    .change-card {{
      padding: 16px;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.94);
      border: 1px solid rgba(212, 227, 244, 0.95);
    }}
    .change-card strong {{
      display: block;
      margin: 8px 0;
      font-size: 18px;
      color: var(--text);
    }}
    .change-card .delta {{
      font-size: 13px;
      color: var(--muted);
    }}
    .change-card .delta.positive {{ color: var(--good); }}
    .change-card .delta.negative {{ color: var(--warn); }}
    .summary-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 14px;
    }}
    .summary-card {{
      padding: 18px;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.94);
      border: 1px solid rgba(212, 227, 244, 0.95);
    }}
    .summary-card p {{
      margin-top: 10px;
      color: var(--text);
      white-space: pre-wrap;
    }}
    .detail-scroll {{
      margin-top: 14px;
      max-height: 560px;
      overflow: auto;
      border-radius: 18px;
      border: 1px solid rgba(212, 227, 244, 0.95);
      background: rgba(255, 255, 255, 0.94);
    }}
    .detail-table {{
      width: max-content;
      min-width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }}
    .detail-table th, .detail-table td {{
      padding: 10px 12px;
      border-bottom: 1px solid rgba(226, 232, 240, 0.95);
      text-align: left;
      vertical-align: top;
    }}
    .detail-table th {{
      position: sticky;
      top: 0;
      z-index: 2;
      background: #eff6ff;
      color: #475569;
      white-space: nowrap;
    }}
    .detail-table tbody tr:nth-child(even) {{
      background: rgba(248, 250, 255, 0.72);
    }}
    .muted {{ color: var(--muted); }}
    .footnote {{ margin-top: 14px; font-size: 12px; color: var(--muted); }}
    @media (max-width: 640px) {{
      .page {{ width: calc(100vw - 14px); }}
    }}
  </style>
</head>
<body>
  <div class="page">
    <section class="hero">
      <span class="eyebrow">万相台关键词流量趋势报告</span>
      <div class="hero-copy">
        <h1>{escape(keyword)}</h1>
        <p>本报告基于万相台无界版流量解析接口获取的付费搜索场景数据，展现/点击指数为相对指数，非绝对搜索量。</p>
      </div>
      <div class="meta">
        <div class="meta-item"><span class="muted">生成时间</span><strong>{escape(generated_at)}</strong></div>
        <div class="meta-item"><span class="muted">行业类目</span><strong>{escape(cate_name)}</strong></div>
        <div class="meta-item"><span class="muted">类目 ID</span><strong>{escape(str(cate_id))}</strong></div>
        <div class="meta-item"><span class="muted">数据区间</span><strong>{escape(start_date)} ~ {escape(end_date)}</strong></div>
        <div class="meta-item"><span class="muted">查询月数</span><strong>{escape(str(months))} 个月</strong></div>
      </div>
    </section>

    <section class="card-grid">
      {_render_metric_cards(metrics)}
    </section>

    <div class="sections">
      <section class="panel">
        <div class="section-head">
          <div>
            <span class="section-kicker">Summary</span>
            <h2>分析结论</h2>
          </div>
          <div class="tag-row">
            <span class="tag">仅基于本次抓取</span>
            <span class="tag">{escape(str(overview.get('total_days', len(trend_data))))} 天样本</span>
          </div>
        </div>
        {_render_insights(analysis.get("insights", []))}
      </section>

      <section class="panel">
        <div class="section-head">
          <div>
            <span class="section-kicker">Trend Charts</span>
            <h2>趋势可视化</h2>
          </div>
        </div>
        <div class="chart-toolbar-wrap">
          {chart_html}
        </div>
      </section>

      <section class="panel">
        <div class="section-head">
          <div>
            <span class="section-kicker">Recent Change</span>
            <h2>近期变化</h2>
          </div>
        </div>
        {_render_change_cards(analysis.get("recent_changes", {}))}
      </section>

      {_render_summary_section(summary_cards)}

      <section class="panel">
        <div class="section-head">
          <div>
            <span class="section-kicker">Details</span>
            <h2>完整日趋势明细</h2>
          </div>
          <div class="tag-row">
            <span class="tag">与 JSON / CSV 同源</span>
            <span class="tag">共 {escape(str(len(trend_data)))} 条</span>
          </div>
        </div>
        <div class="detail-scroll">
          {_render_trend_table(trend_data)}
        </div>
        <p class="footnote">报告内图表与统计均由本次抓到的 {escape(str(len(trend_data)))} 条日趋势数据实时计算；指数类指标为万相台相对指数，仅供趋势对比参考。</p>
      </section>
    </div>
  </div>
</body>
</html>"""


def _build_chart_payload(trend_data: Sequence[dict]) -> dict[str, Any]:
    labels: list[str] = []
    impression: list[float | None] = []
    click: list[float | None] = []
    ctr: list[float | None] = []
    cvr: list[float | None] = []
    competition: list[float | None] = []
    avg_price: list[float | None] = []

    for row in trend_data:
        labels.append(str(row.get("date", "")))
        impression.append(_to_chart_number(row.get("impression_index")))
        click.append(_to_chart_number(row.get("click_index")))
        ctr.append(_to_chart_number(row.get("ctr")))
        cvr.append(_to_chart_number(row.get("cvr")))
        competition.append(_to_chart_number(row.get("competition_index")))
        avg_price.append(_to_chart_number(row.get("avg_price")))

    return {
        "labels": labels,
        "impression": impression,
        "click": click,
        "ctr": ctr,
        "cvr": cvr,
        "competition": competition,
        "avg_price": avg_price,
    }


def _render_combined_chart(payload: dict[str, Any]) -> str:
    labels = payload.get("labels", [])
    return render_interactive_combined_chart(
        labels,
        [
            {
                "label": "展现指数",
                "values": payload.get("impression", []),
                "color": "#2563eb",
            },
            {
                "label": "点击指数",
                "values": payload.get("click", []),
                "color": "#0891b2",
            },
            {
                "label": "点击率 CTR",
                "values": payload.get("ctr", []),
                "color": "#6366f1",
                "is_percent": True,
            },
            {
                "label": "点击转化率 CVR",
                "values": payload.get("cvr", []),
                "color": "#0284c7",
                "is_percent": True,
            },
            {
                "label": "竞争指数",
                "values": payload.get("competition", []),
                "color": "#1d4ed8",
            },
            {
                "label": "市场均价",
                "values": payload.get("avg_price", []),
                "color": "#7c3aed",
            },
        ],
    )


def _to_chart_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "").rstrip("%")
    try:
        return float(text)
    except ValueError:
        return None


def _render_metric_cards(metrics: dict[str, Any]) -> str:
    cards = [
        ("展现指数均值", _metric_value(metrics, "impression_index", "avg")),
        ("点击指数均值", _metric_value(metrics, "click_index", "avg")),
        ("点击率均值", _metric_value(metrics, "ctr", "avg", percent=True)),
        ("转化率均值", _metric_value(metrics, "cvr", "avg", percent=True)),
        ("竞争指数均值", _metric_value(metrics, "competition_index", "avg")),
        ("市场均价均值", _metric_value(metrics, "avg_price", "avg", digits=2)),
    ]
    return "".join(_render_stat_card(label, value) for label, value in cards)


def _metric_value(
    metrics: dict[str, Any],
    field: str,
    key: str,
    *,
    percent: bool = False,
    digits: int = 0,
) -> str:
    raw = (metrics.get(field) or {}).get(key)
    if raw is None:
        return "-"
    try:
        number = float(raw)
    except (TypeError, ValueError):
        return "-"
    if percent:
        return f"{number:.2f}%"
    if digits:
        return f"{number:,.{digits}f}"
    if number.is_integer():
        return f"{int(number):,}"
    return f"{number:,.2f}"


def _render_stat_card(label: str, value: str) -> str:
    return (
        '<div class="card">'
        f'<div class="muted">{escape(label)}</div>'
        f"<strong>{escape(value)}</strong>"
        "</div>"
    )


def _render_insights(insights: Iterable[str]) -> str:
    rows = list(insights)
    if not rows:
        return '<p class="muted">当前没有可展示的分析结论。</p>'
    items = "".join(f"<li>{escape(item)}</li>" for item in rows)
    return f'<ol class="insight-list">{items}</ol>'


def _render_change_cards(recent_changes: dict[str, Any]) -> str:
    if not recent_changes:
        return '<p class="muted">暂无近期变化数据。</p>'

    cards = []
    for field in (
        "impression_index",
        "click_index",
        "ctr",
        "cvr",
        "competition_index",
        "avg_price",
    ):
        item = recent_changes.get(field) or {}
        label = str(item.get("label", field))
        trend_7d = str(item.get("trend_7d", "持平"))
        trend_30d = str(item.get("trend_30d", "持平"))
        change_7d = _format_change(item.get("change_7d"))
        change_30d = _format_change(item.get("change_30d"))
        cards.append(
            '<div class="change-card">'
            f'<div class="muted">{escape(label)}</div>'
            f"<strong>近 7 日：{escape(trend_7d)}</strong>"
            f'<div class="delta {_change_class(item.get("change_7d"))}">7 日环比 {escape(change_7d)}</div>'
            f"<strong>近 30 日：{escape(trend_30d)}</strong>"
            f'<div class="delta {_change_class(item.get("change_30d"))}">30 日环比 {escape(change_30d)}</div>'
            "</div>"
        )
    return f'<div class="change-grid">{"".join(cards)}</div>'


def _format_change(value: Any) -> str:
    if value is None:
        return "-"
    try:
        number = float(value) * 100
    except (TypeError, ValueError):
        return "-"
    sign = "+" if number > 0 else ""
    return f"{sign}{number:.2f}%"


def _change_class(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return ""
    if number > 0:
        return "positive"
    if number < 0:
        return "negative"
    return ""


def _render_summary_section(cards: list[dict[str, str]]) -> str:
    if not cards:
        return ""
    items = []
    for card in cards:
        tag_html = ""
        if card.get("tag"):
            tag_html = f'<span class="tag">{escape(card["tag"])}</span>'
        items.append(
            '<div class="summary-card">'
            f"<h3>{escape(card['title'])}</h3>"
            f"{tag_html}"
            f"<p>{escape(card['content'])}</p>"
            "</div>"
        )
    return (
        '<section class="panel">'
        '<div class="section-head">'
        '<div><span class="section-kicker">Market Summary</span><h2>市场总结</h2></div>'
        '<div class="tag-row"><span class="tag">万相台 AI 总结</span></div>'
        "</div>"
        f'<div class="summary-grid">{"".join(items)}</div>'
        "</section>"
    )


TREND_TABLE_HEADERS = [
    ("date", "日期"),
    ("impression_index", "展现指数"),
    ("click_index", "点击指数"),
    ("ctr", "点击率"),
    ("cvr", "点击转化率"),
    ("competition_index", "竞争指数"),
    ("avg_price", "市场均价"),
]


def _render_trend_table(trend_data: Sequence[dict]) -> str:
    if not trend_data:
        return '<p class="muted" style="padding:16px;">当前没有趋势数据。</p>'

    head = "".join(f"<th>{escape(label)}</th>" for _, label in TREND_TABLE_HEADERS)
    rows = []
    for item in trend_data:
        cells = "".join(
            f"<td>{escape(str(item.get(field, '') or '-'))}</td>"
            for field, _ in TREND_TABLE_HEADERS
        )
        rows.append(f"<tr>{cells}</tr>")
    return f'<table class="detail-table"><thead><tr>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table>'
