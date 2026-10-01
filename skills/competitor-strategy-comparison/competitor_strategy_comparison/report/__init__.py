"""业务报告生成。"""

from .generator import write_business_report
from .html_generator import generate_strategy_report

__all__ = ["generate_strategy_report", "write_business_report"]
