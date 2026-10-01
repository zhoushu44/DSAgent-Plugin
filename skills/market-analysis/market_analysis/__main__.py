import io
import sys

# Windows 默认 GBK 编码，中文输出会 UnicodeEncodeError，强制 UTF-8
if sys.platform == "win32":
    for _name in ("stdout", "stderr"):
        _stream = getattr(sys, _name)
        if hasattr(_stream, "buffer"):
            setattr(sys, _name, io.TextIOWrapper(_stream.buffer, encoding="utf-8", errors="replace"))

from .main import main

if __name__ == "__main__":
    raise SystemExit(main())
