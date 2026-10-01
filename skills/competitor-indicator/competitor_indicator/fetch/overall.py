"""整体分析数据拉取：shop + base。"""

from __future__ import annotations

import logging
from typing import Any

from ..config import BASE_INDICATOR_ENDPOINT, SHOP_INDICATOR_ENDPOINT
from .._api_client import DmpCompetitionClient

logger = logging.getLogger(__name__)


def fetch_overall(client: DmpCompetitionClient, query: dict[str, Any]) -> dict[str, Any]:
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
        "整体分析: entity=%s competitors=%s %s~%s vs %s~%s",
        query["entity_id"],
        query["competitor_ids"],
        query["begin_date"],
        query["end_date"],
        query["peer_begin_date"],
        query["peer_end_date"],
    )
    shop_resp = client.call_api(SHOP_INDICATOR_ENDPOINT, params=params, body=body)
    base_resp = client.call_api(BASE_INDICATOR_ENDPOINT, params=params, body=body)
    shop_data = shop_resp.get("data") or {}
    base_data = base_resp.get("data") or {}
    logger.info("整体响应: shop=%d 字段, base=%d 字段", len(shop_data), len(base_data))
    return {"shop_data": shop_data, "base_data": base_data}
