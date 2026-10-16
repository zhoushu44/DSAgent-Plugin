#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从竞品详情 JSON 中提取并逐层解码「发布时用的类目」。"""
import json, re, urllib.parse, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

def uq(s, times=4):
    for _ in range(times):
        n = urllib.parse.unquote(s)
        if n == s:
            break
        s = n
    return s

raw = Path("dev/.ui-shots/xianyu-cat-ctx.json").read_text(encoding="utf-8")
d = json.loads(raw)

print("=" * 70)
print("竞品发布链接（skillSellerTransferUrl / detailRedirectPublishUrl）")
print("=" * 70)
found = set()
for ctx in d.get("ctxDump", []):
    for m in re.finditer(r'fleamarket://simple_post\?[^\s"]*', ctx):
        url = m.group(0)
        if "channelCatId" not in url:
            continue
        if url in found:
            continue
        found.add(url)
        params = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        print("\nchannelCatId :", params.get("channelCatId", [""])[0])
        print("bizFrom      :", params.get("bizFrom", [""])[0])
        for pv in params.get("properties", []):
            try:
                props = json.loads(uq(pv))
                for pr in props:
                    print("  ├ 属性名 :", pr.get("propertyName"))
                    print("  ├ 属性值 :", pr.get("valueName"))
                    print("  └ valueId:", pr.get("valueId"), " channelCateId:", pr.get("channelCateId"))
            except Exception as e:
                print("  解析失败:", uq(pv)[:300], "|", e)

print("\n" + "=" * 70)
print("itemCatDTO 层级（categoryId 与 channelCatId 的关系）")
print("=" * 70)
for ctx in d.get("ctxDump", []):
    for m in re.finditer(r'"itemCatDTO":\{[^}]+\}', ctx):
        print(" ", m.group(0))
