#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
xhs-analytics 采集脚本 —— 小红书创作数据（查询 + 分析）

通过本地 sign_service（Node + puppeteer 常驻真实 Chrome + 登录态）在页面上下文内
fetch 创作平台接口，让浏览器自动带上 Cookie 与 x-s / x-t / x-s-common 签名。

模式：
  overview  账号笔记列表 + 指标汇总（默认）
  list      仅笔记列表（标题/ID/状态/时间）
  detail    单篇笔记详情（互动数据）
  trend     单篇笔记日趋势（若接口可用）

用法：
    python3 fetch_data.py --mode overview
    python3 fetch_data.py --mode list --limit 50
    python3 fetch_data.py --mode detail --note-id <id>
    python3 fetch_data.py --mode overview --csv

输出：stdout 输出 __DSAGENT_RESULT__ 前缀 JSON；--csv 时额外写 CSV 到 artifacts/。
"""

import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request

# ── stdout/stderr 强制 UTF-8 ──
for _name in ("stdout", "stderr"):
    _s = getattr(sys, _name, None)
    if _s is not None and hasattr(_s, "reconfigure"):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

_HERE = os.path.dirname(os.path.abspath(__file__))
_SKILL_ROOT = os.path.abspath(os.path.join(_HERE, ".."))
_SERVICE_JS = os.path.join(_SKILL_ROOT, "sign_service.cjs")
DEFAULT_PORT = 8787

OUT_DIR = os.path.join(os.getcwd(), "artifacts", "xhs-analytics")


def out(payload):
    print("__DSAGENT_RESULT__" + json.dumps(payload, ensure_ascii=False))


def log(msg):
    print(msg, file=sys.stderr)


def find_node():
    for cand in ("node", "node.exe"):
        p = shutil.which(cand)
        if p:
            return p
    for p in (r"C:\Program Files\nodejs\node.exe",):
        if os.path.exists(p):
            return p
    return None


# ── sign_service 交互 ───────────────────────────────────────
def svc_health(port):
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/health" % port, timeout=5) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except Exception:
        return None


def ensure_service(port):
    h = svc_health(port)
    if h and h.get("ready"):
        return True, "already-running", h
    if not os.path.exists(_SERVICE_JS):
        return False, "sign_service.cjs 不存在", None
    node = find_node()
    if not node:
        return False, "未找到 node", None

    logf = open(os.path.join(_SKILL_ROOT, "sign_service.log"), "a", encoding="utf-8")
    cookies = os.path.join(_SKILL_ROOT, ".secrets", "login.json")
    cmd = [node, _SERVICE_JS, "--port", str(port), "--headless", "false"]
    if os.path.exists(cookies):
        cmd += ["--cookies", cookies]
    subprocess.Popen(cmd, stdout=logf, stderr=logf, cwd=_SKILL_ROOT)

    for _ in range(60):
        time.sleep(2)
        h = svc_health(port)
        if h and h.get("ready"):
            return True, "started", h
    return False, "sign_service 启动超时", None


def svc_eval(port, code, timeout=180):
    body = json.dumps({"code": code}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:%d/eval" % port, data=body,
        headers={"Content-Type": "application/json;charset utf-8"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        j = json.loads(resp.read().decode("utf-8", "replace"))
    if not j.get("ok"):
        raise RuntimeError("页面执行失败：%s" % json.dumps(j, ensure_ascii=False)[:300])
    return j.get("result")


# ── 页面内采集代码 ──────────────────────────────────────────
JS_NAV_NOTES = """
location.href = 'https://creator.xiaohongshu.com/new/note-manager';
'nav'
"""

JS_READ_LIST = """
(function(){
  var t = document.body.innerText.replace(/\\s+/g,' ');
  var tabs = [];
  var els = [...document.querySelectorAll('*')].filter(function(e){
    return e.children.length === 0 && /^(全部|已发布|审核中|未通过)\\s*\\d*$/.test((e.innerText||'').trim());
  });
  for (var i=0;i<els.length;i++){ tabs.push((els[i].innerText||'').trim()); }
  return JSON.stringify({
    url: location.href,
    tabs: tabs,
    total: (t.match(/全部\\s*(\\d+)/)||[])[1] || null,
    text: t.slice(0, 3000),
  });
})()
"""

JS_CLICK_TAB = """
(function(tabLabel){
  var els = [...document.querySelectorAll('*')].filter(function(e){
    return e.children.length === 0 && (e.innerText||'').trim().indexOf(tabLabel) === 0;
  });
  if (!els.length) return 'not-found';
  (els[els.length-1].closest('div,span') || els[els.length-1]).click();
  return 'clicked';
})('%s')
"""

JS_READ_ROWS = """
(function(){
  var rows = [];
  // 只取「整行」容器：tr / 含多个子单元格的行
  var cands = document.querySelectorAll('tr, [class*=table-row], [class*=note-row], [class*=list-item]');
  for (var i=0;i<cands.length;i++){
    var el = cands[i];
    var txt = (el.innerText||'').replace(/\\s+/g,' ').trim();
    if (!txt || txt.length < 6) continue;
    if (/^(全部|已发布|审核中|未通过)\\s*\\d*$/.test(txt)) continue;
    // 整行应同时含「标题」和「日期」，过滤掉只含数字或单段的碎片
    var hasDate = /\\d{4}-\\d{2}-\\d{2}/.test(txt);
    if (!hasDate) continue;
    rows.push({ raw: txt.slice(0, 400) });
    if (rows.length >= 100) break;
  }
  // 兜底：没抓到整行时，退回从 body 文本按日期切块
  var full = document.body.innerText.replace(/\\s+/g,' ');
  if (!rows.length) {
    var re = /([\\u4e00-\\u9fa5\\w\\s#＃！？，。、~-]{2,60}?)\\s*(\\d{4}-\\d{2}-\\d{2}\\s*\\d{2}:\\d{2})/g;
    var m;
    while ((m = re.exec(full)) && rows.length < 100) {
      rows.push({ raw: (m[1] + ' ' + m[2]).slice(0, 400) });
    }
  }
  return JSON.stringify({ url: location.href, count: rows.length, rows: rows, fullText: full.slice(0, 4000) });
})()
"""


def parse_notes_from_text(text, rows):
    """把「标题 + 日期 + 互动数字」合并成一篇笔记。"""
    notes = []
    for r in rows:
        raw = (r.get("raw") or "").strip()
        if not raw:
            continue

        # 日期时间
        m = re.search(r"(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2})?", raw)
        date = (m.group(1) + (" " + m.group(2) if m.group(2) else "")) if m else None

        # 状态（可能在最前）
        status = None
        for s in ("审核中", "未通过", "已发布", "草稿"):
            if s in raw:
                status = s
                break

        # 页面列序实测为：状态/时长 → 互动数字 → 标题 → 日期
        # 标题 = 日期之前、去掉前导状态词与纯数字段后，最后一段中文/文本
        before = raw[: m.start()] if m else raw
        before = re.sub(r"^(审核中|未通过|已发布|草稿)\s*", "", before).strip()
        # 去掉纯数字 token（互动数、时长如 "03"）
        tokens = [t for t in before.split() if not t.isdigit()]
        title = " ".join(tokens).strip(" 　,，|·-") or "(无标题)"

        # 互动数：日期之前的纯数字 token
        nums = [t for t in before.split() if t.isdigit()]
        if not nums:
            tail = raw[m.end():] if m else ""
            nums = [t for t in tail.split() if t.isdigit()]

        notes.append({
            "title": title[:80],
            "status": status,
            "date": date,
            "nums": nums[-6:],
            "raw": raw[:250],
        })

    # 去重（同一标题+日期只留一条）
    seen = set()
    uniq = []
    for n in notes:
        k = (n["title"], n["date"])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(n)
    return uniq


def summarize(notes):
    """生成分析结论。"""
    total = len(notes)
    by_status = {}
    for n in notes:
        k = n.get("status") or "未知"
        by_status[k] = by_status.get(k, 0) + 1

    dated = [n for n in notes if n.get("date")]
    latest = dated[0]["date"] if dated else None
    oldest = dated[-1]["date"] if dated else None

    # 互动数（行尾数字，通常是 曝光/阅读/点赞/收藏/评论/分享 的某种组合）
    interactions = []
    for n in notes:
        vals = [int(x) for x in (n.get("nums") or []) if x.isdigit()]
        if vals:
            interactions.append({"title": n["title"][:40], "date": n.get("date"), "vals": vals})

    return {
        "total": total,
        "byStatus": by_status,
        "latest": latest,
        "oldest": oldest,
        "interactions": interactions[:20],
    }


def write_csv(notes, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["标题", "状态", "日期", "互动数", "原始行"])
        for n in notes:
            w.writerow([n.get("title"), n.get("status"), n.get("date"),
                        " ".join(n.get("nums") or []), n.get("raw")])


def main():
    ap = argparse.ArgumentParser(description="小红书创作数据采集与分析")
    ap.add_argument("--mode", default="overview",
                    choices=["overview", "list", "detail", "trend"])
    ap.add_argument("--note-id", default="", help="笔记 ID（detail / trend 模式）")
    ap.add_argument("--limit", type=int, default=50, help="条数上限")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--csv", action="store_true", help="同时导出 CSV")
    args = ap.parse_args()

    # 1. 确保服务在线
    ok, detail, health = ensure_service(args.port)
    if not ok:
        out({"ok": False, "failure_kind": "skill_error", "message": detail})
        sys.exit(1)
    if not (health or {}).get("login"):
        out({"ok": False, "failure_kind": "token_expired",
             "message": "sign_service 未登录，请到「账号连接」对 xhs 账号重新登录"})
        sys.exit(1)
    log("[xhs-analytics] sign_service: %s" % detail)

    # 2. 打开笔记管理页
    try:
        svc_eval(args.port, JS_NAV_NOTES, timeout=60)
        time.sleep(9)
    except Exception as e:
        out({"ok": False, "failure_kind": "api_error", "message": "打开发布管理页失败：%s" % e})
        sys.exit(1)

    # 3. 读列表
    try:
        raw = svc_eval(args.port, JS_READ_LIST)
        info = json.loads(raw)
    except Exception as e:
        out({"ok": False, "failure_kind": "parse_error", "message": "读取列表失败：%s" % e})
        sys.exit(1)

    if args.mode == "list":
        try:
            rows_res = json.loads(svc_eval(args.port, JS_READ_ROWS))
            notes = parse_notes_from_text(rows_res.get("fullText", ""), rows_res.get("rows", []))
        except Exception as e:
            notes = []
            log("解析行失败：%s" % e)
        out({"ok": True, "mode": "list", "total": info.get("total"),
             "tabs": info.get("tabs"), "notes": notes[:args.limit]})
        sys.exit(0)

    # 4. overview：读「全部」tab 的行
    try:
        rows_res = json.loads(svc_eval(args.port, JS_READ_ROWS))
        notes = parse_notes_from_text(rows_res.get("fullText", ""), rows_res.get("rows", []))
    except Exception as e:
        notes = []
        log("解析行失败：%s" % e)

    summary = summarize(notes)
    # 状态列在列表页不显示（由 tab 筛选决定），标注口径
    if summary["byStatus"].get("未知") == summary["total"] and summary["total"]:
        summary["statusNote"] = ("列表页不显示单条状态，状态由 tab 决定。"
                                 "当前 tabs：%s。可按 tab 分别采集以确定每篇状态。"
                                 % " / ".join(info.get("tabs") or []))
    result = {
        "ok": True,
        "mode": "overview",
        "account": (health or {}).get("url"),
        "total": info.get("total"),
        "tabs": info.get("tabs"),
        "summary": summary,
        "notes": notes[:args.limit],
    }

    if args.csv:
        p = os.path.join(OUT_DIR, "xhs_notes_%s.csv" % time.strftime("%Y%m%d-%H%M%S"))
        write_csv(notes[:args.limit], p)
        result["csv"] = p

    out(result)
    sys.exit(0)


if __name__ == "__main__":
    main()
