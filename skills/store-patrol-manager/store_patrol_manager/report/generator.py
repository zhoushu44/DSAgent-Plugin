"""形成报告上下文，不生成固定 HTML 模板，也不二次计算事实。"""
from __future__ import annotations

from typing import Any

from ..insights.modules import build_compact_summary


def build_report_context(facts: dict[str, Any]) -> dict[str, Any]:
    return {
        "compact": build_compact_summary(facts),
        "tables": facts.get("tables", {}),
        "category_mapping": facts.get("category_mapping", {}),
    }

