"""人群画像：dmp insight tag/chart（同行宝贝行为人群）。"""

from __future__ import annotations

import logging
from typing import Any

from ..config import (
    AUDIENCE_BEHAVIOR_LABELS,
    AUDIENCE_TAG_KEYS,
    AUDIENCE_TIME_RANGE_LABELS,
    DEFAULT_AUDIENCE_ACTION_VALUES,
    DEFAULT_AUDIENCE_TIME_RANGE,
    INSIGHT_MODULE_INSTANCE_ID,
    INSIGHT_TAG_CHART_ENDPOINT,
    PEER_ITEM_CROWD_OPTION_GROUPS,
    PEER_ITEM_CROWD_TAG_ID,
)
from ..parse.common import normalize_id
from .._api_client import DmpCompetitionClient, DmpError

logger = logging.getLogger(__name__)


def _build_tag_chart_body(
    *,
    tag_id: int,
    item_ids: list[str],
    action_values: list[str],
    time_range: str,
) -> dict[str, Any]:
    item_ids_str = ",".join(item_ids)
    action_values_str = ",".join(action_values)
    action_names_str = ",".join(AUDIENCE_BEHAVIOR_LABELS[value] for value in action_values)
    og_item, og_action, og_time = PEER_ITEM_CROWD_OPTION_GROUPS

    return {
        "appCode": "dmpInsight",
        "selectTagOptionSetDTO": {
            "operator": 1,
            "selectTagOptionSetDTO": [
                {
                    "operator": 1,
                    "selects": [
                        {
                            "tagId": PEER_ITEM_CROWD_TAG_ID,
                            "optionGroupId": og_item,
                            "tagName": "同行宝贝行为人群",
                            "values": item_ids_str,
                            "names": item_ids_str,
                        },
                        {
                            "tagId": PEER_ITEM_CROWD_TAG_ID,
                            "optionGroupId": og_action,
                            "tagName": "同行宝贝行为人群",
                            "values": action_values_str,
                            "names": action_names_str,
                        },
                        {
                            "tagId": PEER_ITEM_CROWD_TAG_ID,
                            "optionGroupId": og_time,
                            "tagName": "同行宝贝行为人群",
                            "values": time_range,
                            "names": AUDIENCE_TIME_RANGE_LABELS[time_range],
                        },
                    ],
                },
            ],
        },
        "needUnknown": False,
        "tagId": tag_id,
    }


def _extract_chart_data(resp: dict[str, Any]) -> list[dict[str, Any]]:
    # 达摩盘在「该人群样本不足」时会返回 info.ok=true 但 result 各字段全为 null，
    # 此时 chartDataFull 为 null（非数组）。此处必须归一为空列表，
    # 否则 len(chart) 抛 TypeError 直接中断 analyze（报告侧已支持「暂无数据」占位）。
    data = resp.get("data") or {}
    result = data.get("result") or {}
    chart = result.get("chartDataFull")
    return chart if isinstance(chart, list) else []


def fetch_audience(
    client: DmpCompetitionClient,
    *,
    competitor_ids: list[int],
    action_values: list[str] | None = None,
    time_range: str | None = None,
) -> dict[str, Any]:
    actions = list(action_values or DEFAULT_AUDIENCE_ACTION_VALUES)
    days = time_range or DEFAULT_AUDIENCE_TIME_RANGE
    params = client.insight_query_params(module_instance_id=INSIGHT_MODULE_INSTANCE_ID)

    audience_raw: dict[str, dict[str, list[dict[str, Any]]]] = {}
    logger.info(
        "人群画像: competitors=%s 行为=%s %s",
        competitor_ids,
        actions,
        AUDIENCE_TIME_RANGE_LABELS[days],
    )

    for cid in competitor_ids:
        cid_str = normalize_id(cid)
        audience_raw[cid_str] = {}
        item_ids = [cid_str]

        for action in actions:
            audience_raw[cid_str][action] = {}
            action_label = AUDIENCE_BEHAVIOR_LABELS[action]
            for tag_name, tag_id in AUDIENCE_TAG_KEYS:
                try:
                    body = _build_tag_chart_body(
                        tag_id=tag_id,
                        item_ids=item_ids,
                        action_values=[action],
                        time_range=days,
                    )
                    resp = client.call_api(
                        INSIGHT_TAG_CHART_ENDPOINT,
                        params=params,
                        body=body,
                    )
                    chart = _extract_chart_data(resp)
                    audience_raw[cid_str][action][tag_name] = chart
                    logger.info(
                        "人群画像 %s / %s / %s: %d 项",
                        cid_str,
                        action_label,
                        tag_name,
                        len(chart),
                    )
                except DmpError as exc:
                    logger.warning(
                        "人群画像 %s / %s / %s 失败: %s",
                        cid_str,
                        action_label,
                        tag_name,
                        str(exc),
                    )
                    audience_raw[cid_str][action][tag_name] = []

    return {
        "audience_raw": audience_raw,
        "audience_action_values": actions,
        "audience_time_range": days,
    }
