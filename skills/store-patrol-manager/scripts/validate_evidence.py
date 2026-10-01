#!/usr/bin/env python3
"""校验巡店证据和事实表，失败时返回非零状态。"""
from _dsagent_gate import require_dsagent_runtime

require_dsagent_runtime()

import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path


def previous_day(value):
    return (datetime.strptime(value, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--evidence", required=True)
    ap.add_argument("--facts", required=True)
    ap.add_argument("--output", default="")
    args = ap.parse_args()
    evidence = json.loads(Path(args.evidence).read_text(encoding="utf-8"))
    facts = json.loads(Path(args.facts).read_text(encoding="utf-8"))
    errors, warnings = [], []
    run = evidence.get("run", {})
    formal = set(run.get("formal_days", []))
    baseline = run.get("baseline_day")
    if not run.get("shop_name") or not formal:
        errors.append("缺少店铺或正式周期")
    if baseline in facts.get("tables", {}).get("shop_daily", {}):
        errors.append("店铺正式汇总混入基准日")
    summary = facts.get("summary", {})
    shop_daily = facts.get("tables", {}).get("shop_daily", {})
    if shop_daily and not summary.get("shop_period"):
        errors.append("店铺有每日事实，但缺少周期汇总")
    if shop_daily and summary.get("shop_period"):
        daily_pay = sum(float(row.get("payAmt") or 0) for row in shop_daily.values())
        period_pay = float(summary["shop_period"].get("pay_amount") or 0)
        if abs(daily_pay - period_pay) > 0.01:
            errors.append("店铺周期支付金额与每日事实合计不一致")
    for name, layer in evidence.get("layers", {}).items():
        if layer.get("status") != "complete":
            missing = ",".join(layer.get("missing_formal_days", [])) or "-"
            baseline_note = "，基准日未返回" if name in ("shop", "item") and not layer.get("baseline_available") else ""
            warnings.append(f"{name}: {layer.get('status')}，正式周期缺日 {missing}{baseline_note}")
    promo_rows = evidence.get("layers", {}).get("promotion", {}).get("rows", [])
    if promo_rows and not facts.get("tables", {}).get("promotion_channels"):
        warnings.append("推广有原始记录，但未识别出可汇总的渠道指标；需要核对字段映射")
    if facts.get("tables", {}).get("promotion_channels") and not summary.get("promotion_period"):
        errors.append("推广有渠道汇总，但缺少推广周期汇总")
    mapping = facts.get("category_mapping", {})
    status = mapping.get("match_assessment", {}).get("status") if isinstance(mapping, dict) else None
    if status in ("matched", "partial") and not mapping.get("category_map"):
        errors.append("行业被判定可比，但没有类目映射")
    if status in ("matched", "partial"):
        store_categories = {row.get("name") for row in facts.get("tables", {}).get("categories", [])}
        unknown = sorted(set(mapping.get("category_map", {})) - store_categories)
        if unknown:
            errors.append("类目映射包含本次商品数据中不存在的类目：" + "、".join(unknown))
        if evidence.get("layers", {}).get("industry", {}).get("status") in ("not_queried", "empty", "failed"):
            errors.append("行业被判定可比，但本次没有可用行业数据")
        if not facts.get("tables", {}).get("category_comparison"):
            errors.append("行业被判定可比，但没有生成店铺类目与行业类目的并排对比表")
        if not facts.get("tables", {}).get("category_industry_daily"):
            errors.append("行业被判定可比，但没有生成类目逐日关联表")
        comparisons = facts.get("tables", {}).get("category_comparison", [])
        if comparisons and comparisons[0].get("store_category") != "本店全部类目":
            errors.append("行业对比缺少本店全部类目与行业一级大盘的整体校准")
        daily_rows = facts.get("tables", {}).get("category_industry_daily", [])
        daily_index = {(r.get("store_category"), r.get("industry_category"), r.get("date")): r for r in daily_rows}
        for row in daily_rows:
            prev = daily_index.get((row.get("store_category"), row.get("industry_category"), previous_day(row["date"])))
            if row.get("store_growth") is not None and row.get("date") != min(formal) and (not prev or prev.get("store_pay_amount") in (None, 0)):
                errors.append(f"{row.get('store_category')} {row['date']} 的店铺环比不是严格日环比")
            if row.get("industry_growth") is not None and (not prev or prev.get("industry_gmv") in (None, 0)):
                errors.append(f"{row.get('industry_category')} {row['date']} 的行业环比不是严格日环比")
            if row.get("status") in ("同向", "背离") and (row.get("store_growth") is None or row.get("industry_growth") is None):
                errors.append(f"{row.get('store_category')} {row['date']} 缺少双方日环比却给出了方向判断")
    result = {"valid": not errors, "errors": errors, "warnings": warnings}
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        out = Path(args.output); out.parent.mkdir(parents=True, exist_ok=True); out.write_text(text, encoding="utf-8")
    print(text)
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    main()
