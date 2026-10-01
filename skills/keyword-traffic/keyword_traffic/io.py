"""CLI stdout JSON 输出。"""

from __future__ import annotations

import json
import sys
from typing import Any


def emit_json(data: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(data, ensure_ascii=False, indent=2))
    sys.stdout.write("\n")
