#!/usr/bin/env python3
"""从 patrol_evidence.json 生成冻结的经营事实表，不生成业务结论。"""
from _dsagent_gate import require_dsagent_runtime

require_dsagent_runtime()

import argparse
import json
import re
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path


ALIASES = {
    "spend": ("spend", "cost", "charge", "adCost", "costAmt", "consume", "consumeAmt", "expendAmt"),
    "impressions": ("impressions", "impression", "impressionCnt", "adPv", "pv"),
    "clicks": ("clicks", "click", "clickCnt", "clickNum"),
    "orders": ("orders", "orderCnt", "payOrdCnt", "transactionCnt", "directPayOrdCnt", "alipayInshopNum"),
    "gmv": ("gmv", "payAmt", "transactionAmount", "directTransactionAmount", "alipayInshopAmt"),
    "direct_orders": ("direct_orders", "directPayOrdCnt", "alipayDirNum"),
    "direct_gmv": ("direct_gmv", "directTransactionAmount", "alipayDirAmt"),
    "cart": ("cart", "cartCnt", "cartByrCnt", "addCartCnt", "cartInshopNum"),
    "direct_cart": ("direct_cart", "cartDirNum"),
    "inquiry": ("inquiry", "inquiryCnt", "consultCnt", "wwNum"),
}


def number(row, names):
    for name in names:
        value = row.get(name)
        if value not in (None, "", "-"):
            try:
                return float(str(value).replace(",", "").replace("%", ""))
            except (TypeError, ValueError):
                pass
    return 0.0


def text(row, names, default=""):
    return next((str(row[n]) for n in names if row.get(n) not in (None, "")), default)


def day(row):
    return text(row, ("day_key", "stat_date", "date", "thedate"))[:10]


def previous_day(value):
    return (datetime.strptime(value, "%Y-%m-%d").date() - timedelta(days=1)).isoformat()


def metric_row(row):
    return {name: number(row, aliases) for name, aliases in ALIASES.items()}


def add(target, metrics):
    for key, value in metrics.items():
        target[key] += value


def ratio(numerator, denominator):
    return numerator / denominator if denominator else None


def change(current, previous):
    return (current - previous) / abs(previous) if previous not in (None, 0) and current is not None else None


def finish(name, values):
    values = dict(values)
    values["name"] = name
    values["roi"] = values["gmv"] / values["spend"] if values["spend"] else None
    values["ctr"] = values["clicks"] / values["impressions"] if values["impressions"] else None
    values["cvr"] = values["orders"] / values["clicks"] if values["clicks"] else None
    return values


def strategy(plan_name, row):
    explicit = text(row, ("bidMode", "bid_mode", "planType", "campaignType", "targetType"))
    if explicit:
        return {"type": explicit, "basis": "接口字段"}
    hit = re.search(r"ROI|控投产|动销", plan_name, re.I)
    return {"type": hit.group(0) if hit else "未识别", "basis": "标题推断" if hit else "信息不足"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--evidence", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()
    evidence = json.loads(Path(args.evidence).read_text(encoding="utf-8"))
    formal = set(evidence["run"]["formal_days"])

    shop_daily = {}
    for row in evidence["layers"]["shop"]["rows"]:
        if day(row) in formal and row.get("_view") == "daily_trend":
            shop_daily[day(row)] = {k: v for k, v in row.items() if not k.startswith("_")}

    ordered_shop_days = sorted(shop_daily)
    shop_rows = [shop_daily[d] for d in ordered_shop_days]
    shop_period = {
        "covered_days": ordered_shop_days,
        "pay_amount": sum(number(r, ("payAmt",)) for r in shop_rows),
        "net_payment_amount": sum(number(r, ("netPaymentAmount",)) for r in shop_rows),
        "visitors": sum(number(r, ("uv",)) for r in shop_rows),
        "page_views": sum(number(r, ("pv",)) for r in shop_rows),
        "buyers": sum(number(r, ("payByrCnt",)) for r in shop_rows),
        "orders": sum(number(r, ("payOrdCnt",)) for r in shop_rows),
        "paid_items": sum(number(r, ("payItmCnt",)) for r in shop_rows),
        "cart_buyers": sum(number(r, ("cartByrCnt",)) for r in shop_rows),
        "cart_items": sum(number(r, ("cartCnt", "cartItemCnt")) for r in shop_rows),
        "refund_amount": sum(number(r, ("payShopRfdAmt",)) for r in shop_rows),
    }
    shop_period["conversion_rate"] = ratio(shop_period["buyers"], shop_period["visitors"])
    shop_period["average_order_value"] = ratio(shop_period["pay_amount"], shop_period["orders"])
    shop_period["payment_refund_rate"] = ratio(shop_period["refund_amount"], shop_period["pay_amount"])
    shop_change = {}
    if len(shop_rows) >= 2:
        first, last = shop_rows[0], shop_rows[-1]
        first_orders, last_orders = number(first, ("payOrdCnt",)), number(last, ("payOrdCnt",))
        first_visitors, last_visitors = number(first, ("uv",)), number(last, ("uv",))
        first_buyers, last_buyers = number(first, ("payByrCnt",)), number(last, ("payByrCnt",))
        shop_change = {
            "first_day": ordered_shop_days[0], "last_day": ordered_shop_days[-1],
            "pay_amount": change(number(last, ("payAmt",)), number(first, ("payAmt",))),
            "visitors": change(last_visitors, first_visitors),
            "conversion_rate": change(ratio(last_buyers, last_visitors), ratio(first_buyers, first_visitors)),
            "average_order_value": change(ratio(number(last, ("payAmt",)), last_orders), ratio(number(first, ("payAmt",)), first_orders)),
        }

    cate = defaultdict(lambda: defaultdict(float))
    products = defaultdict(lambda: defaultdict(float))
    for row in evidence["layers"]["item"]["rows"]:
        if day(row) not in formal or row.get("_view") not in ("", "daily_trend"):
            continue
        name = text(row, ("cate_name", "cateName"), "未标注类目")
        item = text(row, ("item_title", "itemName", "item_name", "item_id", "itemId"), "未标注商品")
        values = {
            "pay_amount": number(row, ("payAmt",)), "visitors": number(row, ("itmUv", "uv")),
            "buyers": number(row, ("payByrCnt",)), "refund_amount": number(row, ("sucRefundAmt",)),
        }
        add(cate[name], values); add(products[item], values)

    channels = defaultdict(lambda: defaultdict(float))
    plans = defaultdict(lambda: defaultdict(float))
    plan_meta = {}
    promo_rows = evidence["layers"]["promotion"]["rows"]
    daily_sources = {row.get("_source") for row in promo_rows if row.get("_view") == "daily_trend"}
    selected_promo_rows = [row for row in promo_rows if row.get("_source") not in daily_sources or row.get("_view") == "daily_trend"]
    for row in selected_promo_rows:
        if day(row) and day(row) not in formal:
            continue
        values = metric_row(row)
        if not any(values.values()):
            continue
        channel = text(row, ("channelName", "channel_name", "sceneName", "scene1Name", "productName"), "未标注渠道")
        plan = text(row, ("planName", "campaignName", "campaign_name", "promotionName", "adgroupName", "title"), "未标注计划")
        add(channels[channel], values); add(plans[plan], values)
        plan_meta.setdefault(plan, {"channel": channel, "strategy": strategy(plan, row)})

    category_rows = []
    for name, values in cate.items():
        row = dict(values); row["name"] = name
        row["conversion_rate"] = row["buyers"] / row["visitors"] if row["visitors"] else None
        category_rows.append(row)
    category_rows.sort(key=lambda x: x["pay_amount"], reverse=True)
    product_rows = []
    for name, values in products.items():
        row = dict(values); row["name"] = name
        row["conversion_rate"] = row["buyers"] / row["visitors"] if row["visitors"] else None
        product_rows.append(row)
    product_rows.sort(key=lambda x: x["pay_amount"], reverse=True)
    item_pay_amount = sum(row["pay_amount"] for row in category_rows)
    for row in category_rows:
        row["share_of_item_pay"] = ratio(row["pay_amount"], item_pay_amount)
    for row in product_rows:
        row["share_of_item_pay"] = ratio(row["pay_amount"], item_pay_amount)

    category_daily = []
    item_rows = evidence["layers"]["item"]["rows"]
    item_actual_days = set(evidence["layers"]["item"].get("actual_days", []))
    for name in sorted(cate):
        for current_day in sorted(formal):
            if current_day not in item_actual_days:
                continue
            pay_amount = 0.0
            visitors = buyers = 0.0
            for row in item_rows:
                if day(row) == current_day and text(row, ("cate_name", "cateName"), "未标注类目") == name:
                    pay_amount += number(row, ("payAmt",)); visitors += number(row, ("itmUv", "uv")); buyers += number(row, ("payByrCnt",))
            prev_day = previous_day(current_day)
            prev_pay = None
            if prev_day in item_actual_days:
                prev_pay = sum(number(row, ("payAmt",)) for row in item_rows if day(row) == prev_day and text(row, ("cate_name", "cateName"), "未标注类目") == name)
            growth_status = "有效" if prev_pay not in (None, 0) else ("前日为0" if prev_pay == 0 else "前日缺失")
            category_daily.append({
                "name": name, "date": current_day, "pay_amount": pay_amount, "visitors": visitors, "buyers": buyers,
                "conversion_rate": buyers / visitors if visitors else None,
                "growth": change(pay_amount, prev_pay), "growth_status": growth_status,
            })

    channel_rows = sorted((finish(name, values) for name, values in channels.items()), key=lambda x: x["spend"], reverse=True)
    promotion_period = {
        key: sum(row[key] for row in channel_rows)
        for key in ("spend", "impressions", "clicks", "orders", "gmv", "direct_orders", "direct_gmv", "cart", "direct_cart", "inquiry")
    }
    promotion_period["roi"] = ratio(promotion_period["gmv"], promotion_period["spend"])
    promotion_period["ctr"] = ratio(promotion_period["clicks"], promotion_period["impressions"])
    promotion_period["cvr"] = ratio(promotion_period["orders"], promotion_period["clicks"])
    plan_rows = []
    for name, values in plans.items():
        row = finish(name, values); row.update(plan_meta[name])
        if row["gmv"] == 0 and len(formal) < 30:
            row["action_boundary"] = "短周期仅复核，不得直接暂停、砍掉或合并"
        plan_rows.append(row)
    plan_rows.sort(key=lambda x: x["spend"], reverse=True)

    industry_sources = []
    industry_layer = evidence["layers"].get("industry", {})
    for meta in industry_layer.get("source_metadata", []):
        source_rows = [r for r in industry_layer.get("rows", []) if r.get("_source") == meta.get("file") and day(r)]
        series = []
        previous = None
        previous_date = None
        for row in sorted(source_rows, key=day):
            metrics = {"gmv": number(row, ("gmv",)), "uv": number(row, ("uv",)), "iv": number(row, ("iv",)), "ctr": number(row, ("clickThroughRate", "ctr"))}
            duplicate = previous is not None and all(metrics[k] == previous[k] for k in metrics)
            current_date = day(row)
            consecutive = previous_date == previous_day(current_date) if previous_date else False
            valid = metrics["gmv"] > 0 and not duplicate
            previous_valid = previous is not None and previous["gmv"] > 0 and consecutive
            growth = change(metrics["gmv"], previous["gmv"]) if valid and previous_valid else None
            growth_status = "有效" if growth is not None else ("重复快照" if duplicate else ("前日缺失" if not consecutive else "零值不可比"))
            series.append({"date": current_date, **metrics, "duplicate_snapshot": duplicate, "valid": valid, "gmv_growth": growth, "growth_status": growth_status})
            previous = metrics; previous_date = current_date
        industry_sources.append({**meta, "series": series})

    source_by_cate = {str(s.get("cate_id")): s for s in industry_sources if s.get("cate_id")}
    primary_source = next((s for s in industry_sources if not s.get("secondary_category") and not s.get("cate_name") and s.get("series")), None)
    mapping = evidence.get("category_mapping", {}).get("category_map", {}) if isinstance(evidence.get("category_mapping"), dict) else {}
    category_comparison, category_industry_daily = [], []
    total_store_pay = sum(r["pay_amount"] for r in category_rows)
    daily_lookup = {(r["name"], r["date"]): r for r in category_daily}
    assessment_status = evidence.get("category_mapping", {}).get("match_assessment", {}).get("status")
    if primary_source and assessment_status in ("matched", "partial"):
        source_daily = {r["date"]: r for r in primary_source["series"]}
        store_total_daily = {
            d: sum(number(r, ("payAmt",)) for r in item_rows if day(r) == d)
            for d in sorted(item_actual_days)
        }
        common_valid = [d for d in sorted(formal) if store_total_daily.get(d) is not None and d in source_daily and source_daily[d]["valid"]]
        valid_growth = same_direction = 0
        for current_day in sorted(formal):
            store_amount = store_total_daily.get(current_day)
            ind = source_daily.get(current_day)
            status = "店铺或行业缺日"
            store_growth = change(store_amount, store_total_daily.get(previous_day(current_day)))
            industry_growth = ind.get("gmv_growth") if ind and ind.get("valid") else None
            if ind and ind.get("duplicate_snapshot"):
                status = "行业重复快照"
            elif ind and ind.get("gmv", 0) <= 0:
                status = "行业零值占位"
            elif store_amount is not None and ind and ind.get("valid"):
                if store_growth is None:
                    status = "店铺前日缺失或为0"
                elif industry_growth is None:
                    status = "行业" + ind.get("growth_status", "前日不可比")
                else:
                    same = (store_growth >= 0) == (industry_growth >= 0)
                    status = "同向" if same else "背离"
                    valid_growth += 1; same_direction += int(same)
            category_industry_daily.append({
                "store_category": "本店全部类目", "industry_category": primary_source.get("primary_category") or primary_source.get("cate_id"),
                "date": current_day, "store_pay_amount": store_amount, "industry_gmv": ind.get("gmv") if ind else None,
                "store_growth": store_growth, "industry_growth": industry_growth, "status": status,
            })
        category_comparison.append({
            "store_category": "本店全部类目", "industry_category": primary_source.get("primary_category") or primary_source.get("cate_id"),
            "match": assessment_status, "mapping_note": "本店完整经营类目与行业一级大盘做整体趋势校准，不计算市场份额",
            "store_period_pay": total_store_pay, "store_share": 1.0,
            "common_days": common_valid,
            "store_pay_common_days": sum(store_total_daily[d] for d in common_valid),
            "industry_gmv_common_days": sum(source_daily[d]["gmv"] for d in common_valid),
            "industry_share_of_primary": 1.0, "valid_growth_pairs": valid_growth, "same_direction_pairs": same_direction,
        })
    for store_name, target in mapping.items():
        target = target if isinstance(target, dict) else {"industry_cate_name": str(target)}
        source = source_by_cate.get(str(target.get("industry_cate_id", "")))
        if not source:
            continue
        source_daily = {r["date"]: r for r in source["series"]}
        primary_daily = {r["date"]: r for r in primary_source["series"]} if primary_source else {}
        common_valid = [d for d in sorted(formal) if (store_name, d) in daily_lookup and d in source_daily and source_daily[d]["valid"]]
        store_common = sum(daily_lookup[(store_name, d)]["pay_amount"] for d in common_valid)
        industry_common = sum(source_daily[d]["gmv"] for d in common_valid)
        primary_common = sum(primary_daily[d]["gmv"] for d in common_valid if d in primary_daily and primary_daily[d]["valid"])
        valid_growth = 0
        same_direction = 0
        for current_day in sorted(formal):
            shop = daily_lookup.get((store_name, current_day), {})
            ind = source_daily.get(current_day)
            status = "店铺或行业缺日"
            shop_growth = shop.get("growth")
            industry_growth = ind.get("gmv_growth") if ind and ind.get("valid") else None
            if ind and ind.get("duplicate_snapshot"):
                status = "行业重复快照"
            elif ind and ind.get("gmv", 0) <= 0:
                status = "行业零值占位"
            elif shop and ind and ind.get("valid"):
                if shop_growth is None:
                    status = "店铺" + shop.get("growth_status", "前日不可比")
                elif industry_growth is None:
                    status = "行业" + ind.get("growth_status", "前日不可比")
                else:
                    same = (shop_growth >= 0) == (industry_growth >= 0)
                    status = "同向" if same else "背离"
                    valid_growth += 1; same_direction += int(same)
            category_industry_daily.append({
                "store_category": store_name, "industry_category": target.get("industry_cate_name") or source.get("primary_category") or source.get("cate_id"),
                "date": current_day, "store_pay_amount": shop.get("pay_amount"), "industry_gmv": ind.get("gmv") if ind else None,
                "store_growth": shop_growth, "industry_growth": industry_growth, "status": status,
            })
        store_period = next((r for r in category_rows if r["name"] == store_name), {"pay_amount": 0})
        category_comparison.append({
            "store_category": store_name, "industry_category": target.get("industry_cate_name") or source.get("primary_category") or source.get("cate_id"),
            "match": target.get("match", "partial"), "mapping_note": target.get("note", ""),
            "store_period_pay": store_period["pay_amount"], "store_share": store_period["pay_amount"] / total_store_pay if total_store_pay else None,
            "common_days": common_valid, "store_pay_common_days": store_common, "industry_gmv_common_days": industry_common,
            "industry_share_of_primary": industry_common / primary_common if primary_common else None,
            "valid_growth_pairs": valid_growth, "same_direction_pairs": same_direction,
        })

    output = {
        "schema_version": "patrol-facts/1.0", "run": evidence["run"],
        "coverage": {name: {k: layer.get(k) for k in ("status", "actual_days", "covered_days", "missing_days", "missing_formal_days", "baseline_available", "errors")} for name, layer in evidence["layers"].items()},
        "summary": {
            "shop_period": shop_period,
            "shop_first_to_last_change": shop_change,
            "promotion_period": promotion_period,
            "item_period": {"pay_amount": item_pay_amount, "category_count": len(category_rows), "product_count": len(product_rows)},
            "shop_item_reconciliation": {
                "shop_pay_amount": shop_period["pay_amount"], "item_pay_amount": item_pay_amount,
                "difference": item_pay_amount - shop_period["pay_amount"],
                "difference_rate": ratio(item_pay_amount - shop_period["pay_amount"], shop_period["pay_amount"]),
            },
        },
        "tables": {"shop_daily": shop_daily, "categories": category_rows, "category_daily": category_daily, "products": product_rows, "promotion_channels": channel_rows, "promotion_plans": plan_rows, "industry_sources": industry_sources, "category_comparison": category_comparison, "category_industry_daily": category_industry_daily},
        "category_mapping": evidence.get("category_mapping", {}), "warnings": evidence.get("warnings", []),
        "aggregation_notes": {"promotion": "同一来源同时存在日趋势和周期汇总时，仅采用日趋势，避免重复累计", "industry": "行业重复快照和零值占位不进入趋势关系判断"},
    }
    out = Path(args.output); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"facts -> {out}")


if __name__ == "__main__":
    main()
