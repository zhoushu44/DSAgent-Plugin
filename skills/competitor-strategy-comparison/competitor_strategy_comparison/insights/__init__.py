"""数据模块识别、洞察读取与交付前校验。"""

from .io import (
    insights_requirement_message,
    load_insights_into_result,
    read_business_report,
    split_insight_sections,
)
from .modules import data_modules, enrich_module_meta, insights_required_modules, missing_insight_modules
from .validate import validate_result

__all__ = [
    "data_modules",
    "enrich_module_meta",
    "insights_requirement_message",
    "insights_required_modules",
    "load_insights_into_result",
    "missing_insight_modules",
    "read_business_report",
    "split_insight_sections",
    "validate_result",
]
