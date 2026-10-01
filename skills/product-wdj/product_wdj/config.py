"""问大家 — 路径与常量。"""

from __future__ import annotations

import platform
import sys
from pathlib import Path

MTOP_APP_KEY = "12574478"
LIST_API = "mtop.taobao.wdj.list.merge.search"
LIST_API_VERSION = "1.0"
DETAIL_API = "mtop.taobao.social.ugc.post.detail"
DETAIL_API_VERSION = "2.0"
MTOP_BASE_URL = "https://h5api.m.tmall.com"

DEFAULT_PAGE_SIZE = 10
DEFAULT_MAX_PAGES = 5
DEFAULT_ANSWER_PAGE_SIZE = 10
DEFAULT_TIMEOUT = 20
REQUEST_INTERVAL_SECONDS = 4.0
REQUEST_INTERVAL_JITTER_SECONDS = 2.0
REQUEST_RETRY_ATTEMPTS = 2
REQUEST_RETRY_BACKOFF_SECONDS = 2.2

# 技能自管时间预算（秒）。
#
# 宿主对技能子进程有 300 秒总超时（skill-service.ts `const timeout = 300_000`），
# 超时即 SIGKILL 且 stdout 无任何结果 —— 用户看到的是「技能超时被终止、0 条数据」。
# 而拉回答详情是「按问题串行 + 每请求 4~6 秒节流」：默认 5 页约 50 条问题，
# 实测单次详情请求间隔 5.3~5.8 秒，50 条问题轻易突破 300 秒。
#
# 因此技能必须自管 deadline：预算内尽力拉取，超预算即停止并如实上报截断，
# 而不是被宿主硬杀成零输出。240 秒给列表翻页 / 报告生成 / 落盘留出约 60 秒余量。
TIME_BUDGET_SECONDS = 240.0

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
