"""淘宝市场分析 — 路径与常量（DeepSeek Agent 智能体 workspace 单轨）。"""

from __future__ import annotations

import platform
import sys
from pathlib import Path

MTOP_APP_KEY = "12574478"
MTOP_API = "mtop.relationrecommend.wirelessrecommend.recommend"
MTOP_API_VERSION = "2.0"
MTOP_BASE_URL = "https://h5api.m.taobao.com"

SEARCH_PAGE_SIZE = 48
DEFAULT_MAX_PAGES = 4
DEFAULT_ITEM_LIMIT = SEARCH_PAGE_SIZE * DEFAULT_MAX_PAGES
DEFAULT_TIMEOUT = 20
REQUEST_INTERVAL_SECONDS = 4.0
REQUEST_INTERVAL_JITTER_SECONDS = 2.0
REQUEST_RETRY_ATTEMPTS = 2
REQUEST_RETRY_BACKOFF_SECONDS = 2.2

_os_system = platform.system()
if _os_system == "Windows":
    DEFAULT_USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/136.0.0.0 Safari/537.36"
    )
elif _os_system == "Darwin":
    DEFAULT_USER_AGENT = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/136.0.0.0 Safari/537.36"
    )
else:
    DEFAULT_USER_AGENT = (
        "Mozilla/5.0 (X11; Linux x86_64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/136.0.0.0 Safari/537.36"
    )

SORT_PARAM_MAP = {
    "default": "_coefp",
    "sale": "_sale",
    "credit": "_ratesum",
    "price-asc": "bid",
    "price-desc": "_bid",
}

SORT_LABEL_MAP = {
    "default": "综合排序",
    "sale": "销量",
    "credit": "信用",
    "price-asc": "价格升序",
    "price-desc": "价格降序",
}

LOCATION_OPTIONS = [
    "北京",
    "天津",
    "河北",
    "山西",
    "内蒙古",
    "辽宁",
    "吉林",
    "黑龙江",
    "上海",
    "江苏",
    "浙江",
    "安徽",
    "福建",
    "江西",
    "山东",
    "河南",
    "湖北",
    "湖南",
    "广东",
    "广西",
    "海南",
    "重庆",
    "四川",
    "贵州",
    "云南",
    "西藏",
    "陕西",
    "甘肃",
    "青海",
    "宁夏",
    "新疆",
    "香港",
    "澳门",
    "台湾",
]

EXIT_SUCCESS = 0
EXIT_PARAM_ERROR = 1
EXIT_COOKIE_INVALID = 2
EXIT_API_RATE_LIMIT = 3
EXIT_API_ERROR = 4

BATCH_TIME_BUDGET_SEC = 120

TAOBAO_PLATFORM = "taobao"


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
