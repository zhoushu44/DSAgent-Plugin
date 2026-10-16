#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""直接搜原始 JSON 中 properties 的完整字符串（不经 JSON 解析，避免转义丢失）。"""
import json, re, urllib.parse, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

def uq(s, times=5):
    for _ in range(times):
        n = urllib.parse.unquote(s)
        if n == s:
            break
        s = n
    return s

raw = Path("dev/.ui-shots/xianyu-cat-ctx.json").read_text(encoding="utf-8")

# 直接找 properties= 后面的原始片段
print("=" * 70)
print("properties 原始片段 → 逐层解码")
print("=" * 70)
seen = set()
for m in re.finditer(r'properties=([^"\\\s]+)', raw):
    seg = m.group(1)
    if seg in seen:
        continue
    seen.add(seg)
    dec = uq(seg)
    print("\n原始(前120):", seg[:120])
    print("解码后     :", dec[:400])
    try:
        arr = json.loads(dec)
        for pr in arr:
            print("   →", pr)
    except Exception as e:
        print("   (JSON 解析失败:", e, ")")

print("\n" + "=" * 70)
print("搜索所有含「其他服务」「其他」的类目值")
print("=" * 70)
for m in re.finditer(r'"valueName":"([^"]{1,30})"', raw):
    print("  valueName:", uq(m.group(1)))
for m in re.finditer(r'"propertyName":"([^"]{1,30})"', raw):
    print("  propertyName:", uq(m.group(1)))
