from __future__ import annotations

import math
import re

from .config import DEFAULT_ITEM_LIMIT, LOCATION_OPTIONS
from .types import MarketAnalysisRequest

SORT_PATTERNS = (
    (r"(?:按|用|走)?综合(?:排序)?", "default"),
    (r"(?:按|用|走)?销量(?:排序|优先)?", "sale"),
    (r"(?:按|用|走)?信用(?:排序)?", "credit"),
    (r"价格(?:从低到高|升序)", "price-asc"),
    (r"价格(?:从高到低|降序)", "price-desc"),
)

PROMPT_HINTS = (
    "帮我",
    "请帮",
    "查看",
    "看下",
    "看一下",
    "看看",
    "查下",
    "查一下",
    "分析",
    "趋势",
    "市场",
    "数据",
    "情况",
    "发货地",
    "排序",
)

REQUEST_PREFIXES = (
    "帮我看看",
    "帮我看",
    "帮我分析",
    "帮我",
    "请帮我",
    "请",
    "麻烦",
    "给我",
    "查看",
    "看下",
    "看一下",
    "看看",
    "查下",
    "查一下",
    "分析",
    "研究",
)

TRAILING_WORDS = (
    "趋势",
    "市场趋势",
    "市场分析",
    "市场",
    "分析",
    "数据",
    "数据分析",
    "情况",
    "热度",
)

ITEM_LIMIT_PATTERNS = (
    r"(?:分析|查看|看下|看一下|看看|查下|查一下|帮我看|帮我分析)?前\s*(\d{1,5})\s*(?:个|条|款|件)?(?:商品|宝贝|数据|结果)?",
    r"先看前\s*(\d{1,5})\s*(?:个|条|款|件)?(?:商品|宝贝|数据|结果)?",
)


def normalize_sort(raw_sort: str | None) -> str:
    if not raw_sort:
        return "default"
    value = raw_sort.strip().lower()
    aliases = {
        "default": "default",
        "综合": "default",
        "综合排序": "default",
        "sale": "sale",
        "销量": "sale",
        "销量排序": "sale",
        "credit": "credit",
        "信用": "credit",
        "信用排序": "credit",
        "price-asc": "price-asc",
        "价格升序": "price-asc",
        "价格从低到高": "price-asc",
        "price-desc": "price-desc",
        "价格降序": "price-desc",
        "价格从高到低": "price-desc",
    }
    return aliases.get(value, value)


def infer_sort(raw_query: str) -> str:
    for pattern, sort in SORT_PATTERNS:
        if re.search(pattern, raw_query):
            return sort
    return "default"


def infer_location(raw_query: str) -> str:
    for province in LOCATION_OPTIONS:
        if re.search(
            rf"(?:发货地|发货|所在地|地区)\s*[:：]?\s*{re.escape(province)}",
            raw_query,
        ):
            return province
        if re.search(rf"{re.escape(province)}\s*(?:发货|地区)", raw_query):
            return province
    return ""


def infer_price_range(raw_query: str) -> tuple[float | None, float | None]:
    between_match = re.search(
        r"(\d+(?:\.\d+)?)\s*(?:到|至|-|~)\s*(\d+(?:\.\d+)?)\s*元",
        raw_query,
    )
    if between_match:
        price_min = float(between_match.group(1))
        price_max = float(between_match.group(2))
        return (min(price_min, price_max), max(price_min, price_max))

    price_min: float | None = None
    price_max: float | None = None

    min_patterns = (
        r"(\d+(?:\.\d+)?)\s*元(?:以上|起)",
        r"最低\s*(\d+(?:\.\d+)?)\s*元",
        r"不少于\s*(\d+(?:\.\d+)?)\s*元",
        r"不低于\s*(\d+(?:\.\d+)?)\s*元",
    )
    max_patterns = (
        r"(\d+(?:\.\d+)?)\s*元(?:以下|以内)",
        r"最高\s*(\d+(?:\.\d+)?)\s*元",
        r"不超过\s*(\d+(?:\.\d+)?)\s*元",
        r"不高于\s*(\d+(?:\.\d+)?)\s*元",
    )

    for pattern in min_patterns:
        match = re.search(pattern, raw_query)
        if match:
            price_min = float(match.group(1))
            break

    for pattern in max_patterns:
        match = re.search(pattern, raw_query)
        if match:
            price_max = float(match.group(1))
            break

    return price_min, price_max


def infer_item_limit(raw_query: str) -> int:
    for pattern in ITEM_LIMIT_PATTERNS:
        match = re.search(pattern, raw_query)
        if match:
            return max(int(match.group(1)), 1)
    return DEFAULT_ITEM_LIMIT


def looks_like_prompt(raw_query: str) -> bool:
    stripped = raw_query.strip()
    return any(token in stripped for token in PROMPT_HINTS) or bool(
        re.search(r"\s", stripped)
    )


def extract_keyword(raw_query: str) -> str:
    text = raw_query.strip()
    if not text:
        return ""

    if not looks_like_prompt(text):
        return text

    candidate = re.sub(r"[，。！？,.!?]", " ", text)

    for prefix in REQUEST_PREFIXES:
        if candidate.startswith(prefix):
            candidate = candidate[len(prefix) :]
            break

    provinces_pattern = (
        "北京|天津|河北|山西|内蒙古|辽宁|吉林|黑龙江|上海|江苏|浙江|安徽|福建|"
        "江西|山东|河南|湖北|湖南|广东|广西|海南|重庆|四川|贵州|云南|西藏|"
        "陕西|甘肃|青海|宁夏|新疆|香港|澳门|台湾"
    )
    candidate = re.sub(
        rf"(?:发货地|发货|所在地|地区)\s*[:：]?\s*({provinces_pattern})",
        " ",
        candidate,
    )
    candidate = re.sub(rf"({provinces_pattern})\s*(?:发货|地区)", " ", candidate)
    candidate = re.sub(
        r"(?:综合排序|综合|销量排序|销量优先|按销量|信用排序|按信用|价格从低到高|价格从高到低|价格升序|价格降序)",
        " ",
        candidate,
    )
    candidate = re.sub(
        r"(?:帮我|请帮我|请|麻烦|给我|查看|看下|看一下|看看|查下|查一下|分析|研究)",
        " ",
        candidate,
    )
    candidate = re.sub(r"(?:一下|一下子|一眼|帮忙)", " ", candidate)
    candidate = re.sub(
        r"(?:分析|查看|看下|看一下|看看|查下|查一下|帮我看|帮我分析)?前\s*\d+\s*(?:个|条|款|件)?(?:商品|宝贝|数据|结果)?",
        " ",
        candidate,
    )
    candidate = re.sub(
        r"\d+(?:\.\d+)?\s*(?:到|至|-|~)\s*\d+(?:\.\d+)?\s*元",
        " ",
        candidate,
    )
    candidate = re.sub(
        r"(?:最低|最高|不少于|不低于|不超过|不高于)?\s*\d+(?:\.\d+)?\s*元(?:以上|以下|以内|起)?",
        " ",
        candidate,
    )

    for suffix in TRAILING_WORDS:
        candidate = re.sub(rf"{re.escape(suffix)}$", " ", candidate)
        candidate = re.sub(rf"的{re.escape(suffix)}$", " ", candidate)

    candidate = candidate.replace("的", " ")
    candidate = " ".join(candidate.split())
    return candidate or text


def resolve_request(
    raw_query: str,
    *,
    sort_override: str | None,
    location_override: str | None,
    item_limit_override: int | None,
    max_pages: int | None,
    page_size: int,
    price_min: float | None,
    price_max: float | None,
) -> MarketAnalysisRequest:
    keyword = extract_keyword(raw_query)
    sort = normalize_sort(sort_override) if sort_override else infer_sort(raw_query)
    location = location_override or infer_location(raw_query)
    inferred_price_min, inferred_price_max = infer_price_range(raw_query)
    resolved_price_min = price_min if price_min is not None else inferred_price_min
    resolved_price_max = price_max if price_max is not None else inferred_price_max
    item_limit = item_limit_override or infer_item_limit(raw_query)
    required_pages = max(1, math.ceil(item_limit / max(page_size, 1)))
    return MarketAnalysisRequest(
        raw_query=raw_query,
        keyword=keyword.strip(),
        sort=sort,
        location=location.strip(),
        price_min=resolved_price_min,
        price_max=resolved_price_max,
        item_limit=item_limit,
        max_pages=max(max_pages or 0, required_pages),
        page_size=page_size,
    )
