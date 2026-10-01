from __future__ import annotations

import logging
from typing import Any

from ..types import SkillOutput
from .paths import default_insights_artifacts, insights_file_for_item
from .validate import sanitize_insights, validate_insights

logger = logging.getLogger(__name__)


def load_insights_file(item_id: str) -> tuple[str, str | None]:
    md_path = insights_file_for_item(item_id)
    if not md_path.is_file():
        return "", f"找不到问大家分析洞察文件: {md_path}"

    text = md_path.read_text(encoding="utf-8")
    if not text.strip():
        return "", "问大家分析洞察内容为空"

    fixed_md, fixes = sanitize_insights(text)
    if fixes:
        for fix in fixes:
            logger.info("[AUTO-FIX] %s", fix)
        md_path.write_text(fixed_md, encoding="utf-8")

    validation_err = validate_insights(fixed_md)
    if validation_err:
        return "", validation_err

    return fixed_md, None


def enrich_result_insights(result: SkillOutput, *, require: bool = False) -> str | None:
    item_id = str(result.item_id or "").strip()
    result.insights_artifacts = default_insights_artifacts(item_id)

    content, err = load_insights_file(item_id)
    if err:
        result.insights_review = ""
        result.insights_pending = ["review"]
        return err if require else None

    result.insights_review = content
    result.insights_pending = []
    return None


def insights_requirement_message(result: dict[str, Any] | SkillOutput) -> str | None:
    pending = result.get("insights_pending") if isinstance(result, dict) else result.insights_pending
    if not pending:
        return None
    artifacts = (
        result.get("insights_artifacts")
        if isinstance(result, dict)
        else result.insights_artifacts
    ) or {}
    md_path = artifacts.get("review_md") or ""
    return (
        "生成含分析结论的 HTML 报告前，请先将问大家 AI 分析写入固定路径："
        f"{md_path}"
    )
