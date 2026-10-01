"""CLI 共用工具。"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from .config import (
    AUDIENCE_BEHAVIOR_LABELS,
    AUDIENCE_TIME_RANGE_LABELS,
    DEFAULT_AUDIENCE_ACTION_VALUES,
    DEFAULT_AUDIENCE_TIME_RANGE,
    artifacts_dir,
)

# 自然语言 / 别名 → 达摩盘行为码（Agent 可把用户话术原样传入 --audience-action）
AUDIENCE_BEHAVIOR_ALIASES: dict[str, str] = {
    "1": "1",
    "2": "2",
    "3": "3",
    "4": "4",
    "5": "5",
    "浏览": "1",
    "看过": "1",
    "browse": "1",
    "搜索": "2",
    "搜过": "2",
    "search": "2",
    "收藏": "3",
    "favorite": "3",
    "fav": "3",
    "加购": "5",
    "加购物车": "5",
    "cart": "5",
    "购买": "4",
    "成交": "4",
    "下单": "4",
    "purchase": "4",
    "buy": "4",
}


def emit_json(data: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(data, ensure_ascii=False, indent=2))
    sys.stdout.write("\n")


def sanitize_filename(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*\'"]+', "", name)


def default_report_file(competitor_id: str) -> Path:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe = sanitize_filename(competitor_id)
    return artifacts_dir() / f"竞品指标报告_{safe}_{ts}.html"


def default_insights_flow_file() -> Path:
    return artifacts_dir() / "竞品流量洞察.md"


def default_insights_audience_file() -> Path:
    return artifacts_dir() / "竞品画像洞察.md"


def default_insights_artifacts() -> dict[str, str]:
    """生成 HTML 时自动读取的固定路径（Agent 按此写入 Markdown）。"""
    return {
        "flow_md": str(default_insights_flow_file()),
        "audience_md": str(default_insights_audience_file()),
    }


def parse_date(value: str, field: str) -> str:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError(f"{field} 格式应为 YYYY-MM-DD，收到: {value}") from exc
    return value


def parse_competitor_ids(raw: str) -> list[int]:
    ids: list[int] = []
    for part in raw.replace("，", ",").split(","):
        part = part.strip()
        if not part:
            continue
        if not part.isdigit():
            raise ValueError(f"无效商品 ID: {part}")
        ids.append(int(part))
    if not ids:
        raise ValueError("至少提供一个竞品商品 ID")
    return ids


def parse_audience_actions(raw: str | None) -> list[str]:
    """解析人群行为：支持码值、中文、英文别名；多项用逗号/顿号/「和」分隔。"""
    if raw is None or not str(raw).strip():
        return list(DEFAULT_AUDIENCE_ACTION_VALUES)

    tokens = re.split(r"[,，、+/\s]+|和", str(raw).strip())
    resolved: list[str] = []
    seen: set[str] = set()

    for token in tokens:
        token = token.strip()
        if not token:
            continue
        code = AUDIENCE_BEHAVIOR_ALIASES.get(token) or AUDIENCE_BEHAVIOR_ALIASES.get(token.lower())
        if not code:
            labels = "、".join(AUDIENCE_BEHAVIOR_LABELS.values())
            raise ValueError(
                f"无法识别人群行为「{token}」，支持：{labels} 或数字 1~5"
            )
        if code not in seen:
            seen.add(code)
            resolved.append(code)

    if not resolved:
        raise ValueError("未解析到有效人群行为")
    return resolved


def parse_audience_days(raw: str | None) -> str:
    """解析人群时间窗：7/15/30/90 或「最近15天」等。"""
    if raw is None or not str(raw).strip():
        return DEFAULT_AUDIENCE_TIME_RANGE

    text = str(raw).strip()
    if text in AUDIENCE_TIME_RANGE_LABELS:
        return text

    match = re.search(r"\d+", text)
    if match:
        days = match.group()
        if days in AUDIENCE_TIME_RANGE_LABELS:
            return days

    allowed = "、".join(AUDIENCE_TIME_RANGE_LABELS.values())
    raise ValueError(f"无法识别人群时间窗「{raw}」，支持：{allowed} 或 7/15/30/90")
