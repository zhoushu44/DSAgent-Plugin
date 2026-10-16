#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dump item.list 原始结构，看卡片上显示的状态标签。"""
import json, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
d = json.loads(Path("dev/.ui-shots/xianyu-violation-evidence.json").read_text(encoding="utf-8"))

for a in d.get("apis", []):
    if "item.list" not in a.get("api", ""):
        continue
    j = json.loads(a["body"])
    data = j.get("data", {})
    print("data keys:", list(data.keys()))
    for k, v in data.items():
        if isinstance(v, list) and v:
            print(f"\n=== {k} ({len(v)} 项) ===")
            for it in v[:12]:
                print(json.dumps(it, ensure_ascii=False)[:1200])
                print("-" * 60)
