"""base_bridge.py —— product-reviews 的基座接入层

把原来的网关调用（platform_client.mtop_jsonp）换成淘宝基座
（skills/_shared/run-api.mjs → taobao-request.mjs → 纯 Node 自签）。

★ 保留原有 class 名与签名，`main.py` 不用改。
★ 基座不可用时自动回退网关（向后兼容，避免基座故障导致技能全挂）。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

# 定位 skills/_shared（含 run-api.mjs / taobao_base.py）
# 本文件位于 skills/product-reviews/product_reviews/ → 上溯 2 层到 skills/
_HERE = Path(__file__).resolve()
_SHARED = None
for _p in _HERE.parents:
    cand = _p / "_shared"
    if (cand / "run-api.mjs").is_file():
        _SHARED = cand
        break
if _SHARED is None:
    # 兼容：直接包含 run-api.mjs 的目录
    for _p in _HERE.parents:
        if (_p / "run-api.mjs").is_file():
            _SHARED = _p
            break
if _SHARED and str(_SHARED) not in sys.path:
    sys.path.insert(0, str(_SHARED))

try:
    from taobao_base import TaobaoBase, TaobaoBaseError
    _HAS_BASE = True
except Exception:                                    # noqa: BLE001
    _HAS_BASE = False


def base_available() -> bool:
    if not _HAS_BASE:
        return False
    try:
        ok, _ = TaobaoBase().is_available()
        return ok
    except Exception:                                # noqa: BLE001
        return False


def call_via_base(api_name: str, params: dict[str, Any]) -> dict[str, Any]:
    """走基座，返回 **mtop 原始 payload**（与旧网关返回结构一致，调用方无需改）。"""
    base = TaobaoBase()
    r = base.call(api_name, params)
    if not r.get("ok"):
        raise RuntimeError(
            f"基座调用失败 {api_name}: {r.get('failureKind') or r.get('error')} / {r.get('hint', '')}"
        )
    results = r.get("results") or []
    if not results:
        raise RuntimeError(f"基座无结果 {api_name}")
    data = results[0].get("data")
    # 旧调用方期望 {"data": {...}} 形态（mtop payload）
    return {"ret": ["SUCCESS::调用成功"], "data": data}


def call_via_base_data(api_name: str, params: dict[str, Any]) -> Any:
    return call_via_base(api_name, params).get("data")
