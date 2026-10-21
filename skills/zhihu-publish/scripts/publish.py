#!/usr/bin/env python3
"""
知乎发布 —— 脚本型薄壳（让发布能作为工作流步骤被执行）。

本文件只声明「平台 + 参数映射 + 必填校验」，HTTP 调用与错误归一在
skills/_shared/publish_bridge.py。

## 为什么需要脚本入口

zhihu-publish 原本是**纯指令型**技能（只有 SKILL.md，无脚本入口）。
工作流引擎六项校验的第二项明确拒绝指令型技能当步骤：

    「第 N 个步骤的技能「xxx」是纯指令型（无可执行入口），不能作为步骤」

加了脚本入口后，`取数 → 成文 → 发布` 才能整条编排进工作流。

## 真实实现在哪

host 侧 zhihuPublish()（puppeteer 驱动编辑器、注入登录态），
经 HTTP action `publish_platform` 暴露给本脚本（分发逻辑见 src/platform-publish.ts）。

## L2 门禁

    python3 publish.py --title "标题" --content "正文"                    # 只出预览
    python3 publish.py --title "标题" --content "正文" --confirm true     # 真正发布
    python3 publish.py --title "标题" --content-file ./article.txt --confirm true

不带 --confirm true 只返回「发布预览」，不启动浏览器、不产生任何写操作。
"""

import os
import sys

# ── 定位共享桥：本脚本在 skills/<id>/scripts/ 下，桥在 skills/_shared/ ──
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

PLATFORM = "zhihu"
TITLE_MAX = 100
CONTENT_MAX = 50000


def main():
    parser = bridge.build_parser(PLATFORM, "知乎文章发布（脚本型薄壳）")
    parser.add_argument("--title", required=True, help="文章标题（≤100 字）")
    parser.add_argument("--content", default="", help="正文纯文本（≤50000 字）")
    parser.add_argument("--content-file", default="", help="从文件读正文（与 --content 二选一，文件优先）")
    args = parser.parse_args()

    title = (args.title or "").strip()
    content, err = bridge.read_text(args.content, args.content_file, "--content-file")
    if err:
        bridge.output_result({"ok": False, "failure_kind": "api_error", "message": err})
        sys.exit(1)

    def validate(p):
        if not p.get("title"):
            return "缺少 --title（标题不能为空）"
        if len(p["title"]) > TITLE_MAX:
            return "标题 %d 字，超过知乎上限 %d 字，请精简。" % (len(p["title"]), TITLE_MAX)
        if not (p.get("content") or "").strip():
            return "缺少正文：用 --content 或 --content-file 提供"
        if len(p["content"]) > CONTENT_MAX:
            return "正文 %d 字，超过上限 %d 字，请精简。" % (len(p["content"]), CONTENT_MAX)
        return None

    bridge.run(
        PLATFORM,
        {"title": title, "content": content},
        confirm=bridge.truthy(args.confirm),
        account=args.account,
        validate=validate,
    )


if __name__ == "__main__":
    main()
