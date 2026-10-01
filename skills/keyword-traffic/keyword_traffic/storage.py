"""关键词流量趋势 — Connect skill-cache（按 shop_key）。"""

from __future__ import annotations

import logging
from typing import Sequence

from .config import SYCM_PLATFORM
from ._runtime import WorkspaceCache, read_skill_slug

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS cache_keyword_traffic_trend (
    shop_key            TEXT    NOT NULL,
    keyword             TEXT    NOT NULL,
    cate_id             TEXT    NOT NULL DEFAULT '',
    date                TEXT    NOT NULL,
    impression_index    TEXT    DEFAULT '',
    click_index         TEXT    DEFAULT '',
    ctr                 TEXT    DEFAULT '',
    cvr                 TEXT    DEFAULT '',
    competition_index   TEXT    DEFAULT '',
    avg_price           TEXT    DEFAULT '',
    date_range          TEXT    DEFAULT '',
    collected_at        TEXT    NOT NULL,
    updated_at          TEXT    NOT NULL,
    PRIMARY KEY (shop_key, keyword, cate_id, date)
);

CREATE TABLE IF NOT EXISTS cache_keyword_traffic_summary (
    shop_key            TEXT    NOT NULL,
    keyword             TEXT    NOT NULL,
    cate_id             TEXT    NOT NULL DEFAULT '',
    keyword_trait       TEXT    DEFAULT '',
    traffic_trend       TEXT    DEFAULT '',
    traffic_trend_tag   TEXT    DEFAULT '',
    competition         TEXT    DEFAULT '',
    competition_tag     TEXT    DEFAULT '',
    audience            TEXT    DEFAULT '',
    geography           TEXT    DEFAULT '',
    time_pattern        TEXT    DEFAULT '',
    collected_at        TEXT    NOT NULL,
    updated_at          TEXT    NOT NULL,
    PRIMARY KEY (shop_key, keyword, cate_id)
);
"""


class TrafficStorage:
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

    def __enter__(self) -> TrafficStorage:
        return self

    def __exit__(self, *exc) -> None:
        return None

    def upsert_trend(
        self,
        trend_data: Sequence[dict],
        keyword: str = "",
        cate_id: str = "",
        date_range: str = "",
    ) -> int:
        now = self._cache.now_iso()
        rows = []
        for r in trend_data:
            date_val = r.get("date", "")
            if not date_val:
                continue
            rows.append((
                self.shop_key,
                keyword,
                str(cate_id),
                date_val,
                str(r.get("impression_index", "")),
                str(r.get("click_index", "")),
                str(r.get("ctr", "")),
                str(r.get("cvr", "")),
                str(r.get("competition_index", "")),
                str(r.get("avg_price", "")),
                date_range,
                now,
                now,
            ))

        if not rows:
            return 0

        sql = """
        INSERT INTO cache_keyword_traffic_trend (
            shop_key, keyword, cate_id, date,
            impression_index, click_index, ctr, cvr,
            competition_index, avg_price,
            date_range, collected_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(shop_key, keyword, cate_id, date) DO UPDATE SET
            impression_index = excluded.impression_index,
            click_index = excluded.click_index,
            ctr = excluded.ctr,
            cvr = excluded.cvr,
            competition_index = excluded.competition_index,
            avg_price = excluded.avg_price,
            date_range = excluded.date_range,
            updated_at = excluded.updated_at
        """
        self._cache.executemany(sql, rows)
        logger.info(
            "趋势数据已入库: %d 条 (shop=%s, 关键词: %s)",
            len(rows),
            self.shop_key,
            keyword,
        )
        return len(rows)

    def query_keywords(self, keyword_like: str = "", limit: int = 100) -> list[dict]:
        if keyword_like:
            return self._cache.query(
                """
                SELECT keyword, cate_id, COUNT(*) as data_points,
                       MIN(date) as first_date, MAX(date) as last_date,
                       MAX(updated_at) as updated_at
                FROM cache_keyword_traffic_trend
                WHERE shop_key = ? AND keyword LIKE ?
                GROUP BY keyword, cate_id
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (self.shop_key, f"%{keyword_like}%", limit),
            )
        return self._cache.query(
            """
            SELECT keyword, cate_id, COUNT(*) as data_points,
                   MIN(date) as first_date, MAX(date) as last_date,
                   MAX(updated_at) as updated_at
            FROM cache_keyword_traffic_trend
            WHERE shop_key = ?
            GROUP BY keyword, cate_id
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (self.shop_key, limit),
        )

    def upsert_summary(self, summary: dict, keyword: str = "", cate_id: str = "") -> int:
        now = self._cache.now_iso()
        row = (
            self.shop_key,
            keyword,
            str(cate_id),
            str(summary.get("keyword_trait", "")),
            str(summary.get("traffic_trend", "")),
            str(summary.get("traffic_trend_tag", "")),
            str(summary.get("competition", "")),
            str(summary.get("competition_tag", "")),
            str(summary.get("audience", "")),
            str(summary.get("geography", "")),
            str(summary.get("time_pattern", "")),
            now,
            now,
        )
        sql = """
        INSERT INTO cache_keyword_traffic_summary (
            shop_key, keyword, cate_id,
            keyword_trait, traffic_trend, traffic_trend_tag,
            competition, competition_tag,
            audience, geography, time_pattern,
            collected_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(shop_key, keyword, cate_id) DO UPDATE SET
            keyword_trait = excluded.keyword_trait,
            traffic_trend = excluded.traffic_trend,
            traffic_trend_tag = excluded.traffic_trend_tag,
            competition = excluded.competition,
            competition_tag = excluded.competition_tag,
            audience = excluded.audience,
            geography = excluded.geography,
            time_pattern = excluded.time_pattern,
            updated_at = excluded.updated_at
        """
        self._cache.execute(sql, row)
        logger.info("市场总结已入库 (shop=%s, 关键词: %s)", self.shop_key, keyword)
        return 1
