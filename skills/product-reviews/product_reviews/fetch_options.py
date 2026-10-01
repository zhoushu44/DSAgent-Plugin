from __future__ import annotations

import re
from dataclasses import dataclass

from .config import DEFAULT_MAX_PAGES

DEFAULT_ORDER_TYPE = "searchImpr"
MAX_PAGES_WHEN_ALL = 500

_ORDER_TIME_PATTERNS = (
    r"时间排序",
    r"按时间",
    r"最新时间",
    r"时间最新",
    r"最新排序",
    r"按日期",
    r"时间排",
)
_ORDER_DEFAULT_PATTERNS = (
    r"综合排序",
    r"默认排序",
    r"综合排",
)
_FETCH_ALL_PATTERNS = (
    r"全部评价",
    r"所有评价",
    r"全部数据",
    r"所有数据",
    r"导出全部",
    r"获取全部",
    r"翻全部",
    r"全部页",
    r"所有页",
    r"完整评价",
)
_PAGE_COUNT_PATTERNS = (
    r"翻\s*(\d+)\s*页",
    r"抓\s*(\d+)\s*页",
    r"前\s*(\d+)\s*页",
    r"(\d+)\s*页",
)


@dataclass(frozen=True)
class FetchOptions:
    order_type: str = DEFAULT_ORDER_TYPE
    max_pages: int = DEFAULT_MAX_PAGES
    fetch_all: bool = False


def resolve_fetch_options(text: str = "") -> FetchOptions:
    """从自然语言描述解析排序与翻页策略；无明确说明时用默认排序 + 5 页。"""
    normalized = str(text or "").strip().lower()
    if not normalized:
        return FetchOptions()

    order_type = DEFAULT_ORDER_TYPE
    if any(re.search(pattern, normalized) for pattern in _ORDER_TIME_PATTERNS):
        order_type = "feedbackdate"
    elif any(re.search(pattern, normalized) for pattern in _ORDER_DEFAULT_PATTERNS):
        order_type = DEFAULT_ORDER_TYPE

    fetch_all = any(re.search(pattern, normalized) for pattern in _FETCH_ALL_PATTERNS)

    max_pages = DEFAULT_MAX_PAGES
    for pattern in _PAGE_COUNT_PATTERNS:
        match = re.search(pattern, normalized)
        if match:
            max_pages = max(1, int(match.group(1)))
            fetch_all = False
            break

    if fetch_all:
        return FetchOptions(order_type=order_type, max_pages=MAX_PAGES_WHEN_ALL, fetch_all=True)

    return FetchOptions(order_type=order_type, max_pages=max_pages, fetch_all=False)


def merge_fetch_options(
    *,
    intent: str = "",
    order_type: str | None = None,
    max_pages: int | None = None,
    fetch_all: bool = False,
) -> FetchOptions:
    resolved = resolve_fetch_options(intent)
    final_order = (order_type or resolved.order_type).strip() or DEFAULT_ORDER_TYPE
    if fetch_all or resolved.fetch_all:
        return FetchOptions(
            order_type=final_order,
            max_pages=MAX_PAGES_WHEN_ALL,
            fetch_all=True,
        )
    final_pages = max_pages if max_pages is not None else resolved.max_pages
    return FetchOptions(
        order_type=final_order,
        max_pages=max(1, final_pages),
        fetch_all=False,
    )
