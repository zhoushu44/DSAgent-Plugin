/**
 * step12.mjs — 步骤 12：价格及库存
 *
 * ★ 合并单元格（颜色跨行 rowspan）会让 td 索引偏移
 *   → 页面内按 rowspan/colspan 推算「逻辑列号」，再按表头语义定位。
 *
 * 表头（女装）：0=颜色分类 1=尺码 2=*库存 3=*拼单价 4=*单买价 5=*预览图 6=规格编码 7=状态
 * 表头（纸杯）：0=容量 1=*库存 2=*拼单价 3=*单买价 4=*预览图 5=规格编码 6=状态
 */

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 仅本文件内用：把表头映射成语义列号 */
function colsOf(heads) {
  const col = (...kws) => { for (const k of kws) { const i = heads.findIndex(h => h.includes(k)); if (i >= 0) return i } return -1 }
  return { stock: col('库存'), multi: col('拼单价'), price: col('单买价'), sn: col('规格编码'), outSn: col('商品编码'), status: col('状态') }
}

export async function readSkuTable(page) {
  return page.evaluate(() => {
    /* ── 网格化（内联，避免 eval/Function） ── */
    const root = document.querySelector('#sku')
    if (!root) return { found: false, rows: [] }
    const trs = [...root.querySelectorAll('tbody tr')]
    const pending = new Map()
    const grid = []
    for (const tr of trs) {
      const tds = [...tr.querySelectorAll('td')]
      const map = new Map()
      let col = 0, ti = 0, guard = 0
      while (guard++ < 200) {
        const p = pending.get(col)
        if (p && p.left > 0) { map.set(col, p.td); p.left--; col++; continue }
        if (ti >= tds.length) break
        const td = tds[ti++]
        const cs = td.colSpan || 1
        const rs = td.rowSpan || 1
        for (let k = 0; k < cs; k++) {
          map.set(col + k, td)
          if (rs > 1) pending.set(col + k, { td, left: rs - 1 })
        }
        col += cs
      }
      grid.push(map)
    }

    const heads = [...root.querySelectorAll('th')].map(e => (e.innerText || '').replace(/\s+/g, '').trim())
    const pick = (...kws) => { for (const k of kws) { const i = heads.findIndex(h => h.includes(k)); if (i >= 0) return i } return -1 }
    const C = { stock: pick('库存'), multi: pick('拼单价'), price: pick('单买价'), sn: pick('规格编码'), outSn: pick('商品编码'), status: pick('状态') }

    const hasSpecColR = heads.some(h => /颜色分类|尺码|鞋码|容量|款式|尺寸/.test(h))
    const val = (ri, c) => {
      if (c < 0) return ''
      // ★ 无规格类目（无规格列）→ 直接用 td 索引
      const td = hasSpecColR ? grid[ri]?.get(c) : trs[ri]?.querySelectorAll('td')[c]
      if (!td) return ''
      const inp = [...td.querySelectorAll('input')].find(e => ['text', 'number', ''].includes((e.type || 'text').toLowerCase()))
      return inp ? inp.value : (td.innerText || '').trim()
    }

    // ★ 调试：记录每行的 td 数与逻辑列映射
    const debug = {
      heads,
      cols: C,
      rows: trs.map((tr, i) => ({
        i,
        tdCount: tr.querySelectorAll('td').length,
        spans: [...tr.querySelectorAll('td')].map(td => `${td.rowSpan || 1}`).join(','),
        mapped: grid[i] ? [...grid[i].keys()].join(',') : '',
      })),
    }

    const rows = trs.map((tr, i) => ({
      i,
      spec: (grid[i].get(0)?.innerText || '').replace(/\s+/g, ' ').trim(),
      quantity: val(i, C.stock),
      multiPrice: val(i, C.multi),
      price: val(i, C.price),
      skuSn: val(i, C.sn),
      outSn: val(i, C.outSn),
      enabled: C.status >= 0 ? /已启用/.test(grid[i].get(C.status)?.innerText || '') : null,
    }))
    return { found: true, heads, cols: C, rowCount: rows.length, rows, debug }
  }).catch(e => ({ found: false, rows: [], error: String(e.message).slice(0, 150) }))
}

/**
 * @param {object} opts
 * @param {Array} opts.rows  每行 { quantity, multiPrice, price, skuSn }
 * @param {string[]} [opts.thumbs] 每行 SKU 预览图
 */
export async function step12_fillSkuPrices(page, opts = {}) {
  const rows = Array.isArray(opts.rows) ? opts.rows : []
  const result = { ok: false, before: 0, after: 0, filled: 0, errors: [] }
  if (!rows.length) { result.errors.push('rows 为空'); return result }

  const before = await readSkuTable(page)
  if (!before.found) { result.errors.push('找不到 #sku 价格库存表: ' + (before.error || '')); return result }
  result.before = before.rowCount
  if (before.rowCount === 0) { result.errors.push('表格没有 SKU 行（需先完成步骤 11）'); return result }
  if (rows.length > before.rowCount) { result.errors.push(`传了 ${rows.length} 行，页面只有 ${before.rowCount} 行`); return result }

  const writeRes = await page.evaluate((rowsData) => {
    const root = document.querySelector('#sku')
    if (!root) return { ok: false, reason: '找不到 #sku' }
    const trs = [...root.querySelectorAll('tbody tr')]
    const pending = new Map()
    const grid = []
    for (const tr of trs) {
      const tds = [...tr.querySelectorAll('td')]
      const map = new Map()
      let col = 0, ti = 0, guard = 0
      while (guard++ < 200) {
        const p = pending.get(col)
        if (p && p.left > 0) { map.set(col, p.td); p.left--; col++; continue }
        if (ti >= tds.length) break
        const td = tds[ti++]
        const cs = td.colSpan || 1
        const rs = td.rowSpan || 1
        for (let k = 0; k < cs; k++) {
          map.set(col + k, td)
          if (rs > 1) pending.set(col + k, { td, left: rs - 1 })
        }
        col += cs
      }
      grid.push(map)
    }

    const heads = [...root.querySelectorAll('th')].map(e => (e.innerText || '').replace(/\s+/g, '').trim())
    const pick = (...kws) => { for (const k of kws) { const i = heads.findIndex(h => h.includes(k)); if (i >= 0) return i } return -1 }
    const C = { stock: pick('库存'), multi: pick('拼单价'), price: pick('单买价'), sn: pick('规格编码') }

    // ★ 无规格类目：表头没有规格列，td 索引 = 表头索引，不需要 rowspan 推算
    const hasSpecCol = heads.some(h => /颜色分类|尺码|鞋码|容量|款式|尺寸/.test(h))
    const directMode = !hasSpecCol

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set

    const setCol = (ri, c, val) => {
      if (c < 0 || val === undefined || val === null || val === '') return false
      // ★ 无规格：直接用 td 索引
      let td
      if (directMode) {
        td = trs[ri]?.querySelectorAll('td')[c]
      } else {
        td = grid[ri]?.get(c)
      }
      if (!td) return false
      const inp = [...td.querySelectorAll('input')].find(e => ['text', 'number', ''].includes((e.type || 'text').toLowerCase()))
      if (!inp) return false
      inp.focus()
      if (setter) setter.call(inp, String(val)); else inp.value = String(val)
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      inp.dispatchEvent(new Event('change', { bubbles: true }))
      inp.dispatchEvent(new Event('blur', { bubbles: true }))
      return true
    }

    const done = []
    for (let i = 0; i < rowsData.length; i++) {
      const r = rowsData[i]
      if (!trs[i]) { done.push({ i, ok: false, reason: '行不存在' }); continue }
      const acts = []
      acts.push(['stock', setCol(i, C.stock, r.quantity)])
      acts.push(['multi', setCol(i, C.multi, r.multiPrice)])
      acts.push(['price', setCol(i, C.price, r.price)])
      if (r.skuSn) acts.push(['sn', setCol(i, C.sn, r.skuSn)])
      done.push({ i, ok: acts.every(a => a[1]), acts })
    }
    return { ok: true, cols: C, done }
  }, rows).catch(e => ({ ok: false, reason: String(e.message).slice(0, 200) }))

  result.write = writeRes
  if (!writeRes?.ok) { result.errors.push(writeRes?.reason || '写入失败'); return result }

  // SKU 预览图
  if (opts.thumbs?.length) {
    const rowHandles = await page.$$('#sku tbody tr')
    result.thumbs = []
    for (let i = 0; i < rowHandles.length; i++) {
      const file = opts.thumbs[i] || opts.thumbs[0]
      if (!file) continue
      const fi = await rowHandles[i].$('input[type="file"]').catch(() => null)
      if (!fi) { result.thumbs.push({ i, ok: false, reason: '无file input' }); continue }
      try { await fi.uploadFile(file); result.thumbs.push({ i, ok: true }) }
      catch (e) { result.thumbs.push({ i, ok: false, reason: String(e.message).slice(0, 80) }) }
    }
  }

  await sleep(1500)

  if (opts.verify !== false) {
    const after = await readSkuTable(page)
    result.after = after.rowCount
    let mismatch = 0
    const bad = []
    for (let i = 0; i < Math.min(rows.length, after.rows.length); i++) {
      const want = rows[i], got = after.rows[i]
      const diff = []
      if (want.quantity !== undefined && String(want.quantity) !== String(got.quantity)) diff.push(`库存 ${want.quantity}≠${got.quantity}`)
      if (want.multiPrice !== undefined && String(want.multiPrice) !== String(got.multiPrice)) diff.push(`拼单价 ${want.multiPrice}≠${got.multiPrice}`)
      if (want.price !== undefined && String(want.price) !== String(got.price)) diff.push(`单买价 ${want.price}≠${got.price}`)
      if (diff.length) { mismatch++; bad.push({ row: i, spec: got.spec, diff }) }
      else result.filled++
    }
    if (mismatch > 0) result.errors.push(`${mismatch} 行回读不一致: ` + JSON.stringify(bad))
  } else {
    result.filled = rows.length
  }

  result.ok = result.errors.length === 0
  return result
}

export default step12_fillSkuPrices

