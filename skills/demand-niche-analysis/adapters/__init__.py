"""平台适配器注册表。新增平台：实现 PlatformAdapter 后在此登记一行。"""

from __future__ import annotations

from .base import AdapterError, CollectConstraints, NicheData, PlatformAdapter
from .taobao import TaobaoAdapter

ADAPTERS: dict[str, type] = {
    "taobao": TaobaoAdapter,
    # "douyin": DouyinAdapter,   # 后续扩展：实现 adapters/douyin.py 后登记
    # "pdd": PddAdapter,
}

SUPPORTED = list(ADAPTERS.keys())


def get_adapter(platform: str) -> PlatformAdapter:
    cls = ADAPTERS.get(platform)
    if not cls:
        raise AdapterError(
            "skill_error",
            f"平台「{platform}」暂未实现适配器（当前支持：{', '.join(SUPPORTED)}）。"
            "新平台请按 adapters/base.py 的接口实现后登记。",
        )
    return cls()

__all__ = ["ADAPTERS", "SUPPORTED", "get_adapter", "AdapterError", "CollectConstraints", "NicheData"]
