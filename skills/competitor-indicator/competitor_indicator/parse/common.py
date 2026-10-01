"""解析共用工具。"""

from __future__ import annotations

from typing import Any


def normalize_id(value: Any) -> str:
    return str(value).strip()


def competitor_has_value(item: dict[str, Any], target_ids: set[str], own_id: str) -> bool:
    cid = normalize_id(item.get("competitorId"))
    if cid not in target_ids or cid == own_id:
        return False
    return (
        item.get("base") is not None
        or item.get("basePeriod") is not None
        or item.get("growthRate") is not None
    )


def metric_from_comp_list(
    *,
    comp_list: list[Any],
    target_ids: set[str],
    own_id: str,
) -> dict[str, dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for item in comp_list:
        if not isinstance(item, dict):
            continue
        cid = normalize_id(item.get("competitorId"))
        if cid not in target_ids or cid == own_id:
            continue
        base = item.get("base")
        growth_rate = item.get("growthRate")
        if base is None and growth_rate is None:
            continue
        found[cid] = {"base": base, "growth_rate": growth_rate}
    return found


def extract_competitor_metrics(
    *,
    value: dict[str, Any],
    target_ids: set[str],
    own_id: str,
    competitors: dict[str, dict[str, Any]],
    display_key: str,
) -> bool:
    comp_list = value.get("competitorList")
    if not isinstance(comp_list, list) or not comp_list:
        return False

    found_map = metric_from_comp_list(
        comp_list=comp_list,
        target_ids=target_ids,
        own_id=own_id,
    )
    if not found_map:
        return False

    for cid, payload in found_map.items():
        competitors.setdefault(cid, {})[display_key] = payload
    return True


def period_meta(
    *,
    competitor_ids: list[int],
    entity_id: int,
    begin_date: str,
    end_date: str,
    peer_begin_date: str,
    peer_end_date: str,
) -> dict[str, Any]:
    return {
        "competitor_ids": [str(cid) for cid in competitor_ids],
        "entity_id": str(entity_id),
        "analysis_period": {
            "begin_date": begin_date,
            "end_date": end_date,
        },
        "comparison_period": {
            "begin_date": peer_begin_date,
            "end_date": peer_end_date,
        },
    }
