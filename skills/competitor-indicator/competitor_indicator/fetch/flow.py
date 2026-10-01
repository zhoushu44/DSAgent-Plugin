"""流量分析数据拉取：flow/indicator。"""

from __future__ import annotations

import logging
from typing import Any

from ..config import FLOW_INDICATOR_ENDPOINT
from .._api_client import DmpCompetitionClient

logger = logging.getLogger(__name__)


def fetch_flow(client: DmpCompetitionClient, query: dict[str, Any]) -> dict[str, Any]:
    params, body = client.indicator_query(
        competitor_ids=query["competitor_ids"],
        entity_id=query["entity_id"],
        begin_date=query["begin_date"],
        end_date=query["end_date"],
        peer_begin_date=query["peer_begin_date"],
        peer_end_date=query["peer_end_date"],
        competition_type=query["competition_type"],
    )
    logger.info(
        "流量分析: entity=%s competitors=%s %s~%s vs %s~%s",
        query["entity_id"],
        query["competitor_ids"],
        query["begin_date"],
        query["end_date"],
        query["peer_begin_date"],
        query["peer_end_date"],
    )
    flow_resp = client.call_api(FLOW_INDICATOR_ENDPOINT, params=params, body=body)
    flow_data = flow_resp.get("data") or {}
    logger.info("流量响应: flow=%d 渠道", len(flow_data.get("list") or []))
    return {"flow_data": flow_data}
