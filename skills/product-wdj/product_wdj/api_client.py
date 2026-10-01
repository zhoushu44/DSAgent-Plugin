from __future__ import annotations

import json
import time
from typing import Any

from ._runtime import (
    MtopCaller,
    TaobaoRateLimitError,
    TaobaoRequestError,
    TaobaoRiskControlError,
    TaobaoSessionExpiredError,
)
from .config import (
    DEFAULT_ANSWER_PAGE_SIZE,
    DEFAULT_TIMEOUT,
    DEFAULT_USER_AGENT,
    DETAIL_API,
    DETAIL_API_VERSION,
    EXIT_API_ERROR,
    EXIT_API_RATE_LIMIT,
    EXIT_COOKIE_INVALID,
    LIST_API,
    LIST_API_VERSION,
    MTOP_APP_KEY,
    MTOP_BASE_URL,
    REQUEST_INTERVAL_JITTER_SECONDS,
    REQUEST_INTERVAL_SECONDS,
    REQUEST_RETRY_ATTEMPTS,
    REQUEST_RETRY_BACKOFF_SECONDS,
)
from .types import SkillError


def _to_skill_error(exc: Exception, *, fallback: str) -> SkillError:
    if isinstance(exc, TaobaoRiskControlError):
        return SkillError(EXIT_API_ERROR, exc.message)
    if isinstance(exc, TaobaoSessionExpiredError):
        return SkillError(EXIT_COOKIE_INVALID, exc.message)
    if isinstance(exc, TaobaoRateLimitError):
        return SkillError(EXIT_API_RATE_LIMIT, exc.message)
    if isinstance(exc, TaobaoRequestError):
        return SkillError(EXIT_API_ERROR, exc.message)
    return SkillError(EXIT_API_ERROR, fallback)


def _mtop_caller() -> MtopCaller:
    return MtopCaller(
        interval_seconds=REQUEST_INTERVAL_SECONDS,
        interval_jitter_seconds=REQUEST_INTERVAL_JITTER_SECONDS,
        max_attempts=REQUEST_RETRY_ATTEMPTS,
        backoff_seconds=REQUEST_RETRY_BACKOFF_SECONDS,
    )


class TaobaoWdjClient:
    def __init__(self) -> None:
        self._mtop = _mtop_caller()

    def fetch_question_page(
        self,
        *,
        item_id: str,
        user_id: int | str,
        page: int,
        page_size: int,
        tag_id: str = "",
        search_text: str = "",
        timeout: int = DEFAULT_TIMEOUT,
    ) -> dict[str, Any]:
        extra_info = json.dumps({"searchText": search_text or ""}, ensure_ascii=False, separators=(",", ":"))
        data = {
            "itemId": str(item_id),
            "userId": user_id,
            "pageSize": page_size,
            "page": page,
            "type": "mix_group",
            "tagId": tag_id or "",
            "extraInfo": extra_info,
            "ecode": 0,
            "biz": "pc",
        }
        data_str = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        headers = {
            "Referer": f"https://detail.tmall.com/item.htm?id={item_id}",
            "Origin": "https://detail.tmall.com",
            "User-Agent": DEFAULT_USER_AGENT,
        }
        try:
            return self._mtop.call(
                label="问大家列表",
                url=f"{MTOP_BASE_URL}/h5/{LIST_API}/{LIST_API_VERSION}/",
                api=LIST_API,
                version=LIST_API_VERSION,
                data=data_str,
                headers=headers,
                extra_params={
                    "timeout": "10000",
                    "jsonpIncPrefix": "pcdetail",
                    "type": "jsonp",
                    "dataType": "jsonp",
                },
                timeout=float(timeout),
                app_key=MTOP_APP_KEY,
            )
        except (
            TaobaoRiskControlError,
            TaobaoSessionExpiredError,
            TaobaoRateLimitError,
            TaobaoRequestError,
        ) as exc:
            raise _to_skill_error(exc, fallback="问大家列表请求失败。") from exc

    def fetch_answer_detail(
        self,
        *,
        question_id: str,
        user_id: int | str,
        first_answer_id: str,
        page_num: int = 1,
        page_size: int = DEFAULT_ANSWER_PAGE_SIZE,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> dict[str, Any]:
        params = json.dumps(
            {
                "pageNum": page_num,
                "pageSize": page_size,
                "firstAnswerId": first_answer_id,
                "from": "answer",
                "searchFoldingList": False,
                "pageVersion": "v2",
                "channel": 0,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        data = {
            "id": str(question_id),
            "userId": user_id,
            "params": params,
            "ecode": 0,
            "biz": "pc",
        }
        data_str = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        headers = {
            "Referer": f"https://web.m.taobao.com/app/mtb/ask-everyone/detail?id={question_id}",
            "Origin": "https://web.m.taobao.com",
            "User-Agent": DEFAULT_USER_AGENT,
        }
        try:
            return self._mtop.call(
                label="问大家回答详情",
                url=f"{MTOP_BASE_URL}/h5/{DETAIL_API}/{DETAIL_API_VERSION}/",
                api=DETAIL_API,
                version=DETAIL_API_VERSION,
                data=data_str,
                headers=headers,
                extra_params={
                    "timeout": "10000",
                    "jsonpIncPrefix": "pcdetail",
                    "type": "jsonp",
                    "dataType": "jsonp",
                },
                timeout=float(timeout),
                app_key=MTOP_APP_KEY,
            )
        except (
            TaobaoRiskControlError,
            TaobaoSessionExpiredError,
            TaobaoRateLimitError,
            TaobaoRequestError,
        ) as exc:
            raise _to_skill_error(exc, fallback="问大家回答详情请求失败。") from exc

    def fetch_all_answers(
        self,
        *,
        question_id: str,
        user_id: int | str,
        first_answer_id: str,
        page_size: int = DEFAULT_ANSWER_PAGE_SIZE,
        deadline: float | None = None,
    ) -> list[dict[str, Any]]:
        from .parser import parse_answer_detail_payload

        all_answers: list[dict[str, Any]] = []
        page_num = 1
        current_first_answer_id = first_answer_id

        while True:
            # 单个问题的回答可能有很多页；这里也要看 deadline，
            # 否则一个高热问题就能吃掉整段预算。
            if deadline is not None and time.monotonic() >= deadline:
                break
            payload = self.fetch_answer_detail(
                question_id=question_id,
                user_id=user_id,
                first_answer_id=current_first_answer_id,
                page_num=page_num,
                page_size=page_size,
            )
            answers, is_end, _ = parse_answer_detail_payload(payload, question_id=question_id)
            if not answers:
                break
            all_answers.extend(answer.to_dict() for answer in answers)
            if is_end:
                break
            current_first_answer_id = answers[-1].answer_id
            page_num += 1

        return all_answers
