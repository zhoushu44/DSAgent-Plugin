"""商品评价 — Connect skill-cache（按 shop_key）。"""

from __future__ import annotations

import json
import logging
from typing import Any, Sequence

from .config import TAOBAO_PLATFORM
from ._runtime import WorkspaceCache, read_skill_slug
from .types import SkillOutput

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS cache_product_reviews_runs (
    shop_key         TEXT    NOT NULL,
    item_id          TEXT    NOT NULL,
    run_id           TEXT    NOT NULL,
    order_type       TEXT    DEFAULT 'searchImpr',
    fetch_all        INTEGER DEFAULT 0,
    max_pages_limit  INTEGER DEFAULT 5,
    total_count      INTEGER DEFAULT 0,
    collected_count  INTEGER DEFAULT 0,
    collected_pages  INTEGER DEFAULT 0,
    payload_json     TEXT    NOT NULL,
    json_path        TEXT    DEFAULT '',
    csv_path         TEXT    DEFAULT '',
    report_path      TEXT    DEFAULT '',
    collected_at     TEXT    NOT NULL,
    updated_at       TEXT    NOT NULL,
    PRIMARY KEY (shop_key, item_id, run_id)
);

CREATE TABLE IF NOT EXISTS cache_product_reviews_items (
    shop_key         TEXT    NOT NULL,
    item_id          TEXT    NOT NULL,
    rate_id          TEXT    NOT NULL,
    review_index     INTEGER DEFAULT 0,
    user_nick        TEXT    DEFAULT '',
    sku_name         TEXT    DEFAULT '',
    sku_map_json     TEXT    DEFAULT '',
    tags             TEXT    DEFAULT '',
    feedback_date    TEXT    DEFAULT '',
    feedback         TEXT    DEFAULT '',
    append_feedback  TEXT    DEFAULT '',
    rate_type        TEXT    DEFAULT '',
    like_count       TEXT    DEFAULT '',
    collected_at     TEXT    NOT NULL,
    updated_at       TEXT    NOT NULL,
    PRIMARY KEY (shop_key, item_id, rate_id)
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_runs_item
    ON cache_product_reviews_runs (shop_key, item_id, updated_at DESC);
"""


class ReviewStorage:
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

    def __enter__(self) -> ReviewStorage:
        return self

    def __exit__(self, *exc) -> None:
        return None

    def save_run(self, *, run_id: str, result: SkillOutput) -> None:
        now = self._cache.now_iso()
        payload = result.to_dict()
        self._cache.execute(
            """
            INSERT INTO cache_product_reviews_runs (
                shop_key, item_id, run_id,
                order_type, fetch_all, max_pages_limit,
                total_count, collected_count, collected_pages,
                payload_json, json_path, csv_path, report_path,
                collected_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(shop_key, item_id, run_id) DO UPDATE SET
                order_type = excluded.order_type,
                fetch_all = excluded.fetch_all,
                max_pages_limit = excluded.max_pages_limit,
                total_count = excluded.total_count,
                collected_count = excluded.collected_count,
                collected_pages = excluded.collected_pages,
                payload_json = excluded.payload_json,
                json_path = excluded.json_path,
                csv_path = excluded.csv_path,
                report_path = excluded.report_path,
                updated_at = excluded.updated_at
            """,
            (
                self.shop_key,
                str(result.item_id or ""),
                run_id,
                str(result.order_type or "searchImpr"),
                1 if result.fetch_all else 0,
                int(result.max_pages_limit or 0),
                int(result.total_count or 0),
                int(result.collected_count or 0),
                int(result.collected_pages or 0),
                json.dumps(payload, ensure_ascii=False),
                str(result.json_path or ""),
                str(result.csv_path or ""),
                str(result.report_path or ""),
                now,
                now,
            ),
        )
        logger.info(
            "评价抓取记录已入库: item=%s run=%s (shop=%s)",
            result.item_id,
            run_id,
            self.shop_key,
        )

    def upsert_reviews(self, *, item_id: str, reviews: Sequence[dict[str, Any]]) -> int:
        now = self._cache.now_iso()
        rows: list[tuple[Any, ...]] = []
        for review in reviews:
            rate_id = str(review.get("rate_id") or "").strip()
            if not rate_id:
                continue
            sku_map = review.get("sku_map") or {}
            rows.append((
                self.shop_key,
                str(item_id or review.get("item_id") or ""),
                rate_id,
                int(review.get("index") or 0),
                str(review.get("user") or ""),
                str(review.get("sku_name") or ""),
                json.dumps(sku_map, ensure_ascii=False) if sku_map else "",
                str(review.get("tags") or ""),
                str(review.get("feedback_date") or ""),
                str(review.get("feedback") or ""),
                str(review.get("append_feedback") or ""),
                str(review.get("rate_type") or ""),
                str(review.get("like_count") or ""),
                now,
                now,
            ))

        if not rows:
            return 0

        sql = """
        INSERT INTO cache_product_reviews_items (
            shop_key, item_id, rate_id, review_index,
            user_nick, sku_name, sku_map_json, tags,
            feedback_date, feedback, append_feedback,
            rate_type, like_count, collected_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(shop_key, item_id, rate_id) DO UPDATE SET
            review_index = excluded.review_index,
            user_nick = excluded.user_nick,
            sku_name = excluded.sku_name,
            sku_map_json = excluded.sku_map_json,
            tags = excluded.tags,
            feedback_date = excluded.feedback_date,
            feedback = excluded.feedback,
            append_feedback = excluded.append_feedback,
            rate_type = excluded.rate_type,
            like_count = excluded.like_count,
            updated_at = excluded.updated_at
        """
        self._cache.executemany(sql, rows)
        logger.info(
            "评价明细已入库: %d 条 (shop=%s, item=%s)",
            len(rows),
            self.shop_key,
            item_id,
        )
        return len(rows)
