"""问大家 — Connect skill-cache（按 shop_key）。"""

from __future__ import annotations

import json
import logging
from typing import Any, Sequence

from .config import TAOBAO_PLATFORM
from ._runtime import WorkspaceCache, read_skill_slug
from .types import SkillOutput

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS cache_product_wdj_runs (
    shop_key         TEXT    NOT NULL,
    item_id          TEXT    NOT NULL,
    run_id           TEXT    NOT NULL,
    fetch_all        INTEGER DEFAULT 0,
    fetch_answers    INTEGER DEFAULT 1,
    max_pages_limit  INTEGER DEFAULT 5,
    tag_id           TEXT    DEFAULT '',
    search_text      TEXT    DEFAULT '',
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

CREATE TABLE IF NOT EXISTS cache_product_wdj_questions (
    shop_key         TEXT    NOT NULL,
    item_id          TEXT    NOT NULL,
    question_id      TEXT    NOT NULL,
    question_index   INTEGER DEFAULT 0,
    question_title   TEXT    DEFAULT '',
    user_nick        TEXT    DEFAULT '',
    user_tags        TEXT    DEFAULT '',
    ask_time         TEXT    DEFAULT '',
    ip_location      TEXT    DEFAULT '',
    answer_count     TEXT    DEFAULT '',
    collected_at     TEXT    NOT NULL,
    updated_at       TEXT    NOT NULL,
    PRIMARY KEY (shop_key, item_id, question_id)
);

CREATE TABLE IF NOT EXISTS cache_product_wdj_answers (
    shop_key         TEXT    NOT NULL,
    item_id          TEXT    NOT NULL,
    question_id      TEXT    NOT NULL,
    answer_id        TEXT    NOT NULL,
    content          TEXT    DEFAULT '',
    user_nick        TEXT    DEFAULT '',
    user_tags        TEXT    DEFAULT '',
    sku              TEXT    DEFAULT '',
    answer_time      TEXT    DEFAULT '',
    answer_time_str  TEXT    DEFAULT '',
    like_count       TEXT    DEFAULT '',
    rate_tag         TEXT    DEFAULT '',
    credit_level     TEXT    DEFAULT '',
    collected_at     TEXT    NOT NULL,
    updated_at       TEXT    NOT NULL,
    PRIMARY KEY (shop_key, item_id, answer_id)
);

CREATE INDEX IF NOT EXISTS idx_product_wdj_runs_item
    ON cache_product_wdj_runs (shop_key, item_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_wdj_questions_item
    ON cache_product_wdj_questions (shop_key, item_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_wdj_answers_question
    ON cache_product_wdj_answers (shop_key, item_id, question_id);
"""


class WdjStorage:
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

    def __enter__(self) -> WdjStorage:
        return self

    def __exit__(self, *exc) -> None:
        return None

    def save_run(self, *, run_id: str, result: SkillOutput) -> None:
        now = self._cache.now_iso()
        payload = result.to_dict()
        self._cache.execute(
            """
            INSERT INTO cache_product_wdj_runs (
                shop_key, item_id, run_id,
                fetch_all, fetch_answers, max_pages_limit,
                tag_id, search_text,
                total_count, collected_count, collected_pages,
                payload_json, json_path, csv_path, report_path,
                collected_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(shop_key, item_id, run_id) DO UPDATE SET
                fetch_all = excluded.fetch_all,
                fetch_answers = excluded.fetch_answers,
                max_pages_limit = excluded.max_pages_limit,
                tag_id = excluded.tag_id,
                search_text = excluded.search_text,
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
                1 if result.fetch_all else 0,
                1 if result.fetch_answers else 0,
                int(result.max_pages_limit or 0),
                str(result.tag_id or ""),
                str(result.search_text or ""),
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
            "问大家获取记录已入库: item=%s run=%s (shop=%s)",
            result.item_id,
            run_id,
            self.shop_key,
        )

    def upsert_questions(self, *, item_id: str, questions: Sequence[dict[str, Any]]) -> int:
        now = self._cache.now_iso()
        rows: list[tuple[Any, ...]] = []
        for question in questions:
            question_id = str(question.get("question_id") or "").strip()
            if not question_id:
                continue
            rows.append((
                self.shop_key,
                str(item_id or question.get("item_id") or ""),
                question_id,
                int(question.get("index") or 0),
                str(question.get("question_title") or ""),
                str(question.get("user") or ""),
                str(question.get("user_tags") or ""),
                str(question.get("ask_time") or ""),
                str(question.get("ip_location") or ""),
                str(question.get("answer_count") or ""),
                now,
                now,
            ))

        if not rows:
            return 0

        sql = """
        INSERT INTO cache_product_wdj_questions (
            shop_key, item_id, question_id, question_index,
            question_title, user_nick, user_tags, ask_time,
            ip_location, answer_count, collected_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(shop_key, item_id, question_id) DO UPDATE SET
            question_index = excluded.question_index,
            question_title = excluded.question_title,
            user_nick = excluded.user_nick,
            user_tags = excluded.user_tags,
            ask_time = excluded.ask_time,
            ip_location = excluded.ip_location,
            answer_count = excluded.answer_count,
            updated_at = excluded.updated_at
        """
        self._cache.executemany(sql, rows)
        logger.info(
            "问大家问题已入库: %d 条 (shop=%s, item=%s)",
            len(rows),
            self.shop_key,
            item_id,
        )
        return len(rows)

    def upsert_answers(self, *, item_id: str, questions: Sequence[dict[str, Any]]) -> int:
        now = self._cache.now_iso()
        rows: list[tuple[Any, ...]] = []
        for question in questions:
            question_id = str(question.get("question_id") or "").strip()
            for answer in question.get("answers") or []:
                if not isinstance(answer, dict):
                    continue
                answer_id = str(answer.get("answer_id") or "").strip()
                if not answer_id:
                    continue
                rows.append((
                    self.shop_key,
                    str(item_id or question.get("item_id") or ""),
                    question_id,
                    answer_id,
                    str(answer.get("content") or ""),
                    str(answer.get("user") or ""),
                    str(answer.get("user_tags") or ""),
                    str(answer.get("sku") or ""),
                    str(answer.get("answer_time") or ""),
                    str(answer.get("answer_time_str") or ""),
                    str(answer.get("like_count") or ""),
                    str(answer.get("rate_tag") or ""),
                    str(answer.get("credit_level") or ""),
                    now,
                    now,
                ))

        if not rows:
            return 0

        sql = """
        INSERT INTO cache_product_wdj_answers (
            shop_key, item_id, question_id, answer_id,
            content, user_nick, user_tags, sku,
            answer_time, answer_time_str, like_count,
            rate_tag, credit_level, collected_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(shop_key, item_id, answer_id) DO UPDATE SET
            question_id = excluded.question_id,
            content = excluded.content,
            user_nick = excluded.user_nick,
            user_tags = excluded.user_tags,
            sku = excluded.sku,
            answer_time = excluded.answer_time,
            answer_time_str = excluded.answer_time_str,
            like_count = excluded.like_count,
            rate_tag = excluded.rate_tag,
            credit_level = excluded.credit_level,
            updated_at = excluded.updated_at
        """
        self._cache.executemany(sql, rows)
        logger.info(
            "问大家回答已入库: %d 条 (shop=%s, item=%s)",
            len(rows),
            self.shop_key,
            item_id,
        )
        return len(rows)
