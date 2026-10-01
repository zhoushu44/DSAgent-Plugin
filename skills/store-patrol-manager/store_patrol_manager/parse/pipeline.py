"""调用技能内唯一事实脚本，避免模型重复解析大原始文件。"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

from .._runtime import skill_root


def _run(script: str, args: list[str]) -> tuple[int, str]:
    path = skill_root() / "scripts" / script
    # 注：不能使用 capture_output=True（内部走匿名管道 CreatePipe）。
    # 受限沙箱（DSH workspace-write）禁止创建匿名管道，会报 WinError 5
    # 并要求提权。改为把子进程 stdout/stderr 重定向到临时文件，语义等价。
    out_path = None
    err_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".out", delete=False, encoding="utf-8", newline=""
        ) as out_f, tempfile.NamedTemporaryFile(
            mode="w", suffix=".err", delete=False, encoding="utf-8", newline=""
        ) as err_f:
            out_path, err_path = out_f.name, err_f.name
            completed = subprocess.run(
                [sys.executable, str(path), *args], check=False,
                stdout=out_f, stderr=err_f,
            )
        with open(out_path, encoding="utf-8", errors="replace") as f:
            stdout_text = f.read()
        with open(err_path, encoding="utf-8", errors="replace") as f:
            stderr_text = f.read()
        return completed.returncode, (stderr_text or stdout_text).strip()
    finally:
        for p in (out_path, err_path):
            if p and os.path.exists(p):
                os.unlink(p)


def prepare(args: list[str]) -> tuple[int, str]:
    return _run("prepare_run.py", args)


def aggregate(args: list[str]) -> tuple[int, str]:
    return _run("aggregate_store.py", args)


def validate(args: list[str]) -> tuple[int, str]:
    return _run("validate_evidence.py", args)
