#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
知乎创作数据采集与分析脚本 — DSAgent zhihu-analytics v1.0

通过本地 Chrome（CDP + 已登录 zhihu profile）在页面上下文内 fetch 知乎创作中心接口，
取回当前账号下全部创作的阅读/赞同/评论/收藏/分享/涨粉数据，以及单篇汇总与日趋势。

关键前置：接口位于 www.zhihu.com 域，需要页面自己的 x-zse-96 签名 →
因此必须「在页面内 fetch」，不能在 Python 侧直接拼请求。
实测踩坑（已规避）：
  - type=all 返回 {"msg":"error type","code":"10002"}，必须传 article/answer/pin
  - content/list 的 data[] 不带标题，靠下标与 creations/v2/all 对齐
  - 单次 page.evaluate 跑长循环会挂死不返回 → 一次只发一个 URL
  - visitor_portrait 未开通 DMP 时返回 status: updating，属正常降级
  - /api/v4/me 在 zhuanlan.zhihu.com 下 404，探登录态必须在 www 域
  - 响应体 slice 上限需 ≥ 60000，否则 daily/aggr 被截断导致 JSON 解析失败
"""

import argparse
import csv
import datetime
import io
import json
import os
import subprocess
import sys
import time
import urllib.request

# ── 引入 dsagent_runtime ──
_dsagent_dir = os.path.join(os.environ.get("DSAGENT_SKILL_ROOT", ""), ".dsagent")
if _dsagent_dir and _dsagent_dir not in sys.path:
    sys.path.insert(0, _dsagent_dir)

from runtime.dsagent_runtime import log, output_result, output_summary, output_files
from runtime.dsagent_runtime import FAILURE_RISK, FAILURE_TOKEN, FAILURE_PARSE, FAILURE_API

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

BJT = datetime.timezone(datetime.timedelta(hours=8))
BASE = "https://www.zhihu.com"

CHROME_PATH = os.environ.get(
    "ZHIHU_CHROME_PATH", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
PROFILE_DIR = os.environ.get(
    "ZHIHU_PROFILE_DIR",
    r"C:\Users\Administrator\.dsh\browser-profiles\accounts\zhihu_b6e693fd522a184552486607f38126dd")
CDP_PORT = int(os.environ.get("ZHIHU_CDP_PORT", "9471"))
CDP = f"http://127.0.0.1:{CDP_PORT}"

MODES = ("overview", "list", "article", "trend")
TYPES = ("article", "answer", "pin")
MAX_LIMIT = 50
MAX_DAYS = 365
BODY_SLICE = 60000
THROTTLE = 2.0


class FetchError(Exception):
    """采集失败，携带 failure_kind"""

    def __init__(self, failure_kind, message):
        super().__init__(message)
        self.failure_kind = failure_kind
        self.message = message


# ── 页面内 fetch：一次一个 URL ──
FETCH_JS = """async (url) => {
  try {
    const r = await fetch(url, {credentials:'include'});
    return {status:r.status, body:(await r.text()).slice(0, %d)};
  } catch(e) { return {status:-1, body:String(e).slice(0,300)}; }
}""" % BODY_SLICE


def cdp_up():
    try:
        urllib.request.urlopen(CDP + "/json/version", timeout=2)
        return True
    except Exception:
        return False


def launch_chrome():
    """杀掉占用端口的旧实例，用 zhihu profile 重起一个带 CDP 的 Chrome。"""
    if not os.path.exists(CHROME_PATH):
        raise FetchError("skill_error", f"Chrome 不存在: {CHROME_PATH}")
    if not os.path.isdir(PROFILE_DIR):
        raise FetchError("skill_error", f"zhihu profile 不存在: {PROFILE_DIR}")

    subprocess.run(
        ["powershell", "-c",
         "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
         f"?{{$_.CommandLine -match 'remote-debugging-port={CDP_PORT}'}} | "
         "%{Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue}"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    proc = subprocess.Popen(
        [CHROME_PATH, f"--remote-debugging-port={CDP_PORT}", f"--user-data-dir={PROFILE_DIR}",
         "--no-first-run", "--no-default-browser-check",
         "--disable-blink-features=AutomationControlled",
         "--window-size=1600,1000", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(25):
        time.sleep(1)
        if cdp_up():
            return proc
    proc.terminate()
    raise FetchError("skill_error", "Chrome CDP 启动失败")


def fetch_json(page, url, what):
    """页面内 GET 一个 URL，返回解析后的 dict。失败抛 FetchError。"""
    THROTTLE and time.sleep(THROTTLE)
    r = page.evaluate(FETCH_JS, url)
    status = r.get("status")
    body = r.get("body", "")
    if status != 200:
        raise FetchError(FAILURE_API if status != 403 else FAILURE_RISK,
                         f"{what} HTTP {status}: {body[:200]}")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise FetchError(FAILURE_PARSE, f"{what} 响应解析失败: {body[:200]}")

    # daily 接口直接返回数组 [{p_date:"...", pv:...}, ...]，不是信封
    if isinstance(payload, list):
        return {"data": payload}

    if not isinstance(payload, dict):
        raise FetchError(FAILURE_PARSE, f"{what} 响应格式异常: {str(payload)[:200]}")

    # 知乎错误信封
    err = payload.get("error")
    if isinstance(err, dict):
        raise FetchError(FAILURE_API,
                         f"{what} 知乎接口错误: {err.get('message') or err.get('code')}")
    # 非 error 信封的错误（如 {"msg":"error type","code":"10002"}）
    if payload.get("msg") and payload.get("code") and "data" not in payload:
        raise FetchError(FAILURE_API, f"{what} 知乎接口错误: {payload.get('msg')} "
                                     f"(code={payload.get('code')})")
    return payload


def check_login(page):
    """/api/v4/me 探登录态（必须在 www.zhihu.com 域下）"""
    r = page.evaluate(FETCH_JS, f"{BASE}/api/v4/me")
    if r.get("status") != 200:
        raise FetchError(FAILURE_TOKEN,
                         "知乎登录态失效，请到「账号连接」页面对该知乎账号重新登录")
    try:
        me = json.loads(r.get("body", ""))
        if not me.get("id"):
            raise ValueError("no id")
        return me
    except Exception:
        raise FetchError(FAILURE_TOKEN, "无法获取当前知乎账号资料，登录态可能失效")


def ts_date(ts):
    try:
        return datetime.datetime.fromtimestamp(int(ts), BJT).strftime("%Y-%m-%d")
    except Exception:
        return ""


def num(v):
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def rate(v):
    return round(float(v), 4) if isinstance(v, (int, float)) else None


def normalize_trend_day(d):
    """daily 单日项 → 与 overview 对齐的扁平口径。

    daily 用 new_upvote / new_like 表当日增量，aggr/list 用 upvote / like；
    另带 yesterday/today/advanced 嵌套（多为 null），压平避免输出噪声。
    """
    if not isinstance(d, dict):
        return {}
    upvote = d.get("upvote")
    if upvote is None:
        upvote = d.get("new_upvote")
    like = d.get("like")
    if like is None:
        like = d.get("new_like")
    pv = num(d.get("pv"))
    inter = sum(num(d.get(k)) for k in ("comment", "collect", "share")) + num(upvote) + num(like)
    return {
        "p_date": d.get("p_date") or "",
        "pv": pv,
        "upvote": num(upvote),
        "comment": num(d.get("comment")),
        "like": num(like),
        "collect": num(d.get("collect")),
        "share": num(d.get("share")),
        "follow_uv": num(d.get("new_follow_uv")),
        "pageshow_uv": num(d.get("pageshow_uv")),
        "fcr": rate(d.get("follower_conversion_rate")),
        "avg_read": d.get("avg_read_duration"),
        "interact_rate": round(inter / pv, 4) if pv else None,
        "follow_rate": round(num(d.get("new_follow_uv")) / pv, 4) if pv else None,
    }


def pct(v):
    return f"{v * 100:.2f}%" if isinstance(v, (int, float)) else "—"


# ── 各模式 ──

def fetch_creations(page, limit):
    url = (f"{BASE}/api/v4/creators/creations/v2/all"
           f"?start=0&end=0&limit={limit}&offset=0&need_co_creation=1&sort_type=created")
    return fetch_json(page, url, "创作列表")


def fetch_content_list(page, ctype, limit):
    url = (f"{BASE}/api/v4/creators/analysis/realtime/content/list"
           f"?type={ctype}&offset=0&limit={limit}")
    return fetch_json(page, url, f"实时内容指标({ctype})")


def fetch_aggr(page, ctype, cid, start, end):
    url = (f"{BASE}/api/v4/creators/analysis/realtime/content/aggr"
           f"?type={ctype}&token={cid}&start={start}&end={end}")
    return fetch_json(page, url, "单篇汇总")


def fetch_daily(page, ctype, cid, start, end):
    url = (f"{BASE}/api/v4/creators/analysis/realtime/content/daily"
           f"?type={ctype}&token={cid}&start={start}&end={end}")
    return fetch_json(page, url, "单篇日趋势")


def fetch_portrait(page, ctype, cid):
    url = (f"{BASE}/api/v4/creators/analysis/realtime/content/visitor_portrait"
           f"?type={ctype}&token={cid}")
    try:
        return fetch_json(page, url, "读者画像")
    except FetchError as e:
        # DMP 未开通时是正常降级，不阻断
        log(f"[提示] 读者画像不可用（可能未开通 DMP）: {e.message[:120]}")
        return {"content": {"status": "unavailable"}}


def merge_rows(creations, content_list):
    """创作列表 + 实时指标按下标对齐 → 统一行"""
    items = creations.get("data") or []
    metrics = content_list.get("data") or []
    rows = []
    for idx, it in enumerate(items):
        d = it.get("data") or {}
        m = metrics[idx] if idx < len(metrics) else {}
        inter = sum(num(m.get(k)) for k in ("upvote", "comment", "like", "collect", "share"))
        pv = num(m.get("pv"))
        mark = m.get("content_mark") or {}
        rows.append({
            "id": str(d.get("id") or ""),
            "type": it.get("type") or "",
            "title": d.get("title") or "(无标题)",
            "created": ts_date(d.get("created_time")),
            "updated": ts_date(d.get("updated_time")),
            "pv": pv,
            "upvote": num(m.get("upvote")),
            "comment": num(m.get("comment")),
            "like": num(m.get("like")),
            "collect": num(m.get("collect")),
            "share": num(m.get("share")),
            "follow_uv": num(m.get("new_follow_uv")),
            "fcr": rate(m.get("follower_conversion_rate")),
            "pir": rate(m.get("positive_interact_rate")),
            "avg_read": m.get("avg_read_duration"),
            "interact_rate": round(inter / pv, 4) if pv else None,
            "follow_rate": round(num(m.get("new_follow_uv")) / pv, 4) if pv else None,
            "is_collapsed": bool(mark.get("is_collapsed")),
            "is_suggest": bool(mark.get("is_suggest")),
        })
    return rows


def export_csv(rows, mode):
    """导出 CSV 到 DSAGENT_WORKSPACE/artifacts 下"""
    ws = os.environ.get("DSAGENT_WORKSPACE", "")
    if not ws or not rows:
        return None
    out_dir = os.path.join(ws, "artifacts")
    os.makedirs(out_dir, exist_ok=True)
    ts = datetime.datetime.now(BJT).strftime("%Y%m%d_%H%M%S")
    path = os.path.join(out_dir, f"zhihu_analytics_{mode}_{ts}.csv")
    keys = list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k) for k in keys})
    return path


def build_report(rows):
    """按六条口径生成文本结论"""
    arts = [r for r in rows if r["type"] == "article"] or rows
    if not arts:
        return "账号下暂无内容数据。"
    srt = sorted(arts, key=lambda x: x["pv"], reverse=True)
    top = srt[0]
    total_pv = sum(r["pv"] for r in srt)
    total_inter = sum(r["upvote"] + r["comment"] + r["like"] + r["collect"] + r["share"] for r in srt)
    total_follow = sum(r["follow_uv"] for r in srt)
    collapsed = [r for r in srt if r["is_collapsed"]]

    lines = [
        f"1. 头马篇：《{top['title'][:24]}》阅读 {top['pv']}，"
        f"占总阅读 {pct(top['pv'] / total_pv) if total_pv else '—'}，"
        f"涨粉率 {pct(top['fcr'])}。",
        f"2. 阅读/互动匹配度：总阅读 {total_pv}，总互动 {total_inter}，"
        f"互动率 {pct(total_inter / total_pv) if total_pv else '—'}。"
        + ("<1%，正文没接住流量，改正文结构。" if total_pv and total_inter / total_pv < 0.01
           else "基本匹配。"),
        f"3. 涨粉效率：涨粉 UV {total_follow}，单次阅读涨粉率 "
        f"{pct(total_follow / total_pv) if total_pv else '—'}。"
        + (">1% 强 / 0.1%~1% 一般 / <0.1% 缺关注理由。" if total_pv else ""),
        f"4. 折叠/限流："
        + ("检测到 " + str(len(collapsed)) + " 篇被折叠（" +
           "、".join(r["title"][:12] for r in collapsed) + "），折叠会压掉阅读。"
           if collapsed else "未检测到折叠。"),
        f"5. 时间衰减：头马篇发布 {top['created']}，平均阅读时长 "
        f"{top['avg_read'] if top['avg_read'] else '数据不足'}。"
        f"（逐日衰减看 --mode trend）",
        f"6. 下一步：复制《{top['title'][:16]}》的选题角度做同系列；"
        f"对阅读高互动低的篇，前 300 字改成「结论 + 清单」结构。",
    ]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="知乎创作数据采集与分析")
    parser.add_argument("--mode", "-m", choices=MODES, default="overview")
    parser.add_argument("--content-id", help="内容 ID（article / trend 模式必填）")
    parser.add_argument("--type", dest="ctype", choices=TYPES, default="article")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--limit", "-n", type=int, default=20)
    parser.add_argument("--csv", action="store_true")
    args = parser.parse_args()

    days = min(max(args.days, 1), MAX_DAYS)
    limit = min(max(args.limit, 1), MAX_LIMIT)

    if args.mode in ("article", "trend") and not args.content_id:
        output_result({"ok": False, "failure_kind": "skill_error",
                       "message": f"{args.mode} 模式需要 --content-id，"
                                  f"先跑 --mode list 取内容 ID"})
        sys.exit(1)

    # 网关前置检查（不判死，runtime 会自动发现）
    if not os.environ.get("DSCONNECT_URL"):
        try:
            from runtime.dsagent_runtime import api_base as _api_base
            _api_base()
        except Exception:
            output_result({"ok": False, "failure_kind": "not_bound",
                           "message": "未检测到本地代理网关，请到「账号连接」页面绑定知乎账号后重试"})
            sys.exit(1)

    log(f"[采集] mode={args.mode} type={args.ctype} days={days} limit={limit}")

    proc = None
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        output_result({"ok": False, "failure_kind": "skill_error",
                       "message": "缺少 playwright，请先安装: pip install playwright"})
        sys.exit(1)

    try:
        proc = launch_chrome()
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(CDP)
            ctx = browser.contexts[0]
            page = ctx.new_page()
            # 必须落到 www.zhihu.com 域，签名环境才可用
            page.goto(BASE + "/creator", wait_until="domcontentloaded", timeout=60000)
            time.sleep(9)

            me = check_login(page)
            log(f"[采集] 账号: {me.get('name')} (id={me.get('id')})")

            end = datetime.date.today()
            start = end - datetime.timedelta(days=days)

            if args.mode in ("article", "trend"):
                if args.mode == "article":
                    aggr = fetch_aggr(page, args.ctype, args.content_id,
                                      start.isoformat(), end.isoformat())
                    portrait = fetch_portrait(page, args.ctype, args.content_id)
                    item = dict(aggr)
                    item.pop("paging", None)
                    item["visitor_portrait"] = (portrait.get("content") or {})
                    data, extra = [item], {"content_id": args.content_id}
                else:
                    daily = fetch_daily(page, args.ctype, args.content_id,
                                        start.isoformat(), end.isoformat())
                    # daily 每项字段名与 aggr 略有差异（new_upvote / new_like），
                    # 且带 yesterday/today/advanced 等嵌套空值，归一化成扁平口径
                    data = [normalize_trend_day(d) for d in (daily.get("data") or [])]
                    extra = {"content_id": args.content_id, "days": days,
                             "window": {"start": start.isoformat(), "end": end.isoformat()}}
                rows = data
            else:
                creations = fetch_creations(page, limit)
                if args.mode == "list":
                    rows = [{
                        "id": str((it.get("data") or {}).get("id") or ""),
                        "type": it.get("type") or "",
                        "title": (it.get("data") or {}).get("title") or "(无标题)",
                        "created": ts_date((it.get("data") or {}).get("created_time")),
                        "excerpt": ((it.get("data") or {}).get("excerpt") or "")[:120],
                    } for it in creations.get("data") or []]
                    extra = {"totals": (creations.get("paging") or {}).get("totals")}
                else:
                    content_list = fetch_content_list(page, args.ctype, limit)
                    rows = merge_rows(creations, content_list)
                    extra = {
                        "totals": (creations.get("paging") or {}).get("totals"),
                        "report": build_report(rows),
                    }
                if not rows:
                    output_result({"ok": True, "mode": args.mode, "total": 0, "data": [],
                                   "fetch_time": datetime.datetime.now(BJT)
                                   .strftime("%Y-%m-%d %H:%M:%S")})
                    sys.exit(0)

    except FetchError as e:
        output_result({"ok": False, "failure_kind": e.failure_kind, "message": e.message})
        sys.exit(1)
    except Exception as e:
        output_result({"ok": False, "failure_kind": "skill_error",
                       "message": f"执行异常: {str(e)[:300]}"})
        sys.exit(1)
    finally:
        if proc:
            proc.terminate()
            log("[采集] Chrome 已关闭")

    # ── 汇总输出 ──
    if args.mode == "overview":
        top = max(rows, key=lambda x: x.get("pv") or 0)
        extra["top"] = {"id": top.get("id"), "title": top.get("title"), "pv": top.get("pv")}

    output = {
        "ok": True,
        "mode": args.mode,
        "type": args.ctype,
        "total": len(rows),
        "days": days,
        "data": rows,
        "account": {"name": me.get("name"), "id": me.get("id"),
                    "url_token": me.get("url_token")},
        "fetch_time": datetime.datetime.now(BJT).strftime("%Y-%m-%d %H:%M:%S"),
    }
    output.update(extra)

    if args.csv:
        csv_path = export_csv(rows, args.mode)
        if csv_path:
            output["csv_path"] = csv_path
            output_files(csv_path)
            log(f"[采集] CSV 已导出: {csv_path}")

    if args.mode == "overview":
        output_summary(rows, 模式="overview", 内容数=len(rows))
    elif args.mode == "list":
        output_summary(rows, 模式="list", 内容数=len(rows))
    elif args.mode == "article":
        output_summary([rows[0]] if rows else [], 模式="article", 内容ID=args.content_id)
    else:
        # trend：附带峰值日，让「时间衰减」结论一眼可见
        peak = max(rows, key=lambda x: x.get("pv") or 0) if rows else {}
        output_summary(rows, 模式="trend", 内容ID=args.content_id, 天数=len(rows),
                       峰值日=peak.get("p_date") or "-", 峰值阅读=peak.get("pv") or 0)

    output_result(output)


if __name__ == "__main__":
    main()
