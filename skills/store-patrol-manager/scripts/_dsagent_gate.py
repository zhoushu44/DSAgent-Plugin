"""拒绝确定性脚本脱离已安装的 DeepSeek Agent workspace 单独运行。"""
from __future__ import annotations

import sys
from pathlib import Path


def require_dsagent_runtime() -> Path:
    skill_root = Path(__file__).resolve().parent.parent
    skills_dir = skill_root.parent
    workspace = skills_dir.parent
    runtime = workspace / ".dsagent" / "runtime"
    bootstrap = runtime / "skill_bootstrap.py"
    if skills_dir.name != "skills" or not (workspace / "skill.json").is_file() or not bootstrap.is_file():
        raise RuntimeError("巡店管家必须作为已安装技能在 DeepSeek Agent workspace 内运行")
    path = str(runtime)
    if path not in sys.path:
        sys.path.insert(0, path)
    from skill_bootstrap import read_skill_slug
    read_skill_slug(skill_root)
    return workspace


# 兼容旧调用名
require_qiwork_runtime = require_dsagent_runtime
