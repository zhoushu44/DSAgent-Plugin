"""合并核心指标、人群和推广模块（仅 analyze 使用）。"""

from __future__ import annotations

from datetime import date
from typing import Any

from ..config import SCHEMA_VERSION


def build_result(
    *,
    shop_key: str,
    query: dict[str, str],
    scope: dict[str, Any],
    modules: dict[str, Any],
    errors: dict[str, str],
) -> dict[str, Any]:
    day_count = (date.fromisoformat(query["end"]) - date.fromisoformat(query["start"])).days + 1
    return {
        "schema": SCHEMA_VERSION,
        "shop_key": shop_key,
        "period": {
            "start_date": query["start"],
            "end_date": query["end"],
            "day_count": day_count,
        },
        "own_item": {
            "item_id": query["own_id"],
            "leaf_cate_id": scope["leaf_cate_id"],
            "raw": scope["own_item"],
        },
        "competitor_item": {
            "item_id": query["competitor_id"],
            "validated_same_leaf_category": True,
            "raw": scope["competitor_item"],
        },
        **modules,
        "module_errors": errors,
    }
