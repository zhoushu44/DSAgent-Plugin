/**
 * SKU 组件 · ② 价格表（极简通用版）
 *
 * ★★ 核心（2026-10-30 用户点醒：SKU 最简单）★★
 *
 *   表格结构（真机实测）：
 *     thead: [型号][颜色][*库存][*拼单价][*单买价][*预览图][规格编码][状态]
 *     tbody 每行：颜色列用 rowspan 合并，所以同一型号的 2 行里只有第 1 行有「型号」td
 *
 *   但**每行的 input 数量是一样的**：每行有 3 个 text input（库存/拼单价/单买价）
 *   + 可能 1 个 file input（预览图）。
 *
 *   所以最简单可靠的做法：
 *     ✓ 遍历 tbody 的每个 tr（顺序 = SKU 顺序）
 *     ✓ 取该 tr 里的 text input（排除 file）
 *     ✓ 第 0 个填库存、第 1 个填拼单价、第 2 个填单买价
 *
 *   不需要：
 *     ✗ 列索引（rowspan 会错位）
 *     ✗ window.__pddSkuCols helper（没装就全废）
 *     ✗ 行文本匹配（同色行文本重复）
 */
import { jsClick, jsBlur, sleep } from './spec-dims.mjs'

/** 找 SKU 表（含「拼单价」表头的 table） */
async function findSkuTable(page) {
  return page.evaluate(() => {
    const tb = [...document.querySelectorAll('table')].find(t => /拼单价/.test(t.textContent || ''))
    if (!tb) return null
    const heads = [...tb.querySelectorAll('thead th')].map(th => th.textContent.trim())
    return { heads, rows: tb.querySelectorAll('tbody tr').length }
  }).catch(() => null)
}

/**
 * 在指定行的第 ord 个 text input 里填值
 * @param ord 0=库存 1=拼单价 2=单买价
 */
async function setCell(page, rowIdx, ord, value) {
  const v = String(value ?? '')

  // ★ 2026-10-30 真机 dump：表头顺序是 [容量, 库存, 拼单价, 单买价, 预览图, 规格编码, 状态]
  //   input 顺序是 [容量, 库存, 拼单价, 单买价]（4 个 text input）
  //   所以**库存是 inputs[1]，不是 inputs[0]**！之前按 0/1/2 索引全错位。
  //   这里 ord 的含义：1=库存 2=拼单价 3=单买价（与 input 索引一致）

  // ① JS setter（快）
  const jsOk = await page.evaluate((ri, o, val) => {
    const tb = [...document.querySelectorAll('table')].find(t => /拼单价/.test(t.textContent || ''))
    const tr = [...(tb?.querySelectorAll('tbody tr') || [])][ri]
    if (!tr) return false
    const inputs = [...tr.querySelectorAll('input')].filter(i => i.type !== 'file')
    const el = inputs[o]
    if (!el) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (!setter) return false
    setter.call(el, val)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new Event('blur', { bubbles: true }))
    return true
  }, rowIdx, ord, v).catch(() => false)
  await sleep(180)

  const readBack = () => page.evaluate((ri, o) => {
    const tb = [...document.querySelectorAll('table')].find(t => /拼单价/.test(t.textContent || ''))
    const tr = [...(tb?.querySelectorAll('tbody tr') || [])][ri]
    if (!tr) return ''
    const inputs = [...tr.querySelectorAll('input')].filter(i => i.type !== 'file')
    return inputs[o]?.value || ''
  }, rowIdx, ord).catch(() => '')

  let back = await readBack()
  if (String(back).trim() === v) return { ok: true, via: 'js', back }

  // ② 键盘兜底（真实事件）
  const pos = await page.evaluate((ri, o) => {
    const tb = [...document.querySelectorAll('table')].find(t => /拼单价/.test(t.textContent || ''))
    const tr = [...(tb?.querySelectorAll('tbody tr') || [])][ri]
    if (!tr) return null
    tr.scrollIntoView({ block: 'center' })
    const inputs = [...tr.querySelectorAll('input')].filter(i => i.type !== 'file')
    const el = inputs[o]
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width < 5) return null
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }, rowIdx, ord).catch(() => null)
  if (!pos) return { ok: false, via: 'no-pos', back }

  await sleep(250)
  await jsClick(page, pos.x, pos.y)
  await sleep(180)
  await page.keyboard.down('Control').catch(() => {})
  await page.keyboard.press('KeyA').catch(() => {})
  await page.keyboard.up('Control').catch(() => {})
  await page.keyboard.press('Backspace').catch(() => {})
  await sleep(80)
  await page.keyboard.type(v, { delay: 35 }).catch(() => {})
  await sleep(150)
  await page.keyboard.press('Enter').catch(() => {})
  await sleep(400)

  back = await readBack()
  return { ok: String(back).trim() === v, via: 'keyboard', back }
}

/**
 * 填价格表（库存 + 拼单价 + 单买价）
 *
 * @param opts {
 *   price: 默认拼单价,
 *   stock: 默认库存,
 *   rows:  [{ price, stock, single }] 每行覆盖值（按 SKU 顺序）
 * }
 * @returns { rows, filled, missed: [], detail }
 */
export async function fillPriceTable(page, opts = {}) {
  const defPrice = String(opts.price || '29.9')
  const defStock = String(opts.stock || '100')   // ★ 2026-10-30 用户定：每个 SKU 默认库存 100
  const rowOverrides = opts.rows || []

  // ★ 2026-10-30：等 SKU 表出现（规格填完后表格是异步生成的）
  //   判定：存在含「拼单价」表头且 tbody 有行的 table
  let info = null
  for (let w = 0; w < 20; w++) {
    info = await findSkuTable(page)
    if (info && info.rows > 0) break
    await sleep(1000)
  }
  if (!info || !info.rows) {
    return { rows: 0, filled: 0, missed: ['价格表（30s 内 SKU 表未出现）'], detail: [] }
  }

  const filled = []
  const missed = []
  const detail = []

  // ★ 2026-10-30 真机实测：平台会**按「值 + 单位」去重**，
  //   比如 250ml 和 350ml 都是 mL → 合并成 1 行。
  //   所以**实际行数可能 < 传入的 skus 数量**，必须按实际行数填，不能硬凑。
  const actualRows = info.rows
  if (actualRows !== rowOverrides.length) {
    console.log(`[sku-table] 注意：实际行数 ${actualRows} ≠ 传入 SKU 数 ${rowOverrides.length}（平台按值+单位去重）`)
  }

  for (let ri = 0; ri < actualRows; ri++) {
    const ov = rowOverrides[ri] || rowOverrides[rowOverrides.length - 1] || {}
    const rowPrice = String(ov.price || defPrice)
    // ★ 单买价 = 该行拼单价 + 1；平台要求严格 >1 元，取 +1.01（两位小数）
    const pNum = parseFloat(rowPrice) || 0
    const rowSingle = ov.single ? String(ov.single) : (Math.round((pNum + 1.01) * 100) / 100).toFixed(2)
    const rowStock = String(ov.stock || defStock)

    const cells = []
    // ★ 2026-10-30 真机 dump 定论（这是最终结论，不要再改）：
    //   表头: [容量, *库存, *拼单价(元), *单买价(元), *预览图, 规格编码, 状态]
    //   每行 input 数组（排除 file）:
    //     inputs[0] = 库存（空）
    //     inputs[1] = 拼单价
    //     inputs[2] = 单买价
    //     inputs[3] = 规格编码（不填）
    //   容量列是纯文本，不是 input。
    console.log(`[sku-table] 第 ${ri + 1}/${actualRows} 行：库存=${rowStock} 拼单价=${rowPrice} 单买价=${rowSingle}`)
    for (const [name, inputIdx, val] of [
      ['库存', 0, rowStock],
      ['拼单价', 1, rowPrice],
      ['单买价', 2, rowSingle],
    ]) {
      // ★ 2026-10-30：如果该格**已有值**，跳过不覆盖（用于属性后补填新行场景）
      const existing = await page.evaluate((rowIdx, ii) => {
        const tb = [...document.querySelectorAll('table')].find(t => /拼单价/.test(t.textContent || ''))
        const tr = [...(tb?.querySelectorAll('tbody tr') || [])][rowIdx]
        if (!tr) return null
        const inputs = [...tr.querySelectorAll('input')].filter(i => i.type !== 'file')
        return inputs[ii]?.value || ''
      }, ri, inputIdx).catch(() => '')

      if (String(existing || '').trim() === String(val)) {
        filled.push(`第${ri + 1}行${name}=${val}（已有）`)
        cells.push({ name, inputIdx, want: val, back: existing, ok: true, via: 'skip-existing' })
        continue
      }

      const r = await setCell(page, ri, inputIdx, val)
      if (r.ok) filled.push(`第${ri + 1}行${name}=${val}`)
      else missed.push(`第${ri + 1}行${name}（${r.via}）`)
      cells.push({ name, inputIdx, want: val, back: r.back, ok: r.ok, via: r.via })
      if (!r.ok) console.log(`[sku-table]   ${name} 失败：via=${r.via} back="${r.back}"`)
    }
    detail.push({ row: ri, cells })
  }

  return { rows: info.rows, filled, missed, detail }
}

/**
 * 读价格表当前快照（校验用）
 */
export async function readPriceSnapshot(page) {
  return page.evaluate(() => {
    const tb = [...document.querySelectorAll('table')].find(t => /拼单价/.test(t.textContent || ''))
    if (!tb) return []
    return [...tb.querySelectorAll('tbody tr')].map((tr, ri) => {
      const inputs = [...tr.querySelectorAll('input')].filter(i => i.type !== 'file')
      return {
        row: ri,
        stock: inputs[0]?.value || '',
        price: inputs[1]?.value || '',
        single: inputs[2]?.value || '',
      }
    })
  }).catch(() => [])
}

/**
 * 填参考价
 */
export async function fillRefPrice(page, refPrice) {
  const v = String(refPrice || '')
  if (!v) return false

  const scrolled = await page.evaluate(() => {
    let inp = [...document.querySelectorAll('input')].find(e => /大于/.test(e.placeholder || ''))
    if (!inp) return false
    inp.scrollIntoView({ block: 'center' })
    window.__refInp = inp
    return true
  }).catch(() => false)
  if (!scrolled) return false
  await sleep(800)

  const pos = await page.evaluate(() => {
    const inp = window.__refInp
    if (!inp || !inp.isConnected) return null
    const r = inp.getBoundingClientRect()
    if (r.width < 20 || r.y < 0) return null
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }).catch(() => null)
  if (!pos) return false

  await jsClick(page, pos.x, pos.y)
  await sleep(400)
  await page.keyboard.down('Control').catch(() => {})
  await page.keyboard.press('KeyA').catch(() => {})
  await page.keyboard.up('Control').catch(() => {})
  await page.keyboard.press('Backspace').catch(() => {})
  await page.keyboard.type(v, { delay: 45 }).catch(() => {})
  await sleep(300)
  await page.keyboard.press('Enter').catch(() => {})
  await sleep(600)
  await jsBlur(page)

  const back = await page.evaluate(() => window.__refInp?.value || '').catch(() => '')
  return String(back).trim() === v || String(back).includes(v)
}
