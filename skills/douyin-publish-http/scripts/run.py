#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""douyin-publish-http 入口包装 — DSAgent 技能宿主只认 .py 脚本入口。

宿主的 detectEntry/buildCommand 设计如此：
  - detectEntry 的正则只匹配 `{baseDir}/scripts/xxx.py`
  - buildCommand 的 script 型硬编码 [py, script, ...args]
所以 Node 技能必须有一个 .py 入口，由它转调 scripts/publish.mjs。

本包装只做三件事：定位 node → 透传参数 → 原样转发 stdout/stderr 与退出码。
不解析、不改写业务输出 —— publish.mjs 自己走 __DSAGENT_RESULT__ 协议。
"""

import io
import os
import shutil
import subprocess
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE_SCRIPT = os.path.join(SKILL_DIR, "scripts", "publish.mjs")


def find_node():
    """按优先级找 node：环境变量 → PATH → 常见安装路径。

    两个 Windows 特有的坑：
    1. shutil.which("node") 可能返回 "node.EXE"（PATHEXT 里的大写形式）。
       文件确实存在（NTFS 大小写不敏感），但 CreateProcess 用这个字符串起进程会
       FileNotFoundError —— 所以统一把扩展名规范成小写 .exe。
    2. PATH 里可能只有 nodejs 目录而没配 PATHEXT，which 返回 None，此时靠常见路径兜底。
    """
    cands = []
    if os.environ.get("DSAGENT_NODE_BIN"):
        cands.append(os.environ["DSAGENT_NODE_BIN"])
    for name in ("node.exe", "node"):
        w = shutil.which(name)
        if w:
            cands.append(w)
    cands += [
        r"C:\Program Files\nodejs\node.exe",
        r"C:\Program Files (x86)\nodejs\node.exe",
        r"/usr/bin/node",
        r"/usr/local/bin/node",
        "/opt/homebrew/bin/node",
    ]
    for c in cands:
        if not c:
            continue
        # 规范化扩展名大小写，规避 CreateProcess 的 FileNotFoundError
        root, ext = os.path.splitext(c)
        if ext.lower() == ".exe":
            c = root + ".exe"
        if os.path.exists(c):
            return c
    return None


def main():
    if not os.path.exists(NODE_SCRIPT):
        sys.stderr.write(f"[entry] Node 脚本不存在: {NODE_SCRIPT}\n")
        return 1

    node = find_node()
    if not node:
        sys.stderr.write("[entry] 未找到 node 可执行文件，请安装 Node.js 或设置 DSAGENT_NODE_BIN\n")
        return 1

    # argv[1:] 原样透传；不注入任何参数，避免与 publish.mjs 的 argparse 冲突
    cmd = [node, NODE_SCRIPT, *sys.argv[1:]]
    sys.stderr.write(f"[entry] {' '.join(cmd)}\n")

    # stdio 透传：publish.mjs 的 __DSAGENT_RESULT__ 行必须原样到 stdout
    proc = subprocess.run(cmd, cwd=SKILL_DIR)
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
