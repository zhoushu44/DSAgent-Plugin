# -*- coding: utf-8 -*-
"""临时探针3：board 代码映射 + 最新交易日发现 + 字典解析（用完即删）"""
import json
import re
import urllib.parse
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
SINA_REF = {"User-Agent": UA, "Referer": "https://finance.sina.com.cn"}
DC = "https://datacenter-web.eastmoney.com/api/data/v1/get"


def raw(url, params=None, headers=None, enc="gbk"):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=headers or {"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode(enc, errors="replace")


def dc(report, filt=None, sort=None, stype=None, size=3):
    p = {"reportName": report, "columns": "ALL", "source": "WEB", "client": "WEB",
         "pageNumber": 1, "pageSize": size}
    if filt:
        p["filter"] = filt
    if sort:
        p["sortColumns"] = sort
        p["sortTypes"] = stype
    return json.loads(raw(DC, p, {"User-Agent": UA}, "utf-8"))


print("=== 1. RPT_CONCEPT_LIST / RPT_INDUSTRY_LIST 的 BOARD_CODE 格式 ===")
d = dc("RPT_CONCEPT_LIST", size=5)
if d.get("result"):
    for r in d["result"]["data"]:
        print("  概念:", r.get("BOARD_CODE"), r.get("BOARD_NAME"))
d = dc("RPT_INDUSTRY_LIST", size=5)
if d.get("result"):
    for r in d["result"]["data"]:
        print("  行业:", r.get("BOARD_CODE"), r.get("BOARD_NAME"))

print()
print("=== 2. 最新交易日发现（不带 filter，单列日期降序） ===")
for rpt, fld in (("RPT_DMSK_TS_FUNDFLOW", "TRADE_DATE"),
                 ("RPT_DAILYBILLBOARD_DETAILSNEW", "TRADE_DATE"),
                 ("RPT_F10_FINANCE_MAINFINADATA", "REPORT_DATE"),
                 ("RPT_LICO_FN_CPD", "REPORTDATE")):
    d = dc(rpt, sort=fld, stype=-1, size=1)
    if d.get("result"):
        row = d["result"]["data"][0]
        print(f"  {rpt} → {fld} = {row.get(fld)}  (count={d['result'].get('count')})")
    else:
        print(f"  {rpt} → FAIL {d.get('code')} {d.get('message')}")

print()
print("=== 3. 新浪行业字典解析（板块数 + 涨幅前5） ===")
t = raw("https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php", None, SINA_REF)
body = t.split("=", 1)[1].strip().rstrip(";")
hy = json.loads(body)
print("  行业板块数 =", len(hy))
items = []
for node, v in hy.items():
    p = v.split(",")
    items.append((float(p[5]), node, p[1], p[12], p[8]))
items.sort(reverse=True)
for x in items[:5]:
    print(f"    {x[1]} {x[2]} 涨跌幅={x[0]} 领涨={x[3]}({x[4]})")

print()
print("=== 4. 新浪概念字典解析（板块数 + 涨幅前5） ===")
t = raw("https://vip.stock.finance.sina.com.cn/q/view/newFLJK.php",
        {"param": "class"}, SINA_REF)
body = t.split("=", 1)[1].strip().rstrip(";")
gn = json.loads(body)
print("  概念板块数 =", len(gn))
items = []
for node, v in gn.items():
    p = v.split(",")
    items.append((float(p[5]), node, p[1], p[12], p[8]))
items.sort(reverse=True)
for x in items[:5]:
    print(f"    {x[1]} {x[2]} 涨跌幅={x[0]} 领涨={x[3]}({x[4]})")

print()
print("=== 5. 关键词检索：'芯片' 在字典中的命中 ===")
for kw in ("芯片", "半导体", "锂", "白酒", "军工"):
    hits_hy = [v.split(",")[1] for v in hy.values() if kw in v.split(",")[1]]
    hits_gn = [v.split(",")[1] for v in gn.values() if kw in v.split(",")[1]]
    print(f"  {kw}: 行业={hits_hy} 概念={hits_gn}")

print()
print("=== 6. 腾讯批量 20 码 ===")
codes = [r["symbol"] for r in json.loads(raw(
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
    "Market_Center.getHQNodeData",
    {"page": 1, "num": 20, "sort": "changepercent", "asc": 0, "node": "hs_a",
     "symbol": "", "_s_r_a": "page"}, SINA_REF))]
t = raw("https://qt.gtimg.cn/q=" + ",".join(codes), None, {"User-Agent": UA})
lines = [x for x in t.split(";") if "=" in x]
print(f"  请求 {len(codes)} 码 → 返回 {len(lines)} 行")
parts = lines[0].split('"')[1].split("~")
print(f"  首行 {parts[1]} 量比={parts[49]} 换手={parts[38]} 市值(亿)={parts[45]}")

print()
print("=== 7. RPT_DMSK_TS_STOCKNEW PE_DYNAMIC 升序 ===")
d = dc("RPT_DMSK_TS_STOCKNEW", filt="(PE_DYNAMIC>0)",
       sort="PE_DYNAMIC", stype=1, size=5)
if d.get("result"):
    print("  count =", d["result"]["count"])
    for r in d["result"]["data"]:
        print(f"    {r['SECURITY_CODE']} {r['SECURITY_NAME_ABBR']} "
              f"PE_DYNAMIC={r['PE_DYNAMIC']} CLOSE={r.get('CLOSE_PRICE')}")
else:
    print("  FAIL", d.get("code"), d.get("message"))
