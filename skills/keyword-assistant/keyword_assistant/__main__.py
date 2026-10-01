"""python -m keyword_assistant 入口"""

import io
import sys

# Windows 默认 GBK 编码，中文输出会 UnicodeEncodeError，强制 UTF-8
if sys.platform == "win32":
    for _name in ("stdout", "stderr"):
        _stream = getattr(sys, _name)
        if hasattr(_stream, "buffer"):
            setattr(sys, _name, io.TextIOWrapper(_stream.buffer, encoding="utf-8", errors="replace"))

from .main import inject_report, main

# 判断子命令
if len(sys.argv) > 1:
    if sys.argv[1] == "inject-report":
        sys.exit(inject_report(sys.argv[2:]))
    else:
        sys.exit(main())
else:
    sys.exit(main())
