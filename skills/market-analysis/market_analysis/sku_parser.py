"""SKU 明细解析 — 淘宝商品详情接口（mtop.taobao.pcdetail.data.get）。

字段结构（以 2026-11-18 实测为准，全部做容错降级）：
- ``data.item``        → 商品基础信息（title / itemId）
- ``data.skuBase.props``  → 规格维度列表，每项含 pid / name / values(vid, name, image)
- ``data.skuBase.sku2props`` / ``skuBase.skus`` → SKU_id → 属性路径 "pid:vid;pid:vid"
- ``data.skuCore.sku2info`` → SKU_id → 价格 / 库存 / 可购状态
  （同款商品也可能把价格放在 ``skuCore.sku2info[skuId].price`` 字典里）
"""

from __future__ import annotations

import re
from typing import Any

COLOR_KEYWORDS = ("颜色", "色系", "色彩", "花色")
SIZE_KEYWORDS = ("尺码", "尺寸", "规格", "号型", "身高", "码数", "大小", "适用年龄", "版本")

PROP_PATH_KEYS = ("propPath", "prop_path", "props", "propPathText", "skus")
SKU_MAP_KEYS = ("sku2props", "skuMap", "sku2prop", "skus")


def _text(value: Any) -> str:
    return str(value if value is not None else "").strip()


def _to_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    match = re.search(r"(\d+(?:\.\d+)?)", text.replace(",", ""))
    return float(match.group(1)) if match else None


def _fmt_price(value: float | None) -> str:
    if value is None:
        return ""
    return f"{value:g}"


def _classify_prop(name: str) -> str:
    lowered = name.lower()
    if any(keyword in name for keyword in COLOR_KEYWORDS) or "color" in lowered:
        return "color"
    if any(keyword in name for keyword in SIZE_KEYWORDS) or "size" in lowered:
        return "size"
    return "other"


def _build_prop_index(sku_base: dict[str, Any]) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for prop in sku_base.get("props") or []:
        if not isinstance(prop, dict):
            continue
        pid = _text(prop.get("pid"))
        name = _text(prop.get("name"))
        if not pid or not name:
            continue
        values: dict[str, dict[str, str]] = {}
        for value in prop.get("values") or []:
            if not isinstance(value, dict):
                continue
            vid = _text(value.get("vid"))
            if not vid:
                continue
            values[vid] = {
                "name": _text(value.get("name")),
                "image": _text(value.get("image")),
            }
        index[pid] = {
            "name": name,
            "kind": _classify_prop(name),
            "values": values,
        }
    return index


def _split_prop_path(prop_path: str) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for chunk in re.split(r"[;|,]", _text(prop_path)):
        if ":" not in chunk:
            continue
        pid, vid = chunk.split(":", 1)
        pid = pid.strip()
        vid = vid.strip()
        if pid and vid:
            pairs.append((pid, vid))
    return pairs


def _resolve_props(prop_path: str, props: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    resolved: list[dict[str, str]] = []
    for pid, vid in _split_prop_path(prop_path):
        prop = props.get(pid)
        if not prop:
            continue
        value = prop["values"].get(vid) or {}
        resolved.append({
            "pid": pid,
            "name": prop["name"],
            "kind": prop["kind"],
            "value": value.get("name", ""),
            "image": value.get("image", ""),
        })
    return resolved


def _build_sku_prop_map(sku_base: dict[str, Any]) -> dict[str, str]:
    """SKU_id → 属性路径字符串。"""
    mapping: dict[str, str] = {}
    for key in SKU_MAP_KEYS:
        node = sku_base.get(key)
        if not node:
            continue
        if isinstance(node, dict):
            for sku_id, value in node.items():
                if isinstance(value, str) and ":" in value:
                    mapping[_text(sku_id)] = value
                elif isinstance(value, dict):
                    path = ""
                    for prop_key in PROP_PATH_KEYS:
                        path = _text(value.get(prop_key))
                        if path:
                            break
                    if path:
                        mapping[_text(sku_id)] = path
        elif isinstance(node, list):
            for entry in node:
                if not isinstance(entry, dict):
                    continue
                sku_id = _text(entry.get("skuId") or entry.get("sku_id"))
                path = ""
                for prop_key in PROP_PATH_KEYS:
                    path = _text(entry.get(prop_key))
                    if path:
                        break
                if sku_id and path:
                    mapping[sku_id] = path
        if mapping:
            break
    return mapping


def _collect_prices(node: Any, acc: list[tuple[str, float]]) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            if isinstance(value, (dict, list)):
                _collect_prices(value, acc)
                continue
            number = _to_number(value)
            if number is None:
                continue
            key_l = str(key).lower()
            if "price" in key_l or key_l in {"promotionprice", "finalprice"}:
                acc.append((key_l, number))
    elif isinstance(node, list):
        for item in node:
            _collect_prices(item, acc)


BEFORE_KEYS = ("oriprice", "originalprice", "reserveprice", "lineprice", "price1")
AFTER_KEYS = ("promotionprice", "finalprice", "realprice", "activityprice", "discountprice", "price2")


def _pick_prices(info: dict[str, Any]) -> tuple[str, str]:
    prices: list[tuple[str, float]] = []
    _collect_prices(info, prices)
    if not prices:
        return "", ""
    before: float | None = None
    after: float | None = None
    for key, value in prices:
        if before is None and key in BEFORE_KEYS:
            before = value
        if after is None and key in AFTER_KEYS:
            after = value
    if before is None:
        for _, value in prices:
            if after is None or value != after:
                before = value
                break
    if before is None:
        before = prices[0][1]
    if after is None:
        for _, value in prices:
            if value != before:
                after = value
                break
    if after is None:
        after = before
    return _fmt_price(before), _fmt_price(after)


def _collect_stock(info: dict[str, Any]) -> tuple[str, str]:
    found: list[float] = []

    def _walk(node: Any) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if isinstance(value, (dict, list)):
                    _walk(value)
                    continue
                number = _to_number(value)
                if number is None:
                    continue
                key_l = str(key).lower()
                if "stock" in key_l or "quantity" in key_l:
                    found.append(number)
        elif isinstance(node, list):
            for item in node:
                _walk(item)

    _walk(info)
    if not found:
        return "", ""
    stock = found[0]
    return (f"{stock:g}", "是" if stock > 0 else "否")


def _prop_path_from_info(info: dict[str, Any]) -> str:
    for key in PROP_PATH_KEYS:
        value = info.get(key)
        if isinstance(value, str) and ":" in value:
            return value
    return ""


def parse_sku_detail(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """把商品详情 payload 解析成 SKU 明细行（只含 SKU 维度的原始值）。"""
    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        data = {}
    item = data.get("item") or {}
    sku_base = data.get("skuBase") or {}
    sku_core = data.get("skuCore") or {}

    props = _build_prop_index(sku_base)
    sku_prop_map = _build_sku_prop_map(sku_base)

    sku2info = sku_core.get("sku2info") or {}
    if not isinstance(sku2info, dict):
        sku2info = {}

    rows: list[dict[str, Any]] = []
    for sku_id, info in sku2info.items():
        if not isinstance(info, dict):
            continue
        sku_id = _text(sku_id)
        prop_path = sku_prop_map.get(sku_id) or _prop_path_from_info(info)
        resolved = _resolve_props(prop_path, props)
        price_before, price_after = _pick_prices(info)
        stock, in_stock = _collect_stock(info)

        color_parts = [p["value"] for p in resolved if p["kind"] == "color" and p["value"]]
        size_parts = [p["value"] for p in resolved if p["kind"] != "color" and p["value"]]
        spec_parts = [
            "=".join([p["name"], p["value"]]) for p in resolved if p["value"]
        ]
        rows.append({
            "sku_id": sku_id,
            "color": "/".join(color_parts),
            "size": "/".join(size_parts),
            "specs": " ; ".join(spec_parts),
            "price_before": price_before,
            "price_after": price_after,
            "stock": stock,
            "in_stock": in_stock,
            "prop_path": prop_path,
            "item_title": _text(item.get("title")),
        })

    if not rows:
        # 兜底：只有 props 没有 sku2info 时，退化成「维度值清单」，保证至少拿到规格结构
        for prop in sku_base.get("props") or []:
            if not isinstance(prop, dict):
                continue
            name = _text(prop.get("name"))
            for value in prop.get("values") or []:
                if not isinstance(value, dict):
                    continue
                rows.append({
                    "sku_id": "",
                    "color": value.get("name", "") if _classify_prop(name) == "color" else "",
                    "size": value.get("name", "") if _classify_prop(name) != "color" else "",
                    "specs": f"{name}={value.get('name', '')}",
                    "price_before": "",
                    "price_after": "",
                    "stock": "",
                    "in_stock": "",
                    "prop_path": "",
                    "item_title": _text(item.get("title")),
                })
    return rows