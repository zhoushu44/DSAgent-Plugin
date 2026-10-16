#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""完整解码竞品类目参数（含双重 URL 编码），并汇总所有竞品的类目 ID。"""
import json, re, urllib.parse
from pathlib import Path

def deep_unquote(s, times=3):
    for _ in range(times):
        new = urllib.parse.unquote(s)
        if new == s:
            break
        s = new
    return s

d = json.loads(Path("dev/.ui-shots/xianyu-cat-ctx.json").read_text(encoding="utf-8"))

print("=" * 72)
print("竞品发布链接类目参数（完整解码）")
print("=" * 72)
for ctx in d.get("ctxDump", []):
    for m in re.finditer(r'fleamarket://simple_post\?[^"\\]+', ctx):
        raw = deep_unquote(m.group(0), 1)
        params = urllib.parse.parse_qs(urllib.parse.urlparse(raw).query)
        if "channelCatId" not in params:
            continue
        print("\n原始 channelCatId:", params.get("channelCatId"))
        print("bizFrom:", params.get("bizFrom"))
        for pv in params.get("properties", []):
            try:
                for pr in json.loads(pv):
                    print(f"  {pr.get('propertyName')} = {pr.get('valueName')}"
                          f"   (valueId={pr.get('valueId')}, channelCateId={pr.get('channelCateId')})")
            except Exception as e:
                print("  解析失败:", deep_unquote(pv)[:200])

print("\n" + "=" * 72)
print("所有竞品类目 ID 汇总")
print("=" * 72)
comp = json.loads(Path("dev/.ui-shots/xianyu-competitor-cats.json").read_text(encoding="utf-8"))
for c in comp:
    print(f"  想要{c.get('want'):>5}  {c.get('kw'):<14} categoryId=50023914  channelCatId={c.get('apiCatHits')}")
