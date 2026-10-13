from __future__ import annotations

import json
from typing import Any

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
    DETAIL_API,
    DETAIL_API_VERSION,
    DETAIL_BASE_URL,
    DETAIL_REFERER,
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
from .types import SkillError


def _browser_headers(referer: str, origin: str, ua: str) -> dict:
    """浏览器指纹头 — 所有 MTOP 调用必须携带。"""
    return {
        "Referer": referer,
        "Origin": origin,
        "User-Agent": ua,
        "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Not(A:Brand";v="24"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
    }


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


def _mtop_caller() -> MtopCaller:
    return MtopCaller(
        interval_seconds=REQUEST_INTERVAL_SECONDS,
        interval_jitter_seconds=REQUEST_INTERVAL_JITTER_SECONDS,
        max_attempts=REQUEST_RETRY_ATTEMPTS,
        backoff_seconds=REQUEST_RETRY_BACKOFF_SECONDS,
    )


class TaobaoRateListClient:
    def __init__(self) -> None:
        self._mtop = _mtop_caller()

    def fetch_page(
        self,
        *,
        item_id: str,
        page_no: int,
        page_size: int,
        order_type: str = "searchImpr",
        timeout: int = DEFAULT_TIMEOUT,
    ) -> dict[str, Any]:
        data = {
            "showTrueCount": False,
            "auctionNumId": str(item_id),
            "pageNo": page_no,
            "pageSize": page_size,
            "orderType": order_type or "searchImpr",
            "searchImpr": "-8",
            "expression": "",
            "skuVids": "",
            "rateSrc": "pc_rate_list",
            "rateType": "",
            "foldFlag": "0",
        }
        data_str = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        headers = _browser_headers(
            referer=f"https://detail.tmall.com/item.htm?id={item_id}",
            origin="https://detail.tmall.com",
            ua=DEFAULT_USER_AGENT,
        )
        try:
            return self._mtop.call(
                label="评价",
                url=f"{MTOP_BASE_URL}/h5/{MTOP_API}/{MTOP_API_VERSION}/",
                api=MTOP_API,
                version=MTOP_API_VERSION,
                data=data_str,
                headers=headers,
                extra_params={"timeout": "20000"},
                timeout=float(timeout),
                app_key=MTOP_APP_KEY,
            )
        except (
            TaobaoRiskControlError,
            TaobaoSessionExpiredError,
            TaobaoRateLimitError,
            TaobaoRequestError,
        ) as exc:
            raise _to_skill_error(exc, fallback="淘宝评价请求失败。") from exc


class TaobaoDetailClient:
    def __init__(self) -> None:
        self._mtop = _mtop_caller()

    def fetch_detail(
        self,
        *,
        item_id: str,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> dict[str, Any]:
        data = {"id": str(item_id)}
        data_str = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        # Referer/Origin 必须与 DETAIL_BASE_URL 同域（tmall），跨域会被 MTOP 判风控
        referer = DETAIL_REFERER.format(item_id=item_id)
        headers = _browser_headers(
            referer=referer,
            origin="https://detail.tmall.com",
            ua=DEFAULT_USER_AGENT,
        )
        try:
            return self._mtop.call_once(
                label="商品详情",
                url=f"{DETAIL_BASE_URL}/h5/{DETAIL_API}/{DETAIL_API_VERSION}/",
                api=DETAIL_API,
                version=DETAIL_API_VERSION,
                data=data_str,
                headers=headers,
                extra_params={"detail_v": "3.3.2", "timeout": "20000"},
                timeout=float(timeout),
                app_key=MTOP_APP_KEY,
            )
        except (
            TaobaoRiskControlError,
            TaobaoSessionExpiredError,
            TaobaoRateLimitError,
            TaobaoRequestError,
        ) as exc:
            raise _to_skill_error(exc, fallback="商品详情接口调用失败。") from exc
