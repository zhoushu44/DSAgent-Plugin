"""python -m store_patrol_manager 入口。"""
from __future__ import annotations

import io
import sys

if sys.platform == "win32":
    for _name in ("stdout", "stderr"):
        _stream = getattr(sys, _name)
        if hasattr(_stream, "buffer"):
            setattr(sys, _name, io.TextIOWrapper(_stream.buffer, encoding="utf-8", errors="replace"))

from .cli.main import main

if __name__ == "__main__":
    raise SystemExit(main())

