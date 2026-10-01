"""CLI 的小型 JSON 工具。"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_json(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def emit_json(value: dict[str, Any]) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))

