"""AI 洞察 Markdown → HTML。"""

from __future__ import annotations

import re

import markdown

_MD = markdown.Markdown(extensions=["nl2br", "sane_lists"])


def render_insights_block(insights_md: str) -> str:
    text = insights_md.strip()
    if not text:
        return ""

    sections = _split_md_sections(text)
    cards: list[str] = []
    for section in sections:
        body_html = _section_body_to_html(section["body"])
        if not body_html and not section["title"]:
            continue
        title = section["title"]
        if title:
            cards.append(
                '<div class="insights-card">'
                f'<h4 class="insights-card-title">{_md_inline(title)}</h4>'
                f'<div class="insights-card-body">{body_html}</div>'
                "</div>"
            )
        else:
            cards.append(f'<div class="insights-card">{body_html}</div>')

    if not cards:
        body_html = _section_body_to_html(text)
        if not body_html:
            return ""
        return f'<div class="insights-block"><div class="insights-card-body">{body_html}</div></div>'

    if len(cards) == 1 and not sections[0]["title"]:
        return f'<div class="insights-block">{cards[0]}</div>'

    return (
        '<div class="insights-block">'
        f'<div class="insights-grid">{"".join(cards)}</div>'
        "</div>"
    )


def _split_md_sections(md_text: str) -> list[dict[str, str]]:
    sections: list[dict[str, str]] = []
    current_title = ""
    current_lines: list[str] = []
    for line in md_text.split("\n"):
        h3_match = re.match(r"^###\s+(.+)$", line.strip())
        if h3_match:
            body = "\n".join(current_lines).strip()
            if current_title or body:
                sections.append({"title": current_title, "body": body})
            current_title = h3_match.group(1)
            current_lines = []
        else:
            current_lines.append(line)
    body = "\n".join(current_lines).strip()
    if current_title or body:
        sections.append({"title": current_title, "body": body})
    return sections


def _section_body_to_html(body: str) -> str:
    if not body.strip():
        return ""
    _MD.reset()
    return _MD.convert(body).strip()


def _md_inline(text: str) -> str:
    _MD.reset()
    html = _MD.convert(text.strip())
    return re.sub(r"^<p>(.*)</p>\s*$", r"\1", html, flags=re.DOTALL)
