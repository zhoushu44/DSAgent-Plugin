"""分析结果完整性校验。"""

from __future__ import annotations

from typing import Any

from .modules import data_modules


def validate_result(result: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    if not result.get("competitor_item", {}).get("validated_same_leaf_category"):
        issues.append("竞品未通过同叶子类目校验")
    if not data_modules(result):
        issues.append("未取得可用于分析的数据模块")
    if result.get("module_errors"):
        issues.append("部分模块取数失败，结论必须保留数据限制")
    return issues
