"""python -m market_trend 入口"""

import io
import sys

# Windows 默认 GBK 编码，中文输出会 UnicodeEncodeError，强制 UTF-8
if sys.platform == "win32":
    for _name in ("stdout", "stderr"):
        _stream = getattr(sys, _name)
        if hasattr(_stream, "buffer"):
            setattr(sys, _name, io.TextIOWrapper(_stream.buffer, encoding="utf-8", errors="replace"))

from .main import main, inject_report, list_categories

# 判断子命令
if len(sys.argv) > 1 and sys.argv[1] == "inject-report":
    sys.exit(inject_report(sys.argv[2:]))
elif len(sys.argv) > 1 and sys.argv[1] == "list-categories":
    sys.exit(list_categories(sys.argv[2:]))
else:
    sys.exit(main())
