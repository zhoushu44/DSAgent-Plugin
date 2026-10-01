#!/usr/bin/env python3
"""把本次店铺和任意行业原始 JSON 规范化为诊断输入。

不要求固定行业文件名，不猜类目关系，不补值。每个行业文件按返回体实际
类目名称/ID、view 和数据结构记录到 industry_sources.json。
"""
import argparse
import json
from pathlib import Path


def load(path):
    text = Path(path).read_text(encoding="utf-8")
    starts = [i for i in (text.find("{"), text.find("[")) if i >= 0]
    if not starts:
        raise SystemExit(f"{path}: 未找到 JSON")
    return json.loads(text[min(starts):])


def value(v):
    return v.get("value") if isinstance(v, dict) and "value" in v else v


def dump(path, obj):
    Path(path).write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def series_of(raw):
    rows = raw.get("series") if isinstance(raw, dict) else None
    if rows is None and isinstance(raw, dict):
        rows = raw.get("data", {}).get("series") if isinstance(raw.get("data"), dict) else None
    out, seen = [], set()
    for row in rows or []:
        day = row.get("stat_date") or row.get("date") or row.get("day_key")
        if not day or day in seen:
            continue
        seen.add(day)
        out.append({
            "date": day,
            "gmv": row.get("gmv"),
            "uv": row.get("uv"),
            "iv": row.get("iv"),
            "ctr": row.get("clickThroughRate", row.get("ctr")),
            "trade_index": row.get("tradeIndex"),
        })
    return out


def source_meta(path, raw):
    body = raw if isinstance(raw, dict) else {}
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    pick = lambda *keys: next((body.get(k, data.get(k)) for k in keys if body.get(k, data.get(k)) not in (None, "")), None)
    return {
        "file": path.name,
        "view": pick("view", "output_view"),
        "industry_name": pick("industry_name", "cate_name", "category_name", "name"),
        "primary_id": pick("primary_id", "primary", "primary_cate_id"),
        "secondary_id": pick("secondary_id", "secondary", "secondary_cate_id"),
        "cate_id": pick("cate_id", "category_id"),
        "start_date": pick("start_date", "date_from"),
        "end_date": pick("end_date", "date_to"),
        "latest_stat_date": pick("latest_stat_date"),
        "series": series_of(body),
        "children": body.get("children", data.get("children", [])),
        "items": body.get("list", data.get("list", [])),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shop-raw", required=True, help="本次店铺 query_shop_metrics 原始 JSON")
    ap.add_argument("--industry-raw-dir", default="", help="本次行业原始 JSON 目录；可省略")
    ap.add_argument("--out-dir", required=True)
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    shop = load(args.shop_raw)
    period, daily = {}, {}
    for table in shop.get("tables", []):
        if table.get("output_view") == "period_summary" and table.get("rows"):
            period = {k: value(v) for k, v in table["rows"][0].get("data", {}).items()}
        elif table.get("output_view") == "daily_trend":
            for row in table.get("rows", []):
                day = row.get("day_key")
                if day and day not in daily:
                    daily[day] = {k: value(v) for k, v in row.get("data", {}).items()}
    if not daily:
        raise SystemExit("店铺原始结果未包含 daily_trend")
    dump(out_dir / "shop_overview_data.json", {"period": period, "daily": daily})

    sources = []
    if args.industry_raw_dir:
        raw_dir = Path(args.industry_raw_dir)
        if not raw_dir.is_dir():
            raise SystemExit(f"行业目录不存在：{raw_dir}")
        for path in sorted(raw_dir.glob("*.json")):
            sources.append(source_meta(path, load(path)))
    dump(out_dir / "industry_sources.json", {"sources": sources})
    print(f"prepared -> {out_dir} (industry sources: {len(sources)})")


if __name__ == "__main__":
    main()
