#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""对比：我的被删描述 vs 存活竞品描述，标出风险点。"""
import json, re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

MY = {
    "DeepSeek API": "【官方2折】AI大模型API中转 Key 独享 | DeepSeek/Claude/GPT/GLM/Kimi 通用\n"
        "官方 2 折，1 元起测，按量计费，不用不扣。\n"
        "为什么选我们：\n1. 独享 Key，不掺量、不共享号池\n"
        "2. 额度长期有效，不做日卡次卡的过期套路\n"
        "3. 余额和消耗明细实时可查\n"
        "4. 一个 Key 通用全部模型，不用分开充值\n"
        "5. 支持小额先测后买，不会配置可协助接入\n"
        "虚拟商品，一经发出不支持退换，请确认需求后再拍。\n"
        "不会配置的下单后联系我，远程协助到你跑通为止。",
}

print("=" * 74)
print("我的描述里的高风险表述")
print("=" * 74)
RISK = [
    (r"官方\s*2\s*折", "「官方2折」—— 易被判定冒充官方/虚假宣传（第三方中转自称官方）"),
    (r"不做.{0,6}套路", "「不做…套路」—— 贬损同业，涉嫌不正当竞争"),
    (r"为什么选我们", "「为什么选我们」—— 对比性营销，易被判定拉踩同业"),
    (r"不掺量|不共享号池", "「不掺量/不共享」—— 暗示同业掺量，贬损同业"),
    (r"不掺量", "同上"),
    (r"官网|官方", "「官方」出现多次 —— 需改为「官网价」并声明非官方直营"),
]
for kw in MY:
    print(f"\n▸ {kw}")
    for pat, why in RISK:
        for m in re.finditer(pat, MY[kw]):
            print(f"   ⚠ {m.group(0)!r}  →  {why}")

print("\n" + "=" * 74)
print("存活竞品怎么写的（对照）")
print("=" * 74)
d = json.loads(Path("dev/.ui-shots/xianyu-rival-desc.json").read_text(encoding="utf-8"))
for r in d:
    if r.get("error") or r.get("deleted"):
        continue
    body = r.get("body", "")
    print(f"\n▸ {r['label']}")
    # 抓折扣/官方相关句
    for m in re.finditer(r"[^\n]{0,60}(?:折|官方|官网|非直连|非官方)[^\n]{0,60}", body):
        s = m.group(0).strip()
        if len(s) > 4:
            print("   ", s[:130])

print("\n" + "=" * 74)
print("结论")
print("=" * 74)
print("""
存活竞品的共同做法：
  1. 折扣只描述「官网价/官方价格的X折」，不把「官方」当身份背书
  2. 主动披露：「非直连」「本商品为非官方 API 接口服务」
  3. 不写「别家的坑/套路」这类拉踩话术
  4. 单条差异化，不批量同模板铺货

我的做法：
  ✗ 把「官方2折」当主标题 —— 第三方中转自称官方
  ✗ 写「不做套路」「不掺量」—— 贬损同业
  ✗ 8 条用同一套模板批量铺 —— 重复铺货特征
  ✗ 挂在「其他闲置」（实物类目）—— 类目错放
""")
