#!/usr/bin/env python3
"""
电商上架（MQS 统一商品数据）—— 通用薄壳模板说明

以下 6 个技能共用同一套形态，唯一差别是 PLATFORM 常量与提示文案：

    jd-publish-mqs        PLATFORM = "jd"           京东商家后台
    douyin-publish-mqs    PLATFORM = "douyin-shop"  抖音小店（抖店）
    1688-publish-mqs      PLATFORM = "1688"         1688 卖家工作台
    taobao-publish-mqs    PLATFORM = "taobao-mqs"   淘宝
    tmall-publish-mqs     PLATFORM = "tmall-mqs"    天猫
    pdd-publish-2         PLATFORM = "pdd2"         拼多多商家后台

入参统一是「一个 product JSON」（标题 / 主图 / 详情图 / 规格维度 / SKU 行 / 类目属性），
与 host 侧 dsagent_*_publish_mqs 工具同构。真实实现见各平台 puppeteer 引擎。

## L2 门禁

    python3 publish.py --product-file ./product.json                  # 只出预览
    python3 publish.py --product-file ./product.json --confirm true   # 真正提交

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

# ↓↓↓ 各技能唯一需要改的一行 ↓↓↓
PLATFORM = "__PLATFORM__"
LABEL = "__LABEL__"

TITLE_MAX = 60


def _load_product(raw, path):
    """--product-file 优先；两者都给时文件优先。返回 (dict, error)。"""
    if path:
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f), None
        except Exception as e:
            return None, "读取 --product-file 失败：%s：%s" % (path, e)
    if raw:
        try:
            return json.loads(raw), None
        except Exception as e:
            return None, "--product 不是合法 JSON：%s" % e
    return None, "缺少商品数据：用 --product 或 --product-file 提供"


def main():
    parser = bridge.build_parser(PLATFORM, "%s 商品上架（脚本型薄壳）" % LABEL)
    parser.add_argument("--product", default="", help="统一商品数据 JSON 字符串")
    parser.add_argument("--product-file", default="", help="统一商品数据 JSON 文件（优先于 --product）")
    parser.add_argument("--diagDom", default="", help="DOM 诊断模式：true 时只打开发布页 dump 元素清单后返回（仅 jd/抖店/1688 支持）")
    args = parser.parse_args()

    product, err = _load_product(args.product, args.product_file)
    if err:
        bridge.output_result({"ok": False, "failure_kind": "api_error", "message": err})
        sys.exit(1)

    payload = {"product": product}
    if args.diagDom:
        payload["diagDom"] = bridge.truthy(args.diagDom)

    def validate(p):
        prod = p.get("product") or {}
        if not isinstance(prod, dict):
            return "商品数据必须是 JSON 对象"
        title = str(prod.get("title") or "").strip()
        if not title:
            return "商品数据缺少 title（必填，≤%d 字）" % TITLE_MAX
        if len(title) > TITLE_MAX:
            return "标题 %d 字，超过 %d 字上限。" % (len(title), TITLE_MAX)
        images = prod.get("images")
        if not images or not isinstance(images, list):
            return "商品数据缺少 images（必填，本地绝对路径数组）"
        missing = [x for x in images if not os.path.exists(str(x))]
        if missing:
            return "以下主图不存在：%s" % ", ".join(missing[:3])
        specs = prod.get("specs")
        if specs is not None and (not isinstance(specs, list) or len(specs) > 2):
            return "specs 必须是数组且最多 2 维（如 颜色 / 尺码）"
        return None

    bridge.run(PLATFORM, payload, confirm=bridge.truthy(args.confirm), account=args.account, validate=validate)


if __name__ == "__main__":
    main()
