# -*- coding: utf-8 -*-
"""
通过 dsagent_proxy 走网关请求小红书搜索接口
Cookie 由宿主凭证库注入，本地拿不到
"""
import sys, os, json

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

TARGET = "https://edith.xiaohongshu.com/api/sns/web/v1/search/notes"


def main():
    from xhs_sign import sign_headers, gen_search_id

    keyword = sys.argv[1] if len(sys.argv) > 1 else ""
    page, limit = 1, 20
    for i, a in enumerate(sys.argv):
        if a == "--page" and i+1 < len(sys.argv): page = int(sys.argv[i+1])
        elif a == "--limit" and i+1 < len(sys.argv): limit = int(sys.argv[i+1])
    if not keyword:
        print("缺关键词"); sys.exit(1)

    body = {
        "keyword": keyword, "page": page, "page_size": limit,
        "search_id": gen_search_id(), "sort": "general",
        "note_type": 0, "ext_flags": [],
        "image_formats": ["jpg", "webp", "avif"],
    }
    cookie_str = os.environ.get("DSAGENT_COOKIE", "")
    print("cookie 长度:", len(cookie_str))
    print("a1 存在:", "a1=" in cookie_str or "a1%" in cookie_str)

    sign_hdrs, body_str = sign_headers("POST", TARGET, cookie_str, payload=body)

    headers = {
        "Content-Type": "application/json;charset=UTF-8",
        "Origin": "https://www.xiaohongshu.com",
        "Referer": "https://www.xiaohongshu.com/",
    }
    headers.update(sign_hdrs)

    print("headers:", json.dumps({k: (v[:24]+"..." if len(str(v))>24 else v) for k,v in headers.items()}, ensure_ascii=False))
    print("body:", body_str[:300])
    # 输出给外部调用者（由 agent 用 dsagent_proxy 发请求）
    json.dump({"url": TARGET, "headers": headers, "body": body_str},
              open(os.path.join(SCRIPT_DIR, "_req.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("\n-> _req.json（由 dsagent_proxy 发送）")


if __name__ == "__main__":
    main()
