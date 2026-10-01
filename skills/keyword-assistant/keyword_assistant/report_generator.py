"""inject-report 用的 HTML 报告生成。"""

import logging
import re
from datetime import datetime

from .config import artifacts_dir

logger = logging.getLogger(__name__)


def generate_report_with_insights(
    report_data: dict,
    insights_md: str,
) -> str:
    """
    生成带 AI 洞察的 HTML 报告。
    report_data: 从第1次 CLI 调用的 JSON 输出解析而来
    insights_md: Agent 生成的 Markdown 格式洞察文本
    返回报告文件绝对路径。
    """
    html = _generate_insights_html(report_data, insights_md)

    filename = f"keyword_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html"
    out = artifacts_dir()
    filepath = str(out / filename)

    try:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(html)
        logger.info(f"AI 洞察报告已生成: {filepath}")
        return filepath
    except OSError as e:
        logger.error(f"报告写入失败: {e}")
        return ""


def _inline_md(text: str) -> str:
    """处理行内 Markdown：粗体、斜体、行内代码"""
    # 粗体
    text = re.sub(r"\*\*(.+?)\*\*", r'<strong class="text-neutral-900">\1</strong>', text)
    # 斜体
    text = re.sub(r"\*(.+?)\*", r"<em>\1</em>", text)
    # 行内代码
    text = re.sub(r"`(.+?)`", r'<code class="bg-neutral-100 px-1 py-0.5 rounded text-xs">\1</code>', text)
    return text


def _split_md_sections(md_text: str) -> list[dict]:
    """按 ## 标题拆分 Markdown 为多个 section，返回 [{"title": str, "body": str}, ...]"""
    sections: list[dict] = []
    current_title = ""
    current_lines: list[str] = []

    for line in md_text.split("\n"):
        h2_match = re.match(r"^##\s+(.+)$", line.strip())
        if h2_match:
            # 保存上一个 section
            body = "\n".join(current_lines).strip()
            if current_title or body:
                sections.append({"title": current_title, "body": body})
            current_title = h2_match.group(1)
            current_lines = []
        else:
            current_lines.append(line)

    # 最后一个 section
    body = "\n".join(current_lines).strip()
    if current_title or body:
        sections.append({"title": current_title, "body": body})

    return sections


def _section_body_to_html(body: str) -> str:
    """将单个 section 的 body Markdown 转为 HTML（处理 h3/h4、列表、段落）"""
    lines = body.split("\n")
    html_parts: list[str] = []
    in_ul = False
    in_ol = False

    for line in lines:
        stripped = line.strip()

        if not stripped:
            if in_ul:
                html_parts.append("</ul>")
                in_ul = False
            if in_ol:
                html_parts.append("</ol>")
                in_ol = False
            continue

        # h3/h4 标题
        h_match = re.match(r"^(#{3,4})\s+(.+)$", stripped)
        if h_match:
            if in_ul:
                html_parts.append("</ul>")
                in_ul = False
            if in_ol:
                html_parts.append("</ol>")
                in_ol = False
            level = len(h_match.group(1))
            text = _inline_md(h_match.group(2))
            css = {
                3: "text-sm font-semibold text-neutral-800 mt-3 mb-1.5",
                4: "text-sm font-medium text-neutral-600 mt-2 mb-1",
            }.get(level, "")
            html_parts.append(f'<h{level} class="{css}">{text}</h{level}>')
            continue

        # 无序列表
        ul_match = re.match(r"^[-*]\s+(.+)$", stripped)
        if ul_match:
            if in_ol:
                html_parts.append("</ol>")
                in_ol = False
            if not in_ul:
                html_parts.append('<ul class="list-disc list-inside space-y-1 text-sm text-neutral-700 ml-1">')
                in_ul = True
            html_parts.append(f"<li>{_inline_md(ul_match.group(1))}</li>")
            continue

        # 有序列表
        ol_match = re.match(r"^\d+\.\s+(.+)$", stripped)
        if ol_match:
            if in_ul:
                html_parts.append("</ul>")
                in_ul = False
            if not in_ol:
                html_parts.append('<ol class="list-decimal list-inside space-y-1 text-sm text-neutral-700 ml-1">')
                in_ol = True
            html_parts.append(f"<li>{_inline_md(ol_match.group(1))}</li>")
            continue

        # 普通段落
        if in_ul:
            html_parts.append("</ul>")
            in_ul = False
        if in_ol:
            html_parts.append("</ol>")
            in_ol = False
        html_parts.append(f'<p class="text-sm text-neutral-700 leading-relaxed mb-1.5">{_inline_md(stripped)}</p>')

    if in_ul:
        html_parts.append("</ul>")
    if in_ol:
        html_parts.append("</ol>")

    return "\n".join(html_parts)


def _generate_insights_html(report_data: dict, insights_md: str) -> str:
    """生成带 AI 洞察板块的完整 HTML"""
    date_range = report_data.get("dateRange", "")
    generated_at = report_data.get("generatedAt", datetime.now().strftime("%Y-%m-%d"))

    insights_sections = _split_md_sections(insights_md)

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>生意参谋关键词助手报告（含 AI 洞察）</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script>
        tailwind.config = {{
            theme: {{
                extend: {{
                    fontFamily: {{ sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'] }}
                }}
            }}
        }}
    </script>
</head>
<body class="min-h-screen bg-slate-50 text-neutral-900 font-sans selection:bg-blue-100 selection:text-blue-900">
    <header class="border-b border-blue-100 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 sticky top-0 bg-white/90 backdrop-blur-md z-10">
        <div class="flex items-center gap-3">
            <div class="w-7 h-7 bg-blue-600 rounded flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg>
            </div>
            <h1 class="text-base font-medium tracking-tight text-neutral-900">生意参谋关键词助手</h1>
            <span class="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">AI 洞察</span>
        </div>
        <div class="flex items-center gap-6 text-sm text-neutral-500">
            <div class="flex items-center gap-2">
                <span>周期:</span>
                <span class="text-neutral-900 font-medium">{date_range}</span>
            </div>
            <div class="hidden sm:block w-px h-4 bg-neutral-200"></div>
            <div class="hidden sm:flex items-center gap-2">
                <span>生成于:</span>
                <span class="text-neutral-900 font-medium">{generated_at}</span>
            </div>
        </div>
    </header>
    <main class="max-w-[1600px] mx-auto p-6 md:p-8">

        <!-- AI 洞察总标题 -->
        <div class="flex items-center gap-2 mb-6">
            <div class="w-5 h-5 bg-blue-600 rounded flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            <h2 class="text-base font-semibold text-neutral-900">AI 深度分析</h2>
        </div>

        <!-- 洞察卡片瀑布流 -->
        <style>.insights-waterfall {{ column-count: 1; column-gap: 1.25rem; }} @media (min-width: 768px) {{ .insights-waterfall {{ column-count: 2; }} }}</style>
        <div class="insights-waterfall mb-10">
"""

    for section in insights_sections:
        title = section["title"]
        body_html = _section_body_to_html(section["body"])

        if title:
            html += f"""
            <div class="bg-blue-50/60 border border-blue-200/60 rounded-xl p-5 mb-5 shadow-sm" style="break-inside: avoid;">
                <h3 class="text-sm font-semibold text-blue-900 mb-3 pb-2 border-b border-blue-200/50">{_inline_md(title)}</h3>
                <div class="space-y-1">
                    {body_html}
                </div>
            </div>"""
        else:
            html += f"""
            <div class="bg-neutral-50/80 border border-neutral-200/60 rounded-xl p-5 mb-5" style="break-inside: avoid;">
                <div class="space-y-1">
                    {body_html}
                </div>
            </div>"""

    html += """
        </div>

        <!-- 数据表格 -->
"""

    # 复用现有的数据表格渲染逻辑
    for section in report_data.get("sections", []):
        seed_kw = section["seedKeyword"]
        keywords = section["keywords"]

        if not keywords:
            html += f"""
        <div class="mb-4 flex items-center gap-3 text-sm">
            <span class="text-neutral-500">探索词根</span>
            <span class="font-medium text-blue-700 px-2.5 py-1 bg-blue-50 rounded-md border border-blue-100">{seed_kw}</span>
            <span class="text-neutral-400 ml-2">未能获取数据</span>
        </div>"""
            continue

        html += f"""
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 mt-8 first:mt-0">
            <div class="flex items-center gap-3 text-sm">
                <span class="text-neutral-500">探索词根</span>
                <span class="font-medium text-blue-700 px-2.5 py-1 bg-blue-50 rounded-md border border-blue-100">{seed_kw}</span>
                <span class="text-neutral-400 ml-2">{len(keywords)} 条结果</span>
            </div>
        </div>
        <div class="border border-blue-100 rounded-lg overflow-x-auto mb-12 bg-white shadow-sm">
            <table class="w-full text-left border-collapse whitespace-nowrap text-sm">
                <thead>
                    <tr class="bg-blue-50/80 border-b border-blue-100 text-blue-700">
                        <th class="px-6 py-3.5 font-medium w-16">排名</th>
                        <th class="px-6 py-3.5 font-medium">拓展词</th>
                        <th class="px-6 py-3.5 font-medium text-right">搜索人气</th>
                        <th class="px-6 py-3.5 font-medium text-right">点击率</th>
                        <th class="px-6 py-3.5 font-medium text-right">支付买家数</th>
                        <th class="px-6 py-3.5 font-medium text-right">支付转化率</th>
                        <th class="px-6 py-3.5 font-medium text-right">需求供给比</th>
                        <th class="px-6 py-3.5 font-medium text-right">天猫商品点击率</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-neutral-200/60">"""

        for kw in keywords:
            rank = kw["rank"]
            rank_html = f'<span class="text-blue-600 font-semibold">{rank}</span>' if rank <= 3 else str(rank)

            ds_ratio = kw["dsRatio"]
            if ds_ratio > 50:
                ds_class = "bg-blue-600 text-white border-blue-600"
            elif ds_ratio > 10:
                ds_class = "bg-blue-50 text-blue-700 border-blue-200"
            else:
                ds_class = "bg-transparent text-neutral-500 border-neutral-200"

            html += f"""
                    <tr class="hover:bg-blue-50/40 transition-colors group">
                        <td class="px-6 py-3.5 text-neutral-400 font-mono text-xs">{rank_html}</td>
                        <td class="px-6 py-3.5"><span class="font-medium text-neutral-900 group-hover:text-blue-700 transition-colors">{kw['keyword']}</span></td>
                        <td class="px-6 py-3.5 text-right text-neutral-600">{kw['searchPop']}</td>
                        <td class="px-6 py-3.5 text-right text-neutral-600 font-mono text-xs">{kw['ctr']}</td>
                        <td class="px-6 py-3.5 text-right text-neutral-600">{kw['buyers']}</td>
                        <td class="px-6 py-3.5 text-right text-neutral-600 font-mono text-xs">{kw['cvr']}</td>
                        <td class="px-6 py-3.5 text-right"><span class="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium border {ds_class}">{kw['dsRatio']}</span></td>
                        <td class="px-6 py-3.5 text-right text-neutral-400 font-mono text-xs">{kw['tmallCtr'] * 100:.2f}%</td>
                    </tr>"""

        html += """
                </tbody>
            </table>
        </div>"""

    html += """
    </main>
</body>
</html>"""

    return html
