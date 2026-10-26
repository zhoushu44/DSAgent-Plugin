# -*- coding: utf-8 -*-
"""拼多多上架图片自动规整（pdd-publish-http 技能内置）。

平台硬规则（实测被驳回后确认）：
  · 详情图：宽 480~1200px，高 ≤1500px，**逐张单图**。
  · 主图：1:1 正方形，建议 ≥800×800。
  · 规格预览图：1:1，≥480×480。
  · 单张 ≤3MB。

★ 详情图处理顺序（固定，不跳步）：
    ① 宽度统一到 750
       - 超宽（>750）→ 等比压缩到 750
       - 过窄（<750）→ 等比放大到 750
    ② 再看高度：高 > 1500 → **切分**（宽度始终 750，绝不缩窄）
    ③ 高 ≤ 1500 → 直接用

★ 为什么不「压缩高度」：
    750×1800 若按高度缩到 1500，宽度会跟着变成 625 —— 竖版图被压窄、比例失真。
    平台要的是**宽度保持 750**，超高的唯一正确解法是切分。

★ 切分用**均分**：n = ceil(高/1500)，每段高 ≈ 高/n。
    均分后每段高度接近，既没有碎片，切点也固定不漂移，
    上下段拼回去内容完全连贯（切片总高 == 原图高，不重叠不丢失）。

用法：
  python imgprep.py --job job.json --report report.json

job.json:
  {"main": ["a.jpg"], "detail": ["b.jpg"], "spec": ["c.jpg"], "maxBytes": 3145728}

report.json:
  {"main": [...], "detail": [...], "spec": [...], "actions": [{file, action, before, after}]}
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

DETAIL_W_MIN, DETAIL_W_MAX, DETAIL_H_MAX = 480, 1200, 1500
DETAIL_TARGET_W = 750      # 详情图统一宽度（拼多多详情页标准宽度）
MAIN_MIN = 800
SPEC_MIN = 480
MAX_BYTES_DEFAULT = 3 * 1024 * 1024


def log(msg: str) -> None:
    print(f"[imgprep] {msg}", flush=True)


def load(p: Path) -> Image.Image:
    return Image.open(p).convert("RGB")


def save_jpeg(im: Image.Image, p: Path, max_bytes: int) -> int:
    """按质量阶梯存，直到 ≤maxBytes。"""
    for q in (95, 92, 90, 88, 85, 82, 78, 74, 70, 65, 60, 55, 50):
        im.save(p, "JPEG", quality=q, optimize=True, progressive=True)
        if p.stat().st_size <= max_bytes:
            return q
    # 还不够小 → 降分辨率再压
    w, h = im.size
    while p.stat().st_size > max_bytes and max(w, h) > 480:
        w, h = int(w * 0.85), int(h * 0.85)
        im = im.resize((max(1, w), max(1, h)), Image.LANCZOS)
        im.save(p, "JPEG", quality=80, optimize=True, progressive=True)
    return 80


def quiet_cut_rows(im: Image.Image) -> np.ndarray:
    """每行的像素方差；方差低 = 该行平坦（安全切线）。"""
    a = np.asarray(im.convert("L"), dtype=np.float32)
    return a.var(axis=1)


def pick_cut(var: np.ndarray, target: int, lo: int, hi: int, search: int = 90) -> int:
    """在 target 附近 search 像素内，找方差最低的行作为切线。"""
    a = max(lo, target - search)
    b = min(hi, target + search)
    if b <= a:
        return max(lo, min(target, hi))
    idx = a + int(np.argmin(var[a:b]))
    return idx


def slice_long(im: Image.Image, out_dir: Path, stem: str, max_h: int) -> list[Path]:
    """把超长图切成多张，每张高 ≤max_h，宽度不变。

    ★ 核心：**均分切割**
      n = ceil(高 / max_h)，每段高 ≈ 高/n。
      这样每段高度接近、无碎片、切点固定不漂移，上下段内容完全连贯
      （切片总高 == 原图高，不重叠不丢失）。

    ★ 不在切点附近做大范围搜索来「消除碎片」——挪动切点会让相邻两段内容错位，
      拼回去时上下衔接不上。碎片的根源是不均分，均分之后自然没有碎片。

    仅在均分点附近很小范围（±12% 段高）内微调，避开切断文字/人脸，
    并强制每段 ≤max_h。
    """
    w, h = im.size
    if h <= max_h:
        seg = im
        p = out_dir / f"{stem}__s1.jpg"
        seg.save(p, "JPEG", quality=92, optimize=True, progressive=True)
        return [p]

    n = -(-h // max_h)                 # ceil：至少需要几张
    base = h / n                       # 每段基准高度
    var = quiet_cut_rows(im)
    win = max(1, int(base * 0.12))     # 微调窗口，够避开一行文字/一张脸

    cuts = [0]
    for i in range(1, n):
        target = round(i * base)
        lo = max(cuts[-1] + 200, target - win)
        hi = min(h - 200, target + win)
        if hi <= lo:
            c = target
        else:
            c = pick_cut(var, target, lo, hi)
        # 硬约束：本段不超 max_h；且剩余部分还能被 (n-i) 段装下
        c = min(c, cuts[-1] + max_h)
        c = max(c, h - max_h * (n - i))
        c = max(c, cuts[-1] + 200)
        cuts.append(c)
    cuts.append(h)

    out = []
    for i in range(len(cuts) - 1):
        y0, y1 = cuts[i], cuts[i + 1]
        if y1 - y0 < 8:
            continue
        seg = im.crop((0, y0, w, y1))
        p = out_dir / f"{stem}__s{i + 1}.jpg"
        seg.save(p, "JPEG", quality=92, optimize=True, progressive=True)
        out.append(p)
    return out


def cleanup_old_slices(out_dir: Path, stem: str) -> None:
    for p in out_dir.glob(f"{stem}__s*.jpg"):
        try:
            p.unlink()
        except OSError:
            pass


def fit_detail(p: Path, max_bytes: int, actions: list) -> list[Path]:
    """详情图处理顺序（固定）：

      ① 统一宽度到 DETAIL_TARGET_W(750)
         - 宽 > 750 → 等比压到 750（不裁切，保持构图）
         - 宽 < 750 → 等比放大到 750
         - 宽 = 750 → 不动
      ② 再看高度：高 > 1500 就**切分**（宽度始终 750，绝不缩窄）
      ③ 高 ≤ 1500 → 直接用

    ★ 不做「压缩高度」——高度超限一律切分，因为缩高会把 750 宽的竖版图
      压得更窄（750×1800 缩到 625×1500 就变形了），而平台要的是宽度保持。
    """
    im = load(p)
    w, h = im.size
    before = f"{w}x{h}"

    # ① 宽度统一到 750
    if w != DETAIL_TARGET_W:
        scale = DETAIL_TARGET_W / w
        im = im.resize((DETAIL_TARGET_W, max(1, round(h * scale))), Image.LANCZOS)
        w, h = im.size
        act = "压缩宽度至 750" if before.split("x")[0] != str(w) and scale < 1 else "放大宽度至 750"
        actions.append({"file": p.name, "action": act, "before": before,
                        "after": f"{w}x{h}"})
        before = f"{w}x{h}"

    # ② 高度超限 → 切分（宽度不变）
    if h > DETAIL_H_MAX:
        cleanup_old_slices(p.parent, p.stem)
        parts = slice_long(im, p.parent, p.stem, DETAIL_H_MAX)
        try:
            p.unlink()          # 原始整图移出上传目录
        except OSError:
            pass
        for q in parts:
            save_jpeg(load(q), q, max_bytes)
        heights = []
        widths = set()
        for q in parts:
            ww, hh = Image.open(q).size
            heights.append(hh)
            widths.add(ww)
        actions.append({"file": p.name,
                        "action": f"高度超限切分为 {len(parts)} 张（宽 {sorted(widths)[0]} 不变）",
                        "before": before,
                        "after": f"高 {'/'.join(map(str, heights))}"})
        return parts

    # ③ 合规
    save_jpeg(im, p, max_bytes)
    return [p]


def fit_square(p: Path, min_side: int, max_bytes: int, actions: list) -> Path:
    """主图/规格图：补白成 1:1，边长 ≥min_side（补白不裁切，避免切掉商品）。"""
    im = load(p)
    w, h = im.size
    before = f"{w}x{h}"
    side = max(w, h)
    if w != h:
        canvas = Image.new("RGB", (side, side), (255, 255, 255))
        canvas.paste(im, ((side - w) // 2, (side - h) // 2))
        im = canvas
    if side < min_side:
        im = im.resize((min_side, min_side), Image.LANCZOS)
        side = min_side
    save_jpeg(im, p, max_bytes)
    after = f"{im.size[0]}x{im.size[1]}"
    if before != after:
        actions.append({"file": p.name, "action": "规整为正方形", "before": before,
                        "after": after})
    return p


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    ap.add_argument("--report", required=True)
    args = ap.parse_args()

    job = json.loads(Path(args.job).read_text(encoding="utf-8"))
    max_bytes = int(job.get("maxBytes") or MAX_BYTES_DEFAULT)
    actions: list[dict] = []

    out = {"main": [], "detail": [], "spec": [], "actions": actions}

    for key, min_side in (("main", MAIN_MIN), ("spec", SPEC_MIN)):
        for s in job.get(key) or []:
            p = Path(s)
            if not p.exists():
                log(f"缺失，跳过：{p}")
                continue
            try:
                out[key].append(str(fit_square(p, min_side, max_bytes, actions)))
            except Exception as e:
                log(f"处理失败 {p.name}: {e}")
                out[key].append(str(p))

    for s in job.get("detail") or []:
        p = Path(s)
        if not p.exists():
            log(f"缺失，跳过：{p}")
            continue
        try:
            out["detail"] += [str(x) for x in fit_detail(p, max_bytes, actions)]
        except Exception as e:
            log(f"处理失败 {p.name}: {e}")
            out["detail"].append(str(p))

    Path(args.report).write_text(json.dumps(out, ensure_ascii=False, indent=2),
                                 encoding="utf-8")

    if actions:
        log(f"共修正 {len(actions)} 处：")
        for a in actions:
            log(f"  {a['file']}: {a['action']}  {a['before']} → {a['after']}")
    else:
        log("全部图片已合规，无需修正")
    log(f"详情图 {len(out['detail'])} 张 / 主图 {len(out['main'])} 张 / 规格图 {len(out['spec'])} 张")
    return 0


if __name__ == "__main__":
    sys.exit(main())
