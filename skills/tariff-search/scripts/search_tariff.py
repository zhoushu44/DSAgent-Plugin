#!/usr/bin/env python3
"""
关税与 HS 编码归类查询 — TurtleClassify（Accio 公开接口）

用法:
    python scripts/search_tariff.py --product "Wireless Headphones" --from CN --to US [--digit 10]
    python scripts/search_tariff.py --batch products.csv [--from CN] [--to US]

输入:
    CSV 需含一列商品名，列名可用 product_name / productName / productName(EN) / 商品名 / 标题。

输出:
    stdout 一行 __DSAGENT_RESULT__ 前缀 JSON（DSAgent 约定），进度与错误走 stderr。
    同时把明细写入 --out 指定的 CSV（默认 artifacts/tariff_<时间戳>.csv）。

无需 API Key。接口偶发返回 msgCode=-1（系统繁忙），脚本会自动重试。
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

API_URL = "https://www.accio.com/api/turtle/classify"
RESULT_PREFIX = "__DSAGENT_RESULT__"

# 商品名列的候选表头（大小写/中英兼容）
NAME_KEYS = (
    "product_name", "productname", "productName", "productName(EN)",
    "商品名", "商品名称", "标题", "title", "name",
)
FROM_KEYS = ("origin", "origin_country", "originCountryCode", "起运国", "原产国")
TO_KEYS = ("destination", "dest_country", "destinationCountryCode", "目的国", "目的国家")


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def pick(row: dict, keys) -> str:
    """从一行里按候选表头取值（忽略大小写与首尾空格）。"""
    lowered = {str(k).strip().lower(): v for k, v in row.items()}
    for k in keys:
        v = lowered.get(k.lower())
        if v not in (None, ""):
            return str(v).strip()
    return ""


def classify(product: str, origin: str, dest: str, digit: int | None = None,
             timeout: int = 60, retries: int = 3) -> dict:
    """调用一次归类接口，返回归一化结果；失败时返回 {'error': ...}。"""
    payload = {
        "source": "alibaba",
        "originCountryCode": origin,
        "destinationCountryCode": dest,
        "productName": product,
    }
    if digit:
        payload["digit"] = digit

    body = json.dumps(payload).encode("utf-8")
    last_err = ""

    for attempt in range(1, retries + 1):
        req = urllib.request.Request(
            API_URL,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                outer = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code}"
        except urllib.error.URLError as e:
            last_err = f"连接失败: {e.reason}"
        except Exception as e:  # noqa: BLE001
            last_err = f"{type(e).__name__}: {e}"
        else:
            # 外层 success=false 且 msgCode=-1 属于上游偶发系统繁忙 → 重试
            if not outer.get("success"):
                code = str(outer.get("msgCode") or outer.get("responseCode") or "")
                msg = outer.get("msgInfo") or outer.get("responseMsg") or "未知错误"
                last_err = f"{code}: {msg}"
                if code == "-1" and attempt < retries:
                    log(f"[重试] 上游系统繁忙（{msg}），{attempt}/{retries} …")
                    time.sleep(2 * attempt)
                    continue
                return {"productName": product, "error": last_err}

            data = outer.get("data")
            if isinstance(data, str):
                try:
                    data = json.loads(data)
                except json.JSONDecodeError as e:
                    return {"productName": product, "error": f"内层 JSON 解析失败: {e}"}
            if not isinstance(data, dict):
                return {"productName": product, "error": "响应缺少 data 字段"}

            inner = data.get("data") if isinstance(data.get("data"), dict) else data
            info = inner.get("hscodeInfo") or {}

            # 兼容两种形态：新接口 hscodeInfo.hscode / 旧接口 hscodeStr
            hs = info.get("hscode") or inner.get("hscodeStr") or ""
            desc = (
                info.get("descriptionEn")
                or info.get("description")
                or inner.get("hscodeDesc")
                or ""
            )
            return {
                "productName": product,
                "originCountryCode": origin,
                "destinationCountryCode": dest,
                "hsCode": hs,
                "hsCodeDescription": desc,
                "tariffRate": inner.get("tariffRate"),
                "tariffFormula": inner.get("tariffFormula"),
                "tariffCalculateType": inner.get("tariffCalculateType"),
                "rules": inner.get("tariffCalRuleDetailList") or [],
            }

    return {"productName": product, "error": last_err or "未知失败"}


def write_csv(rows: list[dict], path: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    cols = [
        "商品名称", "HS Code", "HS Description", "Tariff Rate (%)",
        "Tariff Formula", "Origin", "Destination", "Error",
    ]
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for r in rows:
            w.writerow([
                r.get("productName", ""),
                r.get("hsCode", ""),
                (r.get("hsCodeDescription") or "").replace("\n", " ")[:300],
                r.get("tariffRate", ""),
                r.get("tariffFormula", ""),
                r.get("originCountryCode", ""),
                r.get("destinationCountryCode", ""),
                r.get("error", ""),
            ])


def main() -> int:
    ap = argparse.ArgumentParser(description="关税与 HS 编码归类查询")
    ap.add_argument("--product", help="单个商品名称")
    ap.add_argument("--batch", help="批量：CSV 文件路径")
    ap.add_argument("--from", dest="origin", default="CN", help="原产国 ISO 代码（默认 CN）")
    ap.add_argument("--to", dest="dest", default="US", help="目的国 ISO 代码（默认 US）")
    ap.add_argument("--digit", type=int, choices=[8, 10], help="HS 编码位数（8 或 10）")
    ap.add_argument("--out", help="输出 CSV 路径")
    ap.add_argument("--retries", type=int, default=3, help="单条重试次数（默认 3）")
    args = ap.parse_args()

    if not args.product and not args.batch:
        log("用法: python scripts/search_tariff.py --product \"Wireless Headphones\" --from CN --to US")
        log("  或: python scripts/search_tariff.py --batch products.csv")
        return 2

    tasks: list[tuple[str, str, str]] = []
    if args.product:
        tasks.append((args.product, args.origin, args.dest))
    else:
        if not os.path.isfile(args.batch):
            log(f"[错误] 找不到文件: {args.batch}")
            return 2
        with open(args.batch, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                name = pick(row, NAME_KEYS)
                if not name:
                    continue
                tasks.append((
                    name,
                    pick(row, FROM_KEYS) or args.origin,
                    pick(row, TO_KEYS) or args.dest,
                ))
        if not tasks:
            log("[错误] CSV 中没有找到商品名列（可用表头：product_name / 商品名 / 标题 / title）")
            return 2

    tasks = tasks[:100]  # 接口上限 100 条
    log(f"[开始] 共 {len(tasks)} 个商品，{args.origin} → {args.dest}")

    rows: list[dict] = []
    for i, (name, org, dst) in enumerate(tasks, 1):
        log(f"[{i}/{len(tasks)}] {name}")
        rows.append(classify(name, org, dst, args.digit, retries=args.retries))
        if i < len(tasks):
            time.sleep(0.3)

    ok = [r for r in rows if not r.get("error")]
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = args.out or os.path.join("artifacts", f"tariff_{ts}.csv")
    write_csv(rows, out)

    log(f"[完成] 成功 {len(ok)}/{len(rows)}，明细已写入 {out}")

    # DSAgent 约定：stdout 输出一行结果 JSON
    print(RESULT_PREFIX + json.dumps({
        "status": "success" if ok else "error",
        "total": len(rows),
        "succeeded": len(ok),
        "failed": len(rows) - len(ok),
        "csv": os.path.abspath(out),
        "results": rows,
    }, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
