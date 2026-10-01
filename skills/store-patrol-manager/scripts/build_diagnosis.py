#!/usr/bin/env python3
"""生成不绑定店铺和行业的基础经营诊断 HTML。

行业输入与类目映射均可选。没有确认行业时只分析店铺，不做默认行业回退。
"""
import argparse
import json
import math
from datetime import datetime, timedelta
from html import escape
from pathlib import Path


def load(path, default=None):
    if not path:
        return default
    return json.loads(Path(path).read_text(encoding="utf-8"))


def value(row, key, default=0):
    v = row.get(key, default) if isinstance(row, dict) else default
    return v.get("value", default) if isinstance(v, dict) else (default if v is None else v)


def money(v):
    return f"¥{float(v or 0):,.2f}"


def pct(v):
    return f"{float(v or 0) * 100:.2f}%"


def change(cur, prev):
    return None if prev in (None, 0) else (cur - prev) / abs(prev)


def change_text(cur, prev):
    c = change(cur, prev)
    if c is None:
        return "-"
    return ("上涨" if c >= 0 else "下降") + f"{abs(c) * 100:.1f}%"


def pearson(pairs):
    """至少 3 组增长率样本时计算相关系数；小样本不制造精确结论。"""
    if len(pairs) < 3:
        return None
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    sx = sum((x - mx) ** 2 for x in xs)
    sy = sum((y - my) ** 2 for y in ys)
    if sx == 0 or sy == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in pairs) / math.sqrt(sx * sy)


def valid_industry_series(sources, preferred=""):
    candidates = [s for s in sources.get("sources", []) if s.get("series")]
    if preferred:
        candidates = [s for s in candidates if preferred in (s.get("file"), s.get("industry_name"))]
    if len(candidates) == 1:
        source = candidates[0]
        return source, {r.get("date"): r for r in source["series"] if r.get("date")}
    return None, {}


def same_industry_snapshot(cur, prev):
    """忽略日期字段，识别整组行业指标原样复制的重复快照。"""
    keys = ("gmv", "uv", "iv", "ctr", "trade_index")
    return all(cur.get(k) == prev.get(k) for k in keys)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shop-overview", required=True)
    ap.add_argument("--cate-agg", required=True)
    ap.add_argument("--industry-data", "--ind-data", dest="industry_data", default="")
    ap.add_argument("--category-map", default="")
    ap.add_argument("--shop-name", default="当前店铺")
    ap.add_argument("--display-start", required=True, help="用户要求的正式周期开始日期，不得改成实际返回首日")
    ap.add_argument("--display-end", required=True, help="用户要求的正式周期结束日期，不得改成实际返回末日")
    ap.add_argument("--baseline-days", default="1")
    ap.add_argument("--label", default="")
    ap.add_argument("--out-dir", default="artifacts")
    args = ap.parse_args()

    shop = load(args.shop_overview, {})
    cate = load(args.cate_agg, {})
    sources = load(args.industry_data, {"sources": []})
    mapping = load(args.category_map, {})
    daily = shop.get("daily", {})
    all_days = sorted(daily)
    start = args.display_start
    end = args.display_end
    days = [d for d in all_days if (not start or d >= start) and (not end or d <= end)]
    if not days:
        raise SystemExit("展示周期内没有店铺日数据")
    start_dt = datetime.strptime(start, "%Y-%m-%d").date()
    end_dt = datetime.strptime(end, "%Y-%m-%d").date()
    requested_days = [(start_dt + timedelta(days=i)).isoformat()
                      for i in range((end_dt - start_dt).days + 1)]
    missing_days = [d for d in requested_days if d not in daily]

    pay = sum(value(daily[d], "payAmt") for d in days)
    uv = sum(value(daily[d], "uv") for d in days)
    buyers = sum(value(daily[d], "payByrCnt") for d in days)
    refund = sum(value(daily[d], "payShopRfdAmt") for d in days)
    promo = sum(value(daily[d], k) for d in days for k in ("p4pExpendAmt", "cubeAmt", "admCostFamtQzt"))
    first_pay, last_pay = value(daily[days[0]], "payAmt"), value(daily[days[-1]], "payAmt")

    cate_rows = []
    for name in cate.get("cates", []):
        period = cate.get("data", {}).get(name, {}).get("period", {})
        amount = value(period, "payAmt")
        if amount > 0:
            cate_rows.append((name, amount, value(period, "payRate"), value(period, "sucRefundAmt")))
    cate_rows.sort(key=lambda r: r[1], reverse=True)
    cate_total = sum(r[1] for r in cate_rows)
    cate_names = cate.get("cates", []) if isinstance(cate, dict) else []
    cate_available = bool(cate_names)

    category_map = mapping.get("category_map", {}) if isinstance(mapping, dict) else {}
    assessment = mapping.get("match_assessment", {}) if isinstance(mapping, dict) else {}
    match_status = assessment.get("status", "insufficient")
    match_label = {"matched": "匹配", "partial": "部分匹配", "mismatch": "不匹配", "insufficient": "信息不足"}.get(match_status, "信息不足")
    match_reason = assessment.get("reason", "未提供 AI 类目匹配判断")
    comparable_scope = assessment.get("comparable_scope", "")
    preferred_source = assessment.get("industry_source", "")
    source, ind_daily = valid_industry_series(sources, preferred_source)
    industry_name = (mapping.get("industry_name") if isinstance(mapping, dict) else None) or (source or {}).get("industry_name")
    source_name = (source or {}).get("industry_name", "")
    mapped_cates = [name for name, target in category_map.items() if target == source_name and name in cate.get("data", {})]
    mapped = sum(amount for name, amount, _, _ in cate_rows if name in mapped_cates)
    coverage = mapped / cate_total if cate_total else 0
    can_compare = bool(source and mapped_cates and match_status in ("matched", "partial"))

    association_rows = []
    growth_pairs = []
    same_direction = 0
    if can_compare:
        def mapped_shop_sales(day):
            return sum(value(cate["data"][name].get("days", {}).get(day, {}), "payAmt") for name in mapped_cates)

        common_days = [d for d in days if d in ind_daily]
        base_day = common_days[0] if common_days else ""
        base_shop = mapped_shop_sales(base_day) if base_day else 0
        base_ind = value(ind_daily.get(base_day, {}), "gmv") if base_day else 0
        for day in days:
            shop_sales = mapped_shop_sales(day)
            ind_gmv = value(ind_daily.get(day, {}), "gmv", None) if day in ind_daily else None
            prev_day = (datetime.strptime(day, "%Y-%m-%d").date() - timedelta(days=1)).isoformat()
            shop_growth = change(shop_sales, mapped_shop_sales(prev_day)) if prev_day in cate.get("days", []) else None
            ind_growth = None
            status = "缺行业当日数据" if ind_gmv is None else "仅展示金额"
            if day in ind_daily and prev_day in ind_daily:
                if same_industry_snapshot(ind_daily[day], ind_daily[prev_day]):
                    status = "行业重复快照，环比不采用"
                else:
                    ind_growth = change(ind_gmv, value(ind_daily[prev_day], "gmv"))
            if shop_growth is not None and ind_growth is not None:
                same = (shop_growth >= 0) == (ind_growth >= 0)
                status = "同向" if same else "背离"
                same_direction += int(same)
                growth_pairs.append((shop_growth, ind_growth))
            association_rows.append({
                "day": day,
                "shop_sales": shop_sales,
                "industry_gmv": ind_gmv,
                "shop_index": shop_sales / base_shop * 100 if base_shop else None,
                "industry_index": ind_gmv / base_ind * 100 if ind_gmv is not None and base_ind else None,
                "shop_growth": shop_growth,
                "industry_growth": ind_growth,
                "status": status,
            })

    corr = pearson(growth_pairs)
    if growth_pairs:
        direction_ratio = same_direction / len(growth_pairs)
        association_summary = f"可核验环比 {len(growth_pairs)} 组，同向 {same_direction} 组（{direction_ratio * 100:.0f}%）"
        if corr is None:
            association_summary += "；有效样本少于 3 组，不判断统计相关强弱"
        else:
            strength = "强正相关" if corr >= 0.7 else ("中度正相关" if corr >= 0.3 else ("弱相关" if corr > -0.3 else ("中度负相关" if corr > -0.7 else "强负相关")))
            association_summary += f"；增长率相关系数 {corr:.2f}，表现为{strength}"
    else:
        association_summary = "没有同时具备连续有效日的双方环比样本，暂不能判断关联强弱"

    conclusions = [
        f"展示期支付金额 {money(pay)}，首日到末日支付{change_text(last_pay, first_pay)}。",
        f"访客 {uv:,.0f}，支付买家 {buyers:,.0f}，按汇总重算成交效率 {pct(buyers / uv if uv else 0)}。",
        f"退款金额 {money(refund)}；该金额可能对应历史订单，不直接当作退款率。推广花费合计 {money(promo)}。",
    ]
    if cate_rows:
        top_name, top_pay = cate_rows[0][0], cate_rows[0][1]
        top_share = top_pay / cate_total if cate_total else 0
        conclusions.insert(2, f"主力类目为“{escape(top_name)}”，支付 {money(top_pay)}，占类目支付 {pct(top_share)}。")
    elif cate_available:
        conclusions.insert(2, "本期商品明细有返回，但没有可汇总的成交类目，无法判断主力类目。")
    else:
        conclusions.insert(2, "本店商品明细未取得，无法判断类目结构、主力类目和单品贡献。")
    if can_compare:
        scope_text = f"，可比范围：{escape(comparable_scope)}" if comparable_scope else ""
        conclusions.append(f"AI 判断本店与行业为{match_label}，本店映射类目支付 {money(mapped)}、覆盖本期类目支付 {pct(coverage)}{scope_text}。{association_summary}。理由：{escape(match_reason)}")
    else:
        conclusions.append(f"本次已跳过行业比较，没有使用默认行业。AI 类目判断：{match_label}；{escape(match_reason)}。")

    cards = [
        ("支付金额", money(pay)), ("访客", f"{uv:,.0f}"), ("支付买家", f"{buyers:,.0f}"),
        ("成交效率", pct(buyers / uv if uv else 0)), ("推广花费", money(promo)), ("退款金额", money(refund)),
    ]
    cate_html = "".join(f"<tr><td>{escape(name)}</td><td>{money(amount)}</td><td>{pct(amount/cate_total if cate_total else 0)}</td><td>{pct(rate)}</td><td>{money(rfd)}</td></tr>" for name, amount, rate, rfd in cate_rows)
    if cate_html:
        cate_body = cate_html
    elif cate_available:
        cate_body = "<tr><td colspan=5>本期商品明细有返回，但没有可汇总的成交类目</td></tr>"
    else:
        cate_body = "<tr><td colspan=5>本店商品明细未取得，无法判断类目结构</td></tr>"
    day_html = "".join(f"<tr><td>{d}</td><td>{money(value(daily[d],'payAmt'))}</td><td>{value(daily[d],'uv'):,.0f}</td><td>{pct(value(daily[d],'payRate'))}</td><td>{money(value(daily[d],'payShopRfdAmt'))}</td><td>{money(sum(value(daily[d],k) for k in ('p4pExpendAmt','cubeAmt','admCostFamtQzt')))}</td></tr>" for d in days)
    association_html = "".join(
        f"<tr><td>{r['day']}</td><td>{money(r['shop_sales'])}</td>"
        f"<td>{'-' if r['industry_gmv'] is None else money(r['industry_gmv'])}</td>"
        f"<td>{'-' if r['shop_index'] is None else format(r['shop_index'], '.1f')}</td>"
        f"<td>{'-' if r['industry_index'] is None else format(r['industry_index'], '.1f')}</td>"
        f"<td>{'-' if r['shop_growth'] is None else pct(r['shop_growth'])}</td>"
        f"<td>{'-' if r['industry_growth'] is None else pct(r['industry_growth'])}</td>"
        f"<td>{r['status']}</td></tr>" for r in association_rows)
    mapped_names = "、".join(mapped_cates)
    compare_section = (f"<h2>店铺类目 vs 市场大盘关联分析</h2>"
        f"<p class='note'>本店对应类目：{escape(mapped_names)}；市场大盘类目：{escape(source_name)}。"
        f"本店映射类目周期销售额 {money(mapped)}，占本店类目销售额 {pct(coverage)}。双方绝对金额用于并排观察，不计算市场份额；趋势指数以首个共同有效日=100。</p>"
        f"<div class='association'>{escape(association_summary)}</div>"
        f"<table><tr><th>日期</th><th>本店对应类目销售额</th><th>市场大盘销售额</th><th>本店趋势指数</th><th>大盘趋势指数</th><th>本店环比</th><th>大盘环比</th><th>关系判断</th></tr>"
        f"{association_html or '<tr><td colspan=8>暂无双方共同有效日期</td></tr>'}</table>"
        f"<p class='note'>AI 类目判断：{match_label}。{escape(match_reason)}。行业缺日或重复快照不参与环比与相关性计算。</p>"
        if can_compare else f"<h2>店铺类目 vs 市场大盘关联分析</h2><div class='warn'>本次没有形成可验证的类目映射或行业序列，不能生成关联分析。AI 类目判断：{match_label}；{escape(match_reason)}。</div>")

    html = f"""<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>巡店诊断 {escape(args.label)}</title><style>
body{{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;background:#f4f7fb;color:#172033;margin:0;padding:24px}}.wrap{{max-width:1180px;margin:auto}}h1{{margin:0 0 6px}}.sub,.note{{color:#667085}}.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}}.card,section{{background:white;border-radius:12px;padding:18px;box-shadow:0 2px 10px #17203310}}section{{margin:14px 0;overflow-x:auto}}.v{{font-size:22px;font-weight:700;margin-top:6px}}table{{width:100%;border-collapse:collapse}}th,td{{padding:9px;border-bottom:1px solid #edf0f5;text-align:right;white-space:nowrap}}th:first-child,td:first-child{{text-align:left}}.warn{{background:#fff4e5;border-left:4px solid #f59e0b;padding:12px}}.association{{background:#eef6ff;border-left:4px solid #2563eb;padding:12px;margin:12px 0;font-weight:600}}li{{margin:8px 0}}
</style></head><body><div class='wrap'><h1>巡店经营诊断</h1><div class='sub'>{escape(args.shop_name)} ｜ {start} 至 {end}</div><div class='cards'>{''.join(f"<div class='card'><div class='sub'>{a}</div><div class='v'>{b}</div></div>" for a,b in cards)}</div>
{f"<section><div class='warn'>用户要求周期为 {start} 至 {end}，本次实际仅覆盖 {days[0]} 至 {days[-1]}，缺少：{', '.join(missing_days)}。以下汇总只代表已返回日期，不代表完整周期。</div></section>" if missing_days else ''}
<section><h2>经营结论</h2><ol>{''.join(f'<li>{x}</li>' for x in conclusions)}</ol></section>
<section><h2>每日经营证据</h2><table><tr><th>日期</th><th>支付金额</th><th>访客</th><th>支付转化率</th><th>退款金额</th><th>推广花费</th></tr>{day_html}</table></section>
<section><h2>类目结构</h2><table><tr><th>类目</th><th>支付金额</th><th>支付占比</th><th>支付转化率</th><th>成功退款金额</th></tr>{cate_body}</table></section>
<section>{compare_section}</section>
<section><h2>优先动作</h2><ol><li>先复核支付变化最大的日期，拆分访客、转化和客单因素。</li>{'<li>围绕主力类目检查商品贡献、库存和推广计划，不因单周期数据直接停品或降价。</li>' if cate_rows else '<li>先补齐本店商品明细，再做类目、单品贡献及库存动作；当前不做跨层归因。</li>'}<li>若要做行业判断，先补齐当前类目的行业返回与已确认映射，再复跑行业校准。</li></ol></section>
</div></body></html>"""
    out_dir = Path(args.out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"店铺经营诊断_市场校准_{args.label or start.replace('-','')+'_'+end.replace('-','')}.html"
    out.write_text(html, encoding="utf-8")
    print(f"html -> {out}")


if __name__ == "__main__":
    main()
