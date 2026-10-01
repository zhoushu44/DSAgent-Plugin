"""竞品指标对比 HTML 可视化报告。"""

from __future__ import annotations

from datetime import datetime
from html import escape
from pathlib import Path
from typing import Any

from ..config import AUDIENCE_TAG_KEYS, CARD_INDICATOR_KEYS, FLOW_CHANNEL_KEYS, INDICATOR_LABELS
from .insights import render_insights_block


def generate_competitor_report(result: dict[str, Any], output_path: Path) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(_build_html(result), encoding="utf-8")
    return str(output_path)


def _build_html(result: dict[str, Any]) -> str:
    competitor_ids = result.get("competitor_ids") or []
    analysis = result.get("analysis_period") or {}
    competitors = result.get("competitors") or {}
    competitor_channels = result.get("competitor_channels") or {}
    competitor_audience = result.get("competitor_audience") or {}
    insights_flow = result.get("insights_flow") or ""
    insights_audience = result.get("insights_audience") or ""
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    analysis_range = _fmt_range(analysis)

    sections = _render_panels(
        competitor_ids,
        competitors,
        competitor_channels,
        competitor_audience,
        analysis_range,
        insights_flow=insights_flow,
        insights_audience=insights_audience,
    )

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>竞品指标报告 · {escape(", ".join(competitor_ids))}</title>
  <style>
    :root {{
      --bg: #eef4fb;
      --bg-deep: #e3edf9;
      --panel: rgba(255, 255, 255, 0.96);
      --line: #d4e3f4;
      --text: #1e293b;
      --muted: #64748b;
      --accent-strong: #1d4ed8;
      --accent-soft: #dbeafe;
      --chip: #eff6ff;
      --warn: #dc2626;
      --fall: #059669;
      --shadow: 0 18px 48px rgba(37, 99, 235, 0.1);
      --rise: var(--warn);
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
    .hero, .panel {{
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
      margin-bottom: 18px;
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
    h2 {{
      font-family: "Iowan Old Style", "Noto Serif SC", "Songti SC", "STSong", serif;
      margin: 0;
      font-size: clamp(22px, 2.2vw, 30px);
      display: inline-flex;
      align-items: baseline;
      gap: 8px;
      letter-spacing: 0.01em;
    }}
    .hero-head {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      position: relative;
      z-index: 1;
    }}
    .panel {{
      padding: clamp(18px, 2.4vw, 28px);
      margin-bottom: 18px;
      overflow: hidden;
    }}
    .section-head {{
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 14px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }}
    .count-badge {{
      font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 13px;
      color: var(--muted);
    }}
    .generated-at,
    .analysis-period {{
      font-size: 12px;
      color: var(--muted);
      white-space: nowrap;
      padding-top: 4px;
    }}
    .table-wrap {{
      border-radius: 18px;
      border: 1px solid rgba(212, 227, 244, 0.95);
      background: rgba(255, 255, 255, 0.94);
      overflow: auto;
    }}
    .metric-table {{
      width: max-content;
      min-width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }}
    .metric-table th, .metric-table td {{
      padding: 13px 14px;
      border-bottom: 1px solid rgba(226, 232, 240, 0.95);
      vertical-align: middle;
      text-align: center;
      white-space: nowrap;
    }}
    .metric-table thead th {{
      background: var(--chip);
      color: #475569;
    }}
    .metric-table thead th.id-head {{
      position: sticky;
      left: 0;
      z-index: 2;
      text-align: left;
      box-shadow: 1px 0 0 var(--line);
    }}
    .metric-table tbody td.id-cell {{
      position: sticky;
      left: 0;
      z-index: 1;
      color: var(--text);
      text-align: left;
      box-shadow: 1px 0 0 var(--line);
      font-variant-numeric: tabular-nums;
    }}
    .metric-table tbody tr.tree-parent td {{
      background: rgba(239, 246, 255, 0.95);
    }}
    .metric-table tbody tr.tree-child td {{
      background: #ffffff;
    }}
    .metric-table tbody tr.tree-child.is-hidden {{
      display: none;
    }}
    .tree-toggle {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      margin-right: 6px;
      border: 1px solid rgba(191, 219, 254, 0.95);
      border-radius: 6px;
      background: #fff;
      color: var(--accent-strong);
      font-size: 11px;
      line-height: 1;
      cursor: pointer;
      vertical-align: middle;
    }}
    .tree-toggle-spacer {{
      display: inline-block;
      width: 22px;
      margin-right: 6px;
      flex-shrink: 0;
    }}
    .tree-branch {{
      position: absolute;
      top: 50%;
      width: 12px;
      height: 1px;
      background: rgba(148, 163, 184, 0.8);
    }}
    .tree-child-label {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      position: relative;
      color: var(--accent-strong);
      text-align: left;
    }}
    .tree-child.has-children td {{
      background: rgba(248, 250, 252, 0.98);
    }}
    .tree-child .id-cell {{
      position: relative;
    }}
    .metric-table tbody td.value-cell,
    .metric-table tbody td.empty-cell {{
      font-variant-numeric: tabular-nums;
    }}
    .metric-table tbody td.value-cell {{
      color: var(--text);
    }}
    .metric-table tbody td.empty-cell {{ color: #94a3b8; }}
    .cell-value {{ display: inline; }}
    .growth-delta {{
      display: inline-block;
      margin-left: 6px;
      font-size: 12px;
    }}
    .growth-delta.rise {{ color: var(--rise); }}
    .growth-delta.fall {{ color: var(--fall); }}
    .growth-delta.flat {{ color: var(--muted); }}
    .empty-hint {{
      padding: 28px 16px;
      text-align: center;
      color: var(--muted);
      font-size: 13px;
    }}
    .competitor-block + .competitor-block {{
      margin-top: 28px;
      padding-top: 28px;
      border-top: 1px dashed rgba(212, 227, 244, 0.95);
    }}
    .competitor-title {{
      margin: 0 0 16px;
      font-size: 15px;
      color: var(--muted);
      font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
    }}
    .competitor-title strong {{
      color: var(--text);
      font-weight: 700;
    }}
    .card-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }}
    .metric-card {{
      display: flex;
      flex-direction: column;
      min-height: 118px;
      padding: 14px 16px;
      border-radius: 16px;
      border: 1px solid rgba(212, 227, 244, 0.95);
      background: linear-gradient(180deg, #ffffff 0%, rgba(239, 246, 255, 0.72) 100%);
    }}
    .metric-card-label {{
      font-size: 12px;
      color: var(--muted);
      line-height: 1.4;
    }}
    .metric-card-value {{
      flex: 1;
      margin-top: 10px;
      font-size: clamp(18px, 2vw, 24px);
      font-weight: 700;
      line-height: 1.25;
      color: var(--text);
      word-break: break-word;
      font-variant-numeric: tabular-nums;
    }}
    .metric-card-growth {{
      margin-top: 10px;
      font-size: 12px;
      font-weight: 700;
    }}
    .metric-card-growth.rise {{ color: var(--rise); }}
    .metric-card-growth.fall {{ color: var(--fall); }}
    .metric-card-growth.flat {{ color: var(--muted); font-weight: 500; }}
    .content-tabs {{
      margin-top: 4px;
    }}
    .tab-nav {{
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
      border-bottom: 1px solid rgba(212, 227, 244, 0.95);
      padding-bottom: 10px;
    }}
    .tab-btn {{
      appearance: none;
      border: none;
      background: transparent;
      padding: 8px 14px;
      border-radius: 999px;
      font-size: 13px;
      color: var(--muted);
      cursor: pointer;
      font-family: inherit;
    }}
    .tab-btn.is-active {{
      background: var(--accent-soft);
      color: var(--accent-strong);
      font-weight: 700;
    }}
    .tab-panel {{ display: none; }}
    .tab-panel.is-active {{ display: block; }}
    .insights-block {{
      margin-bottom: 16px;
      padding: 14px 16px;
      border: 1px solid rgba(37, 99, 235, 0.18);
      border-radius: 16px;
      background: linear-gradient(135deg, rgba(239, 246, 255, 0.95), rgba(255, 255, 255, 0.98));
    }}
    .insights-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 12px;
    }}
    .insights-card {{
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid rgba(212, 227, 244, 0.95);
      background: rgba(255, 255, 255, 0.88);
    }}
    .insights-card-title {{
      margin: 0 0 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(212, 227, 244, 0.8);
      font-size: 13px;
      font-weight: 700;
      color: var(--accent-strong);
    }}
    .insights-card-body {{
      font-size: 13px;
      color: var(--text);
      line-height: 1.65;
    }}
    .insights-card-body p {{
      margin: 0 0 6px;
    }}
    .insights-card-body p:last-child {{
      margin-bottom: 0;
    }}
    .insights-card-body ul,
    .insights-card-body ol {{
      margin: 0;
      padding-left: 1.2em;
    }}
    .insights-card-body li {{
      margin-bottom: 4px;
    }}
    .insights-card-body li:last-child {{
      margin-bottom: 0;
    }}
    .insights-card-body strong {{
      font-weight: 700;
      color: var(--accent-strong);
    }}
    .placeholder-box {{
      padding: 48px 24px;
      text-align: center;
      border-radius: 16px;
      border: 1px dashed rgba(212, 227, 244, 0.95);
      background: rgba(248, 250, 255, 0.72);
      color: var(--muted);
    }}
    .placeholder-box strong {{
      display: block;
      margin-bottom: 8px;
      color: var(--text);
      font-size: 15px;
    }}
    .audience-meta {{
      margin: 0;
      font-size: 12px;
      color: var(--muted);
      white-space: nowrap;
    }}
    .audience-head {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }}
    .audience-legend {{
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin: 0;
      font-size: 12px;
      color: var(--muted);
    }}
    .audience-legend-item {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }}
    .audience-legend-dot {{
      width: 10px;
      height: 10px;
      border-radius: 999px;
    }}
    .audience-legend-dot.browse {{ background: #60a5fa; }}
    .audience-legend-dot.buy {{ background: #2563eb; }}
    .audience-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 14px;
    }}
    .audience-card {{
      border: 1px solid rgba(212, 227, 244, 0.95);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.94);
      padding: 14px 16px;
    }}
    .audience-card h3 {{
      margin: 0 0 12px;
      font-size: 14px;
      font-weight: 700;
      color: var(--text);
      font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
    }}
    .audience-table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }}
    .audience-table th, .audience-table td {{
      padding: 8px 0;
      border-bottom: 1px solid rgba(226, 232, 240, 0.8);
      text-align: left;
      vertical-align: middle;
    }}
    .audience-table th {{
      color: var(--muted);
      font-weight: 500;
      font-size: 12px;
    }}
    .audience-table td.col-behavior {{
      text-align: right;
    }}
    .audience-table tr:last-child td {{
      border-bottom: none;
    }}
    .audience-bar-wrap {{
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 140px;
    }}
    .audience-bar {{
      flex: 1;
      height: 8px;
      border-radius: 999px;
      background: rgba(219, 234, 254, 0.85);
      overflow: hidden;
    }}
    .audience-bar > span {{
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #60a5fa, #2563eb);
    }}
    .audience-bar.browse > span {{
      background: linear-gradient(90deg, #93c5fd, #60a5fa);
    }}
    .audience-bar.buy > span {{
      background: linear-gradient(90deg, #3b82f6, #1d4ed8);
    }}
    .audience-rate {{
      min-width: 52px;
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--text);
      font-weight: 600;
    }}
    .footnote {{
      margin-top: 18px;
      font-size: 12px;
      color: var(--muted);
      line-height: 1.7;
    }}
    @media (max-width: 720px) {{
      .page {{ width: calc(100vw - 16px); }}
    }}
  </style>
</head>
<body>
  <div class="page">
    <section class="hero">
      <div class="hero-head">
        <span class="eyebrow">达摩盘 · 竞品指标对比</span>
        <div class="generated-at">生成时间 {escape(generated_at)}</div>
      </div>
    </section>
    {sections}
    <p class="footnote">
      数据来源：达摩盘竞争分析接口。卡片增速红色表示上升、绿色表示下降。部分指标为平台脱敏区间值，仅供竞品对标参考。
    </p>
  </div>
  <script>
    (function () {{
      document.querySelectorAll('[data-tab-group]').forEach(function (group) {{
        var buttons = group.querySelectorAll('[data-tab-target]');
        var panels = group.querySelectorAll('[data-tab-panel]');
        buttons.forEach(function (btn) {{
          btn.addEventListener('click', function () {{
            var target = btn.getAttribute('data-tab-target');
            buttons.forEach(function (b) {{ b.classList.toggle('is-active', b === btn); }});
            panels.forEach(function (panel) {{
              panel.classList.toggle('is-active', panel.getAttribute('data-tab-panel') === target);
            }});
          }});
        }});
      }});

      function setExpanded(nodeId, expanded) {{
        document.querySelectorAll('tr[data-tree-path]').forEach(function (row) {{
          var path = row.getAttribute('data-tree-path');
          if (!path || path === nodeId) return;
          if (path.indexOf(nodeId + '/') === 0) {{
            row.classList.toggle('is-hidden', !expanded);
          }}
        }});
        var btn = document.querySelector('[data-tree-toggle="' + nodeId + '"]');
        if (btn) {{
          btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
          btn.textContent = expanded ? '▼' : '▶';
        }}
      }}
      document.querySelectorAll('[data-tree-toggle]').forEach(function (btn) {{
        btn.addEventListener('click', function () {{
          var cid = btn.getAttribute('data-tree-toggle');
          var expanded = btn.getAttribute('aria-expanded') !== 'true';
          setExpanded(cid, expanded);
        }});
      }});
    }})();
  </script>
</body>
</html>"""


def _fmt_range(period: dict[str, Any]) -> str:
    begin = period.get("begin_date", "")
    end = period.get("end_date", "")
    if begin and end:
        return f"{begin} ~ {end}"
    return begin or end or "-"


def _render_panels(
    competitor_ids: list[str],
    competitors: dict[str, Any],
    competitor_channels: dict[str, Any],
    competitor_audience: dict[str, Any],
    analysis_range: str,
    *,
    insights_flow: str = "",
    insights_audience: str = "",
) -> str:
    count = len(competitor_ids)
    blocks = "".join(
        _render_competitor_block(
            cid,
            competitors,
            competitor_channels,
            competitor_audience,
            show_title=count > 1,
            insights_flow=insights_flow,
            insights_audience=insights_audience,
        )
        for cid in competitor_ids
    )
    return f"""
    <section class="panel">
      <div class="section-head">
        <h2>竞品指标明细<span class="count-badge">{count}个</span></h2>
        <div class="analysis-period">分析周期 {escape(analysis_range)}</div>
      </div>
      {blocks}
    </section>
    """


def _render_competitor_block(
    cid: str,
    competitors: dict[str, Any],
    competitor_channels: dict[str, Any],
    competitor_audience: dict[str, Any],
    *,
    show_title: bool,
    insights_flow: str = "",
    insights_audience: str = "",
) -> str:
    metrics = competitors.get(cid) or {}
    channels = competitor_channels.get(cid) or []
    audience = competitor_audience.get(cid) or {}
    flow_insights = render_insights_block(insights_flow)
    audience_insights = render_insights_block(insights_audience)
    title = ""
    if show_title:
        title = f'<p class="competitor-title">商品 ID <strong>{escape(str(cid))}</strong></p>'
    tab_id = escape(str(cid)).replace(" ", "_")
    return f"""
    <div class="competitor-block">
      {title}
      {_render_metric_cards(metrics)}
      <div class="content-tabs" data-tab-group="{tab_id}">
        <div class="tab-nav">
          <button type="button" class="tab-btn is-active" data-tab-target="flow-{tab_id}">流量来源</button>
          <button type="button" class="tab-btn" data-tab-target="audience-{tab_id}">人群画像</button>
        </div>
        <div class="tab-panel is-active" data-tab-panel="flow-{tab_id}">
          {flow_insights}
          {_render_flow_source_table(str(cid), channels)}
        </div>
        <div class="tab-panel" data-tab-panel="audience-{tab_id}">
          {audience_insights}
          {_render_audience_panel(audience)}
        </div>
      </div>
    </div>
    """


def _render_metric_cards(metrics: dict[str, Any]) -> str:
    cards = []
    for key in CARD_INDICATOR_KEYS:
        item = metrics.get(key) or {}
        label = escape(INDICATOR_LABELS[key])
        value = escape(_fmt(item.get("base")))
        growth = _fmt_growth(item.get("growth_rate"), block=True)
        cards.append(
            '<div class="metric-card">'
            f'<div class="metric-card-label">{label}</div>'
            f'<div class="metric-card-value">{value}</div>'
            f"{growth}"
            "</div>"
        )
    return f'<div class="card-grid">{"".join(cards)}</div>'


def _fmt_growth(value: Any, *, block: bool = False) -> str:
    if value is None or value == "":
        if block:
            return '<div class="metric-card-growth flat">增速 —</div>'
        return ""
    try:
        number = float(value)
        if number > 0:
            css, sign = "rise", "+"
        elif number < 0:
            css, sign = "fall", ""
        else:
            css, sign = "flat", ""
        text = f"{sign}{number * 100:.2f}%"
    except (TypeError, ValueError):
        # 达摩盘部分增速为区间/文本（如 "+0%~10%"、"比本品高"），原样展示
        text = str(value)
        if text.startswith(("+", "增", "上")):
            css = "rise"
        elif text.startswith(("-", "下", "降")):
            css = "fall"
        else:
            css = "flat"

    if block:
        return f'<div class="metric-card-growth {css}">{escape(text)}</div>'
    return f'<span class="growth-delta {css}">{escape(text)}</span>'


def _audience_profile_has_data(profile: dict[str, Any]) -> bool:
    return any(tag.get("items") for tag in profile.get("tags") or [])


def _audience_option_key(item: dict[str, Any]) -> str:
    return f"id:{item['option_id']}"


def _render_audience_bar_cell(item: dict[str, Any] | None, *, css_class: str = "") -> str:
    if not item:
        return '<td class="col-behavior"><span class="audience-rate">—</span></td>'
    rate = float(item.get("rate") or 0)
    width = max(2, min(100, round(rate * 100, 2)))
    bar_cls = f"audience-bar {css_class}".strip()
    return (
        '<td class="col-behavior">'
        '<div class="audience-bar-wrap">'
        f'<div class="{bar_cls}"><span style="width:{width}%"></span></div>'
        f'<span class="audience-rate">{escape(str(item.get("rate_pct") or "-"))}</span>'
        "</div></td>"
    )


def _render_audience_panel(audience: dict[str, Any]) -> str:
    profiles = audience.get("profiles") or []
    active = [p for p in profiles if _audience_profile_has_data(p)]
    if not active:
        return """
    <div class="placeholder-box">
      <strong>人群画像</strong>
      <span>暂无数据，请确认达摩盘人群洞察权限或稍后重试。</span>
    </div>
    """
    if len(active) >= 2:
        return _render_audience_compare(active, audience)
    return _render_audience_single(active[0], audience)


def _render_audience_single(profile: dict[str, Any], parent: dict[str, Any]) -> str:
    behavior = "、".join(profile["behavior"])
    time_range = profile.get("time_range") or parent["time_range"]
    meta = f"同行宝贝行为 · {escape(behavior)} · {escape(time_range)}"

    cards = [
        card
        for tag in profile["tags"]
        if (card := _render_audience_tag_card(tag, headers=["选项", "占比"], row_builder=_single_row))
    ]
    return f'<p class="audience-meta">{meta}</p><div class="audience-grid">{"".join(cards)}</div>'


def _single_row(item: dict[str, Any]) -> str:
    return (
        "<tr>"
        f"<td>{escape(str(item.get('option_name') or '-'))}</td>"
        f"{_render_audience_bar_cell(item)}"
        "</tr>"
    )


def _render_audience_compare(profiles: list[dict[str, Any]], parent: dict[str, Any]) -> str:
    time_range = parent["time_range"]
    labels = ["、".join(p["behavior"]) for p in profiles]
    meta = f"同行宝贝行为对比 · {' vs '.join(escape(l) for l in labels)} · {escape(time_range)}"

    legend_items = []
    bar_styles = ("browse", "buy")
    for idx, profile in enumerate(profiles):
        label = "、".join(profile["behavior"])
        dot_cls = bar_styles[idx % len(bar_styles)]
        legend_items.append(
            f'<span class="audience-legend-item">'
            f'<span class="audience-legend-dot {dot_cls}"></span>'
            f"{escape(label)}</span>"
        )

    tag_order = [tag_name for tag_name, _ in AUDIENCE_TAG_KEYS]
    tag_maps: list[dict[str, dict[str, dict[str, Any]]]] = []
    for profile in profiles:
        by_tag = {
            tag["tag_name"]: {_audience_option_key(item): item for item in tag["items"]}
            for tag in profile["tags"]
        }
        tag_maps.append(by_tag)

    all_tag_names = [name for name in tag_order if any(name in m for m in tag_maps)]

    headers = ["选项"] + ["、".join(p["behavior"]) for p in profiles]

    cards: list[str] = []
    for tag_name in all_tag_names:
        option_keys: list[str] = []
        seen_keys: set[str] = set()
        for m in tag_maps:
            for key, item in m.get(tag_name, {}).items():
                if key not in seen_keys:
                    option_keys.append(key)
                    seen_keys.add(key)
        option_keys.sort(
            key=lambda k: max(
                (float(m.get(tag_name, {}).get(k, {}).get("rate") or 0) for m in tag_maps),
                default=0.0,
            ),
            reverse=True,
        )

        rows: list[str] = []
        for key in option_keys:
            first_item = next(m[tag_name][key] for m in tag_maps if key in m.get(tag_name, {}))
            option_name = escape(first_item["option_name"])
            cells = [f"<td>{option_name}</td>"]
            for idx, m in enumerate(tag_maps):
                item = m.get(tag_name, {}).get(key)
                dot_cls = bar_styles[idx % len(bar_styles)]
                cells.append(_render_audience_bar_cell(item, css_class=dot_cls))
            rows.append(f"<tr>{''.join(cells)}</tr>")

        if not rows:
            continue

        head_cells = "".join(
            f'<th class="col-behavior">{escape(h)}</th>' if i else f"<th>{escape(h)}</th>"
            for i, h in enumerate(headers)
        )
        cards.append(
            '<div class="audience-card">'
            f"<h3>{escape(tag_name)}</h3>"
            '<table class="audience-table">'
            f"<thead><tr>{head_cells}</tr></thead>"
            f"<tbody>{''.join(rows)}</tbody>"
            "</table>"
            "</div>"
        )

    if not cards:
        return """
    <div class="placeholder-box">
      <strong>人群画像</strong>
      <span>暂无数据，请确认达摩盘人群洞察权限或稍后重试。</span>
    </div>
    """
    return (
        f'<div class="audience-head">'
        f'<div class="audience-legend">{"".join(legend_items)}</div>'
        f'<p class="audience-meta">{meta}</p>'
        f"</div>"
        f'<div class="audience-grid">{"".join(cards)}</div>'
    )


def _render_audience_tag_card(
    tag: dict[str, Any],
    *,
    headers: list[str],
    row_builder: Any,
) -> str:
    items = tag["items"]
    if not items:
        return ""
    rows = [row_builder(item) for item in items]
    head_cells = "".join(f"<th>{escape(h)}</th>" for h in headers)
    return (
        '<div class="audience-card">'
        f"<h3>{escape(tag['tag_name'])}</h3>"
        '<table class="audience-table">'
        f"<thead><tr>{head_cells}</tr></thead>"
        f"<tbody>{''.join(rows)}</tbody>"
        "</table>"
        "</div>"
    )


def _render_flow_source_table(cid: str, channel_rows: list[dict[str, Any]]) -> str:
    if not channel_rows:
        return '<div class="empty-hint">暂无流量来源数据</div>'

    metric_cells = [
        f"<th>{escape(INDICATOR_LABELS[key])}</th>" for key in FLOW_CHANNEL_KEYS
    ]
    body_rows = _render_channel_tree_rows(
        product_id=str(cid),
        nodes=channel_rows,
        depth=0,
    )

    return f"""
    <div class="table-wrap">
      <table class="metric-table">
        <thead><tr><th class="id-head">渠道</th>{"".join(metric_cells)}</tr></thead>
        <tbody>{"".join(body_rows)}</tbody>
      </table>
    </div>
    """


def _render_channel_tree_rows(
    *,
    product_id: str,
    nodes: list[dict[str, Any]],
    depth: int = 0,
) -> list[str]:
    rows: list[str] = []
    indent = depth * 20
    branch_left = max(12, indent + 2)

    for node in nodes:
        channel_name = escape(str(node.get("channel_name") or "-"))
        channel_path = str(node.get("path") or channel_name)
        tree_path = f"{product_id}/{channel_path}"
        tree_path_esc = escape(tree_path)
        children = node.get("children") or []
        child_metrics = node.get("metrics") or {}
        has_children = bool(children)

        if has_children:
            toggle = (
                f'<button type="button" class="tree-toggle" '
                f'data-tree-toggle="{tree_path_esc}" aria-expanded="true">▼</button>'
            )
        else:
            toggle = '<span class="tree-toggle-spacer"></span>'

        child_class = "tree-parent has-children" if has_children and depth == 0 else (
            "tree-child has-children" if has_children else "tree-child"
        )
        label_style = f'style="padding-left:{indent}px"'
        branch_html = (
            f'<span class="tree-branch" style="left:{branch_left}px"></span>'
            if depth > 0
            else ""
        )
        child_cells = [
            '<td class="id-cell">'
            f'<span class="tree-child-label" {label_style}>'
            f"{toggle}{branch_html}"
            f"<span>{channel_name}</span></span></td>",
        ]
        for key in FLOW_CHANNEL_KEYS:
            child_cells.append(_render_value_cell(child_metrics.get(key) or {}))
        rows.append(
            f'<tr class="{child_class}" data-tree-path="{tree_path_esc}">'
            f'{"".join(child_cells)}</tr>'
        )
        rows.extend(
            _render_channel_tree_rows(
                product_id=product_id,
                nodes=children,
                depth=depth + 1,
            )
        )
    return rows


def _render_value_cell(item: dict[str, Any]) -> str:
    text = _fmt(item.get("base"))
    growth_html = _fmt_growth(item.get("growth_rate"))
    cell_class = "empty-cell" if text == "-" and not growth_html else "value-cell"
    if text == "-" and not growth_html:
        return f'<td class="{cell_class}">-</td>'
    return (
        f'<td class="{cell_class}">'
        f'<span class="cell-value">{escape(text)}</span>{growth_html}'
        f"</td>"
    )


def _fmt(value: Any) -> str:
    if value is None or value == "":
        return "-"
    if isinstance(value, float):
        if 0 < abs(value) < 1:
            return f"{value * 100:.2f}%"
        if value.is_integer():
            return f"{int(value):,}"
        return f"{value:,.2f}"
    return str(value)
