"""CLI stdout JSON 输出。"""

from __future__ import annotations

import json
import sys
from typing import Any


def emit_json(data: dict[str, Any]) -> None:
    sys.stdout.write("__DSAGENT_RESULT__" + json.dumps(data, ensure_ascii=False))
    sys.stdout.write("\n")
