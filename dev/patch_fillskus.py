#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按行号替换 fillSkus 的 ②~④ 段（2540-2661）为适配新版 SKU 面板 + 尺码弹层的实现。"""
import io

P = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/src/taobao-publish.ts'
lines = io.open(P, encoding='utf-8').read().split('\n')

# 定位：从「── ② 逐个规格值键入」到 fillSkus 结束（return { filled, missed }\n}）
start = None
for i, l in enumerate(lines):
    if '── ② 逐个规格值键入' in l:
        start = i
        break
assert start is not None, 'start not found'

# 找 fillSkus 的结尾：从 start 往后第一个「  return { filled, missed }」且下一行是 '}'
end = None
for i in range(start, len(lines)):
    if lines[i].strip() == 'return { filled, missed }' and i + 1 < len(lines) and lines[i + 1].strip() == '}':
        end = i
        break
assert end is not None, 'end not found'
print('replacing lines', start + 1, 'to', end + 2)

NEW = r'''  // ── ② 逐个规格值键入 + Enter（维度 1 = 规格值来源）──
  //   ★ 多维度关键点：只填维度 1 时页面停在「身高 未选」，SKU 表不生成。
  //     所以维度 1 填完后，其余维度也要各填一个值（否则「必须成套使用」不满足）。
  //
  //   ★★ 写入方式（2026-10 实测，关键）：
  //     React 受控输入框只认真实键盘事件。native setter + dispatchEvent 只改 DOM value，
  //     `Json.models.formValues` 里根本没有 title 这类字段（实测 stateTitle 恒 undefined），
  //     提交校验读的是页面从各处收集的结果，于是报「必填项未填」。
  //     所以这里必须 page.mouse.click 聚焦 + page.keyboard.type 真实键入 + Enter。
  for (const sku of wanted) {
    await page.mouse.move(inputPos.x, inputPos.y).catch(() => { /* 忽略 */ })
    await sleep(200)
    await page.mouse.click(inputPos.x, inputPos.y).catch(() => { /* 忽略 */ })
    await sleep(400)
    await page.keyboard.type(sku.name, { delay: 50 }).catch(() => { /* 忽略 */ })
    await sleep(300)
    // ★ Enter = 确认这个规格值（颜色分类是 tag 式输入，Enter 提交）
    await page.keyboard.press('Enter').catch(() => { /* 忽略 */ })
    await sleep(1200)
  }

  // ── ②b 其余维度：各选一个值，凑齐「成套」条件 ──
  //   ★ 尺码维度不是普通下拉，而是**尺码弹层**（sell-size-sale-props-standard-size-popup）：
  //     点「请选择尺码」→ 弹出含「全选/全不选/确定/取消 + 48cm~185cm」的面板
  //     → 勾目标尺码 → 点「确定」。勾选后 SKU 表才会渲染出来。
  if (dimInputs.length > 1) {
    for (let d = 1; d < dimInputs.length; d++) {
      const dim = dimInputs[d]
      await page.mouse.click(dim.x, dim.y).catch(() => { /* 忽略 */ })
      await sleep(2500)

      // 弹层里勾一个尺码（优先 100cm，没有就第一个数字尺码）
      const picked = await page.evaluate(() => {
        const panel = Array.from(document.querySelectorAll(
          '.sell-size-sale-props-standard-size-popup, .next-overlay-wrapper.opened'))
          .filter(p => p.offsetParent !== null).pop() as HTMLElement | undefined
        if (!panel) return ''
        const items = Array.from(panel.querySelectorAll('label, .next-checkbox-wrapper'))
          .filter(e => e.offsetParent !== null && /^\d+cm$/.test((e.textContent || '').trim())) as HTMLElement[]
        if (!items.length) return ''
        const target = items.find(e => /^100cm$/.test((e.textContent || '').trim())) || items[0]
        const cb = target.querySelector('input[type="checkbox"]') as HTMLInputElement | null
          || (target.tagName === 'LABEL' ? (target.control as HTMLInputElement | null) : null)
        if (cb && !cb.checked) { cb.click(); return (target.textContent || '').trim() }
        if (!cb) { target.click(); return (target.textContent || '').trim() }
        return (target.textContent || '').trim()
      }).catch(() => '') as string
      await sleep(1500)

      // 点「确定」关弹层（不点则勾选不生效）
      const ok = await page.evaluate(() => {
        const panel = Array.from(document.querySelectorAll(
          '.sell-size-sale-props-standard-size-popup, .next-overlay-wrapper.opened'))
          .filter(p => p.offsetParent !== null).pop() as HTMLElement | undefined
        if (!panel) return false
        const btn = Array.from(panel.querySelectorAll('button'))
          .find(b => (b.innerText || '').trim() === '确定' && !b.disabled) as HTMLButtonElement | null
        if (btn) { btn.click(); return true }
        return false
      }).catch(() => false) as boolean

      await sleep(3000)
      console.log(`[dsagent-taobao-publish] 规格维度「${dim.ph}」选值=${picked || '（无候选）'}，确定=${ok}`)
      if (picked && ok) filled.push(`规格维度「${dim.ph}」=${picked}`)
      else missed.push(`规格维度「${dim.ph}」未选到值（勾选=${picked}，确定=${ok}）`)
    }
  }

  // ── ②c 等 SKU 表渲染（新版面板 sell-sku-table-wrapper-new，成套后才出现）──
  let skuReady = false
  for (let i = 0; i < 20; i++) {
    skuReady = await page.evaluate(() => {
      const tbl = document.querySelector('.sell-new-sku-table-content') as HTMLElement | null
      return !!(tbl && tbl.offsetParent !== null)
    }).catch(() => false)
    if (skuReady) break
    await sleep(1000)
  }
  console.log(`[dsagent-taobao-publish] SKU 表渲染=${skuReady}`)

  // ── ③ 回读 SKU 行（新版面板：按「行内有价格/数量输入框」识别）──
  const rows = await page.evaluate(() => {
    const tbl = document.querySelector('.sell-new-sku-table-content') as HTMLElement | null
      || document.getElementById('struct-sku') as HTMLElement | null
    if (!tbl) return []
    const rowEls = Array.from(tbl.querySelectorAll('tr, [class*="row"], [class*="sku-row"]')) as HTMLElement[]
    const out: Array<{ idx: number; color: string; price: string; stock: string }> = []
    for (const row of rowEls) {
      const priceInp = row.querySelector('input[placeholder*="价格"], input[placeholder="价格"]') as HTMLInputElement | null
      const stockInp = row.querySelector('input[placeholder*="数量"], input[placeholder="数量"]') as HTMLInputElement | null
      if (!priceInp && !stockInp) continue
      const colorText = (row.innerText || '').split('\n').map((s: string) => s.trim()).filter(Boolean)[0] || ''
      out.push({ idx: out.length, color: colorText, price: priceInp?.value || '', stock: stockInp?.value || '' })
    }
    return out
  }).catch(() => []) as Array<{ idx: number; color: string; price: string; stock: string }>

  if (!rows.length) {
    missed.push('多规格（规格值已输入但 SKU 表未生成，请在窗口内确认颜色/尺码已成套）')
    return { filled, missed }
  }
  console.log(`[dsagent-taobao-publish] SKU 行 ${rows.length} 条：${rows.map(r => r.color).join(' / ')}`)

  // ── ④ 逐行回填价格 / 数量（真实键入 + Tab）──
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const want = wanted[i] || wanted[0]
    if (!want) continue

    for (const [kind, value] of [['价格', want.price], ['数量', want.stock]] as Array<[string, string | undefined]>) {
      if (!value) continue
      const h = await page.evaluateHandle((idx: number, k: string) => {
        const tbl = document.querySelector('.sell-new-sku-table-content') as HTMLElement | null
          || document.getElementById('struct-sku') as HTMLElement | null
        if (!tbl) return null
        const rowEls = Array.from(tbl.querySelectorAll('tr, [class*="row"], [class*="sku-row"]')) as HTMLElement[]
        const rows = rowEls.filter(r => r.querySelector('input[placeholder*="价格"], input[placeholder="数量"]'))
        const target = rows[idx]
        if (!target) return null
        const inp = target.querySelector(`input[placeholder="${k}"], input[placeholder*="${k}"]`) as HTMLInputElement | null
        if (inp) inp.scrollIntoView({ block: 'center' })
        return inp
      }, i, kind).catch(() => null)
      const el = h && h.asElement ? h.asElement() : null
      if (!el) { missed.push(`${row.color}/${kind}（找不到输入格）`); continue }
      await el.evaluate((e: HTMLElement) => e.focus()).catch(() => { /* 忽略 */ })
      await sleep(200)
      await page.keyboard.down('Control').catch(() => { /* 忽略 */ })
      await page.keyboard.press('KeyA').catch(() => { /* 忽略 */ })
      await page.keyboard.up('Control').catch(() => { /* 忽略 */ })
      await page.keyboard.press('Backspace').catch(() => { /* 忽略 */ })
      await sleep(150)
      await page.keyboard.type(String(value), { delay: 80 }).catch(() => { /* 忽略 */ })
      await sleep(200)
      await page.keyboard.press('Tab').catch(() => { /* 忽略 */ })
      await sleep(SKU_CELL_WAIT_MS)
    }
    filled.push(`${row.color}（价格=${want.price || '—'}，数量=${want.stock || '—'}）`)
  }

  return { filled, missed }
}'''

out = lines[:start] + NEW.split('\n') + lines[end + 2:]
io.open(P, 'w', encoding='utf-8').write('\n'.join(out))
print('done')
