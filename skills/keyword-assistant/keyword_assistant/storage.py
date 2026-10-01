"""关键词助手 — Connect skill-cache（按 shop_key）。"""

from __future__ import annotations

import json
import logging
from typing import Any, Sequence

from .config import SYCM_PLATFORM
from ._runtime import WorkspaceCache, read_skill_slug

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS cache_keyword_assistant_keywords (
    shop_key                TEXT    NOT NULL,
    keyword                 TEXT    NOT NULL,
    date_type               TEXT    NOT NULL DEFAULT '',
    date_range              TEXT    NOT NULL DEFAULT '',
    search_popularity       TEXT    DEFAULT '',
    click_rate              TEXT    DEFAULT '',
    transaction_index       TEXT    DEFAULT '',
    pay_buyer_cnt           TEXT    DEFAULT '',
    pay_conv_rate           TEXT    DEFAULT '',
    demand_supply_ratio     TEXT    DEFAULT '',
    tmall_click_ratio       TEXT    DEFAULT '',
    free_click_rate         TEXT    DEFAULT '',
    search_popularity_change TEXT   DEFAULT '',
    click_rate_change       TEXT    DEFAULT '',
    seed_keyword            TEXT    DEFAULT '',
    collected_at            TEXT    NOT NULL,
    updated_at              TEXT    NOT NULL,
    PRIMARY KEY (shop_key, keyword, date_type, date_range)
);

CREATE TABLE IF NOT EXISTS cache_keyword_assistant_runs (
    shop_key        TEXT    NOT NULL,
    mode            TEXT    NOT NULL,
    run_id          TEXT    NOT NULL,
    payload_json    TEXT    NOT NULL,
    csv_path        TEXT    DEFAULT '',
    updated_at      TEXT    NOT NULL,
    PRIMARY KEY (shop_key, mode, run_id)
);
"""


class KeywordStorage:
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

    def __enter__(self) -> KeywordStorage:
        return self

    def __exit__(self, *exc) -> None:
        return None

    def upsert_keywords(
        self,
        results: Sequence[dict],
        seed_keyword: str = "",
        date_range: str = "",
        date_type: str = "",
    ) -> int:
        now = self._cache.now_iso()
        rows = []
        for r in results:
            kw = r.get("related_keyword") or r.get("keyword", "")
            if not kw:
                continue
            rows.append((
                self.shop_key,
                kw,
                date_type,
                date_range,
                str(r.get("search_popularity", "")),
                str(r.get("click_rate", "")),
                str(r.get("transaction_index", "")),
                str(r.get("pay_buyer_cnt", "")),
                str(r.get("pay_conv_rate", "")),
                str(r.get("demand_supply_ratio", "")),
                str(r.get("tmall_click_ratio", "")),
                str(r.get("free_click_rate", "")),
                str(r.get("search_popularity_change", "")),
                str(r.get("click_rate_change", "")),
                seed_keyword,
                now,
                now,
            ))

        if not rows:
            return 0

        sql = """
        INSERT INTO cache_keyword_assistant_keywords (
            shop_key, keyword, date_type, date_range,
            search_popularity, click_rate, transaction_index,
            pay_buyer_cnt, pay_conv_rate, demand_supply_ratio,
            tmall_click_ratio, free_click_rate,
            search_popularity_change, click_rate_change,
            seed_keyword, collected_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(shop_key, keyword, date_type, date_range) DO UPDATE SET
            search_popularity = excluded.search_popularity,
            click_rate = excluded.click_rate,
            transaction_index = excluded.transaction_index,
            pay_buyer_cnt = excluded.pay_buyer_cnt,
            pay_conv_rate = excluded.pay_conv_rate,
            demand_supply_ratio = excluded.demand_supply_ratio,
            tmall_click_ratio = excluded.tmall_click_ratio,
            free_click_rate = excluded.free_click_rate,
            search_popularity_change = excluded.search_popularity_change,
            click_rate_change = excluded.click_rate_change,
            seed_keyword = excluded.seed_keyword,
            updated_at = excluded.updated_at
        """
        self._cache.executemany(sql, rows)
        logger.info(
            "关键词数据已入库: %d 条 (shop=%s, 种子词: %s)",
            len(rows),
            self.shop_key,
            seed_keyword,
        )
        return len(rows)

    def upsert_run(
        self,
        *,
        mode: str,
        run_id: str,
        payload: dict[str, Any] | list[dict[str, Any]],
        csv_path: str = "",
    ) -> None:
        now = self._cache.now_iso()
        self._cache.execute(
            """
            INSERT INTO cache_keyword_assistant_runs (
                shop_key, mode, run_id, payload_json, csv_path, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(shop_key, mode, run_id) DO UPDATE SET
                payload_json = excluded.payload_json,
                csv_path = excluded.csv_path,
                updated_at = excluded.updated_at
            """,
            (
                self.shop_key,
                mode,
                run_id,
                json.dumps(payload, ensure_ascii=False),
                csv_path,
                now,
            ),
        )

    def load_run_payload(
        self,
        *,
        mode: str,
        run_id: str | None = None,
    ) -> dict[str, Any] | list[dict[str, Any]] | None:
        if run_id:
            row = self._cache.query_one(
                """
                SELECT payload_json FROM cache_keyword_assistant_runs
                WHERE shop_key = ? AND mode = ? AND run_id = ?
                """,
                (self.shop_key, mode, run_id),
            )
        else:
            row = self._cache.query_one(
                """
                SELECT payload_json FROM cache_keyword_assistant_runs
                WHERE shop_key = ? AND mode = ?
                ORDER BY updated_at DESC LIMIT 1
                """,
                (self.shop_key, mode),
            )
        if not row:
            return None
        return json.loads(row["payload_json"])
