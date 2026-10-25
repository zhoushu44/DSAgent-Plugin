#!/usr/bin/env python3
"""1688 找品取数：按关键词搜索 → 产地/应季/口碑打分 → 选中款 → 抓详情页 → 生成素材包。

素材包结构（供 pdd-link-matrix --pack 使用）：
  <out>/packs/<offerId>/
    ├── product.json     标题/厂家/颜色/尺码/SKU/属性
    └── src/*.jpg        主图 + 详情页图（做参考图与裁切用）
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
GW_DIR = Path.home() / ".dsagent" / "gateway"
MTOP_HOST = "h5api.m.1688.com"
API_PATH = "/h5/mtop.relationrecommend.wirelessrecommend.recommend/2.0/"
APP_ID = "32517"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36")


def log(m):
    print(m, file=sys.stderr, flush=True)


# ───────── 网关发现（端口随机，写发现文件）─────────
def gateway_url() -> str:
    if not GW_DIR.exists():
        raise RuntimeError(f"未找到网关发现目录 {GW_DIR}（DSH 是否在运行？）")
    entries = []
    for f in sorted(GW_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
            if j.get("url"):
                entries.append(j)
        except Exception:
            continue
    for e in entries:
        try:
            with urllib.request.urlopen(f"{e['url']}/api/v1/health", timeout=3) as r:
                if r.status == 200:
                    return e["url"]
        except Exception:
            continue
    raise RuntimeError("未找到存活的 DSAgent 网关")


# ───────── 1688 搜索（经网关 mtop 调用）─────────
def gw_post(gw: str, body: dict, timeout=60):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(f"{gw}/api/v1/proxy", data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def search_1688(gw: str, query: str, page_size: int = 30, sort: str = "booked"):
    # 注意：不要传 verticalProductFlag="pcmarket"——实测该参数触发 Baxia 风控 hold 60s + RGV587_ERROR
    inner = {"keywords": query, "beginPage": 1, "pageSize": page_size, "method": "getOfferList",
             "searchScene": "pcOfferSearch", "charset": "GBK"}
    if sort:
        inner["sortType"] = sort
    body = {"kind": "mtop_jsonp", "platform": "alibaba",
            "url": f"https://{MTOP_HOST}{API_PATH}",
            "headers": {"Referer": "https://s.1688.com/", "Origin": "https://s.1688.com"},
            "data": {"appId": APP_ID, "params": json.dumps(inner, ensure_ascii=False)}}
    # ★ 2026-10-25 补风控：Baxia(RGV587) / 429 / 令牌过期 三类分开处理
    #   实测踩坑：verticalProductFlag="pcmarket" 触发 Baxia hold 60s + RGV587_ERROR
    last_ret = ""
    for attempt in range(4):
        resp = gw_post(gw, body)
        ret = ((resp.get("payload", {}).get("ret") or [""])[0]) or ""
        last_ret = ret
        # 令牌过期：轻症，等 1.5s 重试
        if re.search(r"TOKEN_EXOIRED|TOKEN_EMPTY", ret, re.I):
            time.sleep(1.5)
            continue
        # ★ Baxia 风控：重症，指数退避 15s/30s/60s，别硬刚
        if re.search(r"RGV587|Baxia|FAIL_SYS_TRAFFIC_LIMIT|访问被拦截", ret, re.I):
            wait = 15 * (2 ** attempt)
            print(f"[风控] 命中 Baxia（{ret[:60]}），退避 {wait}s...", file=sys.stderr)
            time.sleep(wait)
            continue
        # ★ 高频限流：退避 10s/20s/40s
        if re.search(r"SYSTEM_FLOW_CONTROL| Too many |频繁", ret, re.I):
            wait = 10 * (2 ** attempt)
            print(f"[限流] 高频（{ret[:60]}），退避 {wait}s...", file=sys.stderr)
            time.sleep(wait)
            continue
        break
    resp_ret = last_ret
    # 4 次全失败：明确报错，别静默返回空
    if re.search(r"RGV587|Baxia|FAIL_SYS_TRAFFIC_LIMIT|SYSTEM_FLOW_CONTROL", resp_ret, re.I):
        raise RuntimeError(
            f"1688 搜索被风控拦截（{resp_ret[:80]}）。\n"
            "处理：等 5~10 分钟再试；不要连续重试（会加重）。\n"
            "若持续如此，打开 s.1688.com 手动过一次验证再重试。"
        )
    items = (((resp.get("payload") or {}).get("data") or {}).get("data")
             or {}).get("OFFER", {}).get("items") or []
    if not items and resp_ret:
        print(f"[提示] 搜索无结果，ret={resp_ret[:80]}", file=sys.stderr)
    return items


# ───────── 打分选款 ─────────
TAG_RE = re.compile(r"<[^>]+>")
AW = ("加绒", "加厚", "珊瑚绒", "法兰绒", "摇粒绒", "雪粒绒", "雪呢绒", "德绒", "夹棉", "羊羔绒",
      "牛奶绒", "保暖", "秋冬", "冬季", "三层", "半边绒", "蓄热", "磨毛", "奥粒绒")
CAT_OK = ("睡衣", "家居服", "睡袍", "睡裤", "家居裤", "居家服", "空调服", "秋衣秋裤", "保暖内衣")
CAT_NO = ("夹克", "外套", "冲锋衣", "羽绒", "连衣裙", "阔腿裤", "工装", "潮牌", "袜", "毯")


def item_score(d, origin_keys):
    title = TAG_RE.sub("", str(d.get("title", "")))
    company = TAG_RE.sub("", str((d.get("shopAddition") or {}).get("text") or (d.get("shop") or {}).get("text") or ""))
    city = str(d.get("city", ""))
    province = str(d.get("province", ""))
    blob = company + city + province + title

    if any(k in title for k in CAT_NO) and not any(k in title for k in ("睡衣", "家居服", "睡裤")):
        return None
    if not any(k in title for k in CAT_OK):
        return None

    loc = [k for k in origin_keys if k in blob]

    s = 20 if loc else 0
    s += 30 if any(k in company for k in ("宜山", "苍南")) else (15 if loc else 0)
    s += sum(6 for k in AW if k in title)
    s += 10 if re.search(r"2026|新款|新品", title) else 0
    m = re.search(r"([\d.]+)\s*(万)?\s*\+?\s*件", str((d.get("afterPrice") or {}).get("text", "")))
    if m:
        n = float(m.group(1)) * (10000 if m.group(2) else 1)
        s += min(n / 100, 40)
    r = re.search(r"(\d+)%", str((d.get("afterTags") or {}).get("text", "")))
    if r:
        s += int(r.group(1)) * 0.25
    ys = (d.get("shopAddition") or {}).get("tradeService", {}).get("shopYear")
    s += min(int(ys), 12) if str(ys).isdigit() else 0
    if d.get("factoryInspection") == "true":
        s += 4
    if d.get("superFactory") == "true":
        s += 4
    return (round(s, 1), bool(loc))


def pick_best(items, origin_keys, max_price=None):
    """返回 (产地命中榜, 产地未命中榜)，各自按分降序。"""
    hit, miss = [], []
    for it in items:
        d = it.get("data") if isinstance(it.get("data"), dict) else it
        if not isinstance(d, dict):
            continue
        scored = item_score(d, origin_keys)
        if scored is None:
            continue
        sc, loc = scored
        price = (d.get("priceInfo") or {}).get("price")
        try:
            if max_price and price and float(price) > max_price:
                continue
        except ValueError:
            pass
        (hit if loc else miss).append((sc, d))
    hit.sort(key=lambda x: -x[0])
    miss.sort(key=lambda x: -x[0])
    return hit, miss


def search_multi(gw, kw, origin_terms, page_size=30):
    """产地注入检索：大词单独搜会被外地卖家占据，必须用「产地+品类」组合词。"""
    queries = [f"{o} {kw}" for o in origin_terms[:2]] + [kw]
    merged, seen = [], set()
    for qi, q in enumerate(queries):
        # ★ 2026-10-25 补节流：多词连搜最容易触发 Baxia。
        #   每个词之间至少 5s（首个不等待）。
        if qi > 0:
            time.sleep(5)
        try:
            items = search_1688(gw, q, page_size)
        except RuntimeError as e:
            # 风控类错误：直接中断整个多词检索，别把账号往火坑里推
            log(f"  搜索「{q}」被风控拦截，中止后续检索：{str(e).splitlines()[0]}")
            break
        except Exception as e:
            log(f"  搜索「{q}」失败：{e}")
            continue
        n = 0
        for it in items:
            d = it.get("data") or {}
            oid = str(d.get("offerId") or "")
            if oid and oid not in seen:
                seen.add(oid)
                merged.append(it)
                n += 1
        log(f"  搜索「{q}」→ 新增 {n} 条")
    return merged


# ───────── 详情页解析 ─────────
def build_product(ctx: dict) -> dict:
    data = ctx.get("result", {}).get("data", {})
    pt = data.get("productTitle", {}).get("fields", {})
    si = pt.get("shopInfo", {})
    gal = data.get("gallery", {}).get("fields", {})
    cpe = gal.get("CpvEnhance") or {}
    dec = cpe.get("decisionCpv") or []
    nor = cpe.get("normalCpv") or []

    def cpv(names):
        out = []
        for a in dec + nor:
            if a.get("name") in names:
                out += [str(v) for v in (a.get("values") or [])]
        return out

    skus, colors, sizes = [], [], []
    mp = data.get("mainPrice", {}).get("fields", {})
    raw = (((mp.get("finalPriceModel") or {}).get("tradeWithoutPromotion") or {}).get("skuMapOriginal")) or []
    import html as _h
    for s in raw:
        attrs = _h.unescape(str(s.get("specAttrs", ""))).split(">")
        c = attrs[0] if attrs else ""
        z = attrs[1] if len(attrs) > 1 else ""
        skus.append({"sku_id": s.get("skuId"), "color": c, "size": z,
                     "price": s.get("discountPrice") or s.get("price"),
                     "stock": s.get("canBookCount")})
        if c and c not in colors:
            colors.append(c)
        if z and z not in sizes:
            sizes.append(z)
    if not colors:
        colors = cpv(["颜色"])
    if not sizes:
        sizes = cpv(["适合身高", "尺码"])

    attrs = [{"name": a.get("name"), "value": "、".join(map(str, a.get("values") or [])),
              "group": "核心属性" if a in dec else "普通属性"} for a in dec + nor]
    prices = [float(s["price"]) for s in skus if s.get("price")]
    return {
        "offer_id": str(gal.get("offerId") or ""),
        "title": pt.get("title", ""),
        "company": si.get("companyName") or si.get("authCompanyName", ""),
        "unit": pt.get("unit", ""),
        "price_range": f"{min(prices):.2f} ~ {max(prices):.2f}" if prices else "",
        "colors": colors, "sizes": sizes, "sku_count": len(skus), "skus": skus,
        "attributes": attrs,
        "params": [[a["name"], a["value"]] for a in attrs],
        "size_chart": None,          # 1688 接口不回传结构化尺码表，不臆造
        "main_images": (gal.get("mainImage") or [])[:10],
        "detail_url": (data.get("description", {}).get("fields", {}) or {}).get("detailUrl", ""),
    }


def http_get(url: str, timeout=45) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA,
                                               "Referer": "https://detail.1688.com/"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def build_pack(ctx: dict, pack_dir: Path) -> dict:
    prod = build_product(ctx)
    src = pack_dir / "src"
    src.mkdir(parents=True, exist_ok=True)

    urls = list(prod["main_images"])
    if prod["detail_url"]:
        try:
            text = http_get(prod["detail_url"]).decode("utf-8", "ignore")
            for m in re.finditer(r'https?://[^\s"\'<>\\]+?\.(?:jpg|jpeg|png|webp)', text, re.I):
                u = m.group(0)
                if u not in urls:
                    urls.append(u)
        except Exception as e:
            log(f"  详情页图拉取失败（不影响主流程）：{e}")

    saved = 0
    for i, u in enumerate(urls[:24], 1):
        ext = ".png" if ".png" in u.lower() else (".webp" if ".webp" in u.lower() else ".jpg")
        try:
            (src / f"img_{i:02d}{ext}").write_bytes(http_get(u))
            saved += 1
        except Exception:
            pass
    prod["src_count"] = saved
    (pack_dir / "product.json").write_text(json.dumps(prod, ensure_ascii=False, indent=2), encoding="utf-8")
    return prod


# ───────── 主流程 ─────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keywords", required=True)
    ap.add_argument("--index", type=int, default=1, help="取关键词列表第几个（工作流传轮次）")
    ap.add_argument("--origin", default="宜山,苍南,温州,浙江")
    ap.add_argument("--max-price", type=float, default=0)
    ap.add_argument("--out", default="")
    ap.add_argument("--profile", default="")
    ap.add_argument("--skip-scrape", action="store_true", help="只找品不抓详情（调试用）")
    args = ap.parse_args()

    kws = [k.strip() for k in re.split(r"[,，;；\n\r]+", args.keywords) if k.strip()]
    if not kws:
        print(json.dumps({"ok": False, "failure_kind": "skill_error", "message": "关键词为空"}, ensure_ascii=False))
        return 1
    kw = kws[(args.index - 1) % len(kws)]
    out_root = Path(args.out) if args.out else Path.cwd() / "pdd-matrix-output"
    packs = out_root / "packs"
    packs.mkdir(parents=True, exist_ok=True)

    log(f"【找品】关键词「{kw}」 产地筛选 {args.origin}")
    gw = gateway_url()
    origin_terms = [k.strip() for k in args.origin.split(",") if k.strip()]
    items = search_multi(gw, kw, origin_terms)
    log(f"  合计召回 {len(items)} 条（去重后）")
    hit, miss = pick_best(items, origin_terms, args.max_price or None)
    if not hit and not miss:
        print(json.dumps({"ok": False, "failure_kind": "skill_error",
                          "message": f"关键词「{kw}」没有找到符合条件的睡衣/家居服（召回 {len(items)} 条）"},
                         ensure_ascii=False))
        return 1
    origin_matched = bool(hit)
    sc, best = (hit or miss)[0]
    if not origin_matched:
        log(f"  ⚠ 未命中指定产地，回退到综合最优款（产地筛选：{args.origin}）")
    offer_id = str(best.get("offerId"))
    title = TAG_RE.sub("", str(best.get("title", "")))
    company = TAG_RE.sub("", str((best.get("shopAddition") or {}).get("text") or ""))
    log(f"  选中 {offer_id}｜{title[:34]}…｜{company}｜评分 {sc}｜"
        f"产地命中 {len(hit)} 个 / 候选 {len(hit) + len(miss)} 个")

    if args.skip_scrape:
        print("__DSAGENT_RESULT__" + json.dumps({"ok": True, "offer_id": offer_id, "keyword": kw,
                                                 "score": sc, "candidates": len(hit) + len(miss), "origin_matched": origin_matched,
                                                 "pack_dir": ""}, ensure_ascii=False))
        return 0

    pack_dir = packs / offer_id
    pack_dir.mkdir(parents=True, exist_ok=True)
    log("【取数】打开 1688 详情页（可见浏览器窗口，约 30 秒）…")
    cmd = ["node", str(HERE / "scrape_offer.mjs"), offer_id, str(pack_dir)]
    if args.profile:
        cmd.append(args.profile)
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=180, encoding="utf-8", errors="ignore")
        info = json.loads((p.stdout or "{}").strip().splitlines()[-1]) if p.stdout.strip() else {}
    except Exception as e:
        info = {"ok": False, "message": str(e)}
    if not info.get("ok"):
        print(json.dumps({"ok": False, "failure_kind": info.get("failure_kind", "skill_error"),
                          "message": f"详情页取数失败：{info.get('message') or info.get('title') or '未知'}"},
                         ensure_ascii=False))
        return 1

    ctx = json.loads(Path(info["contextPath"]).read_text(encoding="utf-8"))
    log("【解析】提取 SKU / 属性 / 图片 …")
    prod = build_pack(ctx, pack_dir)
    log(f"  SKU {prod['sku_count']} 个 · 颜色 {len(prod['colors'])} · 尺码 {len(prod['sizes'])} · "
        f"属性 {len(prod['attributes'])} 条 · 图片 {prod['src_count']} 张")

    print("__DSAGENT_RESULT__" + json.dumps({
        "ok": True, "offer_id": offer_id, "keyword": kw, "score": sc,
        "title": prod["title"], "company": prod["company"],
        "colors": prod["colors"], "sizes": prod["sizes"], "sku_count": prod["sku_count"],
        "pack_dir": str(pack_dir), "src_count": prod["src_count"],
        "candidates": len(hit) + len(miss), "origin_matched": origin_matched,
        "message": f"选中 {offer_id}｜{prod['title'][:28]}｜素材包 {pack_dir}",
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print("__DSAGENT_RESULT__" + json.dumps({"ok": False, "failure_kind": "skill_error",
                                                 "message": str(e)}, ensure_ascii=False))
        sys.exit(1)
