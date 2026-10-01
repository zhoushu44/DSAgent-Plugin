"""解析共用工具。"""

from __future__ import annotations

from collections.abc import Iterator
from copy import deepcopy
from typing import Any


def response_data(payload: dict[str, Any], label: str) -> Any:
    info = payload.get("info")
    if isinstance(info, dict) and (
        info.get("ok") is False or info.get("code") not in (None, 0, "0")
    ):
        raise RuntimeError(f"{label}失败: {info}")
    return payload.get("data")


def walk(value: Any) -> Iterator[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def pick(obj: Any, *keys: str) -> Any:
    wanted = {key.lower() for key in keys}
    for node in walk(obj):
        for key, value in node.items():
            if key.lower() in wanted and value not in (None, "", []):
                return value
    return None


def preferred_value(payload: Any, *keys: str) -> Any:
    for key in keys:
        value = pick(payload, key)
        if value not in (None, "", []):
            return value
    return None


def item_id(node: dict[str, Any]) -> str:
    return str(node.get("itemId") or node.get("item_id") or node.get("id") or "").strip()


def exact_item(payload: Any, competitor_id: str) -> dict[str, Any] | None:
    for node in walk(payload):
        if item_id(node) == competitor_id:
            return deepcopy(node)
    return None


def number_text(value: Any, *, percent: bool = False, money: bool = False) -> str:
    if value in (None, "", "-"):
        return "-"
    text = str(value)
    if "~" in text or "%" in text or text.startswith("<"):
        return text
    try:
        number = float(value)
    except (TypeError, ValueError):
        return text
    if percent:
        return f"{number * 100:.2f}%"
    if money:
        return f"{number:.2f}元"
    return f"{number:.2f}".rstrip("0").rstrip(".")


def title(raw: Any, fallback: str) -> str:
    value = pick(raw, "itemTitle", "item_title", "title", "itemName", "name")
    return str(value or fallback).strip()
