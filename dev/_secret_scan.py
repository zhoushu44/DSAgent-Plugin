#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
系统性扫描 git 全历史里的凭据痕迹。
不依赖已知密钥清单——用模式匹配找所有可疑项。

扫描对象：
  1. 所有提交的所有 blob 内容
  2. 已知密钥服务商的特征串（AKID/SK/TK/ghp_/github_pat_/xoxb 等）
  3. 中文语境下的密码字段（密码/passwd/secret/token/key 赋值）

输出：分类报告，标注每个文件当前是否仍被跟踪。
"""
import json
import re
import subprocess
import sys
from collections import defaultdict

REPO = r"e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin"

# ── 高置信度：已知服务商密钥格式 ──────────────────────────
KNOWN_PATTERNS = [
    (r"AKID[A-Za-z0-9]{16,}", "腾讯云 SecretId"),
    (r"\bSK[A-Za-z0-9]{32,}\b", "可能的 SecretKey"),
    (r"ghp_[A-Za-z0-9]{36}", "GitHub PAT"),
    (r"github_pat_[A-Za-z0-9_]{22,}", "GitHub fine-grained PAT"),
    (r"xox[baprs]-[A-Za-z0-9-]{10,}", "Slack token"),
    (r"AIza[A-Za-z0-9_\-]{35}", "Google API key"),
    (r"sk-[A-Za-z0-9]{32,}", "OpenAI 风格 key"),
    (r"glpat-[A-Za-z0-9_\-]{20}", "GitLab PAT"),
    (r"npm_[A-Za-z0-9]{36}", "npm token"),
    (r"AKIA[A-Z0-9]{16}", "AWS Access Key"),
    (r"(?<![A-Za-z0-9])t8ZcCdqc[A-Za-z0-9]{10,}", "NewAPI key"),
]

# ── 中置信度：赋值语句里的敏感字段 ────────────────────────
ASSIGN_PATTERNS = [
    (r"(?i)(secret|passwd|password|token|api_?key|access_?key|secret_?key)\s*[:=]\s*['\"][^'\"]{12,}['\"]", "硬编码敏感字段"),
    (r"(?i)cookie\s*[:=]\s*['\"][^'\"]{20,}['\"]", "硬编码 Cookie"),
]


def run(args, timeout=300):
    p = subprocess.run(args, cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=timeout)
    return p.stdout, p.returncode


def tracked_files():
    out, _ = run(["git", "ls-files"])
    return set(x for x in out.splitlines() if x)


def main():
    print("取全历史 blob 清单 ...", file=sys.stderr)
    # 所有提交出现过的 (blob, path)
    out, rc = run(["git", "log", "--all", "--pretty=format:%H",
                   "--name-only", "--no-renames"])
    commits = []
    cur = None
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        if len(line) == 40 and re.fullmatch(r"[0-9a-f]{40}", line):
            cur = line
            commits.append(cur)
        # path 暂不用，下面用 git grep 直接查内容

    print(f"提交数: {len(commits)}", file=sys.stderr)

    findings = defaultdict(lambda: {"commits": set(), "samples": set()})
    scanned = 0

    # 逐提交用 git grep 扫（避免把 60MB 全读进内存）
    for i, c in enumerate(commits):
        scanned += 1
        if scanned % 20 == 0:
            print(f"  扫描 {scanned}/{len(commits)}", file=sys.stderr)
        for pat, label in KNOWN_PATTERNS + ASSIGN_PATTERNS:
            try:
                o, _ = run(["git", "grep", "-I", "-n", "-E", "-i", pat, c, "--"])
            except subprocess.TimeoutExpired:
                continue
            for line in o.splitlines():
                if not line.strip():
                    continue
                # 形如 <blob>:<path>:<lineno>:<content>
                parts = line.split(":", 3)
                if len(parts) < 4:
                    continue
                path = parts[1]
                content = parts[3].strip()
                # 脱敏：只留前 60 字符
                findings[(path, label)]["commits"].add(c)
                if len(findings[(path, label)]["samples"]) < 2:
                    findings[(path, label)]["samples"].add(content[:60])

    print(f"\n共扫描 {scanned} 个提交", file=sys.stderr)

    tf = tracked_files()
    rows = []
    for (path, label), v in findings.items():
        rows.append({
            "file": path,
            "type": label,
            "commit_count": len(v["commits"]),
            "still_tracked": path in tf,
            "sample": sorted(v["samples"]),
        })

    rows.sort(key=lambda r: (not r["still_tracked"], -r["commit_count"]))

    report = {
        "repo": REPO,
        "commits_scanned": scanned,
        "total_findings": len(rows),
        "still_tracked": [r for r in rows if r["still_tracked"]],
        "history_only": [r for r in rows if not r["still_tracked"]],
    }
    outpath = r"e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\dev\_secret-scan-report.json"
    with open(outpath, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*70}")
    print(f"发现 {len(rows)} 处可疑痕迹")
    print(f"仍被跟踪: {len(report['still_tracked'])} 处")
    print(f"仅存在于历史: {len(report['history_only'])} 处")
    print(f"{'='*70}")
    for r in report["still_tracked"]:
        print(f"\n[仍跟踪] {r['file']}")
        print(f"  类型: {r['type']}  出现在 {r['commit_count']} 个提交")
        for s in r["sample"]:
            print(f"  样本: {s}")
    if report["history_only"]:
        print(f"\n--- 仅历史存在（已不在当前树，但 blob 仍在对象库）---")
        for r in report["history_only"][:25]:
            print(f"  {r['file']}  [{r['type']}]  {r['commit_count']} commits")
    print(f"\n报告: {outpath}")


if __name__ == "__main__":
    main()
