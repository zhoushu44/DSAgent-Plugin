from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class ReviewRecord:
    index: int = 0
    user: str = ""
    sku_name: str = ""
    sku_map: dict[str, str] = field(default_factory=dict)
    tags: str = ""
    feedback_date: str = ""
    media: str = ""
    feedback: str = ""
    append_feedback: str = ""
    append_media: str = ""
    like_count: str = ""
    rate_id: str = ""
    rate_type: str = ""
    item_id: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SkillOutput:
    status: str = "success"
    item_id: str = ""
    binding_source: str = ""
    total_count: int = 0
    collected_count: int = 0
    collected_pages: int = 0
    order_type: str = "searchImpr"
    fetch_all: bool = False
    max_pages_limit: int = 5
    summary: dict[str, Any] = field(default_factory=dict)
    reviews: list[dict[str, Any]] = field(default_factory=list)
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
