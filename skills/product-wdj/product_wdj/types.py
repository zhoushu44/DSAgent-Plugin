from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class AnswerRecord:
    answer_id: str = ""
    question_id: str = ""
    content: str = ""
    user: str = ""
    user_tags: str = ""
    sku: str = ""
    answer_time: str = ""
    answer_time_str: str = ""
    like_count: str = ""
    rate_tag: str = ""
    credit_level: str = ""
    header_title: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class QuestionRecord:
    index: int = 0
    question_id: str = ""
    question_title: str = ""
    user: str = ""
    user_tags: str = ""
    ask_time: str = ""
    answer_count: str = ""
    ip_location: str = ""
    item_id: str = ""
    answers: list[AnswerRecord] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["answers"] = [answer.to_dict() for answer in self.answers]
        return data


@dataclass
class SkillOutput:
    status: str = "success"
    item_id: str = ""
    binding_source: str = ""
    total_count: int = 0
    collected_count: int = 0
    collected_pages: int = 0
    fetch_all: bool = False
    max_pages_limit: int = 5
    fetch_answers: bool = True
    answers_fetched: int = 0
    answers_skipped: int = 0
    answers_truncated: bool = False
    tag_id: str = ""
    search_text: str = ""
    summary: dict[str, Any] = field(default_factory=dict)
    questions: list[dict[str, Any]] = field(default_factory=list)
    csv_path: str = ""
    json_path: str = ""
    report_path: str = ""
    insights_review: str = ""
    insights_pending: list[str] = field(default_factory=list)
    insights_artifacts: dict[str, str] = field(default_factory=dict)
    stage: str = "collect"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SkillOutput:
        known = {f.name for f in cls.__dataclass_fields__.values()}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in data.items() if k in known})


class SkillError(RuntimeError):
    def __init__(self, exit_code: int, message: str):
        super().__init__(message)
        self.exit_code = exit_code
