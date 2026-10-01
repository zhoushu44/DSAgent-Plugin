"""竞品指标 — workspace 统一缓存库。"""

from __future__ import annotations

import json
import logging

from ..config import SYCM_PLATFORM
from .._runtime import WorkspaceCache, read_skill_slug

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS cache_competitor_indicator_analysis (
    shop_key            TEXT    NOT NULL,
    competitor_id       TEXT    NOT NULL,
    entity_id           TEXT    NOT NULL DEFAULT '',
    begin_date          TEXT    NOT NULL,
    end_date            TEXT    NOT NULL,
    peer_begin_date     TEXT    NOT NULL,
    peer_end_date       TEXT    NOT NULL,
    competition_type    TEXT    DEFAULT '2',
    metrics_json        TEXT    DEFAULT '',
    report_path         TEXT    DEFAULT '',
    collected_at        TEXT    NOT NULL,
    updated_at          TEXT    NOT NULL,
    PRIMARY KEY (
        shop_key, competitor_id, entity_id,
        begin_date, end_date,
        peer_begin_date, peer_end_date
    )
);
"""


class CompetitorStorage:
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

    def close(self) -> None:
        self._cache.close()

    def __enter__(self) -> CompetitorStorage:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def upsert_analysis(
        self,
        *,
        competitor_id: str,
        entity_id: str,
        begin_date: str,
        end_date: str,
        peer_begin_date: str,
        peer_end_date: str,
        competition_type: str,
        metrics: dict,
        report_path: str = "",
    ) -> int:
        now = self._cache.now_iso()
        row = (
            self.shop_key,
            str(competitor_id),
            str(entity_id),
            begin_date,
            end_date,
            peer_begin_date,
            peer_end_date,
            competition_type,
            json.dumps(metrics, ensure_ascii=False),
            report_path,
            now,
            now,
        )
        sql = """
        INSERT INTO cache_competitor_indicator_analysis (
            shop_key, competitor_id, entity_id,
            begin_date, end_date,
            peer_begin_date, peer_end_date,
            competition_type, metrics_json,
            report_path,
            collected_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(
            shop_key, competitor_id, entity_id,
            begin_date, end_date,
            peer_begin_date, peer_end_date
        ) DO UPDATE SET
            competition_type = excluded.competition_type,
            metrics_json = excluded.metrics_json,
            report_path = excluded.report_path,
            updated_at = excluded.updated_at
        """
        self._cache.execute(sql, row)
        logger.info(
            "竞品分析已入库: shop=%s competitor=%s entity=%s",
            self.shop_key,
            competitor_id,
            entity_id,
        )
        return 1

    def query_history(self, competitor_like: str = "", limit: int = 50) -> list[dict]:
        if competitor_like:
            return self._cache.query(
                """
                SELECT competitor_id, entity_id,
                       begin_date, end_date,
                       peer_begin_date, peer_end_date,
                       competition_type,
                       report_path,
                       collected_at, updated_at
                FROM cache_competitor_indicator_analysis
                WHERE shop_key = ? AND competitor_id LIKE ?
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (self.shop_key, f"%{competitor_like}%", limit),
            )
        return self._cache.query(
            """
            SELECT competitor_id, entity_id,
                   begin_date, end_date,
                   peer_begin_date, peer_end_date,
                   competition_type,
                   report_path,
                   collected_at, updated_at
            FROM cache_competitor_indicator_analysis
            WHERE shop_key = ?
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (self.shop_key, limit),
        )
