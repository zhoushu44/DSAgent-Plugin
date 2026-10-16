#!/usr/bin/env python3
"""
1688 MTOP 网关客户端 —— 通过 DSAgent 本地网关代理调用 1688 MTOP API。

取代原千问办公的 MCP 远程连接器，改走本地网关 mtop_jsonp 协议。
Cookie 和签名由 gateway-proxy.ts 自动注入，技能不接触凭证。
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

# ── 运行时路径注入 ──
_RUNTIME_DIR = os.environ.get("DSAGENT_RUNTIME_DIR", "")
if _RUNTIME_DIR and _RUNTIME_DIR not in sys.path:
    sys.path.insert(0, _RUNTIME_DIR)

try:
    from platform_client import mtop_jsonp, fetch_binding_context, BindingContextError
except ImportError:
    # 开发/测试环境 fallback：从 skills/.dsagent/runtime/ 加载
    _SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
    _CANDIDATES = [
        os.path.join(_SCRIPT_DIR, "..", ".dsagent", "runtime"),
        os.path.join(_SCRIPT_DIR, "..", "..", ".dsagent", "runtime"),
        os.path.join(os.getcwd(), ".dsagent", "runtime"),
    ]
    for _p in _CANDIDATES:
        _p = os.path.normpath(_p)
        if os.path.isfile(os.path.join(_p, "platform_client.py")):
            sys.path.insert(0, _p)
            break
    from platform_client import mtop_jsonp, fetch_binding_context, BindingContextError


# ── 1688 MTOP 网关常量 ──

# 1688 H5 API 网关地址（与淘宝 h5api.m.taobao.com 同构）
MTOP_GATEWAY = "https://h5api.m.1688.com/h5/mtop.relationrecommend.wirelessrecommend.recommend/2.0/"

# 1688 商品搜索 API（PC 搜索页实际使用的 mtop 接口）
API_SEARCH = "mtop.relationrecommend.WirelessRecommend.recommend"
API_SEARCH_V = "2.0"
APP_ID = "32517"  # PC offer search

# 1688 供应商搜索 API（复用搜索接口，改 keywords + method）
# 1688 没有独立的供应商搜索 mtop，供应商信息从商品搜索结果的 company 字段提取

PLATFORM = "alibaba"

# 商品详情：mtop.1688.offer.detail.query.fortrade 已下线（FAIL_SYS_API_NOT_FOUNDED，
# 2026-10 实测 15+ 候选 API 名全部不存在）。改抓 PC 详情页 HTML 提取 og:image 主图 ——
# 这条链路只需要主图 URL（用于以图搜图找同款），页面 head 里的 og:image 足够且稳定。

# 排序值映射（SKILL.md 层 → 1688 mtop sortType）
_SORT_MAP = {
    "price_asc": "price-asc",
    "price_desc": "price-desc",
    "sold_desc": "booked",
    "yx_desc": "",  # 严选指数无对应，走默认相关性
    "": "",
}


def _check_binding() -> None:
    """检查 1688 账号是否已绑定，未绑定则抛出异常。"""
    try:
        fetch_binding_context(platform=PLATFORM)
    except BindingContextError:
        raise
    except Exception:
        # 非绑定类异常，忽略
        pass


def search_products(
    *,
    query: str = "",
    image_url: str = "",
    page_size: int = 10,
    sort_type: str = "",
    score_level: str = "high",
    purchase_amount: int = 1,
) -> dict[str, Any]:
    """
    调用 1688 MTOP 商品搜索 API。

    支持：
    - 文本搜索：query 非空
    - 图片搜索：image_url 非空（以图搜图）
    """
    _check_binding()

    # 1688 PC 搜索页 mtop 参数结构：{appId, params: JSON.stringify({...})}
    inner_params = {
        "keywords": query,
        "beginPage": 1,
        "pageSize": page_size,
        "method": "getOfferList",
        "verticalProductFlag": "pcmarket",
        "searchScene": "pcOfferSearch",
        "charset": "GBK",
    }

    # 排序
    mapped_sort = _SORT_MAP.get(sort_type, "")
    if mapped_sort:
        inner_params["sortType"] = mapped_sort

    # 图片搜索
    if image_url:
        inner_params["imageUri"] = image_url
        inner_params["searchType"] = "image"

    data = {
        "appId": APP_ID,
        "params": json.dumps(inner_params, ensure_ascii=False),
    }

    resp = mtop_jsonp(
        url=MTOP_GATEWAY,
        platform=PLATFORM,
        api=API_SEARCH,
        version=API_SEARCH_V,
        data=json.dumps(data, ensure_ascii=False),
        headers={
            "Referer": "https://s.1688.com/",
            "Origin": "https://s.1688.com",
        },
    )

    return resp


def query_offer_detail(offer_id: str) -> dict[str, Any]:
    """
    获取 1688 商品主图等信息（用于链接找同款流程的第一步）。

    原 mtop.1688.offer.detail.query.fortrade API 已下线，改抓 PC 详情页 HTML
    提取 og:image（<meta property="og:image">）作为主图，返回结构对齐旧 API：
    {"data": {"image": "<主图 URL>", "title": "<标题>", "offerId": "<id>"}}
    """
    _check_binding()

    from platform_client import http_get

    resp = http_get(
        url=f"https://detail.1688.com/offer/{offer_id}.html",
        platform=PLATFORM,
        headers={
            "Referer": "https://s.1688.com/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout=30,
    )

    payload = resp.get("payload", {}) if isinstance(resp, dict) else {}
    body = payload if isinstance(payload, str) else ""
    if not body and isinstance(payload, dict):
        body = payload.get("body") or payload.get("text") or ""

    import re

    # 主图提取（详情页无 og:image，主图在内嵌 JSON 的 mainImage 数组）：
    #   "mainImage":["https://cbu01.alicdn.com/img/ibank/xxx.jpg", ...]
    image = ""
    m = re.search(r'"mainImage"\s*:\s*\[\s*"([^"]+)"', body)
    if not m:
        # 兜底：og:image（部分模板/站点有配）
        m = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', body)
    if not m:
        m = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']', body)
    if m:
        image = m.group(1)

    title = ""
    t = re.search(r"<title>([^<]{0,120})", body)
    if t:
        title = t.group(1)

    if not image:
        raise RuntimeError(
            f"1688 详情页未提取到主图（og:image）。offerId={offer_id}，"
            f"页面长度={len(body)}。可能是页面结构变化或被风控，请重试或换 offerId 验证。"
        )

    return {"data": {"image": image, "title": title, "offerId": offer_id}}


def search_suppliers(*, query: str) -> dict[str, Any]:
    """
    1688 供应商搜索 —— 复用商品搜索 API，用关键词搜商品，
    从结果中提取去重的供应商信息。
    """
    _check_binding()

    inner_params = {
        "keywords": query,
        "beginPage": 1,
        "pageSize": 20,
        "method": "getOfferList",
        "verticalProductFlag": "pcmarket",
        "searchScene": "pcOfferSearch",
        "charset": "GBK",
    }

    data = {
        "appId": APP_ID,
        "params": json.dumps(inner_params, ensure_ascii=False),
    }

    resp = mtop_jsonp(
        url=MTOP_GATEWAY,
        platform=PLATFORM,
        api=API_SEARCH,
        version=API_SEARCH_V,
        data=json.dumps(data, ensure_ascii=False),
        headers={
            "Referer": "https://s.1688.com/",
            "Origin": "https://s.1688.com",
        },
    )

    return resp
