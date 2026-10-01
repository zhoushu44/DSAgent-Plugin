"""万相台 API 客户端 — 由 workspace runtime 注入。"""

from __future__ import annotations

from ._runtime import (
    AlimamaError,
    AlimamaInsightClient,
    AlimamaRateLimitError,
    AuthInfo,
)

__all__ = [
    "AlimamaError",
    "AlimamaInsightClient",
    "AlimamaRateLimitError",
    "AuthInfo",
]
