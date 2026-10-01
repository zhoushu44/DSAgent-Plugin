"""
DSAgent runtime 输出辅助 — stdout/stderr 分离 + 结构化摘要。

规范（吸收 QIWork）：
  - 进度日志 → stderr（log()）
  - 最终结果 → stdout，用 __DSAGENT_RESULT__ 前缀 JSON（output_result()）
  - 文件清单 → stderr，用 ---[OUTPUT_FILES] 前缀（output_files()）
  - 结构化摘要 → stdout，人类可读格式（output_summary()）
"""

from __future__ import annotations

import sys
import json
import re
from typing import Any

RESULT_PREFIX = "__DSAGENT_RESULT__"
FILES_PREFIX = "---[OUTPUT_FILES]"


def log(msg: str) -> None:
    """打印进度信息到 stderr。stdout 留给最终结果。"""
    print(msg, file=sys.stderr, flush=True)


def output_result(data: Any) -> None:
    """输出 __DSAGENT_RESULT__ 行到 stdout，供 DSAgent 插件解析。"""
    print(f"{RESULT_PREFIX}{json.dumps(data, ensure_ascii=False)}")


def output_files(*paths: str) -> None:
    """输出文件清单到 stderr，供 DSAgent 插件解析。"""
    valid = [p for p in paths if p]
    if valid:
        print(f"{FILES_PREFIX} " + "\n".join(valid), file=sys.stderr, flush=True)


def output_summary(items: list[dict], **extra: Any) -> None:
    """
    输出人类可读的结构化摘要到 stdout。

    格式参考 QIWork：
      [完成] 共 30 条结果
      [关键词] iPhone 15
      [文件] C:\\path\\to\\output.csv
      [调用] 共调用 mtop 接口：2 次
    """
    lines: list[str] = []
    lines.append(f"[完成] 共 {len(items)} 条结果")
    for k, v in extra.items():
        lines.append(f"[{k}] {v}")
    print("\n".join(lines), file=sys.stderr, flush=True)


# 平台限定词：出现在关键词前后都应剥离（"闲鱼商品" → "商品"）
_PLATFORM_WORDS = (
    r"闲鱼|淘宝|天猫|京东|拼多多|抖音|小红书|知乎|哔哩哔哩|B站|快手|微信公众号|微信小店"
)
# 指令动词：命中时其后的内容才是关键词主体
_VERB_RE = re.compile(
    r"(?:搜索|查找|采集|爬取|抓取|获取|搜|查|找)\s*(.+)"
)
# 前缀填充词：平台名（可带「上/里/中/的」）+ 指令词 + 语气词，循环剥离至稳定
_PREFIX_SOFT_RE = re.compile(
    r"^(?:(?:" + _PLATFORM_WORDS + r")(?:上面|上|里|中|的)?"
    r"|(?:帮我?|请|麻烦|帮忙|搜索|查找|采集|爬取|抓取|获取|看一下|看看|来点|一下|上面)"
    r")+"
)
# 前缀通用名词，需后接空白/结尾/「的」才算填充词（避免误伤"数据分析工具"这类关键词）
_PREFIX_NOUN_RE = re.compile(
    r"^(?:商品|数据|信息|结果|价格|列表|榜单|内容)+(?=\s|$|的)"
)
# 后缀填充词：通用名词（可带助词）与平台名，需在结尾命中
_SUFFIX_RE = re.compile(
    r"(?:\s*(?:的商品|的数据|的信息|的结果|的价格|的内容|商品|数据|信息|结果|价格|列表|排行榜|榜单)"
    r"|(?:" + _PLATFORM_WORDS + r"))+$"
)


def extract_keyword_from_request(request: str) -> str:
    """
    从 DSAGENT_REQUEST 环境变量文本中提取关键词。

    指令动词分支与兜底分支共用同一套前后缀清洗（循环至稳定）：
      "帮我搜索闲鱼上的 iPhone 15" → "iPhone 15"
      "搜索一下闲鱼的iPhone 15"     → "iPhone 15"
      "采集闲鱼商品数据 手机壳"      → "手机壳"
      "查一下 AirPods 的价格"        → "AirPods"
      "小红书搜一下美妆"             → "美妆"
    """
    if not request:
        return ""

    text = request.strip()

    # 命中指令动词时，其后的内容才是主体（动词及其之前的修饰语一并丢弃）
    m = _VERB_RE.search(text)
    if m and m.group(1).strip():
        text = m.group(1).strip()

    # 一次替换可能暴露新的可清洗片段，循环至稳定
    for _ in range(8):
        before = text
        text = re.sub(r"^[的\s]+", "", text)
        text = _PREFIX_SOFT_RE.sub("", text).strip()
        text = _PREFIX_NOUN_RE.sub("", text).strip()
        text = _SUFFIX_RE.sub("", text).strip()
        if text == before:
            break

    return text.strip()
