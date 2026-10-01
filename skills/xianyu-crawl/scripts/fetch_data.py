#!/usr/bin/env python3
"""
闲鱼数据采集脚本 — DSAgent xianyu-crawl v2.0
通过闲鱼 H5 API 搜索商品，采集商品标题、价格、卖家等信息。

v2.0 改动：
  - 使用 dsagent_runtime 统一模块（stdout/stderr 分离、错误类型细分）
  - 网关代理请求改用 dsagent_runtime.http_get / http_post
  - 输出改用 dsagent_runtime.log / output_result / output_summary
"""

import json
import os
import re
import sys
import time
import hashlib
import urllib.parse
from datetime import datetime, timezone, timedelta

# ── 引入 dsagent_runtime ──
_dsagent_dir = os.path.join(os.environ.get("DSAGENT_SKILL_ROOT", ""), ".dsagent")
if _dsagent_dir and _dsagent_dir not in sys.path:
    sys.path.insert(0, _dsagent_dir)

from runtime.dsagent_runtime import log, output_result, output_summary
from runtime.dsagent_runtime import http_get, http_post, FAILURE_TOKEN, FAILURE_PARSE, FAILURE_API

BJT = timezone(timedelta(hours=8))

# 引导 API（用于获取 _m_h5_tk token）
BOOTSTRAP_API = "mtop.taobao.idlehome.home.webpc.feed"
BOOTSTRAP_URL = f"https://h5api.m.goofish.com/h5/{BOOTSTRAP_API}/1.0/"

# 搜索 API（POST 请求）
SEARCH_API = "mtop.taobao.idlemtopsearch.pc.search"
SEARCH_URL = f"https://h5api.m.goofish.com/h5/{SEARCH_API}/1.0/"

APP_KEY = "34839810"


def extract_m_h5_tk_from_set_cookies(set_cookies):
    """从 Set-Cookie 头列表中提取 _m_h5_tk 的 token 部分（下划线前半段）"""
    if not set_cookies:
        return ""
    for sc in set_cookies:
        part = sc.split(";")[0]
        if "=" in part:
            key, val = part.split("=", 1)
            if key.strip() == "_m_h5_tk" and val.strip():
                raw = val.strip()
                parts = raw.split("_")
                if len(parts) >= 2:
                    return parts[0]
                return raw
    return ""


def calc_sign(token, t, appkey, data):
    """计算 mtop API 签名: md5(token & timestamp & appkey & data)"""
    raw = f"{token}&{t}&{appkey}&{data}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def parse_want_count(*sources):
    """解析「想要人数」。

    闲鱼搜索结果里 clickParam.args.wantNum 恒为占位值 '0'（真实值不在这里），
    唯一可靠来源是 exContent.fishTags 标签文本中的「N人想要」。
    因此标签优先，数值字段仅作兜底且显式排除 0。
    """
    for src in sources:
        tags = src.get("fishTags") if isinstance(src, dict) else None
        if not isinstance(tags, dict):
            continue
        for row in tags.values():
            for tag in (row or {}).get("tagList", []) or []:
                content = (tag.get("data") or {}).get("content") or ""
                m = re.search(r"(\d+)\s*人想要", content)
                if m:
                    return int(m.group(1))
    for src in sources:
        if not isinstance(src, dict):
            continue
        for key in ("want", "wantNum", "wantCount", "want_count"):
            raw = src.get(key)
            if raw in (None, "", "0", 0):
                continue
            try:
                return int(str(raw).strip())
            except (TypeError, ValueError):
                continue
    return 0


def _flatten_text(raw):
    """把闲鱼的价格/标题等富文本组件还原成纯文本。

    实测 exContent.price 是组件数组：
      [{"type":"sign","text":"¥"},{"type":"integer","text":"15"},{"type":"decimal","text":".90"}]
    直接 str() 会得到 Python 列表字面量，必须按顺序拼接 text 字段。
    """
    if isinstance(raw, (list, tuple)):
        return "".join(_flatten_text(x) for x in raw)
    if isinstance(raw, dict):
        return _flatten_text(raw.get("text", ""))
    return str(raw or "")


def parse_price(*sources):
    """解析商品价格，返回纯数字字符串（如 '15.90'），取不到返回 ''。

    优先级：clickParam.args.price → displayParam → exContent.price（组件数组）
    → detailParams.soldPrice。
    """
    for src in sources:
        if not isinstance(src, dict):
            continue
        for key in ("price", "displayPrice", "priceText", "soldPrice"):
            raw = src.get(key)
            if raw in (None, "", [], {}):
                continue
            text = re.sub(r"[^\d.]", "", _flatten_text(raw))
            if text:
                return text
    return ""


def parse_original_price(*sources):
    """解析「原价」。

    搜索结果里原价只出现在 exContent.oriPrice（形如 '¥66'），且**仅部分商品有**；
    clickParam.args 里没有 originalPrice 字段（旧实现读它，故恒为 None）。
    统一剥掉货币符号后返回纯数字字符串，取不到返回 None。
    """
    for src in sources:
        if not isinstance(src, dict):
            continue
        for key in ("oriPrice", "originalPrice", "originPrice"):
            raw = src.get(key)
            if raw in (None, ""):
                continue
            text = re.sub(r"[^\d.]", "", _flatten_text(raw))
            if text:
                return text
    return None


def fetch_m_h5_tk():
    """
    通过 idlehome feed API 引导获取 _m_h5_tk token。
    首次调用时 token 为空，网关在 Set-Cookie 头中下发 _m_h5_tk。
    网关会自动将新 Cookie 合并回凭证库。
    返回 token 字符串（空字符串表示失败）。
    """
    t = str(int(time.time() * 1000))
    data_str = "{}"
    sign = calc_sign("", t, APP_KEY, data_str)

    params = {
        "jsv": "2.7.6",
        "appKey": APP_KEY,
        "t": t,
        "sign": sign,
        "api": BOOTSTRAP_API,
        "v": "1.0",
        "type": "originaljson",
        "dataType": "json",
        "data": data_str,
    }

    try:
        result = http_get(
            BOOTSTRAP_URL,
            platform="xianyu",
            params=params,
            timeout=20,
            inject_token=False,
        )
    except Exception as e:
        log(f"[采集] 引导 API 异常: {e}")
        return ""

    if result.get("status") != "success":
        log(f"[采集] 引导 API 状态: {result.get('status', '')} - {result.get('error_message', '')}")
        # 即使返回非 success，也可能包含有效的 Set-Cookie（如 FAIL_SYS_TOKEN_EXPIRED 也会下发新 _m_h5_tk）
        set_cookies = result.get("set_cookies") or []
        token = extract_m_h5_tk_from_set_cookies(set_cookies)
        if token:
            log(f"[采集] 从非成功响应中获取 _m_h5_tk token: {token[:8]}...")
            return token
        return ""

    set_cookies = result.get("set_cookies") or []
    token = extract_m_h5_tk_from_set_cookies(set_cookies)
    if token:
        log(f"[采集] 已获取 _m_h5_tk token: {token[:8]}...")
    else:
        log("[采集] Set-Cookie 中未找到 _m_h5_tk")
    return token


def search_items(keyword, page=1, size=30):
    """调用闲鱼搜索接口（通过网关代理 POST 请求）"""

    # 先获取 _m_h5_tk token
    token = fetch_m_h5_tk()
    if not token:
        return {
            "ok": False,
            "failure_kind": FAILURE_TOKEN,
            "message": "无法获取 _m_h5_tk token，闲鱼接口签名失败。请检查账号登录态是否有效。",
        }

    t = str(int(time.time() * 1000))

    # 搜索请求数据（与闲鱼网页版一致）
    data_obj = {
        "pageNumber": page,
        "keyword": keyword,
        "fromFilter": False,
        "rowsPerPage": size,
        "sortValue": "",
        "sortField": "",
        "customDistance": "",
        "gps": "",
        "propValueStr": {},
        "customGps": "",
        "searchReqFromPage": "pcSearch",
        "extraFilterValue": "{}",
        "userPositionJson": "{}",
    }
    data_str = json.dumps(data_obj, ensure_ascii=False, separators=(",", ":"))

    sign = calc_sign(token, t, APP_KEY, data_str)

    params = {
        "jsv": "2.7.2",
        "appKey": APP_KEY,
        "t": t,
        "sign": sign,
        "v": "1.0",
        "type": "originaljson",
        "accountSite": "xianyu",
        "dataType": "json",
        "timeout": "20000",
        "api": SEARCH_API,
        "sessionOption": "AutoLoginOnly",
        "spm_cnt": "a21ybx.search.0.0",
        "spm_pre": "a21ybx.search.searchInput.0",
    }

    # 通过网关发 POST 请求
    form_data = urllib.parse.urlencode({"data": data_str})

    try:
        result = http_post(
            SEARCH_URL,
            platform="xianyu",
            params=params,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://www.goofish.com",
                "Referer": "https://www.goofish.com/",
            },
            json_body=form_data,
            timeout=20,
            inject_token=False,
        )
    except Exception as e:
        kind = getattr(e, "failure_kind", FAILURE_API)
        return {
            "ok": False,
            "failure_kind": kind,
            "message": f"搜索请求异常: {e}",
        }

    if result.get("status") != "success":
        failure_kind = result.get("failure_kind", FAILURE_API)
        # 如果是 rate_limit（FAIL_SYS_TOKEN_EXPIRED），尝试从 Set-Cookie 提取新 token 并重试一次
        if failure_kind == "rate_limit":
            set_cookies = result.get("set_cookies") or []
            new_token = extract_m_h5_tk_from_set_cookies(set_cookies)
            if new_token:
                log(f"[采集] 搜索时 token 过期，已获取新 token 重试: {new_token[:8]}...")
                t = str(int(time.time() * 1000))
                sign = calc_sign(new_token, t, APP_KEY, data_str)
                params["t"] = t
                params["sign"] = sign
                form_data = urllib.parse.urlencode({"data": data_str})
                result = http_post(
                    SEARCH_URL,
                    platform="xianyu",
                    params=params,
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Origin": "https://www.goofish.com",
                        "Referer": "https://www.goofish.com/",
                    },
                    json_body=form_data,
                    timeout=20,
                    inject_token=False,
                )
                if result.get("status") != "success":
                    failure_kind = result.get("failure_kind", FAILURE_API)
                    return {
                        "ok": False,
                        "failure_kind": failure_kind,
                        "message": f"搜索请求重试后仍失败: {result.get('error_message', '')}",
                    }
            else:
                return {
                    "ok": False,
                    "failure_kind": failure_kind,
                    "message": f"搜索请求失败且无法刷新 token: {result.get('error_message', '')}",
                }
        else:
            return {
                "ok": False,
                "failure_kind": failure_kind,
                "message": f"搜索请求失败: {result.get('error_message', '')} (HTTP {result.get('status_code', 0)})",
            }

    payload = result.get("payload")

    # payload 可能是已解析的 dict 或字符串
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            return {"ok": False, "failure_kind": FAILURE_PARSE, "message": f"响应解析失败: {str(payload)[:300]}"}

    if not isinstance(payload, dict):
        return {"ok": False, "failure_kind": FAILURE_PARSE, "message": f"响应格式异常: {str(payload)[:300]}"}

    # mtop 响应结构: { "api": "...", "data": { ... }, "ret": ["SUCCESS::调用成功"] }
    ret = payload.get("ret", [])
    if not ret or "SUCCESS" not in str(ret[0]):
        return {"ok": False, "failure_kind": FAILURE_API, "message": f"接口返回错误: {ret}"}

    data = payload.get("data", {})

    # 搜索结果可能在不同字段中
    items_raw = data.get("resultList", []) or data.get("data", {}).get("resultList", [])

    if not items_raw:
        for key in ("result", "list", "items", "searchResult"):
            if isinstance(data, dict) and data.get(key):
                items_raw = data[key]
                log(f"[采集] 使用字段 '{key}' 作为结果列表")
                break

    if not items_raw and isinstance(data, list):
        items_raw = data
        log("[采集] data 本身是 list，直接使用")

    items = []
    for entry in items_raw:
        item = entry.get("data", {}) if isinstance(entry, dict) else {}
        if not item:
            if isinstance(entry, dict):
                item = entry
        if not item:
            continue

        main = {}
        if isinstance(item, dict) and isinstance(item.get("item"), dict):
            main = item["item"].get("main", {})
        elif isinstance(item, dict) and isinstance(item.get("main"), dict):
            main = item["main"]
        else:
            main = item

        args = {}
        if isinstance(main, dict):
            click_param = main.get("clickParam", {})
            if isinstance(click_param, dict):
                args = click_param.get("args", {})

        display = {}
        if isinstance(main, dict):
            display = main.get("displayParam", {}) or main.get("displayData", {})

        ex_content = {}
        if isinstance(main, dict):
            ex_content = main.get("exContent", {})
            if not isinstance(ex_content, dict):
                ex_content = {}

        detail_params = ex_content.get("detailParams", {}) if isinstance(ex_content.get("detailParams"), dict) else {}

        def pick(key, *fallbacks):
            for src in (args, display, ex_content, detail_params, main, item):
                if isinstance(src, dict) and src.get(key):
                    return src[key]
            for fb in fallbacks:
                if isinstance(item, dict) and item.get(fb):
                    return item[fb]
            return ""

        items.append({
            "item_id": str(pick("id", "itemId", "item_id")),
            "title": pick("title", "item_title", "itemTitle"),
            "price": parse_price(args, display, ex_content, detail_params, main, item),
            "original_price": parse_original_price(ex_content, main, args, item),
            "seller_nick": pick("userNickName", "userNick", "sellerNickName", "seller_nick", "nick"),
            "seller_id": str(pick("seller_id", "sellerId", "userId")),
            "area": pick("area", "userArea", "location"),
            "description": pick("desc", "description", "item_desc"),
            "image_url": pick("picUrl", "imageUrl", "img", "pic", "picUrl720"),
            "want_count": parse_want_count(ex_content, main, args, item),
            "view_count": int(pick("viewCount", "view_count") or 0),
        })

    return {
        "ok": True,
        "keyword": keyword,
        "page": page,
        "total": len(items),
        "data": items,
        "fetch_time": datetime.now(BJT).strftime("%Y-%m-%d %H:%M:%S"),
    }


def main():
    import argparse

    parser = argparse.ArgumentParser(description="闲鱼数据采集")
    parser.add_argument("--keyword", "-k", help="搜索关键词（如未提供则从 DSAGENT_REQUEST 环境变量提取）")
    parser.add_argument("--page", "-p", type=int, default=1, help="页码（默认 1）")
    parser.add_argument("--size", "-s", type=int, default=30, help="每页数量（默认 30，最大 50）")
    args = parser.parse_args()

    size = min(max(args.size, 1), 50)

    keyword = args.keyword or ""
    if not keyword:
        from runtime.dsagent_runtime import extract_keyword_from_request
        request = os.environ.get("DSAGENT_REQUEST", "")
        keyword = extract_keyword_from_request(request)

    if not keyword:
        output_result({"ok": False, "failure_kind": "skill_error", "message": "未提供搜索关键词，请使用 --keyword 参数或在请求中注明要搜索的商品"})
        sys.exit(1)

    # 进度日志输出到 stderr，stdout 只留最终结果
    log(f"[采集] 关键词='{keyword}' 页码={args.page} 数量={size}")

    result = search_items(keyword, args.page, size)

    # 仅结果 JSON 输出到 stdout
    output_result(result)


if __name__ == "__main__":
    main()
