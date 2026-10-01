#!/usr/bin/env python3
"""
查询团队成员本周排班和出勤统计

用法:
    python attendance_team_shift.py --users userId1,userId2,userId3
    python attendance_team_shift.py --users userId1,userId2 \
        --from 2026-03-10 --to 2026-03-14
    python attendance_team_shift.py --users userId1 --dry-run
"""

import sys
import json
import subprocess
import argparse
from datetime import datetime, timedelta
from typing import List, Any, Optional
import os
import tempfile


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


def get_week_range():
    today = datetime.now()
    monday = today - timedelta(days=today.weekday())
    friday = monday + timedelta(days=4)
    return monday.strftime('%Y-%m-%d'), friday.strftime('%Y-%m-%d')


def main():
    parser = argparse.ArgumentParser(
        description='查询团队成员排班和出勤统计'
    )
    parser.add_argument(
        '--users', required=True, help='用户 ID 列表，逗号分隔'
    )
    mon, fri = get_week_range()
    parser.add_argument('--from', dest='from_date', default=mon)
    parser.add_argument('--to', dest='to_date', default=fri)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    user_count = len(args.users.split(','))
    if user_count > 50:
        print('错误：最多查询 50 人')
        sys.exit(1)

    print(f"📊 团队排班查询 ({args.from_date} ~ {args.to_date})")
    print(f"   人数: {user_count}")
    print('=' * 50)

    print('\n🔍 查询排班信息...')
    data = run_dws([
        'attendance', 'shift', 'list',
        '--users', args.users,
        '--start', args.from_date,
        '--end', args.to_date,
        '--format', 'json',
    ], dry_run=args.dry_run)

    if args.dry_run:
        return
    if not data:
        print('未查到排班信息')
        return

    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
