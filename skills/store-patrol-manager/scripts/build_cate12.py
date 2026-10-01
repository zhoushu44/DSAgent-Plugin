#!/usr/bin/env python3
"""模块B：店铺类目12字段周报（类目维度）— 一条龙生成。

输入：
  --input   query_shop_metrics(item_top, daily_trend, 12字段+cate_name) 返回的完整 JSON 文本文件
  --out-dir 输出目录（默认 artifacts/xlsx/cate12）
  --label   报告标签，如 20260824_0830（默认从数据日期自动推断）
  --xlsx    输出 Excel 路径（可选，默认 <out-dir>/../店铺_类目12_周报_<label>.xlsx）
  --html    输出 HTML 路径（可选，默认 artifacts/店铺_类目12_周报_<label>.html）

流程：item_top daily_trend（商品×日）→ 按 cate_name 聚合 → 类目周期汇总/每日明细/每日环比
      → 生成 3-Sheet Excel + 自包含 HTML（含指标卡/趋势图/明细表）。

依赖：openpyxl。
"""
import argparse
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from collections import defaultdict
from html import escape

try:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter
except ImportError:
    sys.exit("缺少依赖 openpyxl，请先执行: pip3 install openpyxl")

# workspace 根 = 本脚本上级三级（skills/<skill>/scripts -> workspace 根）。
# 相对路径统一基于它解析，保证从任何 cwd / 任何设备运行输出位置一致。
WS_ROOT = Path(__file__).resolve().parents[3]


def resolve(p):
    """相对路径基于 workspace 根解析（不依赖 cwd）；绝对路径原样返回。"""
    if not p:
        return p
    p = Path(p)
    return str(p if p.is_absolute() else WS_ROOT / p)

# 类目12字段（item_top 命名）
FIELDS = [
    ("payAmt", "支付金额", "money"),
    ("sucRefundAmt", "成功退款金额", "money"),
    ("payItmCnt", "支付件数", "num"),
    ("payByrCnt", "支付买家数", "num"),
    ("payRate", "支付转化率", "pct"),
    ("payOldByrCnt", "老客支付买家数", "num"),
    ("olderPayAmt", "老客支付金额", "money"),
    ("itemCartByrCnt", "加购人数", "num"),
    ("itemCartCnt", "加购件数", "num"),
    ("itmStayTime", "平均停留时长", "num"),
    ("uvAvgValue", "访客平均价值", "money"),
    ("itmUv", "商品访客", "num"),
]

def v(d, k):
    x = d.get(k)
    return x.get("value") if isinstance(x, dict) else x


def aggregate(itemtop_daily_json, display_start="", display_end=""):
    """item_top daily_trend → 类目日数据与正式展示期汇总。

    查询结果可以包含展示开始日前一天，用于计算首日环比；所有周期指标、
    类目占比和排名只聚合 display_start~display_end。
    """
    t = next((tb for tb in itemtop_daily_json.get("tables", []) if tb.get("output_view") == "daily_trend"), None)
    if t is None:
        raise SystemExit("未找到 daily_trend 表（检查 item_top 查询是否含 output_views=['daily_trend']）")
    rows = t["rows"]
    agg = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    for r in rows:
        cate = r["data"]["cate_name"]
        day = r["day_key"]
        d = r["data"]
        for k, _, _ in FIELDS:
            val = v(d, k)
            if val is None:
                continue
            agg[cate][day][k] += val

    if not display_start or not display_end:
        raise SystemExit("必须显式提供正式周期 --display-start 和 --display-end；不得用返回日期代替用户周期")
    if display_start > display_end:
        raise SystemExit("正式周期错误：--display-start 不能晚于 --display-end")
    start_dt = datetime.strptime(display_start, "%Y-%m-%d").date()
    end_dt = datetime.strptime(display_end, "%Y-%m-%d").date()
    requested_days = [(start_dt + timedelta(days=i)).isoformat()
                      for i in range((end_dt - start_dt).days + 1)]
    compute_days = sorted(set(r["day_key"] for r in rows))
    days = [d for d in compute_days
            if (not display_start or d >= display_start) and (not display_end or d <= display_end)]
    if not days:
        raise SystemExit("正式展示期没有可汇总的数据：请核对 --display-start/--display-end 与返回日期")
    expected_baseline_day = (start_dt - timedelta(days=1)).isoformat()
    baseline_day = expected_baseline_day if expected_baseline_day in compute_days else ""
    missing_display_days = [d for d in requested_days if d not in compute_days]
    cates = sorted(agg.keys())
    out = {}
    cate_summary = []
    for cate in cates:
        cate_days = {}
        for day in compute_days:
            a = agg[cate][day]
            pay = a.get("payAmt", 0.0)
            uv = a.get("itmUv", 0.0)
            byr = a.get("payByrCnt", 0.0)
            row = {k: a.get(k, 0.0) for k, _, _ in FIELDS}
            row["payRate"] = byr / uv if uv else 0.0
            row["uvAvgValue"] = pay / uv if uv else 0.0
            row["_stayWeight"] = uv
            cate_days[day] = row
        p = {k: 0.0 for k, _, _ in FIELDS}
        stay_w = 0.0
        stay_acc = 0.0
        for day in days:
            r = cate_days[day]
            for k, _, _ in FIELDS:
                if k in ("payRate", "uvAvgValue"):
                    continue
                if k == "itmStayTime":
                    stay_acc += r.get("itmStayTime", 0.0) * r.get("_stayWeight", 0.0)
                    stay_w += r.get("_stayWeight", 0.0)
                    continue
                p[k] += r.get(k, 0.0)
        p["payRate"] = p["payByrCnt"] / p["itmUv"] if p["itmUv"] else 0.0
        p["uvAvgValue"] = p["payAmt"] / p["itmUv"] if p["itmUv"] else 0.0
        p["itmStayTime"] = stay_acc / stay_w if stay_w else 0.0
        out[cate] = {"days": cate_days, "period": p}
        cate_summary.append({"cate": cate, "payAmt": p["payAmt"], "byr": p["payByrCnt"], "uv": p["itmUv"]})
    cate_summary.sort(key=lambda x: -x["payAmt"])
    total_pay = sum(x["payAmt"] for x in cate_summary)
    return {
        "days": days,
        "compute_days": compute_days,
        "baseline_day": baseline_day,
        "expected_baseline_day": expected_baseline_day,
        "requested_display_start": display_start,
        "requested_display_end": display_end,
        "requested_days": requested_days,
        "missing_display_days": missing_display_days,
        "coverage_status": "完整" if not missing_display_days else "部分覆盖",
        "display_start": days[0],
        "display_end": days[-1],
        "cates": [c["cate"] for c in cate_summary],
        "total_pay": total_pay,
        "summary": cate_summary,
        "data": out,
    }


# ================= Excel =================
HDR_FILL = PatternFill("solid", start_color="1F4E79")
HDR_FONT = Font(name="Arial", bold=True, color="FFFFFF", size=10)
BODY_FONT = Font(name="Arial", size=10)
CATE_FONT = Font(name="Arial", size=10, bold=True)
UP_FONT = Font(name="Arial", size=10, color="C00000")
DOWN_FONT = Font(name="Arial", size=10, color="008000")
MUTED_FONT = Font(name="Arial", size=10, color="808080")
TOTAL_FILL = PatternFill("solid", start_color="FFF2CC")
THIN = Side(style="thin", color="D9D9D9")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
CENTER = Alignment(horizontal="center", vertical="center")
RIGHT = Alignment(horizontal="right", vertical="center")


def fmt(v, kind):
    if v is None:
        return "-"
    if kind == "money":
        return round(float(v), 2)
    if kind == "pct":
        return round(float(v) * 100, 2)
    if kind == "num":
        return round(float(v), 1) if abs(float(v) - round(float(v))) > 0.01 else int(round(float(v)))
    return round(float(v), 2)


def num_fmt(kind):
    if kind == "money":
        return '#,##0.00'
    if kind == "pct":
        return '0.00"%"'
    if kind == "num":
        return '#,##0'
    return '0.00'


def write_header(ws, row, headers):
    for ci, h in enumerate(headers, 1):
        c = ws.cell(row=row, column=ci, value=h)
        c.fill = HDR_FILL
        c.font = HDR_FONT
        c.alignment = CENTER
        c.border = BORDER


def chg_cell(ws, r, c, cur, prev):
    if cur is None or prev is None or prev == 0:
        cell = ws.cell(row=r, column=c, value="-")
        cell.font = MUTED_FONT
        cell.alignment = CENTER
        cell.border = BORDER
        return
    ratio = (cur - prev) / abs(prev)
    cell = ws.cell(row=r, column=c, value=ratio)
    cell.number_format = '+0.00%;-0.00%'
    cell.font = UP_FONT if ratio > 0 else (DOWN_FONT if ratio < 0 else MUTED_FONT)
    cell.alignment = RIGHT
    cell.border = BORDER


def build_excel(agg, out_path):
    days = agg["days"]
    cate_order = agg["cates"]
    total_pay = agg["total_pay"]
    data = agg["data"]
    baseline_day = agg.get("baseline_day", "")
    wb = Workbook()

    ws1 = wb.active
    ws1.title = "类目周期汇总"
    headers1 = ["类目", "支付金额", "成功退款金额", "支付件数", "支付买家数", "支付转化率",
                "老客支付买家数", "老客支付金额", "加购人数", "加购件数", "平均停留时长",
                "访客平均价值", "商品访客", "支付占比"]
    write_header(ws1, 1, headers1)
    r = 2
    for cate in cate_order:
        p = data[cate]["period"]
        ws1.cell(row=r, column=1, value=cate).font = CATE_FONT
        for ci, (key, label, kind) in enumerate(FIELDS, 2):
            cell = ws1.cell(row=r, column=ci, value=fmt(p.get(key), kind))
            cell.number_format = num_fmt(kind)
            cell.font = BODY_FONT
            cell.alignment = RIGHT
        share = p["payAmt"] / total_pay if total_pay else 0
        cell = ws1.cell(row=r, column=14, value=share)
        cell.number_format = '0.00%'
        cell.font = BODY_FONT
        cell.alignment = RIGHT
        for ci in range(1, 15):
            ws1.cell(row=r, column=ci).border = BORDER
        r += 1
    ws1.cell(row=r, column=1, value="合计").font = Font(name="Arial", size=10, bold=True)
    tot_byr = sum(data[c]["period"]["payByrCnt"] for c in cate_order)
    tot_uv = sum(data[c]["period"]["itmUv"] for c in cate_order)
    tot_pay = sum(data[c]["period"]["payAmt"] for c in cate_order)
    for ci, (key, label, kind) in enumerate(FIELDS, 2):
        cell = ws1.cell(row=r, column=ci, value=fmt(sum(data[c]["period"].get(key, 0) for c in cate_order), kind))
        cell.number_format = num_fmt(kind)
        cell.font = Font(name="Arial", size=10, bold=True)
        cell.alignment = RIGHT
    ws1.cell(row=r, column=6, value=round(tot_byr / tot_uv * 100, 2) if tot_uv else 0).number_format = '0.00"%"'
    ws1.cell(row=r, column=12, value=round(tot_pay / tot_uv, 2) if tot_uv else 0).number_format = '#,##0.00'
    ws1.cell(row=r, column=14, value=1.0).number_format = '0.00%'
    for ci in range(1, 15):
        ws1.cell(row=r, column=ci).fill = TOTAL_FILL
        ws1.cell(row=r, column=ci).border = BORDER
    widths1 = [16] + [12] * 12 + [10]
    for ci, w in enumerate(widths1, 1):
        ws1.column_dimensions[get_column_letter(ci)].width = w
    ws1.freeze_panes = "B2"

    ws2 = wb.create_sheet("类目每日明细")
    headers2 = ["类目", "日期"] + [f[1] for f in FIELDS]
    write_header(ws2, 1, headers2)
    r = 2
    for cate in cate_order:
        for day in days:
            d = data[cate]["days"][day]
            ws2.cell(row=r, column=1, value=cate).font = BODY_FONT
            ws2.cell(row=r, column=2, value=day).font = BODY_FONT
            ws2.cell(row=r, column=2).alignment = CENTER
            for ci, (key, label, kind) in enumerate(FIELDS, 3):
                cell = ws2.cell(row=r, column=ci, value=fmt(d.get(key), kind))
                cell.number_format = num_fmt(kind)
                cell.font = BODY_FONT
                cell.alignment = RIGHT
            for ci in range(1, 3 + len(FIELDS)):
                ws2.cell(row=r, column=ci).border = BORDER
            r += 1
    widths2 = [16, 12] + [12] * len(FIELDS)
    for ci, w in enumerate(widths2, 1):
        ws2.column_dimensions[get_column_letter(ci)].width = w
    ws2.freeze_panes = "C2"
    ws2.auto_filter.ref = f"A1:{get_column_letter(2 + len(FIELDS))}{r - 1}"

    ws3 = wb.create_sheet("类目每日环比")
    headers3 = ["类目", "日期"] + [f[1] + "环比" for f in FIELDS]
    write_header(ws3, 1, headers3)
    r = 2
    for cate in cate_order:
        for di, day in enumerate(days):
            ws3.cell(row=r, column=1, value=cate).font = BODY_FONT
            ws3.cell(row=r, column=2, value=day).font = BODY_FONT
            ws3.cell(row=r, column=2).alignment = CENTER
            prev_day = baseline_day if di == 0 else days[di - 1]
            if prev_day and prev_day in data[cate]["days"]:
                cur_d = data[cate]["days"][day]
                prev_d = data[cate]["days"][prev_day]
                for ci, (key, label, kind) in enumerate(FIELDS, 3):
                    chg_cell(ws3, r, ci, cur_d.get(key), prev_d.get(key))
            else:
                for ci in range(3, 3 + len(FIELDS)):
                    cell = ws3.cell(row=r, column=ci, value="-")
                    cell.font = MUTED_FONT
                    cell.alignment = CENTER
                    cell.border = BORDER
            for ci in range(1, 3):
                ws3.cell(row=r, column=ci).border = BORDER
            r += 1
    for ci, w in enumerate(widths2, 1):
        ws3.column_dimensions[get_column_letter(ci)].width = w
    ws3.freeze_panes = "C2"
    ws3.auto_filter.ref = f"A1:{get_column_letter(2 + len(FIELDS))}{r - 1}"

    wb.save(out_path)
    print("xlsx ->", out_path)


# ================= HTML =================
def fhtml(v, kind):
    if v is None:
        return "-"
    if kind == "money":
        return f"{v:,.2f}"
    if kind == "pct":
        return f"{v*100:.2f}%"
    if abs(v - round(v)) < 0.005:
        return f"{int(round(v)):,}"
    return f"{v:,.2f}"


def chg_str(cur, prev):
    if cur is None or prev is None or prev == 0:
        return '<span class="muted">-</span>'
    c = (cur - prev) / abs(prev) * 100
    cls = "up" if c > 0 else "down"
    arrow = "▲" if c > 0 else "▼"
    return f'<span class="{cls}">{arrow} {abs(c):.2f}%</span>'


def svg_line(values, labels, height=200, color="#2f6fed", zero_based=True, fmt_axis=None):
    if not values:
        return ""
    n = len(values)
    W, H, pad_l, pad_r, pad_t, pad_b = 760, height, 46, 16, 18, 28
    vmin, vmax = min(values), max(values)
    if vmax == vmin:
        vmax = vmin + 1
    if zero_based:
        vmin = min(0, vmin)
    else:
        pad_v = (vmax - vmin) * 0.15 or vmax * 0.1 or 1
        vmin = max(0, vmin - pad_v)
        vmax = vmax + pad_v
    rng = vmax - vmin or 1
    if fmt_axis is None:
        fmt_axis = lambda v: f"{v:,.0f}"
    def x(i):
        return pad_l + (W - pad_l - pad_r) * i / (n - 1) if n > 1 else pad_l + (W - pad_l - pad_r) / 2
    def y(v):
        return pad_t + (H - pad_t - pad_b) * (1 - (v - vmin) / rng)
    pts = " ".join(f"{x(i):.1f},{y(v):.1f}" for i, v in enumerate(values))
    area = f"{x(0):.1f},{H-pad_b} " + pts + f" {x(n-1):.1f},{H-pad_b}"
    grid = ""
    for g in range(5):
        gy = pad_t + (H - pad_t - pad_b) * g / 4
        gv = vmax - rng * g / 4
        grid += f'<line x1="{pad_l}" y1="{gy:.1f}" x2="{W-pad_r}" y2="{gy:.1f}" stroke="#eee" stroke-width="1"/>'
        grid += f'<text x="{pad_l-6}" y="{gy+4:.1f}" text-anchor="end" font-size="10" fill="#999">{fmt_axis(gv)}</text>'
    labels_svg = "".join(
        f'<text x="{x(i):.1f}" y="{H-8:.1f}" text-anchor="middle" font-size="10" fill="#666">{l}</text>'
        for i, l in enumerate(labels))
    point_labels = "".join(
        f'<circle cx="{x(i):.1f}" cy="{y(v):.1f}" r="3" fill="{color}"/>'
        f'<text x="{x(i):.1f}" y="{max(11, y(v)-7):.1f}" text-anchor="middle" font-size="9" fill="#333">{fmt_axis(v)}</text>'
        for i, v in enumerate(values))
    gid = f"g{abs(sum((i + 1) * int(float(v) * 100) for i, v in enumerate(values))) % 100000}"
    return f'''<svg viewBox="0 0 {W} {H}" width="100%" xmlns="http://www.w3.org/2000/svg">
{grid}
<defs><linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="{color}" stop-opacity="0.25"/><stop offset="100%" stop-color="{color}" stop-opacity="0.02"/>
</linearGradient></defs>
<polygon points="{area}" fill="url(#{gid})"/>
<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2.5"/>
{point_labels}{labels_svg}</svg>'''


def svg_bar_rank(items, total, height=None, color="#2f6fed"):
    if not items:
        return ""
    W = 760
    H = height or (34 + len(items) * 34)
    pad_l, pad_r, pad_t, pad_b = 150, 150, 14, 16
    vmax = max(v for _, v in items) or 1
    out = []
    for i, (label, v) in enumerate(items):
        cy = pad_t + i * 34 + 12
        bw = (W - pad_l - pad_r) * (v / vmax)
        share = v / total * 100 if total else 0
        out.append(f'<text x="{pad_l-10}" y="{cy+4:.1f}" text-anchor="end" font-size="11" fill="#333">{escape(label)}</text>')
        out.append(f'<rect x="{pad_l}" y="{cy-8:.1f}" width="{max(1,bw):.1f}" height="16" rx="3" fill="{color}"/>')
        out.append(f'<text x="{W-pad_r+8}" y="{cy+4:.1f}" font-size="11" fill="#333">{v:,.0f}元 · {share:.1f}%</text>')
    return f'<svg viewBox="0 0 {W} {H}" width="100%" xmlns="http://www.w3.org/2000/svg">' + "".join(out) + "</svg>"


def build_html(agg, out_path, label, shop_name="当前店铺"):
    days = agg["days"]
    cates = agg["cates"]
    total_pay = agg["total_pay"]
    data = agg["data"]
    baseline_day = agg.get("baseline_day", "")
    requested_start = agg.get("requested_display_start", days[0])
    requested_end = agg.get("requested_display_end", days[-1])
    missing_days = agg.get("missing_display_days", [])
    day_labels = [d[5:] for d in days]
    payable_cates = [c for c in cates if data[c]["period"]["payAmt"] > 0]
    n_payable = len(payable_cates)

    primary_name = payable_cates[0] if payable_cates else "本期无可汇总成交类目"
    second_name = payable_cates[1] if len(payable_cates) > 1 else ""
    primary = data.get(primary_name)
    second = data.get(second_name) if second_name else None
    pp = primary["period"] if primary else {k: 0 for k, _, _ in FIELDS}
    primary_pay = pp.get("payAmt", 0)
    primary_rate = pp.get("payRate", 0)
    primary_refund = pp.get("sucRefundAmt", 0)
    primary_uv = pp.get("itmUv", 0)
    primary_uvavg = pp.get("uvAvgValue", 0)
    primary_share = primary_pay / total_pay * 100 if total_pay else 0
    second_pay = second["period"].get("payAmt", 0) if second else 0
    others_pay = max(0, total_pay - primary_pay)

    # 趋势图
    if primary:
        primary_pay_daily = [primary["days"][d]["payAmt"] for d in days]
        primary_rate_daily = [primary["days"][d]["payRate"] * 100 for d in days]
        svg_primary_pay = svg_line(primary_pay_daily, day_labels, height=210, color="#2f6fed")
        svg_primary_rate = svg_line(primary_rate_daily, day_labels, height=200, color="#0a9d58",
                                 zero_based=False, fmt_axis=lambda v: f"{v:.2f}%")
    else:
        primary_pay_daily = primary_rate_daily = []
        svg_primary_pay = svg_primary_rate = ""
    if second:
        svg_second_pay = svg_line([second["days"][d]["payAmt"] for d in days], day_labels,
                               height=200, color="#f0a500", zero_based=True)
    else:
        svg_second_pay = '<div class="muted">本期仅一个类目有成交</div>'

    top_structure = payable_cates[:8]
    bar_items = [(c, data[c]["period"]["payAmt"]) for c in top_structure]
    other_structure_pay = sum(data[c]["period"]["payAmt"] for c in payable_cates[8:])
    if other_structure_pay > 0:
        bar_items.append(("其他有成交类目", other_structure_pay))
    svg_bar_pay = svg_bar_rank(bar_items, total_pay, color="#2f6fed")

    # 汇总表
    rows_sum = ""
    for cate in cates:
        pp = data[cate]["period"]
        share = pp["payAmt"] / total_pay * 100 if total_pay else 0
        tds = "".join(f"<td>{fhtml(pp.get(k), kind)}</td>" for k, _, kind in FIELDS)
        strong = ' class="strong"' if cate == primary_name else ""
        rows_sum += f"<tr{strong}><td>{escape(cate)}</td>{tds}<td>{share:.1f}%</td></tr>"
    tot = {k: sum(data[c]["period"][k] for c in cates) for k, _, _ in FIELDS}
    tot["payRate"] = tot["payByrCnt"] / tot["itmUv"] if tot["itmUv"] else 0
    tot["uvAvgValue"] = tot["payAmt"] / tot["itmUv"] if tot["itmUv"] else 0
    tot["itmStayTime"] = (
        sum(data[c]["period"]["itmStayTime"] * data[c]["period"]["itmUv"] for c in cates) / tot["itmUv"]
        if tot["itmUv"] else 0)
    tot_tds = "".join(f"<td class='strong'>{fhtml(tot.get(k), kind)}</td>" for k, _, kind in FIELDS)
    rows_sum += f"<tr class='total'><td>合计</td>{tot_tds}<td>100%</td></tr>"

    # Top8 每日明细+环比
    top_cates = payable_cates[:8]
    rows_daily = ""
    for cate in top_cates:
        for di, day in enumerate(days):
            d = data[cate]["days"][day]
            tds = "".join(f"<td>{fhtml(d.get(k), kind)}</td>" for k, _, kind in FIELDS)
            prev_day = baseline_day if di == 0 else days[di - 1]
            if prev_day and prev_day in data[cate]["days"]:
                prev_d = data[cate]["days"][prev_day]
                chg_tds = "".join(f"<td>{chg_str(d.get(k), prev_d.get(k))}</td>" for k, _, _ in FIELDS)
            else:
                chg_tds = "".join('<td><span class="muted">-</span></td>' for _ in FIELDS)
            label_cell = f"<b>{escape(cate)}</b>" if di == 0 else ""
            rows_daily += f"<tr><td>{label_cell}</td><td>{day[5:]}</td>{tds}{chg_tds}</tr>"

    # 洞察
    insights = []
    insights.append(
        f"本期店铺支付 <b>{fhtml(total_pay,'money')}</b>，按类目聚合覆盖 {len(cates)} 个类目（{n_payable} 个有成交）。"
        f"主力类目 <b>{escape(primary_name)}</b> 支付 <b>{fhtml(primary_pay,'money')}</b>、占 <b>{primary_share:.1f}%</b>。")
    refund_note = (f"成功退款金额 <b>{fhtml(primary_refund,'money')}</b>；该金额可能包含历史订单退款，不直接命名为退款率。"
                   if primary else "本期没有可分析的成交类目。")
    insights.append(
        f"{escape(primary_name)}转化率 <b>{fhtml(primary_rate,'pct')}</b>、访客平均价值 <b>{fhtml(primary_uvavg,'money')}</b> 元/访客、访客 <b>{fhtml(primary_uv,'num')}</b>。{refund_note}")
    if second:
        insights.append(
            f"第二类目 <b>{escape(second_name)}</b> 支付 <b>{fhtml(second_pay,'money')}</b>；其余类目合计 <b>{fhtml(others_pay,'money')}</b>。"
            f"主力类目集中度为 {primary_share:.1f}%，是否扩品或加推需结合毛利、库存和连续周期表现。")
    if primary_pay_daily and len(primary_pay_daily) >= 2:
        mx = max(range(len(primary_pay_daily)), key=lambda i: primary_pay_daily[i])
        mn = min(range(len(primary_pay_daily)), key=lambda i: primary_pay_daily[i])
        insights.append(
            f"{escape(primary_name)}支付峰值 <b>{days[mx][5:]}</b>（{fhtml(primary_pay_daily[mx],'money')}），谷值 <b>{days[mn][5:]}</b>（{fhtml(primary_pay_daily[mn],'money')}）；"
            f"转化率周期内 {min(primary_rate_daily):.2f}%~{max(primary_rate_daily):.2f}%。")
    insights_html = "".join(f"<li>{i}</li>" for i in insights)

    def card(label, value, sub=""):
        return f'''<div class="card"><div class="card-label">{label}</div>
<div class="card-value">{value}</div>{f'<div class="card-sub">{sub}</div>' if sub else ""}</div>'''

    html = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>店铺驾驶舱 类目维度12字段 周报（{label}）</title>
<style>
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f5f6fa; color: #222; padding: 24px; }}
.wrap {{ max-width: 1160px; margin: 0 auto; }}
h1 {{ font-size: 22px; margin-bottom: 4px; }}
.sub {{ color: #888; font-size: 13px; margin-bottom: 20px; }}
.sub.green {{ color: #0a9d58; font-weight: 600; }}
.sub.orange {{ color: #f0a500; font-weight: 600; }}
.cards {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 22px; }}
.card {{ background: #fff; border-radius: 10px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,.07); }}
.card-label {{ font-size: 12px; color: #888; margin-bottom: 6px; }}
.card-value {{ font-size: 19px; font-weight: 700; }}
.card-sub {{ font-size: 12px; color: #666; margin-top: 4px; }}
.section {{ background: #fff; border-radius: 10px; padding: 18px 20px; margin-bottom: 22px; box-shadow: 0 1px 3px rgba(0,0,0,.07); }}
.section h2 {{ font-size: 16px; margin-bottom: 14px; border-left: 4px solid #2f6fed; padding-left: 10px; }}
.section h2.red {{ border-left-color: #e05b5b; }}
.section h2.green {{ border-left-color: #0a9d58; }}
.section h2.orange {{ border-left-color: #f0a500; }}
table {{ width: 100%; border-collapse: collapse; font-size: 12.5px; }}
th {{ background: #f0f3f9; font-weight: 600; padding: 8px 6px; border-bottom: 2px solid #d7deea; white-space: nowrap; }}
td {{ padding: 7px 6px; border-bottom: 1px solid #eef1f6; text-align: right; white-space: nowrap; }}
td:first-child, th:first-child {{ text-align: left; }}
tr:hover td {{ background: #fafbfe; }}
tr.total td {{ background: #fff8e6; font-weight: 600; }}
.strong {{ font-weight: 600; }}
.muted {{ color: #999; }}
.warn {{ background: #fff4e5; border-left: 4px solid #f59e0b; padding: 12px; }}
.up {{ color: #c00; }}
.down {{ color: #008000; }}
.insights li {{ margin-bottom: 8px; line-height: 1.6; font-size: 13.5px; }}
.two-col {{ display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }}
.three-col {{ display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px; }}
@media (max-width: 900px) {{ .two-col, .three-col {{ grid-template-columns: 1fr; }} }}
.scroll {{ overflow-x: auto; }}
</style></head><body><div class="wrap">

<h1>店铺驾驶舱 · 类目维度12字段 周报</h1>
<div class="sub">{escape(shop_name)} ｜ 用户要求周期：{requested_start} 至 {requested_end} ｜ 实际覆盖：{days[0]} 至 {days[-1]} ｜ 口径：商品级按本次实际类目聚合（{len(cates)}类目）</div>
{f'<div class="section"><div class="warn">本次仅部分覆盖，缺少：{", ".join(missing_days)}。以下金额、占比与排名只基于实际返回日期，不代表完整请求周期。</div></div>' if missing_days else ''}

<div class="cards">
{card("店铺支付金额", fhtml(total_pay, "money"), "类目聚合口径")}
{card(escape(primary_name) + "支付金额", fhtml(primary_pay, "money"), f"占 {primary_share:.1f}%")}
{card(escape(primary_name) + "转化率", fhtml(primary_rate, "pct"), "访客 " + fhtml(primary_uv, "num"))}
{card(escape(primary_name) + "退款金额", fhtml(primary_refund, "money"), "金额口径")}
{card(escape(primary_name) + "访客平均价值", fhtml(primary_uvavg, "money"), "元/访客")}
{card((escape(second_name) if second_name else "第二类目") + "支付金额", fhtml(second_pay, "money"), "类目第 2" if second_name else "无")}
{card("有成交类目数", f"{n_payable}/{len(cates)}", "其余合计 " + fhtml(others_pay, "money"))}
</div>

<div class="section">
<h2>一、类目支付结构</h2>
<div class="sub">按支付金额排序，直接展示金额与店铺占比；长尾合并为“其他有成交类目”。</div>
{svg_bar_pay}
</div>

<div class="section">
<h2>二、主力类目每日走势</h2>
<div class="three-col">
<div><div class="sub">{escape(primary_name)}·支付金额（元）</div>{svg_primary_pay}</div>
<div><div class="sub green">{escape(primary_name)}·支付转化率（%，聚焦刻度）</div>{svg_primary_rate}</div>
<div><div class="sub orange">{escape(second_name) if second_name else '第二类目'}·支付金额（元）</div>{svg_second_pay}</div>
</div>
</div>

<div class="section">
<h2>三、类目周期汇总（按支付金额降序）</h2>
<div class="sub">支付买家数为商品/类目口径的买家次数，跨类目可能重复，不等同于店铺去重买家数；合计平均停留时长按商品访客加权。</div>
<div class="scroll"><table>
<tr><th>类目</th>{''.join(f'<th>{label}</th>' for _, label, _ in FIELDS)}<th>支付占比</th></tr>
{rows_sum}
</table></div>
</div>

<div class="section">
<h2>四、Top {len(top_cates)} 类目每日明细与环比（红涨绿跌）</h2>
<div class="sub">访客平均价值 = 支付金额 ÷ 商品访客；首日环比使用展示期前一日基准，基准日不计入周期汇总</div>
<div class="scroll"><table>
<tr><th>类目</th><th>日期</th>{''.join(f'<th>{label}</th>' for _, label, _ in FIELDS)}{''.join(f'<th>{label}环比</th>' for _, label, _ in FIELDS)}</tr>
{rows_daily}
</table></div>
</div>

<div class="section">
<h2 class="red">五、关键洞察</h2>
<ul class="insights">{insights_html}</ul>
</div>

</div></body></html>"""

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    print("html ->", out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="item_top daily_trend 查询结果 JSON 文件")
    ap.add_argument("--out-dir", default="artifacts/xlsx/cate12", help="中间数据输出目录")
    ap.add_argument("--label", default="", help="报告标签，如 20260824_0830；空则从数据推断")
    ap.add_argument("--xlsx", default="", help="Excel 输出路径（默认 artifacts/xlsx/店铺_类目12_周报_<label>.xlsx）")
    ap.add_argument("--html", default="", help="HTML 输出路径（默认 artifacts/店铺_类目12_周报_<label>.html）")
    ap.add_argument("--shop-name", default="当前店铺", help="当前绑定店铺名称")
    ap.add_argument("--display-start", required=True, help="用户要求的正式周期开始日期 YYYY-MM-DD；不得改成实际返回首日")
    ap.add_argument("--display-end", required=True, help="用户要求的正式周期结束日期 YYYY-MM-DD；不得改成实际返回末日")
    args = ap.parse_args()

    with open(resolve(args.input), encoding="utf-8") as f:
        raw = json.load(f)
    agg = aggregate(raw, args.display_start, args.display_end)
    if not agg.get("cates"):
        raise SystemExit("本店商品明细未取得：输入未返回可核验的商品或类目数据，不生成类目报表")
    requested_label = args.display_start.replace("-", "") + "_" + args.display_end.replace("-", "")
    if args.label and args.label != requested_label:
        print(f"warning: --label {args.label} 与用户周期不一致，已改为 {requested_label}")
    args.label = requested_label
    out_dir = resolve(args.out_dir)
    os.makedirs(out_dir, exist_ok=True)
    agg_path = os.path.join(out_dir, "itemtop_cate_daily.json")
    with open(agg_path, "w", encoding="utf-8") as f:
        json.dump(agg, f, ensure_ascii=False, indent=1)
    print("agg ->", agg_path)

    xlsx = resolve(args.xlsx) if args.xlsx else resolve(f"artifacts/xlsx/店铺_类目12_周报_{args.label}.xlsx")
    html = resolve(args.html) if args.html else resolve(f"artifacts/店铺_类目12_周报_{args.label}.html")
    build_excel(agg, xlsx)
    build_html(agg, html, args.label, args.shop_name)
    print("done")


if __name__ == "__main__":
    main()
