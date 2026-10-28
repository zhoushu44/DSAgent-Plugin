#!/usr/bin/env python3
"""
image-gen — NewAPI 生图/改图桥接层

供 image-prompt-guide 技能作为执行层调用（技能负责 prompt 与合规，本脚本负责出图落盘）。

用法:
  # 文生图
  python gen.py generate --prompt "..." --size 1024x1024 --out ./out

  # 图生图（参考图）
  python gen.py edit --prompt "..." --ref a.png --ref b.png --out ./out

  # 批量（JSON 计划：给平台套图 / PDP 逐屏用）
  python gen.py batch --plan plan.json --out ./out

  # 探测
  python gen.py probe
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

DEFAULT_BASE = os.environ.get("NEWAPI_BASE", "http://45.205.27.41:3001/v1")
DEFAULT_KEY = os.environ.get("NEWAPI_KEY", "")
DEFAULT_MODEL = os.environ.get("NEWAPI_IMAGE_MODEL", "gpt-image-2.5")

# 本机配置文件（key 不写进代码、不进仓库）
CONFIG_PATH = Path(os.environ.get(
    "IMAGEGEN_CONFIG",
    Path.home() / ".dsh" / "image-gen.local.json",
))


def _load_config() -> dict:
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


_CFG = _load_config()
DEFAULT_BASE = os.environ.get("NEWAPI_BASE") or _CFG.get("base") or DEFAULT_BASE
DEFAULT_KEY = os.environ.get("NEWAPI_KEY") or _CFG.get("key") or DEFAULT_KEY
DEFAULT_MODEL = os.environ.get("NEWAPI_IMAGE_MODEL") or _CFG.get("model") or DEFAULT_MODEL

# 不走系统代理：实测该网关直连可达，走 127.0.0.1:8888 反而拒绝
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

AREA_MIN = 655360
AREA_MAX = 8294400


# ---------------------------------------------------------------- 尺寸规范化
def normalize_size(size: str) -> str:
    """按 image-prompt-guide 规则裁到合法档：短边/长边均为 16 倍数，面积在允许区间。

    允许 'auto' 透传。非法输入抛错而不是静默兜底。
    """
    if not size or size == "auto":
        return "auto"
    try:
        w, h = (int(x) for x in size.lower().split("x"))
    except Exception:
        raise SystemExit(f"size 格式错误: {size}（应形如 1024x1024 或 auto）")
    if w <= 0 or h <= 0:
        raise SystemExit(f"size 必须为正: {size}")

    # 面积越界则等比缩放，再回到 16 的倍数
    area = w * h
    if area < AREA_MIN:
        f = (AREA_MIN / area) ** 0.5
        w, h = w * f, h * f
    elif area > AREA_MAX:
        f = (AREA_MAX / area) ** 0.5
        w, h = w * f, h * f
    w = max(16, int(round(w / 16)) * 16)
    h = max(16, int(round(h / 16)) * 16)
    return f"{w}x{h}"


# ---------------------------------------------------------------- HTTP
def _request(url, data=None, headers=None, method=None, timeout=600, heartbeat=True):
    """发请求并在等待期间持续输出心跳，避免宿主按 idle 超时判死。"""
    import threading
    stop = threading.Event()

    def _tick():
        n = 0
        while not stop.wait(8):
            n += 8
            _beat(f"等待网关响应 ... {n}s")

    t = None
    if heartbeat:
        t = threading.Thread(target=_tick, daemon=True)
        t.start()
    try:
        req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
        try:
            with _OPENER.open(req, timeout=timeout) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:800]
            raise SystemExit(f"HTTP {e.code} {url}\n{body}")
        except urllib.error.URLError as e:
            raise SystemExit(f"连接失败 {url}\n{e.reason}\n"
                             f"（若系统配了 http 代理，本脚本已绕过；检查网关是否可达）")
    finally:
        stop.set()
        if t:
            t.join(timeout=1)


def _json_post(base, path, key, payload, timeout=600):
    _beat(f"提交请求 {path} ...")
    return _request(
        base + path,
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
        timeout=timeout,
    )


def _beat(msg: str) -> None:
    """心跳到 stderr：宿主按「无输出」判超时，出图期间必须持续吐字。"""
    print(f"[image-gen] {msg}", file=sys.stderr, flush=True)


def _multipart(fields, files):
    """手搓 multipart/form-data（不依赖 requests）。"""
    boundary = "----imggen" + uuid.uuid4().hex
    out = []
    for k, v in fields.items():
        out.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    for k, path in files:
        p = Path(path)
        if not p.exists():
            raise SystemExit(f"参考图不存在: {path}")
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        out.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{p.name}\"\r\n"
            f"Content-Type: {ctype}\r\n\r\n".encode()
        )
        out.append(p.read_bytes())
        out.append(b"\r\n")
    out.append(f"--{boundary}--\r\n".encode())
    return b"".join(out), f"multipart/form-data; boundary={boundary}"


# ---------------------------------------------------------------- 下载
def download(url, dest: Path, timeout=300) -> Path:
    _beat(f"下载 {url[:70]}...")
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "image-gen/1.0"})
    with _OPENER.open(req, timeout=timeout) as r:
        dest.write_bytes(r.read())
    _beat(f"落盘 {dest.name} ({dest.stat().st_size} bytes)")
    return dest


def _suffix_for(data_url: str) -> str:
    """若无扩展名线索，按 magic 判 PNG，否则 jpg。"""
    return ".png"


def _detect_suffix(path: Path) -> Path:
    magic = path.read_bytes()[:8]
    suf = ".png" if magic.startswith(b"\x89PNG") else (".jpg" if magic[:2] == b"\xff\xd8" else ".bin")
    if path.suffix.lower() != suf:
        new = path.with_suffix(suf)
        path.replace(new)
        return new
    return path


def make_transparent(path: Path, tolerance: int = 26, feather: int = 2) -> dict:
    """把纯色（默认白）背景抠成 alpha。

    网关的 background=transparent 实测返回 RGB，alpha 被丢掉，所以本地补一步。
    只从画面**边缘连通**的区域开始泛洪，避免挖掉商品内部的同类白色（比如白杯子本体的高光）。
    """
    from PIL import Image, ImageFilter
    from collections import deque

    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()

    # 取四边像素的众数作为背景色估计
    edge = []
    for x in range(w):
        edge.append(px[x, 0]); edge.append(px[x, h - 1])
    for y in range(h):
        edge.append(px[0, y]); edge.append(px[w - 1, y])
    counts = {}
    for c in edge:
        counts[c] = counts.get(c, 0) + 1
    bg = max(counts.items(), key=lambda kv: kv[1])[0]

    def close(c):
        return (abs(c[0] - bg[0]) <= tolerance
                and abs(c[1] - bg[1]) <= tolerance
                and abs(c[2] - bg[2]) <= tolerance)

    # 从边界泛洪标记背景
    mask = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if close(px[x, y]) and not mask[y * w + x]:
                mask[y * w + x] = 1; q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if close(px[x, y]) and not mask[y * w + x]:
                mask[y * w + x] = 1; q.append((x, y))
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not mask[ny * w + nx] and close(px[nx, ny]):
                mask[ny * w + nx] = 1
                q.append((nx, ny))

    alpha = Image.frombytes("L", (w, h), bytes(255 if not m else 0 for m in mask))
    if feather:
        alpha = alpha.filter(ImageFilter.GaussianBlur(feather))
    out = im.convert("RGBA")
    out.putalpha(alpha)
    dest = path.with_name(path.stem + "-alpha.png")
    out.save(dest)

    transparent_px = sum(mask)
    return {
        "transparent": str(dest),
        "bg_color": bg,
        "transparent_ratio": round(transparent_px / (w * h), 4),
    }


# ---------------------------------------------------------------- 核心
def run_generate(prompt, size, n, out_dir, name, model, quality, background, base, key):
    payload = {"model": model, "prompt": prompt, "n": n, "size": normalize_size(size)}
    if quality:
        payload["quality"] = quality
    if background:
        payload["background"] = background
    resp = _json_post(base, "/images/generations", key, payload)
    return _save_all(resp, out_dir, name, prompt, want_alpha=(background == "transparent"))


def run_edit(prompt, refs, size, n, out_dir, name, model, quality, background, base, key):
    fields = {"model": model, "prompt": prompt, "n": str(n)}
    if size and size != "auto":
        fields["size"] = normalize_size(size)
    if quality:
        fields["quality"] = quality
    if background:
        fields["background"] = background
    files = [("image[]" if len(refs) > 1 else "image", r) for r in refs]
    body, ctype = _multipart(fields, files)
    resp = _request(
        base + "/images/edits",
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": ctype},
        method="POST",
    )
    return _save_all(resp, out_dir, name, prompt, want_alpha=(background == "transparent"))


def _save_all(resp, out_dir, name, prompt, want_alpha=False):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    saved, alpha_info = [], []
    idx = 0
    for item in resp.get("data", []):
        idx += 1
        stem = f"{name or 'img'}-{stamp}-{idx}"
        if item.get("b64_json"):
            import base64
            dest = out_dir / f"{stem}.png"
            dest.write_bytes(base64.b64decode(item["b64_json"]))
        elif item.get("url"):
            dest = _detect_suffix(download(item["url"], out_dir / f"{stem}.raw"))
        else:
            raise SystemExit(f"响应既无 url 也无 b64_json: {list(item)}")
        saved.append(str(dest))
        if want_alpha:
            try:
                alpha_info.append(make_transparent(dest))
            except Exception as e:  # 抠图失败不该毁掉已出的图
                alpha_info.append({"error": str(e)})
    if not saved:
        raise SystemExit(f"未返回图片: {json.dumps(resp)[:500]}")
    out = {
        "ok": True,
        "files": saved,
        "count": len(saved),
        "usage": resp.get("usage", {}),
        "revised_prompt": resp.get("data", [{}])[0].get("revised_prompt"),
        "prompt": prompt,
    }
    if want_alpha:
        out["alpha"] = alpha_info
        out["alpha_files"] = [a.get("transparent") for a in alpha_info if a.get("transparent")]
    return out


def _run_one(it, i, total, out_dir, model, base, key):
    """跑单个 plan item（供线程池调用）"""
    prompt = it.get("prompt") or it.get("prompt_file")
    if it.get("prompt_file"):
        prompt = Path(it["prompt_file"]).read_text(encoding="utf-8").strip()
    if not prompt:
        return {"ok": False, "name": it.get("name"), "error": "缺 prompt"}
    size = it.get("size", "1024x1024")
    name = it.get("name") or it.get("out") or f"item{i}"
    refs = it.get("refs") or ([it["ref"]] if it.get("ref") else [])
    try:
        if refs:
            r = run_edit(prompt, refs, size, it.get("n", 1), out_dir, name,
                         it.get("model", model), it.get("quality"), it.get("background"), base, key)
        else:
            r = run_generate(prompt, size, it.get("n", 1), out_dir, name,
                             it.get("model", model), it.get("quality"), it.get("background"), base, key)
        r["name"] = name
        print(f"[{i}/{total}] {name} OK -> {r['files']}", file=sys.stderr)
        return r
    except SystemExit as e:
        print(f"[{i}/{total}] {name} FAIL: {e}", file=sys.stderr)
        return {"ok": False, "name": name, "error": str(e)}
    except Exception as e:  # 网络抖动等，不让整个 batch 挂
        print(f"[{i}/{total}] {name} FAIL: {e}", file=sys.stderr)
        return {"ok": False, "name": name, "error": str(e)}


def run_batch(plan_path, out_dir, model, base, key, workers=8):
    """★ 2026-10-28：线程池并发跑（原为串行，15 张要 8 分钟；并发后约 40 秒）"""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    plan = json.loads(Path(plan_path).read_text(encoding="utf-8"))
    items = plan if isinstance(plan, list) else plan.get("items", [])
    if not items:
        raise SystemExit("plan 为空：需要 [{\"name\":..,\"prompt\":..}]")
    total = len(items)
    results = [None] * total
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(_run_one, it, i + 1, total, out_dir, model, base, key): i
                for i, it in enumerate(items)}
        for fut in as_completed(futs):
            results[futs[fut]] = fut.result()
    return {"ok": all(r and r.get("ok") for r in results), "results": results}


def run_from_pack(pack_dir, out_dir, model, base, key, workers=8, category="儿童睡衣"):
    """★ 2026-10-28：从 1688 素材包直接出整套 15 张图（主图 5 + 详情 10）
    自动组装 prompt：双参考（商品原图 + 第1张原图当模特基准），锁款式锁人脸。
    """
    import glob as _glob
    pack = Path(pack_dir)
    prod_file = pack / "product.json"
    if not prod_file.exists():
        raise SystemExit(f"素材包缺 product.json：{prod_file}")
    product = json.loads(prod_file.read_text(encoding="utf-8"))
    srcs = sorted(str(p) for p in (pack / "src").glob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"))
    if not srcs:
        raise SystemExit(f"素材包 src/ 没有原图：{pack / 'src'}")
    ref_product = srcs[0]          # 商品原图（锁款式配色）
    ref_model = srcs[1] if len(srcs) > 1 else srcs[0]   # 模特基准（锁脸部发型）

    style = "插肩拼色长袖，圆领，左胸小方块笑脸刺绣"
    lock = f"严格保持参考图1中的款式与配色不变，{style}，严格保持参考图2中模特的脸部发型年龄不变，"

    items = []
    main_prompts = [
        f"{category}套装商品主图，{lock}纯白背景，左侧儿童模特全身展示蓝色套装穿搭效果，右侧竖排展示灰色粉色黄色三套同款小图，左下角圆形面料细节放大图，自然柔光，电商主图风格，高清细节，无文字无水印",
        f"{category}套装商品主图，{lock}纯白背景，儿童模特全身展示蓝色套装，右侧竖排三格细节图分别是领口罗纹特写，袖口走线，面料微距，自然柔光，电商主图风格，高清细节，无文字无水印",
        f"{category}商品主图，{lock}纯白背景，展示莫代尔面料微距特写，面料柔软细腻有光泽，纹理清晰，蓝色，自然柔光，电商主图风格，高清细节，无文字无水印",
        f"{category}商品主图，{lock}纯白背景，展示睡衣领口罗纹包边与袖口走线做工特写，针脚工整，蓝色，自然柔光，电商主图风格，高清细节，无文字无水印",
        f"{category}套装商品主图，{lock}纯白背景，展示四套同款不同配色家居服平铺排列，蓝色灰色粉色黄色，版型宽松，自然柔光，电商主图风格，高清细节，无文字无水印",
    ]
    for i, p in enumerate(main_prompts, 1):
        items.append({"out": f"main_{i}.jpg", "refs": [ref_product, ref_model], "prompt": p})

    grids = [
        ("750x1000", "儿童模特半身出镜，表情自然可爱，展示家居服上衣正面，左侧留白，竖排中文大字标题舒绒童睡衣，竖排副标题A类棉亲肤透气，底部小字2026NEWARRIVAL，浅灰纯色背景，电商详情页风格，高清摄影质感"),
        ("750x1000", "儿童模特全身出镜，姿势自然展示套装穿搭效果，左侧留白，竖排中文大字标题居家舒眠套装，竖排副标题亲肤棉暖护一觉，底部小字COMFORTSLEEPWEAR，浅灰纯色背景，电商详情页风格，高清摄影质感"),
        ("1000x1849", "竖版构图，左侧竖排大字柔软亲肤，竖排小字副题莫代尔棉垂感顺滑，中间儿童模特全身居中展示蓝色家居服套装，左下角嵌入一张面料细节缩略小图，底部英文卖点SOFTSKINFRIENDLY，浅色简洁背景，电商详情页风格高清"),
        ("1000x1849", "竖版构图，左侧竖排大字A类亲肤，竖排小字副题无荧光安心材质，中间儿童模特全身居中展示家居服套装，左下角嵌入一张缝线做工缩略小图，底部英文卖点SKINFRIENDLYGRADEA，浅色简洁背景，电商详情页风格高清"),
        ("1000x1849", "竖版构图，左侧竖排大字精致做工，竖排小字副题四针六线无骨缝制，中间展示家居服领口罗纹与袖口走线特写，左下角嵌入一张成衣平铺缩略小图，底部英文卖点FINECRAFTDETAIL，浅色简洁背景，电商详情页风格高清"),
        ("1000x1849", "竖版构图，左侧竖排大字宽松版型，竖排小字副题活动自如不束缚，中间儿童模特全身居中展示家居服活动姿态，左下角嵌入一张裤腰松紧带缩略小图，底部英文卖点LOOSEFITDESIGN，浅色简洁背景，电商详情页风格高清"),
        ("1000x1849", "竖版构图，左侧竖排大字多色可选，竖排小字副题清新配色每日好心情，中间展示四套同款不同配色家居服平铺排列蓝色灰色粉色黄色，左下角嵌入一张单套正面缩略小图，底部英文卖点MULTICOLORCHOICE，浅色简洁背景，电商详情页风格高清"),
        ("1000x1849", "竖版构图，左侧竖排大字尺码指南，竖排小字副题100110120130全码段，中间展示家居服平铺测量示意与尺码信息排版，左下角嵌入一张面料细节缩略小图，底部英文卖点SIZEGUIDEREFERENCE，浅色简洁背景，电商详情页风格高清"),
        ("1000x1849", "竖版构图，左侧竖排大字居家场景，竖排小字副题睡前玩耍一整套搞定，中间儿童模特在温馨居家卧室环境中展示家居服穿搭，左下角嵌入一张面料细节缩略小图，底部英文卖点HOMEDAILYWEAR，浅色简洁背景，电商详情页风格高清"),
        ("1000x1849", "竖版构图，左侧竖排大字洗护说明，竖排小字副题机洗不跑团久穿如新，中间展示折叠好的家居服平铺状态与洗护图标排版，左下角嵌入一张面料特写缩略小图，底部英文卖点EASYCAREWASHABLE，浅色简洁背景，电商详情页风格高清"),
    ]
    for i, (size, p) in enumerate(grids, 1):
        items.append({"out": f"detail_{i}.jpg", "refs": [ref_product, ref_model], "size": size,
                      "prompt": f"{category}详情屏，{lock}{p}"})

    # 写临时 plan 并复用 run_batch
    plan_path = Path(out_dir) / "_plan.json"
    plan_path.parent.mkdir(parents=True, exist_ok=True)
    plan_path.write_text(json.dumps({"items": items}, ensure_ascii=False), encoding="utf-8")
    print(f"[from-pack] {len(items)} 张计划已生成 -> {plan_path}", file=sys.stderr)
    return run_batch(str(plan_path), out_dir, model, base, key, workers=workers)


def run_probe(base, key, model):
    models = _request(base + "/models", headers={"Authorization": f"Bearer {key}"})["data"]
    ids = sorted(m["id"] for m in models)
    return {
        "ok": True,
        "base": base,
        "model_present": model in ids,
        "model": model,
        "image_models": [m for m in ids if "image" in m.lower()],
        "total_models": len(ids),
    }


# ---------------------------------------------------------------- CLI
def main(argv=None):
    ap = argparse.ArgumentParser(description="NewAPI 生图/改图桥接")
    # 同时兼容 `gen.py probe` 与 `gen.py --mode probe` 两种调用习惯
    ap.add_argument("mode_pos", nargs="?", choices=["generate", "edit", "batch", "probe", "from-pack"],
                    help="子命令（位置参数写法）")
    ap.add_argument("--mode", dest="mode_flag", choices=["generate", "edit", "batch", "probe", "from-pack"],
                    help="子命令（flag 写法，等价于位置参数）")
    ap.add_argument("--prompt", help="提示词")
    ap.add_argument("--prompt-file", help="从文件读提示词（长提示词用这个，免转义）")
    ap.add_argument("--ref", action="append", default=[], help="参考图本地路径，可多次")
    ap.add_argument("--plan", help="batch 模式的 JSON 计划文件")
    ap.add_argument("--size", default="1024x1024")
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--quality", choices=["low", "medium", "high", "auto"])
    ap.add_argument("--background", choices=["transparent", "opaque", "auto"])
    ap.add_argument("--out", default="./image-gen-out")
    ap.add_argument("--name", help="输出文件名前缀")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--key", default=DEFAULT_KEY)
    ap.add_argument("--workers", type=int, default=8, help="batch 并发线程数（默认 8）")
    ap.add_argument("--pack", help="from-pack 模式：1688 素材包目录（含 product.json + src/）")
    ap.add_argument("--category", default="儿童睡衣", help="from-pack 模式：品类名（用于 prompt）")
    a = ap.parse_args(argv)

    # harness 可能按 SKILL.md 首条用例补一个位置子命令（如 probe），
    # 因此显式 --mode 优先级更高，避免被注入值覆盖。
    mode = a.mode_flag or a.mode_pos
    if not mode:
        raise SystemExit("缺子命令：generate / edit / batch / probe")
    a.mode = mode

    if not a.key:
        raise SystemExit(f"缺 API key：设 NEWAPI_KEY、或写 {CONFIG_PATH}、或传 --key")

    prompt = a.prompt
    if a.prompt_file:
        prompt = Path(a.prompt_file).read_text(encoding="utf-8").strip()

    if a.mode == "probe":
        result = run_probe(a.base, a.key, a.model)
    elif a.mode == "generate":
        if not prompt:
            raise SystemExit("generate 需要 --prompt 或 --prompt-file")
        result = run_generate(prompt, a.size, a.n, a.out, a.name, a.model,
                              a.quality, a.background, a.base, a.key)
    elif a.mode == "edit":
        if not prompt or not a.ref:
            raise SystemExit("edit 需要 --prompt 和至少一个 --ref")
        result = run_edit(prompt, a.ref, a.size, a.n, a.out, a.name, a.model,
                          a.quality, a.background, a.base, a.key)
    elif a.mode == "from-pack":
        if not a.pack:
            raise SystemExit("from-pack 需要 --pack（1688 素材包目录）")
        result = run_from_pack(a.pack, a.out, a.model, a.base, a.key,
                               workers=a.workers, category=a.category)
    else:
        if not a.plan:
            raise SystemExit("batch 需要 --plan")
        result = run_batch(a.plan, a.out, a.model, a.base, a.key, workers=a.workers)

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
