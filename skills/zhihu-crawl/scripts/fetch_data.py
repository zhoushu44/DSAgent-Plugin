#!/usr/bin/env python3
"""
知乎数据采集脚本 — DSAgent zhihu-crawl v1.0

通过知乎 Web / API v4 接口采集关键词搜索 / 问题回答列表 / 回答详情 / 评论 /
用户主页 / 用户回答与文章列表 / 热榜数据。所有请求走本地代理网关
（Cookie 由网关注入，技能不接触 Cookie）。

关键前置：知乎多数端点带登录 Cookie 直连即可，**无需 ZSE 签名**（x-zse-93 / x-zse-96）。
实测受限端点（HTTP 403，error.code=10003「请求参数异常」）：
  - questions/{id} 详情
  - articles/{id} 详情
本脚本绕开这两个端点：问题标题统一从 questions/{id}/answers 的 item.question.title
间接取得，文章能力降级为「用户文章列表」。
"""

import csv
import html
import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta
from urllib.parse import quote

# ── 引入 dsagent_runtime ──
_dsagent_dir = os.path.join(os.environ.get("DSAGENT_SKILL_ROOT", ""), ".dsagent")
if _dsagent_dir and _dsagent_dir not in sys.path:
    sys.path.insert(0, _dsagent_dir)

from runtime.dsagent_runtime import log, output_result, output_summary, output_files
from runtime.dsagent_runtime import http_get, CallThrottle, extract_keyword_from_request
from runtime.dsagent_runtime import FAILURE_RISK, FAILURE_TOKEN, FAILURE_PARSE, FAILURE_API

BJT = timezone(timedelta(hours=8))

BASE = "https://www.zhihu.com"
HOT_BASE = "https://api.zhihu.com"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# 网关自身已有 4~6s 账号级节流，这里再按 SKILL.md 承诺保持 ≥ 2s 间隔
THROTTLE = CallThrottle(min_interval=2.0, jitter=0.5)

# 知乎单页上限：search_v3 / answers / root_comments 实测最大 20，热榜最大 50
PAGE_LIMIT = 20
HOT_LIMIT = 50

# 「热榜」类请求：应落 hot 模式，而不是拿「热榜」二字去搜索
HOT_MARKERS = ("热榜", "热搜", "热门榜", "热点榜")

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


class FetchError(Exception):
    """采集失败，携带 failure_kind"""

    def __init__(self, failure_kind, message):
        super().__init__(message)
        self.failure_kind = failure_kind
        self.message = message


def strip_html(text):
    """去 HTML 标签 + 反转义实体 + 压空白（搜索结果的 <em> 高亮也一并清掉）"""
    if not text:
        return ""
    out = _TAG_RE.sub("", str(text))
    out = html.unescape(out)
    return _WS_RE.sub(" ", out).strip()


def ts_to_str(ts):
    """秒级时间戳 → 北京时间字符串"""
    try:
        ts = int(ts)
    except (TypeError, ValueError):
        return ""
    if ts <= 0:
        return ""
    return datetime.fromtimestamp(ts, BJT).strftime("%Y-%m-%d %H:%M:%S")


def to_int(v):
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def _headers(referer=None):
    return {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": referer or "https://www.zhihu.com/",
        "x-requested-with": "fetch",
    }


def call_api(url, params=None, referer=None):
    """通过网关代理 GET 知乎接口，返回已解析的 dict"""
    THROTTLE.wait()
    try:
        result = http_get(url, platform="zhihu", params=params, headers=_headers(referer), timeout=30)
    except Exception as e:
        raise FetchError(getattr(e, "failure_kind", FAILURE_API), f"请求异常: {e}")

    # rate_limit 由 runtime 直接透传（可重试），其余失败抛异常
    if result.get("status") != "success":
        kind = result.get("failure_kind", FAILURE_API)
        msg = result.get("error_message") or "平台请求失败"
        if kind == "rate_limit":
            raise FetchError(FAILURE_API, f"{msg}（可稍后重试）")
        raise FetchError(kind, msg)

    payload = result.get("payload")
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            raise FetchError(FAILURE_PARSE, f"响应解析失败: {payload[:200]}")
    if not isinstance(payload, dict):
        raise FetchError(FAILURE_PARSE, f"响应格式异常: {str(payload)[:200]}")

    # 知乎错误信封：{"error": {"code": 4041, "message": "..."}}
    err = payload.get("error")
    if isinstance(err, dict):
        code = err.get("code")
        msg = err.get("message") or f"error.code={code}"
        if code == 4041:
            raise FetchError(FAILURE_API, f"资源不存在：{msg}")
        raise FetchError(FAILURE_API, f"知乎接口返回错误：{msg}")

    return payload


def has_more_of(payload):
    """从 paging.is_end 推导是否还有下一页"""
    paging = payload.get("paging") or {}
    if "is_end" in paging:
        return not bool(paging.get("is_end"))
    return False


# ─── 各对象规范化 ───

def normalize_author(author):
    """作者对象 → (name, url_token, headline)"""
    if not isinstance(author, dict):
        return "", "", ""
    return (
        author.get("name") or "",
        author.get("url_token") or "",
        author.get("headline") or "",
    )


def normalize_search_entry(entry):
    """search_v3 条目 → 统一字段（按 object.type 分流）"""
    if not isinstance(entry, dict):
        return None
    obj = entry.get("object")
    if not isinstance(obj, dict):
        return None

    otype = obj.get("type") or ""
    name, token, headline = normalize_author(obj.get("author"))
    oid = str(obj.get("id") or "")

    if otype == "answer":
        # 注意：搜索里的 question 用 name 字段承载标题（不是 title）
        q = obj.get("question") or {}
        return {
            "type": "answer",
            "id": oid,
            "title": strip_html(q.get("name") or q.get("title") or ""),
            "excerpt": strip_html(obj.get("excerpt") or ""),
            "content": strip_html(obj.get("content") or ""),
            "voteup_count": to_int(obj.get("voteup_count")),
            "comment_count": to_int(obj.get("comment_count")),
            "author_name": name,
            "author_token": token,
            "question_id": str(q.get("id") or ""),
            "created_time": ts_to_str(obj.get("created_time")),
            "url": f"{BASE}/answer/{oid}" if oid else "",
        }

    if otype == "article":
        return {
            "type": "article",
            "id": oid,
            "title": strip_html(obj.get("title") or ""),
            "excerpt": strip_html(obj.get("excerpt") or ""),
            "content": strip_html(obj.get("content") or ""),
            "voteup_count": to_int(obj.get("voteup_count")),
            "comment_count": to_int(obj.get("comment_count")),
            "author_name": name,
            "author_token": token,
            "question_id": "",
            "created_time": ts_to_str(obj.get("created_time")),
            "url": f"https://zhuanlan.zhihu.com/p/{oid}" if oid else "",
        }

    if otype == "question":
        return {
            "type": "question",
            "id": oid,
            "title": strip_html(obj.get("title") or ""),
            "excerpt": strip_html(obj.get("excerpt") or ""),
            "content": "",
            "voteup_count": to_int(obj.get("voteup_count")),
            "comment_count": to_int(obj.get("comment_count")),
            "author_name": name,
            "author_token": token,
            "question_id": oid,
            "created_time": ts_to_str(obj.get("created_time")),
            "url": f"{BASE}/question/{oid}" if oid else "",
        }

    if otype in ("people", "user"):
        return {
            "type": "people",
            "id": oid,
            "title": obj.get("name") or "",
            "excerpt": obj.get("headline") or "",
            "content": "",
            "voteup_count": to_int(obj.get("voteup_count")),
            "comment_count": to_int(obj.get("answer_count")),
            "author_name": obj.get("name") or "",
            "author_token": obj.get("url_token") or "",
            "question_id": "",
            "created_time": "",
            "url": f"{BASE}/people/{obj.get('url_token')}" if obj.get("url_token") else "",
        }

    if otype == "topic":
        return {
            "type": "topic",
            "id": oid,
            "title": strip_html(obj.get("name") or ""),
            "excerpt": strip_html(obj.get("excerpt") or obj.get("introduction") or ""),
            "content": "",
            "voteup_count": 0,
            "comment_count": to_int(obj.get("followers_count") or obj.get("questions_count")),
            "author_name": "",
            "author_token": "",
            "question_id": "",
            "created_time": "",
            "url": f"{BASE}/topic/{oid}" if oid else "",
        }

    return None


def normalize_answer(a):
    """回答对象 → 统一字段（兼容 questions/{id}/answers 与 members/{token}/answers）"""
    if not isinstance(a, dict):
        return None
    aid = str(a.get("id") or "")
    if not aid:
        return None

    q = a.get("question") or {}
    name, token, headline = normalize_author(a.get("author"))

    # members/{token}/answers 不返回 voteup_count，点赞数在 reaction.statistics.like_count
    stats = ((a.get("reaction") or {}).get("statistics") or {})
    voteup = a.get("voteup_count")
    if voteup is None:
        voteup = stats.get("like_count")

    body = strip_html(a.get("content") or "")
    excerpt = strip_html(a.get("excerpt") or "")
    if not excerpt and body:
        excerpt = body[:200]

    return {
        "id": aid,
        "question_id": str(q.get("id") or ""),
        "question_title": strip_html(q.get("title") or q.get("name") or ""),
        "author_name": name,
        "author_token": token,
        "author_headline": headline,
        "voteup_count": to_int(voteup),
        "comment_count": to_int(a.get("comment_count")),
        "created_time": ts_to_str(a.get("created_time")),
        "updated_time": ts_to_str(a.get("updated_time")),
        "excerpt": excerpt,
        "content": body,
        "url": f"{BASE}/answer/{aid}",
    }


def normalize_article(a):
    """文章对象 → 统一字段"""
    if not isinstance(a, dict):
        return None
    aid = str(a.get("id") or "")
    if not aid:
        return None
    name, token, headline = normalize_author(a.get("author"))
    body = strip_html(a.get("content") or "")
    excerpt = strip_html(a.get("excerpt") or "")
    if not excerpt and body:
        excerpt = body[:200]
    return {
        "id": aid,
        "title": strip_html(a.get("title") or ""),
        "author_name": name,
        "author_token": token,
        "author_headline": headline,
        "voteup_count": to_int(a.get("voteup_count")),
        "comment_count": to_int(a.get("comment_count")),
        # 文章列表端点的时间字段是 created / updated（不是 created_time / updated_time）
        "created_time": ts_to_str(a.get("created_time") or a.get("created")),
        "updated_time": ts_to_str(a.get("updated_time") or a.get("updated")),
        "excerpt": excerpt,
        "content": body,
        "url": f"https://zhuanlan.zhihu.com/p/{aid}",
    }


def _comment_member(c):
    """评论作者：v4 root_comments 为 author.member 两层嵌套，v5 为 author 扁平"""
    author = c.get("author")
    if not isinstance(author, dict):
        return {}
    member = author.get("member")
    return member if isinstance(member, dict) else author


def normalize_comment(c, level=1):
    """评论对象 → 统一字段（v4 root_comments / child_comments 通用）"""
    if not isinstance(c, dict):
        return None
    cid = str(c.get("id") or "")
    if not cid:
        return None

    member = _comment_member(c)
    reply_author = c.get("reply_to_author")
    reply_name = ""
    if isinstance(reply_author, dict):
        rm = reply_author.get("member")
        reply_name = (rm if isinstance(rm, dict) else reply_author).get("name") or ""

    return {
        "level": level,
        "id": cid,
        "content": strip_html(c.get("content") or ""),
        "vote_count": to_int(c.get("vote_count") if c.get("vote_count") is not None else c.get("like_count")),
        "author_name": member.get("name") or "",
        "author_token": member.get("url_token") or "",
        "author_id": str(member.get("id") or ""),
        "is_author": bool(c.get("is_author")),
        "reply_to": reply_name,
        "child_count": to_int(
            c.get("child_comment_count") if c.get("child_comment_count") is not None else c.get("replies_count")
        ),
        "created_time": ts_to_str(c.get("created_time")),
    }


def normalize_member(m):
    """用户主页对象 → 统一字段"""
    if not isinstance(m, dict):
        return None
    token = m.get("url_token") or ""
    return {
        "id": str(m.get("id") or ""),
        "url_token": token,
        "name": m.get("name") or "",
        "headline": m.get("headline") or "",
        "description": m.get("description") or "",
        "gender": to_int(m.get("gender")),
        "answer_count": to_int(m.get("answer_count")),
        "articles_count": to_int(m.get("articles_count")),
        "follower_count": to_int(m.get("follower_count")),
        "following_count": to_int(m.get("following_count")),
        "voteup_count": to_int(m.get("voteup_count")),
        "url": f"{BASE}/people/{token}" if token else (m.get("url") or ""),
    }


_HEAT_RE = re.compile(r"([\d.]+)\s*万")


def parse_heat(detail_text):
    """从 '505 万热度' 解析热度数值（实测 trend 字段恒为 0，热度只在 detail_text）"""
    if not detail_text:
        return 0
    m = _HEAT_RE.search(str(detail_text))
    if not m:
        return 0
    try:
        return int(float(m.group(1)) * 10000)
    except (TypeError, ValueError):
        return 0


def normalize_hot(e, idx):
    """热榜条目 → 统一字段（标题在 target.title，热度在 detail_text / trend）"""
    if not isinstance(e, dict):
        return None
    target = e.get("target") or {}
    qid = str(target.get("id") or "")
    title = strip_html(target.get("title") or "")
    if not title:
        title = strip_html((e.get("card_label") or {}).get("name") or "")
    if not title:
        return None
    heat_text = e.get("detail_text") or ""
    return {
        "rank": idx + 1,
        "title": title,
        "heat_text": heat_text,
        "heat_value": parse_heat(heat_text) or to_int(e.get("trend")),
        "question_id": qid,
        "answer_count": to_int(target.get("answer_count")),
        "follower_count": to_int(target.get("follower_count")),
        "excerpt": strip_html(target.get("excerpt") or "")[:200],
        "url": target.get("url") or (f"{BASE}/question/{qid}" if qid else ""),
    }


# ─── 各 mode 实现 ───

def fetch_search(keyword, offset, count, search_type):
    """关键词搜索（search_v3）"""
    params = {
        "t": search_type,
        "q": keyword,
        "correction": 1,
        "offset": offset,
        "limit": count,
    }
    payload = call_api(
        f"{BASE}/api/v4/search_v3",
        params,
        referer=f"{BASE}/search?type=content&q={quote(keyword)}",
    )
    items = []
    for entry in payload.get("data") or []:
        item = normalize_search_entry(entry)
        if item:
            items.append(item)
    return {"data": items, "has_more": has_more_of(payload)}


def fetch_answers(question_id, offset, count, sort_by):
    """问题下的回答列表（问题标题从 item.question.title 间接取得）"""
    params = {
        "include": "content,voteup_count,comment_count,author,question,excerpt",
        "offset": offset,
        "limit": count,
        "sort_by": sort_by,
    }
    payload = call_api(
        f"{BASE}/api/v4/questions/{question_id}/answers",
        params,
        referer=f"{BASE}/question/{question_id}",
    )
    items = [x for x in (normalize_answer(a) for a in (payload.get("data") or [])) if x]
    return {"data": items, "has_more": has_more_of(payload)}


def fetch_answer_detail(answer_id):
    """回答详情（必须带 include，否则 content / voteup_count / comment_count 缺失）"""
    params = {"include": "content,voteup_count,comment_count,author,question,excerpt"}
    payload = call_api(
        f"{BASE}/api/v4/answers/{answer_id}",
        params,
        referer=f"{BASE}/answer/{answer_id}",
    )
    item = normalize_answer(payload)
    return {"data": [item] if item else [], "has_more": False}


def fetch_comments(answer_id, offset, count, order, with_child):
    """回答的一级评论；with_child 时对每条有子评论的一级评论再拉二级"""
    params = {"order": order, "limit": count, "offset": offset}
    payload = call_api(
        f"{BASE}/api/v4/answers/{answer_id}/root_comments",
        params,
        referer=f"{BASE}/answer/{answer_id}",
    )
    items = []
    for c in payload.get("data") or []:
        root = normalize_comment(c, level=1)
        if not root:
            continue
        items.append(root)
        if not with_child or root["child_count"] <= 0:
            continue
        child_payload = call_api(
            f"{BASE}/api/v4/comments/{root['id']}/child_comments",
            {"limit": PAGE_LIMIT, "offset": 0},
            referer=f"{BASE}/answer/{answer_id}",
        )
        for cc in child_payload.get("data") or []:
            child = normalize_comment(cc, level=2)
            if child:
                items.append(child)
    return {
        "data": items,
        "has_more": has_more_of(payload),
        "common_counts": to_int(payload.get("common_counts")),
    }


def resolve_url_token(url_token, keyword):
    """用户主页模式：给了 --url-token 直接用，否则按关键词搜人取第一个"""
    if url_token:
        return url_token, ""
    if not keyword:
        raise FetchError(FAILURE_API, "member 模式需要 --url-token 或 --keyword（用户昵称）")
    payload = call_api(
        f"{BASE}/api/v4/search_v3",
        {"t": "people", "q": keyword, "correction": 1, "offset": 0, "limit": PAGE_LIMIT},
        referer=f"{BASE}/search?type=people&q={quote(keyword)}",
    )
    for entry in payload.get("data") or []:
        obj = (entry or {}).get("object") or {}
        if obj.get("type") in ("people", "user") and obj.get("url_token"):
            return obj["url_token"], obj.get("name") or ""
    raise FetchError(FAILURE_API, f"未找到与「{keyword}」匹配的知乎用户，请改用 --url-token 直接指定")


def fetch_member(url_token):
    """用户主页信息"""
    params = {"include": "answer_count,articles_count,follower_count,following_count,voteup_count"}
    payload = call_api(
        f"{BASE}/api/v4/members/{url_token}",
        params,
        referer=f"{BASE}/people/{url_token}",
    )
    item = normalize_member(payload)
    return {"data": [item] if item else [], "has_more": False}


def fetch_member_answers(url_token, offset, count):
    """用户的回答列表（该端点不返回 content / voteup_count，点赞数取 reaction.statistics.like_count）"""
    params = {"include": "content,voteup_count,comment_count", "offset": offset, "limit": count}
    payload = call_api(
        f"{BASE}/api/v4/members/{url_token}/answers",
        params,
        referer=f"{BASE}/people/{url_token}/answers",
    )
    items = [x for x in (normalize_answer(a) for a in (payload.get("data") or [])) if x]
    return {"data": items, "has_more": has_more_of(payload)}


def fetch_member_articles(url_token, offset, count):
    """用户的文章列表"""
    params = {"include": "content,voteup_count,comment_count", "offset": offset, "limit": count}
    payload = call_api(
        f"{BASE}/api/v4/members/{url_token}/articles",
        params,
        referer=f"{BASE}/people/{url_token}/posts",
    )
    items = [x for x in (normalize_article(a) for a in (payload.get("data") or [])) if x]
    return {"data": items, "has_more": has_more_of(payload)}


def fetch_hot(count):
    """知乎热榜"""
    payload = call_api(
        f"{HOT_BASE}/topstory/hot-list",
        {"limit": count},
        referer=f"{BASE}/hot",
    )
    items = []
    for idx, e in enumerate(payload.get("data") or []):
        item = normalize_hot(e, idx)
        if item:
            items.append(item)
    return {"data": items, "has_more": False}


def fetch_profile():
    """当前登录账号的知乎资料（解析真实 url_token，凭证库里的 account_id 是派生哈希）"""
    params = {"include": "answer_count,articles_count,follower_count,following_count,voteup_count"}
    payload = call_api(f"{BASE}/api/v4/me", params, referer=BASE)
    item = normalize_member(payload)
    if item is None or not item.get("url_token"):
        raise FetchError(FAILURE_TOKEN, "无法解析当前登录账号资料，知乎登录态可能已失效，请重新登录")
    return {"data": [item], "has_more": False}


# ─── CSV 导出 ───

CSV_COLUMNS = {
    "search": ["type", "id", "title", "excerpt", "voteup_count", "comment_count",
               "author_name", "author_token", "question_id", "created_time", "url"],
    "answers": ["id", "question_id", "question_title", "author_name", "author_token",
                "voteup_count", "comment_count", "created_time", "updated_time", "excerpt", "url"],
    "answer": ["id", "question_id", "question_title", "author_name", "author_token",
               "voteup_count", "comment_count", "created_time", "updated_time", "content", "url"],
    "comments": ["level", "id", "content", "vote_count", "author_name", "author_token",
                 "reply_to", "child_count", "created_time"],
    "member": ["id", "url_token", "name", "headline", "answer_count", "articles_count",
               "follower_count", "following_count", "voteup_count", "url"],
    "member-answers": ["id", "question_id", "question_title", "author_name", "author_token",
                       "voteup_count", "comment_count", "created_time", "updated_time", "excerpt", "url"],
    "member-articles": ["id", "title", "author_name", "author_token", "voteup_count",
                        "comment_count", "created_time", "excerpt", "url"],
    "hot": ["rank", "title", "heat_text", "heat_value", "question_id", "answer_count",
            "follower_count", "excerpt", "url"],
    "profile": ["id", "url_token", "name", "headline", "answer_count", "articles_count",
                "follower_count", "following_count", "voteup_count", "url"],
}


def export_csv(mode, items):
    """把采集结果落到 workspace/artifacts 下的 CSV，返回相对路径"""
    columns = CSV_COLUMNS.get(mode)
    if not columns or not items:
        return ""

    workspace = os.environ.get("DSAGENT_WORKSPACE") or os.getcwd()
    out_dir = os.path.join(workspace, "artifacts")
    os.makedirs(out_dir, exist_ok=True)

    stamp = datetime.now(BJT).strftime("%Y%m%d_%H%M%S")
    path = os.path.join(out_dir, f"zhihu_{mode.replace('-', '_')}_{stamp}.csv")
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for item in items:
            writer.writerow(item)
    return path


# ─── 参数与主流程 ───

MODES = [
    "search", "answers", "answer", "comments",
    "member", "member-answers", "member-articles",
    "hot", "profile",
]


def main():
    import argparse

    parser = argparse.ArgumentParser(description="知乎数据采集")
    parser.add_argument("--mode", "-m", choices=MODES, help="采集模式（不传则按参数自动判定）")
    parser.add_argument("--keyword", "-k", help="搜索关键词 / 用户昵称（如未提供则从 DSAGENT_REQUEST 提取）")
    parser.add_argument("--question-id", help="问题 ID（answers 模式必填）")
    parser.add_argument("--answer-id", help="回答 ID（answer / comments 模式必填）")
    parser.add_argument("--url-token", help="用户 url_token（member 系模式可选，不传则按关键词搜人）")
    parser.add_argument("--search-type", default="general", choices=["general", "question", "content"],
                        help="搜索类型（默认 general）")
    parser.add_argument("--sort-by", default="default", choices=["default", "hot"],
                        help="回答排序（answers 模式，默认 default）")
    parser.add_argument("--order", default="normal", choices=["normal", "score"],
                        help="评论排序（comments 模式，默认 normal）")
    parser.add_argument("--with-child", action="store_true", help="评论模式同时采集二级评论")
    parser.add_argument("--csv", action="store_true", help="同时导出 CSV 到 workspace/artifacts")
    parser.add_argument("--count", "-n", type=int, default=PAGE_LIMIT, help=f"单页数量（默认 {PAGE_LIMIT}，最大 {PAGE_LIMIT}）")
    parser.add_argument("--offset", type=int, default=0, help="偏移量（翻页用）")
    args = parser.parse_args()

    count = min(max(args.count, 1), PAGE_LIMIT)

    # 关键词必须最先提取：mode 自动判定依赖它（否则自然语言请求会被误判为 hot）
    req_text = os.environ.get("DSAGENT_REQUEST", "")
    req_keyword = args.keyword or extract_keyword_from_request(req_text)
    # 「热榜 / 热搜」类请求看的是榜单，不能拿「热榜」二字去搜索
    is_hot_request = not args.keyword and any(m in req_text for m in HOT_MARKERS)
    if is_hot_request:
        req_keyword = ""

    mode = args.mode
    if not mode:
        if args.answer_id:
            mode = "comments"
        elif args.question_id:
            mode = "answers"
        elif req_keyword:
            mode = "search"
        else:
            mode = "hot"

    # 只有真正消费关键词的模式才保留它，避免 hot/profile 输出无关字段
    keyword = req_keyword if mode in ("search", "member", "member-answers", "member-articles") else ""

    if mode == "answers" and not args.question_id:
        output_result({"ok": False, "failure_kind": "skill_error",
                       "message": "answers 模式需要 --question-id（问题 ID）"})
        sys.exit(1)

    if mode in ("answer", "comments") and not args.answer_id:
        output_result({"ok": False, "failure_kind": "skill_error",
                       "message": f"{mode} 模式需要 --answer-id（回答 ID）"})
        sys.exit(1)

    if mode in ("member", "member-answers", "member-articles") and not keyword and not args.url_token:
        output_result({"ok": False, "failure_kind": "skill_error",
                       "message": f"{mode} 模式需要 --url-token 或 --keyword（用户昵称）"})
        sys.exit(1)

    if mode == "search" and not keyword:
        output_result({"ok": False, "failure_kind": "skill_error",
                       "message": "未提供搜索关键词，请使用 --keyword 参数或在请求中注明要搜索的内容"})
        sys.exit(1)

    if not os.environ.get("DSCONNECT_URL"):
        output_result({"ok": False, "failure_kind": "not_bound",
                       "message": "未检测到本地代理网关，请到「账号连接」页面绑定知乎账号后重试"})
        sys.exit(1)

    log(f"[采集] mode={mode} keyword='{keyword}' count={count} offset={args.offset}")

    try:
        member = None
        url_token = args.url_token or ""

        if mode == "search":
            result = fetch_search(keyword, args.offset, count, args.search_type)
        elif mode == "answers":
            result = fetch_answers(args.question_id, args.offset, count, args.sort_by)
        elif mode == "answer":
            result = fetch_answer_detail(args.answer_id)
        elif mode == "comments":
            result = fetch_comments(args.answer_id, args.offset, count, args.order, args.with_child)
        elif mode in ("member", "member-answers", "member-articles"):
            url_token, resolved_name = resolve_url_token(url_token, keyword)
            if resolved_name:
                log(f"[采集] 用户解析: 「{keyword}」→ {resolved_name} (url_token={url_token})")
            if mode == "member":
                result = fetch_member(url_token)
            elif mode == "member-answers":
                result = fetch_member_answers(url_token, args.offset, count)
            else:
                result = fetch_member_articles(url_token, args.offset, count)
            member = {"url_token": url_token}
        elif mode == "hot":
            result = fetch_hot(min(max(args.count, 1), HOT_LIMIT))
        elif mode == "profile":
            result = fetch_profile()
        else:
            raise FetchError(FAILURE_API, f"未知模式: {mode}")

    except FetchError as e:
        output_result({"ok": False, "failure_kind": e.failure_kind, "message": e.message})
        sys.exit(1)

    items = result["data"]
    output = {
        "ok": True,
        "mode": mode,
        "total": len(items),
        "offset": args.offset,
        "next_offset": args.offset + len(items),
        "has_more": result.get("has_more", False),
        "data": items,
    }
    if keyword:
        output["keyword"] = keyword
    if url_token:
        output["url_token"] = url_token
    if mode == "answers":
        output["question_id"] = args.question_id
    if mode in ("answer", "comments"):
        output["answer_id"] = args.answer_id
    if "common_counts" in result:
        output["common_counts"] = result["common_counts"]
    if member:
        output.update(member)

    if args.csv:
        csv_path = export_csv(mode, items)
        if csv_path:
            output["csv_path"] = csv_path
            output_files(csv_path)
            log(f"[采集] CSV 已导出: {csv_path}")

    output["fetch_time"] = datetime.now(BJT).strftime("%Y-%m-%d %H:%M:%S")

    output_summary(items, 模式=mode, 关键词=keyword or "-")
    output_result(output)


if __name__ == "__main__":
    main()
