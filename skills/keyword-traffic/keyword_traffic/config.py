"""关键词流量解析 — 路径与常量（DeepSeek Agent 智能体 workspace 单轨）。"""

from __future__ import annotations

import sys
from pathlib import Path

MODULE_CATEGORY_LIST = 1571
MODULE_TREND_DATA = 1541
MODULE_MARKET_SUMMARY = 1465

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
