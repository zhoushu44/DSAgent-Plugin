#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""闲鱼上架物料准备：合规主图 + 合规文案 + 违禁词闸门。

设计依据（2026-10-15 实测）：闲鱼 API 类商品批量下架的真实原因是
  ① 类目错放  ② 冒充官方  ③ 贬损同业  ④ 同模板批量铺
本脚本把 ②③ 固化成硬闸门，并对 ④ 做差异化处理。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

# Windows 控制台默认 GBK，统一 UTF-8 输出，避免 ✓/✗ 等符号报错
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

S = 1000
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_REG = r"C:\Windows\Fonts\msyh.ttc"

INK = (255, 255, 255)
SUB = (170, 180, 202)
DIM = (122, 134, 160)
CARD = (24, 32, 52)

# ─────────────────────── 合规闸门 ───────────────────────

BLOCK_RULES: list[tuple[str, str]] = [
    # 冒充官方（第三方中转不得自称官方）
    (r"官方\s*\d+\s*折", "冒充官方：折扣不得写成「官方N折」，应写「官网价N折」"),
    (r"官方直营", "冒充官方：第三方中转不得声称「官方直营」"),
    (r"官方授权", "冒充官方：不得声称「官方授权」"),
    (r"官方渠道", "冒充官方：不得声称「官方渠道」"),
    (r"官方正品", "冒充官方：不得声称「官方正品」"),
    # 贬损同业（不正当竞争）
    (r"不掺量", "贬损同业：「不掺量」暗示同业掺量"),
    (r"不共享", "贬损同业：「不共享」暗示同业共享"),
    (r"不做套路", "贬损同业：「不做套路」贬损同业"),
    (r"套路", "贬损同业：「套路」贬损同业"),
    (r"别家的坑", "贬损同业：直接拉踩"),
    (r"为什么选我们", "对比营销：易被判拉踩，改为客观服务说明"),
    # 极限词
    (r"最(低|便宜|好|快|强)", "极限词：违反《广告法》"),
    (r"第一", "极限词：违反《广告法》"),
    (r"100\s*%", "极限词：「100%」不可验证"),
    (r"唯一", "极限词：违反《广告法》"),
    (r"绝对", "极限词：违反《广告法》"),
    # 虚假稀缺
    (r"仅剩", "虚假稀缺：需真实库存支撑"),
    (r"最后一天", "虚假紧迫：需真实活动支撑"),
]

# 合规披露短语：命中这些片段时，其内部的「官方」字样不算冒充
# （「非官方直营」是**否定式**披露，必须放行，否则合规文案反而被拦）
DISCLOSURE_OK = [
    r"非官方直营",
    r"非官方",
    r"非官方\s*API",
    r"不是官方",
]

WARN_RULES: list[tuple[str, str]] = [
    (r"非官方直营|非官方", "建议保留合规披露「非官方直营」", True),
    (r"不支持退换|不退不换", "建议写明「虚拟商品不支持退换」", True),
    (r"基础.{0,6}经验|零基础", "建议提示「需要基础使用经验」", True),
]


def compliance_check(text: str, where: str) -> tuple[list[str], list[str]]:
    """返回 (blocked, warnings)。

    先剔除「非官方直营」这类**否定式合规披露**，避免把合规文案误判成冒充官方。
    """
    # 把合规披露片段替换成等长占位，保持其余文本的匹配位置不变
    masked = text
    for pat in DISCLOSURE_OK:
        masked = re.sub(pat, lambda m: "\u3000" * len(m.group(0)), masked)

    blocked, warnings = [], []
    for pat, why in BLOCK_RULES:
        for m in re.finditer(pat, masked):
            blocked.append(f"[{where}] 命中「{m.group(0)}」→ {why}")
    for pat, why, required in WARN_RULES:
        if not re.search(pat, text):
            warnings.append(f"[{where}] {why}")
    return blocked, warnings


# ─────────────────────── 绘图工具 ───────────────────────

def font(bold: bool, size: int):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size, index=0)


def tw(d, t, f):
    return d.textbbox((0, 0), t, font=f)[2]


def ctext(d, cx, y, t, f, fill):
    d.text((cx - tw(d, t, f) / 2, y), t, font=f, fill=fill)


def fit(d, t, bold, size, maxw):
    while size > 12:
        f = font(bold, size)
        if tw(d, t, f) <= maxw:
            return f
        size -= 2
    return font(bold, 12)


def bg(accent):
    im = Image.new("RGB", (S, S), (10, 14, 26))
    d = ImageDraw.Draw(im)
    for y in range(S):
        t = y / S
        d.line([(0, y), (S, y)], fill=(int(10 + 9 * t), int(14 + 13 * t), int(26 + 22 * t)))
    glow = Image.new("RGB", (S, S), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse([S * 0.12, S * 0.01, S * 0.88, S * 0.52], fill=accent)
    glow = glow.filter(ImageFilter.GaussianBlur(150))
    im = Image.blend(im, glow, 0.26)
    d = ImageDraw.Draw(im)
    for x in range(0, S, 50):
        d.line([(x, 0), (x, S)], fill=(20, 27, 45))
    for y in range(0, S, 50):
        d.line([(0, y), (S, y)], fill=(20, 27, 45))
    return im


def pill(d, x, y, text, f, fill, fg, padx=22, pady=10):
    w = tw(d, text, f) + padx * 2
    h = f.size + pady * 2
    d.rounded_rectangle([x, y, x + w, y + h], radius=h // 2, fill=fill)
    d.text((x + padx, y + pady - 2), text, font=f, fill=fg)
    return w


def bullets(d, items, cx, y0, accent, gap=64):
    f = font(False, 34)
    for i, t in enumerate(items):
        y = y0 + i * gap
        r = 13
        bx = cx - 250
        d.ellipse([bx, y + 12, bx + r * 2, y + 12 + r * 2], fill=accent)
        d.line([(bx + 7, y + 19), (bx + 11, y + 24)], fill=(10, 14, 26), width=3)
        d.line([(bx + 11, y + 24), (bx + 19, y + 13)], fill=(10, 14, 26), width=3)
        d.text((bx + 44, y), t, font=f, fill=INK)


def save(im, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.convert("RGB").save(path, "JPEG", quality=92, optimize=True)
    return str(path)


# ─────────────────────── 三张主图 ───────────────────────

def poster_hook(kw, accent, out, discount, note):
    im = bg(accent)
    d = ImageDraw.Draw(im)
    pill(d, 60, 60, kw, font(True, 30), accent, (10, 14, 26))
    f = fit(d, discount, True, 128, 860)
    ctext(d, S / 2, 240, discount, f, accent)
    f = font(False, 34)
    ctext(d, S / 2, 400, "按官网价计费 · 用多少算多少", f, SUB)
    f = fit(d, "大模型 API 接口服务", True, 54, 880)
    ctext(d, S / 2, 490, "大模型 API 接口服务", f, INK)
    d.line([(200, 600), (800, 600)], fill=(46, 58, 86), width=2)
    bullets(d, ["一个 Key 调用多个模型", "额度长期有效，不用不扣", "余额与消耗明细可查"], S / 2, 660, accent)
    ctext(d, S / 2, 880, "第三方接口服务 · 非官方直营", font(False, 26), DIM)
    ctext(d, S / 2, 925, note, font(False, 26), DIM)
    return save(im, out)


def poster_spec(kw, accent, out, note):
    im = bg(accent)
    d = ImageDraw.Draw(im)
    f = fit(d, "服务说明", True, 76, 860)
    ctext(d, S / 2, 90, "服务说明", f, INK)
    ctext(d, S / 2, 190, "下单前请先阅读", font(False, 32), SUB)
    y = 290
    f = font(True, 36)
    for a, b in [("计费口径", "按官网价格折扣计费"), ("额度有效", "长期有效，不用不扣"),
                 ("用量可查", "余额与消耗明细可查"), ("接入方式", "OpenAI 兼容，改 base_url"),
                 ("适配工具", "Cursor / Cherry Studio 等")]:
        d.rounded_rectangle([70, y, S - 70, y + 104], radius=20, fill=CARD)
        d.rounded_rectangle([70, y, 76, y + 104], radius=3, fill=accent)
        d.text((110, y + 18), a, font=f, fill=accent)
        d.text((110, y + 60), b, font=font(False, 27), fill=SUB)
        y += 120
    ctext(d, S / 2, y + 14, note, font(True, 40), INK)
    ctext(d, S / 2, y + 76, "第三方接口服务 · 非官方直营", font(False, 26), DIM)
    return save(im, out)


def poster_models(kw, accent, out, models):
    im = bg(accent)
    d = ImageDraw.Draw(im)
    f = fit(d, "支持模型 & 接入方式", True, 68, 880)
    ctext(d, S / 2, 80, "支持模型 & 接入方式", f, INK)
    y = 200
    f = font(True, 34)
    rows = [models[i:i + 3] for i in range(0, len(models), 3)][:3]
    for row in rows:
        x = 70
        for t in row:
            w = tw(d, t, f) + 44
            d.rounded_rectangle([x, y, x + w, y + 66], radius=16, fill=CARD, outline=(44, 56, 84))
            d.text((x + 22, y + 15), t, font=f, fill=INK)
            x += w + 18
        y += 84
    d.line([(120, y + 20), (880, y + 20)], fill=(46, 58, 86), width=2)
    ctext(d, S / 2, y + 60, "OpenAI 兼容接口", font(True, 42), accent)
    ctext(d, S / 2, y + 125, "改一下 base_url 就能用", font(False, 32), SUB)
    ctext(d, S / 2, y + 195, "Cherry Studio · Cursor · Chatbox · Dify · n8n", font(False, 27), DIM)
    ctext(d, S / 2, y + 245, "第三方接口服务 · 非官方直营", font(False, 26), DIM)
    return save(im, out)


# ─────────────────────── 文案模板 ───────────────────────

def build_copy(kw, discount, models, price):
    title = f"{kw} 接口服务 {discount.replace(' ', '')} 按量付费"
    desc = f"""{kw} 接口服务｜{discount} · 按量付费

本商品为第三方 API 接口服务，非官方直营，请确认需求后再拍。

【计费说明】
· 按模型官网价格的折扣计费，输入与输出分别计算
· 额度长期有效，不用不扣
· 余额与消耗明细均可查询

【接入说明】
· OpenAI 兼容接口，改一下 base_url 即可接入
· 适配 Cherry Studio / Cursor / Chatbox / Dify / n8n 等常见客户端
· 可调用 {('、'.join(models[:6]))} 等

【购买须知】
· 需要具备基础的 API 配置经验，零基础用户请谨慎购买
· 虚拟商品，一经发出不支持退换，介意勿拍
· 接入遇到问题可留言咨询，在线期间会尽快回复"""
    return title, desc


ACCENTS = [(74, 140, 255), (140, 116, 255), (232, 138, 88), (64, 200, 170),
           (120, 130, 255), (90, 160, 255), (86, 200, 120), (255, 150, 90)]


def slugify(kw: str) -> str:
    s = re.sub(r"[^\w\u4e00-\u9fa5]+", "-", kw).strip("-").lower()
    return s or "listing"


def main():
    ap = argparse.ArgumentParser(description="闲鱼上架物料准备（含合规闸门）")
    ap.add_argument("--keyword", required=True, help="关键词，如 DeepSeek API")
    ap.add_argument("--discount", default="官网价 2 折起", help="折扣口径")
    ap.add_argument("--models", default="DeepSeek,Claude,GPT,Gemini,GLM,Kimi,Qwen,MiniMax",
                    help="支持模型，逗号分隔")
    ap.add_argument("--price", default="1", help="参考价")
    ap.add_argument("--out", default="", help="输出目录；留空=工作区下的 xianyu-out")
    ap.add_argument("--suffix", default="", help="目录后缀（工作流按轮次传 p1/p2，避免多轮互相覆盖）")
    ap.add_argument("--check-only", action="store_true", help="只跑合规闸门")
    args = ap.parse_args()

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    kw = args.keyword

    # 折扣口径本身也要过闸门（「官方2折」会被拦）
    # 软提醒只对「描述」生效 —— 标题/折扣口径本身不需要承载披露文案
    blocked, _ = compliance_check(args.discount, "折扣口径")
    title, desc = build_copy(kw, args.discount, models, args.price)
    b2, _ = compliance_check(title, "标题")
    b3, warnings = compliance_check(desc, "描述")
    blocked += b2 + b3

    print("=" * 70)
    print("合规闸门")
    print("=" * 70)
    if blocked:
        print(f"✗ 硬拦截 {len(blocked)} 项：")
        for b in blocked:
            print(f"   {b}")
    else:
        print("✓ 无硬拦截")
    if warnings:
        print(f"\n⚠ 软提醒 {len(warnings)} 项：")
        for w in warnings:
            print(f"   {w}")

    if blocked:
        # ★ 结构化输出拦截原因：让工作流/调用方能直接看到「为什么被拦」，
        #   而不是只收到一个通用的 skill_error。
        print(json.dumps({
            "ok": False,
            "failure_kind": "compliance_blocked",
            "keyword": kw,
            "blocked": blocked,
            "warnings": warnings,
            "message": "合规闸门拦截：文案含冒充官方/贬损同业/极限词，请修正后重跑。",
        }, ensure_ascii=False))
        sys.exit(1)
    if args.check_only:
        sys.exit(0)

    # ★ 输出目录解析：留空时落到**工作区**，绝不能落到技能自身目录。
    #   技能目录被写入产物会污染技能（后续扫描会把产物当技能资源）。
    if args.out:
        out_root = Path(args.out)
    else:
        workspace = os.environ.get("DSAGENT_WORKSPACE") or os.getcwd()
        out_root = Path(workspace) / "xianyu-out"
    slug = slugify(kw)
    # ★ 轮次后缀：工作流 batch 模式下关键词不变，slug 恒定 → 多轮会写同一目录互相覆盖。
    #   传 --suffix p1/p2/... 让每轮落到 slug-p1 / slug-p2，物料各自独立。
    if args.suffix:
        suffix = re.sub(r"[^\w\u4e00-\u9fa5-]+", "-", str(args.suffix)).strip("-")
        if suffix:
            slug = f"{slug}-{suffix}"
    base = out_root / slug
    accent = ACCENTS[abs(hash(kw)) % len(ACCENTS)]
    note = f"{args.discount} · 按量计费"
    imgs = [
        poster_hook(kw, accent, base / "01-官网价2折起.jpg", args.discount, note),
        poster_spec(kw, accent, base / "02-服务说明.jpg", note),
        poster_models(kw, accent, base / "03-支持模型.jpg", models),
    ]

    listing = {
        "keyword": kw,
        "title": title,
        "description": desc,
        "price": args.price,
        "suffix": str(args.suffix or ""),
        "images": imgs,
        "compliance": {"passed": not blocked, "blocked": blocked, "warnings": warnings},
        "note": "网页版选不到正确的服务类目，建议用闲鱼 APP 发布并选「软件/程序/网站开发」或「其他服务」",
    }
    (base / "listing.json").write_text(json.dumps(listing, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n" + "=" * 70)
    print("产出")
    print("=" * 70)
    for p in imgs:
        print(f"  ✓ {p}")
    print(f"  ✓ {base / 'listing.json'}")
    print(f"\n标题：{title}")
    print(f"\n提示：{listing['note']}")
    print(json.dumps({"ok": True, "keyword": kw, "dir": str(base), "images": imgs,
                      "compliance": listing["compliance"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
