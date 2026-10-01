from __future__ import annotations

import re
from pathlib import Path

from ..config import artifacts_dir


def _safe_item_id(item_id: str) -> str:
    value = re.sub(r"[\\\\/:*?\"<>|]+", "_", str(item_id or "").strip())
    return value or "unknown"


def insights_file_for_item(item_id: str) -> Path:
    return artifacts_dir() / f"商品评价洞察_{_safe_item_id(item_id)}.md"


def default_insights_artifacts(item_id: str) -> dict[str, str]:
    path = insights_file_for_item(item_id)
    return {"review_md": str(path)}
