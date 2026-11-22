from __future__ import annotations

import math
import re

from .config import DEFAULT_ITEM_LIMIT, LOCATION_OPTIONS, SKU_DEFAULT_ITEM_LIMIT
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

# ── SKU 明细开关 ────────────────────────────────────────
# 触发：说「要SKU价格 / SKU明细 / 各规格价格」等，采集时顺带拉每个商品的 SKU 价格。
# ★ 注意：必须带「价格/明细/表」等后缀才算 SKU 开关，
#   否则「sku收纳盒」这类商品词会被误判成要 SKU 明细，且词被删掉。
SKU_MARKER_RE = re.compile(
    r"(?:各|每个|要|带|含|加上|带上|顺便|一起)?\s*sku\s*(?:的\s*)?"
    r"(?:价格|明细|表|清单|信息|价格表|数据"
    r"|只取|只采|取|前|看)\s*\d{0,3}\s*(?:个|款|条)?",
    re.IGNORECASE,
)

SKU_EXTRA_WORDS = ("规格价格", "规格价", "规格明细", "各规格价格", "规格参数")

SKU_ITEM_LIMIT_PATTERNS = (
    r"sku\s*(?:只取|只采|取|前|看)\s*(\d{1,3})\s*(?:个|款|条)?",
    r"前\s*(\d{1,3})\s*(?:个|款|条)\s*(?:商品)?\s*sku",
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


def infer_with_sku(raw_query: str) -> bool:
    """是否要 SKU 明细。必须带后缀（价格/明细/表…），避免「sku收纳盒」误判。"""
    text = raw_query or ""
    if SKU_MARKER_RE.search(text):
        return True
    return any(word in text for word in SKU_EXTRA_WORDS)


def infer_sku_item_limit(raw_query: str) -> int:
    """显式写了「SKU 只取 N 个」才返回 N，否则返回 0（由调用方按 item_limit 兜底）。"""
    for pattern in SKU_ITEM_LIMIT_PATTERNS:
        match = re.search(pattern, raw_query, re.IGNORECASE)
        if match:
            return max(int(match.group(1)), 1)
    return 0


def extract_keyword(raw_query: str) -> str:
    text = raw_query.strip()
    if not text:
        return ""

    if not looks_like_prompt(text):
        return text

    candidate = re.sub(r"[，。！？,.!?]", " ", text)
    candidate = SKU_MARKER_RE.sub(" ", candidate)
    for word in SKU_EXTRA_WORDS:
        candidate = candidate.replace(word, " ")
    # 「SKU 只取 N 个」「前 N 个 SKU」这类计数说法不能留在关键词里
    candidate = re.sub(
        r"(?:sku)?\s*(?:只取|只采|取|前|看)\s*\d{1,3}\s*(?:个|款|条)?\s*(?:商品)?\s*sku?",
        " ",
        candidate,
        flags=re.IGNORECASE,
    )
    candidate = re.sub(
        r"(?:sku)?\s*(?:只取|只采)\s*\d{1,3}\s*(?:个|款|条)?",
        " ",
        candidate,
        flags=re.IGNORECASE,
    )
    candidate = re.sub(
        r"前\s*\d{1,3}\s*(?:个|款|条)\s*(?:商品)?\s*sku",
        " ",
        candidate,
        flags=re.IGNORECASE,
    )

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
    # 「在浙江发货」「女装在浙江发货」：先删「在+省+发货」，再删「在+省」
    candidate = re.sub(rf"在\s*({provinces_pattern})\s*(?:发货|地区)?", " ", candidate)
    candidate = re.sub(rf"({provinces_pattern})\s*(?:发货|地区)", " ", candidate)
    candidate = re.sub(
        r"(?:综合排序|综合|销量排序|销量优先|按销量|按信用|信用排序|排序|价格从低到高|价格从高到低|价格升序|价格降序)",
        " ",
        candidate,
    )
    candidate = re.sub(
        r"(?:帮我|请帮我|请|麻烦|给我|查看|看下|看一下|看看|查下|查一下|分析|研究|采集|抓取|拉取|加上|带上|包含|一起|顺便)",
        " ",
        candidate,
    )
    # 单独成词的「要」才删（避免把「要保暖内衣」变成「保暖内衣」）
    candidate = re.sub(r"(?:^|\s)要(?=\s|$)", " ", candidate)
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
    with_sku_override: bool = False,
    sku_item_limit_override: int | None = None,
) -> MarketAnalysisRequest:
    keyword = extract_keyword(raw_query)
    sort = normalize_sort(sort_override) if sort_override else infer_sort(raw_query)
    location = location_override or infer_location(raw_query)
    inferred_price_min, inferred_price_max = infer_price_range(raw_query)
    resolved_price_min = price_min if price_min is not None else inferred_price_min
    resolved_price_max = price_max if price_max is not None else inferred_price_max
    item_limit = item_limit_override or infer_item_limit(raw_query)
    required_pages = max(1, math.ceil(item_limit / max(page_size, 1)))
    with_sku = bool(with_sku_override) or infer_with_sku(raw_query)
    if with_sku:
        explicit_sku_limit = infer_sku_item_limit(raw_query)
        if sku_item_limit_override:
            sku_item_limit = sku_item_limit_override
        elif explicit_sku_limit:
            sku_item_limit = explicit_sku_limit
        else:
            # 默认：本次采到的商品全部补 SKU，但不超过安全上限
            sku_item_limit = min(item_limit, SKU_DEFAULT_ITEM_LIMIT)
    else:
        sku_item_limit = 0
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
        with_sku=with_sku,
        sku_item_limit=sku_item_limit,
    )
