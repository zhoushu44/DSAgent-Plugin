"""商品市场分析 — Connect skill-cache（按 shop_key）。"""

from __future__ import annotations

import logging
from typing import Sequence

from .config import TAOBAO_PLATFORM
from ._runtime import WorkspaceCache, read_skill_slug

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS cache_market_analysis_products (
    shop_key        TEXT    NOT NULL,
    item_id         TEXT    NOT NULL,
    title           TEXT    DEFAULT '',
    price           TEXT    DEFAULT '',
    original_price  TEXT    DEFAULT '',
    current_price   TEXT    DEFAULT '',
    sales           TEXT    DEFAULT '',
    sales_count     TEXT    DEFAULT '',
    same_count      TEXT    DEFAULT '',
    shop_name       TEXT    DEFAULT '',
    shop_title      TEXT    DEFAULT '',
    is_tmall        INTEGER DEFAULT 0,
    location        TEXT    DEFAULT '',
    product_link    TEXT    DEFAULT '',
    category_id     TEXT    DEFAULT '',
    keyword         TEXT    DEFAULT '',
    sort_method     TEXT    DEFAULT '',
    collected_at    TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL,
    PRIMARY KEY (shop_key, item_id)
);
CREATE INDEX IF NOT EXISTS idx_ma_products_keyword
    ON cache_market_analysis_products (shop_key, keyword);
"""


class ProductStorage:
    def __init__(self, *, shop_key: str) -> None:
        key = (shop_key or "").strip()
        if not key:
            raise ValueError("shop_key 不能为空（需绑定店铺）")
        self._cache = WorkspaceCache(
            shop_key=key,
            skill_slug=read_skill_slug(),
            platform=TAOBAO_PLATFORM,
        )
        self._cache.execute_schema(_SCHEMA)

    @property
    def shop_key(self) -> str:
        return self._cache.shop_key

    def __enter__(self) -> ProductStorage:
        return self

    def __exit__(self, *exc) -> None:
        return None

    def upsert_products(
        self,
        products: Sequence[dict],
        keyword: str = "",
        sort_method: str = "",
    ) -> int:
        now = self._cache.now_iso()
        rows = []
        for p in products:
            item_id = str(p.get("item_id") or p.get("nid") or "")
            if not item_id:
                continue
            rows.append((
                self.shop_key,
                item_id,
                str(p.get("title", "")),
                str(p.get("price", "")),
                str(p.get("original_price", "")),
                str(p.get("current_price", "")),
                str(p.get("sales", "")),
                str(p.get("sales_count", "")),
                str(p.get("same_count", "")),
                str(p.get("shop_name", "")),
                str(p.get("shop_title", "")),
                1 if p.get("is_tmall") else 0,
                str(p.get("location", "")),
                str(p.get("product_link", "")),
                str(p.get("category_id", "")),
                keyword,
                sort_method,
                now,
                now,
            ))

        if not rows:
            return 0

        sql = """
        INSERT INTO cache_market_analysis_products (
            shop_key, item_id, title, price, original_price, current_price,
            sales, sales_count, same_count, shop_name, shop_title,
            is_tmall, location, product_link, category_id,
            keyword, sort_method,
            collected_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(shop_key, item_id) DO UPDATE SET
            title = COALESCE(NULLIF(excluded.title, ''), cache_market_analysis_products.title),
            price = COALESCE(NULLIF(excluded.price, ''), cache_market_analysis_products.price),
            original_price = COALESCE(NULLIF(excluded.original_price, ''), cache_market_analysis_products.original_price),
            current_price = excluded.current_price,
            sales = excluded.sales,
            sales_count = excluded.sales_count,
            same_count = excluded.same_count,
            shop_name = COALESCE(NULLIF(excluded.shop_name, ''), cache_market_analysis_products.shop_name),
            shop_title = COALESCE(NULLIF(excluded.shop_title, ''), cache_market_analysis_products.shop_title),
            is_tmall = excluded.is_tmall,
            location = COALESCE(NULLIF(excluded.location, ''), cache_market_analysis_products.location),
            product_link = COALESCE(NULLIF(excluded.product_link, ''), cache_market_analysis_products.product_link),
            keyword = excluded.keyword,
            sort_method = excluded.sort_method,
            updated_at = excluded.updated_at
        """
        self._cache.executemany(sql, rows)
        logger.info("商品数据已入库: %d 条 (shop=%s, 关键词: %s)", len(rows), self.shop_key, keyword)
        return len(rows)
