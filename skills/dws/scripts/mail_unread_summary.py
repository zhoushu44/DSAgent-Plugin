#!/usr/bin/env python3
"""
查询今天未读邮件并汇总（自动获取邮箱地址）

用法:
    python mail_unread_summary.py
    python mail_unread_summary.py --size 30
    python mail_unread_summary.py --dry-run
"""

import sys
import json
import subprocess
import argparse
from datetime import datetime, timezone, timedelta
from typing import List, Any, Optional
import os
import tempfile

TZ = timezone(timedelta(hours=8))


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


def unwrap_result(data: Any) -> Any:
    while isinstance(data, dict):
        for key in ('result', 'content', 'data'):
            nested = data.get(key)
            if isinstance(nested, (dict, list)):
                data = nested
                break
        else:
            return data
    return data


def get_my_email(dry_run: bool = False) -> Optional[str]:
    data = run_dws([
        'mail', 'mailbox', 'list', '--format', 'json',
    ], dry_run=dry_run)
    if dry_run:
        return '<MY_EMAIL>'
    if not data:
        return None
    data = unwrap_result(data)
    if isinstance(data, dict) and isinstance(data.get('emailAccounts'), list):
        accounts = data['emailAccounts']
        # 优先企业邮箱(type=ORG)，否则取第一个
        for acc in accounts:
            if isinstance(acc, dict) and acc.get('type') == 'ORG' and acc.get('email'):
                return acc['email']
        if accounts and isinstance(accounts[0], dict):
            return accounts[0].get('email')
        return None
    if isinstance(data, list) and data:
        item = data[0]
        return (item.get('email') or item.get('address')
                if isinstance(item, dict) else str(item))
    if isinstance(data, dict):
        return data.get('email') or data.get('address')
    return None


def main():
    parser = argparse.ArgumentParser(
        description='查询今天未读邮件'
    )
    parser.add_argument(
        '--size', type=int, default=20, help='返回数量'
    )
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    print('📬 获取邮箱地址...')
    email = get_my_email(dry_run=args.dry_run)
    if not email and not args.dry_run:
        print('错误：无法获取邮箱地址')
        sys.exit(1)

    today = datetime.now(TZ).strftime('%Y-%m-%dT00:00:00Z')
    kql = f'isRead:false AND date>{today}'

    print(f'🔍 搜索未读邮件...\n')
    data = run_dws([
        'mail', 'message', 'search',
        '--email', email or '<MY_EMAIL>',
        '--query', kql,
        '--limit', str(args.size),
        '--format', 'json',
    ], dry_run=args.dry_run)

    if args.dry_run:
        return
    if not data:
        print('未查到邮件')
        return

    data = unwrap_result(data)
    messages = (data if isinstance(data, list)
                else data.get('items', data.get('messages', [])))

    print(f"📧 今日未读邮件")
    print('=' * 50)
    if not messages:
        print('  ✅ 收件箱清空，没有未读邮件！')
        return

    for m in messages:
        subj = m.get('subject', '(无主题)')
        sender = m.get('from', {})
        sender_name = (sender.get('name') or sender.get('email', '未知')
                       if isinstance(sender, dict) else str(sender))
        print(f"  📩 {subj}")
        print(f"     发件人: {sender_name}")

    print(f"\n合计: {len(messages)} 封未读邮件")


if __name__ == '__main__':
    main()
