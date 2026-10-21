#!/usr/bin/env python3
"""
淘宝 / 天猫 商品发布 —— 脚本型薄壳（让发布能作为工作流步骤被执行）。

本文件只声明「平台 + 参数映射 + 必填校验」，HTTP 调用与错误归一在
skills/_shared/publish_bridge.py；真实实现是 host 侧 taobaoPublish()
（puppeteer 驱动卖家中心发布页）。

★ 这是「扁平参数」入口（对应 dsagent_taobao_publish）：
    主图 + 标题 + 一口价/库存/货号 + 可选 SKU 数组 + 类目关键词
  与 taobao-publish-mqs（统一 product JSON）是两个不同形态，别混用。

## L2 门禁

    python3 publish.py --images "D:/i/1.jpg" --title "纯棉短袖T恤" --price 79                  # 只出预览
    python3 publish.py --images "D:/i/1.jpg" --title "纯棉短袖T恤" --price 79 --confirm true   # 真正提交

不带 --confirm true 只返回「发布预览」，不启动浏览器、不产生任何写操作。
"""

import json
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

PLATFORM = "taobao"
TITLE_MAX = 60
IMG_MAX = 5
IMG_BYTES_MAX = 3 * 1024 * 1024


def _split_paths(raw):
    s = (raw or "").strip()
    if not s:
        return [], None
    if s.startswith("["):
        try:
            arr = json.loads(s)
            if isinstance(arr, list):
                return [str(x).strip() for x in arr if str(x).strip()], None
        except Exception:
            return [], '--images 看起来是 JSON 数组但解析失败，请检查格式或改用英文逗号分隔。'
    return [x.strip() for x in s.split(",") if x.strip()], None


def main():
    parser = bridge.build_parser(PLATFORM, "淘宝/天猫 商品发布（扁平参数，脚本型薄壳）")
    parser.add_argument("--images", required=True, help="本地主图绝对路径，1~5 张，单张 ≤3MB")
    parser.add_argument("--title", required=True, help="商品标题（≤60 字）")
    parser.add_argument("--channel", default="", help="渠道：taobao（默认）/ tmall")
    parser.add_argument("--price", default="", help="一口价（元）")
    parser.add_argument("--stock", default="", help="库存（件）")
    parser.add_argument("--itemNo", default="", help="商家编码/货号")
    parser.add_argument("--skus", default="", help='多规格 JSON： [{"name":"红色","price":"99","stock":"10","outerId":"SKU001"}]')
    parser.add_argument("--categoryKeyword", default="", help="选类目关键词（具体叶子类目词，如「儿童睡衣」）")
    parser.add_argument("--brand", default="", help="品牌（部分类目必填）")
    parser.add_argument("--model", default="", help="型号（部分类目必填）")
    parser.add_argument("--replayMode", default="", help="Json 劫持重放模式：true/false")
    args = parser.parse_args()

    images, err = _split_paths(args.images)
    if err:
        bridge.output_result({"ok": False, "failure_kind": "api_error", "message": err})
        sys.exit(1)

    payload = {
        "images": images,
        "title": (args.title or "").strip(),
        "channel": args.channel or "",
        "price": str(args.price or "").strip(),
        "stock": str(args.stock or "").strip(),
        "itemNo": args.itemNo or "",
        "categoryKeyword": args.categoryKeyword or "",
        "brand": args.brand or "",
        "model": args.model or "",
    }
    if args.skus.strip():
        payload["skus"] = args.skus.strip()
    if args.replayMode.strip():
        payload["replayMode"] = bridge.truthy(args.replayMode)

    def validate(p):
        if not p["title"]:
            return "缺少 --title（淘宝/天猫要求标题非空）"
        if len(p["title"]) > TITLE_MAX:
            return "标题 %d 字，超过上限 %d 字。" % (len(p["title"]), TITLE_MAX)
        n = len(p["images"])
        if n < 1 or n > IMG_MAX:
            return "主图需 1~%d 张，当前 %d 张。" % (IMG_MAX, n)
        missing = [x for x in p["images"] if not os.path.exists(x)]
        if missing:
            return "以下主图不存在：%s" % ", ".join(missing[:3])
        oversize = [x for x in p["images"] if os.path.getsize(x) > IMG_BYTES_MAX]
        if oversize:
            return "以下主图超过 3MB：%s" % ", ".join(oversize[:3])
        if p.get("skus"):
            try:
                arr = json.loads(p["skus"])
                if not isinstance(arr, list):
                    raise ValueError("不是数组")
            except Exception as e:
                return 'skus 不是合法 JSON 数组（形如 [{"name":"红色","price":"99"}]）：%s' % e
        return None

    bridge.run(PLATFORM, payload, confirm=bridge.truthy(args.confirm), account=args.account, validate=validate)


if __name__ == "__main__":
    main()
