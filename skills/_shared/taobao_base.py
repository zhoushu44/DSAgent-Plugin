"""taobao_base.py —— 淘宝基座 Python 客户端（跨技能共用）

Python 技能进程拿不到 Cookie（网关强制 include_cookie=false），无法自签 mtop。
本模块把请求交给 Node 桥 `skills/_shared/run-api.mjs`，由 Node 侧读凭证库发请求。

用法：
    from taobao_base import TaobaoBase

    base = TaobaoBase()                      # 自动定位插件根
    r = base.call("item.detail", {"id": "652576134064"})
    if r["ok"]:
        data = r["results"][0]["data"]

    # 自定义 data（搜索接口的 {appId, params} 两层结构）
    r = base.call("search.list", data_json=json.dumps({...}))

    # 批量
    r = base.batch("item.detail", ["123", "456"])
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Sequence


class TaobaoBaseError(RuntimeError):
    pass


def _find_node() -> str:
    for name in ("node", "node.exe"):
        p = shutil.which(name)
        if p:
            return p
    return ""


def _plugin_root() -> Path:
    """定位插件根（含 skills/_shared/run-api.mjs 与 lib/）。

    本文件在 skills/_shared/ 下，上溯 2 层即是插件根；
    但也可能被复制到别处，所以做向上探测。
    """
    env = os.environ.get("PLUGIN_ROOT", "").strip()
    if env and (Path(env) / "skills" / "_shared" / "run-api.mjs").is_file():
        return Path(env)
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "skills" / "_shared" / "run-api.mjs").is_file():
            return parent
    for parent in here.parents:
        if (parent / "run-api.mjs").is_file() and (parent.parent / "lib").is_dir():
            return parent.parent
    return here.parents[2] if len(here.parents) >= 3 else here.parent


class TaobaoBase:
    """淘宝基座调用封装。"""

    def __init__(self, *, account: str = "", timeout: int = 900):
        self.account = (account or "").strip()
        self.timeout = timeout
        self.plugin_root = _plugin_root()
        self.runner = self.plugin_root / "skills" / "_shared" / "run-api.mjs"
        self.node = _find_node()

    # ── 内部 ───────────────────────────────────────────────
    def _run(self, args: list[str]) -> dict[str, Any]:
        if not self.node:
            return {"ok": False, "error": "找不到 node 可执行文件，基座不可用"}
        if not self.runner.is_file():
            return {"ok": False, "error": f"找不到基座桥: {self.runner}"}

        cmd = [self.node, str(self.runner), *args]
        if self.account:
            cmd += ["--account", self.account]

        env = dict(os.environ)
        env.setdefault("PLUGIN_ROOT", str(self.plugin_root))

        try:
            proc = subprocess.run(
                cmd,
                cwd=str(self.plugin_root),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=self.timeout,
                env=env,
            )
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": f"基座调用超时（>{self.timeout}s）"}

        out = (proc.stdout or "").strip()
        if not out:
            err = (proc.stderr or "").strip()[-500:]
            return {"ok": False, "error": err or "基座无输出"}
        try:
            return json.loads(out)
        except json.JSONDecodeError:
            return {"ok": False, "error": f"基座输出非 JSON: {out[:300]}"}

    # ── 公开 API ───────────────────────────────────────────
    def call(
        self,
        api_name: str,
        params: dict[str, Any] | None = None,
        *,
        data_json: str = "",
        ignore_risk: bool = False,
        ignore_throttle: bool = False,
    ) -> dict[str, Any]:
        """调一个注册表接口。返回 {ok, results:[{ok,ms,data,failureKind,hint}]}"""
        args = ["--api", api_name, "--params", json.dumps(params or {}, ensure_ascii=False)]
        if data_json:
            args += ["--data", data_json]
        if ignore_risk:
            args.append("--ignore-risk")
        if ignore_throttle:
            args.append("--ignore-throttle")
        return self._run(args)

    def batch(self, api_name: str, ids: Sequence[str]) -> dict[str, Any]:
        """批量按 id 调同一接口（串行，命中风控即停）。"""
        return self._run(["--batch", api_name, "--ids", ",".join(str(i) for i in ids)])

    # ── 便捷：直接拿 data ──────────────────────────────────
    def call_data(self, api_name: str, params: dict[str, Any] | None = None, **kw) -> Any:
        r = self.call(api_name, params, **kw)
        if not r.get("ok"):
            raise TaobaoBaseError(
                f"{api_name} 失败: {r.get('failureKind') or r.get('error')} / {r.get('hint', '')}"
            )
        results = r.get("results") or []
        return results[0].get("data") if results else None

    def is_available(self) -> tuple[bool, str]:
        if not self.node:
            return False, "找不到 node"
        if not self.runner.is_file():
            return False, f"找不到基座桥 {self.runner}"
        return True, "ok"
