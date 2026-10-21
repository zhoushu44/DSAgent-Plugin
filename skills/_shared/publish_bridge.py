#!/usr/bin/env python3
"""
发布共享桥 —— 所有 *-publish 技能的脚本外壳共用这一份实现。

## 为什么要有它

工作流引擎（src/workflow/service.ts）的六项校验里，第二项拒绝**纯指令型**技能当步骤：

    「第 N 个步骤的技能「xxx」是纯指令型（无可执行入口），不能作为步骤」

而 12 个发布技能原本全是纯指令型（只有 SKILL.md，靠模型直接调 host 工具）。
为了让「取数 → 成文 → 发布」能整条编排进工作流，每个技能需要一个
`scripts/publish.py` 脚本入口 —— 引擎靠一条正则认它：

    /\\{(?:baseDir|this_skill_dir)\\}[^\\n]{0,120}?(scripts\\/[\\w.\\/-]+\\.py)/

如果 12 个技能各写一份 HTTP 调用，就是 12 份重复代码（改个超时要改 12 处）。
所以：**共享桥（本文件）+ 薄壳（各技能的 publish.py，只声明 platform 与参数映射）**。

## 数据流

    publish.py (薄壳)  --platform xxx --payload {...}-->  本桥
        本桥  --POST /dsagent/api  action=publish_platform-->  host 路由
            host 路由  -->  dispatchPlatformPublish()  -->  各平台真实实现（puppeteer）

## L2 确认门禁（本桥不越权）

    --confirm 不传 / false  →  只回「发布预览」，不启动浏览器、不产生任何写操作
    --confirm true          →  真正提交

本桥只做布尔归一与透传，任何放行/拦截都由平台实现内部决定。
预览（返回 needConfirm）不算失败，退出码给 0 —— 否则工作流会把「正常预览」判成红。
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

# ── 强制 stdout/stderr 走 UTF-8 ──
# Windows 控制台默认 GBK：含中文/emoji 的错误信息（如「描述含 emoji 😀」）
# 会直接抛 UnicodeEncodeError，把「校验给了明确提示」变成「脚本崩了」。
# errors='replace' 兜底：即便终端不支持，也不会因编码问题中断业务逻辑。
for _stream_name in ("stdout", "stderr"):
    _s = getattr(sys, _stream_name, None)
    if _s is not None and hasattr(_s, "reconfigure"):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

# ── 引入 dsagent_runtime（与其它技能脚本同一套约定）──
_dsagent_dir = os.path.join(os.environ.get("DSAGENT_SKILL_ROOT", ""), ".dsagent")
if _dsagent_dir and _dsagent_dir not in sys.path:
    sys.path.insert(0, _dsagent_dir)

try:
    from runtime.dsagent_runtime import log, output_result
except Exception:  # pragma: no cover - 缺 runtime 时退化为纯打印
    def log(msg):
        print(msg, file=sys.stderr)

    def output_result(payload):
        print("__DSAGENT_RESULT__" + json.dumps(payload, ensure_ascii=False))


# ── 支持的平台（必须与 src/platform-publish.ts 的 PUBLISH_PLATFORMS 一致）──
PLATFORMS = [
    "zhihu", "douyin", "bilibili", "xiaohongshu", "xianyu",
    "taobao", "taobao-mqs", "tmall-mqs", "jd", "douyin-shop", "1688", "pdd2",
]


def _api_base():
    """定位本地插件 HTTP 服务（http-routes 挂在 /dsagent/api）。"""
    base = os.environ.get("DSAGENT_API_BASE", "").strip()
    if base:
        return base.rstrip("/")
    port = os.environ.get("DSAGENT_PORT", "").strip() or "19387"
    return "http://127.0.0.1:%s/dsagent/api" % port


def call_platform(platform, payload, confirm, account="", timeout=600):
    """调 host 的 publish_platform action。

    ★ 不加 Origin/Referer：http-routes 的同源校验只在 origin 非空时生效，
      无 origin 的本地调用不会被拦（脚本不是浏览器跨站场景）。
    """
    url = _api_base()
    body = json.dumps({
        "action": "publish_platform",
        "platform": platform,
        "payload": payload,
        "confirm": bool(confirm),
        "account": account,
    }, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")
        except Exception:
            pass
        return {
            "ok": False,
            "failure_kind": "api_error",
            "message": "发布接口 HTTP %s：%s" % (e.code, (detail or e.reason).__str__()[:300]),
        }
    except Exception as e:
        return {
            "ok": False,
            "failure_kind": "api_error",
            "message": (
                "无法连接本地发布服务（%s）：%s。"
                "请确认 DSH 正在运行，或设置 DSAGENT_API_BASE 指向 /dsagent/api。" % (url, e)
            ),
        }

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {
            "ok": False,
            "failure_kind": "parse_error",
            "message": "发布接口返回非 JSON：%s" % raw[:300],
        }


def read_text(text, text_file, field):
    """正文类字段：--content-file 优先于 --content。"""
    if text_file:
        try:
            with open(text_file, "r", encoding="utf-8") as f:
                return f.read(), None
        except Exception as e:
            return "", "读取 %s 指定的文件失败：%s：%s" % (field, text_file, e)
    return text or "", None


def truthy(v):
    return str(v).strip().lower() in ("true", "1", "yes", "y")


def run(platform, payload, confirm=False, account="", validate=None):
    """薄壳统一入口：校验 → 调桥 → 归一输出。

    validate: 可选回调 (payload) -> 错误消息或 None，用于平台特有必填校验。
    """
    if platform not in PLATFORMS:
        output_result({
            "ok": False, "failure_kind": "api_error",
            "message": "不支持的 platform「%s」。可选：%s" % (platform, " / ".join(PLATFORMS)),
        })
        sys.exit(1)

    if validate:
        err = validate(payload)
        if err:
            output_result({"ok": False, "failure_kind": "api_error", "message": err})
            sys.exit(1)

    log("[%s 发布] confirm=%s payload_keys=%s" % (platform, confirm, ",".join(sorted(payload.keys()))))

    result = call_platform(platform, payload, confirm, account)
    if not isinstance(result, dict):
        output_result({
            "ok": False, "failure_kind": "parse_error",
            "message": "返回格式异常：%r" % (result,),
        })
        sys.exit(1)

    if "ok" not in result:
        result["ok"] = False
    if not result.get("ok"):
        result.setdefault("failure_kind", result.get("failureKind") or "api_error")
        result.setdefault("message", result.get("text") or "发布未完成")

    output_result(result)

    # 预览（needConfirm）在「只出预览」场景下不算失败，退出码 0，避免工作流判红
    if not result.get("ok") and not result.get("needConfirm"):
        sys.exit(1)
    return result


def build_parser(platform, description):
    """各薄壳共用的 argparse：--confirm / --account 一致。

    ★ platform 入参仅用于生成 usage 文本里的提示，**不注册成 --platform 选项**：
      薄壳里的 PLATFORM 常量就是该技能的唯一身份，允许命令行覆盖会制造
      「用知乎脚本发抖音」这类越权路径；而且 run() 只读薄壳传入的常量，
      留着该选项纯属误导。
    """
    parser = argparse.ArgumentParser(
        description="%s（平台固定为 %s）" % (description, platform),
    )
    parser.add_argument("--confirm", default="", help="确认发布：true 才真正提交；省略=只出预览")
    parser.add_argument("--account", default="", help="账号 shopKey（可选）")
    return parser
