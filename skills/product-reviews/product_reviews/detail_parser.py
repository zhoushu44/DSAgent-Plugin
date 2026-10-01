from __future__ import annotations

from typing import Any

from .parser import normalize_media_url


def _is_color_prop(name: str) -> bool:
    return "颜色" in str(name or "")


def parse_detail_payload(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data") or {}
    item = data.get("item") or {}
    sku_base = data.get("skuBase") or {}

    props_out: list[dict[str, Any]] = []
    for prop in sku_base.get("props") or []:
        if not isinstance(prop, dict):
            continue
        name = str(prop.get("name") or "").strip()
        if not name:
            continue
        values_out: list[dict[str, str]] = []
        for value in prop.get("values") or []:
            if not isinstance(value, dict):
                continue
            value_name = str(value.get("name") or "").strip()
            if not value_name:
                continue
            image = normalize_media_url(str(value.get("image") or ""))
            values_out.append({
                "name": value_name,
                "vid": str(value.get("vid") or "").strip(),
                "image": image,
            })
        if not values_out:
            continue
        props_out.append({
            "name": name,
            "pid": str(prop.get("pid") or "").strip(),
            "kind": "color" if _is_color_prop(name) else "spec",
            "values": values_out,
        })

    return {
        "item_title": str(item.get("title") or "").strip(),
        "sku_props": props_out,
    }
