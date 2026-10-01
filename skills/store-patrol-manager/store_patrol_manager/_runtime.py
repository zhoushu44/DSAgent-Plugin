"""DeepSeek Agent workspace runtime 引导；技能脱离已安装工作区时拒绝运行。"""
from __future__ import annotations

import sys
from pathlib import Path

_PACKAGE_ROOT = Path(__file__).resolve().parent.parent


def _ensure_bootstrap_importable() -> None:
    cwd = Path.cwd().resolve()
    candidates = (cwd, *cwd.parents, _PACKAGE_ROOT, *_PACKAGE_ROOT.parents)
    for candidate in candidates:
        if (candidate / "skill.json").is_file():
            root = candidate
            break
        if candidate.name == "skills" and candidate.parent.is_dir():
            root = candidate.parent
            break
    else:
        raise RuntimeError("未找到 DeepSeek Agent 智能体 workspace；本技能不能脱离已安装工作区运行")
    runtime = root / ".dsagent" / "runtime"
    if not runtime.is_dir():
        raise RuntimeError(f"未找到 DeepSeek Agent workspace runtime: {runtime}")
    path = str(runtime)
    if path not in sys.path:
        sys.path.insert(0, path)


def skill_root() -> Path:
    return _PACKAGE_ROOT


def read_skill_slug() -> str:
    _ensure_bootstrap_importable()
    from skill_bootstrap import read_skill_slug as _read_skill_slug
    return _read_skill_slug(_PACKAGE_ROOT)


def workspace_root() -> Path:
    _ensure_bootstrap_importable()
    from skill_bootstrap import workspace_root as _workspace_root
    return Path(_workspace_root())


def find_workspace(start: str | Path = ".") -> Path:
    del start
    return workspace_root()


def require_dsagent_runtime() -> None:
    workspace_root()
    read_skill_slug()


# 兼容旧调用名
require_qiwork_runtime = require_dsagent_runtime


# --------------------------------------------------------------------------- #
# 运行时符号延迟转发
#
# 白名单符号一律走模块级 `__getattr__`（PEP 562）按需解析，模块导入本身不
# 触碰 runtime。这一点是必须的：本技能在工作区外启动时，任何顶层
# `from skill_bootstrap import ...` 都会让 `import store_patrol_manager` 直接炸成
# ModuleNotFoundError，宿主连 `require_dsagent_runtime()` 的提示都看不到。
# --------------------------------------------------------------------------- #

_LOCAL = frozenset({"read_skill_slug", "workspace_root", "require_dsagent_runtime", "find_workspace"})


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
