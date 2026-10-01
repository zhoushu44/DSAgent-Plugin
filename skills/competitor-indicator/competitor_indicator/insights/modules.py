"""数据模块 ↔ AI 洞察映射。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..parse import has_audience_data, has_flow_metrics, has_overall_metrics

MODULE_OVERALL = "overall"
MODULE_FLOW = "flow"
MODULE_AUDIENCE = "audience"

INSIGHT_MODULES = (MODULE_FLOW, MODULE_AUDIENCE)

INSIGHTS_JSON_KEYS = {
    MODULE_FLOW: "insights_flow",
    MODULE_AUDIENCE: "insights_audience",
}

MODULE_LABELS = {
    MODULE_FLOW: "流量来源",
    MODULE_AUDIENCE: "人群画像",
}


def insight_artifact_path(module: str) -> Path:
    from ..cli_utils import default_insights_audience_file, default_insights_flow_file

    if module == MODULE_FLOW:
        return default_insights_flow_file()
    return default_insights_audience_file()


def detect_data_modules(result: dict[str, Any]) -> list[str]:
    modules: list[str] = []
    if has_overall_metrics(result):
        modules.append(MODULE_OVERALL)
    if has_flow_metrics(result):
        modules.append(MODULE_FLOW)
    if has_audience_data(result):
        modules.append(MODULE_AUDIENCE)
    return modules


def insights_required_modules(data_modules: list[str]) -> list[str]:
    return [module for module in INSIGHT_MODULES if module in data_modules]


def missing_insight_modules(result: dict[str, Any]) -> list[str]:
    """缺哪些模块的洞察文件（仅以磁盘文件为准，JSON 不算已满足）。"""
    required = insights_required_modules(detect_data_modules(result))
    return [
        module
        for module in required
        if not insight_artifact_path(module).is_file()
    ]


def enrich_module_meta(result: dict[str, Any]) -> dict[str, Any]:
    from ..cli_utils import default_insights_artifacts

    modules = detect_data_modules(result)
    required = insights_required_modules(modules)
    pending = [
        module
        for module in required
        if not insight_artifact_path(module).is_file()
    ]
    meta: dict[str, Any] = {
        "data_modules": modules,
        "insights_required": required,
        "insights_pending": pending,
    }
    if required:
        meta["insights_artifacts"] = default_insights_artifacts()
    return meta
