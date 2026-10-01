from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import quote

from ._runtime import (
    MtopCaller,
    TaobaoRateLimitError,
    TaobaoRequestError,
    TaobaoRiskControlError,
    TaobaoSessionExpiredError,
)
from .config import (
    DEFAULT_TIMEOUT,
    DEFAULT_USER_AGENT,
    EXIT_API_ERROR,
    EXIT_API_RATE_LIMIT,
    EXIT_COOKIE_INVALID,
    MTOP_API,
    MTOP_API_VERSION,
    MTOP_APP_KEY,
    MTOP_BASE_URL,
    REQUEST_INTERVAL_JITTER_SECONDS,
    REQUEST_INTERVAL_SECONDS,
    REQUEST_RETRY_ATTEMPTS,
    REQUEST_RETRY_BACKOFF_SECONDS,
)
from .types import SearchProduct, SkillError


def strip_html_tags(value: str) -> str:
    return re.sub(r"<[^>]*>", "", value or "")


def parse_count_text(text: str) -> int:
    if not text:
        return 0
    cleaned = re.sub(r"[^\d.万亿]", "", text)
    match = re.match(r"^([\d.]+)(万|亿)?", cleaned)
    if not match:
        return 0
    number = float(match.group(1))
    unit = match.group(2)
    if unit == "万":
        number *= 10000
    elif unit == "亿":
        number *= 100000000
    return int(number)


def normalize_image_url(url: str) -> str:
    if not url:
        return ""
    result = normalize_page_url(url)
    return re.sub(r"g[.\-]search\d*\.alicdn\.com", "img.alicdn.com", result)


def normalize_page_url(url: str) -> str:
    if not url:
        return ""
    result = url.strip()
    if result.startswith("//"):
        result = f"https:{result}"
    elif not result.startswith("http"):
        result = f"https://{result.lstrip('/')}"
    if result.startswith("http://"):
        result = result.replace("http://", "https://", 1)
    return result


def parse_search_products(
    payload: dict[str, Any], page: int
) -> tuple[list[SearchProduct], int]:
    """从 mtop 搜索响应中解析商品列表和总数。"""
    items_array = (
        payload.get("data", {}).get("itemsArray")
        or payload.get("data", {}).get("data", {}).get("itemsArray")
        or []
    )
    filtered_items = [item for item in items_array if not item.get("customCardType")]

    total_results_paths = [
        payload.get("data", {}).get("mainInfo", {}).get("totalResults"),
        payload.get("data", {}).get("totalResults"),
        payload.get("data", {}).get("data", {}).get("totalResults"),
    ]
    total_count = 0
    for candidate in total_results_paths:
        if candidate in (None, ""):
            continue
        try:
            total_count = int(str(candidate))
            break
        except ValueError:
            continue

    products: list[SearchProduct] = []
    for index, item in enumerate(filtered_items, start=1):
        sales_text = str(
            item.get("realSales") or item.get("totalSoldQuantity") or item.get("sales") or "0"
        )
        same_count_text = (
            item.get("sameCount")
            or item.get("sameStyleNum")
            or item.get("samepropNum")
            or item.get("i2iTags", {}).get("sameStyle", {}).get("count")
            or "0"
        )
        try:
            same_count = int(str(same_count_text))
        except ValueError:
            same_count = 0

        shop_name = str(item.get("nick") or item.get("shopcard", {}).get("shopName") or "")
        is_tmall = bool(
            item.get("shopType") == "tmall"
            or item.get("shopcard", {}).get("isTmall")
            or re.search(r"(旗舰|专卖|专营)店?$|百亿补贴", shop_name)
        )
        raw_title = str(item.get("raw_title") or "")
        html_title = str(item.get("title") or "")
        title = raw_title or strip_html_tags(html_title)
        original_price = str(item.get("price") or "")
        current_price = str(
            item.get("priceShow", {}).get("price")
            or item.get("view_price")
            or item.get("price")
            or ""
        )
        try:
            price = float(current_price)
        except ValueError:
            price = 0.0

        item_id = str(item.get("nid") or item.get("item_id") or item.get("itemId") or "")
        products.append(
            SearchProduct(
                item_id=item_id,
                title=title,
                main_image=normalize_image_url(str(item.get("pic_path") or item.get("pic") or "")),
                price=price,
                original_price=original_price,
                current_price=current_price,
                price_unit=str(item.get("priceShow", {}).get("unit") or "¥"),
                sales=sales_text,
                sales_count=parse_count_text(sales_text),
                same_count=same_count,
                shop_name=shop_name,
                shop_title=str(item.get("shopInfo", {}).get("title") or shop_name),
                shop_link=normalize_page_url(str(item.get("shopInfo", {}).get("url") or "")),
                is_tmall=is_tmall,
                location=str(item.get("procity") or item.get("item_loc") or item.get("location") or ""),
                product_link=(
                    f"https://item.taobao.com/item.htm?id={item_id}" if item_id else ""
                ),
                activity_tag=str(
                    item.get("i2iTags", {}).get("activity", [{}])[0].get("text") or ""
                ),
                category_id=str(item.get("leafCategory") or ""),
                is_p4p=bool(item.get("isP4p") == "true" or item.get("isP4p") is True),
                page=page,
                page_rank=index,
            )
        )

    return products, total_count


def _to_skill_error(exc: Exception, *, fallback: str) -> SkillError:
    if isinstance(exc, TaobaoRiskControlError):
        return SkillError(EXIT_API_ERROR, exc.message)
    if isinstance(exc, TaobaoSessionExpiredError):
        return SkillError(EXIT_COOKIE_INVALID, exc.message)
    if isinstance(exc, TaobaoRateLimitError):
        return SkillError(EXIT_API_RATE_LIMIT, exc.message)
    if isinstance(exc, TaobaoRequestError):
        return SkillError(EXIT_API_ERROR, exc.message)
    return SkillError(EXIT_API_ERROR, fallback)


class TaobaoMarketAnalysisClient:
    def __init__(self, *, cna: str = ""):
        self._cna = cna.strip()
        self._mtop = MtopCaller(
            interval_seconds=REQUEST_INTERVAL_SECONDS,
            interval_jitter_seconds=REQUEST_INTERVAL_JITTER_SECONDS,
            max_attempts=REQUEST_RETRY_ATTEMPTS,
            backoff_seconds=REQUEST_RETRY_BACKOFF_SECONDS,
        )

    def fetch_page(
        self,
        *,
        keyword: str,
        page: int,
        page_size: int,
        sort: str,
        location: str,
        price_min: float | None = None,
        price_max: float | None = None,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> dict[str, Any]:
        payload = self._build_payload(
            keyword=keyword,
            page=page,
            page_size=page_size,
            sort=sort,
            location=location,
            price_min=price_min,
            price_max=price_max,
        )
        data_str = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        headers = {
            "Referer": "https://s.taobao.com/",
            "Origin": "https://s.taobao.com",
            "User-Agent": DEFAULT_USER_AGENT,
        }
        try:
            return self._mtop.call(
                label="市场分析",
                url=f"{MTOP_BASE_URL}/h5/{MTOP_API}/{MTOP_API_VERSION}/",
                api=MTOP_API,
                version=MTOP_API_VERSION,
                data=data_str,
                headers=headers,
                extra_params={"timeout": "10000"},
                timeout=float(timeout),
                app_key=MTOP_APP_KEY,
            )
        except (
            TaobaoRiskControlError,
            TaobaoSessionExpiredError,
            TaobaoRateLimitError,
            TaobaoRequestError,
        ) as exc:
            raise _to_skill_error(exc, fallback="淘宝市场分析请求失败。") from exc

    def parse_products(
        self, payload: dict[str, Any], page: int
    ) -> tuple[list[SearchProduct], int]:
        return parse_search_products(payload, page)

    def _build_payload(
        self,
        *,
        keyword: str,
        page: int,
        page_size: int,
        sort: str,
        location: str,
        price_min: float | None,
        price_max: float | None,
    ) -> dict[str, Any]:
        start_price = str(price_min) if price_min not in (None, 0) else None
        end_price = str(price_max) if price_max not in (None, 0) else None
        params = {
            "device": "HMA-AL00",
            "isBeta": "false",
            "grayHair": "false",
            "from": "nt_history",
            "brand": "HUAWEI",
            "info": "wifi",
            "index": "4",
            "rainbow": "",
            "schemaType": "auction",
            "elderHome": "false",
            "isEnterSrpSearch": "true",
            "newSearch": "false",
            "network": "wifi",
            "subtype": "",
            "hasPreposeFilter": "false",
            "prepositionVersion": "v2",
            "client_os": "Android",
            "gpsEnabled": "false",
            "searchDoorFrom": "srp",
            "debug_rerankNewOpenCard": "false",
            "homePageVersion": "v7",
            "searchElderHomeOpen": "false",
            "search_action": "initiative",
            "sugg": "_4_1",
            "sversion": "13.6",
            "style": "list",
            "ttid": "600000@taobao_pc_10.7.0",
            "needTabs": "true",
            "areaCode": "CN",
            "vm": "nw",
            "m": "pc",
            "n": page_size,
            "q": quote(keyword, safe=""),
            "page": page,
            "sort": sort,
            "loc": location or "",
            "qSource": "url",
            "pageSource": "a21bo.jianhua/a.201856.d13",
            "tab": "all",
            "pageSize": page_size,
            "totalPage": 100,
            "totalResults": 4800,
            "sourceS": "0",
            "bcoffset": "",
            "ntoffset": "",
            "filterTag": "",
            "service": "",
            "prop": "",
            "start_price": start_price,
            "end_price": end_price,
            "startPrice": start_price,
            "endPrice": end_price,
            "itemIds": None,
            "p4pIds": None,
            "p4pS": None,
            "categoryp": "",
            "ha3Kvpairs": None,
            "myCNA": self._cna,
            "userAgent": DEFAULT_USER_AGENT,
        }
        return {
            "appId": "34385",
            "params": json.dumps(params, ensure_ascii=False, separators=(",", ":")),
        }
