from __future__ import annotations

from datetime import datetime
from html import escape
from pathlib import Path

from .insights import render_insights_block
from .keywords import top_question_keywords
from .types import SkillOutput


def generate_wdj_report(result: SkillOutput, output_path: Path) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(_build_html(result), encoding="utf-8")
    return str(output_path)


def _hero_title(result: SkillOutput) -> str:
    title = str((result.summary or {}).get("item_title") or "").strip()
    if title:
        return title
    if result.item_id:
        return f"商品 {result.item_id}"
    return "问大家报告"


def _render_header(
    result: SkillOutput,
    *,
    hero_title: str,
    generated_at: str,
    item_link_html: str,
    answer_total: int,
) -> str:
    item_id = str(result.item_id or "").strip()
    total_count = result.total_count or 0
    collected = result.collected_count or len(result.questions or [])

    subtitle_parts = [hero_title]
    if item_id:
        subtitle_parts.append(f"ID {item_id}")
    if total_count:
        subtitle_parts.append(f"共 {total_count} 问")
    if collected:
        subtitle_parts.append(f"已获取 {collected} 问")
    if answer_total:
        subtitle_parts.append(f"{answer_total} 答")
    if result.answers_truncated:
        subtitle_parts.append(f"（{result.answers_skipped} 问的回答因时间预算未拉取）")
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
        <h1>问大家报告</h1>
        <p class="report-header-sub">{escape(subtitle)}</p>
      </div>
    </div>
    <div class="report-header-meta">
      {"".join(meta_parts)}
    </div>
  </header>"""


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
                "<h2>分析结论</h2>"
                '<span class="report-ai-badge">AI 洞察</span>'
                "</div>"
                f"{body}"
                "</section>"
            )

    hint = (
        f"请将问大家 AI 分析写入：<code>{escape(md_path)}</code>，"
        "然后执行 <code>python -m product_wdj report --input &lt;json&gt;</code> 重新生成报告。"
        if md_path
        else "请先写入问大家分析 Markdown 文件后执行 report 子命令。"
    )
    return (
        '<section class="panel insights-panel insights-panel-pending">'
        '<div class="panel-head insights-panel-head">'
        "<h2>分析结论</h2>"
        "</div>"
        '<div class="placeholder-box">'
        "<strong>待补充 AI 分析结论</strong>"
        f"<p>{hint}</p>"
        "</div>"
        "</section>"
    )


def _dash(value: str) -> str:
    text = str(value or "").strip()
    return text if text else "—"


def _cell(value: str, *, cls: str = "", title: str = "") -> str:
    text = _dash(value)
    safe = escape(text)
    title_attr = f' title="{escape(title or text)}"' if (title or len(text) > 28) else ""
    class_attr = f' class="{cls}"' if cls else ""
    return f"<td{class_attr}{title_attr}>{safe}</td>"


def _render_answer_row(answer: dict) -> str:
    tag = _dash(answer.get("rate_tag") or answer.get("user_tags"))
    time_text = _dash(answer.get("answer_time_str") or answer.get("answer_time"))
    sku = str(answer.get("sku") or "").strip()
    content = str(answer.get("content") or "").strip()
    return (
        "<tr class=\"row-answer\">"
        + _cell("答", cls="col-level")
        + _cell("↳", cls="col-index muted")
        + _cell(content, cls="col-content", title=content)
        + _cell(answer.get("user"), cls="col-user")
        + _cell(time_text, cls="col-time")
        + _cell(sku, cls="col-sku", title=sku)
        + _cell(tag, cls="col-tag")
        + _cell(answer.get("like_count"), cls="col-like")
        + "</tr>"
    )


def _render_question_group(question: dict) -> str:
    answers = question.get("answers") or []
    index = question.get("index") or ""
    title = str(question.get("question_title") or "").strip()
    user = str(question.get("user") or "").strip()
    ask_time = str(question.get("ask_time") or "").strip()
    answer_count = str(question.get("answer_count") or "0").strip()
    ip_location = str(question.get("ip_location") or "").strip()
    user_tags = str(question.get("user_tags") or "").strip()

    meta_parts = [
        f"提问 {escape(user or '匿名')}",
        escape(ask_time) if ask_time else "",
        f"共 {escape(answer_count)} 条回答",
        f"已获取 {len(answers)} 条",
    ]
    if ip_location:
        meta_parts.insert(2, escape(ip_location))
    summary_meta = " · ".join(part for part in meta_parts if part)
    summary = (
        f'<span class="qa-summary-index">问 {escape(str(index))}</span>'
        f'<span class="qa-summary-title">{escape(title)}</span>'
        f'<span class="qa-summary-meta">{summary_meta}</span>'
    )

    rows = [
        "<tr class=\"row-question\">"
        + _cell("问", cls="col-level")
        + _cell(str(index), cls="col-index")
        + _cell(title, cls="col-content", title=title)
        + _cell(user, cls="col-user")
        + _cell(ask_time, cls="col-time")
        + _cell("—", cls="col-sku muted")
        + _cell(user_tags, cls="col-tag")
        + _cell("—", cls="col-like muted")
        + "</tr>"
    ]

    if answers:
        rows.extend(_render_answer_row(answer) for answer in answers)
    else:
        rows.append(
            "<tr class=\"row-answer row-empty\">"
            + _cell("", cls="col-level")
            + _cell("↳", cls="col-index muted")
            + '<td colspan="6" class="muted">暂无回答</td>'
            + "</tr>"
        )

    return (
        '<details class="qa-group">'
        f"<summary class=\"qa-summary\">{summary}</summary>"
        '<div class="qa-table-scroll">'
        "<table class=\"qa-table qa-table-inner\">"
        "<tbody>"
        f"{''.join(rows)}"
        "</tbody></table></div></details>"
    )


def _render_qa_tree_table(questions: list[dict]) -> str:
    if not questions:
        return '<p class="empty muted">暂无数据</p>'

    groups = [_render_question_group(question) for question in questions]

    return (
        '<div class="qa-tree">'
        '<div class="qa-table-scroll">'
        '<table class="qa-table qa-table-head">'
        "<colgroup>"
        '<col class="col-level">'
        '<col class="col-index">'
        '<col class="col-content">'
        '<col class="col-user">'
        '<col class="col-time">'
        '<col class="col-sku">'
        '<col class="col-tag">'
        '<col class="col-like">'
        "</colgroup>"
        "<thead><tr>"
        "<th>层级</th><th>序号</th><th>内容</th><th>用户</th>"
        "<th>时间</th><th>SKU</th><th>标签</th><th>点赞</th>"
        "</tr></thead></table></div>"
        f'{"".join(groups)}'
        "</div>"
    )


def _build_html(result: SkillOutput) -> str:
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    hero_title = _hero_title(result)
    questions = result.questions or []
    answer_total = sum(len(q.get("answers") or []) for q in questions)

    summary = result.summary or {}
    item_url = str(summary.get("item_url") or "").strip()
    item_link = item_url or (
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
        answer_total=answer_total,
    )
    insights_html = _render_insights_section(result)
    qa_table_html = _render_qa_tree_table(questions)

    top_keywords = top_question_keywords(questions, top_n=12)
    if top_keywords:
        keyword_html = "".join(
            f'<span class="tag-chip">{escape(word)} '
            f'<span class="tag-count">{count}</span></span>'
            for word, count in top_keywords
        )
    else:
        keyword_html = '<span class="empty muted">暂无</span>'

    collected = result.collected_count or len(questions)

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(hero_title)} 问大家报告</title>
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
    .panel {{
      background: var(--panel);
      border: 1px solid rgba(212, 227, 244, 0.95);
      border-radius: 16px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(8px);
      padding: 14px 18px 16px;
      margin-bottom: 12px;
    }}
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
    .panel-head h2::before {{
      content: "";
      width: 3px;
      height: 13px;
      border-radius: 2px;
      background: linear-gradient(180deg, #60a5fa, #2563eb);
      flex-shrink: 0;
    }}
    .tag-list {{
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }}
    .tag-chip {{
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--chip);
      color: var(--accent-strong);
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      border: 1px solid var(--accent-muted);
    }}
    .tag-count {{
      font-weight: 600;
      font-variant-numeric: tabular-nums;
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
    .insights-section-body ul,
    .insights-section-body ol {{
      margin: 0;
      padding-left: 1.2em;
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
    .count-badge {{
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      padding: 3px 10px;
      background: var(--chip);
      border: 1px solid var(--accent-muted);
      border-radius: 999px;
      color: var(--muted);
    }}
    .empty.muted, .muted {{
      color: var(--muted-light);
    }}
    .item-link {{
      color: inherit;
      text-decoration: none;
      font-weight: 500;
    }}
    .item-link:hover {{
      text-decoration: underline;
    }}
    .qa-tree {{ margin-top: 4px; }}
    .qa-table-scroll {{ overflow-x: auto; }}
    .qa-table {{
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 14px;
    }}
    .qa-table-head th {{
      background: #f1f5f9;
      color: #475569;
      font-weight: 600;
      padding: 10px 8px;
      border-bottom: 2px solid #e2e8f0;
      text-align: left;
      white-space: nowrap;
    }}
    .qa-table-inner td {{
      padding: 8px;
      border-bottom: 1px solid #eef2f7;
      vertical-align: top;
      word-break: break-word;
    }}
    .qa-table .col-level {{ width: 52px; text-align: center; }}
    .qa-table .col-index {{ width: 44px; text-align: center; }}
    .qa-table .col-content {{ width: 28%; min-width: 160px; }}
    .qa-table .col-user {{ width: 88px; }}
    .qa-table .col-time {{ width: 108px; }}
    .qa-table .col-sku {{ width: 24%; min-width: 140px; }}
    .qa-table .col-tag {{ width: 120px; }}
    .qa-table .col-like {{ width: 52px; text-align: center; }}

    .qa-group {{
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      margin-top: 8px;
      overflow: hidden;
      background: #fff;
    }}
    .qa-group[open] {{ border-color: #bfdbfe; }}
    .qa-summary {{
      list-style: none;
      cursor: pointer;
      padding: 10px 12px;
      background: #f8fafc;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      user-select: none;
    }}
    .qa-summary::-webkit-details-marker {{ display: none; }}
    .qa-summary::before {{
      content: "▸";
      color: #64748b;
      font-size: 12px;
      transition: transform .15s ease;
    }}
    .qa-group[open] > .qa-summary::before {{ transform: rotate(90deg); }}
    .qa-group[open] > .qa-summary {{ background: #eff6ff; border-bottom: 1px solid #dbeafe; }}
    .qa-summary-index {{
      font-weight: 700;
      color: #1d4ed8;
      font-size: 13px;
      white-space: nowrap;
    }}
    .qa-summary-title {{ font-weight: 600; color: #0f172a; flex: 1 1 200px; }}
    .qa-summary-meta {{ color: #64748b; font-size: 12px; }}

    .row-question td {{
      background: #eff6ff;
      font-weight: 600;
      color: #1e3a8a;
    }}
    .row-question .col-level {{
      background: #dbeafe;
      font-size: 12px;
    }}
    .row-answer td {{ background: #fff; font-size: 13px; }}
    .row-answer .col-content {{ padding-left: 14px; color: #334155; }}
    .row-answer .col-index {{ color: #94a3b8; }}
    .row-empty td {{ font-style: italic; }}

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
    <section class="panel">
      <div class="panel-head">
        <h2>高频问法</h2>
      </div>
      <div class="tag-list">{keyword_html}</div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>问答明细</h2>
        <span class="count-badge">共 {escape(str(collected))} 问</span>
      </div>
      {qa_table_html}
    </section>
  </main>
</body>
</html>"""
