"""关键词助手业务数据结构定义"""

from dataclasses import dataclass, field, asdict

# 退出码
EXIT_SUCCESS = 0
EXIT_PARAM_ERROR = 1
EXIT_COOKIE_INVALID = 2
EXIT_API_ERROR = 4
EXIT_NO_PERMISSION = 7


@dataclass
class KeywordResult:
    """单条关键词拓展结果"""
    related_keyword: str = ""
    search_popularity: str = "-"
    click_rate: str = "-"
    pay_buyer_cnt: str = "-"
    pay_conv_rate: str = "-"
    demand_supply_ratio: str = "-"
    tmall_click_ratio: str = "-"
    free_click_rate: str = "-"
    search_popularity_change: str = "-"
    click_rate_change: str = "-"


@dataclass
class HotRankResult:
    """搜索排行榜数据项"""
    rank: int = 0
    keyword: str = ""
    search_popularity: str = "-"
    pay_rate: str = "-"
    click_rate: str = "-"
    free_click_rate: str = "-"

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class RankOutput:
    """搜索排行榜模式标准化输出"""
    status: str = "success"
    mode: str = "rank"
    rank_type: str = "hot"
    kw_type: str = "search"
    date_range: str = ""
    total_results: int = 0
    keywords: list[dict] = field(default_factory=list)
    csv_path: str = ""
    error_code: int = 0
    error_message: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SkillOutput:
    """Skill 标准化输出"""
    status: str = "success"  # success | error
    seed_keyword: str = ""
    date_range: str = ""
    total_results: int = 0
    top_keywords: list[dict] = field(default_factory=list)
    csv_path: str = ""
    error_code: int = 0
    error_message: str = ""

    def to_dict(self) -> dict:
        return asdict(self)
