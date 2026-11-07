# -*- coding: utf-8 -*-
"""
修：属性填写后 SKU 表长出新的行，库存/价格没补填

实测睡衣：
  [sku-table] 实际行数 5 ≠ 传入 SKU 数 9
  [sku-thumb] 表格 10 行 → 成功 10 行      ← 属性填写后变成 10 行
  提交报错：请输入第6行规格的库存            ← 第 6-10 行没库存价格

修法：属性填完后，再跑一次 fillPriceTable（幂等，已有值会跳过）
"""
from pathlib import Path

f = Path(r'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\skills\pdd-publish-http\scripts\publish-flow.mjs')
s = f.read_text(encoding='utf-8')

# 找属性阶段结束的位置（"发货售后 →" 之前），插入补填
OLD = """  // ⑤ 发货与售后
  try {
    const r = await fillShippingAndFreight(page, {"""

NEW = """  // ⑤ ★ 2026-11-03：属性填完后 SKU 表可能长出新的行（级联），补填一次价格库存
  //   实测睡衣：填属性前 5 行，属性后变 10 行 → 第 6-10 行没库存 → 提交被拦
  try {
    const before = await page.evaluate(() => {
      const tb = [...document.querySelectorAll('table')].find(t => /拼单价/.test(t.innerText || ''))
      return tb ? tb.querySelectorAll('tbody tr').length : 0
    }).catch(() => 0)
    if (before > 0) {
      const { fillPriceTable } = await import('./sku-table.mjs')
      const r2 = await fillPriceTable(page, {
        price: String(product.price || '').replace(/[^\\d.]/g, '') || undefined,
        stock,
        rows: skus,
      })
      if (r2.filled?.length) {
        for (const x of r2.filled) if (!filled.includes(x)) filled.push(x)
      }
      if (r2.missed?.length) log(`  [补] 价格库存未填 ${r2.missed.length} 项`)
      log(`  [补] 属性后补填价格库存：${before} 行 → 已填 ${r2.filled?.length || 0} 项`)
    }
  } catch (e) {
    log(`  [补] 价格库存补填异常：${e.message.slice(0, 60)}`)
  }

  // ⑥ 发货与售后
  try {
    const r = await fillShippingAndFreight(page, {"""

if OLD in s:
    s = s.replace(OLD, NEW, 1)
    print('OK: 属性后补填价格库存')
else:
    print('NOT FOUND')
    i = s.find('// ⑤ 发货与售后')
    print('anchor:', repr(s[i:i+120]) if i > 0 else 'not found')

f.write_text(s, encoding='utf-8')
