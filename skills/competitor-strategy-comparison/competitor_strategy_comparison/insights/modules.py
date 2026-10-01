"""数据模块与 AI 洞察章节映射。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..parse.audience import has_audience_data
from ..parse.flow import has_flow_data, has_keyword_data
from ..parse.overall import has_overall_data

MODULE_OVERALL = "overall"
MODULE_FLOW = "flow"
MODULE_AUDIENCE = "audience"

INSIGHT_CONCLUSION = "conclusion"
INSIGHT_TRAFFIC = "traffic"
INSIGHT_AUDIENCE = "audience"
INSIGHT_PROMOTION = "promotion"
INSIGHT_KEYWORDS = "keywords"
INSIGHT_RECOMMENDATIONS = "recommendations"

INSIGHT_MODULES = (
    INSIGHT_CONCLUSION,
    INSIGHT_TRAFFIC,
    INSIGHT_AUDIENCE,
    INSIGHT_PROMOTION,
    INSIGHT_KEYWORDS,
    INSIGHT_RECOMMENDATIONS,
)

INSIGHT_SECTION_HEADERS = {
    INSIGHT_CONCLUSION: "经营结论",
    INSIGHT_TRAFFIC: "流量与成交诊断",
    INSIGHT_AUDIENCE: "人群经营诊断",
    INSIGHT_PROMOTION: "推广渠道诊断",
    INSIGHT_KEYWORDS: "TOP关键词诊断",
    INSIGHT_RECOMMENDATIONS: "调整建议",
}

INSIGHTS_JSON_KEYS = {
    INSIGHT_CONCLUSION: "insights_conclusion",
    INSIGHT_TRAFFIC: "insights_traffic",
    INSIGHT_AUDIENCE: "insights_audience",
    INSIGHT_PROMOTION: "insights_promotion",
    INSIGHT_KEYWORDS: "insights_keywords",
    INSIGHT_RECOMMENDATIONS: "insights_recommendations",
}


def data_modules(result: dict[str, Any]) -> list[str]:
    modules: list[str] = []
    if has_overall_data(result.get("key_metrics")):
        modules.append(MODULE_OVERALL)
    if has_flow_data(result.get("promotion_strategy")):
        modules.append(MODULE_FLOW)
    if has_audience_data(result.get("audience_comparison")):
        modules.append(MODULE_AUDIENCE)
    return modules


def insights_required_modules(data_modules_list: list[str], result: dict[str, Any] | None = None) -> list[str]:
    if not data_modules_list:
        return []
    required = [INSIGHT_CONCLUSION, INSIGHT_RECOMMENDATIONS]
    if MODULE_OVERALL in data_modules_list:
        required.append(INSIGHT_TRAFFIC)
    if MODULE_AUDIENCE in data_modules_list:
        required.append(INSIGHT_AUDIENCE)
    if MODULE_FLOW in data_modules_list:
        required.append(INSIGHT_PROMOTION)
        if result and has_keyword_data(result.get("promotion_strategy")):
            required.append(INSIGHT_KEYWORDS)
    return required


def insight_artifact_path() -> Path:
    from ..cli_utils import default_insights_file

    return default_insights_file()


def missing_insight_modules(result: dict[str, Any]) -> list[str]:
    modules = data_modules(result)
    required = insights_required_modules(modules, result)
    if not insight_artifact_path().is_file():
        return required
    text = insight_artifact_path().read_text(encoding="utf-8")
    return [module for module in required if f"## {INSIGHT_SECTION_HEADERS[module]}" not in text]


def enrich_module_meta(result: dict[str, Any]) -> dict[str, Any]:
    from ..cli_utils import default_insights_artifacts

    modules = data_modules(result)
    required = insights_required_modules(modules, result)
    pending = missing_insight_modules(result)
    meta: dict[str, Any] = {
        "data_modules": modules,
        "insights_required": required,
        "insights_pending": pending,
    }
    if required:
        meta["insights_artifacts"] = default_insights_artifacts()
    return meta
