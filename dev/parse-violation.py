#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""解析违规证据 JSON：提取下架原因、系统通知、接口里的状态字段。"""
import json, re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
d = json.loads(Path("dev/.ui-shots/xianyu-violation-evidence.json").read_text(encoding="utf-8"))

print("=" * 72)
print("1) 商品存活状态")
print("=" * 72)
for it in d.get("items", []):
    print(f"  {'存活' if it.get('alive') else '删除'}  {it.get('kw'):<14} {it.get('id')}")

print("\n" + "=" * 72)
print("2) 接口里的状态/原因字段")
print("=" * 72)
KEYS = ["itemStatus", "status", "violation", "reason", "reasonDesc", "auditStatus",
        "punish", "illegal", "banReason", "offlineReason", "itemStatusDesc", "desc"]
for a in d.get("apis", []):
    body = a.get("body", "")
    if len(body) < 50:
        continue
    print(f"\n--- {a.get('api')} ({len(body)}B) ---")
    for k in KEYS:
        for m in re.finditer(rf'"{k}"\s*:\s*("?[^",}}]{{0,120}}"?|\[[^\]]{{0,200}}\])', body):
            print("   ", m.group(0)[:200])

print("\n" + "=" * 72)
print("3) 接口里出现的所有中文提示（含下架/违规字样）")
print("=" * 72)
seen = set()
PAT = re.compile(r"下架|违规|删除|处置|禁止|限制|处罚|不合规|风险|敏感")
for a in d.get("apis", []) + d.get("imApis", []):
    for m in re.finditer(r'[\u4e00-\u9fa5][\u4e00-\u9fa5\w，。、：；！？（）\-/ ]{2,60}', a.get("body", "")):
        s = m.group(0).strip()
        if PAT.search(s) and s not in seen:
            seen.add(s)
            print("   ", s)

print("\n" + "=" * 72)
print("4) 消息中心")
print("=" * 72)
im = d.get("im") or {}
print("URL:", im.get("url"))
print("会话列表:", json.dumps(im.get("convs", [])[:20], ensure_ascii=False, indent=1))
print("\n--- 消息文本 ---")
print((im.get("text") or "")[:1200])
if d.get("imDetail"):
    print("\n--- 点击后详情 ---")
    print(d["imDetail"][:2000])

print("\n" + "=" * 72)
print("5) 发布权限检查")
print("=" * 72)
pc = d.get("publishCheck") or {}
print("受限:", pc.get("restricted"))
print((pc.get("text") or "")[:600])
