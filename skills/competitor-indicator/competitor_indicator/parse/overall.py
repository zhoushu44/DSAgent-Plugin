"""整体分析：shop/indicator + base/indicator。"""

from __future__ import annotations

from typing import Any

from ..config import OVERALL_INDICATOR_KEYS, OVERALL_INDICATOR_SOURCES
from .common import extract_competitor_metrics, normalize_id, period_meta


def build_overall_result(
    *,
    competitor_ids: list[int],
    entity_id: int,
    begin_date: str,
    end_date: str,
    peer_begin_date: str,
    peer_end_date: str,
    shop_data: dict[str, Any],
    base_data: dict[str, Any],
) -> dict[str, Any]:
    target_ids = {normalize_id(cid) for cid in competitor_ids}
    own_id = normalize_id(entity_id)
    sources = {"shop": shop_data, "base": base_data}
    competitors: dict[str, dict[str, Any]] = {
        normalize_id(cid): {} for cid in competitor_ids
    }

    for key in OVERALL_INDICATOR_KEYS:
        for endpoint, api_keys in OVERALL_INDICATOR_SOURCES.get(key, ()):
            if endpoint not in sources:
                continue
            data = sources[endpoint] or {}
            for api_key in api_keys:
                value = data.get(api_key)
                if not isinstance(value, dict):
                    continue
                if extract_competitor_metrics(
                    value=value,
                    target_ids=target_ids,
                    own_id=own_id,
                    competitors=competitors,
                    display_key=key,
                ):
                    break
            else:
                continue
            break

    return {
        **period_meta(
            competitor_ids=competitor_ids,
            entity_id=entity_id,
            begin_date=begin_date,
            end_date=end_date,
            peer_begin_date=peer_begin_date,
            peer_end_date=peer_end_date,
        ),
        "stage": "overall",
        "competitors": competitors,
    }


def has_overall_metrics(result: dict[str, Any]) -> bool:
    competitors = result.get("competitors") or {}
    return any(competitors.get(cid) for cid in result.get("competitor_ids") or [])
