#!/usr/bin/env python3
"""
抖音数据采集脚本 — DSAgent douyin-crawl v1.0

通过抖音 Web 接口采集作品列表 / 视频详情 / 关键词搜索 / 用户搜索 / 热搜榜 /
喜欢列表 / 账号资料。所有请求走本地代理网关（Cookie 由网关注入，技能不接触 Cookie）。

关键前置：凭证库里的 account_id 是派生哈希值，**不是**抖音真实 sec_user_id。
必须先调 user/profile/self/ 解析真实 sec_uid / uid，否则业务接口返回 status_code=5。
"""

import json
import os
import sys
from datetime import datetime, timezone, timedelta

# ── 引入 dsagent_runtime ──
_dsagent_dir = os.path.join(os.environ.get("DSAGENT_SKILL_ROOT", ""), ".dsagent")
if _dsagent_dir and _dsagent_dir not in sys.path:
    sys.path.insert(0, _dsagent_dir)

from runtime.dsagent_runtime import log, output_result, output_summary
from runtime.dsagent_runtime import http_get, CallThrottle, extract_keyword_from_request
from runtime.dsagent_runtime import FAILURE_RISK, FAILURE_TOKEN, FAILURE_PARSE, FAILURE_API

BJT = timezone(timedelta(hours=8))

# 「本人数据」标记：命中时不得把请求文本当成搜索关键词
SELF_MARKERS = ("我的", "自己", "本人", "我账号", "我抖音")

# 「热榜」类请求：应落 hot 模式，而不是拿「热榜」二字去搜索
HOT_MARKERS = ("热榜", "热搜", "热门榜", "热点榜")

BASE = "https://www.douyin.com"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# 抖音 Web 端公共参数（与浏览器一致，缺失会被判为异常请求）
COMMON = {
    "device_platform": "webapp",
    "aid": "6383",
    "channel": "channel_pc_web",
    "pc_client_type": "1",
    "version_code": "170400",
    "version_name": "17.4.0",
    "cookie_enabled": "true",
    "screen_width": "1920",
    "screen_height": "1080",
    "browser_language": "zh-CN",
    "browser_platform": "Win32",
    "browser_name": "Chrome",
    "browser_version": "120.0.0.0",
    "browser_online": "true",
    "engine_name": "Blink",
    "engine_version": "120.0.0.0",
    "os_name": "Windows",
    "os_version": "10",
    "cpu_core_num": "8",
    "device_memory": "8",
    "platform": "PC",
    "downlink": "10",
    "effective_type": "4g",
    "round_trip_time": "50",
}

# 网关自身已有 4~6s 账号级节流，这里再按 SKILL.md 承诺保持 ≥ 6s 间隔
THROTTLE = CallThrottle(min_interval=6.0, jitter=1.0)


class FetchError(Exception):
    """采集失败，携带 failure_kind"""

    def __init__(self, failure_kind, message):
        super().__init__(message)
        self.failure_kind = failure_kind
        self.message = message


def _headers(referer=None):
    return {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": referer or "https://www.douyin.com/",
    }


def call_api(path, params, referer=None, retries=1):
    """通过网关代理 GET 抖音接口，返回已解析的 dict

    抖音对高频请求会间歇性返回 HTTP 200 + 空体（不是错误码也不是风控），
    此时重试一次即可恢复；不重试会被误报成 parse_error。
    """
    for attempt in range(retries + 1):
        THROTTLE.wait()
        try:
            result = http_get(
                f"{BASE}{path}",
                platform="douyin",
                params=params,
                headers=_headers(referer),
                timeout=30,
            )
        except Exception as e:
            raise FetchError(getattr(e, "failure_kind", FAILURE_API), f"请求异常: {e}")

        if result.get("status") != "success":
            raise FetchError(
                result.get("failure_kind", FAILURE_API),
                result.get("error_message") or "平台请求失败",
            )

        payload = result.get("payload")
        if payload is None or (isinstance(payload, str) and not payload.strip()):
            if attempt < retries:
                log(f"[采集] {path} 返回空体，重试一次")
                continue
            raise FetchError(FAILURE_PARSE, f"{path} 返回空响应（抖音高频限流），请稍后重试")

        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                raise FetchError(FAILURE_PARSE, f"响应解析失败: {payload[:200]}")
        if not isinstance(payload, dict):
            raise FetchError(FAILURE_PARSE, f"响应格式异常: {str(payload)[:200]}")
        return payload


def check_status(payload, path):
    """校验抖音 status_code，非 0 视为 api_error"""
    code = payload.get("status_code")
    if code not in (0, None):
        msg = payload.get("status_msg") or f"status_code={code}"
        raise FetchError(FAILURE_API, f"{path} 返回错误: {msg}")


def check_search_nil(payload, path):
    """搜索类接口风控识别：search_nil_type=verify_check 表示被要求安全验证，不是 0 条结果"""
    nil_type = (payload.get("search_nil_info") or {}).get("search_nil_type") or ""
    if nil_type == "verify_check":
        raise FetchError(
            FAILURE_RISK,
            f"{path} 触发抖音安全验证（verify_check），请到抖音网页完成验证后重试",
        )


def ts_to_str(ts):
    """秒级时间戳 → 北京时间字符串"""
    try:
        ts = int(ts)
    except (TypeError, ValueError):
        return ""
    if ts <= 0:
        return ""
    return datetime.fromtimestamp(ts, BJT).strftime("%Y-%m-%d %H:%M:%S")


def first_url(obj):
    """从 {url_list: [...]} 结构取第一个 URL"""
    if isinstance(obj, dict):
        urls = obj.get("url_list") or []
        if urls:
            return urls[0]
    return ""


def normalize_aweme(aweme):
    """作品对象 → 统一字段"""
    if not isinstance(aweme, dict):
        return None
    author = aweme.get("author") or {}
    stats = aweme.get("statistics") or {}
    video = aweme.get("video") or {}

    play = video.get("play_addr") or video.get("play_addr_h264") or video.get("download_addr") or {}
    cover = video.get("cover") or video.get("origin_cover") or video.get("dynamic_cover") or {}

    aweme_id = str(aweme.get("aweme_id") or "")
    text_extra = [
        t.get("hashtag_name")
        for t in (aweme.get("text_extra") or [])
        if isinstance(t, dict) and t.get("hashtag_name")
    ]

    def num(key):
        try:
            return int(stats.get(key) or 0)
        except (TypeError, ValueError):
            return 0

    return {
        "aweme_id": aweme_id,
        "desc": aweme.get("desc") or "",
        "create_time": ts_to_str(aweme.get("create_time")),
        "duration_ms": int(aweme.get("duration") or 0),
        "author_nick": author.get("nickname") or "",
        "author_uid": str(author.get("uid") or ""),
        "author_sec_uid": author.get("sec_uid") or "",
        "digg_count": num("digg_count"),
        "comment_count": num("comment_count"),
        "share_count": num("share_count"),
        "collect_count": num("collect_count"),
        "play_count": num("play_count"),
        "video_url": first_url(play),
        "cover_url": first_url(cover),
        "share_url": aweme.get("share_url") or (
            f"https://www.douyin.com/video/{aweme_id}" if aweme_id else ""
        ),
    }


def normalize_aweme_detail(aweme):
    """视频详情：在统一字段基础上补 music_title / text_extra"""
    item = normalize_aweme(aweme)
    if item is None:
        return None
    music = aweme.get("music") or {}
    item["music_title"] = music.get("title") or ""
    item["text_extra"] = [
        t.get("hashtag_name")
        for t in (aweme.get("text_extra") or [])
        if isinstance(t, dict) and t.get("hashtag_name")
    ]
    return item


def normalize_user(user):
    """用户对象 → 统一字段"""
    if not isinstance(user, dict):
        return None
    return {
        "nickname": user.get("nickname") or "",
        "uid": str(user.get("uid") or ""),
        "sec_uid": user.get("sec_uid") or "",
        "signature": user.get("signature") or "",
        "follower_count": int(user.get("follower_count") or 0),
        "aweme_count": int(user.get("aweme_count") or 0),
        "total_favorited": int(user.get("total_favorited") or 0),
    }


# ─── 各 mode 实现 ───

def fetch_self():
    """解析当前登录账号真实身份（sec_uid / uid）"""
    payload = call_api("/aweme/v1/web/user/profile/self/", dict(COMMON))
    check_status(payload, "user/profile/self")
    user = payload.get("user") or payload.get("user_info") or {}
    sec_uid = user.get("sec_uid") or ""
    if not sec_uid:
        raise FetchError(
            FAILURE_TOKEN,
            "无法解析账号真实身份（sec_uid 为空），抖音登录态可能已失效，请重新登录",
        )
    return normalize_user(user)


def fetch_aweme_post(sec_uid, count, max_cursor):
    params = {
        **COMMON,
        "sec_user_id": sec_uid,
        "max_cursor": max_cursor,
        "count": count,
        "publish_video_strategy_type": "2",
    }
    payload = call_api("/aweme/v1/web/aweme/post/", params)
    check_status(payload, "aweme/post")
    items = [x for x in (normalize_aweme(a) for a in (payload.get("aweme_list") or [])) if x]
    return {
        "data": items,
        "has_more": bool(payload.get("has_more")),
        "max_cursor": payload.get("max_cursor") or 0,
    }


def fetch_aweme_detail(aweme_id):
    params = {**COMMON, "aweme_id": aweme_id}
    payload = call_api(
        "/aweme/v1/web/aweme/detail/", params, referer=f"https://www.douyin.com/video/{aweme_id}"
    )
    check_status(payload, "aweme/detail")
    detail = normalize_aweme_detail(payload.get("aweme_detail"))
    if detail is None:
        return {"data": [], "has_more": False, "max_cursor": 0}
    return {"data": [detail], "has_more": False, "max_cursor": 0}


def fetch_search(keyword, offset, count):
    """关键词综合搜索"""
    params = {
        **COMMON,
        "keyword": keyword,
        "offset": offset,
        "count": count,
        "search_channel": "aweme_general",
        "sort_type": "0",
        "publish_time": "0",
        "search_source": "normal_search",
    }
    payload = call_api("/aweme/v1/web/general/search/single/", params)
    check_status(payload, "general/search/single")
    check_search_nil(payload, "general/search/single")

    items = []
    for entry in payload.get("data") or []:
        if not isinstance(entry, dict):
            continue
        aweme = entry.get("aweme_info")
        if not aweme and entry.get("type") == 1:
            aweme = entry.get("aweme_info") or entry.get("aweme")
        item = normalize_aweme(aweme) if aweme else None
        if item:
            items.append(item)
    return {
        "data": items,
        "has_more": bool(payload.get("has_more")),
        "max_cursor": payload.get("cursor") or 0,
    }


def fetch_user_search(keyword, offset, count):
    """按关键词搜用户"""
    params = {
        **COMMON,
        "keyword": keyword,
        "offset": offset,
        "count": count,
        "search_channel": "aweme_user_web",
        "search_source": "normal_search",
    }
    payload = call_api("/aweme/v1/web/discover/search/", params)
    check_status(payload, "discover/search")
    check_search_nil(payload, "discover/search")

    items = []
    for entry in payload.get("user_list") or []:
        if not isinstance(entry, dict):
            continue
        user = entry.get("user_info") or entry.get("user") or entry
        item = normalize_user(user)
        if item:
            items.append(item)
    return {
        "data": items,
        "has_more": bool(payload.get("has_more")),
        "max_cursor": payload.get("cursor") or 0,
    }


def fetch_hot():
    """抖音热搜榜"""
    params = {
        "device_platform": "webapp",
        "aid": "6383",
        "detail_list": "1",
        "source": "6",
        "board_type": "0",
        "board_sub_type": "",
    }
    payload = call_api("/aweme/v1/web/hot/search/list/", params)
    check_status(payload, "hot/search/list")

    word_list = (payload.get("data") or {}).get("word_list") or []
    items = []
    for idx, w in enumerate(word_list):
        if not isinstance(w, dict):
            continue
        items.append({
            "rank": int(w.get("position") or idx + 1),
            "word": w.get("word") or "",
            "hot_value": int(w.get("hot_value") or 0),
            "sentence_id": str(w.get("sentence_id") or ""),
        })
    return {"data": items, "has_more": False, "max_cursor": 0}


def fetch_favorite(count, max_cursor):
    """当前账号的喜欢列表"""
    params = {**COMMON, "max_cursor": max_cursor, "count": count}
    payload = call_api("/aweme/v1/web/aweme/favorite/", params)
    check_status(payload, "aweme/favorite")
    items = [x for x in (normalize_aweme(a) for a in (payload.get("aweme_list") or [])) if x]
    return {
        "data": items,
        "has_more": bool(payload.get("has_more")),
        "max_cursor": payload.get("max_cursor") or 0,
    }


def normalize_challenge(info, fallback_id=""):
    """话题对象 → 统一字段"""
    if not isinstance(info, dict):
        return None
    ch_id = str(info.get("cid") or info.get("ch_id") or fallback_id or "")
    if not ch_id:
        return None
    return {
        "ch_id": ch_id,
        "cha_name": info.get("cha_name") or info.get("ch_name") or "",
        "desc": info.get("desc") or "",
        "view_count": int(info.get("view_count") or 0),
        "user_count": int(info.get("user_count") or 0),
        "create_time": ts_to_str(info.get("create_time")),
        "share_url": f"https://www.douyin.com/hashtag/{ch_id}",
    }


def fetch_challenge_search(keyword, count):
    """关键词 → 话题列表（ch_id 解析入口，用户只给话题名时必须先走这里）"""
    params = {**COMMON, "keyword": keyword, "count": count, "cursor": 0}
    payload = call_api("/aweme/v1/web/challenge/search/", params)
    check_status(payload, "challenge/search")
    items = []
    for entry in payload.get("challenge_list") or []:
        if not isinstance(entry, dict):
            continue
        info = entry.get("challenge_info") or entry.get("ch_info") or {}
        item = normalize_challenge(info)
        if item:
            items.append(item)
    return {
        "data": items,
        "has_more": bool(payload.get("has_more")),
        "max_cursor": payload.get("cursor") or 0,
    }


def fetch_challenge_detail(ch_id):
    """话题详情（播放量 / 参与人数 / 描述）"""
    params = {**COMMON, "ch_id": ch_id}
    payload = call_api(
        "/aweme/v1/web/challenge/detail/",
        params,
        referer=f"https://www.douyin.com/hashtag/{ch_id}",
    )
    check_status(payload, "challenge/detail")
    info = payload.get("ch_info") or payload.get("challenge_info") or {}
    return normalize_challenge(info, fallback_id=ch_id)


def fetch_challenge_aweme(ch_id, count, cursor):
    """话题下的作品列表"""
    params = {**COMMON, "ch_id": ch_id, "count": count, "cursor": cursor}
    payload = call_api(
        "/aweme/v1/web/challenge/aweme/",
        params,
        referer=f"https://www.douyin.com/hashtag/{ch_id}",
    )
    check_status(payload, "challenge/aweme")
    items = [x for x in (normalize_aweme(a) for a in (payload.get("aweme_list") or [])) if x]
    return {
        "data": items,
        "has_more": bool(payload.get("has_more")),
        "max_cursor": payload.get("cursor") or 0,
    }


def fetch_related(aweme_id, count):
    """以某条视频为种子的相关推荐（同题材爆款裂变）"""
    params = {**COMMON, "aweme_id": aweme_id, "count": count, "filterGids": ""}
    payload = call_api(
        "/aweme/v1/web/aweme/related/",
        params,
        referer=f"https://www.douyin.com/video/{aweme_id}",
    )
    check_status(payload, "aweme/related")
    items = [x for x in (normalize_aweme(a) for a in (payload.get("aweme_list") or [])) if x]
    return {
        "data": items,
        "has_more": bool(payload.get("has_more")),
        "max_cursor": 0,
    }


def main():
    import argparse

    parser = argparse.ArgumentParser(description="抖音数据采集")
    parser.add_argument("--mode", "-m",
                        choices=["user", "detail", "search", "user-search", "hot", "favorite", "profile",
                                 "topic", "topic-search", "related"],
                        help="采集模式（不传则按参数自动判定）")
    parser.add_argument("--keyword", "-k", help="搜索关键词（如未提供则从 DSAGENT_REQUEST 提取）")
    parser.add_argument("--aweme-id", help="视频 ID（detail / related 模式必填）")
    parser.add_argument("--ch-id", help="话题 ID（topic 模式可选，不传则按关键词解析）")
    parser.add_argument("--count", "-n", type=int, default=18, help="单次数量（默认 18，最大 50）")
    parser.add_argument("--max-cursor", type=int, default=0, help="翻页游标（user / favorite 模式）")
    parser.add_argument("--cursor", type=int, default=0, help="翻页游标（topic 模式）")
    parser.add_argument("--offset", type=int, default=0, help="偏移量（search / user-search 模式）")
    args = parser.parse_args()

    count = min(max(args.count, 1), 50)

    # 关键词必须最先提取：mode 自动判定依赖它（否则自然语言请求会被误判为 user）
    req_text = os.environ.get("DSAGENT_REQUEST", "")
    req_keyword = args.keyword or extract_keyword_from_request(req_text)
    # 「我的 / 自己的」类请求取的是本人数据，不能当成搜索关键词
    if not args.keyword and any(m in req_text for m in SELF_MARKERS):
        req_keyword = ""
    # 「热榜 / 热搜」类请求看的是榜单，不能拿「热榜」二字去搜索
    is_hot_request = not args.keyword and any(m in req_text for m in HOT_MARKERS)
    if is_hot_request:
        req_keyword = ""

    mode = args.mode
    if not mode:
        if args.aweme_id:
            mode = "detail"
        elif req_keyword:
            mode = "search"
        elif is_hot_request:
            mode = "hot"
        else:
            mode = "user"

    if mode == "detail" and not args.aweme_id:
        output_result({"ok": False, "failure_kind": "skill_error", "message": "detail 模式需要 --aweme-id"})
        sys.exit(1)

    if mode == "related" and not args.aweme_id:
        output_result({"ok": False, "failure_kind": "skill_error", "message": "related 模式需要 --aweme-id（以该视频为种子找同题材推荐）"})
        sys.exit(1)

    # 只有真正消费关键词的模式才保留它，避免 user/profile/hot 输出无关字段
    keyword = req_keyword if mode in ("search", "user-search", "topic", "topic-search") else ""
    if mode in ("search", "user-search") and not keyword:
        output_result({"ok": False, "failure_kind": "skill_error", "message": "未提供搜索关键词，请使用 --keyword 参数或在请求中注明要搜索的内容"})
        sys.exit(1)
    if mode in ("topic", "topic-search") and not keyword and not args.ch_id:
        output_result({"ok": False, "failure_kind": "skill_error", "message": f"{mode} 模式需要 --ch-id 或 --keyword（话题名）"})
        sys.exit(1)

    if not os.environ.get("DSCONNECT_URL"):
        output_result({"ok": False, "failure_kind": "not_bound", "message": "未检测到本地代理网关，请到「账号连接」页面绑定抖音账号后重试"})
        sys.exit(1)

    log(f"[采集] mode={mode} keyword='{keyword}' count={count} cursor={args.cursor} offset={args.offset}")

    try:
        account = None
        if mode in ("user", "favorite", "profile"):
            account = fetch_self()
            log(f"[采集] 账号身份: {account['nickname']} (uid={account['uid']})")

        challenge = None
        if mode == "profile":
            result = {"data": [account], "has_more": False, "max_cursor": 0}
        elif mode == "user":
            result = fetch_aweme_post(account["sec_uid"], count, args.max_cursor)
        elif mode == "detail":
            result = fetch_aweme_detail(args.aweme_id)
        elif mode == "search":
            result = fetch_search(keyword, args.offset, count)
        elif mode == "user-search":
            result = fetch_user_search(keyword, args.offset, count)
        elif mode == "hot":
            result = fetch_hot()
        elif mode == "favorite":
            result = fetch_favorite(count, args.max_cursor)
        elif mode == "topic-search":
            result = fetch_challenge_search(keyword, count)
        elif mode == "topic":
            ch_id = args.ch_id or ""
            if not ch_id:
                found = fetch_challenge_search(keyword, 10)["data"]
                if not found:
                    raise FetchError(FAILURE_API, f"未找到与「{keyword}」匹配的话题，请换个更精确的话题名")
                ch_id = found[0]["ch_id"]
                log(f"[采集] 话题解析: 「{keyword}」→ {found[0]['cha_name']} (ch_id={ch_id})")
            challenge = fetch_challenge_detail(ch_id)
            log(f"[采集] 话题详情: {challenge['cha_name']} 播放={challenge['view_count']} 参与={challenge['user_count']}")
            result = fetch_challenge_aweme(ch_id, count, args.cursor)
            result["challenge"] = challenge
        elif mode == "related":
            result = fetch_related(args.aweme_id, count)
        else:
            raise FetchError(FAILURE_API, f"未知模式: {mode}")

    except FetchError as e:
        output_result({"ok": False, "failure_kind": e.failure_kind, "message": e.message})
        sys.exit(1)

    output = {
        "ok": True,
        "mode": mode,
        "total": len(result["data"]),
        "has_more": result["has_more"],
        "max_cursor": result["max_cursor"],
        "data": result["data"],
    }
    if keyword:
        output["keyword"] = keyword
    if account:
        output["account"] = account
    if challenge:
        output["challenge"] = challenge
    output["fetch_time"] = datetime.now(BJT).strftime("%Y-%m-%d %H:%M:%S")

    output_summary(result["data"], 模式=mode)
    output_result(output)


if __name__ == "__main__":
    main()
