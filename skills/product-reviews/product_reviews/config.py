"""商品评价 — 路径与常量。"""

from __future__ import annotations

import platform
import sys
from pathlib import Path

MTOP_APP_KEY = "12574478"
MTOP_API = "mtop.taobao.rate.detaillist.get"
MTOP_API_VERSION = "6.0"
MTOP_BASE_URL = "https://h5api.m.tmall.com"

DETAIL_API = "mtop.taobao.pcdetail.data.get"
DETAIL_API_VERSION = "1.0"
# 注意：同一 API 在 h5api.m.taobao.com 上会被平台风控硬拒
# （FAIL_SYS_USER_VALIDATE / RGV587_ERROR + action=denycdc_forbidden，且 punish 链接
# 的 pureCaptcha 为空、无滑块可过），换到 h5api.m.tmall.com 则稳定 SUCCESS，
# 返回结构（item / skuBase / skuCore / seller）与 taobao 域完全一致。
DETAIL_BASE_URL = "https://h5api.m.tmall.com"
DETAIL_REFERER = "https://detail.tmall.com/item.htm?id={item_id}"

DEFAULT_PAGE_SIZE = 20
DEFAULT_MAX_PAGES = 5
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

EXIT_SUCCESS = 0
EXIT_PARAM_ERROR = 1
EXIT_COOKIE_INVALID = 2
EXIT_API_RATE_LIMIT = 3
EXIT_API_ERROR = 4

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
