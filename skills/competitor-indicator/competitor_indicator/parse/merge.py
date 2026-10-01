"""合并整体分析、流量分析与人群画像（仅 analyze）。"""

from __future__ import annotations

from typing import Any

from .audience import build_audience_result, has_audience_data
from .flow import has_flow_metrics, parse_flow_data
from .overall import build_overall_result, has_overall_metrics
from .common import normalize_id


def build_result(
    *,
    competitor_ids: list[int],
    entity_id: int,
    begin_date: str,
    end_date: str,
    peer_begin_date: str,
    peer_end_date: str,
    raw_response: dict[str, Any],
) -> dict[str, Any]:
    overall = build_overall_result(
        competitor_ids=competitor_ids,
        entity_id=entity_id,
        begin_date=begin_date,
        end_date=end_date,
        peer_begin_date=peer_begin_date,
        peer_end_date=peer_end_date,
        shop_data=raw_response["shop_data"],
        base_data=raw_response["base_data"],
    )
    target_ids = {normalize_id(cid) for cid in competitor_ids}
    own_id = normalize_id(entity_id)
    competitor_channels = parse_flow_data(
        raw_response["flow_data"],
        competitor_ids=competitor_ids,
        target_ids=target_ids,
        own_id=own_id,
    )

    audience_block = build_audience_result(
        competitor_ids=competitor_ids,
        entity_id=entity_id,
        begin_date=begin_date,
        end_date=end_date,
        peer_begin_date=peer_begin_date,
        peer_end_date=peer_end_date,
        audience_raw=raw_response["audience_raw"],
        action_values=raw_response.get("audience_action_values"),
        time_range=raw_response.get("audience_time_range"),
    )

    return {
        **overall,
        "stage": "analyze",
        "competitors": overall["competitors"],
        "competitor_channels": competitor_channels,
        "competitor_audience": audience_block["competitor_audience"],
        "audience_config": audience_block["audience_config"],
    }


def has_competitor_metrics(result: dict[str, Any]) -> bool:
    return (
        has_overall_metrics(result)
        or has_flow_metrics(result)
        or has_audience_data(result)
    )


__all__ = ["build_result", "has_competitor_metrics"]
