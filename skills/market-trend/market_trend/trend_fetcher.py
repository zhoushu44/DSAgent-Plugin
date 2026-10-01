"""市场排行趋势分析 — API 请求核心逻辑。"""

import logging
import math
import random
import time
from datetime import datetime, timedelta

from ._api_client import SycmClient

from .config import (
    PAGE_SIZE,
    RANK_TYPE_CONFIGS,
    SYCM_BASE_URL,
)
from .types import MarketRankItem, PeriodData

logger = logging.getLogger(__name__)


# ---------- 内联工具 ----------

class TimeBudget:
    """简易时间预算控制器。"""

    def __init__(self, total_seconds: float):
        self._deadline = time.time() + total_seconds

    def check(self, label: str = "") -> bool:
        """如果已超时返回 True，否则 False。"""
        if time.time() >= self._deadline:
            logger.warning("时间预算已耗尽%s", f" ({label})" if label else "")
            return True
        return False


def sleep_random(lo: float = 1.0, hi: float = 2.0) -> None:
    """随机延迟，避免请求过于规律。"""
    time.sleep(random.uniform(lo, hi))


# ---------- 数据解析 ----------

def _safe_str(value) -> str:
    """安全转换为字符串，None 或缺失返回空字符串"""
    if value is None:
        return ""
    return str(value)


def _parse_item(dto: dict) -> MarketRankItem:
    """将 API 响应的单条数据解析为 MarketRankItem"""
    item_info = dto.get("item") or {}
    shop_info = dto.get("shop") or {}

    return MarketRankItem(
        item_id=item_info.get("itemId", ""),
        title=item_info.get("title", ""),
        pict_url=item_info.get("pictUrl", ""),
        detail_url=item_info.get("detailUrl", ""),
        shop_title=shop_info.get("title", ""),
        is_tmall=shop_info.get("b2CShop", False),
        shop_url=shop_info.get("shopUrl", ""),
        rank=dto.get("cateRankId", {}).get("value"),
        pay_byr_cnt=_safe_str(dto.get("payByrCnt", {}).get("value")),
        uv=_safe_str(dto.get("uv", {}).get("value")),
        core_keyword=_safe_str(dto.get("coreKeyWord", {}).get("value")),
        search_uv=_safe_str(dto.get("searchUv", {}).get("value")),
        cart_byr_cnt=_safe_str(dto.get("cartByrCnt", {}).get("value")),
        clt_byr_cnt=_safe_str(dto.get("cltByrCnt", {}).get("value")),
    )


# ---------- 日期计算 ----------

def get_week_ranges(base_date_range: str) -> list[str]:
    """计算 4 周的日期范围（以 base 为基准周，向前推 3 周）。

    Args:
        base_date_range: 基准周 "YYYY-MM-DD|YYYY-MM-DD"

    Returns:
        [往前3周, 往前2周, 往前1周, 基准周]
    """
    start_str = base_date_range.split("|")[0]
    base_week_start = datetime.strptime(start_str, "%Y-%m-%d")

    ranges = []
    for i in range(3, -1, -1):
        week_start = base_week_start - timedelta(days=i * 7)
        week_end = week_start + timedelta(days=6)
        ranges.append(f"{week_start.strftime('%Y-%m-%d')}|{week_end.strftime('%Y-%m-%d')}")

    return ranges


def get_month_ranges(base_date_range: str) -> list[str]:
    """计算 4 个月的日期范围（以 base 所在月为基准，向前推 3 个月）。

    Args:
        base_date_range: 基准月 "YYYY-MM-DD|YYYY-MM-DD"

    Returns:
        [往前3月, 往前2月, 往前1月, 基准月]
    """
    start_str = base_date_range.split("|")[0]
    base_date = datetime.strptime(start_str, "%Y-%m-%d")
    # 取月初
    base_month_start = base_date.replace(day=1)

    ranges = []
    for i in range(3, -1, -1):
        # 向前推 i 个月
        month = base_month_start.month - i
        year = base_month_start.year
        while month <= 0:
            month += 12
            year -= 1
        month_start = datetime(year, month, 1)

        # 月末
        if month == 12:
            month_end = datetime(year + 1, 1, 1) - timedelta(days=1)
        else:
            month_end = datetime(year, month + 1, 1) - timedelta(days=1)

        ranges.append(f"{month_start.strftime('%Y-%m-%d')}|{month_end.strftime('%Y-%m-%d')}")

    return ranges


def get_period_ranges(base_date_range: str, trend_mode: str) -> list[str]:
    """根据趋势模式获取对应的 4 个周期日期范围"""
    if trend_mode == "month":
        return get_month_ranges(base_date_range)
    return get_week_ranges(base_date_range)


def get_default_week_range() -> str:
    """获取默认的基准周日期范围（上周一到上周日）"""
    today = datetime.now()
    # 本周一
    this_monday = today - timedelta(days=today.weekday())
    # 上周一
    last_monday = this_monday - timedelta(days=7)
    last_sunday = last_monday + timedelta(days=6)
    return f"{last_monday.strftime('%Y-%m-%d')}|{last_sunday.strftime('%Y-%m-%d')}"


def get_default_month_range() -> str:
    """获取默认的基准月日期范围（上个月）"""
    today = datetime.now()
    # 上月月初
    first_of_this_month = today.replace(day=1)
    last_month_end = first_of_this_month - timedelta(days=1)
    last_month_start = last_month_end.replace(day=1)
    return f"{last_month_start.strftime('%Y-%m-%d')}|{last_month_end.strftime('%Y-%m-%d')}"


def get_date_label(date_range: str, trend_mode: str) -> str:
    """生成日期标签"""
    start_str, end_str = date_range.split("|")
    start = datetime.strptime(start_str, "%Y-%m-%d")
    end = datetime.strptime(end_str, "%Y-%m-%d")

    if trend_mode == "month":
        return f"{start.year}年{start.month}月"
    return (
        f"{start.year % 100}年{start.month:02d}月{start.day:02d}日"
        f"-{end.year % 100}年{end.month:02d}月{end.day:02d}日"
    )


# ---------- API 请求 ----------

def fetch_page(
    client: SycmClient,
    date_range: str,
    rank_type: str,
    cate_id: str,
    page: int = 1,
    date_type: str = "week",
    cate_flag: str = "",
    seller_type: str = "-1",
    price_seg: str = "",
) -> dict | None:
    """获取单页商品排行数据。

    Returns:
        API 响应 JSON，失败返回 None
    """
    config = RANK_TYPE_CONFIGS[rank_type]
    url = f"{SYCM_BASE_URL}{config['api_path']}"

    params = {
        "dateRange": date_range,
        "dateType": date_type,
        "page": page,
        "pageSize": PAGE_SIZE,
        "cateId": cate_id,
        "cateFlag": cate_flag,
        "rankType": rank_type,
        "priceSeg": price_seg,
        "sellerType": seller_type,
        "keyWord": "",
        "indexCode": config["index_code"],
        "marketVersion": "free",
    }

    return client.get(url, params)


def fetch_period_data(
    client: SycmClient,
    date_range: str,
    rank_type: str,
    cate_id: str,
    max_pages: int = 0,
    date_type: str = "week",
    cate_flag: str = "",
    seller_type: str = "-1",
    price_seg: str = "",
    budget: TimeBudget | None = None,
) -> tuple[list[MarketRankItem], int]:
    """获取单个周期的全部数据（多页）。

    Args:
        max_pages: 最大页数，0 表示全部加载

    Returns:
        (items, record_count)
    """
    all_items: list[MarketRankItem] = []

    # 第一页
    data = fetch_page(
        client, date_range, rank_type, cate_id,
        page=1, date_type=date_type,
        cate_flag=cate_flag, seller_type=seller_type,
        price_seg=price_seg,
    )

    record_count = data.get("data", {}).get("recordCount", 0)
    total_pages = math.ceil(record_count / PAGE_SIZE)
    items_raw = data.get("data", {}).get("data", [])
    all_items.extend(_parse_item(dto) for dto in items_raw)

    if max_pages > 0:
        total_pages = min(total_pages, max_pages)

    logger.info(f"  第 1/{total_pages} 页，共 {record_count} 条")

    # 剩余页
    for page in range(2, total_pages + 1):
        if budget and budget.check("fetch_period_data"):
            break

        sleep_random(1.2, 2.0)

        data = fetch_page(
            client, date_range, rank_type, cate_id,
            page=page, date_type=date_type,
            cate_flag=cate_flag, seller_type=seller_type,
            price_seg=price_seg,
        )

        items_raw = data.get("data", {}).get("data", [])
        all_items.extend(_parse_item(dto) for dto in items_raw)
        logger.info(f"  第 {page}/{total_pages} 页")

    return all_items, record_count


def fetch_four_periods(
    client: SycmClient,
    rank_type: str,
    trend_mode: str,
    base_date_range: str,
    cate_id: str,
    max_pages: int = 0,
    cate_flag: str = "",
    seller_type: str = "-1",
    price_seg: str = "",
    budget: TimeBudget | None = None,
) -> list[PeriodData]:
    """获取 4 个周期的商品排行数据。

    Returns:
        4 个 PeriodData 列表
    """
    date_ranges = get_period_ranges(base_date_range, trend_mode)
    date_type = trend_mode  # "week" 或 "month"
    periods: list[PeriodData] = []

    import time as _time
    total_start = _time.time()

    for i, dr in enumerate(date_ranges):
        if budget and budget.check("fetch_four_periods"):
            break

        date_label = get_date_label(dr, trend_mode)

        logger.info(f"周期 {i + 1}/4: {date_label} 获取中...")
        period_start = _time.time()

        items, record_count = fetch_period_data(
            client, dr, rank_type, cate_id,
            max_pages=max_pages, date_type=date_type,
            cate_flag=cate_flag, seller_type=seller_type,
            price_seg=price_seg, budget=budget,
        )

        total_pages = math.ceil(record_count / PAGE_SIZE) if record_count > 0 else 0
        loaded_pages = min(total_pages, max_pages) if max_pages > 0 else total_pages
        elapsed = _time.time() - period_start

        periods.append(PeriodData(
            period_index=i,
            date_range=dr,
            date_label=date_label,
            items=items,
            record_count=record_count,
            loaded_pages=loaded_pages,
            total_pages=total_pages,
        ))

        logger.info(f"周期 {i + 1}/4: {date_label} 完成 ({len(items)}条, {elapsed:.0f}s)")

        # 周期间延迟（最后一个不需要）
        if i < len(date_ranges) - 1:
            sleep_random(1.2, 2.0)

    total_elapsed = _time.time() - total_start
    total_items = sum(len(p.items) for p in periods)
    logger.info(f"数据获取完成: 4个周期共 {total_items} 条, 耗时 {total_elapsed:.0f}s")

    return periods
