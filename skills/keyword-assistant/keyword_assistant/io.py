"""CLI stdout JSON 输出。"""

from __future__ import annotations

import json
import sys
from typing import Any


def emit_json(data: dict[str, Any] | list[Any]) -> None:
    sys.stdout.write(json.dumps(data, ensure_ascii=False, indent=2))
    sys.stdout.write("\n")


def emit_results(results: list[Any]) -> None:
    payload = [r.to_dict() for r in results]
    emit_json(payload[0] if len(payload) == 1 else payload)
