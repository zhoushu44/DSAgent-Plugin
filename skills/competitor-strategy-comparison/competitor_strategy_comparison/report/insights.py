"""报告对象与周期摘要。"""

from __future__ import annotations

from typing import Any

from ..parse.common import title


def report_scope(result: dict[str, Any]) -> dict[str, str]:
    own = result["own_item"]
    competitor = result["competitor_item"]
    return {
        "own_name": title(own.get("raw"), own["item_id"]),
        "competitor_name": title(competitor.get("raw"), competitor["item_id"]),
        "own_id": own["item_id"],
        "competitor_id": competitor["item_id"],
    }
