#!/usr/bin/env python3
"""把本次巡店各数据层规范化为唯一证据包。"""
from _dsagent_gate import require_dsagent_runtime

require_dsagent_runtime()

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path


def load(path):
    text = Path(path).read_text(encoding="utf-8")
    starts = [i for i in (text.find("{"), text.find("[")) if i >= 0]
    if not starts:
        raise ValueError(f"{path}: 未找到 JSON")
    return json.loads(text[min(starts):])


def scalar(value):
    if isinstance(value, dict) and "value" in value:
        return value["value"]
    return value


def flatten_row(row):
    out = {}
    if not isinstance(row, dict):
        return out
    for key, value in row.get("data", {}).items():
        out[key] = scalar(value)
    for cell in row.get("cells", []):
        key = cell.get("key")
        if key:
            out[key] = scalar(cell.get("value", cell))
    for key, value in row.items():
        if key not in ("data", "cells") and not isinstance(value, (dict, list)):
            out.setdefault(key, scalar(value))
    return out


def rows_from(raw):
    rows = []
    if isinstance(raw, list):
        return [flatten_row(x) for x in raw]
    if not isinstance(raw, dict):
        return rows
    for table in raw.get("tables", []):
        view = table.get("output_view", "")
        for row in table.get("rows", []):
            item = flatten_row(row)
            item["_view"] = view
            rows.append(item)
    for key in ("rows", "list", "records"):
        if isinstance(raw.get(key), list):
            rows.extend(flatten_row(x) for x in raw[key])
    if isinstance(raw.get("series"), list):
        rows.extend(flatten_row(x) for x in raw["series"])
    if isinstance(raw.get("daily"), dict):
        for day, values in raw["daily"].items():
            item = flatten_row({"data": values, "day_key": day})
            item["_view"] = "daily_trend"
            rows.append(item)
    data = raw.get("data")
    if isinstance(data, dict):
        for key in ("rows", "list", "records"):
            if isinstance(data.get(key), list):
                rows.extend(flatten_row(x) for x in data[key])
        if isinstance(data.get("series"), list):
            rows.extend(flatten_row(x) for x in data["series"])
    return rows


def day_of(row):
    return next((str(row[k])[:10] for k in ("day_key", "stat_date", "date", "thedate") if row.get(k)), "")


def date_range(start, end):
    s = datetime.strptime(start, "%Y-%m-%d").date()
    e = datetime.strptime(end, "%Y-%m-%d").date()
    if s > e:
        raise ValueError("display-start 不能晚于 display-end")
    return [(s + timedelta(days=i)).isoformat() for i in range((e - s).days + 1)]


def declared_days(raw):
    if not isinstance(raw, dict):
        return []
    data = raw.get("data") if isinstance(raw.get("data"), dict) else {}
    start = next((raw.get(k, data.get(k)) for k in ("start_date", "date_from", "startDate") if raw.get(k, data.get(k))), "")
    end = next((raw.get(k, data.get(k)) for k in ("end_date", "date_to", "endDate") if raw.get(k, data.get(k))), "")
    try:
        return date_range(str(start)[:10], str(end)[:10]) if start and end else []
    except ValueError:
        return []


def source_meta(path, raw):
    data = raw.get("data") if isinstance(raw, dict) and isinstance(raw.get("data"), dict) else {}
    def pick(*keys):
        return next((raw.get(k, data.get(k)) for k in keys if raw.get(k, data.get(k)) not in (None, "")), None)
    return {
        "file": Path(path).name,
        "primary_category": pick("primary_category", "industry_name"),
        "secondary_category": pick("secondary_category"),
        "cate_name": pick("cate_name", "category_name"),
        "secondary_id": pick("secondary_id"),
        "cate_id": pick("cate_id", "category_id"),
        "view": pick("view", "output_view"),
        "start_date": pick("start_date", "date_from"),
        "end_date": pick("end_date", "date_to"),
        "latest_stat_date": pick("latest_stat_date"),
    }


def layer(name, files, expected_days):
    if not files:
        return {"name": name, "status": "not_queried", "sources": [], "actual_days": [], "missing_days": expected_days, "rows": []}
    rows, errors, sources, source_metadata, declared = [], [], [], [], set()
    for file in files:
        sources.append(Path(file).name)
        try:
            raw = load(file)
            source_metadata.append(source_meta(file, raw))
            declared.update(declared_days(raw))
            for row in rows_from(raw):
                row["_source"] = Path(file).name
                rows.append(row)
        except Exception as exc:
            errors.append(f"{Path(file).name}: {exc}")
    actual = sorted({day_of(r) for r in rows if day_of(r)})
    # 有逐日返回时，覆盖只能由实际日期证明；接口声明的查询范围不能冒充已返回日期。
    coverage_days = set(actual) if actual else declared
    covered = [d for d in expected_days if d in coverage_days]
    missing = [d for d in expected_days if d not in coverage_days]
    if errors and not rows:
        status = "failed"
    elif not rows:
        status = "empty"
    elif missing:
        status = "partial"
    else:
        status = "complete"
    return {"name": name, "status": status, "sources": sources, "source_metadata": source_metadata, "actual_days": actual, "declared_days": sorted(declared), "covered_days": covered, "missing_days": missing, "errors": errors, "rows": rows}


def expand(values):
    result = []
    for value in values or []:
        path = Path(value)
        result.extend(sorted(path.glob("*.json")) if path.is_dir() else [path])
    return [str(p) for p in result]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shop-name", required=True)
    ap.add_argument("--display-start", required=True)
    ap.add_argument("--display-end", required=True)
    ap.add_argument("--shop-raw", action="append", default=[])
    ap.add_argument("--item-raw", action="append", default=[])
    ap.add_argument("--promotion-raw", action="append", default=[])
    ap.add_argument("--refund-raw", action="append", default=[])
    ap.add_argument("--industry-raw", action="append", default=[])
    ap.add_argument("--category-map", default="")
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    formal_days = date_range(args.display_start, args.display_end)
    baseline = (datetime.strptime(args.display_start, "%Y-%m-%d").date() - timedelta(days=1)).isoformat()
    query_days = [baseline] + formal_days
    layer_inputs = {
        "shop": expand(args.shop_raw), "item": expand(args.item_raw),
        "promotion": expand(args.promotion_raw), "refund": expand(args.refund_raw),
        "industry": expand(args.industry_raw),
    }
    layers = {name: layer(name, files, query_days if name in ("shop", "item") else formal_days) for name, files in layer_inputs.items()}
    for info in layers.values():
        covered = set(info.get("covered_days", []))
        info["missing_formal_days"] = [d for d in formal_days if d not in covered]
        info["baseline_available"] = baseline in covered
    category_mapping = load(args.category_map) if args.category_map else {}
    warnings = []
    for name, info in layers.items():
        if info["status"] != "complete":
            warnings.append({"layer": name, "status": info["status"], "missing_formal_days": info.get("missing_formal_days", []), "baseline_available": info.get("baseline_available", False)})
    evidence = {
        "schema_version": "patrol-evidence/1.0",
        "run": {
            "shop_name": args.shop_name,
            "display_start": args.display_start, "display_end": args.display_end,
            "baseline_day": baseline, "formal_days": formal_days, "query_days": query_days,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        "layers": layers, "category_mapping": category_mapping, "warnings": warnings,
    }
    out = Path(args.output); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"evidence -> {out}")


if __name__ == "__main__":
    main()
