from __future__ import annotations

import re

MODULE_LABEL = "评价分析"


def sanitize_insights(content: str) -> tuple[str, list[str]]:
    fixes: list[str] = []
    fixed_lines: list[str] = []

    for line in content.split("\n"):
        original = line
        if re.match(r"^# (?!#)", line):
            line = "#" + line
        if line != original:
            fixes.append(f"'{original.strip()}' → '{line.strip()}'")
        fixed_lines.append(line)

    return "\n".join(fixed_lines), fixes


def validate_insights(content: str) -> str | None:
    text = content.strip()
    if not text:
        return f"{MODULE_LABEL}洞察内容为空"

    h2_count = len(re.findall(r"^##\s+", text, flags=re.MULTILINE))
    if h2_count < 4:
        return f"{MODULE_LABEL}洞察至少需要 4 个 ## 小节（当前 {h2_count} 个）"

    if len(text) < 300:
        return f"{MODULE_LABEL}洞察内容过短（至少 300 字，当前 {len(text)} 字）"

    return None
