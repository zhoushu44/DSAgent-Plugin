"""市场排行趋势分析 — 数据结构定义"""

from dataclasses import dataclass, field, asdict

# 退出码
EXIT_SUCCESS = 0
EXIT_PARAM_ERROR = 1
EXIT_COOKIE_INVALID = 2
EXIT_API_ERROR = 4
EXIT_NO_PERMISSION = 7


@dataclass
class MarketRankItem:
    """单个商品排行数据（从 API 响应解析）"""
    item_id: str = ""
    title: str = ""
    pict_url: str = ""
    detail_url: str = ""
    shop_title: str = ""
    is_tmall: bool = False
    shop_url: str = ""
    rank: int | None = None
    # 各指标字段（不同榜单类型使用不同字段）
    pay_byr_cnt: str = ""
    uv: str = ""
    core_keyword: str = ""
    search_uv: str = ""
    cart_byr_cnt: str = ""
    clt_byr_cnt: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class PeriodData:
    """单个周期的数据"""
    period_index: int = 0       # 0=往前3周, 1=往前2周, 2=往前1周, 3=基准周
    date_range: str = ""        # "2026-03-17|2026-03-23"
    date_label: str = ""        # "03.17-03.23" 或 "2026年3月"
    items: list[MarketRankItem] = field(default_factory=list)
    record_count: int = 0
    loaded_pages: int = 0
    total_pages: int = 0

    def to_dict(self) -> dict:
        return {
            "period_index": self.period_index,
            "date_range": self.date_range,
            "date_label": self.date_label,
            "record_count": self.record_count,
            "loaded_count": len(self.items),
            "total_pages": self.total_pages,
            "loaded_pages": self.loaded_pages,
        }


@dataclass
class TrendItem:
    """聚合后的趋势数据项"""
    item_id: str = ""
    title: str = ""
    pict_url: str = ""
    detail_url: str = ""
    shop_title: str = ""
    is_tmall: bool = False
    shop_url: str = ""
    # 4 周期排名: {"period1": rank_or_None, ...}
    ranks: dict = field(default_factory=dict)
    # 4 周期指标: {"period1": {"payByrCnt": "...", "uv": "..."}, ...}
    weekly_metrics: dict = field(default_factory=dict)
    # 趋势分析结果
    trend: str = "new"          # up/down/stable/new/drop
    rank_change: int | None = None
    current_rank: int | None = None
    first_appear_period: int | None = None
    core_keyword: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SkillOutput:
    """Skill 标准化输出"""
    status: str = "success"
    rank_type: str = "gmv"
    rank_type_label: str = "交易总量"
    trend_mode: str = "week"
    date_ranges: list[str] = field(default_factory=list)
    cate_id: str = ""
    cate_name: str = ""
    total_items: int = 0
    trend_items: list[dict] = field(default_factory=list)
    periods_summary: list[dict] = field(default_factory=list)
    summary: dict = field(default_factory=dict)
    csv_path: str = ""
    error_code: int = 0
    error_message: str = ""

    def to_dict(self) -> dict:
        return asdict(self)
