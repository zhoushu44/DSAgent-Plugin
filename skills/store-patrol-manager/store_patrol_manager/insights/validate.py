"""确认报告分析所需的事实模块已冻结。"""
from __future__ import annotations


def missing_modules(facts: dict) -> list[str]:
    tables = facts.get("tables", {})
    required = ("shop_daily", "categories", "category_daily")
    return [name for name in required if not tables.get(name)]

