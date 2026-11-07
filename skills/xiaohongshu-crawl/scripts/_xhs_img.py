# -*- coding: utf-8 -*-
"""
小红书搜索 + 图片 URL 提取（重写版，不依赖 .dsagent 目录）
签名逻辑复用 xhs_sign.py，HTTP 直接用 urllib 走本地网关
"""
import sys, os, json

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_ROOT = os.path.dirname(SCRIPT_DIR)

# runtime 可能在技能 .dsagent/runtime，也可能在 skills/.dsagent/runtime
CANDIDATES = [
    os.path.join(SKILL_ROOT, ".dsagent", "runtime"),
    os.path.join(os.path.dirname(SKILL_ROOT), ".dsagent", "runtime"),
    os.path.join(os.path.dirname(os.path.dirname(SKILL_ROOT)), ".dsagent", "runtime"),
]
RUNTIME_DIR = None
for c in CANDIDATES:
    if os.path.isdir(c):
        RUNTIME_DIR = c
        break

if RUNTIME_DIR:
    sys.path.insert(0, RUNTIME_DIR)

sys.path.insert(0, SCRIPT_DIR)

TARGET = "https://edith.xiaohongshu.com/api/sns/web/v1/search/notes"


def get_gateway():
    """读网关发现文件，取活的网关地址"""
    import glob
    files = glob.glob(os.path.expanduser("~/.dsagent/gateway/gateway-*.json"))
    files.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    for f in files:
        try:
            j = json.load(open(f, encoding="utf-8"))
            url = j.get("url")
            if url:
                return url
        except Exception:
            continue
    return None


def http_post_gateway(gw, body_str, headers):
    import urllib.request
    payload = json.dumps({
        "platform": "xhs",
        "url": TARGET,
        "method": "POST",
        "headers": headers,
        "body": body_str,
        "inject_token": False,
    }, ensure_ascii=False).encode()
    req = urllib.request.Request(
        gw.rstrip("/") + "/api/v1/proxy",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST")
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode())


def main():
    args = sys.argv[1:]
    keyword = args[0] if args else ""
    page, limit = 1, 20
    for i, a in enumerate(args):
        if a == "--page" and i+1 < len(args): page = int(args[i+1])
        elif a == "--limit" and i+1 < len(args): limit = int(args[i+1])
    if not keyword:
        print("缺关键词"); sys.exit(1)

    from xhs_sign import sign_headers, gen_search_id

    body = {
        "keyword": keyword, "page": page, "page_size": limit,
        "search_id": gen_search_id(), "sort": "general",
        "note_type": 0, "ext_flags": [],
        "image_formats": ["jpg", "webp", "avif"],
    }
    cookie_str = os.environ.get("DSAGENT_COOKIE", "")
    sign_hdrs, body_str = sign_headers("POST", TARGET, cookie_str, payload=body)

    headers = {
        "Content-Type": "application/json;charset=UTF-8",
        "Origin": "https://www.xiaohongshu.com",
        "Referer": "https://www.xiaohongshu.com/",
    }
    headers.update(sign_hdrs)

    gw = get_gateway()
    if not gw:
        print("找不到本地网关"); sys.exit(1)
    print("gateway:", gw)

    raw = http_post_gateway(gw, body_str, headers)
    payload = raw.get("payload", raw)
    if isinstance(payload, str):
        try: payload = json.loads(payload)
        except Exception: payload = {}
    data = payload.get("data") or {}
    items = data.get("items") or data.get("notes") or []
    print(f"返回 {len(items)} 条原始笔记")

    if items:
        nc = items[0].get("note_card", items[0])
        print("\n=== 首条字段 ===")
        print(sorted(nc.keys()))
        for k in ("image_list", "cover"):
            if k in nc:
                print(f"\n{k} 样例:", json.dumps(nc[k], ensure_ascii=False)[:500])

    out = []
    for it in items:
        nc = it.get("note_card", it)
        urls = []
        for img in (nc.get("image_list") or []):
            u = (img.get("url_default") or img.get("url") or "").strip()
            if u: urls.append(u)
        if not urls and nc.get("cover"):
            c = nc["cover"]
            u = (c.get("url_default") or c.get("url") or "").strip()
            if u: urls.append(u)
        if urls:
            out.append({
                "note_id": nc.get("note_id", ""),
                "title": nc.get("display_title", ""),
                "user": (nc.get("user") or {}).get("nick", ""),
                "liked": (nc.get("interact_info") or {}).get("liked_count", "0"),
                "type": nc.get("type", ""),
                "images": urls,
            })

    print(f"\n=== {len(out)} 条带图笔记 ===")
    for o in out[:15]:
        print(f"  {o['liked']:>6s}赞 {o['user'][:14]:14s} {o['title'][:24]:24s} {len(o['images'])}张")
    json.dump(out, open(os.path.join(SCRIPT_DIR, "_xhs_imgs.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("\n-> _xhs_imgs.json")


if __name__ == "__main__":
    main()
