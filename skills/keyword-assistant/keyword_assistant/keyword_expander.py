"""关键词拓展核心逻辑"""

import logging
import random
import time
from datetime import datetime

from ._api_client import SycmClient


class TimeBudget:
    """时间预算控制器。"""

    def __init__(self, total_seconds: float):
        self._deadline = time.time() + total_seconds

    def check(self, label: str = "") -> bool:
        if time.time() >= self._deadline:
            logging.getLogger(__name__).warning(
                "时间预算已耗尽%s", f" ({label})" if label else ""
            )
            return True
        return False


def sleep_random(lo: float = 1.0, hi: float = 2.0) -> None:
    """随机延迟，防风控。"""
    time.sleep(random.uniform(lo, hi))

from .config import (
    KEYWORD_EXPAND_ENDPOINT,
    PAGE_SIZE,
    RANK_PAGE_SIZE,
    SEARCH_RANK_ENDPOINT,
    SYCM_BASE_URL,
)
from .types import HotRankResult, KeywordResult

logger = logging.getLogger(__name__)


def _safe_str(value) -> str:
    """安全转换为字符串，None 或缺失返回 '-'"""
    if value is None:
        return "-"
    return str(value)


def expand_keyword(
    client: SycmClient,
    seed_keyword: str,
    date_range: str,
    cate_id: str = "",
    max_pages: int = 1,
    order_by: str = "seIpvUvHits",
    budget: TimeBudget | None = None,
) -> list[KeywordResult]:
    """
    根据种子关键词拓展相关长尾词。
    返回 KeywordResult 列表。
    """
    total_expected = max_pages * PAGE_SIZE
    logger.info(f"正在拓展关键词: 【{seed_keyword}】 (最多 {max_pages} 页, 预计 {total_expected} 条)")

    date_type = _infer_date_type(date_range)
    results: list[KeywordResult] = []

    for page in range(1, max_pages + 1):
        if budget and budget.check(f"expand_keyword({seed_keyword})"):
            break

        logger.info(f"  第 {page}/{max_pages} 页...")
        params: dict = {
            "dateRange": date_range,
            "dateType": date_type,
            "pageSize": PAGE_SIZE,
            "page": page,
            "order": "desc",
            "orderBy": order_by,
            "keyWord": seed_keyword,
            "cycleFlag": "cycle",
            "rankType": "related",
            "device": "0",
            "marketVersion": "free",
        }
        if cate_id:
            params["cateId"] = cate_id

        data = client.get(f"{SYCM_BASE_URL}{KEYWORD_EXPAND_ENDPOINT}", params)

        items = data.get("data", {}).get("data", [])
        for item in items:
            result = KeywordResult(
                related_keyword=item.get("relatedSekeyword", {}).get("value", ""),
                search_popularity=_safe_str(item.get("seIpvUvHits", {}).get("value")),
                click_rate=_safe_str(item.get("clickThroughRate", {}).get("value")),
                pay_buyer_cnt=_safe_str(item.get("payByrCnt", {}).get("value")),
                pay_conv_rate=_safe_str(item.get("payConvRate", {}).get("value")),
                demand_supply_ratio=_safe_str(item.get("simWeight", {}).get("value")),
                tmall_click_ratio=_safe_str(item.get("tmaoClickRatio", {}).get("value")),
                free_click_rate=_safe_str(item.get("freeClkRate", {}).get("value")),
                search_popularity_change=_safe_str(item.get("seIpvUvHits", {}).get("cycleCrc")),
                click_rate_change=_safe_str(item.get("clickThroughRate", {}).get("cycleCrc")),
            )
            results.append(result)

        if len(items) < PAGE_SIZE:
            break  # 没有更多数据

        # 请求间隔，避免限流
        if page < max_pages:
            sleep_random(1.2, 2.0)

    logger.info(f"【{seed_keyword}】 拓展完成，共获取 {len(results)} 条结果")
    return results


def fetch_hot_rank(
    client: SycmClient,
    date_range: str,
    cate_id: str = "",
    max_pages: int = 1,
    rank_type: str = "hot",
    kw_type: str = "search",
    order_by: str = "seIpvUvHits",
    budget: TimeBudget | None = None,
) -> list[HotRankResult]:
    """
    获取搜索排行榜数据。
    rank_type: hot=热搜 | rise=飙升 | new=新词
    kw_type: search=搜索词 | category=类目词
    """
    logger.info(
        f"获取搜索排行榜: rank_type={rank_type}, kw_type={kw_type}, "
        f"max_pages={max_pages} (每页 {RANK_PAGE_SIZE} 条)"
    )

    date_type = _infer_date_type(date_range)
    results: list[HotRankResult] = []

    for page in range(1, max_pages + 1):
        if budget and budget.check("fetch_hot_rank"):
            break

        logger.info(f"  第 {page}/{max_pages} 页...")
        params: dict = {
            "dateRange": date_range,
            "dateType": date_type,
            "pageSize": RANK_PAGE_SIZE,
            "page": page,
            "order": "desc",
            "orderBy": order_by,
            "kwType": kw_type,
            "rankType": rank_type,
            "keyWord": "",
            "device": "0",
            "marketVersion": "free",
        }
        if cate_id:
            params["cateId"] = cate_id

        data = client.get(f"{SYCM_BASE_URL}{SEARCH_RANK_ENDPOINT}", params)

        items = data.get("data", {}).get("data", [])
        for item in items:
            result = HotRankResult(
                rank=item.get("rn", {}).get("value", 0),
                keyword=item.get("searchWord", {}).get("value", ""),
                search_popularity=_safe_str(item.get("seIpvUvHits", {}).get("value")),
                pay_rate=_safe_str(item.get("payRate", {}).get("value")),
                click_rate=_safe_str(item.get("clickThroughRate", {}).get("value")),
                free_click_rate=_safe_str(item.get("freeClkRate", {}).get("value")),
            )
            results.append(result)

        if len(items) < RANK_PAGE_SIZE:
            break

        # 请求间隔，避免限流
        if page < max_pages:
            sleep_random(1.2, 2.0)

    logger.info(f"搜索排行榜获取完成，共 {len(results)} 条")
    return results


def get_fallback_keywords(
    client: SycmClient,
    date_range: str,
    cate_id: str = "",
    count: int = 3,
) -> list[str]:
    """
    获取搜索排行榜热门关键词（用作兜底测试种子词）。
    """
    logger.info(f"获取搜索排行榜前 {count} 热词作为兜底种子词")

    date_type = _infer_date_type(date_range)
    params: dict = {
        "dateRange": date_range,
        "dateType": date_type,
        "pageSize": count,
        "page": 1,
        "order": "desc",
        "orderBy": "seIpvUvHits",
        "kwType": "search",
        "rankType": "hot",
        "keyWord": "",
        "device": "0",
        "marketVersion": "free",
    }
    if cate_id:
        params["cateId"] = cate_id

    data = client.get(f"{SYCM_BASE_URL}{SEARCH_RANK_ENDPOINT}", params)

    items = data.get("data", {}).get("data", [])
    keywords = [
        item.get("searchWord", {}).get("value", "")
        for item in items
        if item.get("searchWord")
    ]
    return keywords


def _infer_date_type(date_range: str) -> str:
    """根据日期范围推断 dateType"""
    try:
        start_str, end_str = date_range.split("|")
        start = datetime.strptime(start_str, "%Y-%m-%d")
        end = datetime.strptime(end_str, "%Y-%m-%d")
        delta = (end - start).days
        if delta == 0:
            return "day"
        if delta <= 7:
            return "recent7"
        return "recent30"
    except (ValueError, AttributeError):
        return "recent7"
