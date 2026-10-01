from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class OverviewMetric:
    key: str = ""
    label: str = ""
    value: float | int | str | None = None
    cycle_crc: float | None = None
    explanation: str = ""
    format: str = ","

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ProfileRow:
    attr_name: str = ""
    attr_label: str = ""
    attr_value: str = ""
    shop_customer_cnt: float = 0.0
    ratio: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ProfileDimension:
    crowd_type: str = ""
    crowd_label: str = ""
    profile_kind: str = "summary"
    profile_kind_label: str = "汇总画像"
    attribute_name: str = ""
    attribute_label: str = ""
    rows: list[ProfileRow] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "crowd_type": self.crowd_type,
            "crowd_label": self.crowd_label,
            "profile_kind": self.profile_kind,
            "profile_kind_label": self.profile_kind_label,
            "attribute_name": self.attribute_name,
            "attribute_label": self.attribute_label,
            "rows": [row.to_dict() for row in self.rows],
        }


@dataclass
class PageInfoConfig:
    crowd_types: list[tuple[str, str]] = field(default_factory=list)
    summary_attributes: list[str] = field(default_factory=list)
    detail_attributes: list[str] = field(default_factory=list)

    def summary_attributes_for(self, _crowd_type: str = "") -> list[str]:
        return list(self.summary_attributes)

    def detail_attributes_for_shop(self) -> list[str]:
        return list(self.detail_attributes)

    def to_dict(self) -> dict[str, Any]:
        return {
            "crowd_types": [
                {"crowd_type": value, "crowd_label": label}
                for value, label in self.crowd_types
            ],
            "summary_attributes": self.summary_attributes,
            "detail_attributes": self.detail_attributes,
        }


@dataclass
class SkillOutput:
    status: str = "success"
    seller_id: int = 0
    stat_date: str = ""
    date_range: str = ""
    profile_date_range: str = ""
    profile_date_type: str = "recent30"
    binding_source: str = ""
    overview: dict[str, dict[str, Any]] = field(default_factory=dict)
    crowd_types: list[dict[str, str]] = field(default_factory=list)
    profiles: list[dict[str, Any]] = field(default_factory=list)
    csv_path: str = ""
    json_path: str = ""
    report_path: str = ""
    ai_analysis_path: str = ""
    ai_analysis_markdown: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SkillOutput:
        known = {f.name for f in cls.__dataclass_fields__.values()}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in data.items() if k in known})


class SkillError(Exception):
    def __init__(self, exit_code: int, message: str, failure_kind: str = "") -> None:
        super().__init__(message)
        self.exit_code = exit_code
        # 可选：脚本自报失败类型，供插件侧按 failure_kind 精确引导用户
        # （如 no_permission 引导换账号，而非让用户重新登录）。
        self.failure_kind = failure_kind
