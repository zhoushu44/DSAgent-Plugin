#!/usr/bin/env python3
"""从 1688 素材包 + AI 图目录组装拼多多商品 JSON。

用法：
  python build_product.py --pack <素材包> --gen <AI图目录> --out product.json --category 儿童睡衣
"""
from __future__ import annotations
import argparse
import json
import re
import sys
from pathlib import Path


def norm_size(s: str) -> str:
    s = str(s or "").strip()
    m = re.match(r"^(\d+)码", s)
    if m:
        return m.group(1)
    m = re.match(r"^([SMLXL]+)\s*[【\[]?码?", s)
    if m:
        return m.group(1)
    m = re.search(r"(\d+)\s*cm", s, re.I)
    if m:
        return m.group(1)
    m = re.match(r"^(\d+)$", s)
    if m:
        return m.group(1)
    return s[:4]


def collect_gen(gen_dir: Path) -> dict[str, str]:
    """递归收集 main_N / detail_N（batch 是平铺文件，单张是子目录）"""
    out: dict[str, tuple[float, str]] = {}
    for p in gen_dir.rglob("*"):
        if not p.is_file():
            continue
        m = re.match(r"^(main_\d+|detail_\d+)\.(jpg|png|jpeg|webp)", p.name, re.I)
        if not m:
            continue
        base = m.group(1).lower()
        mt = p.stat().st_mtime
        if base not in out or mt > out[base][0]:
            out[base] = (mt, str(p))
    return {k: v[1] for k, v in sorted(out.items())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", required=True, help="ali1688-pick 素材包目录")
    ap.add_argument("--gen", required=True, help="AI 生图输出目录")
    ap.add_argument("--out", required=True, help="输出的 product.json 路径")
    ap.add_argument("--category", default="儿童睡衣")
    ap.add_argument("--price-factor", type=float, default=2.0)
    ap.add_argument("--max-colors", type=int, default=3)
    ap.add_argument("--max-sizes", type=int, default=3)
    a = ap.parse_args()

    pack = Path(a.pack)
    prod_file = pack / "product.json"
    if not prod_file.exists():
        raise SystemExit(f"素材包缺 product.json：{prod_file}")
    product = json.loads(prod_file.read_text(encoding="utf-8"))

    gen = collect_gen(Path(a.gen))
    if not gen:
        raise SystemExit(f"AI 图目录没有图：{a.gen}")
    gen_list = list(gen.values())
    main_imgs = [p for k, p in gen.items() if k.startswith("main_")][:5]
    detail_imgs = [p for k, p in gen.items() if k.startswith("detail_")][:10]
    thumb = main_imgs[0] if main_imgs else gen_list[0]

    raw_skus = [s for s in (product.get("skus") or []) if s and (s.get("color") or s.get("size"))]
    if not raw_skus:
        raise SystemExit("1688 素材包无 SKU")

    colors = []
    for s in raw_skus:
        c = str(s.get("color") or "").strip()
        if c and c not in colors:
            colors.append(c)
    sizes = []
    for s in raw_skus:
        sz = norm_size(s.get("size"))
        if sz and sz not in sizes:
            sizes.append(sz)

    final_colors = colors[: a.max_colors] if colors else ["图片色"]
    num_sizes = sorted([s for s in sizes if s.isdigit()], key=int)
    letter_sizes = [s for s in sizes if re.match(r"^[SMLXL]+$", s)]
    sorted_sizes = num_sizes if len(num_sizes) >= 3 else (letter_sizes if len(letter_sizes) >= 2 else sizes)
    final_sizes = sorted_sizes[: a.max_sizes]
    if not final_sizes:
        raise SystemExit("1688 素材包无尺码")

    rows = []
    for s in raw_skus:
        c = str(s.get("color") or "").strip() or final_colors[0]
        sz = norm_size(s.get("size"))
        if c not in final_colors or sz not in final_sizes:
            continue
        rows.append({"color": c, "size": sz, "price": str(s.get("price") or ""), "stock": str(s.get("stock") or "300")})
    if not rows:
        prices = [float(s["price"]) for s in raw_skus if s.get("price") and float(s["price"]) > 0]
        avg = sum(prices) / len(prices) if prices else 75.0
        for c in final_colors:
            for sz in final_sizes:
                rows.append({"color": c, "size": sz, "price": f"{avg:.2f}", "stock": "300"})

    prices = [float(s["price"]) for s in raw_skus if s.get("price") and float(s["price"]) > 0]
    avg = sum(prices) / len(prices) if prices else 75.0
    price = f"{int(avg * a.price_factor) + 0.9:.1f}"

    attributes = []
    for at in (product.get("attributes") or []):
        name = str(at.get("name") or "").strip()
        val = str(at.get("value") or "").strip()
        if not name or not val:
            continue
        if "、" in val and len(val) > 30:
            continue
        attributes.append({"name": name, "value": val[:20]})

    specs = [
        {"name": "颜色分类", "values": [{"value": c, "image": thumb} for c in final_colors]},
        {"name": "参考分类", "values": [{"value": s} for s in final_sizes]},
    ]
    # ★ 2026-10-29（用户指出）：SKU 预览图不能全用同一张。
    #   按「颜色 → 主图」建立映射：第 i 个颜色优先用第 i 张主图（main_1..5），
    #   不够时回落到 main_1。这样不同颜色 SKU 的预览图不同。
    color_thumb = {}
    for ci, c in enumerate(final_colors):
        color_thumb[c] = main_imgs[ci] if ci < len(main_imgs) else thumb
    skus = [
        {"specs": {"颜色分类": r["color"], "参考分类": r["size"]},
         "price": r["price"], "stock": r["stock"],
         "image": color_thumb.get(r["color"], thumb)}
        for r in rows
    ]
    # 规格值预览图也跟着按颜色分配
    specs[0]["values"] = [{"value": c, "image": color_thumb.get(c, thumb)} for c in final_colors]

    payload = {
        "title": str(product.get("title") or a.category)[:60],
        "images": main_imgs if main_imgs else gen_list[:5],
        "detailImages": detail_imgs if detail_imgs else gen_list[5:15],
        "category": a.category,
        "price": price,
        "stock": "300",
        "specs": specs,
        "skus": skus,
        "attributes": attributes,
    }
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"[build_product] 1688 均价 {avg:.2f} × {a.price_factor} → 拼单价 {price}")
    print(f"[build_product] 颜色{len(final_colors)} × 尺码{len(final_sizes)} = {len(skus)} SKU，属性 {len(attributes)} 条")
    print(f"[build_product] → {out}")


if __name__ == "__main__":
    main()
