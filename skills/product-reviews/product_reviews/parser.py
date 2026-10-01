from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .types import ReviewRecord


def extract_item_id(text: str) -> str:
    stripped = text.strip()
    if not stripped:
        return ""

    for pattern in (
        r"(?:itemId|id|item_id|auctionNumId)[=:]?\s*(\d{8,})",
        r"item\.(?:taobao|tmall)\.com/item\.htm\?.*?id=(\d+)",
        r"detail\.tmall\.com/item\.htm\?.*?id=(\d+)",
        r"(\d{10,})",
    ):
        match = re.search(pattern, stripped, re.IGNORECASE)
        if match:
            return match.group(1)

    if stripped.isdigit():
        return stripped
    return ""


def parse_jsonp_text(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("{"):
        return json.loads(stripped)
    match = re.match(r"^[^(]+\((.*)\)\s*$", stripped, re.DOTALL)
    if not match:
        raise ValueError("无法解析 JSONP 响应")
    return json.loads(match.group(1))


def load_jsonp_file(path: Path) -> dict[str, Any]:
    return parse_jsonp_text(path.read_text(encoding="utf-8"))


def normalize_media_url(url: str) -> str:
    if not url:
        return ""
    result = url.strip()
    if result.startswith("//"):
        result = f"https:{result}"
    elif not result.startswith("http"):
        result = f"https://{result.lstrip('/')}"
    if result.startswith("http://"):
        result = result.replace("http://", "https://", 1)
    return result


def _join_media_urls(paths: list[Any], resources: list[Any] | None = None) -> str:
    urls: list[str] = []
    seen: set[str] = set()

    def add(url: str) -> None:
        normalized = normalize_media_url(url)
        if normalized and normalized not in seen:
            seen.add(normalized)
            urls.append(normalized)

    for item in paths:
        if isinstance(item, str):
            add(item)
        elif isinstance(item, dict):
            for key in ("url", "thumbnail", "coverUrl", "videoUrl", "contentUrl", "path"):
                value = item.get(key)
                if value:
                    add(str(value))

    for item in resources or []:
        if not isinstance(item, dict):
            continue
        for key in ("url", "videoUrl", "contentUrl", "cloudVideoUrl", "coverUrl", "thumbnail"):
            value = item.get(key)
            if value:
                add(str(value))

    return " | ".join(urls)


def _tag_label(tag: dict[str, Any]) -> str:
    for key in ("title", "text", "tagName", "tag_name", "name", "label", "tagTitle", "tagDesc"):
        label = str(tag.get(key) or "").strip()
        if label and label != "信用等级":
            return label
    return ""


def _append_tag(tags: list[str], seen: set[str], label: str) -> None:
    if label and label not in seen:
        seen.add(label)
        tags.append(label)


def _extract_tags(item: dict[str, Any]) -> str:
    tags: list[str] = []
    seen: set[str] = set()

    for tag in item.get("rateTagList") or []:
        if isinstance(tag, dict):
            _append_tag(tags, seen, _tag_label(tag))

    for tag in item.get("userTagList") or []:
        if not isinstance(tag, dict):
            continue
        if str(tag.get("tagCode") or "") == "credit":
            continue
        _append_tag(tags, seen, _tag_label(tag))

    appended = item.get("appendedFeed") or {}
    if isinstance(appended, dict):
        for key in ("rateTagList", "appendTagList", "userTagList"):
            for tag in appended.get(key) or []:
                if isinstance(tag, dict):
                    if str(tag.get("tagCode") or "") == "credit":
                        continue
                    _append_tag(tags, seen, _tag_label(tag))

    if tags:
        return "；".join(tags)

    rate_level = classify_rate_level(str(item.get("rateType") or ""))
    if rate_level:
        _append_tag(tags, seen, rate_level)

    if isinstance(appended, dict) and str(appended.get("appendedFeedback") or "").strip():
        _append_tag(tags, seen, "追评")

    pic_paths = item.get("feedPicPathList") or item.get("feedPicList") or []
    if pic_paths:
        _append_tag(tags, seen, "晒图")

    if str(item.get("repeatBusiness") or "").lower() == "true":
        _append_tag(tags, seen, "回头客")

    recom = str(item.get("recomDesc") or "").strip()
    if recom and "购物笔记" in recom:
        _append_tag(tags, seen, "购物笔记")

    if str(item.get("topRate") or "") == "1":
        _append_tag(tags, seen, "置顶")

    return "；".join(tags)


def _extract_sku_map(item: dict[str, Any]) -> dict[str, str]:
    sku_map = item.get("skuMap")
    if not isinstance(sku_map, dict):
        return {}
    return {
        str(key).strip(): str(value).strip()
        for key, value in sku_map.items()
        if str(key).strip() and str(value).strip()
    }


def _extract_sku_name(item: dict[str, Any]) -> str:
    sku_value = str(item.get("skuValueStr") or "").strip()
    if sku_value:
        return sku_value
    sku_map = _extract_sku_map(item)
    if sku_map:
        return "；".join(sku_map.values())
    return ""


def classify_rate_level(rate_type: str) -> str:
    text = str(rate_type or "").strip()
    if text in {"1"}:
        return "好评"
    if text in {"0"}:
        return "中评"
    if text in {"-1"}:
        return "差评"
    try:
        value = int(text)
    except ValueError:
        return ""
    if value > 0:
        return "好评"
    if value == 0:
        return "中评"
    return "差评"


def parse_rate_item(item: dict[str, Any], *, index: int, item_id: str) -> ReviewRecord:
    appended = item.get("appendedFeed") or {}
    if not isinstance(appended, dict):
        appended = {}

    interact = item.get("interactInfo") or {}
    if not isinstance(interact, dict):
        interact = {}

    pic_paths = item.get("feedPicPathList") or []
    if not isinstance(pic_paths, list):
        pic_paths = []

    append_pic_paths = appended.get("appendFeedPicPathList") or []
    if not isinstance(append_pic_paths, list):
        append_pic_paths = []

    return ReviewRecord(
        index=index,
        user=str(item.get("userNick") or item.get("reduceUserNick") or ""),
        sku_name=_extract_sku_name(item),
        sku_map=_extract_sku_map(item),
        tags=_extract_tags(item),
        feedback_date=str(item.get("feedbackDate") or ""),
        media=_join_media_urls(pic_paths, item.get("rateResourceList") or []),
        feedback=str(item.get("feedback") or ""),
        append_feedback=str(appended.get("appendedFeedback") or ""),
        append_media=_join_media_urls(
            append_pic_paths,
            appended.get("appendFeedPicList") or [],
        ),
        like_count=str(interact.get("likeCount") or "0"),
        rate_id=str(item.get("id") or ""),
        rate_type=str(item.get("rateType") or ""),
        item_id=item_id,
    )


def parse_rate_summary(data: dict[str, Any], rate_list: list[Any] | None = None) -> dict[str, Any]:
    auction_title = ""
    items = rate_list if isinstance(rate_list, list) else []
    for item in items:
        if isinstance(item, dict) and item.get("auctionTitle"):
            auction_title = str(item["auctionTitle"]).strip()
            break

    impression_tags: list[dict[str, str]] = []
    skip_titles = {"全部", "图/视频", "追评"}
    for item in data.get("imprItemVOS") or []:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        if not title or title in skip_titles:
            continue
        count = str(item.get("count") or item.get("fuzzyCount") or "").strip()
        if not count:
            continue
        impression_tags.append({"title": title, "count": count})

    def _count_value(tag: dict[str, str]) -> int:
        text = tag["count"].replace("+", "").strip()
        try:
            return int(text)
        except ValueError:
            return 0

    impression_tags.sort(key=_count_value, reverse=True)

    return {
        "auction_title": auction_title,
        "impression_tags": impression_tags[:12],
    }


def parse_rate_payload(payload: dict[str, Any], *, item_id: str, start_index: int = 1) -> tuple[list[ReviewRecord], bool, int, dict[str, Any]]:
    data = payload.get("data") or {}
    rate_list = data.get("rateList") or []
    if not isinstance(rate_list, list):
        rate_list = []

    reviews = [
        parse_rate_item(item, index=start_index + offset, item_id=item_id)
        for offset, item in enumerate(rate_list)
        if isinstance(item, dict)
    ]

    has_next = str(data.get("hasNext", "")).lower() == "true"
    total_count = 0
    for key in ("feedAllCount", "total", "totalCount"):
        raw = data.get(key)
        if raw in (None, ""):
            continue
        try:
            total_count = int(str(raw))
            break
        except ValueError:
            continue

    summary = parse_rate_summary(data, rate_list)

    return reviews, has_next, total_count, summary
