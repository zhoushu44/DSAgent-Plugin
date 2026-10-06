# -*- coding: utf-8 -*-
"""临时探针2：校准新浪字段单位（用完即删）"""
import json
import urllib.parse
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
SINA_REF = {"User-Agent": UA, "Referer": "https://finance.sina.com.cn"}
NODE = ("https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        "Market_Center.getHQNodeData")


def raw(url, params=None, headers=None, enc="gbk"):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=headers or {"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode(enc, errors="replace")


def q(sort, asc, num=3, node="hs_a"):
    return json.loads(raw(NODE, {"page": 1, "num": num, "sort": sort, "asc": asc,
                                 "node": node, "symbol": "", "_s_r_a": "page"},
                          SINA_REF))


print("=== A. mktcap 降序（应为银行/大市值） ===")
for r in q("mktcap", 0):
    print(f"  {r['code']} {r['name']} trade={r['trade']} mktcap={r['mktcap']} "
          f"nmc={r['nmc']} volume={r['volume']} amount={r['amount']}")

print()
print("=== B. 600519 校准（腾讯总市值 15673.52 亿 / 流通 15673.52 亿） ===")
for r in q("mktcap", 0, 100, "sh_a"):
    if r["code"] == "600519":
        print(f"  {r['code']} {r['name']} trade={r['trade']} mktcap={r['mktcap']} "
              f"nmc={r['nmc']} volume={r['volume']} amount={r['amount']} "
              f"turnover={r['turnoverratio']} per={r['per']} pb={r['pb']} "
              f"high={r['high']} low={r['low']} settlement={r['settlement']}")
        print(f"  → mktcap/10000 = {float(r['mktcap'])/10000} 亿")

print()
print("=== C. per 降序（正常 PE 应为正数小额） ===")
for r in q("per", 0):
    print(f"  {r['code']} {r['name']} per={r['per']} pb={r['pb']}")

print()
print("=== D. turnoverratio 降序 ===")
for r in q("turnoverratio", 0):
    print(f"  {r['code']} {r['name']} turnover={r['turnoverratio']}")

print()
print("=== E. 跌停/涨停下 amount 单位（对比腾讯 sh600519 成交额万=308853） ===")
print("  腾讯成交额(万)=308853 → 元 = 3088530000")

print()
print("=== F. node 计数端点（多节点） ===")
CNT = ("https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
       "Market_Center.getHQNodeStockCount")
for nd in ("hs_a", "sh_a", "sz_a", "cyb", "kcb", "hs_bjs"):
    print(f"  {nd} = {raw(CNT, {'node': nd}, SINA_REF)}")
