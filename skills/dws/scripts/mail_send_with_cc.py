#!/usr/bin/env python3
"""
发送带抄送的邮件（自动获取发件地址、校验参数）

用法:
    python mail_send_with_cc.py \
        --to colleague@company.com \
        --cc boss@company.com,team@company.com \
        --subject "周报" \
        --body "本周完成任务A和任务B"

    python mail_send_with_cc.py --dry-run \
        --to a@b.com --subject "test" --body "hello"
"""

import sys
import json
import subprocess
import re
import argparse
from typing import List, Any, Optional
import os
import tempfile

EMAIL_PATTERN = re.compile(
    r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$'
)


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
            print(f"错误：{result.stderr.strip()}", file=sys.stderr)
            return None
        return json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError,
            FileNotFoundError) as e:
        print(f"错误：{e}", file=sys.stderr)
        return None


def validate_emails(emails_str: str) -> bool:
    for email in emails_str.split(','):
        email = email.strip()
        if not EMAIL_PATTERN.match(email):
            print(f"错误：无效邮箱地址 '{email}'")
            return False
    return True


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
        description='发送带抄送的邮件'
    )
    parser.add_argument('--to', required=True, help='收件人')
    parser.add_argument('--cc', default='', help='抄送人')
    parser.add_argument('--subject', required=True, help='标题')
    parser.add_argument('--body', required=True, help='正文')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    if not validate_emails(args.to):
        sys.exit(1)
    if args.cc and not validate_emails(args.cc):
        sys.exit(1)

    print('📬 获取发件邮箱...')
    from_email = get_my_email(dry_run=args.dry_run)
    if not from_email and not args.dry_run:
        print('错误：无法获取发件邮箱')
        sys.exit(1)

    cmd_args = [
        'mail', 'message', 'send',
        '--from', from_email or '<MY_EMAIL>',
        '--to', args.to,
        '--subject', args.subject,
        '--content', args.body,
        '--format', 'json',
    ]
    if args.cc:
        cmd_args.extend(['--cc', args.cc])

    print('📤 发送邮件...')
    result = run_dws(cmd_args, dry_run=args.dry_run)
    if result:
        print(f"  ✓ 邮件已发送")
        print(f"    收件人: {args.to}")
        if args.cc:
            print(f"    抄送: {args.cc}")
        print(f"    主题: {args.subject}")
    else:
        print('  ✗ 发送失败')
        sys.exit(1)


if __name__ == '__main__':
    main()
