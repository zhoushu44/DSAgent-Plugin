"""达摩盘 API 客户端 — 由 workspace runtime 注入。"""

from __future__ import annotations

from ._runtime import (
    DmpCompetitionClient,
    DmpError,
    DmpRateLimitError,
    get_dmp_client,
)

__all__ = [
    "DmpCompetitionClient",
    "DmpError",
    "DmpRateLimitError",
    "get_dmp_client",
]
