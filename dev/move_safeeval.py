# -*- coding: utf-8 -*-
"""把 safeEval 定义挪到 selectCategory 开头（原来在后面，前面用它报错）"""
from pathlib import Path

f = Path(r'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\skills\pdd-publish-http\scripts\stage-nav.mjs')
s = f.read_text(encoding='utf-8')

# ① 取出 safeEval 定义块
SAFE_START = "  // ★ 2026-10-30：页面跳转时 frame 会失效（detached Frame）。"
SAFE_END = "    return null\n  }\n"
i = s.find(SAFE_START)
if i < 0:
    print('NOT FOUND safeEval start')
    raise SystemExit(1)

# 找结束：从 i 开始，找 "    return null\n  }\n" 第一次出现
j = s.find(SAFE_END, i)
if j < 0:
    print('NOT FOUND safeEval end')
    raise SystemExit(1)

safe_block = s[i:j + len(SAFE_END)]
# 从原位置删除
s = s[:i] + s[j + len(SAFE_END):]

# ② 插到 selectCategory 的 log 之后
ANCHOR = '''export async function selectCategory(page, category, opts = {}) {
  const log = opts.log || (() => {})
  const kw = String(category || '').trim()
  log(`段2 选类目: ${kw}`)
'''
if ANCHOR not in s:
    print('NOT FOUND anchor')
    raise SystemExit(1)

s = s.replace(ANCHOR, ANCHOR + '\n' + safe_block, 1)

f.write_text(s, encoding='utf-8')
print('OK: safeEval 已挪到 selectCategory 开头')
