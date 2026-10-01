"""洞察 Markdown 读取与注入（固定 artifacts 路径，无需 CLI 传参）。"""

from __future__ import annotations

import logging
from typing import Any

from .modules import (
    INSIGHT_MODULES,
    INSIGHTS_JSON_KEYS,
    MODULE_LABELS,
    insight_artifact_path,
    missing_insight_modules,
)
from .validate import sanitize_insights, validate_module_insights

logger = logging.getLogger(__name__)


def load_insights_file(module: str) -> tuple[str, str | None]:
    label = MODULE_LABELS[module]
    md_path = insight_artifact_path(module)

    if not md_path.is_file():
        return "", f"找不到{label}洞察文件: {md_path}"

    text = md_path.read_text(encoding="utf-8")
    if not text.strip():
        return "", f"{label}洞察内容为空"

    fixed_md, fixes = sanitize_insights(text)
    if fixes:
        for fix in fixes:
            logger.info("[AUTO-FIX] %s", fix)
        md_path.write_text(fixed_md, encoding="utf-8")

    validation_err = validate_module_insights(fixed_md, module)
    if validation_err:
        return "", validation_err

    return fixed_md, None


def apply_insights_to_result(
    result: dict[str, Any],
    *,
    required_modules: list[str],
) -> str | None:
    for module in INSIGHT_MODULES:
        if module not in required_modules:
            continue
        content, err = load_insights_file(module)
        if err:
            return err
        result[INSIGHTS_JSON_KEYS[module]] = content
    return None


def insights_requirement_message(result: dict[str, Any]) -> str | None:
    missing = missing_insight_modules(result)
    if not missing:
        return None
    labels = "、".join(MODULE_LABELS[module] for module in missing)
    hints = [str(insight_artifact_path(module)) for module in missing]
    return (
        f"生成 HTML 报告前，请先将 {labels} 的 AI 分析写入固定路径："
        + "；".join(hints)
    )
