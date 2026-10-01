"""inject-report 用的 insights.md 自动修复与格式校验。"""

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
    "\U0000FE00-\U0000FE0F"
    "\U0000200D"
    "\U00002600-\U000026FF"
    "\U0000231A-\U0000231B"
    "\U00002B50"
    "\U00003030"
    "]+",
    flags=re.UNICODE,
)


def sanitize_insights(content: str) -> tuple[str, list[str]]:
    """自动修复常见格式问题，返回 (修复后内容, 修复说明列表)。"""
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


def validate_insights(content: str) -> list[str]:
    """返回致命错误列表；空列表表示通过。"""
    errors: list[str] = []

    if _EMOJI_RE.search(content):
        errors.append("洞察文件包含 emoji，请移除")

    if re.search(r"^# ", content, re.MULTILINE):
        errors.append("洞察文件包含一级标题 `# `，请改为 `## `")

    if len(re.findall(r"^## (.+)$", content, re.MULTILINE)) < 3:
        errors.append("洞察文件必须至少包含 3 个二级标题")

    return errors
