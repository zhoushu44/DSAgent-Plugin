#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
B站数据采集脚本。

通过本地代理网关（gateway-proxy.ts）访问 B站 Web 接口，Cookie 由网关注入，
技能侧不接触任何原始 Cookie。

B站 自 2023-03 起对 Web 查询接口引入 WBI 签名（w_rid + wts），独立于 Cookie 鉴权。
本脚本自实现该签名：nav 接口取实时 img_key / sub_key → 重排得 mixin_key →
参数排序编码后拼 mixin_key 算 MD5 得 w_rid。

输出协议：stdout 只输出 __DSAGENT_RESULT__{json}，进度日志走 stderr。
"""

from __future__ import annotations

import os
import re
import sys
import json
import time
import html
import hashlib
import argparse
import urllib.parse
from datetime import datetime, timedelta, timezone

# ─── runtime 引入（技能侧统一入口）───
_dsagent_dir = os.path.join(os.environ.get("DSAGENT_SKILL_ROOT", ""), ".dsagent")
if _dsagent_dir and _dsagent_dir not in sys.path:
    sys.path.insert(0, _dsagent_dir)

from runtime.dsagent_runtime import log, output_result, output_summary
from runtime.dsagent_runtime import http_get, CallThrottle, extract_keyword_from_request
from runtime.dsagent_runtime import fetch_binding_context, BindingContextError
from runtime.dsagent_runtime import (
    FAILURE_RISK, FAILURE_TOKEN, FAILURE_PARSE, FAILURE_API, FAILURE_NOT_BOUND,
)

# ─── 常量 ───
BJT = timezone(timedelta(hours=8))
API = "https://api.bilibili.com"
PLATFORM = "bilibili"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
HOME_REFERER = "https://www.bilibili.com/"
RANK_REFERER = "https://www.bilibili.com/v/popular/rank/all"
POPULAR_REFERER = "https://www.bilibili.com/v/popular/all"

# WBI mixin_key 重排表（64 元素，官方算法固定值）
MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52,
]

# 自建节流：SKILL.md 承诺请求间隔 ≥ 6 秒
THROTTLE = CallThrottle(min_interval=6.0, jitter=1.0)

# 自检标记
SELF_MARKERS = ("我的", "自己", "本人", "我账号", "我B站", "我 b站")
RANK_MARKERS = ("排行榜", "排行", "榜单", "全站榜", "排行版")
HOT_MARKERS = ("热门", "什么火", "热点", "正在火")
COMMENT_MARKERS = ("评论", "弹幕评论")
MAX_COUNT = 50

# 风控码：网关对 HTTP 412 只能判到 api_error，脚本侧需按码值/文案兜底归因
RISK_HINTS = ("-412", "request was banned", "-352", "风控校验失败", "风控")
TOKEN_HINTS = ("-101", "账号未登录", "未登录", "登录失效")

# WBI 密钥缓存（同进程内复用；平台每日更替）
_WBI_CACHE: dict[str, str] = {}


class FetchError(Exception):
    def __init__(self, failure_kind: str, message: str):
        super().__init__(message)
        self.failure_kind = failure_kind
        self.message = message


# ─── WBI 签名 ───
def _mixin_key(img_key: str, sub_key: str) -> str:
    raw = img_key + sub_key
    return "".join(raw[i] for i in MIXIN_KEY_ENC_TAB if i < len(raw))[:32]


def enc_wbi(params: dict) -> dict:
    """对参数做 WBI 签名，返回带 wts / w_rid 的新参数字典。"""
    mixin = _WBI_CACHE.get("mixin_key") or ""
    if not mixin:
        raise FetchError(FAILURE_API, "WBI 密钥未初始化（请先调用 get_wbi_keys）")
    p = dict(params)
    p["wts"] = int(time.time())
    # 值先过滤 !'()* 再排序编码，最后拼 mixin_key 取 MD5
    p = {k: "".join(c for c in str(v) if c not in "!'()*")
         for k, v in sorted(p.items())}
    query = urllib.parse.urlencode(p)
    p["w_rid"] = hashlib.md5((query + mixin).encode()).hexdigest()
    return p


# ─── 通用工具 ───
def _headers(referer: str | None = None) -> dict:
    return {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": referer or HOME_REFERER,
    }


def _remap_failure(kind: str, message: str) -> str:
    """网关对非阿里系平台只能按文案归因，这里按 B站 业务码兜底修正。"""
    low = (message or "").lower()
    if any(h.lower() in low for h in RISK_HINTS):
        return FAILURE_RISK
    if any(h.lower() in low for h in TOKEN_HINTS):
        return FAILURE_TOKEN
    return kind


def _int(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _fmt_time(ts) -> str:
    try:
        return datetime.fromtimestamp(int(ts), BJT).strftime("%Y-%m-%d %H:%M:%S")
    except (TypeError, ValueError, OSError):
        return ""


def _parse_duration(v) -> int:
    """时长归一为秒：int 秒 / 'MM:SS' / 'HH:MM:SS' 均可。"""
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, str) and ":" in v:
        parts = [int(x) for x in v.split(":") if x.strip().isdigit()]
        sec = 0
        for p in parts:
            sec = sec * 60 + p
        return sec
    return 0


def _strip_html(s: str) -> str:
    """搜索结果标题带 <em class="keyword"> 高亮标签，需剥离并反转义。"""
    if not s:
        return ""
    return html.unescape(re.sub(r"<[^>]+>", "", str(s))).strip()


def _fix_url(u: str) -> str:
    if not u:
        return ""
    return "https:" + u if u.startswith("//") else u


def _video_url(bvid: str, aid) -> str:
    if bvid:
        return f"https://www.bilibili.com/video/{bvid}"
    if aid:
        return f"https://www.bilibili.com/video/av{aid}"
    return ""


def call_api(path: str, params: dict | None = None, *, referer: str | None = None,
             wbi: bool = False, retries: int = 1) -> dict:
    """通过网关调用 B站 接口，返回解析后的 JSON 对象。"""
    for attempt in range(retries + 1):
        THROTTLE.wait()
        p = dict(params or {})
        if wbi:
            p = enc_wbi(p)
        try:
            result = http_get(f"{API}{path}", platform=PLATFORM, params=p,
                              headers=_headers(referer), timeout=30)
        except Exception as e:
            kind = _remap_failure(getattr(e, "failure_kind", FAILURE_API), str(e))
            # 风控类失败重试无意义，直接上抛
            raise FetchError(kind, str(e))

        payload = result.get("payload")
        if payload is None or (isinstance(payload, str) and not payload.strip()):
            if attempt < retries:
                log(f"[采集] {path} 返回空体，重试一次")
                continue
            raise FetchError(FAILURE_PARSE, f"{path} 返回空响应，请稍后重试")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                raise FetchError(FAILURE_PARSE, f"{path} 返回非 JSON：{payload[:200]}")
        if not isinstance(payload, dict):
            raise FetchError(FAILURE_PARSE, f"{path} 返回结构异常：{str(payload)[:200]}")

        # 网关已按业务码归因，这里兜底处理漏判（如 HTTP 412 落在 api_error）
        code = _int(payload.get("code"))
        if code != 0:
            msg = str(payload.get("message") or payload.get("msg") or "")
            raise FetchError(_remap_failure(FAILURE_API, f"{code} {msg}"),
                             f"{path} 返回 code={code}：{msg or '未知错误'}")
        return payload

    raise FetchError(FAILURE_PARSE, f"{path} 重试后仍失败")


def get_wbi_keys() -> dict:
    """调 nav 取实时 WBI 密钥，并返回账号信息（未登录会抛 token_expired）。"""
    payload = call_api("/x/web-interface/nav", referer=HOME_REFERER)
    data = payload.get("data") or {}
    if not data.get("isLogin"):
        raise FetchError(FAILURE_TOKEN, "B站账号未登录，请到「账号连接」页面重新登录")
    wbi = data.get("wbi_img") or {}
    img_key = (wbi.get("img_url") or "").rsplit("/", 1)[-1].split(".")[0]
    sub_key = (wbi.get("sub_url") or "").rsplit("/", 1)[-1].split(".")[0]
    if not img_key or not sub_key:
        raise FetchError(FAILURE_PARSE, "nav 接口未返回 WBI 密钥（img_url / sub_url）")
    _WBI_CACHE["mixin_key"] = _mixin_key(img_key, sub_key)
    return {"mid": _int(data.get("mid")), "nickname": data.get("uname") or ""}


# ─── 字段归一化 ───
def _norm_video(item: dict) -> dict:
    """统一 view / vlist / search / ranking / popular / related 的视频字段。"""
    stat = item.get("stat") or {}
    owner = item.get("owner") or {}

    bvid = item.get("bvid") or ""
    aid = item.get("aid")
    if aid is None and isinstance(item.get("id"), int):
        aid = item.get("id")

    dur = item.get("duration")
    if dur is None:
        dur = item.get("length")

    pub = item.get("pubdate") or item.get("created") or item.get("senddate")

    play = item.get("play")
    if play is None:
        play = stat.get("view")
    danmaku = item.get("video_review")
    if danmaku is None:
        danmaku = stat.get("danmaku")
    comment = item.get("comment")
    if comment is None:
        comment = item.get("review")
    if comment is None:
        comment = stat.get("reply")
    like = item.get("like")
    if like is None:
        like = stat.get("like")
    fav = item.get("favorites")
    if fav is None:
        fav = stat.get("favorite")

    out = {
        "bvid": bvid,
        "aid": aid,
        "title": _strip_html(item.get("title")),
        "desc": item.get("description") or item.get("desc") or "",
        "create_time": _fmt_time(pub),
        "duration_sec": _parse_duration(dur),
        "author_name": item.get("author") or owner.get("name") or "",
        "author_mid": _int(item.get("mid") or owner.get("mid")),
        "play_count": _int(play),
        "danmaku_count": _int(danmaku),
        "comment_count": _int(comment),
        "like_count": _int(like),
        "cover_url": _fix_url(item.get("pic") or item.get("cover") or ""),
        "video_url": _video_url(bvid, aid),
    }
    # 平台未提供的字段（如搜索接口无投币/分享）不臆造 0，直接省略
    for key, val in (("coin_count", stat.get("coin")),
                     ("favorite_count", fav),
                     ("share_count", stat.get("share")),
                     ("score", item.get("score")),
                     ("rank", item.get("rank"))):
        if val is not None:
            out[key] = _int(val)
    return out


def _norm_up(item: dict) -> dict:
    return {
        "mid": _int(item.get("mid")),
        "uname": _strip_html(item.get("uname") or item.get("name") or ""),
        "sign": item.get("usign") or item.get("sign") or "",
        "fans": _int(item.get("fans")),
        "videos": _int(item.get("videos")),
        "level": _int(item.get("level")),
        "avatar": _fix_url(item.get("upic") or item.get("face") or ""),
    }


def _norm_comment(item: dict, owner_mid: int) -> dict:
    member = item.get("member") or {}
    mid = _int(item.get("mid") or member.get("mid"))
    return {
        "rpid": item.get("rpid"),
        "content": (item.get("content") or {}).get("message") or "",
        "like_count": _int(item.get("like")),
        "reply_count": _int(item.get("rcount")),
        "create_time": _fmt_time(item.get("ctime")),
        "author_name": member.get("uname") or "",
        "author_mid": mid,
        "is_up": bool(owner_mid) and mid == owner_mid,
    }


# ─── 各 mode 实现 ───
def _resolve_aid(bvid: str, aid) -> tuple[int, int, str]:
    """把 bvid/aid 解析成 (aid, owner_mid, bvid)。"""
    params = {"bvid": bvid} if bvid else {"aid": aid}
    payload = call_api("/x/web-interface/view", params,
                       referer=f"https://www.bilibili.com/video/{bvid or ('av' + str(aid))}")
    data = payload.get("data") or {}
    owner = data.get("owner") or {}
    return _int(data.get("aid")), _int(owner.get("mid")), data.get("bvid") or bvid


def fetch_video(args) -> dict:
    if not args.bvid and not args.aid:
        raise FetchError(FAILURE_API, "video 模式需要 --bvid 或 --aid")
    params = {"bvid": args.bvid} if args.bvid else {"aid": args.aid}
    payload = call_api("/x/web-interface/view", params,
                       referer=f"https://www.bilibili.com/video/{args.bvid or ('av' + str(args.aid))}")
    data = payload.get("data") or {}
    item = _norm_video(data)
    item["cid"] = _int(data.get("cid"))
    item["pages"] = len(data.get("pages") or [])
    item["tname"] = data.get("tname") or ""
    return {"data": [item], "has_more": False}


def fetch_up(args, mid: int, page: int, count: int) -> dict:
    payload = call_api(
        "/x/space/wbi/arc/search",
        {"mid": mid, "ps": count, "pn": page, "order": "pubdate",
         "platform": "web", "web_location": "1550101", "order_avoided": "true"},
        referer=f"https://space.bilibili.com/{mid}", wbi=True,
    )
    data = payload.get("data") or {}
    vlist = (data.get("list") or {}).get("vlist") or []
    page_info = data.get("page") or {}
    total = _int(page_info.get("count"))
    has_more = page * _int(page_info.get("size") or count) < total
    return {"data": [_norm_video(v) for v in vlist], "has_more": has_more, "total": total}


def fetch_search(args, keyword: str, page: int, count: int) -> dict:
    payload = call_api(
        "/x/web-interface/wbi/search/type",
        {"search_type": "video", "keyword": keyword, "page": page},
        referer=f"https://search.bilibili.com/all?keyword={urllib.parse.quote(keyword)}",
        wbi=True,
    )
    data = payload.get("data") or {}
    result = data.get("result") or []
    if isinstance(result, dict):  # 无结果时平台可能返回 dict
        result = []
    num_pages = _int(data.get("numPages"))
    return {
        "data": [_norm_video(v) for v in result],
        "has_more": page < num_pages,
        "total": _int(data.get("numResults")),
    }


def fetch_user_search(args, keyword: str, page: int) -> dict:
    payload = call_api(
        "/x/web-interface/wbi/search/type",
        {"search_type": "bili_user", "keyword": keyword, "page": page},
        referer=f"https://search.bilibili.com/upuser?keyword={urllib.parse.quote(keyword)}",
        wbi=True,
    )
    data = payload.get("data") or {}
    result = data.get("result") or []
    if isinstance(result, dict):
        result = []
    num_pages = _int(data.get("numPages"))
    return {
        "data": [_norm_up(v) for v in result],
        "has_more": page < num_pages,
        "total": _int(data.get("numResults")),
    }


def fetch_ranking(count: int) -> dict:
    payload = call_api("/x/web-interface/ranking/v2", {"rid": 0, "type": "all"},
                       referer=RANK_REFERER)
    data = payload.get("data") or {}
    lst = (data.get("list") or [])[:count]
    return {"data": [_norm_video(v) for v in lst], "has_more": False}


def fetch_hot(page: int, count: int) -> dict:
    payload = call_api("/x/web-interface/popular", {"ps": count, "pn": page},
                       referer=POPULAR_REFERER)
    data = payload.get("data") or {}
    lst = data.get("list") or []
    return {"data": [_norm_video(v) for v in lst],
            "has_more": not data.get("no_more", True)}


def fetch_related(args, count: int) -> dict:
    if not args.bvid and not args.aid:
        raise FetchError(FAILURE_API, "related 模式需要 --bvid 或 --aid")
    params = {"bvid": args.bvid} if args.bvid else {"aid": args.aid}
    payload = call_api("/x/web-interface/archive/related", params,
                       referer=f"https://www.bilibili.com/video/{args.bvid or ('av' + str(args.aid))}")
    lst = payload.get("data") or []
    if not isinstance(lst, list):
        lst = []
    return {"data": [_norm_video(v) for v in lst[:count]], "has_more": False}


def fetch_comment(args, page: int, count: int) -> dict:
    if not args.bvid and not args.aid:
        raise FetchError(FAILURE_API, "comment 模式需要 --bvid 或 --aid")
    aid, owner_mid, bvid = _resolve_aid(args.bvid, args.aid)
    if not aid:
        raise FetchError(FAILURE_API, "无法解析视频 aid，请检查 bvid / aid 是否正确")
    payload = call_api(
        "/x/v2/reply/wbi/main",
        {"oid": aid, "type": 1, "mode": 3, "ps": count, "pn": page},
        referer=f"https://www.bilibili.com/video/{bvid or ('av' + str(aid))}",
        wbi=True,
    )
    data = payload.get("data") or {}
    replies = data.get("replies") or []
    cursor = data.get("cursor") or {}
    return {
        "data": [_norm_comment(r, owner_mid) for r in replies],
        "has_more": not cursor.get("is_end", True),
        "total": _int(cursor.get("all_count")),
    }


def fetch_profile(mid: int) -> dict:
    payload = call_api(
        "/x/space/wbi/acc/info",
        {"mid": mid, "platform": "web", "web_location": "1550101"},
        referer=f"https://space.bilibili.com/{mid}", wbi=True,
    )
    data = payload.get("data") or {}
    return {
        "data": [{
            "mid": _int(data.get("mid")),
            "nickname": data.get("name") or "",
            "sign": data.get("sign") or "",
            "level": _int(data.get("level")),
            "avatar": _fix_url(data.get("face") or ""),
        }],
        "has_more": False,
    }


# ─── 主流程 ───
def decide_mode(args, req_text: str) -> str:
    if args.mode:
        return args.mode
    if args.bvid or args.aid:
        return "comment" if any(m in req_text for m in COMMENT_MARKERS) else "video"
    if args.mid:
        return "up"
    if args.keyword or extract_keyword_from_request(req_text):
        return "search"
    if any(m in req_text for m in RANK_MARKERS):
        return "ranking"
    if any(m in req_text for m in HOT_MARKERS):
        return "hot"
    if any(m in req_text for m in SELF_MARKERS):
        return "user"
    return "user"


def main() -> None:
    parser = argparse.ArgumentParser(description="B站数据采集")
    parser.add_argument("--mode", default="",
                        choices=["", "video", "user", "up", "profile", "search",
                                 "user-search", "ranking", "hot", "related", "comment"])
    parser.add_argument("--bvid", default="")
    parser.add_argument("--aid", default="")
    parser.add_argument("--mid", default="")
    parser.add_argument("--keyword", default="")
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--page", type=int, default=1)
    args = parser.parse_args()

    req_text = os.environ.get("DSAGENT_REQUEST", "") or ""
    mode = decide_mode(args, req_text)
    count = min(max(args.count, 1), MAX_COUNT)
    page = max(args.page, 1)
    keyword = args.keyword or extract_keyword_from_request(req_text)

    # 本人相关模式：请求含「我的/自己」时清掉误提取的关键词
    if mode in ("user", "profile") and any(m in req_text for m in SELF_MARKERS):
        keyword = args.keyword

    log(f"[采集] 模式={mode} 页={page} 条数={count}"
        + (f" 关键词={keyword}" if keyword else ""))

    try:
        # 1) 绑定预检：未绑定 / 需选号 / 登录态过期 在此拦截
        fetch_binding_context(platform=PLATFORM)
        # 2) nav 校验登录态并取 WBI 密钥 + 账号信息
        account = get_wbi_keys()
        self_mid = account["mid"]
        log(f"[采集] 账号={account['nickname']} mid={self_mid}")

        # 3) 按模式采集
        if mode == "video":
            result = fetch_video(args)
        elif mode == "user":
            result = fetch_up(args, self_mid, page, count)
        elif mode == "up":
            if not args.mid:
                raise FetchError(FAILURE_API, "up 模式需要 --mid（UP 主 mid）")
            result = fetch_up(args, _int(args.mid), page, count)
        elif mode == "profile":
            result = fetch_profile(self_mid)
        elif mode == "search":
            if not keyword:
                raise FetchError(FAILURE_API, "search 模式需要 --keyword（搜索关键词）")
            result = fetch_search(args, keyword, page, count)
        elif mode == "user-search":
            if not keyword:
                raise FetchError(FAILURE_API, "user-search 模式需要 --keyword（搜索关键词）")
            result = fetch_user_search(args, keyword, page)
        elif mode == "ranking":
            result = fetch_ranking(count)
        elif mode == "hot":
            result = fetch_hot(page, count)
        elif mode == "related":
            result = fetch_related(args, count)
        else:
            result = fetch_comment(args, page, count)

    except BindingContextError as e:
        log(f"[采集] 账号不可用: {e}")
        output_result({"ok": False, "mode": mode, "failure_kind": e.failure_kind,
                       "error": str(e), "accounts": e.accounts})
        sys.exit(1)
    except FetchError as e:
        log(f"[采集] 失败: {e.message}")
        output_result({"ok": False, "mode": mode, "failure_kind": e.failure_kind,
                       "error": e.message})
        sys.exit(1)
    except Exception as e:  # 兜底，避免栈信息污染 stdout
        log(f"[采集] 未预期异常: {e}")
        output_result({"ok": False, "mode": mode, "failure_kind": FAILURE_API,
                       "error": f"未预期异常: {e}"})
        sys.exit(1)

    output = {
        "ok": True,
        "mode": mode,
        "total": len(result["data"]),
        "has_more": result.get("has_more", False),
        "data": result["data"],
        "account": {"nickname": account["nickname"], "mid": self_mid},
        "fetch_time": datetime.now(BJT).strftime("%Y-%m-%d %H:%M:%S"),
    }
    if keyword:
        output["keyword"] = keyword
    if mode in ("user", "up", "search", "user-search", "hot", "comment"):
        output["page"] = page
    if "total" in result:
        output["total_available"] = result["total"]

    output_summary(result["data"], 模式=mode)
    output_result(output)


if __name__ == "__main__":
    main()
