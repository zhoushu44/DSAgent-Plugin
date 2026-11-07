# -*- coding: utf-8 -*-
"""属性区 0 字段时明确报错，不要假成功"""
from pathlib import Path

f = Path(r'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\skills\pdd-publish-http\scripts\publish-flow.mjs')
s = f.read_text(encoding='utf-8')

# 找必填复核那段
OLD = '''    const reqFields = fields.filter(f => f.required)
    const reqMissing = []
    for (const f of reqFields) {
      const st = await checkFieldFilled(page, f.id)
      if (!st.filled) reqMissing.push(f.name)
    }
    log(`  ★必填项 ${reqFields.length} 个：${reqFields.map(f => f.name).join('、')}`)'''

NEW = '''    const reqFields = fields.filter(f => f.required)
    // ★ 2026-11-03：字段数为 0 = 类目没选对 / 页面没加载，必须报错
    //   实测手机壳：属性区 0 字段 → 「必填项 0 个」→ 假成功 → 提交被平台拦
    if (!fields.length) {
      const curUrl = await page.evaluate(() => location.href).catch(() => '')
      missed.push('商品属性（属性区 0 字段，类目可能未选对）')
      log(`  ❌ 属性区 0 字段！当前 URL: ${String(curUrl).slice(0, 80)}`)
      log(`     可能原因：① 类目未选对 ② 页面未加载完 ③ 该类目无需属性`)
      // 抛出让上层知道，但不中断整个批次
      throw new Error('属性区 0 字段')
    }
    const reqMissing = []
    for (const f of reqFields) {
      const st = await checkFieldFilled(page, f.id)
      if (!st.filled) reqMissing.push(f.name)
    }
    log(`  ★必填项 ${reqFields.length} 个：${reqFields.map(f => f.name).join('、')}`)'''

if OLD in s:
    s = s.replace(OLD, NEW, 1)
    print('OK: 属性区 0 字段改为报错')
else:
    print('NOT FOUND')
    i = s.find('const reqFields = fields.filter')
    if i > 0:
        print(repr(s[i:i+400]))

f.write_text(s, encoding='utf-8')
