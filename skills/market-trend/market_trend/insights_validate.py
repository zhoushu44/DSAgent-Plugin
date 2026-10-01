"""inject-report 用的 insights.md 自动修复。"""

from __future__ import annotations

import re

_EMOJI_RE = re.compile(
    "["
    "\U0001F600-\U0001F64F"
    "\U0001F300-\U0001F5FF"
    "\U0001F680-\U0001F6FF"
    "\U0001F900-\U0001F9FF"
    "\U0001FA00-\U0001FA6F"
    "\U0001FA70-\U0001FAFF"
    "\U00002702-\U000027B0"
    "\U00002600-\U000026FF"
    "\U00002B50"
    "]+",
    flags=re.UNICODE,
)


def sanitize_insights(content: str) -> tuple[str, list[str]]:
    fixes: list[str] = []
    fixed_lines: list[str] = []

    for line in content.split("\n"):
        original = line
        if re.match(r"^# (?!#)", line):
            line = "#" + line
        if re.match(r"^##\s", line):
            line = re.sub(r"^(##)\s+", r"\1 ", _EMOJI_RE.sub("", line))
        if line != original:
            fixes.append(f"'{original.strip()}' → '{line.strip()}'")
        fixed_lines.append(line)

    return "\n".join(fixed_lines), fixes
