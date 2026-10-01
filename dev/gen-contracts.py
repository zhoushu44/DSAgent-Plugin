#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量生成技能「输入输出契约」—— <skillDir>/contract.json

为什么
------
宿主把技能暴露给模型有两条路径（见 src/index.ts 的 contract-tools effect）：

  1. 技能目录下有 contract.json → 注册成**独立工具** ``dsagent_<skill_id>``，
     参数表由契约生成，模型直接看到「这个技能要哪些参数、哪个必填、可选值是什么」，
     对齐原项目「一个技能一个 function tool」的形态。
  2. 没有契约 → 仍走 ``dsagent_execute_skill`` 单工具 + 正则从自然语言猜参数。

本脚本把技能自己的 argparse 定义固化成契约。契约是每技能独立文件：
改一个技能只动它自己的 contract.json，不会影响其它技能。

**只给「有输入」的技能写契约**。技能共 49 个，其中 34 个是纯指令型（instructions），
本身没有参数——把它们注册成参数为空的独立工具，对模型是纯噪声、零信息增量。
这类技能不写契约，继续走 ``dsagent_execute_skill`` + 系统提示词清单。
判据是契约能否产出非空 argv：``input.args`` 或 ``input.subcommands`` 至少有一个。

字段口径必须与 src/services/arguments.ts 的 ``SkillContract`` / ``validateContract`` 一致。

用法
----
    python dev/gen-contracts.py                      # 干跑：只打印摘要，不写文件
    python dev/gen-contracts.py --write              # 写入 <skill>/contract.json
    python dev/gen-contracts.py --only market-analysis,xianyu-crawl --write
    python dev/gen-contracts.py --show market-analysis   # 打印单个技能的契约 JSON
    python dev/gen-contracts.py --check              # 只校验已存在的契约是否合法

注意
----
入口形态的判定逻辑是 ``src/services/skill-service.ts::detectEntry()`` 的镜像，
两边必须保持一致：契约里的 entry 与运行时真正执行的入口不能各说各话。
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import sys
from pathlib import Path

# ─────────────────────────── 与 TS 侧共享的常量 ───────────────────────────

SCHEMA = "dsagent/skill-contract@1"
RESULT_PREFIX = "__DSAGENT_RESULT__"
FILES_MARKER = "---[OUTPUT_FILES]"
CONTRACT_FILE = "contract.json"

# 宿主已注册的原生工具名（src/index.ts 的 `const tools = [...]`）。
# 这些名字优先于契约工具：同名时契约工具会被跳过注册。脚本只做提示，不阻止生成。
#
# 当前这 10 个同名技能（bilibili-download/bilibili-publish/douyin-publish/pdd-crawl/
# pdd-publish/taobao-publish/xianyu-analytics/xianyu-publish/xiaohongshu-publish/
# zhihu-publish）**全部是 instructions 型、没有输入**，因此按上面的规则本就不会生成契约，
# 也就不会与原生工具撞名。index.ts::scanSkillCatalog() 里「有契约就跳过提示词清单」
# 的写法因此是安全的——契约存在 ⇔ 有输入 ⇔ 不是这 10 个。
# 若将来某个同名技能长出了参数，这里会打印提示，届时需要同步调整 scanSkillCatalog()。
RESERVED_TOOL_NAMES = {
    "dsagent_list_accounts",
    "dsagent_check_account_health",
    "dsagent_search_accounts",
    "dsagent_browser_login",
    "dsagent_browser_close",
    "dsagent_risk_verify",
    "dsagent_proxy",
    "dsagent_save_cookie",
    "dsagent_douyin_publish",
    "dsagent_zhihu_publish",
    "dsagent_bilibili_publish",
    "dsagent_bilibili_download",
    "dsagent_xiaohongshu_publish",
    "dsagent_pdd_crawl",
    "dsagent_xianyu_publish",
    "dsagent_taobao_publish",
    "dsagent_pdd_publish",
    "dsagent_xianyu_analytics",
    "dsagent_list_skills",
    "dsagent_get_skill_detail",
    "dsagent_execute_skill",
    "dsagent_generate_report",
    "dsagent_list_platforms",
    "dsagent_chat_with_context",
}

# 脚本入口：正文里带显式占位符、且真实存在的 scripts/xxx.py
# （镜像 skill-service.ts 的 SCRIPT_CALL_RE —— 刻意不认裸 `python scripts/xxx.py`）
SCRIPT_CALL_RE = re.compile(r"\{(?:baseDir|this_skill_dir)\}[^\n]{0,120}?(scripts/[\w./-]+\.py)")

MAX_HELP_LEN = 200
MAX_IMPORT_DEPTH = 4


# ─────────────────────────── 契约校验（validateContract 镜像） ───────────────────────────

ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
ARGNAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def validate_contract(c: dict) -> list[str]:
    """镜像 src/services/arguments.ts::validateContract()，让生成期就能发现非法契约。"""
    errs: list[str] = []
    if not isinstance(c, dict):
        return ["契约必须是 JSON 对象"]
    if c.get("schema") != SCHEMA:
        errs.append(f"schema 必须是 {SCHEMA}（实际 {c.get('schema')}）")
    cid = c.get("id")
    if not isinstance(cid, str) or not ID_RE.match(cid):
        errs.append(f"id 非法：{cid}")
    entry = c.get("entry") or {}
    form = entry.get("form")
    if form not in ("package", "script", "instructions"):
        errs.append(f"entry.form 非法：{form}")
    elif form == "package" and not entry.get("pkg"):
        errs.append("entry.form=package 时必须给 entry.pkg")
    elif form == "script" and not entry.get("script"):
        errs.append("entry.form=script 时必须给 entry.script")

    def check_args(items, where: str):
        seen = set()
        for a in items or []:
            name = (a or {}).get("name")
            if not isinstance(name, str) or not ARGNAME_RE.match(name):
                errs.append(f"{where} 参数名非法：{name}")
                continue
            if name in seen:
                errs.append(f"{where} 参数名重复：{name}")
            seen.add(name)
            if "choices" in a and not isinstance(a["choices"], list):
                errs.append(f"{where}.{name} 的 choices 必须是数组")

    inp = c.get("input") or {}
    # args 与 subcommands 允许并存：并存表示「省略 command 就走 args 那套默认调用」，
    # 对应 __main__.py 里手写分发的形态（`sys.argv[1] == "<sub>" … else: main()`，
    # 如 market-trend 的 inject-report / list-categories）。
    check_args(inp.get("args"), "input.args")
    for s in inp.get("subcommands") or []:
        if not isinstance(s, dict) or not s.get("name"):
            errs.append("子命令缺 name")
            continue
        check_args(s.get("args"), f"子命令 {s['name']}")
    return errs


# ─────────────────────────── SKILL.md ───────────────────────────

def read_skill_id(skill_dir: Path) -> str | None:
    """取 frontmatter 的 name（与 skill-service.ts::scan() 同口径），缺失则用目录名。"""
    f = skill_dir / "SKILL.md"
    if not f.is_file():
        return None
    raw = f.read_text(encoding="utf-8", errors="replace")
    m = re.match(r"^---\r?\n([\s\S]*?)\r?\n---", raw)
    front = m.group(1) if m else ""
    hit = re.search(r"^[ \t]*name[ \t]*:[ \t]*(.+?)[ \t]*$", front, re.M)
    if not hit:
        return skill_dir.name
    return hit.group(1).strip().strip("\"'") or skill_dir.name


def skill_body(skill_dir: Path) -> str:
    raw = (skill_dir / "SKILL.md").read_text(encoding="utf-8", errors="replace")
    m = re.match(r"^---\r?\n([\s\S]*?)\r?\n---", raw)
    return raw[m.end():] if m else raw


# ─────────────────────────── 入口形态判定（detectEntry 镜像） ───────────────────────────

def resolve_package_dir(skill_dir: Path) -> str | None:
    for entry in sorted(skill_dir.iterdir(), key=lambda p: p.name):
        if entry.is_dir() and (entry / "__main__.py").is_file():
            return entry.name
    return None


def detect_entry(skill_dir: Path, skill_id: str, body: str) -> tuple[str, str | None, str | None]:
    pkg = resolve_package_dir(skill_dir)
    if pkg and (f"-m {pkg}" in body or f"-m {skill_id}" in body):
        return "package", pkg, None
    m = SCRIPT_CALL_RE.search(body)
    if m and (skill_dir / m.group(1)).is_file():
        return "script", None, m.group(1)
    return "instructions", None, None


# ─────────────────────────── argparse 抽取 ───────────────────────────

def _const_str(node) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _kw(call: ast.Call, key: str):
    for kw in call.keywords:
        if kw.arg == key:
            return kw.value
    return None


def _is_argparser_call(f) -> bool:
    """`argparse.ArgumentParser(...)` / `SkillArgumentParser(...)` 这类构造调用。"""
    if isinstance(f, ast.Name):
        return f.id.endswith("ArgumentParser")
    if isinstance(f, ast.Attribute):
        return f.attr.endswith("ArgumentParser")
    return False


def _is_suppress(node) -> bool:
    """`argparse.SUPPRESS` / `SUPPRESS`：argparse 里表示「不要出现在 namespace 里」。"""
    if isinstance(node, ast.Attribute) and node.attr == "SUPPRESS":
        return True
    return isinstance(node, ast.Name) and node.id == "SUPPRESS"


def _parse_add_argument(call: ast.Call) -> dict | None:
    if not call.args:
        return None
    raw_name = _const_str(call.args[0])
    if not raw_name:
        return None

    action = _const_str(_kw(call, "action")) or ""
    if action in ("help", "version"):
        return None

    positional = not raw_name.startswith("-")
    dest = _const_str(_kw(call, "dest"))
    name = dest or (raw_name if positional else raw_name.lstrip("-").replace("-", "_"))
    if not ARGNAME_RE.match(name):
        return None

    arg: dict = {"name": name}
    if positional:
        arg["positional"] = True
    elif raw_name != f"--{name}":
        # 短选项（-k）或带连字符的 flag（--max-pages）必须原样保留
        arg["flag"] = raw_name

    # type
    tkw = _kw(call, "type")
    if isinstance(tkw, ast.Name) and tkw.id == "int":
        arg["type"] = "integer"
    elif isinstance(tkw, ast.Name) and tkw.id == "float":
        arg["type"] = "number"
    elif tkw is not None:
        arg["type"] = "string"

    if action in ("store_true", "store_false"):
        arg["type"] = "boolean"
    elif action == "count":
        arg["type"] = "integer"
    elif action == "append":
        arg["type"] = "array"

    # nargs
    nkw = _kw(call, "nargs")
    nargs = _const_str(nkw)
    if nargs is None and isinstance(nkw, ast.Attribute) and nkw.attr == "REMAINDER":
        nargs = "REMAINDER"
    if nargs in ("+", "*", "REMAINDER"):
        arg["type"] = "array"
    if nargs in ("+", "*", "?"):
        arg["nargs"] = nargs

    # required
    rkw = _kw(call, "required")
    if isinstance(rkw, ast.Constant) and isinstance(rkw.value, bool):
        required = rkw.value
    elif positional:
        required = nargs in (None, "+", "REMAINDER")
    else:
        required = False
    if required:
        arg["required"] = True

    # choices
    ckw = _kw(call, "choices")
    if isinstance(ckw, (ast.List, ast.Tuple, ast.Set)):
        vals = [v.value for v in ckw.elts
                if isinstance(v, ast.Constant) and isinstance(v.value, (str, int, float))]
        if vals:
            arg["choices"] = [str(v) for v in vals]
        else:
            # 动态 choices（变量引用）→ 交给脚本自己校验，不写进契约
            pass

    # default / SUPPRESS
    dkw = _kw(call, "default")
    if dkw is not None:
        if _is_suppress(dkw):
            arg["hidden"] = True
        elif isinstance(dkw, ast.Constant) and isinstance(dkw.value, (str, int, float, bool)):
            arg["default"] = dkw.value

    # help → description（SUPPRESS 同样视为隐藏）
    hkw = _kw(call, "help")
    if hkw is not None:
        if _is_suppress(hkw):
            arg["hidden"] = True
        else:
            help_text = _const_str(hkw)
            if help_text:
                arg["description"] = re.sub(r"\s+", " ", help_text).strip()[:MAX_HELP_LEN]

    return arg


class _ArgCollector(ast.NodeVisitor):
    """收集一个文件里的 argparse 结构：顶层参数 + 子命令参数分组。

    ``self.scopes`` 是作用域栈（name → 子命令名）。子命令 parser 通常写成
    ``p = sub.add_parser("trend")`` 再 ``p.add_argument(...)``，
    因此按作用域解析变量名才能把参数挂到正确的子命令上。

    另有第二种写法（``__main__.py`` 手写分发）：每个子命令一个独立函数，
    函数里自建 ``ArgumentParser(prog="<pkg> <sub>")``，参数直接加在该 parser 上。
    这类靠 ``prog`` 的第二段识别（见 ``resolve_subcommands()``）。
    """

    def __init__(self) -> None:
        self.scopes: list[dict[str, str]] = [{}]
        self.subs: dict[str, dict] = {}
        self.order: list[str] = []
        self.has_subparsers = False
        # 顶层参数按「函数作用域」分桶。同一个文件里可能有多套互不相干的 parser
        # （如 market-trend 的 parse_args() 与 inject_report()/list_categories() 各建一个 parser），
        # 混成一堆会撞重名，必须靠桶把它们分开。
        self.arg_buckets: list[tuple[str, list[dict]]] = [("<module>", [])]
        self.current = self.arg_buckets[0][1]
        # id(桶) → 子命令名。命中说明该桶是「手写分发的子命令」而非顶层默认调用。
        self.bucket_sub: dict[int, str] = {}

    def _buckets_of_root(self) -> list[tuple[str, list[dict]]]:
        return [(n, b) for n, b in self.arg_buckets if id(b) not in self.bucket_sub]

    def resolve_root_args(self) -> tuple[list[dict], list[tuple[str, int]]]:
        """返回 (顶层参数, 被丢弃的其它 parser 作用域)。

        正常情况一个文件只有一套 parser，各桶并集即可。
        出现重名说明是多套 parser 并存，取参数最多的那套，其余丢弃并报出。
        """
        buckets = self._buckets_of_root()
        names = [a["name"] for _, bucket in buckets for a in bucket]
        if len(names) == len(set(names)):
            return [a for _, bucket in buckets for a in bucket], []
        best_name, best = max(buckets, key=lambda kv: len(kv[1]))
        dropped = [(n, len(b)) for n, b in buckets if b is not best and b]
        return best, dropped

    def resolve_subcommands(self) -> list[dict]:
        """手写分发的子命令：函数里自建 parser 且 ``prog="<pkg> <sub>"``。"""
        out: list[dict] = []
        index: dict[str, dict] = {}
        for _, bucket in self.arg_buckets:
            sub = self.bucket_sub.get(id(bucket))
            if not sub or not bucket:
                continue
            if sub in index:
                index[sub]["args"].extend(bucket)
                continue
            entry = {"name": sub, "description": None, "args": list(bucket)}
            index[sub] = entry
            out.append(entry)
        return out

    # ── 作用域 ──
    def visit_FunctionDef(self, node):  # noqa: N802
        self.scopes.append({})
        prev = self.current
        bucket: list[dict] = []
        # 桶只增不减：遍历结束后 resolve_root_args() 还要按桶取用
        self.arg_buckets.append((node.name, bucket))
        self.current = bucket
        for stmt in node.body:
            self.visit(stmt)
        self.current = prev
        self.scopes.pop()

    def visit_AsyncFunctionDef(self, node):  # noqa: N802
        self.visit_FunctionDef(node)

    def _lookup(self, owner: str) -> str | None:
        names = [owner]
        if "." in owner:
            names.append(owner.split(".")[-1])
        for scope in reversed(self.scopes):
            for n in names:
                if n in scope:
                    return scope[n]
        return None

    def _bind(self, target, value) -> None:
        if not isinstance(target, ast.Name) or not isinstance(value, ast.Call):
            return
        f = value.func
        if not isinstance(f, ast.Attribute):
            return
        if f.attr == "add_subparsers":
            self.has_subparsers = True
            return
        if f.attr == "add_parser":
            sub = _const_str(value.args[0]) if value.args else None
            if not sub:
                return
            desc = _const_str(_kw(value, "help")) or _const_str(_kw(value, "description"))
            if sub not in self.subs:
                self.subs[sub] = {"name": sub, "description": desc, "args": []}
                self.order.append(sub)
            self.scopes[-1][target.id] = sub

    def visit_Assign(self, node):  # noqa: N802
        for t in node.targets:
            self._bind(t, node.value)
        self.generic_visit(node)

    def visit_AnnAssign(self, node):  # noqa: N802
        if node.value is not None:
            self._bind(node.target, node.value)
        self.generic_visit(node)

    def visit_Call(self, node):  # noqa: N802
        f = node.func
        if isinstance(f, ast.Attribute) and f.attr == "add_argument":
            spec = _parse_add_argument(node)
            if spec:
                sub = self._lookup(ast.unparse(f.value))
                if sub:
                    self.subs[sub]["args"].append(spec)
                else:
                    self.current.append(spec)
        elif _is_argparser_call(f):
            self._mark_hand_written_subcommand(node)
        self.generic_visit(node)

    def _mark_hand_written_subcommand(self, call: ast.Call) -> None:
        """``ArgumentParser(prog="<pkg> <sub>")`` → 当前函数桶是手写分发的子命令。"""
        prog = _const_str(_kw(call, "prog"))
        if not prog:
            return
        parts = prog.split()
        if len(parts) < 2:
            return
        self.bucket_sub[id(self.current)] = parts[1]


def collect_file(path: Path) -> _ArgCollector | None:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"), filename=str(path))
    except SyntaxError as e:
        print(f"  ! 语法错误，跳过 {path}: {e}", file=sys.stderr)
        return None
    c = _ArgCollector()
    c.visit(tree)
    return c


def has_args(c: _ArgCollector) -> bool:
    return (c.has_subparsers or bool(c.resolve_root_args()[0])
            or any(s["args"] for s in c.subs.values())
            or bool(c.resolve_subcommands()))


# ─────────────────── 找「真正的入口文件」（包入口时结构分散在多个模块） ───────────────────

def _local_import_targets(path: Path, pkg_dir: Path, pkg: str) -> list[Path]:
    """从 path 里解析出「本包内」可能含入口定义的候选文件（按源码顺序）。"""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
    except SyntaxError:
        return []
    out: list[Path] = []
    for node in ast.walk(tree):
        mods: list[str] = []
        names: list[str] = []
        if isinstance(node, ast.ImportFrom):
            if node.level == 0:
                mods = [node.module or ""]
            else:
                mods = ["." * node.level + (node.module or "")]
            names = [a.name for a in node.names]
        elif isinstance(node, ast.Import):
            mods = [a.name for a in node.names]
        else:
            continue
        for mod in mods:
            rel = mod.lstrip(".")
            if rel == pkg:
                rel = ""
            elif rel.startswith(pkg + "."):
                rel = rel[len(pkg) + 1:]
            elif not mod.startswith("."):
                continue
            parts = [p for p in rel.split(".") if p]
            cands: list[Path] = []
            if parts:
                cands.append(pkg_dir.joinpath(*parts).with_suffix(".py"))
                cands.append(pkg_dir.joinpath(*parts) / "__init__.py")
            else:
                cands.append(pkg_dir / "__init__.py")
            # `from .cli import main` 里的 main 也可能是模块
            for nm in names:
                cands.append(pkg_dir.joinpath(*parts, f"{nm}.py"))
                cands.append(pkg_dir.joinpath(*parts, nm) / "__init__.py")
            for cand in cands:
                if cand.is_file() and cand not in out:
                    out.append(cand)
    return out


def find_entry_file(start: Path, pkg_dir: Path, pkg: str, fallback_dir: Path) -> Path | None:
    """BFS 跟随本包内 import，返回第一个真正含 argparse 定义的文件。"""
    seen: set[Path] = set()
    queue: list[tuple[Path, int]] = [(start, 0)]
    while queue:
        path, depth = queue.pop(0)
        if path in seen:
            continue
        seen.add(path)
        c = collect_file(path)
        if c and has_args(c):
            return path
        if depth >= MAX_IMPORT_DEPTH:
            continue
        base = pkg_dir if pkg_dir in path.parents else fallback_dir
        for nxt in _local_import_targets(path, base, pkg):
            if nxt not in seen:
                queue.append((nxt, depth + 1))
    return None


def collect_skill_args(skill_dir: Path, form: str, pkg: str | None, script: str | None) -> _ArgCollector:
    """按入口形态找到「入口文件」，只从它抽参数，避免把辅助脚本的参数混进来。"""
    empty = _ArgCollector()

    if form == "package" and pkg:
        pkg_dir = skill_dir / pkg
        main_py = pkg_dir / "__main__.py"
        found = find_entry_file(main_py, pkg_dir, pkg, pkg_dir)
        if found:
            return collect_file(found) or empty
        # 兜底：整个包里参数最多的那个文件
        best, best_n = None, 0
        for py in pkg_dir.rglob("*.py"):
            if "__pycache__" in py.parts:
                continue
            c = collect_file(py)
            if not c:
                continue
            n = (len(c.resolve_root_args()[0])
                 + sum(len(s["args"]) for s in c.subs.values())
                 + sum(len(s["args"]) for s in c.resolve_subcommands()))
            if n > best_n:
                best, best_n = c, n
        return best or empty

    if form == "script" and script:
        target = skill_dir / script
        found = find_entry_file(target, skill_dir, skill_dir.name, skill_dir)
        if found:
            return collect_file(found) or empty
        return empty

    return empty


# ─────────────────────────── 组装契约 ───────────────────────────

def build_contract(skill_id: str, form: str, pkg: str | None, script: str | None,
                   col: _ArgCollector) -> tuple[dict, list[str]]:
    warnings: list[str] = []
    c: dict = {"schema": SCHEMA, "id": skill_id}
    entry: dict = {"form": form}
    if form == "package":
        entry["pkg"] = pkg
    elif form == "script":
        entry["script"] = script.replace("\\", "/")
    c["entry"] = entry

    if form == "instructions":
        # 无可执行入口：正文原样交给模型，没有 argv 可传
        c["output"] = {"protocol": "instructions"}
        return c, warnings

    subs = [col.subs[n] for n in col.order]
    for extra in col.resolve_subcommands():
        if not any(s["name"] == extra["name"] for s in subs):
            subs.append(extra)
    root_args, dropped = col.resolve_root_args()
    for scope_name, n in dropped:
        warnings.append(f"同一文件里有多套 parser，丢弃 {scope_name}() 的 {n} 个参数（取参数最多的那套）")
    # 顶层参数与子命令可以并存：并存表示「省略 command 就走顶层参数那套默认调用」，
    # 对应 __main__.py 手写分发里 `sys.argv[1] == "<sub>" … else: main()` 的形态。
    inp: dict = {}
    if root_args:
        inp["args"] = root_args
    if subs:
        inp["subcommands"] = [
            {k: v for k, v in {"name": s["name"], "description": s["description"],
                               "args": s["args"] or None}.items() if v is not None}
            for s in subs
        ]
    if inp:
        c["input"] = inp

    c["output"] = {
        "protocol": "dsagent-result",
        "resultPrefix": RESULT_PREFIX,
        "filesMarker": FILES_MARKER,
    }
    return c, warnings


# ─────────────────────────── 主流程 ───────────────────────────

def default_root() -> Path:
    # 本脚本位于 <project>/plugins/dsagent-plugin/dev/ → <project>/skills
    return Path(__file__).resolve().parents[3] / "skills"


def main() -> int:
    ap = argparse.ArgumentParser(description="批量生成技能 contract.json")
    ap.add_argument("--root", default=str(default_root()), help="技能根目录（默认 <project>/skills）")
    ap.add_argument("--write", action="store_true", help="真正写入 contract.json（默认干跑）")
    ap.add_argument("--only", default="", help="只处理这些技能 id（逗号分隔）")
    ap.add_argument("--show", default="", help="打印该技能的契约 JSON 后退出")
    ap.add_argument("--check", action="store_true", help="只校验已存在的 contract.json")
    args = ap.parse_args()

    root = Path(args.root)
    if not root.is_dir():
        print(f"技能根目录不存在：{root}", file=sys.stderr)
        return 2

    only = {s.strip() for s in args.only.split(",") if s.strip()}

    if args.check:
        bad = 0
        total = 0
        for d in sorted(root.iterdir()):
            f = d / CONTRACT_FILE
            if not f.is_file():
                continue
            total += 1
            cid = read_skill_id(d)
            try:
                obj = json.loads(f.read_text(encoding="utf-8"))
            except json.JSONDecodeError as e:
                print(f"[FAIL] {d.name}: JSON 解析失败 {e}")
                bad += 1
                continue
            errs = validate_contract(obj)
            if cid and obj.get("id") != cid:
                errs.append(f"契约 id={obj.get('id')} 与 SKILL.md name={cid} 不一致")
            if errs:
                print(f"[FAIL] {d.name}: {'；'.join(errs)}")
                bad += 1
        print(f"校验完成：{total} 个契约，{bad} 个不合法")
        return 1 if bad else 0

    stats = {"package": 0, "script": 0, "instructions": 0}
    wrote = 0
    skipped = 0
    rows: list[tuple[str, str, str]] = []

    for d in sorted(root.iterdir()):
        if not d.is_dir():
            continue
        skill_id = read_skill_id(d)
        if skill_id is None:
            continue
        if only and skill_id not in only:
            continue

        body = skill_body(d)
        form, pkg, script = detect_entry(d, skill_id, body)
        col = collect_skill_args(d, form, pkg, script)
        contract, warns = build_contract(skill_id, form, pkg, script, col)

        errs = validate_contract(contract)
        if errs:
            print(f"[FAIL] {skill_id}: {'；'.join(errs)}", file=sys.stderr)
            continue

        tool = "dsagent_" + re.sub(r"^_+|_+$", "", re.sub(r"[^A-Za-z0-9]+", "_", skill_id)).lower()
        reserved = tool in RESERVED_TOOL_NAMES
        n_args = len((contract.get("input") or {}).get("args") or [])
        n_sub = len((contract.get("input") or {}).get("subcommands") or [])
        # 只有能产出真实 argv 的技能才写契约。参数表为空的独立工具对模型是纯噪声，
        # 这类技能留在 dsagent_execute_skill + 系统提示词清单那条路径上，信息量更大。
        keep = bool(n_args or n_sub)
        stats[form] += 1
        if keep:
            rows.append((skill_id, form, tool))
        else:
            skipped += 1

        detail = f"{n_sub} 个子命令" if n_sub else (f"{n_args} 个参数" if n_args else "无参数")
        if not keep:
            flag = " [无输入，不生成契约 → 走 dsagent_execute_skill + 提示词清单]"
        elif reserved:
            flag = " [原生工具优先，契约不会被注册]"
        else:
            flag = ""
        print(f"{skill_id:36s} {form:12s} {detail}{flag}", *[f"\n    ! {w}" for w in warns])

        if args.show and args.show == skill_id:
            print(json.dumps(contract, ensure_ascii=False, indent=2))

        if args.write:
            target = d / CONTRACT_FILE
            if keep:
                target.write_text(json.dumps(contract, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                wrote += 1
            elif target.is_file():
                # 入口形态变了（如 package → instructions）会留下过期契约，清掉
                target.unlink()
                print(f"    - 删除过期契约 {target}")

    print()
    print(f"入口形态：package={stats['package']} script={stats['script']} instructions={stats['instructions']}")
    if args.write:
        print(f"已写入：{wrote} 个契约；跳过（无输入）：{skipped} 个技能")
    else:
        print(f"干跑（加 --write 落盘）：将写入 {len(rows)} 个契约，跳过（无输入）{skipped} 个技能")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
