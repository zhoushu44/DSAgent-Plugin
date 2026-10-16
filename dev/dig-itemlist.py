#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""深挖 item.list 接口原文：找出所有字段名，定位下架原因字段。"""
import json, re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
d = json.loads(Path("dev/.ui-shots/xianyu-violation-evidence.json").read_text(encoding="utf-8"))

for a in d.get("apis", []):
    if "item.list" not in a.get("api", ""):
        continue
    body = a["body"]
    print("API:", a["api"], len(body), "B")
    try:
        j = json.loads(body)
    except Exception as e:
        print("parse fail", e)
        print(body[:2000])
        continue

    def walk(o, path=""):
        if isinstance(o, dict):
            for k, v in o.items():
                yield from walk(v, f"{path}.{k}")
        elif isinstance(o, list):
            for i, v in enumerate(o[:3]):
                yield from walk(v, f"{path}[{i}]")
        else:
            yield path, o

    print("\n--- 所有字段名 ---")
    keys = sorted({p.split(".")[-1].split("[")[0] for p, _ in walk(j)})
    print(json.dumps(keys, ensure_ascii=False, indent=1))

    print("\n--- 每条商品的关键字段 ---")
    data = j.get("data", {})
    lst = data.get("itemList") or data.get("list") or data.get("items") or []
    print("商品数:", len(lst))
    for it in lst:
        if not isinstance(it, dict):
            continue
        print("\n  id:", it.get("itemId") or it.get("id"),
              "| status:", it.get("itemStatus"),
              "| title:", (it.get("title") or "")[:40])
        # 打印所有含 status/reason/violation 的字段
        for k, v in it.items():
            if re.search(r"status|reason|violation|punish|illegal|audit|desc|tag|tip|ban|offline|shelf", k, re.I):
                s = json.dumps(v, ensure_ascii=False)
                if len(s) < 300:
                    print(f"     {k} = {s}")
