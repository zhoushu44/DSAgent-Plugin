"""业务 Markdown 与 AI 洞察读取。"""

from __future__ import annotations

import re
from pathlib import Path

from .modules import INSIGHT_SECTION_HEADERS, INSIGHTS_JSON_KEYS, INSIGHT_MODULES, insight_artifact_path


def read_business_report(path: str | Path) -> str:
    report = Path(path)
    if not report.is_file():
        raise FileNotFoundError(f"找不到业务报告: {report}")
    return report.read_text(encoding="utf-8")


def split_insight_sections(md_text: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    current_key = ""
    current_lines: list[str] = []
    header_to_key = {f"## {title}": key for key, title in INSIGHT_SECTION_HEADERS.items()}

    for line in md_text.split("\n"):
        stripped = line.strip()
        matched = header_to_key.get(stripped)
        if matched:
            if current_key:
                sections[current_key] = "\n".join(current_lines).strip()
            current_key = matched
            current_lines = []
        else:
            current_lines.append(line)

    if current_key:
        sections[current_key] = "\n".join(current_lines).strip()
    return sections


def load_insights_into_result(result: dict[str, Any], *, required_modules: list[str]) -> str | None:
    path = insight_artifact_path()
    if not path.is_file():
        return f"找不到 AI 洞察文件: {path}"

    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return "AI 洞察内容为空"

    sections = split_insight_sections(text)
    missing = [
        INSIGHT_SECTION_HEADERS[module]
        for module in required_modules
        if not sections.get(module, "").strip()
    ]
    if missing:
        return "AI 洞察缺少以下章节：" + "、".join(missing)

    for module in INSIGHT_MODULES:
        result[INSIGHTS_JSON_KEYS[module]] = sections.get(module, "")
    return None


def insights_requirement_message(result: dict[str, Any]) -> str | None:
    from .modules import INSIGHT_SECTION_HEADERS, missing_insight_modules

    missing = missing_insight_modules(result)
    if not missing:
        return None
    labels = "、".join(INSIGHT_SECTION_HEADERS[module] for module in missing)
    template_lines = [f"## {INSIGHT_SECTION_HEADERS[module]}" for module in missing]
    return (
        f"生成 HTML 报告前，请先将 {labels} 写入固定路径 {insight_artifact_path()}，"
        f"并使用 ## 二级标题区分章节。示例：\n" + "\n".join(template_lines)
    )
