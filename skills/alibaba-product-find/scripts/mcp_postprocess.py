#!/usr/bin/env python3
"""Post-process MCP tool results for 1688 product search.

This module deliberately does not call 1688 HTTP APIs and does not read local
AK/token state. The Agent/client calls MCP tools first, then passes the raw MCP
result JSON to these helpers for deterministic formatting and comparison logic.
"""

from __future__ import annotations

import json
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Optional

from _output import (
    append_next_actions_markdown,
    format_compare_table,
    format_products_table,
    make_output,
)


def load_json_payload(path: Optional[str] = None) -> Any:
    """Load a JSON payload from a file or stdin."""
    raw = Path(path).read_text(encoding="utf-8") if path else sys.stdin.read()
    raw = raw.strip()
    if not raw:
        raise ValueError("缺少 MCP 工具返回结果，请通过 --mcp-result-file 或 stdin 传入 JSON")
    return json.loads(raw)


def _loads_if_json(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text:
        return value
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return value


def unwrap_mcp_payload(payload: Any) -> Any:
    """Unwrap common MCP/JSON-RPC envelopes and return business data."""
    payload = _loads_if_json(payload)

    if isinstance(payload, dict) and payload.get("error"):
        message = payload["error"].get("message") if isinstance(payload["error"], dict) else str(payload["error"])
        raise RuntimeError(message or "MCP 工具调用失败")

    result = payload.get("result") if isinstance(payload, dict) and "result" in payload else payload

    if isinstance(result, dict) and result.get("isError"):
        content = result.get("content") or []
        if content and isinstance(content[0], dict):
            raise RuntimeError(content[0].get("text") or "MCP 工具调用失败")
        raise RuntimeError("MCP 工具调用失败")

    if isinstance(result, dict) and "content" in result:
        content = result.get("content") or []
        if content and isinstance(content[0], dict) and "text" in content[0]:
            return unwrap_mcp_payload(content[0]["text"])
        return content

    return result


def _unwrap_1688_item(item: Dict[str, Any]) -> Dict[str, Any]:
    """1688 MTOP 返回的每个 item 实际数据在 item.data 内部。"""
    inner = item.get("data")
    if isinstance(inner, dict):
        # 保留 trackInfo 等元信息，但主数据用 inner
        merged = dict(inner)
        if "trackInfo" in item:
            merged.setdefault("_trackInfo", item["trackInfo"])
        return merged
    return item


def extract_product_items(payload: Any) -> List[Dict[str, Any]]:
    """Extract product item list from MCP `find_product` / gateway response."""
    data = unwrap_mcp_payload(payload)
    data = _loads_if_json(data)

    if isinstance(data, list):
        return [_unwrap_1688_item(item) if isinstance(item, dict) else item for item in data if isinstance(item, dict)]

    if isinstance(data, dict):
        # 1688 MTOP 响应: response.data.data.OFFER.items[]
        # 第一层 data: response.data
        layer1 = data.get("data")
        layer1 = _loads_if_json(layer1)
        if isinstance(layer1, dict):
            # 第二层 data: response.data.data
            layer2 = layer1.get("data")
            layer2 = _loads_if_json(layer2)
            if isinstance(layer2, dict):
                offer = layer2.get("OFFER")
                offer = _loads_if_json(offer)
                if isinstance(offer, dict):
                    items = offer.get("items")
                    items = _loads_if_json(items)
                    if isinstance(items, list):
                        return [_unwrap_1688_item(item) for item in items if isinstance(item, dict)]
            # 也可能直接在 layer1 上有 OFFER
            offer = layer1.get("OFFER")
            offer = _loads_if_json(offer)
            if isinstance(offer, dict):
                items = offer.get("items")
                items = _loads_if_json(items)
                if isinstance(items, list):
                    return [_unwrap_1688_item(item) for item in items if isinstance(item, dict)]

        # 通用路径回退
        for key in ("data", "items", "products", "similar_products"):
            value = data.get(key)
            value = _loads_if_json(value)
            if isinstance(value, list):
                return [_unwrap_1688_item(item) if isinstance(item, dict) else item for item in value if isinstance(item, dict)]
            if isinstance(value, dict):
                for inner_key in ("items", "products", "similar_products", "data"):
                    inner_value = _loads_if_json(value.get(inner_key))
                    if isinstance(inner_value, list):
                        return [_unwrap_1688_item(item) if isinstance(item, dict) else item for item in inner_value if isinstance(item, dict)]

    return []


def _normalize_tag_list(value: Any) -> List[Dict[str, str]]:
    if not value:
        return []
    if isinstance(value, str):
        value = _loads_if_json(value)
    if not isinstance(value, list):
        return []

    out: List[Dict[str, str]] = []
    for item in value:
        item = _loads_if_json(item)
        if isinstance(item, dict):
            out.append({"type": str(item.get("type", "")), "value": str(item.get("value", ""))})
        elif item:
            out.append({"type": "", "value": str(item)})
    return [item for item in out if item.get("value")]


def normalize_product(item: Dict[str, Any]) -> Dict[str, Any]:
    """Map MCP/API product fields to the legacy script field names."""
    import re as _re

    product_id = item.get("product_id") or item.get("itemId") or item.get("offerId") or ""
    detail_url = item.get("detail_url") or item.get("detailUrl") or item.get("linkUrl")
    if not detail_url and product_id:
        detail_url = f"https://detail.1688.com/offer/{product_id}.html"

    # 标题: 1688 的 title 含 HTML 高亮标签，需清除
    title_raw = item.get("title") or item.get("subject") or ""
    title = _re.sub(r"<[^>]+>", "", title_raw) if title_raw else ""

    # 图片: 1688 用 offerPicUrl
    image_url = item.get("image_url") or item.get("imageUrl") or item.get("image") or item.get("offerPicUrl") or ""

    # 价格: 1688 用 priceInfo.price
    price = item.get("price")
    if price is None:
        price_info = item.get("priceInfo")
        if isinstance(price_info, dict):
            price = price_info.get("price") or price_info.get("originalPrice")
        elif isinstance(price_info, list) and price_info:
            price = price_info[0].get("price") if isinstance(price_info[0], dict) else None
    if price is None:
        price = item.get("currentPrice")

    # 供应商: 1688 用 loginId / shop.text
    supplier = item.get("supplier") or item.get("company") or ""
    if not supplier:
        supplier = item.get("loginId") or ""
        if not supplier:
            shop = item.get("shop")
            if isinstance(shop, dict):
                supplier = shop.get("text") or shop.get("name") or shop.get("companyName") or ""

    # 30天成交: 1688 用 bookedCount
    sold_count = item.get("sold_count")
    if sold_count is None:
        sold_count = item.get("bookedCount") or item.get("soldOut")

    return {
        "product_id": str(product_id or ""),
        "title": title,
        "image_url": image_url,
        "detail_url": detail_url or "",
        "similarity_score": item.get("similarity_score") or item.get("score"),
        "price": price,
        "sku_id": item.get("sku_id") or item.get("skuId"),
        "sku_title": item.get("sku_title") or item.get("skuTitle") or "",
        "yx_index": item.get("yx_index") if item.get("yx_index") is not None else item.get("yxIndex"),
        "quantity_begin": item.get("quantity_begin") if item.get("quantity_begin") is not None else item.get("quantityBegin"),
        "unit": item.get("unit") or "",
        "supplier": supplier,
        "sold_count": sold_count,
        "stock_amount": item.get("stock_amount") if item.get("stock_amount") is not None else item.get("storeAmount"),
        "promotion_tags": item.get("promotion_tags") or item.get("promotionTags") or [],
        "service_infos": _normalize_tag_list(item.get("service_infos") or item.get("serviceInfos")),
        "selling_points": _normalize_tag_list(item.get("selling_points") or item.get("sellingPoints")),
        "raw": item,
    }


def normalize_products(payload: Any) -> List[Dict[str, Any]]:
    return [normalize_product(item) for item in extract_product_items(payload)]


def build_search_result(
    payload: Any,
    *,
    search_type: str,
    query: str = "",
    source_image: str = "",
    source_url: str = "",
) -> Dict[str, Any]:
    products = normalize_products(payload)
    result: Dict[str, Any] = {
        "success": True,
        "similar_products": products,
        "search_type": search_type,
        "total_results": len(products),
    }
    if query:
        result["query"] = query
    if source_image:
        result["source_image"] = source_image
    if source_url:
        result["source_url"] = source_url
    return result


def select_compare_products(products: List[Dict[str, Any]], limit: int = 3) -> List[Dict[str, Any]]:
    """Preserve the legacy three-dimension comparison selection logic."""
    if not products:
        return []

    candidates = [deepcopy(p) for p in products if p.get("title") or p.get("detail_url")]
    if not candidates:
        return []

    winners: List[tuple[Dict[str, Any], str]] = []

    by_sales = sorted(candidates, key=lambda p: int(p.get("sold_count") or 0), reverse=True)
    if by_sales:
        winners.append((by_sales[0], "销量最高"))

    priced = [p for p in candidates if p.get("price") is not None]
    if priced:
        winners.append((sorted(priced, key=lambda p: float(p["price"]))[0], "价格最低"))

    by_yx = sorted(candidates, key=lambda p: float(p.get("yx_index") or 0), reverse=True)
    if by_yx:
        winners.append((by_yx[0], "综合最优"))

    label_map: Dict[str, List[str]] = {}
    ordered: List[Dict[str, Any]] = []
    for product, label in winners:
        pid = product.get("product_id") or product.get("detail_url") or product.get("title")
        if pid in label_map:
            label_map[pid].append(label)
        else:
            label_map[pid] = [label]
            ordered.append(product)

    for product in ordered:
        pid = product.get("product_id") or product.get("detail_url") or product.get("title")
        product["_compare_label"] = " 且 ".join(label_map.get(pid, ["推荐"]))

    return ordered[:limit]


def build_compare_result(
    payload: Any,
    *,
    source_image: str = "",
    source_url: str = "",
    limit: int = 3,
) -> Dict[str, Any]:
    candidates = normalize_products(payload)
    compared = select_compare_products(candidates, limit)
    result: Dict[str, Any] = {
        "success": True,
        "source_image": source_image,
        "compare_products": compared,
        "search_type": "compare",
        "total_candidates": len(candidates),
        "total_compared": len(compared),
    }
    if source_url:
        result["source_url"] = source_url
    return result


def format_search_output(result: Dict[str, Any], header: str) -> Dict[str, Any]:
    total = result.get("total_results", 0)
    products = result.get("similar_products", [])
    message = format_products_table(products, header) if total else "未找到匹配商品"
    message = append_next_actions_markdown(message, total)
    return make_output(True, message, {"data": result})


def format_compare_output(result: Dict[str, Any]) -> Dict[str, Any]:
    compared = result.get("compare_products", [])
    total_candidates = result.get("total_candidates", 0)
    if compared:
        count = len(compared)
        if count == 1:
            header = f"### 同款比价结果\n\n从 {total_candidates} 个同款中综合评估，以下商品在多个维度均表现最优："
        else:
            header = f"### 同款比价结果\n\n从 {total_candidates} 个同款中选出 {count} 款对比："
        message = format_compare_table(compared, header)
    else:
        message = "未找到可比价的同款商品"
    return make_output(True, message, {"data": result})

