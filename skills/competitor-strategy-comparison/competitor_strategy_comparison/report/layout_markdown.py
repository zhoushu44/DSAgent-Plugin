"""Markdown 洞察 → 参考布局 HTML 片段。"""



from __future__ import annotations



import re



import markdown



_MD = markdown.Markdown(extensions=["nl2br", "sane_lists"])





def md_inline(text: str) -> str:

    _MD.reset()

    html = _MD.convert(text.strip())

    return re.sub(r"^<p>(.*)</p>\s*$", r"\1", html, flags=re.DOTALL)





def md_block(text: str) -> str:

    if not text.strip():

        return ""

    _MD.reset()

    return _MD.convert(text.strip())





def render_conclusion_list(md_text: str) -> str:

    text = md_text.strip()

    if not text:

        return '<div class="no-data">本周期暂无经营结论</div>'

    items: list[str] = []

    for line in text.split("\n"):

        stripped = line.strip()

        if not stripped:

            continue

        if stripped.startswith("- "):

            items.append(f"<li>{md_inline(stripped[2:])}</li>")

        elif re.match(r"^\d+\.\s+", stripped):
            cleaned = re.sub(r"^\d+\.\s+", "", stripped)
            items.append(f"<li>{md_inline(cleaned)}</li>")

        elif stripped.startswith("<li"):

            items.append(stripped)

    if items:

        return f'<ul class="concl">{"".join(items)}</ul>'

    return f'<div class="diagnosis blue"><b>诊断：</b>{md_block(text)}</div>'





def render_diagnosis(md_text: str, *, css_class: str = "blue") -> str:

    text = md_text.strip()

    if not text:

        return ""

    body = md_block(text)

    if body.startswith("<ul") or body.startswith("<ol"):

        return f'<div class="diagnosis {css_class}">{body}</div>'

    if not body.startswith("<"):

        body = f"<b>诊断：</b>{body}"

    return f'<div class="diagnosis {css_class}">{body}</div>'





def split_sections(md_text: str) -> dict[str, str]:

    sections: dict[str, str] = {}

    current = ""

    current_lines: list[str] = []

    for line in md_text.split("\n"):

        m = re.match(r"^###\s+(.+)$", line.strip())

        if m:

            if current:

                sections[current] = "\n".join(current_lines).strip()

            current = m.group(1).strip()

            current_lines = []

        else:

            current_lines.append(line)

    if current:

        sections[current] = "\n".join(current_lines).strip()

    return sections





def render_advice_list(md_text: str) -> str:

    text = md_text.strip()

    if not text:

        return '<div class="no-data">本周期暂无调整建议</div>'



    blocks = re.split(r"\n(?=\d+\.\s+\*\*|\d+\.\s+[^*\n])", text)

    cards: list[str] = []

    for idx, block in enumerate(blocks, start=1):

        block = block.strip()

        if not block:

            continue

        title_match = re.match(r"^(\d+)\.\s+\*\*(.+?)\*\*", block)

        if title_match:

            number = title_match.group(1)

            title = title_match.group(2).strip()

            body = block[title_match.end() :].strip()

        else:

            title_match = re.match(r"^(\d+)\.\s+(.+?)(?:\n|$)", block)

            if not title_match:

                continue

            number = title_match.group(1)

            title = title_match.group(2).strip()

            body = block[title_match.end() :].strip()



        prio = "p3"

        prio_label = "建议"

        if idx == 1 or "最高" in title or "优先" in title:

            prio, prio_label = "p1", "最高优先级"

        elif idx <= 3 or "高优先" in title:

            prio, prio_label = "p2", "高优先级"



        no_cls = "p1" if prio == "p1" else ("p2" if prio == "p2" else "")

        lines: list[str] = []

        for raw in body.split("\n"):

            raw = raw.strip()

            if not raw:

                continue

            for label in ("数据依据", "具体动作", "观察指标", "后续观察指标"):

                if raw.startswith(f"{label}：") or raw.startswith(f"{label}:"):

                    value = raw.split("：", 1)[-1].split(":", 1)[-1].strip()

                    lines.append(f'<p><span class="lab">{label}</span>{md_inline(value)}</p>')

                    break

            else:

                if raw.startswith("- "):

                    lines.append(f"<p>{md_inline(raw[2:])}</p>")



        cards.append(

            '<div class="advice">'

            f'<div class="no {no_cls}">{escape_num(number)}</div>'

            "<div>"

            f'<h4>{md_inline(title)}<span class="prio {prio}">{prio_label}</span></h4>'

            f'{"".join(lines) if lines else f"<p>{md_inline(body)}</p>"}'

            "</div></div>"

        )



    if cards:

        return "".join(cards)

    return render_conclusion_list(text)





def escape_num(value: str) -> str:

    from html import escape



    return escape(value)

