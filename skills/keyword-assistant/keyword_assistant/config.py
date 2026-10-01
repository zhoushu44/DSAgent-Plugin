"""关键词助手 — 路径与常量（DeepSeek Agent 智能体 workspace 单轨）。"""

from __future__ import annotations

import sys
from pathlib import Path

SYCM_BASE_URL = "https://sycm.taobao.com"
KEYWORD_EXPAND_ENDPOINT = "/mc/mq/mkt/keyword/relate/analysis.json"
SEARCH_RANK_ENDPOINT = "/mc/mq/mkt/keyword/rank/pro.json"

PAGE_SIZE = 10
DEFAULT_DATE_RANGE_DAYS = 7
DEFAULT_MAX_PAGES = 10
TOP_KEYWORDS_COUNT = 10
API_REQUEST_DELAY = 1.5
RANK_PAGE_SIZE = 50
BATCH_TIME_BUDGET_SEC = 180

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
