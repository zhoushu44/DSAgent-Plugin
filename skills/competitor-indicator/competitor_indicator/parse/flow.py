"""流量分析：flow/indicator 渠道树。"""

from __future__ import annotations

from typing import Any

from ..config import FLOW_CHANNEL_API
from .common import metric_from_comp_list, normalize_id, period_meta

_FLOW_SKIP_KEYS = frozenset({
    "subChannels",
    "channelId",
    "channelName",
    "channelType",
    "strategyMap",
    "topListIcon",
})


def _channel_label(node: dict[str, Any]) -> tuple[str, str]:
    name = str(node.get("channelName") or "").strip()
    channel_id = str(node.get("channelId") or "").strip()
    return name, channel_id


def _node_metrics_for_competitor(
    node: dict[str, Any],
    competitor_id: str,
    *,
    target_ids: set[str],
    own_id: str,
) -> dict[str, Any]:
    cid = normalize_id(competitor_id)
    metrics: dict[str, Any] = {}
    for display_key, api_key in FLOW_CHANNEL_API.items():
        value = node.get(api_key)
        if not isinstance(value, dict):
            continue
        comp_list = value.get("competitorList")
        if not isinstance(comp_list, list):
            continue
        found = metric_from_comp_list(
            comp_list=comp_list,
            target_ids=target_ids,
            own_id=own_id,
        )
        if cid in found:
            metrics[display_key] = found[cid]
    return metrics


def _build_channel_node(
    node: dict[str, Any],
    *,
    path_prefix: str,
    competitor_ids: list[int],
    target_ids: set[str],
    own_id: str,
) -> dict[str, Any] | None:
    name, channel_id = _channel_label(node)
    segment = channel_id or name
    if not segment:
        return None

    node_path = f"{path_prefix}/{segment}" if path_prefix else segment
    metrics_by_competitor = {
        normalize_id(cid): _node_metrics_for_competitor(
            node, normalize_id(cid), target_ids=target_ids, own_id=own_id
        )
        for cid in competitor_ids
    }

    children: list[dict[str, Any]] = []
    for sub in node.get("subChannels") or []:
        if isinstance(sub, dict):
            child = _build_channel_node(
                sub,
                path_prefix=node_path,
                competitor_ids=competitor_ids,
                target_ids=target_ids,
                own_id=own_id,
            )
            if child:
                children.append(child)

    if not any(metrics_by_competitor.values()) and not children:
        return None

    return {
        "channel_name": name,
        "path": node_path,
        "metrics_by_competitor": metrics_by_competitor,
        "children": children,
    }


def _prune_channel_tree_for_competitor(
    node: dict[str, Any],
    competitor_id: str,
) -> dict[str, Any] | None:
    cid = normalize_id(competitor_id)
    children = [
        pruned
        for child in node.get("children") or []
        if (pruned := _prune_channel_tree_for_competitor(child, cid))
    ]
    metrics = (node.get("metrics_by_competitor") or {}).get(cid) or {}
    if not metrics and not children:
        return None
    return {
        "channel_name": node.get("channel_name") or "",
        "path": node.get("path") or "",
        "metrics": metrics,
        "children": children,
    }


def parse_flow_data(
    flow_raw: dict[str, Any],
    *,
    competitor_ids: list[int],
    target_ids: set[str],
    own_id: str,
) -> dict[str, list[dict[str, Any]]]:
    """解析 flow 渠道树（仅用于流量来源 Tab，不写入顶部指标卡片）。"""
    items = flow_raw.get("list")
    if not isinstance(items, list):
        return {normalize_id(cid): [] for cid in competitor_ids}

    tree: list[dict[str, Any]] = []
    for item in items:
        if isinstance(item, dict):
            node = _build_channel_node(
                item,
                path_prefix="",
                competitor_ids=competitor_ids,
                target_ids=target_ids,
                own_id=own_id,
            )
            if node:
                tree.append(node)

    return {
        normalize_id(cid): [
            row
            for node in tree
            if (row := _prune_channel_tree_for_competitor(node, normalize_id(cid)))
        ]
        for cid in competitor_ids
    }


def channel_tree_has_metrics(nodes: list[dict[str, Any]]) -> bool:
    for node in nodes:
        if node.get("metrics"):
            return True
        if channel_tree_has_metrics(node.get("children") or []):
            return True
    return False


def build_flow_result(
    *,
    competitor_ids: list[int],
    entity_id: int,
    begin_date: str,
    end_date: str,
    peer_begin_date: str,
    peer_end_date: str,
    flow_data: dict[str, Any],
) -> dict[str, Any]:
    target_ids = {normalize_id(cid) for cid in competitor_ids}
    own_id = normalize_id(entity_id)
    competitor_channels = parse_flow_data(
        flow_data,
        competitor_ids=competitor_ids,
        target_ids=target_ids,
        own_id=own_id,
    )

    return {
        **period_meta(
            competitor_ids=competitor_ids,
            entity_id=entity_id,
            begin_date=begin_date,
            end_date=end_date,
            peer_begin_date=peer_begin_date,
            peer_end_date=peer_end_date,
        ),
        "stage": "flow",
        "competitor_channels": competitor_channels,
    }


def has_flow_metrics(result: dict[str, Any]) -> bool:
    channels = result.get("competitor_channels") or {}
    for cid in result.get("competitor_ids") or []:
        if channel_tree_has_metrics(channels.get(cid) or []):
            return True
    return False
