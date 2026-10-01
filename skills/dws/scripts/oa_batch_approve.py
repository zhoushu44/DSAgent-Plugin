#!/usr/bin/env python3
"""
批量同意/拒绝待审批项（含安全确认）

用法:
    python oa_batch_approve.py --action approve --days 7
    python oa_batch_approve.py --action reject --remark "不符合要求"
    python oa_batch_approve.py --action approve --instance-ids id1,id2
    python oa_batch_approve.py --dry-run --action approve
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
        return {'dry_run': True}
    try:
        result = _run_no_pipe(cmd, timeout=60)
        if result.returncode != 0:
            print(f"  ✗ 错误：{result.stderr.strip()}")
            return None
        return json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError,
            FileNotFoundError) as e:
        print(f"  ✗ 错误：{e}")
        return None


def to_iso(dt: datetime) -> str:
    return dt.strftime('%Y-%m-%dT%H:%M:%S+08:00')


def main():
    parser = argparse.ArgumentParser(
        description='批量同意/拒绝审批'
    )
    parser.add_argument(
        '--action', required=True,
        choices=['approve', 'reject'], help='审批动作',
    )
    parser.add_argument(
        '--remark', default='', help='审批意见'
    )
    parser.add_argument('--days', type=int, default=7)
    parser.add_argument('--instance-ids', default='')
    parser.add_argument(
        '--yes', action='store_true', help='跳过确认'
    )
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    instance_ids: List[str] = []
    if args.instance_ids:
        instance_ids = [x.strip() for x in
                        args.instance_ids.split(',') if x.strip()]
    else:
        now = datetime.now()
        start = now - timedelta(days=args.days)
        data = run_dws([
            'oa', 'approval', 'list-pending',
            '--start', to_iso(start),
            '--end', to_iso(now),
            '--format', 'json',
        ], dry_run=args.dry_run)
        if not args.dry_run and data:
            if isinstance(data, list):
                items = data
            elif isinstance(data, dict):
                inner = data.get('result', data)
                if isinstance(inner, dict):
                    items = inner.get('processInstanceList',
                                      inner.get('items', []))
                elif isinstance(inner, list):
                    items = inner
                else:
                    items = []
            else:
                items = []
            instance_ids = [
                item.get('processInstanceId') or item.get('id')
                for item in items
                if isinstance(item, dict)
                and (item.get('processInstanceId') or item.get('id'))
            ]

    if not instance_ids and not args.dry_run:
        print('✅ 没有待处理的审批')
        return

    action_label = '同意' if args.action == 'approve' else '拒绝'
    count = len(instance_ids) if instance_ids else '?'
    print(f"\n⚠️  即将 {action_label} {count} 条审批")
    if not args.yes and not args.dry_run:
        confirm = input('确认执行？(y/N): ').strip().lower()
        if confirm != 'y':
            print('已取消')
            return

    success, fail = 0, 0
    for i, inst_id in enumerate(instance_ids or ['<INST_ID>'], 1):
        tasks_data = run_dws([
            'oa', 'approval', 'tasks',
            '--instance-id', inst_id,
            '--format', 'json',
        ], dry_run=args.dry_run)

        task_id = None
        if not args.dry_run and tasks_data:
            if isinstance(tasks_data, list):
                task_ids = tasks_data
            elif isinstance(tasks_data, dict):
                inner = tasks_data.get('result', tasks_data)
                if isinstance(inner, dict):
                    task_ids = inner.get('tasks', inner.get('items', []))
                elif isinstance(inner, list):
                    task_ids = inner
                else:
                    task_ids = []
            else:
                task_ids = []
            if task_ids:
                task_id = (task_ids[0] if isinstance(task_ids[0], str)
                           else task_ids[0].get('taskId', ''))

        cmd_args = [
            'oa', 'approval', args.action,
            '--instance-id', inst_id,
            '--task-id', task_id or '<TASK_ID>',
            '--format', 'json',
        ]
        if args.remark:
            cmd_args.extend(['--remark', args.remark])

        result = run_dws(cmd_args, dry_run=args.dry_run)
        if result:
            print(f"  ✓ [{i}/{count}] {inst_id} → {action_label}")
            success += 1
        else:
            print(f"  ✗ [{i}/{count}] {inst_id}")
            fail += 1

    print(f"\n完成: 成功 {success}, 失败 {fail}")


if __name__ == '__main__':
    main()
