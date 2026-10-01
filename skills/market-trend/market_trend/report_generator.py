"""市场排行趋势 — HTML 报告（蓝白主题）。"""

from __future__ import annotations

import re
from datetime import datetime
from html import escape

from .config import artifacts_dir

_TREND_LABEL = {
    "up": "上升",
    "down": "下降",
    "stable": "持平",
    "new": "新上榜",
    "drop": "跌出榜",
}

_TREND_BADGE = {
    "up": "bg-blue-100 text-blue-800 border-blue-200",
    "down": "bg-slate-100 text-slate-600 border-slate-200",
    "stable": "bg-neutral-100 text-neutral-600 border-neutral-200",
    "new": "bg-blue-600 text-white border-blue-600",
    "drop": "bg-slate-200 text-slate-500 border-slate-300",
}


def generate_trend_report(raw_data: dict, insights_md: str = "") -> str:
    """生成 HTML 报告，返回文件绝对路径。"""
    html = _build_html(raw_data, insights_md.strip())
    filename = f"market_trend_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html"
    out = artifacts_dir()
    filepath = out / filename
    filepath.write_text(html, encoding="utf-8")
    return str(filepath)


def _build_html(raw_data: dict, insights_md: str) -> str:
    cate_name = raw_data.get("cate_name") or raw_data.get("cate_id") or "未知类目"
    rank_label = raw_data.get("rank_type_label") or raw_data.get("rank_type") or ""
    trend_mode = "月趋势" if raw_data.get("trend_mode") == "month" else "周趋势"
    date_ranges = raw_data.get("date_ranges") or []
    period_text = " → ".join(_format_range(dr) for dr in date_ranges) if date_ranges else "—"
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    summary = raw_data.get("summary") or {}
    items = raw_data.get("trend_items") or []

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{escape(cate_name)} 市场排行趋势报告</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body class="min-h-screen bg-slate-50 text-neutral-900 font-sans selection:bg-blue-100 selection:text-blue-900">
  <header class="border-b border-blue-100 px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 sticky top-0 bg-white/90 backdrop-blur-md z-10">
    <div class="flex items-center gap-3">
      <div class="w-7 h-7 bg-blue-600 rounded flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
      </div>
      <div>
        <h1 class="text-base font-medium tracking-tight">市场排行趋势</h1>
        <p class="text-xs text-neutral-500">{escape(rank_label)} · {trend_mode}</p>
      </div>
      {"<span class='text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200'>AI 洞察</span>" if insights_md else ""}
    </div>
    <div class="flex flex-wrap items-center gap-4 text-sm text-neutral-500">
      <span>类目 <strong class="text-blue-700">{escape(str(cate_name))}</strong></span>
      <span>周期 <strong class="text-neutral-800">{escape(period_text)}</strong></span>
      <span>生成于 <strong class="text-neutral-800">{generated_at}</strong></span>
    </div>
  </header>
  <main class="max-w-[1600px] mx-auto p-6 md:p-8">
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
      {_summary_card("商品总数", summary.get("total", len(items)), "text-neutral-900")}
      {_summary_card("上升", summary.get("rising_count", 0), "text-blue-700")}
      {_summary_card("下降", summary.get("falling_count", 0), "text-slate-600")}
      {_summary_card("新上榜", summary.get("new_count", 0), "text-blue-600")}
      {_summary_card("跌出榜", summary.get("dropped_count", 0), "text-slate-500")}
    </div>
"""

    if insights_md:
        html += _insights_block(insights_md)

    html += """
    <div class="border border-blue-100 rounded-lg overflow-x-auto bg-white shadow-sm">
      <table class="w-full text-left border-collapse text-sm min-w-[960px]">
        <thead>
          <tr class="bg-blue-50/80 border-b border-blue-100 text-blue-700">
            <th class="px-4 py-3 font-medium w-16">排名</th>
            <th class="px-4 py-3 font-medium w-24">趋势</th>
            <th class="px-4 py-3 font-medium w-20">变化</th>
            <th class="px-4 py-3 font-medium">商品名称</th>
            <th class="px-4 py-3 font-medium w-36">店铺</th>
            <th class="px-4 py-3 font-medium w-28">类型</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-neutral-200/60">
"""

    for item in items[:100]:
        html += _item_row(item)

    html += """
        </tbody>
      </table>
    </div>
  </main>
</body>
</html>"""
    return html


def _summary_card(label: str, value, value_class: str) -> str:
    return f"""
      <div class="bg-white border border-blue-100 rounded-lg px-4 py-3 shadow-sm">
        <div class="text-xs text-neutral-500 mb-1">{escape(label)}</div>
        <div class="text-xl font-semibold {value_class}">{escape(str(value))}</div>
      </div>"""


def _item_row(item: dict) -> str:
    trend = item.get("trend", "stable")
    badge = _TREND_BADGE.get(trend, _TREND_BADGE["stable"])
    label = _TREND_LABEL.get(trend, trend)
    rank = item.get("current_rank")
    rank_html = (
        f'<span class="text-blue-600 font-semibold">{rank}</span>'
        if isinstance(rank, int) and rank <= 3
        else escape(str(rank) if rank is not None else "-")
    )
    change = _format_rank_change(item.get("rank_change"), trend)
    title = escape((item.get("title") or "")[:48])
    shop = escape((item.get("shop_title") or "")[:18])
    shop_type = "天猫" if item.get("is_tmall") else "淘宝"
    return f"""
          <tr class="hover:bg-blue-50/40 transition-colors">
            <td class="px-4 py-3 font-mono text-xs text-neutral-500">{rank_html}</td>
            <td class="px-4 py-3"><span class="inline-flex px-2 py-0.5 rounded text-xs font-medium border {badge}">{label}</span></td>
            <td class="px-4 py-3 font-mono text-xs text-neutral-600">{escape(change)}</td>
            <td class="px-4 py-3 font-medium text-neutral-900">{title}</td>
            <td class="px-4 py-3 text-neutral-600">{shop}</td>
            <td class="px-4 py-3 text-neutral-500">{shop_type}</td>
          </tr>"""


def _format_rank_change(rank_change, trend: str) -> str:
    if rank_change is None or trend in ("new", "drop"):
        return "-"
    if rank_change == 0:
        return "0"
    if rank_change > 0:
        return f"↓{rank_change}"
    return f"↑{abs(rank_change)}"


def _format_range(date_range: str) -> str:
    if "|" not in date_range:
        return date_range
    start, end = date_range.split("|", 1)
    return f"{start[5:]}~{end[5:]}"


def _insights_block(insights_md: str) -> str:
    sections = _split_md_sections(insights_md)
    html = """
    <div class="mb-8">
      <h2 class="text-base font-semibold text-neutral-900 mb-4">AI 深度分析</h2>
      <div class="grid md:grid-cols-2 gap-4">
"""
    for section in sections:
        title = section["title"]
        body_html = _section_body_to_html(section["body"])
        if title:
            html += f"""
        <div class="bg-blue-50/60 border border-blue-200/60 rounded-xl p-5 shadow-sm">
          <h3 class="text-sm font-semibold text-blue-900 mb-3 pb-2 border-b border-blue-200/50">{escape(title)}</h3>
          <div>{body_html}</div>
        </div>"""
        elif body_html:
            html += f"""
        <div class="bg-white border border-blue-100 rounded-xl p-5 shadow-sm">
          <div>{body_html}</div>
        </div>"""
    html += """
      </div>
    </div>
"""
    return html


def _inline_md(text: str) -> str:
    return escape(text)


def _split_md_sections(md_text: str) -> list[dict]:
    sections: list[dict] = []
    current_title = ""
    current_lines: list[str] = []
    for line in md_text.split("\n"):
        h2_match = re.match(r"^##\s+(.+)$", line.strip())
        if h2_match:
            body = "\n".join(current_lines).strip()
            if current_title or body:
                sections.append({"title": current_title, "body": body})
            current_title = h2_match.group(1)
            current_lines = []
        else:
            current_lines.append(line)
    body = "\n".join(current_lines).strip()
    if current_title or body:
        sections.append({"title": current_title, "body": body})
    return sections


def _section_body_to_html(body: str) -> str:
    lines = body.split("\n")
    html_parts: list[str] = []
    in_ul = False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if in_ul:
                html_parts.append("</ul>")
                in_ul = False
            continue
        ul_match = re.match(r"^[-*]\s+(.+)$", stripped)
        if ul_match:
            if not in_ul:
                html_parts.append('<ul class="list-disc list-inside space-y-1 text-sm text-neutral-700">')
                in_ul = True
            html_parts.append(f"<li>{_inline_md(ul_match.group(1))}</li>")
            continue
        if in_ul:
            html_parts.append("</ul>")
            in_ul = False
        html_parts.append(
            f'<p class="text-sm text-neutral-700 leading-relaxed mb-1.5">{_inline_md(stripped)}</p>'
        )
    if in_ul:
        html_parts.append("</ul>")
    return "\n".join(html_parts)
