#!/usr/bin/env python3
"""
查看我今天/本周/指定日期的考勤记录（自动获取 userId）

用法:
    python attendance_my_record.py               # 今天
    python attendance_my_record.py today          # 今天
    python attendance_my_record.py 2026-03-10     # 指定日期
    python attendance_my_record.py --dry-run      # 仅显示命令
"""

import sys
import json
import subprocess
import re
from datetime import datetime
from typing import List, Any, Optional
import os
import tempfile

DATE_PATTERN = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def _run_no_pipe(
    cmd: list[str], timeout: int | None = None, text: bool = True,
) -> subprocess.CompletedProcess:
    """受限沙箱（DSH workspace-write）禁止创建匿名管道，
    因此不能用 capture_output=True；改为临时文件承接子进程 stdout/stderr，语义等价。"""
    if text:
        out_f = tempfile.NamedTemporaryFile(mode="w", suffix=".out", delete=False, encoding="utf-8", errors="replace", newline="")
        err_f = tempfile.NamedTemporaryFile(mode="w", suffix=".err", delete=False, encoding="utf-8", errors="replace", newline="")
    else:
        out_f = tempfile.NamedTemporaryFile(mode="wb", suffix=".out", delete=False)
        err_f = tempfile.NamedTemporaryFile(mode="wb", suffix=".err", delete=False)
    paths = (out_f.name, err_f.name)
    try:
        try:
            proc = subprocess.run(cmd, stdout=out_f, stderr=err_f, timeout=timeout)
        finally:
            out_f.close()
            err_f.close()
        if text:
            with open(paths[0], encoding="utf-8", errors="replace") as f:
                out = f.read()
            with open(paths[1], encoding="utf-8", errors="replace") as f:
                err = f.read()
        else:
            with open(paths[0], "rb") as f:
                out = f.read()
            with open(paths[1], "rb") as f:
                err = f.read()
        return subprocess.CompletedProcess(cmd, proc.returncode, out, err)
    finally:
        for p in paths:
            try:
                os.unlink(p)
            except OSError:
                pass


def run_dws(
    args: List[str], dry_run: bool = False,
) -> Optional[Any]:
    cmd = ['dws'] + args
    if dry_run:
        print(f"[dry-run] {' '.join(cmd)}")
        return None
    try:
        result = _run_no_pipe(cmd, timeout=60)
        if result.returncode != 0:
            print(f"错误：{result.stderr.strip()}", file=sys.stderr)
            return None
        return json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError,
            FileNotFoundError) as e:
        print(f"错误：{e}", file=sys.stderr)
        return None


def get_my_user_id(dry_run: bool = False) -> Optional[str]:
    data = run_dws([
        'contact', 'user', 'get-self', '--format', 'json',
    ], dry_run=dry_run)
    if dry_run:
        return '<MY_USER_ID>'
    if not data or not isinstance(data, dict):
        return None
    # 兼容两种结构:
    # 1) 顶层直接给 userId
    # 2) {result: [{orgEmployeeModel: {userId}}]} 包裹
    uid = data.get('userId') or data.get('userid')
    if uid:
        return uid
    inner = data.get('result')
    if isinstance(inner, dict):
        inner = [inner]
    if isinstance(inner, list):
        for item in inner:
            if not isinstance(item, dict):
                continue
            emp = item.get('orgEmployeeModel')
            if isinstance(emp, dict) and emp.get('userId'):
                return emp['userId']
            if item.get('userId'):
                return item['userId']
    return None


def main():
    dry_run = '--dry-run' in sys.argv
    args = [a for a in sys.argv[1:] if a != '--dry-run']

    date_str = args[0] if args else 'today'
    if date_str == 'today':
        date_str = datetime.now().strftime('%Y-%m-%d')
    elif not DATE_PATTERN.match(date_str):
        print(__doc__)
        sys.exit(1)

    print('🔍 获取当前用户信息...')
    user_id = get_my_user_id(dry_run=dry_run)
    if not user_id and not dry_run:
        print('错误：无法获取当前用户 ID')
        sys.exit(1)

    print(f'📊 查询 {date_str} 考勤记录...\n')
    data = run_dws([
        'attendance', 'record', 'get',
        '--user', user_id or '<MY_USER_ID>',
        '--date', date_str,
        '--format', 'json',
    ], dry_run=dry_run)

    if dry_run:
        return
    if not data:
        print('未查到考勤记录')
        return

    print(f"📋 考勤记录 ({date_str})")
    print('=' * 40)
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
