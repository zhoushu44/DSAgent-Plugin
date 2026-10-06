# -*- coding: utf-8 -*-
"""临时探针：确认新浪/腾讯响应可解析性（用完即删）"""
import json
import urllib.parse
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
SINA_REF = {"User-Agent": UA, "Referer": "https://finance.sina.com.cn"}


def raw(url, params=None, headers=None, enc="gbk"):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=headers or {"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode(enc, errors="replace")


print("=== 1. 新浪排行 JSON 可解析性 ===")
t = raw("https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        "Market_Center.getHQNodeData",
        {"page": 1, "num": 3, "sort": "changepercent", "asc": 0,
         "node": "hs_a", "symbol": "", "_s_r_a": "page"}, SINA_REF)
print(repr(t[:400]))
try:
    j = json.loads(t)
    print("JSON OK, len =", len(j), "keys =", list(j[0].keys()))
except Exception as e:
    print("JSON FAIL:", e)

print()
print("=== 2. 新浪计数 ===")
t = raw("https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        "Market_Center.getHQNodeStockCount", {"node": "hs_a"}, SINA_REF)
print(repr(t[:200]))

print()
print("=== 3. 新浪行业字典 ===")
t = raw("https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php", None, SINA_REF)
print(repr(t[:200]))
print("len =", len(t))

print()
print("=== 4. 新浪概念字典 ===")
t = raw("https://vip.stock.finance.sina.com.cn/q/view/newFLJK.php",
        {"param": "class"}, SINA_REF)
print(repr(t[:200]))

print()
print("=== 5. suggest3 ===")
t = raw("https://suggest3.sinajs.cn/suggest/type=&key=" +
        urllib.parse.quote("茅台"), None, SINA_REF)
print(repr(t[:300]))

print()
print("=== 6. 腾讯个股 ===")
t = raw("https://qt.gtimg.cn/q=sh600519,sz300750", None, {"User-Agent": UA})
print(repr(t[:200]))
first = t.split(";")[0]
parts = first.split('"')[1].split("~")
print("字段数 =", len(parts))
print("3/4/5/6/33/34/38/39/43/44/45/46/49/53 =",
      parts[3], parts[4], parts[5], parts[6], parts[33], parts[34],
      parts[38], parts[39], parts[43], parts[44], parts[45], parts[46],
      parts[49], parts[53])
