"""推广渠道、投放计划与关键词解析。"""

from __future__ import annotations

from typing import Any

from .common import number_text


def side_has_data(item: dict[str, Any], side: str) -> bool:
    key = "itemValue" if side == "own" else "succItemValue"
    return any(
        isinstance(value, dict) and value.get(key) is not None
        for value in item.values()
    )


def promotion_rows(data: Any) -> list[list[str]]:
    overview = data.get("overview") or [] if isinstance(data, dict) else []
    output: list[list[str]] = []
    for scene in overview:
        def pair(
            key: str,
            *,
            percent: bool = False,
            money: bool = False,
            current_scene: dict[str, Any] = scene,
        ) -> tuple[str, str]:
            raw = current_scene.get(key) or {}
            return (
                number_text(raw.get("itemValue"), percent=percent, money=money),
                number_text(raw.get("succItemValue"), percent=percent, money=money),
            )

        own_charge, competitor_charge = pair("charge", money=True)
        own_ratio, competitor_ratio = pair("chargeRatio", percent=True)
        own_ctr, competitor_ctr = pair("ctr", percent=True)
        own_roi, competitor_roi = pair("directRoi")
        output.append([
            str(scene.get("sceneName") or "未知场景"),
            own_charge,
            competitor_charge,
            own_ratio,
            competitor_ratio,
            own_ctr,
            competitor_ctr,
            own_roi,
            competitor_roi,
        ])
    return output


def _plan_summary(item: dict[str, Any], side: str) -> str:
    key = "itemValue" if side == "own" else "succItemValue"

    def metric(name: str, *, percent: bool = False, money: bool = False) -> str:
        return number_text((item.get(name) or {}).get(key), percent=percent, money=money)

    return "，".join([
        f"消耗 {metric('charge', money=True)}",
        f"占比 {metric('chargeRatio', percent=True)}",
        f"展现 {metric('impression')}",
        f"点击 {metric('click')}",
        f"点击率 {metric('ctr', percent=True)}",
        f"点击成本 {metric('cpc', money=True)}",
        f"直接成交 {metric('directDealAmount', money=True)}",
        f"直接ROI {metric('directRoi')}",
    ])


def strategy_rows(data: Any) -> list[list[str]]:
    details = data.get("scene_details") or {} if isinstance(data, dict) else {}
    overview = data.get("overview") or [] if isinstance(data, dict) else []
    scene_names = {
        str(item.get("sceneId")): str(item.get("sceneName") or item.get("sceneId"))
        for item in overview
        if isinstance(item, dict) and item.get("sceneId") is not None
    }
    rows: list[list[str]] = []
    for scene_id, items in details.items():
        if not isinstance(items, list):
            continue
        for item in items:
            name = str(item.get("sceneName") or "").strip()
            if not name:
                continue
            own = _plan_summary(item, "own") if side_has_data(item, "own") else "本周期未返回计划数据"
            competitor = _plan_summary(item, "competitor") if side_has_data(item, "competitor") else "本周期未返回计划数据"
            rows.append([scene_names.get(str(scene_id), name.split("-", 1)[0]), name, own, competitor])
    return rows


def opened_plans(data: Any, side: str) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for row in strategy_rows(data):
        detail = row[2] if side == "own" else row[3]
        if "未返回计划数据" not in detail and row[1] not in seen:
            seen.add(row[1])
            result.append(row[1])
    return result


def active_channels(data: Any, side: str = "competitor") -> list[str]:
    if not isinstance(data, dict):
        return []
    names: list[str] = []
    seen: set[str] = set()
    for scene in data.get("overview") or []:
        if not isinstance(scene, dict) or not side_has_data(scene, side):
            continue
        name = str(scene.get("sceneName") or "").strip()
        if name and name not in seen:
            seen.add(name)
            names.append(name)
    for row in strategy_rows(data):
        detail = row[2] if side == "own" else row[3]
        if "未返回计划数据" not in detail and row[0] not in seen:
            seen.add(row[0])
            names.append(row[0])
    return names


def keyword_rows(data: Any, side: str) -> list[list[str]]:
    keywords = data.get("keywords") or {} if isinstance(data, dict) else {}
    key = "item" if side == "own" else "succItem"
    items = keywords.get(key) or [] if isinstance(keywords, dict) else []

    def indicator(item: dict[str, Any], name: str) -> str:
        raw = item.get(name)
        return number_text(raw.get("indicatorValue") if isinstance(raw, dict) else raw)

    rows: list[list[str]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("keywordName") or "").strip()
        if name:
            rows.append([
                name,
                str(item.get("keywordType") or "-").strip(),
                indicator(item, "impression"),
                indicator(item, "click"),
                indicator(item, "ctr"),
                indicator(item, "conversionRate"),
            ])
    return rows


def scene_name_map(data: Any) -> dict[str, str]:
    overview = data.get("overview") or [] if isinstance(data, dict) else []
    return {
        str(item.get("sceneId")): str(item.get("sceneName") or item.get("sceneId"))
        for item in overview
        if isinstance(item, dict) and item.get("sceneId") is not None
    }


def _plan_metric(item: dict[str, Any], name: str, side: str, *, percent: bool = False, money: bool = False) -> str:
    key = "itemValue" if side == "own" else "succItemValue"
    return number_text((item.get(name) or {}).get(key), percent=percent, money=money)


def channel_plan_rows(data: Any, scene_id: str, side: str) -> list[list[str]]:
    details = data.get("scene_details") or {} if isinstance(data, dict) else {}
    items = details.get(str(scene_id)) or details.get(scene_id) or []
    if not isinstance(items, list):
        return []
    rows: list[list[str]] = []
    for item in items:
        if not isinstance(item, dict) or not side_has_data(item, side):
            continue
        name = str(item.get("sceneName") or "").strip()
        if not name:
            continue
        rows.append([
            name,
            _plan_metric(item, "impression", side),
            _plan_metric(item, "click", side),
            _plan_metric(item, "ctr", side, percent=True),
            _plan_metric(item, "charge", side, money=True),
            _plan_metric(item, "cpc", side, money=True),
            _plan_metric(item, "directDealAmount", side, money=True),
            _plan_metric(item, "directRoi", side),
        ])
    return rows


def channel_overview_row(data: Any, scene_id: str) -> dict[str, str] | None:
    overview = data.get("overview") or [] if isinstance(data, dict) else []
    for scene in overview:
        if not isinstance(scene, dict):
            continue
        if str(scene.get("sceneId")) != str(scene_id):
            continue

        def pair(key: str, *, percent: bool = False, money: bool = False) -> tuple[str, str]:
            raw = scene.get(key) or {}
            return (
                number_text(raw.get("itemValue"), percent=percent, money=money),
                number_text(raw.get("succItemValue"), percent=percent, money=money),
            )

        own_charge, competitor_charge = pair("charge", money=True)
        own_ratio, competitor_ratio = pair("chargeRatio", percent=True)
        own_ctr, competitor_ctr = pair("ctr", percent=True)
        own_cpc, competitor_cpc = pair("cpc", money=True)
        own_deal, competitor_deal = pair("directDealAmount", money=True)
        own_roi, competitor_roi = pair("directRoi")
        return {
            "scene_name": str(scene.get("sceneName") or scene_id),
            "own_charge": own_charge,
            "competitor_charge": competitor_charge,
            "own_ratio": own_ratio,
            "competitor_ratio": competitor_ratio,
            "own_ctr": own_ctr,
            "competitor_ctr": competitor_ctr,
            "own_cpc": own_cpc,
            "competitor_cpc": competitor_cpc,
            "own_deal": own_deal,
            "competitor_deal": competitor_deal,
            "own_roi": own_roi,
            "competitor_roi": competitor_roi,
        }
    return None


def active_scene_ids(data: Any) -> list[str]:
    if not isinstance(data, dict):
        return []
    scene_ids: list[str] = []
    seen: set[str] = set()
    for scene in data.get("overview") or []:
        if not isinstance(scene, dict):
            continue
        scene_id = str(scene.get("sceneId") or "")
        if not scene_id or scene_id in seen:
            continue
        if side_has_data(scene, "own") or side_has_data(scene, "competitor"):
            seen.add(scene_id)
            scene_ids.append(scene_id)
    for scene_id in (data.get("scene_details") or {}):
        sid = str(scene_id)
        if sid not in seen:
            seen.add(sid)
            scene_ids.append(sid)
    return scene_ids


def has_keyword_data(data: Any) -> bool:
    return bool(keyword_rows(data, "own") or keyword_rows(data, "competitor"))


def has_flow_data(data: Any) -> bool:
    if not isinstance(data, dict):
        return False
    overview_has_data = any(
        isinstance(scene, dict)
        and (side_has_data(scene, "own") or side_has_data(scene, "competitor"))
        for scene in data.get("overview") or []
    )
    plan_has_data = any(
        "未返回计划数据" not in row[2] or "未返回计划数据" not in row[3]
        for row in strategy_rows(data)
    )
    return bool(
        overview_has_data
        or plan_has_data
        or keyword_rows(data, "own")
        or keyword_rows(data, "competitor")
    )
