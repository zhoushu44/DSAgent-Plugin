"""推广渠道、场景计划与关键词取数。"""

from __future__ import annotations

from typing import Any

from .._api_client import DmpStrategyClient
from ..config import (
    FORCED_PROMOTION_SCENES,
    PROMOTION_KEYWORD_ENDPOINT,
    PROMOTION_SCENE_ENDPOINT,
)
from ..parse.common import pick, response_data, walk


def fetch_flow(client: DmpStrategyClient, query: dict[str, Any]) -> dict[str, Any]:
    params = {
        "itemId": query["own_id"],
        "succItemIds": query["competitor_id"],
        "startDate": query["start"],
        "endDate": query["end"],
    }
    overview = response_data(client.get(PROMOTION_SCENE_ENDPOINT, params), "推广场景")
    scene_ids = {
        str(pick(node, "sceneId", "sceneLevel1Id"))
        for node in walk(overview)
        if pick(node, "sceneId", "sceneLevel1Id")
    }
    scene_ids.update(FORCED_PROMOTION_SCENES)
    details: dict[str, Any] = {}
    errors: dict[str, str] = {}
    for scene_id in sorted(scene_ids):
        try:
            details[scene_id] = response_data(
                client.get(PROMOTION_SCENE_ENDPOINT, {**params, "sceneLevel1Id": scene_id}),
                f"推广场景{scene_id}",
            )
        except Exception as exc:  # noqa: BLE001 - 单场景失败必须保留其他场景结果
            errors[scene_id] = str(exc)
    keywords = response_data(client.get(PROMOTION_KEYWORD_ENDPOINT, params), "推广关键词")
    return {
        "overview": overview,
        "queried_scene_ids": sorted(scene_ids),
        "scene_details": details,
        "scene_errors": errors,
        "keywords": keywords,
    }


__all__ = ["fetch_flow"]
