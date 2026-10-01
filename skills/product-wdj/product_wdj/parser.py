from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .types import AnswerRecord, QuestionRecord


def extract_item_id(text: str) -> str:
    stripped = text.strip()
    if not stripped:
        return ""

    for pattern in (
        r"(?:itemId|id|item_id)[=:]?\s*(\d{8,})",
        r"item\.(?:taobao|tmall)\.com/item\.htm\?.*?id=(\d+)",
        r"detail\.tmall\.com/item\.htm\?.*?id=(\d+)",
        r"a\.m\.taobao\.com/i(\d+)\.htm",
        r"(\d{10,})",
    ):
        match = re.search(pattern, stripped, re.IGNORECASE)
        if match:
            return match.group(1)

    if stripped.isdigit():
        return stripped
    return ""


def parse_jsonp_text(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("{"):
        return json.loads(stripped)
    match = re.match(r"^[^(]+\((.*)\)\s*$", stripped, re.DOTALL)
    if not match:
        raise ValueError("无法解析 JSONP 响应")
    return json.loads(match.group(1))


def load_jsonp_file(path: Path) -> dict[str, Any]:
    return parse_jsonp_text(path.read_text(encoding="utf-8"))


def _join_tags(tags: list[Any] | None) -> str:
    if not tags:
        return ""
    parts: list[str] = []
    for tag in tags:
        if isinstance(tag, dict):
            text = str(tag.get("text") or "").strip()
            if text:
                parts.append(text)
        elif tag:
            parts.append(str(tag))
    return "、".join(parts)


def _safe_int(value: Any) -> int:
    try:
        return int(str(value or "0").strip() or "0")
    except ValueError:
        return 0


def _parse_top_answer(raw: dict[str, Any], question_id: str) -> AnswerRecord:
    user_info = raw.get("answerUserInfo") or {}
    rate_tag = raw.get("rateTag") or {}
    return AnswerRecord(
        answer_id=str(raw.get("answerId") or ""),
        question_id=question_id,
        content=str(raw.get("answerTitle") or "").strip(),
        user=str(user_info.get("userNick") or "").strip(),
        user_tags=_join_tags(user_info.get("userTags")),
        sku=str(raw.get("sku") or "").strip(),
        answer_time=str(raw.get("gmtCreate") or "").strip(),
        answer_time_str=str(raw.get("gmtCreateStr") or "").strip(),
        like_count="",
        rate_tag=str(rate_tag.get("text") or "").strip(),
        credit_level="",
        header_title=str(raw.get("headerTitle") or "").strip(),
    )


def _parse_detail_answer(raw: dict[str, Any], question_id: str) -> AnswerRecord:
    interact = raw.get("interact") or {}
    rate_tag = raw.get("rateTag") or {}
    return AnswerRecord(
        answer_id=str(raw.get("id") or ""),
        question_id=question_id,
        content=str(raw.get("title") or "").strip(),
        user=str(raw.get("userNick") or "").strip(),
        user_tags="",
        sku=str(raw.get("sku") or "").strip(),
        answer_time=str(raw.get("gmtCreate") or "").strip(),
        answer_time_str=str(raw.get("gmtCreateStr") or "").strip(),
        like_count=str(interact.get("likeCount") or "").strip(),
        rate_tag=str(rate_tag.get("text") or "").strip(),
        credit_level=str(raw.get("creditLevel") or "").strip(),
        header_title=str(raw.get("headerTitle") or "").strip(),
    )


def parse_question_list_payload(
    payload: dict[str, Any],
    *,
    item_id: str,
    start_index: int = 1,
) -> tuple[list[QuestionRecord], bool, int, dict[str, Any]]:
    data = payload.get("data") or {}
    raw_questions = data.get("questionList") or []
    has_next = str(data.get("hasNext") or "").lower() == "true"
    total_count = _safe_int(data.get("questionTotal"))

    item_info = data.get("item") or {}
    tags = data.get("tags") or []
    summary: dict[str, Any] = {
        "item_title": str(item_info.get("itemTitle") or "").strip(),
        "item_pic": str(item_info.get("itemPic") or "").strip(),
        "item_url": str(item_info.get("itemUrl") or "").strip(),
        "tags": [
            {
                "keyword": str(tag.get("keyword") or ""),
                "count": _safe_int(tag.get("count")),
                "property_id": str(tag.get("propertyId") or ""),
            }
            for tag in tags
            if isinstance(tag, dict)
        ],
        "folding_count": _safe_int(data.get("foldingCount")),
    }

    questions: list[QuestionRecord] = []
    for offset, raw in enumerate(raw_questions):
        if not isinstance(raw, dict):
            continue
        question_id = str(raw.get("questionId") or "")
        user_info = raw.get("userInfo") or {}
        features = raw.get("features") or {}
        top_answers = raw.get("topAnswerList") or []
        answers = [
            _parse_top_answer(answer, question_id)
            for answer in top_answers
            if isinstance(answer, dict)
        ]
        questions.append(
            QuestionRecord(
                index=start_index + offset,
                question_id=question_id,
                question_title=str(raw.get("questionTitle") or "").strip(),
                user=str(user_info.get("userNick") or "").strip(),
                user_tags=_join_tags(user_info.get("userTags")),
                ask_time=str(raw.get("gmtCreate") or "").strip(),
                answer_count=str(raw.get("answerCount") or "").strip(),
                ip_location=str(features.get("ip_location") or "").strip(),
                item_id=str(raw.get("itemId") or item_id),
                answers=answers,
            )
        )

    return questions, has_next, total_count, summary


def parse_answer_detail_payload(
    payload: dict[str, Any],
    *,
    question_id: str,
) -> tuple[list[AnswerRecord], bool, int]:
    data = payload.get("data") or {}
    answer_list = data.get("list") or {}
    raw_answers = answer_list.get("list") or []
    is_end = str(answer_list.get("isEnd") or "").lower() in {"y", "true", "1"}
    total_count = _safe_int(answer_list.get("totalCount"))

    answers = [
        _parse_detail_answer(raw, question_id)
        for raw in raw_answers
        if isinstance(raw, dict)
    ]
    return answers, is_end, total_count


def api_user_id_from_binding(binding: dict[str, Any]) -> int | str:
    """binding.shop_key（如 taobao/3360359039）→ 问大家 API userId。"""
    shop_key = str(binding.get("shop_key") or "").strip()
    if not shop_key:
        raise ValueError("平台连接 binding 缺少 shop_key，请在 DeepSeek Agent「平台连接」绑定淘宝买家账号。")

    # 兼容两种 shop_key：`taobao/3360359039` 与 `taobao_2218891961201`。
    if "/" in shop_key:
        user_id = shop_key.rsplit("/", 1)[-1].strip()
    else:
        user_id = shop_key.rsplit("_", 1)[-1].strip()
    if not user_id.isdigit():
        raise ValueError(f"shop_key 格式无效: {shop_key!r}，期望形如 taobao/<userId>。")
    return user_id
