"""DeepSeek Agent workspace runtime 引导 — 从 {workspace}/.dsagent/runtime 加载。

本模块是技能与宿主之间唯一的耦合点。两条硬约束：

1. **顶层绝不 import skill_bootstrap**。`config.py` 在模块顶层
   `from ._runtime import workspace_root`，一旦此处顶层 import，技能在 workspace
   外被导入时会直接炸 ModuleNotFoundError，宿主拿不到「拒绝运行」的可读提示。
   白名单符号一律走模块级 `__getattr__`（PEP 562）延迟解析。
2. 本技能的万相台客户端（`AlimamaInsightClient` 等）由宿主门面 `platform_client` 提供，
   `skill_bootstrap` 白名单里可能没有，因此 `__getattr__` 需要向门面兜底再查一层。
"""

from __future__ import annotations

import sys
from pathlib import Path

_PACKAGE_ROOT = Path(__file__).resolve().parent.parent

_LOCAL = frozenset({"read_skill_slug", "workspace_root", "require_dsagent_runtime", "find_workspace"})

_NOT_INSTALLED = (
    "未找到 DeepSeek Agent 智能体 workspace：请在 skills/<技能名>/ 下执行，"
    "且上级目录含 skill.json。本技能不能脱离已安装工作区运行。"
)


def _find_workspace_root() -> Path:
    import os as _os

    override = _os.environ.get("DSAGENT_WORKSPACE")
    if override:
        candidate = Path(override).expanduser().resolve()
        if (candidate / "skill.json").is_file():
            return candidate

    cwd = Path.cwd().resolve()
    for candidate in (cwd, *cwd.parents, _PACKAGE_ROOT, *_PACKAGE_ROOT.parents):
        if (candidate / "skill.json").is_file():
            return candidate
        if candidate.name == "skills" and candidate.parent.is_dir():
            return candidate.parent
    raise RuntimeError(_NOT_INSTALLED)


def _ensure_bootstrap_importable() -> None:
    runtime = _find_workspace_root() / ".dsagent" / "runtime"
    if not runtime.is_dir():
        raise RuntimeError(
            f"未找到 DeepSeek Agent workspace runtime: {runtime}\n"
            "请由 DeepSeek Agent 初始化智能体 workspace 后再运行技能。",
        )
    path = str(runtime)
    if path not in sys.path:
        sys.path.insert(0, path)


def skill_root() -> Path:
    return _PACKAGE_ROOT


def find_workspace() -> Path:
    return _find_workspace_root()


def read_skill_slug() -> str:
    _ensure_bootstrap_importable()
    from skill_bootstrap import read_skill_slug as _read_skill_slug

    return _read_skill_slug(_PACKAGE_ROOT)


def workspace_root() -> Path:
    _ensure_bootstrap_importable()
    from skill_bootstrap import workspace_root as _workspace_root

    return Path(_workspace_root())


def require_dsagent_runtime() -> None:
    workspace_root()
    read_skill_slug()


# 兼容旧调用名
require_qiwork_runtime = require_dsagent_runtime


def __getattr__(name: str):
    if name.startswith("__"):
        raise AttributeError(name)
    _ensure_bootstrap_importable()
    try:
        from skill_bootstrap import resolve_export
        return resolve_export(name)
    except (ImportError, AttributeError):
        from platform_client import resolve_export as _resolve_client_export

        return _resolve_client_export(name)


def __dir__() -> list[str]:
    _ensure_bootstrap_importable()
    try:
        from skill_bootstrap import export_names
    except (ImportError, AttributeError):
        from platform_client import export_names as export_names
    from platform_client import export_names as client_export_names

    return sorted({*_LOCAL, *export_names(), *client_export_names()})


__all__ = ["read_skill_slug", "workspace_root", "require_dsagent_runtime", "find_workspace", "skill_root"]
