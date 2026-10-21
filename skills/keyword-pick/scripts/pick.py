#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""关键词列表按轮次取词。

工作流 batch 模式下引擎每轮只递增 loop.index，输入变量不变。
本脚本把「A,B,C」按 index 切成当轮那一个词，让 N 轮处理 N 个不同的词。

输出走 __DSAGENT_RESULT__ 单行协议；进度日志走 stderr。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

RESULT_PREFIX = "__DSAGENT_RESULT__"


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def output_result(data: dict) -> None:
    print(f"{RESULT_PREFIX}{json.dumps(data, ensure_ascii=False)}", flush=True)


# 逗号（中英）、顿号、竖线、分号、换行 都当分隔符
SPLIT_RE = re.compile(r"[,，、|;；\n\r]+")


def parse_keywords(raw: str) -> list[str]:
    """切分 → 去空白 → 保序去重。"""
    seen: set[str] = set()
    out: list[str] = []
    for part in SPLIT_RE.split(raw or ""):
        kw = part.strip()
        if not kw:
            continue
        if kw in seen:
            continue
        seen.add(kw)
        out.append(kw)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="关键词列表按轮次取词")
    ap.add_argument("--keywords", default="", help="关键词列表，逗号/顿号/换行分隔")
    ap.add_argument("--index", default="1", help="取第几个（从 1 开始；超长自动回绕）")
    args = ap.parse_args()

    kws = parse_keywords(args.keywords)
    if not kws:
        output_result({
            "ok": False,
            "failure_kind": "skill_error",
            "message": "未提供关键词列表（--keywords），请用逗号分隔传入至少一个关键词。",
        })
        sys.exit(1)

    try:
        idx = int(str(args.index).strip())
    except (TypeError, ValueError):
        idx = 1
    if idx < 1:
        idx = 1

    total = len(kws)
    pos = (idx - 1) % total          # 回绕：轮次多于词数时不空跑
    kw = kws[pos]

    log(f"[取词] index={idx} total={total} → 「{kw}」{'（已回绕）' if idx > total else ''}")

    output_result({
        "ok": True,
        "keyword": kw,
        "index": idx,
        "position": pos + 1,
        "total": total,
        "wrapped": idx > total,
        "all": kws,
    })


if __name__ == "__main__":
    main()
