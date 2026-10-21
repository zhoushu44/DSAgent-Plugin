#!/usr/bin/env python3
"""
闲鱼发布 —— 脚本型薄壳（让发布能作为工作流步骤被执行）。

本文件只声明「平台 + 参数映射 + 必填校验」，HTTP 调用与错误归一在
skills/_shared/publish_bridge.py；真实实现是 host 侧 xianyuPublish()
（puppeteer 驱动 goofish.com/publish）。

## L2 门禁

    python3 publish.py --images "D:/i/1.jpg" --description "全新未拆封" --price 199                # 只出预览
    python3 publish.py --images "D:/i/1.jpg" --description "全新未拆封" --price 199 --confirm true  # 真正发布

不带 --confirm true 只返回「发布预览」，不启动浏览器、不产生任何写操作。

★ 闲鱼校验规则：描述必填且**不能含 emoji**；图片 1~9 张、单张 ≤10MB；价格 0~1 亿元。
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

PLATFORM = "xianyu"
IMG_MIN, IMG_MAX = 1, 9
IMG_BYTES_MAX = 10 * 1024 * 1024
PRICE_MAX = 100_000_000


def _split_paths(raw):
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
            return [], '--images 看起来是 JSON 数组但解析失败，请检查格式或改用英文逗号分隔。'
    return [x.strip() for x in s.split(",") if x.strip()], None


def _is_emoji(ch):
    cp = ord(ch)
    return (
        0x1F300 <= cp <= 0x1FAFF or
        0x1F000 <= cp <= 0x1F2FF or
        0x2600 <= cp <= 0x27BF or
        0xFE00 <= cp <= 0xFE0F or
        0x1F1E6 <= cp <= 0x1F1FF
    )


def main():
    parser = bridge.build_parser(PLATFORM, "闲鱼商品发布（脚本型薄壳）")
    parser.add_argument("--images", required=True, help="本地图片绝对路径，1~9 张，逗号分隔或 JSON 数组")
    parser.add_argument("--description", required=True, help="宝贝描述（必填，不能含 emoji）")
    parser.add_argument("--price", required=True, help="价格（元，0~1 亿元）")
    parser.add_argument("--title", default="", help="宝贝标题（可选）")
    parser.add_argument("--originalPrice", default="", help="原价/入手价（元，可选）")
    args = parser.parse_args()

    images, err = _split_paths(args.images)
    if err:
        bridge.output_result({"ok": False, "failure_kind": "api_error", "message": err})
        sys.exit(1)

    payload = {
        "images": images,
        "description": args.description or "",
        "price": str(args.price or "").strip(),
        "title": args.title or "",
        "originalPrice": str(args.originalPrice or "").strip(),
    }

    def validate(p):
        if not p["description"].strip():
            return "缺少 --description（闲鱼要求描述必填）"
        bad = [c for c in p["description"] if _is_emoji(c)]
        if bad:
            return "描述含 emoji（%s），闲鱼校验不允许，请删除后重试。" % "".join(bad[:3])
        try:
            price = float(p["price"])
        except ValueError:
            return "价格不是合法数字：%s" % p["price"]
        if not (0 <= price < PRICE_MAX):
            return "价格需在 0 ~ 1 亿元之间，当前：%s" % p["price"]
        if p["originalPrice"]:
            try:
                op = float(p["originalPrice"])
            except ValueError:
                return "原价不是合法数字：%s" % p["originalPrice"]
            if not (0 <= op < PRICE_MAX):
                return "原价需在 1 亿元之内，当前：%s" % p["originalPrice"]
        n = len(p["images"])
        if n < IMG_MIN or n > IMG_MAX:
            return "图片需 %d~%d 张，当前 %d 张。" % (IMG_MIN, IMG_MAX, n)
        missing = [x for x in p["images"] if not os.path.exists(x)]
        if missing:
            return "以下图片不存在：%s" % ", ".join(missing[:3])
        oversize = [x for x in p["images"] if os.path.getsize(x) > IMG_BYTES_MAX]
        if oversize:
            return "以下图片超过 10MB：%s" % ", ".join(oversize[:3])
        return None

    bridge.run(PLATFORM, payload, confirm=bridge.truthy(args.confirm), account=args.account, validate=validate)


if __name__ == "__main__":
    main()
