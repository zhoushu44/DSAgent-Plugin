from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterator

from .config import (
    ATTRIBUTE_LABELS,
    DEFAULT_CROWD_TYPES,
    EXIT_API_ERROR,
    PROFILE_KIND_DETAIL,
    PROFILE_KIND_LABELS,
    PROFILE_KIND_SUMMARY,
    SHOP_DETAIL_ATTRIBUTES,
    SUMMARY_PROFILE_ATTRIBUTES,
)
from .dates import format_stat_date_ms
from .types import OverviewMetric, PageInfoConfig, ProfileDimension, ProfileRow, SkillError


def load_json_file(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SkillError(EXIT_API_ERROR, f"JSON 解析失败: {path} ({exc})") from exc
    if not isinstance(payload, dict):
        raise SkillError(EXIT_API_ERROR, f"JSON 顶层必须是对象: {path}")
    return payload


def field_value(obj: dict[str, Any], key: str) -> Any:
    item = obj.get(key)
    if isinstance(item, dict):
        return item.get("value")
    return item


def field_ratio(obj: dict[str, Any], key: str) -> float | None:
    item = obj.get(key)
    if not isinstance(item, dict):
        return None
    ratio = item.get("ratio")
    if ratio is None:
        return None
    try:
        return float(ratio)
    except (TypeError, ValueError):
        return None


def _attribute_label(name: str) -> str:
    return ATTRIBUTE_LABELS.get(name, name)


def default_page_info_config() -> PageInfoConfig:
    return PageInfoConfig(
        crowd_types=[(value, label) for value, label in DEFAULT_CROWD_TYPES],
        summary_attributes=list(SUMMARY_PROFILE_ATTRIBUTES),
        detail_attributes=list(SHOP_DETAIL_ATTRIBUTES),
    )


def _walk_nodes(root: Any) -> Iterator[dict[str, Any]]:
    if isinstance(root, dict):
        yield root
        for value in root.values():
            yield from _walk_nodes(value)
    elif isinstance(root, list):
        for item in root:
            yield from _walk_nodes(item)


def _extract_attribute_names(params: list[Any]) -> list[str]:
    names: list[str] = []
    for item in params:
        if not isinstance(item, dict):
            continue
        ext_map = item.get("extMap") or {}
        name = ext_map.get("attributeName") or item.get("resultKey")
        if not name:
            continue
        text = str(name)
        if text not in names:
            names.append(text)
    return names


def parse_page_info(payload: dict[str, Any]) -> PageInfoConfig:
    ensure_api_success(payload, context="客户画像页面配置")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise SkillError(EXIT_API_ERROR, "页面配置 data 格式异常")

    schema = data.get("projectSchema") or data
    crowd_types: list[tuple[str, str]] = []
    param_blocks: list[list[str]] = []
    seen_blocks: set[tuple[str, ...]] = set()

    for node in _walk_nodes(schema):
        if node.get("componentName") != "CommonRadio":
            continue
        format_maps = node.get("props", {}).get("formatMap") or []
        for fmt in format_maps:
            if fmt.get("valueCode") != "custCrowdType":
                continue
            for opt in fmt.get("options") or []:
                if not isinstance(opt, dict):
                    continue
                value = str(opt.get("value") or "").strip()
                if not value:
                    continue
                label = str(opt.get("label") or value)
                if (value, label) not in crowd_types:
                    crowd_types.append((value, label))

    for node in _walk_nodes(schema):
        if node.get("componentName") != "SycmDomain":
            continue
        for block in node.get("props", {}).get("domainConfigList") or []:
            if not isinstance(block, list):
                continue
            for item in block:
                if not isinstance(item, dict) or not item.get("multiQuery"):
                    continue
                params = item.get("params")
                if not isinstance(params, list):
                    continue
                attrs = _extract_attribute_names(params)
                key = tuple(attrs)
                if attrs and key not in seen_blocks:
                    seen_blocks.add(key)
                    param_blocks.append(attrs)

    if not crowd_types:
        return default_page_info_config()

    shop_attrs = param_blocks[0] if param_blocks else list(SHOP_DETAIL_ATTRIBUTES)
    summary_attrs = param_blocks[1] if len(param_blocks) > 1 else list(SUMMARY_PROFILE_ATTRIBUTES)

    if shop_attrs and shop_attrs[0] in SUMMARY_PROFILE_ATTRIBUTES:
        summary_attrs = shop_attrs
        shop_attrs = list(SHOP_DETAIL_ATTRIBUTES)
    elif summary_attrs and summary_attrs[0] in SHOP_DETAIL_ATTRIBUTES and len(param_blocks) == 1:
        shop_attrs = summary_attrs
        summary_attrs = list(SUMMARY_PROFILE_ATTRIBUTES)

    return PageInfoConfig(
        crowd_types=crowd_types,
        summary_attributes=summary_attrs,
        detail_attributes=shop_attrs,
    )


def ensure_api_success(payload: dict[str, Any], *, context: str) -> None:
    code = payload.get("code")
    if code == 0:
        return
    message = str(payload.get("message") or payload.get("msg") or "未知错误")
    raise SkillError(EXIT_API_ERROR, f"{context} 接口返回错误 code={code}: {message}")


def parse_overview(payload: dict[str, Any]) -> tuple[dict[str, OverviewMetric], int, str]:
    ensure_api_success(payload, context="客户概览")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise SkillError(EXIT_API_ERROR, "客户概览 data 格式异常")

    index_desc = (payload.get("extra") or {}).get("indexDesc") or {}
    metrics: dict[str, OverviewMetric] = {}
    for key, raw in data.items():
        if not isinstance(raw, dict):
            continue
        desc = index_desc.get(key) if isinstance(index_desc.get(key), dict) else {}
        metrics[key] = OverviewMetric(
            key=key,
            label=str(desc.get("text") or key),
            value=raw.get("value"),
            cycle_crc=raw.get("cycleCrc"),
            explanation=str(desc.get("explanation") or ""),
            format=str(desc.get("format") or ","),
        )

    seller_id = int(field_value(data, "sellerId") or 0)
    stat_date = format_stat_date_ms(field_value(data, "statDate"))
    return metrics, seller_id, stat_date


def parse_profile_batch(
    payload: dict[str, Any],
    *,
    crowd_type: str = "",
    crowd_label: str = "",
    profile_kind: str = PROFILE_KIND_SUMMARY,
    profile_kind_label: str = "",
) -> list[ProfileDimension]:
    ensure_api_success(payload, context="客户画像")
    items = payload.get("data")
    if not isinstance(items, list):
        raise SkillError(EXIT_API_ERROR, "客户画像 data 格式异常")

    dimensions: list[ProfileDimension] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("code") not in (0, None):
            continue
        extra = item.get("extra") or {}
        query_param = extra.get("queryParam") or {}
        ext_map = query_param.get("extMap") or {}
        attr_name = str(ext_map.get("attributeName") or "")
        item_crowd_type = str(ext_map.get("custCrowdType") or crowd_type or "")
        rows_payload = item.get("data") or {}
        rows_data = rows_payload.get("data") if isinstance(rows_payload, dict) else []
        if not isinstance(rows_data, list):
            rows_data = []

        rows: list[ProfileRow] = []
        for row in rows_data:
            if not isinstance(row, dict):
                continue
            row_attr = str(field_value(row, "attrName") or attr_name)
            rows.append(ProfileRow(
                attr_name=row_attr,
                attr_label=_attribute_label(row_attr),
                attr_value=str(field_value(row, "attrValue") or ""),
                shop_customer_cnt=float(field_value(row, "shopCustomerCnt") or 0),
                ratio=field_ratio(row, "shopCustomerCnt"),
            ))

        if not attr_name and rows:
            attr_name = rows[0].attr_name

        resolved_crowd_type = item_crowd_type or crowd_type
        resolved_crowd_label = crowd_label
        if not resolved_crowd_label and resolved_crowd_type:
            for value, label in DEFAULT_CROWD_TYPES:
                if value == resolved_crowd_type:
                    resolved_crowd_label = label
                    break

        resolved_kind_label = profile_kind_label or PROFILE_KIND_LABELS.get(profile_kind, profile_kind)

        dimensions.append(ProfileDimension(
            crowd_type=resolved_crowd_type,
            crowd_label=resolved_crowd_label,
            profile_kind=profile_kind,
            profile_kind_label=resolved_kind_label,
            attribute_name=attr_name,
            attribute_label=_attribute_label(attr_name),
            rows=rows,
        ))

    return dimensions
