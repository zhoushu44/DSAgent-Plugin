"""CLI JSON 输出与落盘。"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def emit_json(data: dict[str, Any] | list[Any]) -> None:
    sys.stdout.write(json.dumps(data, ensure_ascii=False, indent=2))
    sys.stdout.write("\n")


def emit_results(results: list[Any]) -> None:
    payload = [item.to_dict() for item in results]
    emit_json(payload[0] if len(payload) == 1 else payload)


def write_result_json(result: Any, output_path: Path) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(result.to_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return str(output_path)
