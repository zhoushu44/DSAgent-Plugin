"""巡店客户端由 DeepSeek Agent workspace runtime 注入。"""
from __future__ import annotations

from ._runtime import (
    BindingContextError,
    WorkspaceCache,
    get_alimama_client,
    get_sycm_client,
    get_taobao_shop_key,
)

__all__ = [
    "BindingContextError",
    "WorkspaceCache",
    "get_alimama_client",
    "get_sycm_client",
    "get_taobao_shop_key",
]
