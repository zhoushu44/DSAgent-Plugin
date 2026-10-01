"""人群画像解析。"""

from __future__ import annotations

from typing import Any

from ..config import (
    AUDIENCE_BEHAVIOR_LABELS,
    AUDIENCE_TAG_KEYS,
    AUDIENCE_TIME_RANGE_LABELS,
    DEFAULT_AUDIENCE_ACTION_VALUES,
    DEFAULT_AUDIENCE_TIME_RANGE,
)
from .common import normalize_id, period_meta


def _normalize_rate(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_chart_items(chart_data: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for row in chart_data:
        rate = _normalize_rate(row.get("rate"))
        if rate is None:
            continue
        items.append({
            "option_id": str(row["optionId"]),
            "option_name": str(row["optionName"]),
            "rate": round(rate, 6),
            "rate_pct": f"{rate * 100:.2f}%",
        })
    items.sort(key=lambda item: item["rate"], reverse=True)
    return items


def _build_profile(
    *,
    action: str,
    raw_by_tag: dict[str, Any],
    days: str,
) -> dict[str, Any]:
    label = AUDIENCE_BEHAVIOR_LABELS[action]
    tags: list[dict[str, Any]] = []
    for tag_name, tag_id in AUDIENCE_TAG_KEYS:
        tags.append({
            "tag_name": tag_name,
            "tag_id": tag_id,
            "items": parse_chart_items(raw_by_tag.get(tag_name, [])),
        })
    return {
        "action_code": action,
        "behavior": [label],
        "time_range": AUDIENCE_TIME_RANGE_LABELS[days],
        "time_range_days": days,
        "tags": tags,
    }


def build_audience_result(
    *,
    competitor_ids: list[int],
    entity_id: int,
    begin_date: str,
    end_date: str,
    peer_begin_date: str,
    peer_end_date: str,
    audience_raw: dict[str, Any],
    action_values: list[str] | None = None,
    time_range: str | None = None,
) -> dict[str, Any]:
    actions = action_values or list(DEFAULT_AUDIENCE_ACTION_VALUES)
    days = time_range or DEFAULT_AUDIENCE_TIME_RANGE

    competitor_audience: dict[str, dict[str, Any]] = {}
    for cid in competitor_ids:
        cid_str = normalize_id(cid)
        raw = audience_raw.get(cid_str, {})
        profiles = [
            _build_profile(action=action, raw_by_tag=raw.get(action, {}), days=days)
            for action in actions
        ]

        competitor_audience[cid_str] = {
            "time_range": AUDIENCE_TIME_RANGE_LABELS[days],
            "time_range_days": days,
            "profiles": profiles,
        }

    return {
        **period_meta(
            competitor_ids=competitor_ids,
            entity_id=entity_id,
            begin_date=begin_date,
            end_date=end_date,
            peer_begin_date=peer_begin_date,
            peer_end_date=peer_end_date,
        ),
        "stage": "audience",
        "competitor_audience": competitor_audience,
        "audience_config": {
            "action_values": actions,
            "action_labels": [AUDIENCE_BEHAVIOR_LABELS[v] for v in actions],
            "time_range": days,
            "time_range_label": AUDIENCE_TIME_RANGE_LABELS[days],
        },
    }


def has_audience_data(result: dict[str, Any]) -> bool:
    audience = result.get("competitor_audience")
    if not audience:
        return False
    for cid in result["competitor_ids"]:
        for profile in audience[cid]["profiles"]:
            for tag in profile["tags"]:
                if tag["items"]:
                    return True
    return False
