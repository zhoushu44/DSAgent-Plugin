#!/usr/bin/env python3
"""拼多多多链接矩阵生成器。

一条链接 = 3 张主图（3:4 / 1:1 / 白底图）+ 8 屏详情页 + 长图。

设计约束（来自工作流引擎）：
  · 单次执行硬超时 5 分钟、60 秒无输出会被看门狗杀掉
    → batch 模式一轮只生成 1 条链接（约 100 秒，安全），并持续向 stderr 打心跳。
  · 非契约技能参数按 `--key value` 传入。

用法：
  python run.py --keywords "儿童睡衣" --count 5 --index 1 --pack <素材包目录>
  python run.py --keywords "儿童睡衣" --count 1 --index 1 --dry-run    # 不调 AI，只跑矩阵与合成
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import ssl
import sys
import time
import urllib.request
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ───────────────────────── 路径与常量 ─────────────────────────

BASE_DIR = Path(__file__).resolve().parent.parent      # 技能根目录
SKILL_ASSETS = BASE_DIR / "assets"
PACK: Path | None = None                                # --pack 指定的素材包


def assets_dir() -> Path:
    return PACK if PACK else SKILL_ASSETS


def src_dir() -> Path:
    return assets_dir() / "src"


def product() -> dict:
    return json.loads((assets_dir() / "product.json").read_text(encoding="utf-8"))


W = 750
CREAM = (250, 247, 242)
CARD = (255, 255, 255)
INK = (56, 50, 46)
SUB = (146, 136, 128)
LINE = (233, 226, 217)
ACCENT = {"银河蓝": (96, 132, 172), "迷雾紫": (134, 116, 164), "格蕾灰": (134, 130, 124),
          "星光粉": (208, 132, 150), "奶油黄": (188, 156, 98)}
DEFAULT_ACCENT = (176, 126, 86)

COLORS = ["银河蓝", "迷雾紫", "格蕾灰", "星光粉", "奶油黄"]
SCENES = ["奶油棚拍", "居家卧室", "客厅沙发", "窗边飘窗", "纯白棚拍", "客厅近景"]
SHOTS = ["全身正面", "半身特写", "坐姿", "侧身背影", "近景特写", "侧身"]
MODELS = ["男童", "女童", "大童", "无模特"]

SCENE_ENV = {
    "奶油棚拍": ("a seamless soft cream studio backdrop with a plain floor and a faint soft contact shadow",
                 "three-quarter view at eye level, medium shot"),
    "居家卧室": ("a calm bright bedroom corner with a plain cream wall, a simple bed edge and soft sheer curtains",
                 "three-quarter view at eye level, medium-close shot"),
    "客厅沙发": ("a calm bright living-room corner with a plain cream wall and a simple soft sofa",
                 "three-quarter view at eye level, medium shot"),
    "窗边飘窗": ("a bright window-side corner with soft sheer curtains and a simple cushion on a low bench",
                 "three-quarter view at eye level, medium shot"),
    "纯白棚拍": ("a seamless pure white studio backdrop with no props",
                 "straight-on at eye level, full-body shot"),
    "客厅近景": ("a calm bright living-room corner with a plain cream wall", "close-up at eye level"),
}

KW_POOL = [
    "儿童睡衣", "儿童家居服", "儿童睡衣男孩", "儿童睡衣女孩",
    "儿童睡衣男孩2026新款", "儿童睡衣女孩2026新款", "儿童加厚家居服", "儿童绒绒家居服",
    "儿童家居服套装", "青少年儿童家居服", "摇粒绒睡衣", "儿童摇粒绒睡衣",
    "男童摇粒绒睡衣", "儿童家居服男童", "可爱儿童家居服", "儿童秋冬家居服",
    "儿童加绒家居服", "中大童儿童家居服", "儿童家居服冬加厚", "儿童秋季家居服",
    "摇粒绒睡衣儿童", "儿童睡衣套装秋", "儿童睡衣秋冬", "儿童睡衣套装",
]

COPY_LIB = [
    ("秋冬摇粒绒", "家居服套装", ["奥粒绒面料", "抓绒保暖", "开衫好穿脱"]),
    ("家居服也能", "有型又好穿", ["翻领开衫", "双口袋", "撞色包边"]),
    ("男孩秋冬", "加厚抓绒睡衣", ["加厚抓绒", "宽松版型", "亲肤不扎"]),
    ("女孩加绒睡衣", "软糯不扎人", ["亲肤柔软", "撞色包边", "多尺码"]),
    ("当季新款", "摇粒绒家居服", ["新款上市", "抓绒保暖", "现货速发"]),
    ("温柔色调", "女童加绒睡衣", ["翻领开衫", "宽松剪裁", "抓绒保暖"]),
    ("加厚抓绒", "一套过秋冬", ["抓绒厚薄", "保暖不闷", "开衫好穿脱"]),
    ("绒绒手感", "面料细节", ["柔软处理", "亲肤不扎", "抓绒质感"]),
    ("开衫 + 长裤", "一套就够", ["成套搭配", "松紧腰头", "男女通用"]),
    ("大童也能穿", "多尺码可选", ["尺码齐全", "宽松不勒", "学生适用"]),
    ("保暖不臃肿", "居家好穿", ["抓绒厚薄", "轻盈不压身", "多色可选"]),
    ("一衣多穿", "家居服套装", ["开衫设计", "安全等级 B 类", "宽松版型"]),
]

STYLE_EN = ("soft cream-white world; gentle diffused daylight; low-saturation warm palette; "
            "premium, gentle, clean minimal mood")
TEXTURE_EN = ("Critical: preserve the fabric surface exactly as in the source photo - the garment is soft brushed "
              "fleece with a slightly plush matte surface. Do NOT render it as smooth cotton, jersey or satin.")
NOTEXT_EN = "Do not add any text, letters, logo, watermark, badge or graphic element."


def log(m):
    print(m, file=sys.stderr, flush=True)


def font(bold, size):
    name = "msyhbd.ttc" if bold else "msyh.ttc"
    for base in (r"C:\Windows\Fonts", "/usr/share/fonts", "/System/Library/Fonts"):
        for cand in (Path(base) / name, Path(base) / "PingFang.ttc"):
            if cand.exists():
                try:
                    return ImageFont.truetype(str(cand), size, index=0)
                except Exception:
                    continue
    return ImageFont.load_default()


def tw(d, t, f):
    return d.textbbox((0, 0), t, font=f)[2]


def center_text(d, cx, y, t, f, fill):
    d.text((cx - tw(d, t, f) / 2, y), t, font=f, fill=fill)


def vstack(*imgs):
    out = Image.new("RGB", (max(i.width for i in imgs), sum(i.height for i in imgs)), CREAM)
    y = 0
    for i in imgs:
        out.paste(i, (0, y)); y += i.height
    return out


def load(p, width=W):
    im = Image.open(p).convert("RGB")
    return im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)


def src_images():
    exts = ("*.jpg", "*.jpeg", "*.png", "*.webp")
    out = []
    for e in exts:
        out += sorted(src_dir().glob(e))
    return out


def cover(im, w, h):
    """等比缩放并居中裁剪到 w×h"""
    r = max(w / im.width, h / im.height)
    im2 = im.resize((max(1, round(im.width * r)), max(1, round(im.height * r))), Image.LANCZOS)
    x = (im2.width - w) // 2
    y = (im2.height - h) // 2
    return im2.crop((x, y, x + w, y + h))


# ───────────────────────── 生图 API ─────────────────────────

def _multipart(fields, file_field, filename, content):
    b = "----pdd" + uuid.uuid4().hex
    out = bytearray()
    for k, v in fields.items():
        out += f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    out += (f"--{b}\r\nContent-Disposition: form-data; name=\"{file_field}\"; "
            f"filename=\"{filename}\"\r\nContent-Type: image/jpeg\r\n\r\n").encode()
    out += content + b"\r\n" + f"--{b}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={b}"


def api_config(args):
    base = args.api_base or os.environ.get("IMG_API_BASE", "")
    key = args.api_key or os.environ.get("IMG_API_KEY", "")
    cfg = Path.home() / ".dsagent" / "pdd-matrix.json"
    if (not base or not key) and cfg.exists():
        try:
            j = json.loads(cfg.read_text(encoding="utf-8"))
            base = base or j.get("api_base", "")
            key = key or j.get("api_key", "")
        except Exception:
            pass
    return base.rstrip("/"), key


def gen_image(base, key, model, size, prompt, ref, out):
    body, ctype = _multipart({"model": model, "prompt": prompt, "size": size, "n": "1"},
                             "image", ref.name, ref.read_bytes())
    req = urllib.request.Request(f"{base}/images/edits", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": ctype})
    ctx = ssl.create_default_context()
    last = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180, context=ctx) as r:
                j = json.loads(r.read().decode("utf-8"))
            d = (j.get("data") or [{}])[0]
            out.parent.mkdir(parents=True, exist_ok=True)
            if d.get("b64_json"):
                out.write_bytes(base64.b64decode(d["b64_json"]))
            elif d.get("url"):
                with urllib.request.urlopen(d["url"], timeout=180, context=ctx) as r2:
                    out.write_bytes(r2.read())
            else:
                raise RuntimeError("响应里没有图片字段")
            return out.stat().st_size
        except Exception as e:
            last = e
            time.sleep(3)
    raise RuntimeError(f"生图失败: {last}")


# ───────────────────────── 链接矩阵 ─────────────────────────

def assignment(index, keywords, prod):
    i = index - 1
    # 用户给了关键词就循环用（不会跳到内置词池造成关键词错配）；没给才用内置池
    kw = keywords[i % len(keywords)] if keywords else KW_POOL[i % len(KW_POOL)]
    head, sub, tags = COPY_LIB[i % len(COPY_LIB)]
    cols = prod.get("colors") or []
    color = COLORS[i % len(COLORS)]
    if cols and color not in cols:
        color = cols[i % len(cols)]
    return {"index": index, "kw": kw, "color": color,
            "scene": SCENES[i % len(SCENES)], "shot": SHOTS[i % len(SHOTS)],
            "model": MODELS[i % len(MODELS)],
            "headline": head, "sub": sub, "tags": tags}


def accent_of(L):
    return ACCENT.get(L["color"], DEFAULT_ACCENT)


def make_ref(index, maxb=40000):
    imgs = src_images()
    if not imgs:
        raise RuntimeError(f"素材包里没有图片：{src_dir()}")
    im = Image.open(imgs[(index - 1) % len(imgs)]).convert("RGB")
    dest = (PACK or SKILL_ASSETS) / f".ref_{index:03d}.jpg"
    for maxside in (720, 640, 576, 512):
        w, h = im.size
        sc = maxside / max(w, h)
        im2 = im.resize((max(1, round(w * sc)), max(1, round(h * sc))), Image.LANCZOS) if sc < 1 else im
        for q in (62, 56, 50, 44, 38):
            im2.save(dest, quality=q, optimize=True)
            if dest.stat().st_size <= maxb:
                return dest
    return dest


def prompts_for(L):
    env, cam = SCENE_ENV[L["scene"]]
    subject = ("the product shown in the provided photo" if L["model"] == "无模特"
               else "the child model wearing the garment shown in the provided photo")
    keep = (f"the same {L['color']} garment, its fabric, its contrast piping, its collar, its button front and "
            f"its pockets")
    main = (
        f"Using the provided photo of {subject}, restage it as a vertical e-commerce main image.\n"
        f"Keep the garment exactly as in the source: {keep}. Keep the colour, fabric texture, proportions and the "
        f"number of pieces identical. Do not redesign anything.\n{TEXTURE_EN}\n"
        f"Composition: {cam}, the subject placed to the right, with clean empty space on the left for a short "
        f"headline. Clean bottom edge and a faint contact shadow.\nEnvironment: {env}.\n"
        f"Style: {STYLE_EN}.\n{NOTEXT_EN}\nOutput a vertical 2:3 image."
    )
    scene = (
        f"Using the provided photo of {subject}, restage it as a vertical lifestyle image.\n"
        f"Keep the garment exactly as in the source: {keep}. Keep colour, texture and proportions identical.\n"
        f"{TEXTURE_EN}\n"
        f"Composition: {cam}, the subject seated or standing to the right, with clean empty space in the lower "
        f"left. Clean bottom edge.\nEnvironment: {env}, uncluttered, no other products, no brand marks.\n"
        f"Style: {STYLE_EN}.\n{NOTEXT_EN}\nOutput a vertical 2:3 image."
    )
    return main, scene


# ───────────────────────── 版式 ─────────────────────────

def pill_row(d, items, accent, y):
    cx = 44
    for t in items:
        f = font(True, 26)
        wpx = tw(d, t, f) + 40
        d.rounded_rectangle([cx, y, cx + wpx, y + 44], radius=22, fill=CARD, outline=LINE)
        d.text((cx + 20, y + 8), t, font=f, fill=accent)
        cx += wpx + 16


def kw_badge(d, canvas, text, accent):
    f = font(True, 24)
    wpx = min(tw(d, text, f) + 38, W - 80)
    d.rounded_rectangle([34, 34, 34 + wpx, 76], radius=21, fill=accent)
    d.text((34 + 19, 42), text, font=f, fill=(255, 255, 255))


def blend_panel(canvas, box, radius=20, alpha=196):
    region = canvas.crop(box).convert("RGBA")
    ov = Image.new("RGBA", region.size, (255, 255, 255, 0))
    ImageDraw.Draw(ov).rounded_rectangle([0, 0, region.width - 1, region.height - 1],
                                         radius=radius, fill=(255, 255, 255, alpha))
    canvas.paste(Image.alpha_composite(region, ov).convert("RGB"), box[:2])


def sec(d, x, y, title, sub, accent):
    d.rectangle([x, y + 6, x + 6, y + 40], fill=accent)
    d.text((x + 20, y), title, font=font(True, 36), fill=INK)
    if sub:
        d.text((x + 20, y + 46), sub, font=font(False, 22), fill=SUB)


def main_34(L, base_path):
    acc = accent_of(L)
    base = load(base_path)
    th = round(W * 4 / 3)
    canvas = base.crop((0, max(0, (base.height - th) // 2 - 10), W, max(0, (base.height - th) // 2 - 10) + th)).copy() \
        if base.height > th else base.copy()
    blend_panel(canvas, (34, 150, 430, 500))
    d = ImageDraw.Draw(canvas)
    kw_badge(d, canvas, L["kw"], acc)
    x = 54
    d.text((x, 172), L["headline"], font=font(True, 50), fill=INK)
    d.text((x, 232), L["sub"], font=font(True, 50), fill=INK)
    d.rectangle([x, 306, x + 56, 312], fill=acc)
    for i, t in enumerate(L["tags"]):
        d.text((x, 336 + i * 36), t, font=font(False, 24), fill=SUB)
    pill_row(d, ["110–160cm", "多色可选", "现货"], acc, canvas.height - 120)
    return canvas


def main_11(L, base_path):
    acc = accent_of(L)
    S = 800
    canvas = Image.new("RGB", (S, S), CREAM)
    prod = load(base_path, 470)
    canvas.paste(prod, (S - prod.width - 26, (S - prod.height) // 2))
    d = ImageDraw.Draw(canvas)
    kw_badge(d, canvas, L["kw"], acc)
    d.text((46, 178), L["headline"], font=font(True, 46), fill=INK)
    d.text((46, 234), L["sub"], font=font(True, 46), fill=INK)
    d.rectangle([46, 304, 102, 310], fill=acc)
    for i, t in enumerate(L["tags"]):
        d.text((46, 334 + i * 36), t, font=font(False, 23), fill=SUB)
    pill_row(d, ["多色可选", "现货"], acc, 700)
    return canvas


def s1(L, base_path):
    acc = accent_of(L)
    canvas = load(base_path).copy()
    d = ImageDraw.Draw(canvas)
    kw_badge(d, canvas, L["kw"], acc)
    x = 54
    d.text((x, 210), L["headline"], font=font(True, 62), fill=INK)
    d.text((x, 282), L["sub"], font=font(True, 62), fill=INK)
    d.rectangle([x, 372, x + 64, 378], fill=acc)
    for i, t in enumerate(L["tags"]):
        d.text((x, 406 + i * 40), t, font=font(False, 26), fill=SUB)
    bar = Image.new("RGB", (W, 92), CREAM)
    pill_row(ImageDraw.Draw(bar), ["多色可选", "现货"], acc, 26)
    return vstack(canvas, bar)


def s2(L):
    """核心卖点：奶油底 + 商品图（真实素材）+ 三条卖点。无需 AI。"""
    acc = accent_of(L)
    canvas = Image.new("RGB", (W, 964), CREAM)
    d = ImageDraw.Draw(canvas)
    sec(d, 44, 42, "为什么选它", "看得见的用料", acc)
    imgs = src_images()
    if imgs:
        cover(Image.open(imgs[0]).convert("RGB"), 380, 480)
        canvas.paste(cover(Image.open(imgs[0]).convert("RGB"), 380, 480), (W - 380 - 44, 150))
        d.rounded_rectangle([W - 380 - 44, 150, W - 44, 630], radius=16, outline=LINE)
    bar = Image.new("RGB", (W, 214), CREAM)
    bd = ImageDraw.Draw(bar)
    cw = W // 3
    for i, t in enumerate(L["tags"][:3]):
        cx = cw * i + cw // 2
        bd.ellipse([cx - 6, 40, cx + 6, 52], fill=acc)
        center_text(bd, cx, 68, t, font(True, 28), INK)
        if i:
            bd.line([(cw * i, 36), (cw * i, 150)], fill=LINE, width=1)
    canvas.paste(bar, (0, 750))
    return canvas


def s3(L):
    """面料细节：真实素材微距裁切（不调 AI，避免编造纹理）+ 数据卡。"""
    acc = accent_of(L)
    imgs = src_images()
    canvas = Image.new("RGB", (W, 926), CREAM)
    if imgs:
        src = Image.open(imgs[min(1, len(imgs) - 1)]).convert("RGB")
        w, h = src.size
        box = (int(w * 0.2), int(h * 0.2), int(w * 0.8), int(h * 0.8))
        canvas.paste(cover(src.crop(box), W, 750), (0, 0))
    d = ImageDraw.Draw(canvas)
    d.rectangle([34, 42, 46, 82], fill=(255, 255, 255))
    d.text((56, 42), "面料细节", font=font(True, 36), fill=(255, 255, 255))
    bar = Image.new("RGB", (W, 176), CREAM)
    bd = ImageDraw.Draw(bar)
    bd.rounded_rectangle([36, 26, W - 36, 150], radius=16, fill=CARD, outline=LINE)
    prod = product()
    fab = next((v for k, v in prod.get("params", []) if k == "面料名称"), "")
    comp = next((v for k, v in prod.get("params", []) if k == "主面料成分"), "")
    thin = next((v for k, v in prod.get("params", []) if k == "厚薄"), "")
    bd.text((66, 52), f"{fab or '面料'} · 细节", font=font(True, 32), fill=INK)
    bd.text((66, 100), f"{comp}　厚薄：{thin}".strip("　"), font=font(False, 24), fill=SUB)
    return vstack(canvas, bar)


def s4(L):
    """颜色选择：真实商品图 + 平台回传色名（不臆造色卡）。"""
    acc = accent_of(L)
    prod = product()
    colors = prod.get("colors") or []
    H = 900 if colors else 750
    canvas = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(canvas)
    sec(d, 44, 42, "颜色可选", f"共 {len(colors)} 色" if colors else "", acc)
    imgs = src_images()
    if imgs:
        canvas.paste(cover(Image.open(imgs[0]).convert("RGB"), 420, 520), (44, 158))
        d.rounded_rectangle([44, 158, 464, 678], radius=16, outline=LINE)
    x = 500
    y = 170
    for c in colors[:6]:
        f = font(True, 24)
        d.ellipse([x, y + 8, x + 18, y + 26], fill=ACCENT.get(c, DEFAULT_ACCENT))
        d.text((x + 30, y), c, font=f, fill=INK)
        y += 52
    if not colors:
        d.text((44, 700), "平台未回传颜色字段，请以商品页为准。", font=font(False, 22), fill=SUB)
    return canvas


DETAIL_CROPS = [("翻领开衫", (95, 112, 316, 333)), ("双口袋", (296, 384, 460, 548)),
                ("撞色包边", (468, 476, 632, 640)), ("松紧腰头", (428, 128, 668, 368))]


def s5(L):
    """细节做工：真实素材四格裁切。"""
    acc = accent_of(L)
    cell, cap, top = (W - 50 - 20) // 2, 48, 128
    canvas = Image.new("RGB", (W, top + 2 * (cell + cap) + 56), CREAM)
    d = ImageDraw.Draw(canvas)
    sec(d, 44, 40, "细节做工", "看得见的做工", acc)
    imgs = src_images()
    if imgs:
        src = Image.open(imgs[0]).convert("RGB")
        w, h = src.size
        # 用图片四角区域代表不同细节（真实裁切，不编造）
        regions = [(0.05, 0.05, 0.45, 0.45), (0.55, 0.05, 0.95, 0.45),
                   (0.05, 0.55, 0.45, 0.95), (0.55, 0.55, 0.95, 0.95)]
        labels = ["领口", "门襟", "口袋", "包边"]
        for i, (rx0, ry0, rx1, ry1) in enumerate(regions):
            r, c = divmod(i, 2)
            x, y = 25 + c * (cell + 20), top + r * (cell + cap + 16)
            crop = src.crop((int(w * rx0), int(h * ry0), int(w * rx1), int(h * ry1)))
            canvas.paste(cover(crop, cell, cell), (x, y))
            d.rectangle([x, y, x + cell, y + cell], outline=LINE)
            d.text((x + 4, y + cell + 12), labels[i], font=font(True, 26), fill=INK)
    return canvas


def s6(L):
    """尺码：有结构化数据就画表，没有就只列尺码，绝不编造尺寸。"""
    acc = accent_of(L)
    prod = product()
    sc = prod.get("size_chart")
    sizes = prod.get("sizes") or []
    if sc and sc.get("rows"):
        cols, rows = sc["columns"], sc["rows"]
        top, row_h, head_h = 150, 74, 82
        H = top + head_h + row_h * len(rows) + 120
        canvas = Image.new("RGB", (W, H), CREAM)
        d = ImageDraw.Draw(canvas)
        sec(d, 44, 44, "尺码信息", sc.get("unit", ""), acc)
        x0, x1 = 40, W - 40
        cw = (x1 - x0) / len(cols)
        y = top
        d.rounded_rectangle([x0, y, x1, y + head_h], radius=12, fill=(72, 64, 58))
        for i, c in enumerate(cols):
            center_text(d, x0 + cw * i + cw / 2, y + 24, c, font(True, 26), (255, 255, 255))
        y += head_h
        for r, row in enumerate(rows):
            if r % 2:
                d.rectangle([x0, y, x1, y + row_h], fill=CARD)
            if r:
                d.line([(x0, y), (x1, y)], fill=LINE, width=1)
            for i, v in enumerate(row):
                center_text(d, x0 + cw * i + cw / 2, y + (row_h - 30) / 2, v, font(i == 0, 26),
                            INK if i == 0 else (72, 64, 58))
            y += row_h
        d.rectangle([x0, top, x1, y], outline=LINE)
        d.text((x0, y + 22), "数据为人工测量，允许 1–3cm 误差，请以实物为准。", font=font(False, 20), fill=SUB)
        return canvas

    H = 150 + 120 * max(1, (len(sizes) + 4) // 5) + 140
    canvas = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(canvas)
    sec(d, 44, 44, "尺码选择", "以下为平台回传的尺码", acc)
    x, y = 44, 170
    for s in sizes:
        f = font(True, 26)
        wpx = tw(d, s, f) + 44
        if x + wpx > W - 44:
            x, y = 44, y + 74
        d.rounded_rectangle([x, y, x + wpx, y + 56], radius=28, fill=CARD, outline=LINE)
        d.text((x + 22, y + 12), s, font=f, fill=INK)
        x += wpx + 14
    d.text((44, y + 96),
           "具体衣长/胸围等尺寸未由平台接口回传，页面不展示推测数值；如需请补录后重新生成。",
           font=font(False, 21), fill=SUB)
    return canvas


def s7(L, base_path):
    acc = accent_of(L)
    canvas = load(base_path).copy()
    d = ImageDraw.Draw(canvas)
    y = canvas.height - 300
    d.text((54, y), L["headline"], font=font(True, 56), fill=INK)
    d.text((54, y + 72), L["sub"], font=font(True, 56), fill=INK)
    d.rectangle([54, y + 156, 118, y + 162], fill=acc)
    d.text((54, y + 184), f'{L["tags"][0]} · {L["tags"][1]}', font=font(False, 26), fill=SUB)
    return canvas


def s8(L):
    acc = accent_of(L)
    params = (product().get("params") or [])[:16]
    row_h = 62
    canvas = Image.new("RGB", (W, 150 + row_h * max(1, len(params)) + 90), CREAM)
    d = ImageDraw.Draw(canvas)
    sec(d, 44, 44, "商品参数", "用料与规格一览", acc)
    y, x0, x1 = 150, 40, W - 40
    for i, kv in enumerate(params):
        k, v = kv[0], kv[1]
        if i % 2 == 0:
            d.rectangle([x0, y, x1, y + row_h], fill=CARD)
        d.text((x0 + 22, y + 17), str(k)[:10], font=font(False, 24), fill=SUB)
        d.text((x0 + 240, y + 15), str(v)[:22], font=font(True, 24), fill=INK)
        y += row_h
    d.rectangle([x0, 150, x1, y], outline=LINE)
    return canvas


# ───────────────────────── 单条链接 ─────────────────────────

def build_link(L, out_root, base, key, model, dry, work):
    d1 = out_root / f"link{L['index']:03d}"
    d1.mkdir(parents=True, exist_ok=True)
    main_p, scene_p = prompts_for(L)
    ref = make_ref(L["index"])
    main_base = work / f"base_{L['index']:03d}_main.png"
    scene_base = work / f"base_{L['index']:03d}_scene.png"

    if dry:
        Image.open(ref).convert("RGB").save(main_base)
        Image.open(ref).convert("RGB").save(scene_base)
        log("  [dry-run] 跳过生图，用参考图占位")
    else:
        if not main_base.exists():
            log("  生图 1/2 主图底图（约 40 秒）…")
            gen_image(base, key, model, "1024x1536", main_p, ref, main_base)
        log("  ✓ 主图底图就绪")
        if not scene_base.exists():
            log("  生图 2/2 场景底图（约 40 秒）…")
            gen_image(base, key, model, "1024x1536", scene_p, ref, scene_base)
        log("  ✓ 场景底图就绪")

    log("  合成主图 3 张…")
    main_34(L, main_base).save(d1 / "主图-3x4-750x1000.jpg", "JPEG", quality=93, optimize=True)
    main_11(L, main_base).save(d1 / "主图-1x1-800x800.jpg", "JPEG", quality=93, optimize=True)
    wb = assets_dir() / "shared" / "whitebg.jpg"
    if not wb.exists():
        wb = SKILL_ASSETS / "shared" / "whitebg.jpg"      # 素材包没带白底图时回退到技能自带
    if wb.exists():
        Image.open(wb).convert("RGB").resize((800, 800), Image.LANCZOS).save(
            d1 / "白底图-800x800.jpg", "JPEG", quality=93, optimize=True)

    log("  合成详情页 8 屏 + 长图…")
    screens = [("01-首屏", s1(L, main_base)), ("02-核心卖点", s2(L)), ("03-面料细节", s3(L)),
               ("04-颜色可选", s4(L)), ("05-细节做工", s5(L)), ("06-尺码信息", s6(L)),
               ("07-穿着场景", s7(L, scene_base)), ("08-商品参数", s8(L))]
    for name, im in screens:
        im.save(d1 / f"{name}.jpg", "JPEG", quality=92, optimize=True)
    long_img = vstack(*[im for _, im in screens])
    lp = d1 / "详情页-长图.jpg"
    long_img.save(lp, "JPEG", quality=90, optimize=True)
    return {"index": L["index"], "keyword": L["kw"], "color": L["color"], "scene": L["scene"],
            "shot": L["shot"], "model": L["model"], "dir": str(d1),
            "long_h": long_img.height, "long_mb": round(lp.stat().st_size / 1048576, 2),
            "screens_over_1500": [n for n, im in screens if im.height > 1500]}


def main():
    global PACK
    ap = argparse.ArgumentParser()
    ap.add_argument("--keywords", default="")
    ap.add_argument("--count", type=int, default=1)
    ap.add_argument("--index", type=int, default=0, help="0=生成全部；batch 模式传轮次")
    ap.add_argument("--pack", default="", help="素材包目录（ali1688-pick 产出）")
    ap.add_argument("--out", default="")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--api-base", default="")
    ap.add_argument("--api-key", default="")
    ap.add_argument("--model", default="gpt-image-2.5")
    args = ap.parse_args()

    if args.pack:
        PACK = Path(args.pack).resolve()
        if not (PACK / "product.json").exists():
            print(json.dumps({"ok": False, "failure_kind": "skill_error",
                              "message": f"素材包里没有 product.json：{PACK}"}, ensure_ascii=False))
            return 1

    kws = [k.strip() for k in re.split(r"[,，;；\n\r]+", args.keywords or "") if k.strip()] or KW_POOL
    out_root = Path(args.out) if args.out else (Path.cwd() / "pdd-matrix-output")
    work = out_root / ".work"
    work.mkdir(parents=True, exist_ok=True)

    base, key = api_config(args)
    if not args.dry_run and (not base or not key):
        print(json.dumps({"ok": False, "failure_kind": "skill_error",
                          "message": "未配置生图 API：请设环境变量 IMG_API_BASE / IMG_API_KEY，"
                                     "或写入 ~/.dsagent/pdd-matrix.json"}, ensure_ascii=False))
        return 1

    prod = product()
    log(f"款式：{prod.get('title', '')[:36]}｜{prod.get('company', '')}｜"
        f"SKU {prod.get('sku_count', 0)} · 色 {len(prod.get('colors') or [])} · 图 {len(src_images())}")
    if args.count > len(kws) and args.index == 0:
        log(f"  ⚠ 关键词 {len(kws)} 个 < 链接 {args.count} 条：关键词会循环复用，"
            f"同词多条链接会显著提高重复铺货风险，建议补齐关键词")

    targets = [args.index] if args.index > 0 else list(range(1, args.count + 1))
    results = []
    for t in targets:
        L = assignment(t, kws, prod)
        log(f"[{t}] {L['kw']} · {L['color']} · {L['scene']} · {L['shot']} · {L['model']}")
        try:
            r = build_link(L, out_root, base, key, args.model, args.dry_run, work)
            results.append(r)
            log(f"  ✓ {r['dir']}（长图 750x{r['long_h']}，{r['long_mb']}MB）")
        except Exception as e:
            log(f"  ✗ 失败：{e}")
            results.append({"index": t, "keyword": L["kw"], "error": str(e)})

    ok = [r for r in results if "error" not in r]
    print("__DSAGENT_RESULT__" + json.dumps({
        "ok": len(ok) == len(results), "link_count": len(ok), "out_dir": str(out_root),
        "links": ok, "errors": [r for r in results if "error" in r],
        "message": f"生成 {len(ok)}/{len(results)} 条链接 → {out_root}",
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print("__DSAGENT_RESULT__" + json.dumps({"ok": False, "failure_kind": "skill_error",
                                                "message": str(e)}, ensure_ascii=False))
        sys.exit(1)
