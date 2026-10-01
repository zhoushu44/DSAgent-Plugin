#!/usr/bin/env python3
"""
小红书笔记搜索采集脚本 — v3.0

v3.0 改动：
  - 接入 x-s / x-t / x-s-common 签名（xhs_sign.py，纯 Python 移植 xhshow）
    签名头由技能侧自算，网关 inject_token=False 不注入 _tb_token_
  - POST body 使用签名时的同一字符串，保证与 content_string 字节一致

v2.0 改动：
  - 使用 dsagent_runtime 统一模块（stdout/stderr 分离、错误类型细分）
  - 网关代理请求改用 dsagent_runtime.http_post
  - 输出改用 dsagent_runtime.log / output_result
  - 风控保护用 dsagent_runtime.CallThrottle
"""

import sys
import os
import json

# ── 引入 dsagent_runtime ──
_dsagent_dir = os.path.join(os.environ.get("DSAGENT_SKILL_ROOT", ""), ".dsagent")
if _dsagent_dir and _dsagent_dir not in sys.path:
    sys.path.insert(0, _dsagent_dir)

# ── 引入同目录签名模块 ──
_script_dir = os.path.dirname(os.path.abspath(__file__))
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

from runtime.dsagent_runtime import log, output_result
from runtime.dsagent_runtime import http_post, CallThrottle
from runtime.dsagent_runtime import FAILURE_API, FAILURE_PARSE, FAILURE_TOKEN, FAILURE_RISK

from xhs_sign import sign_headers, gen_search_id as _sign_gen_search_id


def extract_keyword(args):
    """从命令行参数提取关键词"""
    if len(args) < 1:
        return ""
    return args[0]


def gen_search_id() -> str:
    """生成小红书搜索所需的 search_id（与 xhshow 一致：时间戳毫秒左移 64 位 + 随机，base36）"""
    return _sign_gen_search_id()


def search_via_gateway(keyword: str, page: int = 1, limit: int = 20) -> dict:
    """
    通过本地代理网关请求小红书搜索接口。

    注意：该接口只接受 POST + JSON body，用 GET 会直接 404（响应体为空，
    历史上的「执行成功但 0 条」即由此产生）。

    v3.0：接口强制要求 x-s / x-t / x-s-common 签名头，缺签名会返回
    {"code":-104,"msg":"您当前登录的账号没有权限访问"}。签名由技能侧自算
    （xhs_sign.py），网关传 inject_token=False 不注入 _tb_token_，避免破坏签名。
    """
    target_url = "https://edith.xiaohongshu.com/api/sns/web/v1/search/notes"

    body = {
        "keyword": keyword,
        "page": page,
        "page_size": limit,
        "search_id": gen_search_id(),
        "sort": "general",
        "note_type": 0,
        "ext_flags": [],
        "image_formats": ["jpg", "webp", "avif"],
    }

    # 签名需要 a1 cookie，由 host 半区注入到 DSAGENT_COOKIE
    cookie_str = os.environ.get("DSAGENT_COOKIE", "")
    try:
        sign_hdrs, body_str = sign_headers("POST", target_url, cookie_str, payload=body)
    except ValueError as e:
        return {"status": "error", "error_message": str(e), "failure_kind": FAILURE_TOKEN}

    headers = {
        "Content-Type": "application/json;charset=UTF-8",
        "Origin": "https://www.xiaohongshu.com",
        "Referer": "https://www.xiaohongshu.com/",
    }
    headers.update(sign_hdrs)

    try:
        result = http_post(
            target_url,
            platform="xhs",
            json_body=body_str,  # 必须与签名用的 content_string 字节一致，不能另行 json.dumps
            headers=headers,
            timeout=30,
            inject_token=False,
        )
        return result
    except Exception as e:
        kind = getattr(e, "failure_kind", FAILURE_API)
        return {"status": "error", "error_message": str(e), "failure_kind": kind}


def unwrap_payload(raw: dict):
    """从网关返回中取出业务 payload（dict），取不到返回 None"""
    payload = raw.get("payload", raw)
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            return None
    return payload if isinstance(payload, dict) else None


def check_business_error(payload) -> dict | None:
    """小红书业务错误码判定：成功返回 None，失败返回 {kind, msg, code}"""
    if not isinstance(payload, dict):
        return None
    code = payload.get("code", 0)
    if code == 0 and payload.get("success") is not False:
        return None
    msg = str(payload.get("msg") or payload.get("message") or f"code={code}")
    if code == -101 or "登录" in msg:
        kind = FAILURE_TOKEN
    elif code in (461, 471) or "风控" in msg or "验证" in msg:
        kind = FAILURE_RISK
    else:
        kind = FAILURE_API
    return {"kind": kind, "msg": msg, "code": code}


def parse_search_result(raw: dict) -> tuple[list, bool]:
    """
    从原始响应中提取笔记列表。

    返回 (notes, parsed_ok)：
      parsed_ok=False 表示响应结构完全不符合预期（HTML 挑战页 / 空体 / 字段改名），
      调用方必须按 parse_error 上报，禁止静默当成「0 条结果」。
    """
    payload = unwrap_payload(raw)
    if payload is None:
        return [], False

    data = payload.get("data")
    if not isinstance(data, dict):
        return [], False

    if "items" in data:
        items = data.get("items")
    elif "notes" in data:
        items = data.get("notes")
    else:
        return [], False

    if not isinstance(items, list):
        return [], False

    notes = []
    for item in items:
        if not isinstance(item, dict):
            continue
        note_card = item.get("note_card", item)
        note_id = note_card.get("note_id", item.get("id", ""))
        title = note_card.get("display_title", note_card.get("title", ""))
        desc = note_card.get("desc", "")
        user = note_card.get("user", {})
        user_nick = user.get("nick", user.get("nickname", ""))
        user_id = user.get("user_id", "")
        liked_count = note_card.get("interact_info", {}).get("liked_count", "0")
        type_ = note_card.get("type", "")

        notes.append({
            "note_id": note_id,
            "title": title,
            "desc": desc[:200] if desc else "",
            "user": user_nick,
            "user_id": user_id,
            "liked_count": liked_count,
            "type": type_,
        })

    return notes, True


def main():
    args = sys.argv[1:]
    keyword = extract_keyword(args)

    # 从命令行参数解析页码和限制
    page = 1
    limit = 20
    for i, arg in enumerate(args):
        if arg == "--page" and i + 1 < len(args):
            page = int(args[i + 1])
        elif arg == "--limit" and i + 1 < len(args):
            limit = int(args[i + 1])

    if not keyword:
        from runtime.dsagent_runtime import extract_keyword_from_request
        request = os.environ.get("DSAGENT_REQUEST", "")
        keyword = extract_keyword_from_request(request)

    if not keyword:
        output_result({"ok": False, "error": "缺少关键词参数", "data": [], "total": 0})
        sys.exit(1)

    log(f"[采集] 关键词='{keyword}' 页码={page} 限制={limit}")

    # 风控保护：请求节流
    throttle = CallThrottle(min_interval=2.0, jitter=0.5)
    throttle.wait()

    raw = search_via_gateway(keyword, page, limit)

    if raw.get("status") == "error":
        output_result({
            "ok": False,
            "error": raw.get("error_message", "搜索失败"),
            "failure_kind": raw.get("failure_kind", FAILURE_API),
            "data": [],
            "total": 0,
            "keyword": keyword,
        })
        sys.exit(1)

    payload = unwrap_payload(raw)
    biz_err = check_business_error(payload)
    if biz_err:
        output_result({
            "ok": False,
            "error": f"小红书接口返回错误：{biz_err['msg']}（code={biz_err['code']}）",
            "failure_kind": biz_err["kind"],
            "data": [],
            "total": 0,
            "keyword": keyword,
        })
        sys.exit(1)

    notes, parsed_ok = parse_search_result(raw)

    if not parsed_ok:
        snippet = json.dumps(payload, ensure_ascii=False)[:500] if payload is not None else "<空响应体>"
        output_result({
            "ok": False,
            "error": f"小红书响应结构无法解析（可能被风控或接口变更）：{snippet}",
            "failure_kind": FAILURE_PARSE,
            "data": [],
            "total": 0,
            "keyword": keyword,
        })
        sys.exit(1)

    output_result({
        "ok": True,
        "data": notes,
        "total": len(notes),
        "keyword": keyword,
        "page": page,
    })


if __name__ == "__main__":
    main()
