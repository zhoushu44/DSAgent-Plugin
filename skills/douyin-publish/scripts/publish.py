#!/usr/bin/env python3
"""
抖音投稿 —— 脚本型薄壳（让发布能作为工作流步骤被执行）。

本文件只声明「平台 + 参数映射 + 必填校验」，HTTP 调用与错误归一在
skills/_shared/publish_bridge.py；真实实现是 host 侧 douyinPublish()
（puppeteer 驱动创作服务平台投稿页）。

## L2 门禁

    python3 publish.py --videoPath "D:/v/1.mp4" --title "标题"                  # 只出预览
    python3 publish.py --videoPath "D:/v/1.mp4" --title "标题" --confirm true   # 真正发布

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

PLATFORM = "douyin"
TITLE_MAX = 30
DESC_MAX = 1000


def main():
    parser = bridge.build_parser(PLATFORM, "抖音视频发布（脚本型薄壳）")
    parser.add_argument("--videoPath", required=True, help="本地视频文件绝对路径")
    parser.add_argument("--title", required=True, help="作品标题（抖音限 30 字）")
    parser.add_argument("--description", default="", help="作品描述/文案（可选，可含 #话题，限 1000 字）")
    args = parser.parse_args()

    payload = {
        "videoPath": (args.videoPath or "").strip(),
        "title": (args.title or "").strip(),
        "description": args.description or "",
    }

    def validate(p):
        if not p["videoPath"]:
            return "缺少 --videoPath（视频文件绝对路径）"
        if not os.path.exists(p["videoPath"]):
            return "视频文件不存在：%s" % p["videoPath"]
        if not p["title"]:
            return "缺少 --title（抖音要求标题非空）"
        if len(p["title"]) > TITLE_MAX:
            return "标题 %d 字，超过抖音上限 %d 字。" % (len(p["title"]), TITLE_MAX)
        if len(p["description"]) > DESC_MAX:
            return "描述 %d 字，超过上限 %d 字。" % (len(p["description"]), DESC_MAX)
        return None

    bridge.run(PLATFORM, payload, confirm=bridge.truthy(args.confirm), account=args.account, validate=validate)


if __name__ == "__main__":
    main()
