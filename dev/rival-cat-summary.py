#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""竞品类目分布统计（读已抓取的真实数据）。"""
import json, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

NAME = {
    "201453616": "软件/程序/网站开发",
    "201459411": "其他闲置",
    "201461105": "其他服务",
    "202038701": "AI模型训练",
    "202148345": "DeepSeek服务",
    "201454913": "其他技能服务",
    "201451818": "其它互联网/软硬件相关服务",
    "201703301": "网站/工具会员充值",
}

d = json.loads(Path("dev/.ui-shots/xianyu-competitor-cats.json").read_text(encoding="utf-8"))

rows = []
for c in d:
    hits = c.get("apiCatHits") or []
    ch = [h for h in hits if "channelCatId" in h]
    if not ch:
        continue
    cid = ch[0].split('"')[-2]
    rows.append({
        "want": c.get("want", 0),
        "cat": NAME.get(cid, f"未知({cid})"),
        "cid": cid,
        "note": (c.get("note") or "")[:30],
    })

rows.sort(key=lambda r: -r["want"])

print("=" * 78)
print("竞品（同品类）实际挂载的类目")
print("=" * 78)
print(f"{'想要数':>6}  {'类目':<20} 标题")
print("-" * 78)
for r in rows:
    print(f"{r['want']:>6}  {r['cat']:<20} {r['note']}")

print()
print("=" * 78)
print("类目分布")
print("=" * 78)
tally = {}
for r in rows:
    tally[r["cat"]] = tally.get(r["cat"], 0) + 1
for k, v in sorted(tally.items(), key=lambda x: -x[1]):
    print(f"  {v:>2} 条   {k}")

print()
print("=" * 78)
print("结论")
print("=" * 78)
print("""
竞品并没有都挤在「其他闲置」。真实分布是分散在多个类目：

  软件/程序/网站开发   ← 卖 API key / 额度（最贴切）
  其他闲置             ← 部分卖 API 的
  其他服务             ← 卖「服务」性质的
  AI模型训练           ← 卖模型调用的
  DeepSeek服务         ← 平台专为 DeepSeek 设的类目

关键：**「软件/程序/网站开发」和「其他服务」都有人在用，且都存活**。

我踩的坑：
  我用网页版发，而网页版把「软件/程序/网站开发」「其他服务」
  这些**正确类目全拦了**（实测 BLOCKED），
  只有「其他闲置」能发 —— 于是我全挂了「其他闲置」。
  → 结果：8 条清一色同类目 + 同模板，最容易被判重复铺货/类目错放。

正确做法：
  用**闲鱼 APP** 发布，APP 里能选到「软件/程序/网站开发」
  或「其他服务」这些正确类目（网页版选不到）。
""")
