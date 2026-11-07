#!/usr/bin/env python3
"""
image-diagnose · L3 硬指标扫描

扫一张或一组图片的尺寸 / 体积 / 白底占比 / 文字对比度 / 商品形变线索。
输出 JSON，供诊断报告直接引用。

用法:
    python check_metrics.py <图片路径或目录> [--type main|sku|pdp] [--json out.json]

    # 单张
    python check_metrics.py ./p01.jpg --type main

    # 整目录（批量诊断）
    python check_metrics.py ./同行主图/主图 --type main

    # 结果存文件
    python check_metrics.py ./img --type main --json metrics.json

阈值来自 references/platform-thresholds.md。
没有来源的数值不会进否决项 —— 本脚本只报实测值，判定交给诊断者。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageStat
except ImportError:
    print("缺 Pillow：pip install pillow", file=sys.stderr)
    sys.exit(2)

# ---- 阈值（实测来源，见 references/platform-thresholds.md）----
# scene 型不查白底占比 —— 场景图查白底是误判
THRESHOLDS = {
    "main": {"long_edge": 750, "max_bytes": 3 * 1024 * 1024, "white_ratio": 0.85},
    "scene": {"long_edge": 750, "max_bytes": 3 * 1024 * 1024, "white_ratio": None},
    "sku":  {"long_edge": 600, "max_bytes": 2 * 1024 * 1024, "white_ratio": None},
    "pdp":  {"long_edge": 750, "max_bytes": 3 * 1024 * 1024, "white_ratio": None},
}

EXTS = {".jpg", ".jpeg", ".png", ".webp"}

# 搜索页缩略图采样特征 —— 命中说明这是平台渲染图，不是原图，
# 尺寸阈值对它无效（原图被压过），必须回去抓原图再诊断
THUMBNAIL_SIZES = {
    580: "淘宝/天猫搜索页缩略图（_580x580q90）",
    400: "淘宝搜索页缩略图（_400x400）",
    360: "搜索列表缩略图（_360x360）",
    240: "搜索列表缩略图（_240x240）",
    120: "缩略图（_120x120）",
    64:  "缩略图（_64x64）",
}


def _edge_white_ratio(im: Image.Image, tol: int = 10) -> float:
    """四边像素接近纯白的比例。用于判断'是不是白底图'，不判断白底是否合格。"""
    w, h = im.size
    px = im.convert("RGB").load()
    edge = []
    for x in range(w):
        edge.append(px[x, 0]); edge.append(px[x, h - 1])
    for y in range(h):
        edge.append(px[0, y]); edge.append(px[w - 1, y])
    if not edge:
        return 0.0
    near = sum(1 for r, g, b in edge if r >= 255 - tol and g >= 255 - tol and b >= 255 - tol)
    return round(near / len(edge), 4)


def _global_contrast(im: Image.Image) -> float:
    """灰度标准差，作为整体对比度的粗略指标。文字对比度需单独裁区域测。"""
    gray = im.convert("L")
    return round(ImageStat.Stat(gray).stddev[0], 2)


def _sharpness(im: Image.Image) -> float:
    """
    拉普拉斯方差近似（用 PIL 的 FIND_EDGES 滤波后取标准差）。
    低 = 模糊 / 过度压缩。经验参考：<50 偏软，>150 较锐。
    """
    gray = im.convert("L")
    edges = gray.filter(__import__("PIL.ImageFilter", fromlist=["FIND_EDGES"]).FIND_EDGES)
    return round(ImageStat.Stat(edges).stddev[0], 2)


def _aspect(im: Image.Image) -> str:
    w, h = im.size
    ratios = {
        "1:1": 1.0, "3:4": 0.75, "4:3": 4 / 3, "3:2": 1.5,
        "2:3": 2 / 3, "4:5": 0.8, "5:4": 1.25, "9:16": 9 / 16, "16:9": 16 / 9,
    }
    r = w / h
    best = min(ratios.items(), key=lambda kv: abs(kv[1] - r))
    dev = abs(best[1] - r) / r * 100
    label = best[0] if dev <= 10 else f"非标准({r:.3f})"
    return f"{label} (偏差 {dev:.1f}%)"


def check_one(path: Path, kind: str) -> dict:
    th = THRESHOLDS[kind]
    rec = {"file": str(path), "type": kind, "ok": True, "issues": []}

    try:
        size_bytes = path.stat().st_size
        im = Image.open(path)
        im.load()
    except Exception as e:
        rec.update(ok=False, error=f"无法读取: {e}")
        return rec

    w, h = im.size
    long_edge = max(w, h)

    rec["pixels"] = f"{w}x{h}"
    rec["long_edge"] = long_edge
    rec["aspect"] = _aspect(im)
    rec["bytes"] = size_bytes
    rec["kb"] = round(size_bytes / 1024, 1)
    rec["format"] = im.format
    rec["mode"] = im.mode
    rec["edge_white_ratio"] = _edge_white_ratio(im)
    rec["contrast_stddev"] = _global_contrast(im)
    rec["sharpness_approx"] = _sharpness(im)

    # ---- 采样图识别（优先于所有阈值判定）----
    # 搜索页抓下来的图是平台渲染的缩略图，原图被压过。
    # 对它跑尺寸阈值会误判成"不达标"，必须先识别出来。
    thumb = THUMBNAIL_SIZES.get(long_edge)
    if thumb:
        rec["ok"] = False
        rec["is_thumbnail"] = True
        rec["thumbnail_kind"] = thumb
        rec["issues"].append(
            f"疑似平台缩略图（{long_edge}px = {thumb}）。"
            f"尺寸/锐度阈值对采样图无效，不能据此判定原图质量，"
            f"请抓原图后重新诊断。")
        return rec

    rec["is_thumbnail"] = False

    # ---- 阈值比对 ----
    if long_edge < th["long_edge"]:
        rec["ok"] = False
        rec["issues"].append(f"长边 {long_edge} < {th['long_edge']}（实测阈值）")

    if size_bytes > th["max_bytes"]:
        rec["ok"] = False
        rec["issues"].append(f"体积 {rec['kb']}KB 超限 {th['max_bytes'] // 1024 // 1024}MB")

    if th["white_ratio"] is not None:
        if rec["edge_white_ratio"] < th["white_ratio"]:
            rec["ok"] = False
            rec["issues"].append(
                f"边缘白占比 {rec['edge_white_ratio']} < {th['white_ratio']}，非白底或背景不干净")

    if rec["sharpness_approx"] < 50:
        rec["issues"].append(f"锐度近似 {rec['sharpness_approx']} 偏低，可能模糊或过度压缩")

    if im.mode not in ("RGB", "RGBA", "L", "P"):
        rec["issues"].append(f"色彩模式 {im.mode} 非常见")

    # 形变检测只能由诊断者看图确认，脚本不给结论 —— 只提示比例是否标准
    if "非标准" in rec["aspect"]:
        rec["issues"].append("比例非标准档，检查是否有拉伸变形")

    return rec


def main():
    ap = argparse.ArgumentParser(description="L3 硬指标扫描")
    ap.add_argument("target", help="图片文件或目录")
    ap.add_argument("--type", choices=["main", "scene", "sku", "pdp"], default="main")
    ap.add_argument("--json", dest="json_out", help="结果输出 JSON 路径")
    ap.add_argument("--strict", action="store_true",
                    help="把采样图也计入失败（默认：采样图单独归类，不算质量失败）")
    a = ap.parse_args()

    t = Path(a.target)
    if not t.exists():
        print(f"不存在: {t}", file=sys.stderr)
        sys.exit(1)

    files = sorted(p for p in t.iterdir() if p.suffix.lower() in EXTS) if t.is_dir() else [t]
    if not files:
        print("未找到图片", file=sys.stderr)
        sys.exit(1)

    print(f"[image-diagnose] 扫描 {len(files)} 张，类型={a.type}", file=sys.stderr)
    records = []
    for i, p in enumerate(files, 1):
        r = check_one(p, a.type)
        records.append(r)
        if r.get("is_thumbnail"):
            flag = "THUMB"
        else:
            flag = "OK " if r["ok"] else "FAIL"
        print(f"[{i}/{len(files)}] {flag} {p.name}  {r.get('pixels','?')}  "
              f"{r.get('kb','?')}KB  白边{r.get('edge_white_ratio','?')}", file=sys.stderr)

    thumbs = [r for r in records if r.get("is_thumbnail")]
    bad = [r for r in records if not r["ok"] and not r.get("is_thumbnail")]
    scorable = len(records) - len(thumbs)

    print(f"\n[image-diagnose] 完成：", file=sys.stderr)
    print(f"  可判定原图      {scorable} 张", file=sys.stderr)
    print(f"  通过            {scorable - len(bad)} 张", file=sys.stderr)
    print(f"  不通过          {len(bad)} 张", file=sys.stderr)
    print(f"  采样图(不可判)  {len(thumbs)} 张 —— 需抓原图重跑", file=sys.stderr)
    if thumbs:
        kinds = sorted({r["thumbnail_kind"] for r in thumbs})
        for k in kinds:
            print(f"    · {k}", file=sys.stderr)

    out = {"count": len(records), "scorable": scorable,
           "failed": len(bad), "thumbnails": len(thumbs),
           "thresholds": THRESHOLDS[a.type], "records": records}

    if a.json_out:
        Path(a.json_out).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[image-diagnose] JSON -> {a.json_out}", file=sys.stderr)
    else:
        print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
