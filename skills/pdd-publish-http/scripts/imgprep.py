# -*- coding: utf-8 -*-
"""拼多多上架图片自动规整（pdd-publish-http 技能内置）。

平台硬规则（实测被驳回后确认）：
  · 详情图：宽 480~1200px，高 ≤1500px，**逐张单图**。
  · 主图：1:1 正方形，建议 ≥800×800。
  · 规格预览图：1:1，≥480×480。
  · 单张 ≤3MB。

★ 重要前提：详情图就应该是**一张张独立单图按顺序传**，不要自己拼长图。
  本脚本的「切分」不是鼓励你拼长图，而是兜住外部来源（1688/供应商详情长图）：
  那种整张长图直接传必被驳回，切分成合规单图是最省事的处理。

处理策略（对应「太长裁切、太宽太大压缩」）：
  1. 超长（高 > 1500 且 高/宽 > 2） → 切分成多张单图，每张高 ≤1500
     （切线落在平坦行，避免切断文字/人脸）
  2. 偏长（高 > 1500 但比例 ≤2）     → 等比缩到高 1500
  3. 太宽（宽 > 1200）               → 等比缩小到宽 1200
  4. 过窄（宽 < 480）                → 放大到 480
  5. 太大（>3MB）                    → JPEG 质量阶梯压缩，必要时再降分辨率

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
    """把超长图切成多张，每张高 ≤max_h，切线优先落在平坦行。

    三条硬约束：
      ★ 每张高必须 ≤max_h（否则被平台驳回）
      ★ 搜索区间限定在 (start+min_h, start+max_h]，保证不超限
      ★ 不允许出现碎片：末段过矮就并入前一张，必要时整体减少张数均分
    """
    w, h = im.size
    var = quiet_cut_rows(im)
    min_h = max_h // 2          # 单张最低高度：低于此视为碎片
    frag_h = max_h // 4         # 低于此高度一定是碎片，必须并掉

    cuts = [0]
    while h - cuts[-1] > max_h:
        start = cuts[-1]
        c = pick_cut(var, start + max_h, start + min_h, start + max_h - 1)
        if c <= start + min_h:
            c = start + max_h
        cuts.append(c)
    cuts.append(h)

    # 末段过矮 → 并入前一张（若合并后超限，则前移切点重切）
    while len(cuts) > 2 and (cuts[-1] - cuts[-2]) < frag_h:
        tail = cuts[-1] - cuts[-2]
        merged = tail + (cuts[-2] - cuts[-3])
        if merged <= max_h:
            # 直接并掉最后一段
            cuts.pop(-2)
        else:
            # 前移切点，让末段变高
            new_cut = cuts[-1] - min_h
            if new_cut - cuts[-3] <= max_h and new_cut - cuts[-3] >= min_h:
                cuts[-2] = new_cut
            else:
                cuts.pop(-2)
        # 防死循环
        if len(cuts) <= 2:
            break

    # 若因合并导致某段超限，退化为等分（保证一定合规）
    if any(cuts[i + 1] - cuts[i] > max_h for i in range(len(cuts) - 1)):
        n = -(-h // max_h)                  # ceil
        step = h / n
        cuts = [round(i * step) for i in range(n)] + [h]
        # 等分后再检查碎片
        if len(cuts) > 2 and (cuts[-1] - cuts[-2]) < frag_h and (cuts[-1] - cuts[-3]) <= max_h:
            cuts.pop(-2)

    out = []
    for i in range(len(cuts) - 1):
        y0, y1 = cuts[i], cuts[i + 1]
        if y1 - y0 < 8:            # 空片直接跳过
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
    """详情图：太宽压缩、太高等比缩；外部来源的超长整图则切分成合规单图。"""
    im = load(p)
    w, h = im.size
    before = f"{w}x{h}"

    # 1) 宽超限 → 等比缩到 1200
    if w > DETAIL_W_MAX:
        scale = DETAIL_W_MAX / w
        im = im.resize((DETAIL_W_MAX, max(1, round(h * scale))), Image.LANCZOS)
        w, h = im.size
        actions.append({"file": p.name, "action": "压缩宽度", "before": before,
                        "after": f"{w}x{h}"})
        before = f"{w}x{h}"

    # 2) 宽不足 480 → 放大到 480（宁可放大也不留不合规）
    if w < DETAIL_W_MIN:
        scale = DETAIL_W_MIN / w
        im = im.resize((DETAIL_W_MIN, max(1, round(h * scale))), Image.LANCZOS)
        w, h = im.size
        actions.append({"file": p.name, "action": "放大宽度至下限", "before": before,
                        "after": f"{w}x{h}"})
        before = f"{w}x{h}"

    # 3) 超高 → 区分「外部超长整图」与「略微超高」
    if h > DETAIL_H_MAX:
        ratio = h / w
        # 阈值 3.0：750x1800（比例 2.4）这种只是「一张偏高单图」，
        # 缩到 1500 即可，不该被拆开丢掉构图；真正的详情长图比例通常在 3 以上。
        if ratio > 3.0:
            # 外部来源的超长整图（如 1688 供应商详情长图）：
            # 直接传必被驳回，切分成多张合规单图 —— 这不是鼓励拼长图，
            # 而是把别人给的长图拆成平台要的单图形态。
            cleanup_old_slices(p.parent, p.stem)
            parts = slice_long(im, p.parent, p.stem, DETAIL_H_MAX)
            try:
                p.unlink()          # 原长图移出上传目录
            except OSError:
                pass
            for q in parts:
                save_jpeg(load(q), q, max_bytes)
            actions.append({"file": p.name,
                            "action": f"外部超长整图拆分为 {len(parts)} 张单图",
                            "before": before,
                            "after": ", ".join(f"{x.name}" for x in parts)})
            return parts
        # 略超高 → 等比缩到 1500
        scale = DETAIL_H_MAX / h
        im = im.resize((max(1, round(w * scale)), DETAIL_H_MAX), Image.LANCZOS)
        actions.append({"file": p.name, "action": "压缩高度", "before": before,
                        "after": f"{im.size[0]}x{im.size[1]}"})

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
