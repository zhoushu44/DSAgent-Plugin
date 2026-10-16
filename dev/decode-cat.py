#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""解码竞品发布链接里的类目参数，确认他们用的 channelCatId 与属性名。"""
import json, re, urllib.parse
from pathlib import Path

p = Path("dev/.ui-shots/xianyu-cat-ctx.json")
d = json.loads(p.read_text(encoding="utf-8"))

print("=" * 72)
print("竞品发布链接中的类目参数（URL 解码）")
print("=" * 72)
for ctx in d.get("ctxDump", []):
    for m in re.finditer(r'(fleamarket://simple_post\?[^"]+)', ctx):
        raw = m.group(1)
        # 解码 properties 里的中文
        q = urllib.parse.urlparse(raw).query
        params = urllib.parse.parse_qs(q)
        print("\nURL:", raw[:160])
        for k, v in params.items():
            dec = urllib.parse.unquote(v[0])
            if k == "properties":
                try:
                    props = json.loads(dec)
                    for pr in props:
                        print(f"  properties: {pr.get('propertyName')} = {pr.get('valueName')}"
                              f"  (valueId={pr.get('valueId')}, channelCateId={pr.get('channelCateId')})")
                except Exception:
                    print(f"  {k} = {dec[:200]}")
            else:
                print(f"  {k} = {dec}")

print("\n" + "=" * 72)
print("竞品 itemCatDTO（层级类目）")
print("=" * 72)
seen = set()
for ctx in d.get("ctxDump", []):
    for m in re.finditer(r'"itemCatDTO":\{[^}]+\}', ctx):
        s = m.group(0)
        if s not in seen:
            seen.add(s)
            print(s)
