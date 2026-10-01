from __future__ import annotations

import re
from dataclasses import dataclass

from .config import DEFAULT_MAX_PAGES

MAX_PAGES_WHEN_ALL = 500

_FETCH_ALL_PATTERNS = (
    r"全部问题",
    r"所有问题",
    r"全部数据",
    r"所有数据",
    r"导出全部",
    r"获取全部",
    r"翻全部",
    r"全部页",
    r"所有页",
    r"完整问大家",
)
_PAGE_COUNT_PATTERNS = (
    r"翻\s*(\d+)\s*页",
    r"获取\s*(\d+)\s*页",
    r"前\s*(\d+)\s*页",
    r"(\d+)\s*页",
)
_SKIP_ANSWERS_PATTERNS = (
    r"仅问题",
    r"只要问题",
    r"不获取回答",
    r"跳过回答",
)


@dataclass(frozen=True)
class FetchOptions:
    max_pages: int = DEFAULT_MAX_PAGES
    fetch_all: bool = False
    tag_id: str = ""
    search_text: str = ""
    fetch_answers: bool = True


def resolve_fetch_options(text: str = "") -> FetchOptions:
    normalized = str(text or "").strip().lower()
    if not normalized:
        return FetchOptions()

    fetch_all = any(re.search(pattern, normalized) for pattern in _FETCH_ALL_PATTERNS)
    fetch_answers = not any(re.search(pattern, normalized) for pattern in _SKIP_ANSWERS_PATTERNS)

    max_pages = DEFAULT_MAX_PAGES
    for pattern in _PAGE_COUNT_PATTERNS:
        match = re.search(pattern, normalized)
        if match:
            max_pages = max(1, int(match.group(1)))
            fetch_all = False
            break

    search_text = ""
    search_match = re.search(r"搜索[:：]?\s*([^\s，,。]+)", normalized)
    if search_match:
        search_text = search_match.group(1)

    if fetch_all:
        return FetchOptions(
            max_pages=MAX_PAGES_WHEN_ALL,
            fetch_all=True,
            search_text=search_text,
            fetch_answers=fetch_answers,
        )

    return FetchOptions(
        max_pages=max_pages,
        fetch_all=False,
        search_text=search_text,
        fetch_answers=fetch_answers,
    )


def merge_fetch_options(
    *,
    intent: str = "",
    max_pages: int | None = None,
    fetch_all: bool = False,
    tag_id: str = "",
    search_text: str = "",
    fetch_answers: bool | None = None,
) -> FetchOptions:
    resolved = resolve_fetch_options(intent)
    final_pages = max_pages if max_pages is not None else resolved.max_pages
    final_fetch_all = fetch_all or resolved.fetch_all
    if final_fetch_all:
        return FetchOptions(
            max_pages=MAX_PAGES_WHEN_ALL,
            fetch_all=True,
            tag_id=tag_id,
            search_text=search_text or resolved.search_text,
            fetch_answers=resolved.fetch_answers if fetch_answers is None else fetch_answers,
        )
    return FetchOptions(
        max_pages=max(1, final_pages),
        fetch_all=False,
        tag_id=tag_id,
        search_text=search_text or resolved.search_text,
        fetch_answers=resolved.fetch_answers if fetch_answers is None else fetch_answers,
    )
