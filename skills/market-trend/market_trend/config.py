"""市场排行趋势分析 — 路径与常量（DeepSeek Agent 智能体 workspace 单轨）。"""

from __future__ import annotations

import sys
from pathlib import Path

SYCM_BASE_URL = "https://sycm.taobao.com"
CATEGORY_STD_PATH = "/cc/common/category/getStdCate.json"
CATEGORY_DEF_PATH = "/cc/common/category/getDefCate.json"

PAGE_SIZE = 20
DEFAULT_MAX_PAGES = 5
API_REQUEST_DELAY = 1.5

RANK_TYPE_CONFIGS = {
    "gmv": {
        "rank_type": "gmv",
        "label": "交易总量",
        "api_path": "/mc/mq/mkt/item/offline/rank.json",
        "index_code": "payByrCnt,uv",
        "metrics": [
            {"field": "payByrCnt", "label": "支付买家数"},
            {"field": "uv", "label": "访客数"},
        ],
        "show_keywords": True,
    },
    "growth": {
        "rank_type": "growth",
        "label": "交易增速",
        "api_path": "/mc/mq/mkt/item/offline/rank.json",
        "index_code": "payByrCnt,uv",
        "metrics": [
            {"field": "payByrCnt", "label": "支付买家数"},
            {"field": "uv", "label": "访客数"},
        ],
        "show_keywords": True,
    },
    "flow": {
        "rank_type": "flow",
        "label": "流量总量",
        "api_path": "/mc/mq/mkt/item/offline/rank/search.json",
        "index_code": "uv,searchUv",
        "metrics": [
            {"field": "uv", "label": "访客数"},
            {"field": "searchUv", "label": "搜索人数"},
        ],
        "show_keywords": False,
    },
    "add": {
        "rank_type": "add",
        "label": "加购收藏",
        "api_path": "/mc/mq/mkt/item/offline/rank/purpose.json",
        "index_code": "cartByrCnt,cltByrCnt,uv",
        "metrics": [
            {"field": "cartByrCnt", "label": "加购人数"},
            {"field": "cltByrCnt", "label": "收藏人数"},
            {"field": "uv", "label": "访客数"},
        ],
        "show_keywords": False,
    },
    "newitm_ipv": {
        "rank_type": "newitm_ipv",
        "label": "新品流量",
        "api_path": "/mc/mq/mkt/item/offline/rank.json",
        "index_code": "cartByrCnt,uv",
        "metrics": [
            {"field": "uv", "label": "访客数"},
            {"field": "payByrCnt", "label": "支付买家数"},
            {"field": "cartByrCnt", "label": "加购人数"},
        ],
        "show_keywords": False,
    },
}

DEFAULT_RANK_TYPE = "gmv"
BATCH_TIME_BUDGET_SEC = 300

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
