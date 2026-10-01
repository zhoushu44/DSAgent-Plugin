"""把大事实文件压缩为一次业务分析所需的目录，不重算指标。"""
from __future__ import annotations

from typing import Any


def build_compact_summary(facts: dict[str, Any]) -> dict[str, Any]:
    tables = facts.get("tables", {})
    comparisons = tables.get("category_comparison", [])
    return {
        "schema_version": facts.get("schema_version"),
        "run": facts.get("run", {}),
        "coverage": facts.get("coverage", {}),
        "summary": facts.get("summary", {}),
        "table_counts": {
            name: len(value) for name, value in tables.items()
            if isinstance(value, (list, dict))
        },
        "category_comparison_index": [
            {
                "store_category": row.get("store_category"),
                "industry_category": row.get("industry_category"),
                "valid_growth_pairs": row.get("valid_growth_pairs"),
            }
            for row in comparisons
        ],
        "warnings": facts.get("warnings", []),
    }

