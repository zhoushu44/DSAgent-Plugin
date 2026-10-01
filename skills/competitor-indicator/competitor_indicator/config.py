"""竞品指标对比 — 路径与常量（DeepSeek Agent 智能体 workspace 单轨）。"""

from __future__ import annotations

import sys
from pathlib import Path

COMPETITION_TYPE_PRODUCT = "2"

SHOP_INDICATOR_ENDPOINT = "/api/competition/analysis/base/shop/indicator"
BASE_INDICATOR_ENDPOINT = "/api/competition/analysis/base/indicator"
FLOW_INDICATOR_ENDPOINT = "/api/competition/analysis/flow/indicator"
INSIGHT_TAG_CHART_ENDPOINT = "/api/dmp/insight/tag/chart"

INDICATOR_LABELS: dict[str, str] = {
    "pv": "整体IPV",
    "cartRate": "整体加购率",
    "alipayConversion": "整体成交转化率",
    "alipayCnt": "整体成交笔数",
    "averageOrderValue": "整体笔单价",
    "buyCrowdGmvRate": "新客成交占比",
    "clickAd": "付费点击量",
    "clickCost": "单次点击成本",
    "roi1d": "当天引导ROI",
    "alipayCnt1d": "当天引导成交笔数",
    "cartRate1d": "当天引导加购率",
    "alipayConversion1d": "当天引导成交转化率",
    "clickRate": "广告点击率",
}

# 报告顶部卡片：仅 shop + base（不混入 flow 汇总 / 人群画像）
CARD_INDICATOR_KEYS: tuple[str, ...] = (
    "pv",
    "cartRate",
    "alipayConversion",
    "alipayCnt",
    "averageOrderValue",
    "buyCrowdGmvRate",
    "clickAd",
    "clickCost",
    "roi1d",
    "alipayCnt1d",
)

# 整体指标：展示 key → (接口, API 字段…)
OVERALL_INDICATOR_SOURCES: dict[str, tuple[tuple[str, tuple[str, ...]], ...]] = {
    "pv": (("shop", ("pv", "click")),),
    "cartRate": (("shop", ("cartRate",)),),
    "alipayConversion": (("shop", ("alipayConversion",)),),
    "alipayCnt": (("shop", ("alipayCnt",)),),
    "averageOrderValue": (("shop", ("averageOrderValue",)),),
    "buyCrowdGmvRate": (("shop", ("buyCrowdGmvRate",)),),
    "clickAd": (("base", ("click",)),),
    "clickCost": (("base", ("clickCost",)),),
    "roi1d": (("base", ("roi1d",)),),
    "alipayCnt1d": (("base", ("alipayCnt1d",)),),
}

OVERALL_INDICATOR_KEYS: tuple[str, ...] = CARD_INDICATOR_KEYS

FLOW_CHANNEL_KEYS: tuple[str, ...] = (
    "clickAd",
    "alipayCnt1d",
    "cartRate1d",
    "alipayConversion1d",
    "clickRate",
)

# flow 响应字段名（display key → API key）
FLOW_CHANNEL_API: dict[str, str] = {
    "clickAd": "click",
    "alipayCnt1d": "alipayCnt1d",
    "cartRate1d": "cartRate1d",
    "alipayConversion1d": "alipayConversion1d",
    "clickRate": "clickRate",
    "roi1d": "roi1d",
}

# 人群画像：同行宝贝行为人群 + insight tag/chart（对齐 dmp_jzfx）
INSIGHT_MODULE_INSTANCE_ID = "102"
PEER_ITEM_CROWD_TAG_ID = "283736"
PEER_ITEM_CROWD_OPTION_GROUPS = (303279, 303280, 303281)  # 商品ID / 行为 / 天数

AUDIENCE_TAG_KEYS: tuple[tuple[str, int], ...] = (
    ("用户性别", 114554),
    ("用户年龄", 114555),
    ("消费能力等级", 163535),
)

# 同行宝贝行为人群 optionGroup 303280 行为码（对齐达摩盘「竞争分析」页，非 dmp_jzfx insight 那套）
# 竞争分析：1浏览 2搜索 3收藏 4购买 5加购
AUDIENCE_BEHAVIOR_LABELS: dict[str, str] = {
    "1": "浏览",
    "2": "搜索",
    "3": "收藏",
    "4": "购买",
    "5": "加购",
}

AUDIENCE_TIME_RANGE_LABELS: dict[str, str] = {
    "7": "最近7天",
    "15": "最近15天",
    "30": "最近30天",
    "90": "最近90天",
}

DEFAULT_AUDIENCE_ACTION_VALUES: tuple[str, ...] = ("2", "4")
DEFAULT_AUDIENCE_TIME_RANGE = "30"

EXIT_SUCCESS = 0
EXIT_PARAM_ERROR = 1
EXIT_COOKIE_INVALID = 2
EXIT_RATE_LIMIT = 3
EXIT_API_ERROR = 4

SYCM_PLATFORM = "sycm"


from ._runtime import workspace_root


def artifacts_dir() -> Path:
    path = workspace_root() / "artifacts"
    path.mkdir(parents=True, exist_ok=True)
    return path


def print_output_files(**files: str) -> None:
    paths = {k: str(v) for k, v in files.items() if v}
    if not paths:
        return
    print("\n---[OUTPUT_FILES]", file=sys.stderr)
    for label, path in paths.items():
        print(f"{label}: {path}", file=sys.stderr)
