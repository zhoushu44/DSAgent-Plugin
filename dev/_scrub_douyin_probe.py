#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tree-filter 脚本：摘除抖音逆向探针目录。

skills/_douyin_probe/ 是逆向过程的临时产物（316 个文件），
含第三方平台源码与一枚 Google API key，不应进入公开仓库。
"""
import shutil
import sys
from pathlib import Path

TARGET = Path("skills/_douyin_probe")

if TARGET.exists():
    # 统计一下，便于确认真的删对了
    n = sum(1 for _ in TARGET.rglob("*") if _.is_file())
    shutil.rmtree(TARGET)
    print(f"[scrub] 删除 skills/_douyin_probe/ ({n} files)", file=sys.stderr)
else:
    print("[scrub] skills/_douyin_probe/ 不存在（该提交未包含）", file=sys.stderr)

sys.exit(0)
