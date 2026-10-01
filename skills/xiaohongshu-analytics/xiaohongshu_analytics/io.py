"""stdout JSON 输出工具。

约定：stdout 只输出 __DSAGENT_RESULT__ 前缀的 JSON，其余进度信息一律走 stderr。
"""

from __future__ import annotations

import json
import sys
from typing import Any


def emit_json(data: dict[str, Any]) -> None:
    """把结果 JSON 写到 stdout（唯一 stdout 出口）。"""
    sys.stdout.write(json.dumps(data, ensure_ascii=False, indent=2))
    sys.stdout.write("\n")
