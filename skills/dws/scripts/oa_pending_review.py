#!/usr/bin/env python3
"""
查看待我审批列表 + 逐条显示详情（自动时间戳计算）

用法:
    python oa_pending_review.py                # 最近 7 天
    python oa_pending_review.py --days 30      # 最近 30 天
    python oa_pending_review.py --dry-run
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


def to_iso(dt: datetime) -> str:
    return dt.strftime('%Y-%m-%dT%H:%M:%S+08:00')


def main():
    parser = argparse.ArgumentParser(
        description='查看待我审批列表'
    )
    parser.add_argument(
        '--days', type=int, default=7, help='查询天数 (默认 7)'
    )
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    now = datetime.now()
    start = now - timedelta(days=args.days)

    print(f"📋 查询待审批 (最近 {args.days} 天)...")
    data = run_dws([
        'oa', 'approval', 'list-pending',
        '--start', to_iso(start),
        '--end', to_iso(now),
        '--format', 'json',
    ], dry_run=args.dry_run)

    if args.dry_run:
        run_dws([
            'oa', 'approval', 'detail',
            '--instance-id', '<INSTANCE_ID>',
            '--format', 'json',
        ], dry_run=True)
        return

    if not data:
        print('未查到待审批')
        return

    if isinstance(data, list):
        instances = data
    elif isinstance(data, dict):
        inner = data.get('result', data)
        if isinstance(inner, dict):
            instances = inner.get('processInstanceList',
                                  inner.get('items', []))
        elif isinstance(inner, list):
            instances = inner
        else:
            instances = []
    else:
        instances = []
    if not instances:
        print('✅ 暂无待审批事项')
        return

    print(f"\n🔔 待审批列表 ({len(instances)} 条)")
    print('=' * 50)

    for i, inst in enumerate(instances, 1):
        if not isinstance(inst, dict):
            print(f"\n  [{i}] {inst}")
            continue
        inst_id = (inst.get('processInstanceId')
                   or inst.get('id', ''))
        title = inst.get('title') or inst.get('name', '无标题')
        status = inst.get('status') or inst.get('result', '')
        create_time = inst.get('createTime', '')
        if isinstance(create_time, (int, float)):
            create_time = datetime.fromtimestamp(
                create_time / 1000
            ).strftime('%Y-%m-%d %H:%M')

        print(f"\n  [{i}] {title}")
        print(f"      状态: {status}  创建: {create_time}")
        print(f"      ID: {inst_id}")

        detail = run_dws([
            'oa', 'approval', 'detail',
            '--instance-id', inst_id,
            '--format', 'json',
        ])
        if detail and isinstance(detail, dict):
            forms = detail.get('formComponentValues', [])
            if forms:
                print(f"      --- 表单内容 ---")
                for f in forms[:5]:
                    name = f.get('name', '')
                    value = f.get('value', '')
                    if value:
                        print(f"      {name}: {value[:60]}")


if __name__ == '__main__':
    main()
