from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class MarketAnalysisRequest:
    raw_query: str
    keyword: str
    sort: str = "default"
    location: str = ""
    price_min: float | None = None
    price_max: float | None = None
    item_limit: int = 192
    max_pages: int = 4
    page_size: int = 48


@dataclass
class SearchProduct:
    item_id: str = ""
    title: str = ""
    main_image: str = ""
    price: float = 0.0
    original_price: str = ""
    current_price: str = ""
    price_unit: str = "¥"
    sales: str = ""
    sales_count: int = 0
    same_count: int = 0
    shop_name: str = ""
    shop_title: str = ""
    shop_link: str = ""
    is_tmall: bool = False
    location: str = ""
    product_link: str = ""
    activity_tag: str = ""
    category_id: str = ""
    is_p4p: bool = False
    page: int = 1
    page_rank: int = 1
    global_rank: int = 1

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PageSummary:
    page: int
    item_count: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SkillOutput:
    status: str = "success"
    raw_query: str = ""
    keyword: str = ""
    binding_source: str = ""
    requested_config: dict[str, Any] = field(default_factory=dict)
    total_count: int = 0
    collected_pages: int = 0
    collected_count: int = 0
    page_summaries: list[dict[str, Any]] = field(default_factory=list)
    products: list[dict[str, Any]] = field(default_factory=list)
    csv_path: str = ""
    json_path: str = ""
    report_path: str = ""
    analysis: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class SkillError(RuntimeError):
    def __init__(self, exit_code: int, message: str):
        super().__init__(message)
        self.exit_code = exit_code
