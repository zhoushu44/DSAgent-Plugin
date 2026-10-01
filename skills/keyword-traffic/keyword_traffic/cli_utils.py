"""CLI 共用工具。"""

from __future__ import annotations

import re

from .trend_fetcher import TrendFetcher


def sanitize_filename(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*\'"]+', "", name)


def resolve_cate_id(
    fetcher: TrendFetcher,
    keyword: str,
    cate_id: int,
) -> tuple[int, str]:
    if cate_id:
        return cate_id, ""
    categories = fetcher.get_categories(keyword)
    if not categories:
        from .alimama_client import AlimamaError

        raise AlimamaError(f"关键词 [{keyword}] 未匹配到任何行业类目")
    valid = [c for c in categories if c["cate_id"] != -999] or categories
    chosen = valid[0]
    return chosen["cate_id"], chosen["cate_name"]
