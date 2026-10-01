"""市场排行趋势 — Connect skill-cache（按 shop_key）。"""

from __future__ import annotations

import json
import logging
from typing import Any, Sequence

from .config import SYCM_PLATFORM
from ._runtime import WorkspaceCache, read_skill_slug

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS cache_market_trend_rank (
    shop_key        TEXT    NOT NULL,
    item_id         TEXT    NOT NULL,
    period_date     TEXT    NOT NULL,
    rank_type       TEXT    NOT NULL DEFAULT 'gmv',
    cate_id         TEXT    DEFAULT '',
    title           TEXT    DEFAULT '',
    pict_url        TEXT    DEFAULT '',
    shop_title      TEXT    DEFAULT '',
    is_tmall        INTEGER DEFAULT 0,
    rank            INTEGER,
    pay_byr_cnt     TEXT    DEFAULT '',
    uv              TEXT    DEFAULT '',
    search_uv       TEXT    DEFAULT '',
    cart_byr_cnt    TEXT    DEFAULT '',
    clt_byr_cnt     TEXT    DEFAULT '',
    core_keyword    TEXT    DEFAULT '',
    trend_mode      TEXT    DEFAULT 'week',
    collected_at    TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL,
    PRIMARY KEY (shop_key, item_id, period_date, rank_type)
);
CREATE INDEX IF NOT EXISTS idx_mt_rank_shop_cate
    ON cache_market_trend_rank (shop_key, cate_id, rank_type);

CREATE TABLE IF NOT EXISTS cache_market_trend_runs (
    shop_key        TEXT    NOT NULL,
    cate_id         TEXT    NOT NULL,
    rank_type       TEXT    NOT NULL,
    trend_mode      TEXT    NOT NULL,
    payload_json    TEXT    NOT NULL,
    csv_path        TEXT    DEFAULT '',
    updated_at      TEXT    NOT NULL,
    PRIMARY KEY (shop_key, cate_id, rank_type, trend_mode)
);
"""


class MarketTrendStorage:
    def __init__(self, *, shop_key: str) -> None:
        key = (shop_key or "").strip()
        if not key:
            raise ValueError("shop_key 不能为空（需绑定店铺）")
        self._cache = WorkspaceCache(
            shop_key=key,
            skill_slug=read_skill_slug(),
            platform=SYCM_PLATFORM,
        )
        self._cache.execute_schema(_SCHEMA)

    @property
    def shop_key(self) -> str:
        return self._cache.shop_key

    def __enter__(self) -> MarketTrendStorage:
        return self

    def __exit__(self, *exc) -> None:
        return None

    def upsert_period_items(
        self,
        items: Sequence,
        period_date: str,
        rank_type: str = "gmv",
        cate_id: str = "",
        trend_mode: str = "week",
    ) -> int:
        now = self._cache.now_iso()
        rows = []
        for item in items:
            item_id = getattr(item, "item_id", "") or ""
            if not item_id:
                continue
            rows.append((
                self.shop_key,
                item_id,
                period_date,
                rank_type,
                str(cate_id),
                getattr(item, "title", "") or "",
                getattr(item, "pict_url", "") or "",
                getattr(item, "shop_title", "") or "",
                1 if getattr(item, "is_tmall", False) else 0,
                getattr(item, "rank", None),
                str(getattr(item, "pay_byr_cnt", "") or ""),
                str(getattr(item, "uv", "") or ""),
                str(getattr(item, "search_uv", "") or ""),
                str(getattr(item, "cart_byr_cnt", "") or ""),
                str(getattr(item, "clt_byr_cnt", "") or ""),
                getattr(item, "core_keyword", "") or "",
                trend_mode,
                now,
                now,
            ))

        if not rows:
            return 0

        sql = """
        INSERT INTO cache_market_trend_rank (
            shop_key, item_id, period_date, rank_type, cate_id,
            title, pict_url, shop_title, is_tmall, rank,
            pay_byr_cnt, uv, search_uv, cart_byr_cnt, clt_byr_cnt,
            core_keyword, trend_mode, collected_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(shop_key, item_id, period_date, rank_type) DO UPDATE SET
            cate_id = excluded.cate_id,
            title = COALESCE(NULLIF(excluded.title, ''), cache_market_trend_rank.title),
            pict_url = COALESCE(NULLIF(excluded.pict_url, ''), cache_market_trend_rank.pict_url),
            shop_title = COALESCE(NULLIF(excluded.shop_title, ''), cache_market_trend_rank.shop_title),
            is_tmall = excluded.is_tmall,
            rank = excluded.rank,
            pay_byr_cnt = excluded.pay_byr_cnt,
            uv = excluded.uv,
            search_uv = excluded.search_uv,
            cart_byr_cnt = excluded.cart_byr_cnt,
            clt_byr_cnt = excluded.clt_byr_cnt,
            core_keyword = COALESCE(NULLIF(excluded.core_keyword, ''), cache_market_trend_rank.core_keyword),
            trend_mode = excluded.trend_mode,
            updated_at = excluded.updated_at
        """
        self._cache.executemany(sql, rows)
        logger.info(
            "排行数据已入库: %d 条 (shop=%s, 周期: %s, 类型: %s)",
            len(rows),
            self.shop_key,
            period_date,
            rank_type,
        )
        return len(rows)

    def upsert_periods(
        self,
        periods: Sequence,
        rank_type: str = "gmv",
        cate_id: str = "",
        trend_mode: str = "week",
    ) -> int:
        total = 0
        for period in periods:
            items = getattr(period, "items", [])
            date_range = getattr(period, "date_range", "")
            if items and date_range:
                total += self.upsert_period_items(
                    items,
                    period_date=date_range,
                    rank_type=rank_type,
                    cate_id=cate_id,
                    trend_mode=trend_mode,
                )
        return total

    def upsert_run(
        self,
        *,
        cate_id: str,
        rank_type: str,
        trend_mode: str,
        payload: dict[str, Any],
        csv_path: str = "",
    ) -> None:
        now = self._cache.now_iso()
        self._cache.execute(
            """
            INSERT INTO cache_market_trend_runs (
                shop_key, cate_id, rank_type, trend_mode,
                payload_json, csv_path, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(shop_key, cate_id, rank_type, trend_mode) DO UPDATE SET
                payload_json = excluded.payload_json,
                csv_path = excluded.csv_path,
                updated_at = excluded.updated_at
            """,
            (
                self.shop_key,
                str(cate_id),
                rank_type,
                trend_mode,
                json.dumps(payload, ensure_ascii=False),
                csv_path,
                now,
            ),
        )

    def load_run_payload(
        self,
        *,
        cate_id: str = "",
        rank_type: str = "",
        trend_mode: str = "",
    ) -> dict[str, Any] | None:
        if cate_id and rank_type and trend_mode:
            row = self._cache.query_one(
                """
                SELECT payload_json FROM cache_market_trend_runs
                WHERE shop_key = ? AND cate_id = ? AND rank_type = ? AND trend_mode = ?
                """,
                (self.shop_key, str(cate_id), rank_type, trend_mode),
            )
        else:
            conditions = ["shop_key = ?"]
            params: list[Any] = [self.shop_key]
            if cate_id:
                conditions.append("cate_id = ?")
                params.append(str(cate_id))
            if rank_type:
                conditions.append("rank_type = ?")
                params.append(rank_type)
            if trend_mode:
                conditions.append("trend_mode = ?")
                params.append(trend_mode)
            where = " AND ".join(conditions)
            row = self._cache.query_one(
                f"""
                SELECT payload_json FROM cache_market_trend_runs
                WHERE {where}
                ORDER BY updated_at DESC LIMIT 1
                """,
                tuple(params),
            )
        if not row:
            return None
        return json.loads(row["payload_json"])
