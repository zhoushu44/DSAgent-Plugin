#!/usr/bin/env python3
"""Read-only public XHS profile/notes collector using the DSAgent credential gateway."""
import argparse
import importlib.util
import json
import os
import sys
import time

for name in ("stdout", "stderr"):
    stream = getattr(sys, name, None)
    if stream is not None and hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CRAWL_SCRIPTS = os.path.join(ROOT, "scripts")
if CRAWL_SCRIPTS not in sys.path:
    sys.path.insert(0, CRAWL_SCRIPTS)
RUNTIME = os.path.join(os.environ.get("DSAGENT_SKILL_ROOT", ""), ".dsagent")
if RUNTIME and RUNTIME not in sys.path:
    sys.path.insert(0, RUNTIME)

from xhs_sign import sign_headers
from runtime.dsagent_runtime import http_post, output_result, log, FAILURE_API


def unwrap(raw):
    payload = raw.get("payload", raw)
    if isinstance(payload, str):
        payload = json.loads(payload)
    return payload


def request_page(user_id, cursor="", xsec_token="", xsec_source="app_share", num=30):
    url = "https://edith.xiaohongshu.com/api/sns/web/v1/user_posted"
    body = {
        "num": num,
        "cursor": cursor,
        "user_id": user_id,
        "image_scenes": ["FD_PRV_WEBP", "FD_WM_WEBP"],
        "xsec_token": xsec_token,
        "xsec_source": xsec_source,
    }
    cookie = os.environ.get("DSAGENT_COOKIE", "")
    signed, body_str = sign_headers("POST", url, cookie, payload=body)
    headers = {
        "Content-Type": "application/json;charset=UTF-8",
        "Origin": "https://www.xiaohongshu.com",
        "Referer": "https://www.xiaohongshu.com/user/profile/" + user_id,
        "Accept": "application/json, text/plain, */*",
    }
    headers.update(signed)
    raw = http_post(url, platform="xhs", json_body=body_str, headers=headers, timeout=30, inject_token=False)
    return unwrap(raw)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--xsec-token", default="")
    parser.add_argument("--pages", type=int, default=1)
    parser.add_argument("--num", type=int, default=30)
    args = parser.parse_args()
    cursor = ""
    all_notes = []
    for page in range(args.pages):
        if page:
            time.sleep(3.5)
        payload = request_page(args.user_id, cursor, args.xsec_token, num=args.num)
        if payload.get("code") != 0 or not payload.get("success", True):
            output_result({"ok": False, "error": payload.get("msg") or str(payload)[:500], "data": all_notes})
            sys.exit(1)
        data = payload.get("data") or {}
        notes = data.get("notes") or []
        all_notes.extend(notes)
        log(f"[主页采集] 第{page + 1}页，{len(notes)}篇")
        cursor = data.get("cursor") or ""
        if not data.get("has_more") or not notes:
            break
    output_result({"ok": True, "user_id": args.user_id, "data": all_notes, "total": len(all_notes), "cursor": cursor})


if __name__ == "__main__":
    main()
