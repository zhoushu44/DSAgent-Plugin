# -*- coding: utf-8 -*-
"""货号只接受纯 ASCII（在 publish-flow.mjs 的 userMap 处）"""
from pathlib import Path

f = Path(r'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\skills\pdd-publish-http\scripts\publish-flow.mjs')
s = f.read_text(encoding='utf-8')

OLD = """    const userMap = new Map()
    for (const a of attributes) {
      const n = String(a.name || '').replace(/\\s+/g, '')
      if (n && a.value) userMap.set(n, String(a.value).trim())
    }"""

NEW = """    const userMap = new Map()
    for (const a of attributes) {
      const n = String(a.name || '').replace(/\\s+/g, '')
      if (n && a.value) userMap.set(n, String(a.value).trim())
    }
    // ★ 2026-11-03：货号只接受纯 ASCII（字母数字-_）
    //   实测睡衣：basic.propertys.7.value 货号被填成「MHJ-拼接袖莫代尔套装」
    //   → 平台报「商品货号格式不正确」，提交被拦
    for (const [k, v] of [...userMap]) {
      if (/货号|商品编码/.test(k)) {
        const ascii = String(v).replace(/[^A-Za-z0-9_\\-]/g, '')
        if (ascii) userMap.set(k, ascii)
        else userMap.delete(k)
      }
    }"""

if OLD in s:
    s = s.replace(OLD, NEW, 1)
    print('OK: 货号 ASCII 过滤已加')
else:
    print('NOT FOUND')
    i = s.find('const userMap = new Map()')
    print(repr(s[i:i + 260]) if i > 0 else 'no userMap')

f.write_text(s, encoding='utf-8')
