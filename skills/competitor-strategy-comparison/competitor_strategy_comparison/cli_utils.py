"""CLI 共用参数、日期与 JSON 输出工具。"""

from __future__ import annotations

import json
import re
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .config import artifacts_dir


def emit_json(data: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(data, ensure_ascii=False, indent=2))
    sys.stdout.write("\n")


def sanitize_filename(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*\'"]+', "", name)


def default_report_file(own_id: str, competitor_id: str) -> Path:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe = sanitize_filename(f"{own_id}_{competitor_id}")
    return artifacts_dir() / f"竞品策略报告_{safe}_{ts}.html"


def default_insights_file() -> Path:
    return artifacts_dir() / "竞品策略洞察.md"


def default_insights_artifacts() -> dict[str, str]:
    return {"insights_md": str(default_insights_file())}


def date_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    try:
        if "-" in text:
            return date.fromisoformat(text[:10]).isoformat()
        compact = text[:8]
        return date(int(compact[:4]), int(compact[4:6]), int(compact[6:8])).isoformat()
    except (ValueError, TypeError):
        return None


def item_id(value: str, field: str) -> str:
    text = str(value).strip()
    if not text.isdigit():
        raise ValueError(f"{field} 必须是纯数字商品 ID")
    return text


def validate_period(start: str, end: str) -> tuple[str, str]:
    try:
        start_date = date.fromisoformat(start)
        end_date = date.fromisoformat(end)
    except ValueError as exc:
        raise ValueError("日期必须使用 YYYY-MM-DD 格式") from exc
    if start_date > end_date:
        raise ValueError("开始日期不能晚于结束日期")
    if (end_date - start_date).days > 39:
        raise ValueError("DMP 对比周期最长为 40 天")
    return start_date.isoformat(), end_date.isoformat()
