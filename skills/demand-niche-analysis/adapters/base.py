"""平台适配器抽象基类 —— 多平台通用的统一数据契约。

任何平台的适配器只需实现 collect()，把平台原始字段映射到 NicheData；
分析层 / 整理层 / 报告层只认本契约，不感知具体平台。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class KeywordTrendItem:
    """关键词趋势项（统一字段，跨平台映射）。"""

    word: str = ""
    search_popularity: int = 0
    popularity_change: str = ""     # 如 "+5.2%"，未知为空
    click_rate: float = 0.0
    pay_conv_rate: float = 0.0
    demand_supply_ratio: float = 0.0
    source: str = ""                # 数据来源标签（如 "sycm 关联词拓展"）


@dataclass
class ProductItem:
    """商品项（统一字段）。"""

    title: str = ""
    price: float = 0.0
    sales_count: int = 0
    is_tmall: bool = False
    location: str = ""
    page_rank: int = 0
    shop_name: str = ""


@dataclass
class NicheData:
    """统一数据契约：所有平台适配器的产出结构。"""

    platform: str = ""
    keyword: str = ""
    collected_at: str = ""
    keyword_trend: list[KeywordTrendItem] = field(default_factory=list)
    products: list[ProductItem] = field(default_factory=list)
    price_distribution: dict[str, Any] = field(default_factory=dict)
    data_gaps: list[str] = field(default_factory=list)
    raw_meta: dict[str, Any] = field(default_factory=dict)   # 平台特有信息（来源、日期范围等）

    def to_dict(self) -> dict[str, Any]:
        return {
            "platform": self.platform,
            "keyword": self.keyword,
            "collected_at": self.collected_at,
            "keyword_trend": [t.__dict__ for t in self.keyword_trend],
            "products": [p.__dict__ for p in self.products],
            "price_distribution": self.price_distribution,
            "data_gaps": self.data_gaps,
            "raw_meta": self.raw_meta,
        }


class CollectConstraints:
    """采集约束（人群/场景/价格带等，均可选）。"""

    def __init__(
        self,
        audience: str = "",
        scenario: str = "",
        price_min: float | None = None,
        price_max: float | None = None,
        item_limit: int = 120,
    ):
        self.audience = audience
        self.scenario = scenario
        self.price_min = price_min
        self.price_max = price_max
        self.item_limit = item_limit


class PlatformAdapter(Protocol):
    """平台适配器接口：新平台只需实现 collect()。"""

    platform: str

    def collect(self, keyword: str, constraints: CollectConstraints) -> NicheData:
        """采集该平台的关键词趋势 + 商品数据，映射到统一契约。

        失败时抛 AdapterError（携带 failure_kind）。
        """
        ...


class AdapterError(RuntimeError):
    """适配器失败：携带 failure_kind 供上层归类。"""

    def __init__(self, failure_kind: str, message: str):
        super().__init__(message)
        self.failure_kind = failure_kind
