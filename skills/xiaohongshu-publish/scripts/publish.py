#!/usr/bin/env python3
"""
小红书发布 —— 脚本型薄壳（让发布能作为工作流步骤被执行）。

本文件只声明「平台 + 参数映射 + 必填校验」，HTTP 调用与错误归一在
skills/_shared/publish_bridge.py；真实实现是 host 侧 xiaohongshuPublish()
（puppeteer 驱动创作服务平台发布页）。

## 视频笔记 vs 图文笔记

    --videoPath  「视频笔记」用，与 --imagePaths 二选一
    --imagePaths 「图文笔记」用，最多 18 张，逗号分隔或 JSON 数组

## L2 门禁

    python3 publish.py --title "标题" --imagePaths "D:/i/1.jpg,D:/i/2.jpg"                  # 只出预览
    python3 publish.py --title "标题" --imagePaths "D:/i/1.jpg" --confirm true              # 真正发布

不带 --confirm true 只返回「发布预览」，不启动浏览器、不产生任何写操作。
"""

import os
import sys

_here = os.path.dirname(os.path.abspath(__file__))
_shared = os.path.abspath(os.path.join(_here, "..", "..", "_shared"))
if _shared not in sys.path:
    sys.path.insert(0, _shared)

try:
    import publish_bridge as bridge
except Exception as e:  # pragma: no cover
    print("无法加载共享桥 %s：%s" % (_shared, e), file=sys.stderr)
    print('__DSAGENT_RESULT__{"ok": false, "failure_kind": "skill_error", "message": "共享桥加载失败"}')
    sys.exit(1)

PLATFORM = "xiaohongshu"
TITLE_MAX = 20
CONTENT_MAX = 1000
IMG_MAX = 18


def _split_paths(raw):
    """--imagePaths 支持 JSON 数组或英文逗号分隔，返回 (list, error)。"""
    s = (raw or "").strip()
    if not s:
        return [], None
    if s.startswith("["):
        import json
        try:
            arr = json.loads(s)
            if isinstance(arr, list):
                return [str(x).strip() for x in arr if str(x).strip()], None
        except Exception:
            return [], '--imagePaths 看起来是 JSON 数组但解析失败，请检查格式或改用英文逗号分隔。'
    return [x.strip() for x in s.split(",") if x.strip()], None


def main():
    parser = bridge.build_parser(PLATFORM, "小红书笔记发布（脚本型薄壳）")
    parser.add_argument("--title", required=True, help="笔记标题（小红书限 20 字）")
    parser.add_argument("--videoPath", default="", help="视频笔记：本地视频绝对路径（与 --imagePaths 二选一）")
    parser.add_argument("--imagePaths", default="", help="图文笔记：图片绝对路径，逗号分隔或 JSON 数组，最多 18 张")
    parser.add_argument("--content", default="", help="笔记正文（可选，可含 #话题，限 1000 字）")
    args = parser.parse_args()

    images, err = _split_paths(args.imagePaths)
    if err:
        bridge.output_result({"ok": False, "failure_kind": "api_error", "message": err})
        sys.exit(1)

    payload = {
        "title": (args.title or "").strip(),
        "videoPath": (args.videoPath or "").strip(),
        "imagePaths": images,
        "content": args.content or "",
    }

    def validate(p):
        if not p["title"]:
            return "缺少 --title（小红书要求标题非空）"
        if len(p["title"]) > TITLE_MAX:
            return "标题 %d 字，超过小红书上限 %d 字。" % (len(p["title"]), TITLE_MAX)
        if len(p["content"]) > CONTENT_MAX:
            return "正文 %d 字，超过上限 %d 字。" % (len(p["content"]), CONTENT_MAX)
        has_video = bool(p["videoPath"])
        has_images = bool(p["imagePaths"])
        if not has_video and not has_images:
            return "需要提供素材：--videoPath（视频笔记）或 --imagePaths（图文笔记）二选一"
        if has_video and has_images:
            return "--videoPath 与 --imagePaths 只能二选一"
        if has_video and not os.path.exists(p["videoPath"]):
            return "视频文件不存在：%s" % p["videoPath"]
        if has_images:
            if len(p["imagePaths"]) > IMG_MAX:
                return "图片 %d 张，超过上限 %d 张。" % (len(p["imagePaths"]), IMG_MAX)
            missing = [x for x in p["imagePaths"] if not os.path.exists(x)]
            if missing:
                return "以下图片不存在：%s" % ", ".join(missing[:3])
        return None

    bridge.run(PLATFORM, payload, confirm=bridge.truthy(args.confirm), account=args.account, validate=validate)


if __name__ == "__main__":
    main()
