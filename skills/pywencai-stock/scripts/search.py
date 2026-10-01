#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
A 股行情数据查询（东方财富公开接口，无需登录、无需 Key）

用法：
    python scripts/search.py gainers --n 10
    python scripts/search.py losers --n 10
    python scripts/search.py limitup
    python scripts/search.py limitdown
    python scripts/search.py concepts --n 20
    python scripts/search.py sectors --n 20
    python scripts/search.py board --name 芯片
    python scripts/search.py stock --code 600519
    python scripts/search.py flow --n 20
    python scripts/search.py billboard --n 30
    python scripts/search.py pe --n 20
    python scripts/search.py roe --n 20
    python scripts/search.py profit --n 20
    python scripts/search.py search --query 茅台

无参数调用时默认输出沪深 A 股涨幅榜；若环境变量 DSAGENT_REQUEST 中能识别出
意图（跌停/涨停/龙虎榜/概念/资金流…），则按识别出的意图执行。
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

# ---- 共享运行时 ----------------------------------------------------------
# 优先复用 DSAgent 共享 runtime（插件侧 {DSAGENT_SKILL_ROOT}/.dsagent/runtime/）；
# 宿主侧（app/assets/skills）没有该包，降级为本地实现，保证两种宿主下行为一致。
RESULT_PREFIX = "__DSAGENT_RESULT__"
FAILURE_API = "api_error"


def log(msg: str) -> None:
    """进度日志 → stderr，stdout 只留给最终结果。"""
    print(msg, file=sys.stderr, flush=True)


def output_result(data) -> None:
    """最终结果 → stdout（__DSAGENT_RESULT__ 前缀单行 JSON）。"""
    print(f"{RESULT_PREFIX}{json.dumps(data, ensure_ascii=False)}")


try:
    _dsagent_dir = os.path.join(os.environ.get("DSAGENT_SKILL_ROOT", ""), ".dsagent")
    if _dsagent_dir and _dsagent_dir not in sys.path:
        sys.path.insert(0, _dsagent_dir)
    from runtime.dsagent_runtime import log, output_result, FAILURE_API  # noqa: E402,F811
except ImportError:
    pass

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

CLIST_URL = "https://push2.eastmoney.com/api/qt/clist/get"
STOCK_URL = "https://push2.eastmoney.com/api/qt/stock/get"
ZT_URL = "https://push2ex.eastmoney.com/getTopicZTPool"
DT_URL = "https://push2ex.eastmoney.com/getTopicDTPool"
DC_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get"
SUGGEST_URL = "https://searchapi.eastmoney.com/api/suggest/get"

# 沪深 A 股：沪主板/科创 + 深主板/创业
FS_HS_A = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23"
FS_CONCEPT = "m:90+t:3"
FS_INDUSTRY = "m:90+t:2"

FIELDS_QUOTE = "f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f115"
FIELDS_FLOW = "f2,f3,f12,f14,f62,f66,f69,f72,f75,f78,f81,f84,f87,f184"
FIELDS_BOARD = "f2,f3,f4,f8,f12,f14,f104,f105,f106,f128,f140,f141"
FIELDS_STOCK = ("f43,f44,f45,f46,f47,f48,f57,f58,f60,f105,f116,f117,f162,f167,f168,"
                "f169,f170,f171,f173,f183,f184,f185,f186,f187,f188")

SUGGEST_TOKEN = "D43BF722C8E33BDC906FB84D85E326E8"

COMMANDS = ("gainers", "losers", "limitup", "limitdown", "concepts", "sectors",
            "board", "stock", "flow", "billboard", "pe", "roe", "profit", "search")


# ---- HTTP ---------------------------------------------------------------
def http_json(url, params=None, headers=None):
    """GET 并解析 JSON。返回 (数据, 错误信息)。"""
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    hdr = {"User-Agent": UA, "Referer": "https://quote.eastmoney.com/"}
    if headers:
        hdr.update(headers)
    req = urllib.request.Request(url, headers=hdr)
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except Exception as e:  # 网络层失败
        return None, f"请求失败: {e}"
    try:
        return json.loads(raw), None
    except Exception as e:
        return None, f"响应解析失败: {e}"


def _num(v):
    """东财常以 '-' 表示无数据。"""
    if v is None or v == "-" or v == "":
        return None
    return v


def _r2(v):
    """涨跌停池返回的是长浮点，统一保留 2 位。"""
    if v is None or v == "-" or v == "":
        return None
    try:
        return round(float(v), 2)
    except Exception:
        return v


def _pool_price(p):
    """涨跌停池价格字段为 价格×1000。"""
    if p is None:
        return None
    try:
        return round(float(p) / 1000, 2)
    except Exception:
        return None


def _fmt_time(v):
    """封板时间 92500 → 09:25:00"""
    try:
        s = str(int(v)).zfill(6)
        return f"{s[0:2]}:{s[2:4]}:{s[4:6]}"
    except Exception:
        return None


# ---- 通用列表接口 --------------------------------------------------------
def clist(fs, fields, fid="f3", po=1, n=20, page=1):
    """东方财富列表接口。po=1 降序，po=0 升序。单页上限 100。"""
    params = {"pn": page, "pz": min(int(n), 100), "po": po, "np": 1,
              "fltt": 2, "invt": 2, "fid": fid, "fs": fs, "fields": fields}
    data, err = http_json(CLIST_URL, params)
    if err:
        return None, None, err
    if not isinstance(data, dict) or data.get("data") is None:
        return None, None, "接口返回空数据"
    d = data["data"]
    return d.get("diff") or [], d.get("total"), None


def quote_rows(fs, n, fid, po, fields=FIELDS_QUOTE):
    rows, total, err = clist(fs, fields, fid=fid, po=po, n=n)
    if err:
        return None, err
    out = []
    for r in rows[:n]:
        row = {
            "代码": r.get("f12"),
            "名称": r.get("f14"),
            "最新价": _num(r.get("f2")),
            "涨跌幅": _num(r.get("f3")),
            "涨跌额": _num(r.get("f4")),
            "成交量(手)": _num(r.get("f5")),
            "成交额": _num(r.get("f6")),
            "振幅": _num(r.get("f7")),
            "换手率": _num(r.get("f8")),
            "市盈率(动)": _num(r.get("f9")),
            "量比": _num(r.get("f10")),
            "最高": _num(r.get("f15")),
            "最低": _num(r.get("f16")),
            "今开": _num(r.get("f17")),
            "昨收": _num(r.get("f18")),
            "总市值": _num(r.get("f20")),
            "流通市值": _num(r.get("f21")),
            "市净率": _num(r.get("f23")),
        }
        if "f173" in fields:
            row["ROE"] = _num(r.get("f173"))
        out.append(row)
    return {"data": out, "total": total}, None


# ---- 各子命令 ------------------------------------------------------------
def cmd_gainers(n):
    r, err = quote_rows(FS_HS_A, n, "f3", 1)
    if err:
        return None, err
    return {"title": f"沪深A股涨幅榜 TOP{n}", **r}, None


def cmd_losers(n):
    r, err = quote_rows(FS_HS_A, n, "f3", 0)
    if err:
        return None, err
    return {"title": f"沪深A股跌幅榜 TOP{n}", **r}, None


def _topic_pool(url, sort, n, days_back=7):
    """涨停/跌停池：必须带 date，非交易日/未更新时向前回溯。"""
    day = datetime.now()
    for _ in range(days_back):
        params = {"ut": "7eea3edcaed734bea9cbfc24409ed989", "dpt": "wz.ztzt",
                  "Pageindex": 0, "pagesize": min(int(n), 200),
                  "sort": sort, "date": day.strftime("%Y%m%d"),
                  "_": int(time.time() * 1000)}
        data, err = http_json(url, params)
        if err:
            return None, None, err
        if isinstance(data, dict) and data.get("data"):
            return data["data"], None, None
        day = day - timedelta(days=1)
    return None, None, "近 7 个交易日均无数据"


def cmd_limitup(n):
    d, err, e = _topic_pool(ZT_URL, "fbt:asc", n)
    if e:
        return None, e
    pool = d.get("pool") or []
    rows = []
    for r in pool[:n]:
        rows.append({
            "代码": r.get("c"),
            "名称": r.get("n"),
            "最新价": _pool_price(r.get("p")),
            "涨跌幅": _r2(r.get("zdp")),
            "成交额": _r2(r.get("amount")),
            "换手率": _r2(r.get("hs")),
            "连板数": r.get("lbc"),
            "首次封板": _fmt_time(r.get("fbt")),
            "最后封板": _fmt_time(r.get("lbt")),
            "封单资金": _r2(r.get("fund")),
            "炸板次数": r.get("zbc"),
            "流通市值": _r2(r.get("ltsz")),
            "所属行业": r.get("hybk"),
        })
    return {"title": f"涨停股池（{d.get('qdate')}）", "data": rows, "total": d.get("tc")}, None


def cmd_limitdown(n):
    d, err, e = _topic_pool(DT_URL, "fund:asc", n)
    if e:
        return None, e
    pool = d.get("pool") or []
    rows = []
    for r in pool[:n]:
        rows.append({
            "代码": r.get("c"),
            "名称": r.get("n"),
            "最新价": _pool_price(r.get("p")),
            "涨跌幅": _r2(r.get("zdp")),
            "成交额": _r2(r.get("amount")),
            "换手率": _r2(r.get("hs")),
            "封单资金": _r2(r.get("fund")),
            "最后封板": _fmt_time(r.get("lbt")),
            "连续跌停天数": r.get("days"),
            "开板次数": r.get("oc"),
            "流通市值": _r2(r.get("ltsz")),
            "所属行业": r.get("hybk"),
        })
    return {"title": f"跌停股池（{d.get('qdate')}）", "data": rows, "total": d.get("tc")}, None


def _board_rows(fs, n, fid="f3", po=1):
    rows, total, err = clist(fs, FIELDS_BOARD, fid=fid, po=po, n=n)
    if err:
        return None, err
    out = []
    for r in rows[:n]:
        out.append({
            "代码": r.get("f12"),
            "名称": r.get("f14"),
            "涨跌幅": _num(r.get("f3")),
            "涨跌额": _num(r.get("f4")),
            "换手率": _num(r.get("f8")),
            "上涨家数": _num(r.get("f104")),
            "下跌家数": _num(r.get("f105")),
            "领涨股": r.get("f128"),
            "领涨股代码": r.get("f140"),
        })
    return {"data": out, "total": total}, None


def cmd_concepts(n):
    r, err = _board_rows(FS_CONCEPT, n)
    if err:
        return None, err
    return {"title": f"概念板块涨幅榜 TOP{n}", **r}, None


def cmd_sectors(n):
    r, err = _board_rows(FS_INDUSTRY, n)
    if err:
        return None, err
    return {"title": f"行业板块涨幅榜 TOP{n}", **r}, None


def suggest(kw, count=10):
    params = {"input": kw, "type": "14", "token": SUGGEST_TOKEN, "count": count}
    data, err = http_json(SUGGEST_URL, params)
    if err:
        return None, err
    return ((data or {}).get("QuotationCodeTable") or {}).get("Data") or [], None


def resolve_board_code(name_or_code):
    """板块名/代码 → BK 代码。suggest 需较大 count 才会返回板块条目。"""
    s = (name_or_code or "").strip().upper()
    if re.fullmatch(r"BK\d{4}", s):
        return s, None
    rows, err = suggest(name_or_code, count=50)
    if err:
        return None, err
    boards = [r for r in rows
              if str(r.get("MktNum")) == "90" and str(r.get("Code", "")).startswith("BK")]
    if not boards:
        return None, f"未找到板块「{name_or_code}」"
    # 名称完全相同优先，否则取第一个
    for r in boards:
        if r.get("Name") == name_or_code:
            return r.get("Code"), None
    return boards[0].get("Code"), None


def cmd_board(name, n):
    code, err = resolve_board_code(name)
    if err:
        return None, err
    r, e = quote_rows(f"b:{code}", n, "f3", 1)
    if e:
        return None, e
    return {"title": f"板块 {code} 成分股涨幅榜 TOP{n}", "board_code": code, **r}, None


def resolve_secid(code):
    """股票代码 → secid（1.=沪市 0.=深市/北交所）"""
    code = str(code).strip()
    rows, _ = suggest(code, count=10)
    for r in rows or []:
        if str(r.get("Code")) == code and r.get("QuoteID"):
            return r.get("QuoteID"), r.get("Name")
    prefix = "1" if code.startswith(("6", "5", "9")) and not code.startswith("92") else "0"
    return f"{prefix}.{code}", None


def cmd_stock(code):
    secid, name = resolve_secid(code)
    params = {"fltt": 2, "invt": 2, "secid": secid, "fields": FIELDS_STOCK}
    data, err = http_json(STOCK_URL, params)
    if err:
        return None, err
    d = (data or {}).get("data")
    if not d:
        return None, f"未查询到股票「{code}」的行情数据"
    row = {
        "代码": d.get("f57"),
        "名称": d.get("f58") or name,
        "最新价": _num(d.get("f43")),
        "涨跌幅": _num(d.get("f170")),
        "涨跌额": _num(d.get("f169")),
        "最高": _num(d.get("f44")),
        "最低": _num(d.get("f45")),
        "今开": _num(d.get("f46")),
        "昨收": _num(d.get("f60")),
        "成交量(手)": _num(d.get("f47")),
        "成交额": _num(d.get("f48")),
        "振幅": _num(d.get("f171")),
        "换手率": _num(d.get("f168")),
        "市盈率": _num(d.get("f162")),
        "市净率": _num(d.get("f167")),
        "总市值": _num(d.get("f116")),
        "流通市值": _num(d.get("f117")),
        "净利润": _num(d.get("f105")),
        "营业收入": _num(d.get("f183")),
        "营收同比": _num(d.get("f184")),
        "净利同比": _num(d.get("f185")),
        "毛利率": _num(d.get("f186")),
        "净利率": _num(d.get("f187")),
        "负债率": _num(d.get("f188")),
        "ROE": _num(d.get("f173")),
    }
    return {"title": f"{row['名称']}（{row['代码']}）行情与财务", "data": [row], "total": 1}, None


def cmd_flow(n):
    rows, total, err = clist(FS_HS_A, FIELDS_FLOW, fid="f62", po=1, n=n)
    if err:
        return None, err
    out = []
    for r in rows[:n]:
        out.append({
            "代码": r.get("f12"),
            "名称": r.get("f14"),
            "最新价": _num(r.get("f2")),
            "涨跌幅": _num(r.get("f3")),
            "主力净流入": _num(r.get("f62")),
            "主力净占比": _num(r.get("f184")),
            "超大单净额": _num(r.get("f66")),
            "超大单净占比": _num(r.get("f69")),
            "大单净额": _num(r.get("f72")),
            "大单净占比": _num(r.get("f75")),
            "中单净额": _num(r.get("f78")),
            "小单净额": _num(r.get("f84")),
        })
    return {"title": f"主力资金净流入榜 TOP{n}", "data": out, "total": total}, None


def cmd_billboard(n, date=None):
    params = {"reportName": "RPT_DAILYBILLBOARD_DETAILSNEW", "columns": "ALL",
              "source": "WEB", "client": "WEB", "pageNumber": 1,
              "pageSize": min(int(n), 500),
              "sortColumns": "TRADE_DATE,BILLBOARD_NET_AMT", "sortTypes": "-1,-1"}
    if date:
        params["filter"] = f"(TRADE_DATE='{date} 00:00:00')"
    data, err = http_json(DC_URL, params)
    if err:
        return None, err
    if not isinstance(data, dict) or not data.get("result"):
        return None, "龙虎榜返回空数据（该日期可能无数据）"
    res = data["result"]
    rows = res.get("data") or []
    out = []
    for r in rows[:n]:
        out.append({
            "交易日期": str(r.get("TRADE_DATE") or "")[:10],
            "代码": r.get("SECURITY_CODE"),
            "名称": r.get("SECURITY_NAME_ABBR"),
            "收盘价": _num(r.get("CLOSE_PRICE")),
            "涨跌幅": _num(r.get("CHANGE_RATE")),
            "换手率": _num(r.get("TURNOVERRATE")),
            "龙虎榜净买额": _num(r.get("BILLBOARD_NET_AMT")),
            "龙虎榜买入额": _num(r.get("BILLBOARD_BUY_AMT")),
            "龙虎榜卖出额": _num(r.get("BILLBOARD_SELL_AMT")),
            "上榜原因": r.get("EXPLANATION"),
        })
    return {"title": "龙虎榜（按净买额降序）", "data": out, "total": res.get("count")}, None


def cmd_pe(n):
    """市盈率(动)最低。f9 的 po 方向与常规相反：po=1 为升序。"""
    r, err = quote_rows(FS_HS_A, n, "f9", 1)
    if err:
        return None, err
    return {"title": f"沪深A股市盈率(动)最低 TOP{n}", **r}, None


def cmd_roe(n):
    r, err = quote_rows(FS_HS_A, n, "f173", 1, FIELDS_QUOTE + ",f173")
    if err:
        return None, err
    return {"title": f"沪深A股ROE最高 TOP{n}", **r}, None


def cmd_profit(n):
    """净利润最高（业绩报表，按最新报告期倒序取）。"""
    params = {"reportName": "RPT_LICO_FN_CPD", "columns": "ALL",
              "source": "WEB", "client": "WEB", "pageNumber": 1,
              "pageSize": min(int(n), 500),
              "sortColumns": "REPORTDATE,PARENT_NETPROFIT", "sortTypes": "-1,-1"}
    data, err = http_json(DC_URL, params)
    if err:
        return None, err
    if not isinstance(data, dict) or not data.get("result"):
        return None, "业绩报表返回空数据"
    res = data["result"]
    out = []
    for r in (res.get("data") or [])[:n]:
        out.append({
            "代码": r.get("SECURITY_CODE"),
            "名称": r.get("SECURITY_NAME_ABBR"),
            "报告期": str(r.get("REPORTDATE") or "")[:10],
            "净利润": _num(r.get("PARENT_NETPROFIT")),
            "营业收入": _num(r.get("TOTAL_OPERATE_INCOME")),
            "每股收益": _num(r.get("BASIC_EPS")),
            "每股净资产": _num(r.get("BPS")),
            "加权ROE": _num(r.get("WEIGHTAVG_ROE")),
            "营收同比": _num(r.get("YSTZ")),
            "净利同比": _num(r.get("SJLTZ")),
            "毛利率": _num(r.get("XSMLL")),
            "行业": r.get("BOARD_NAME"),
        })
    return {"title": "净利润最高（最新报告期）", "data": out, "total": res.get("count")}, None


def cmd_search(kw, n):
    rows, err = suggest(kw, count=min(int(n), 20))
    if err:
        return None, err
    out = []
    for r in rows[:n]:
        out.append({
            "代码": r.get("Code"),
            "名称": r.get("Name"),
            "类型": r.get("SecurityTypeName"),
            "市场": r.get("MktNum"),
            "secid": r.get("QuoteID"),
        })
    return {"title": f"搜索「{kw}」", "data": out, "total": len(out)}, None


# ---- 参数与意图 ----------------------------------------------------------
def _int_or(v, default):
    try:
        return max(1, min(int(v), 500))
    except Exception:
        return default


def parse_argv(argv):
    """解析参数；返回 (命令, 选项 dict)。

    子命令不限定在首位：插件侧 normalizeArgs 可能把 `--n <值>` 插到子命令之前
    （SKILL.md 里第一条用法行是 `... search.py --n 20`，会按该 flag 改写参数首项）。
    """
    cmd = None
    for i, a in enumerate(argv):
        if a in COMMANDS:
            cmd = a
            argv = argv[:i] + argv[i + 1:]
            break

    opts = {}
    bare = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a.startswith("--"):
            key = a[2:]
            val = argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("--") else "1"
            opts[key] = val
            i += 2 if (i + 1 < len(argv) and not argv[i + 1].startswith("--")) else 1
        else:
            bare.append(a)
            i += 1
    # 位置参数：3 位以内数字视为条数，其余（含 6 位股票代码、自然语言）视为查询线索
    for b in bare:
        if b.isdigit() and len(b) <= 3:
            opts.setdefault("n", b)
        else:
            opts.setdefault("query", b)
    return cmd, opts


def guess_intent(request):
    """从自然语言请求中粗略识别意图，作为无参数调用的兜底。"""
    t = request or ""
    if guess_code(t):
        return "stock"
    rules = [
        ("limitdown", ("跌停",)),
        ("limitup", ("涨停", "封板")),
        ("billboard", ("龙虎榜", "席位")),
        ("flow", ("资金流", "净流入", "主力")),
        ("profit", ("净利润",)),
        ("pe", ("市盈率", "估值最低")),
        ("roe", ("ROE", "净资产收益率")),
        ("losers", ("跌幅", "下跌", "领跌")),
        ("gainers", ("涨幅", "上涨", "领涨")),
        ("concepts", ("概念",)),
        ("sectors", ("行业板块", "板块")),
    ]
    for cmd, keys in rules:
        if any(k in t for k in keys):
            return cmd
    return None


def guess_code(request):
    """从请求里抓 6 位股票代码。"""
    m = re.search(r"(?<!\d)([036]\d{5})(?!\d)", request or "")
    return m.group(1) if m else None


# ---- 入口 ---------------------------------------------------------------
def main():
    argv = list(sys.argv[1:])
    cmd, opts = parse_argv(argv)
    n = _int_or(opts.get("n") or opts.get("limit"), 10)
    request = os.environ.get("DSAGENT_REQUEST", "")

    if cmd is None:
        cmd = guess_intent(request) or "gainers"
        log(f"[pywencai-stock] 未指定子命令，按意图执行: {cmd}")

    log(f"[pywencai-stock] 执行: {cmd} (n={n})")

    if cmd == "gainers":
        res, err = cmd_gainers(n)
    elif cmd == "losers":
        res, err = cmd_losers(n)
    elif cmd == "limitup":
        res, err = cmd_limitup(n)
    elif cmd == "limitdown":
        res, err = cmd_limitdown(n)
    elif cmd == "concepts":
        res, err = cmd_concepts(n)
    elif cmd == "sectors":
        res, err = cmd_sectors(n)
    elif cmd == "board":
        name = opts.get("name") or opts.get("code") or opts.get("board")
        if not name:
            res, err = None, "board 需要 --name 或 --code（如 --name 芯片 / --code BK0493）"
        else:
            res, err = cmd_board(name, n)
    elif cmd == "stock":
        code = opts.get("code") or guess_code(request)
        if not code:
            res, err = None, "stock 需要 --code（如 --code 600519）"
        else:
            res, err = cmd_stock(code)
    elif cmd == "flow":
        res, err = cmd_flow(n)
    elif cmd == "billboard":
        res, err = cmd_billboard(n, opts.get("date"))
    elif cmd == "pe":
        res, err = cmd_pe(n)
    elif cmd == "roe":
        res, err = cmd_roe(n)
    elif cmd == "profit":
        res, err = cmd_profit(n)
    elif cmd == "search":
        kw = opts.get("query") or opts.get("q") or opts.get("name")
        if not kw:
            res, err = None, "search 需要 --query（如 --query 茅台）"
        else:
            res, err = cmd_search(kw, n)
    else:
        res, err = None, f"未知子命令: {cmd}"

    if err:
        log(f"[pywencai-stock] 失败: {err}")
        output_result({"ok": False, "error": err, "error_message": err,
                       "failure_kind": FAILURE_API, "data": [], "total": 0})
        sys.exit(1)

    data = res.get("data") or []
    log(f"[pywencai-stock] 成功，返回 {len(data)} 条")
    output_result({
        "ok": True,
        "source": "eastmoney",
        "title": res.get("title", ""),
        "data": data,
        "total": res.get("total", len(data)),
    })


if __name__ == "__main__":
    main()
