from __future__ import annotations

import json
from typing import Any

from .config import (
    DEFAULT_CUST_CROWD_TYPE,
    DEFAULT_DEVICE,
    DEFAULT_PAGE_CODE,
    DEFAULT_PROFILE_GRANULARITY,
    EXIT_API_ERROR,
    EXIT_COOKIE_INVALID,
    EXIT_NO_PERMISSION,
    OVERVIEW_DOMAIN,
    OVERVIEW_INDEX_CODES,
    PROFILE_DOMAIN,
    SYCM_BASE_URL,
    SYCM_MULTI_URL,
    SYCM_PAGE_INFO_URL,
)
from ._runtime import (
    ApiPermissionError,
    ApiSessionExpiredError,
    SycmApiError,
    SycmClient,
    SycmRequestError,
)
from .types import SkillError


def _wrap_sycm_error(exc: Exception) -> SkillError:
    if isinstance(exc, ApiSessionExpiredError):
        return SkillError(
            EXIT_COOKIE_INVALID,
            "生意参谋会话已失效，请在 DeepSeek Agent「平台连接」中重新登录。",
            failure_kind="token_expired",
        )
    # ★ 权限错误必须先于普通 API 错误判定。
    #   此前 ApiPermissionError 被降级为 EXIT_API_ERROR，插件侧只能靠关键词兜底，
    #   而「没有权限」曾被归到 token_expired —— 用户被引导去重新登录，但登录态完全有效，
    #   重登不解决任何问题（FIX-LOG #66）。
    if isinstance(exc, ApiPermissionError):
        message = getattr(exc, "message", str(exc))
        return SkillError(
            EXIT_NO_PERMISSION,
            f"{message}。当前账号登录态有效，但没有该业务/类目权限，"
            "请切换到有权限的账号后重试（到「账号连接」页面添加或切换账号）。",
            failure_kind="no_permission",
        )
    message = getattr(exc, "message", str(exc))
    return SkillError(EXIT_API_ERROR, message)


class SycmCustomerClient:
    def __init__(self) -> None:
        self._client = SycmClient()

    def fetch_overview(
        self,
        *,
        date_range: str,
        date_type: str = "day",
    ) -> dict[str, Any]:
        params = {
            "domainCode": OVERVIEW_DOMAIN,
            "dateType": date_type,
            "dateRange": date_range,
            "bizCode": "sycm_pc",
            "pluginFlag": "customerOverview",
            "showType": "overview",
            "needPeriodsCrc": "true",
            "device": str(DEFAULT_DEVICE),
            "indexCodes": OVERVIEW_INDEX_CODES,
        }
        return self._get(SYCM_BASE_URL, params)

    def fetch_page_info(self, *, page_code: str = DEFAULT_PAGE_CODE) -> dict[str, Any]:
        return self._get(SYCM_PAGE_INFO_URL, {"pageCode": page_code})

    def fetch_profiles(
        self,
        *,
        date_range: str,
        date_type: str = "recent30",
        attributes: list[str],
        granularity: str = DEFAULT_PROFILE_GRANULARITY,
        cust_crowd_type: str = DEFAULT_CUST_CROWD_TYPE,
    ) -> dict[str, Any]:
        query_items: list[dict[str, Any]] = []
        for attribute_name in attributes:
            query_items.append({
                "extMap": {
                    "granularity": granularity,
                    "custCrowdType": cust_crowd_type,
                    "attributeName": attribute_name,
                },
                "domainCode": PROFILE_DOMAIN,
                "dateType": date_type,
                "dateRange": date_range,
                "showType": "list",
                "device": DEFAULT_DEVICE,
                "indexCodes": "shopCustomerCnt,attrValue",
            })
        params = {
            "params": json.dumps(query_items, ensure_ascii=False, separators=(",", ":")),
        }
        return self._get(SYCM_MULTI_URL, params)

    def _get(self, url: str, params: dict[str, Any]) -> dict[str, Any]:
        try:
            return self._client.get(url, params)
        except (
            ApiSessionExpiredError,
            ApiPermissionError,
            SycmApiError,
            SycmRequestError,
        ) as exc:
            raise _wrap_sycm_error(exc) from exc
