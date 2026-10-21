#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
xhs-publish-re —— 小红书图文/视频发布（逆向复现版）

与 xiaohongshu-publish 的差异：
  - 支持**定时发布**（--timer "YYYY-MM-DD HH:mm"）
  - 支持 **dry-run** 链路自检（--dry true 只填表不发布）
  - 支持原生 setter 填表（修复 Vue3 v-model 不同步导致标题丢失的问题）
  - 通过 closed Shadow DOM 的 CustomEvent 触发发布（绕开按钮不可见问题）

真实实现：调用本地 xhs_publish.cjs（Node + puppeteer-core + sign_service）。
L2 门禁：不带 --confirm true 只返回「发布预览」，不产生任何写操作。

用法：
    python3 publish.py --type image --title "标题" --images "a.jpg,b.jpg"
    python3 publish.py --type video --title "标题" --video "a.mp4" --timer "2026-10-25 20:00"
    python3 publish.py --type image --title "标题" --images "a.jpg" --dry true
"""

import json
import os
import shutil
import subprocess
import sys

# ── stdout/stderr 强制 UTF-8（Windows 控制台默认 GBK）──
for _name in ("stdout", "stderr"):
    _s = getattr(sys, _name, None)
    if _s is not None and hasattr(_s, "reconfigure"):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

TITLE_MAX = 20
DESC_MAX = 1000
IMG_MAX = 18
VIDEO_EXTS = (".mp4", ".mov", ".mkv", ".webm", ".flv", ".f4v", ".m4v", ".ts")
IMG_EXTS = (".jpg", ".jpeg", ".png", ".webp")

# 脚本与 xhs_publish.cjs 同目录（scripts/../xhs_publish.cjs 即技能根）
_HERE = os.path.dirname(os.path.abspath(__file__))
_SKILL_ROOT = os.path.abspath(os.path.join(_HERE, ".."))
_PUBLISH_JS = os.path.join(_SKILL_ROOT, "xhs_publish.cjs")
_SERVICE_JS = os.path.join(_SKILL_ROOT, "sign_service.cjs")


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


def split_images(raw):
    s = (raw or "").strip()
    if not s:
        return [], None
    if s.startswith("["):
        try:
            arr = json.loads(s)
            if isinstance(arr, list):
                return [str(x).strip() for x in arr if str(x).strip()], None
        except Exception:
            return [], "--images 看起来是 JSON 数组但解析失败，请改用英文逗号分隔。"
    return [x.strip() for x in s.split(",") if x.strip()], None


def validate(args):
    """返回错误消息或 None。"""
    title = (args.get("title") or "").strip()
    desc = args.get("desc") or ""
    ntype = args.get("type") or "image"
    images = args.get("images") or []
    video = (args.get("video") or "").strip()

    if not title:
        return "缺少 --title（小红书要求标题非空）"
    if len(title) > TITLE_MAX:
        return "标题 %d 字，超过小红书上限 %d 字。" % (len(title), TITLE_MAX)
    if len(desc) > DESC_MAX:
        return "正文 %d 字，超过上限 %d 字。" % (len(desc), DESC_MAX)

    if ntype not in ("image", "video"):
        return "--type 只能是 image 或 video。"

    if ntype == "image":
        if not images:
            return "--type image 需要 --images（英文逗号分隔的本地图片绝对路径）"
        if len(images) > IMG_MAX:
            return "图片 %d 张，超过上限 %d 张。" % (len(images), IMG_MAX)
        missing = [x for x in images if not os.path.exists(x)]
        if missing:
            return "以下图片不存在：%s" % ", ".join(missing[:3])
        bad = [x for x in images if not x.lower().endswith(IMG_EXTS)]
        if bad:
            return "图片格式不支持（仅 %s）：%s" % ("/".join(IMG_EXTS), bad[0])
    else:
        if not video:
            return "--type video 需要 --video（本地视频绝对路径）"
        if not os.path.exists(video):
            return "视频文件不存在：%s" % video
        if not video.lower().endswith(VIDEO_EXTS):
            return "视频格式不支持（仅 %s）：%s" % ("/".join(VIDEO_EXTS), video)

    timer = (args.get("timer") or "").strip()
    if timer:
        # 宽松校验：YYYY-MM-DD HH:mm
        import re
        if not re.match(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$", timer):
            return "--timer 格式应为 \"YYYY-MM-DD HH:mm\"，当前：%s" % timer

    return None


def ensure_service(port):
    """sign_service 不在线则拉起（后台），返回 (ok, detail)。"""
    import time
    import urllib.request

    url = "http://127.0.0.1:%d/health" % port

    def alive():
        try:
            with urllib.request.urlopen(url, timeout=4) as r:
                j = json.loads(r.read().decode("utf-8", "replace"))
                return bool(j.get("ready"))
        except Exception:
            return False

    if alive():
        return True, "already-running"

    if not os.path.exists(_SERVICE_JS):
        return False, "sign_service.cjs 不存在：%s" % _SERVICE_JS

    node = find_node()
    if not node:
        return False, "未找到 node，请先安装 Node.js"

    logf = open(os.path.join(_SKILL_ROOT, "sign_service.log"), "a", encoding="utf-8")
    cookies = os.path.join(_SKILL_ROOT, ".secrets", "login.json")
    cmd = [node, _SERVICE_JS, "--port", str(port), "--headless", "false"]
    if os.path.exists(cookies):
        cmd += ["--cookies", cookies]
    subprocess.Popen(cmd, stdout=logf, stderr=logf, cwd=_SKILL_ROOT)

    for _ in range(60):
        time.sleep(2)
        if alive():
            return True, "started"
    return False, "sign_service 启动超时（见 sign_service.log）"


def run_publish_js(args, port):
    node = find_node()
    if not node:
        return {"ok": False, "failure_kind": "skill_error", "message": "未找到 node，请先安装 Node.js"}
    if not os.path.exists(_PUBLISH_JS):
        return {"ok": False, "failure_kind": "skill_error",
                "message": "xhs_publish.cjs 不存在：%s" % _PUBLISH_JS}

    cmd = [node, _PUBLISH_JS,
           "--type", args["type"],
           "--title", args["title"],
           "--port", str(port)]
    if args["type"] == "image":
        cmd += ["--images", ",".join(args["images"])]
    else:
        cmd += ["--video", args["video"]]
    if args.get("desc"):
        cmd += ["--desc", args["desc"]]
    if args.get("timer"):
        cmd += ["--timer", args["timer"]]
    if args.get("dry"):
        cmd += ["--dry"]

    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=900, cwd=_SKILL_ROOT)
    except subprocess.TimeoutExpired:
        return {"ok": False, "failure_kind": "api_error", "message": "发布流程超时（>15 分钟）"}
    except Exception as e:
        return {"ok": False, "failure_kind": "skill_error", "message": "执行 xhs_publish.cjs 失败：%s" % e}

    def dec(b):
        if b is None:
            return ""
        if isinstance(b, bytes):
            return b.decode("utf-8", "replace")
        return str(b)

    stdout = dec(proc.stdout)
    stderr = dec(proc.stderr)
    # xhs_publish.cjs 最后打印一段多行 JSON 对象；定位最后一个独立的 { ... } 块
    payload = None
    text = stdout.strip()
    # 从后往前找能成功 json.loads 的 { 起点
    for start in range(len(text) - 1, -1, -1):
        if text[start] != "{":
            continue
        try:
            payload = json.loads(text[start:])
            if isinstance(payload, dict):
                break
        except Exception:
            continue
        payload = None
        if start < len(text) - 20000:   # 兜底上限，避免超大文本反复尝试
            break
    if payload is None:
        payload = {"ok": False, "failure_kind": "parse_error",
                   "message": "无法解析发布脚本输出", "stdout": stdout[-1500:], "stderr": stderr[-800:]}
    payload["exitCode"] = proc.returncode
    if stderr.strip():
        payload["stderrTail"] = stderr[-800:]
    return payload


def main():
    import argparse
    ap = argparse.ArgumentParser(description="小红书图文/视频发布（逆向复现版）")
    ap.add_argument("--type", default="image", help="image=图文；video=视频")
    ap.add_argument("--title", required=True, help="笔记标题（≤20 字）")
    ap.add_argument("--images", default="", help="图文：图片绝对路径，英文逗号分隔，≤18 张")
    ap.add_argument("--video", default="", help="视频：本地视频绝对路径")
    ap.add_argument("--desc", default="", help="正文（可含 #话题，≤1000 字）")
    ap.add_argument("--timer", default="", help="定时发布时间 YYYY-MM-DD HH:mm；省略=立即")
    ap.add_argument("--dry", default="", help="true=只填表不发布（链路自检）")
    ap.add_argument("--confirm", default="", help="true 才真正提交；省略=只出预览")
    ap.add_argument("--port", default="8787", help="sign_service 端口")
    ap.add_argument("--account", default="", help="账号 shopKey（可选）")
    args_ns = ap.parse_args()

    images, err = split_images(args_ns.images)
    if err:
        out({"ok": False, "failure_kind": "api_error", "message": err})
        sys.exit(1)

    args = {
        "type": (args_ns.type or "image").strip().lower(),
        "title": (args_ns.title or "").strip(),
        "images": images,
        "video": (args_ns.video or "").strip(),
        "desc": args_ns.desc or "",
        "timer": (args_ns.timer or "").strip(),
        "dry": args_ns.dry.strip().lower() in ("true", "1", "yes", "y"),
    }

    verr = validate(args)
    if verr:
        out({"ok": False, "failure_kind": "api_error", "message": verr})
        sys.exit(1)

    dry = args["dry"]
    confirm = args_ns.confirm.strip().lower() in ("true", "1", "yes", "y")

    # ── L2 门禁：未确认且非 dry-run → 只出预览 ──
    if not confirm and not dry:
        out({
            "ok": False,
            "needConfirm": True,
            "failure_kind": "need_confirm",
            "message": "发布预览（未提交）。确认后请带 --confirm true 重新调用。",
            "preview": {
                "type": args["type"],
                "title": args["title"],
                "desc": args["desc"][:200],
                "images": args["images"],
                "video": args["video"],
                "timer": args["timer"] or "立即发布",
            },
        })
        sys.exit(0)

    # ── 确保 sign_service 在线 ──
    port = int(args_ns.port or "8787")
    ok, detail = ensure_service(port)
    if not ok:
        out({"ok": False, "failure_kind": "skill_error", "message": detail})
        sys.exit(1)
    log("[xhs-publish-re] sign_service: %s" % detail)

    # ── dry-run：链路自检 ──
    if dry:
        result = run_publish_js(args, port)
        result["dryRun"] = True
        result["needConfirm"] = True
        result.setdefault("message", "dry-run 完成：链路自检通过，未发布。")
        out(result)
        sys.exit(0 if result.get("ok") else 1)

    # ── 真正发布 ──
    result = run_publish_js(args, port)
    if result.get("ok"):
        result.setdefault("message", "已提交发布（%s）。平台可能仍在审核，以创作平台「笔记管理」为准。"
                            % ("定时 " + args["timer"] if args["timer"] else "即时"))
    else:
        result.setdefault("failure_kind", "api_error")
        result.setdefault("message", "发布未完成")
    out(result)
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
