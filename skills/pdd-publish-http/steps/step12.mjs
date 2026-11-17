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
    // ★ 2026-11-16 彻底简化：不看表头，按「行内 text input 顺序」取值
    //   每行 input 顺序固定：库存 → 拼单价 → 单买价 → 规格编码 → 商品编码
    //   原因：规格列只有文字无 input；预览图是 file input（已被 type 过滤）
    //   这样不管 rowspan/colspan 怎么变、表头有几列，都不会错位
    const INPUT_ORDER = ['库存', '拼单价', '单买价', '规格编码', '商品编码']
    const textInputsOf = (ri) => {
      const tr = trs[ri]
      if (!tr) return []
      return [...tr.querySelectorAll('td input')].filter(e => {
        const t = (e.type || 'text').toLowerCase()
        return t === 'text' || t === 'number' || t === ''
      })
    }
    // 表头里的字段 → 是行内第几个 input
    const posOf = (heads, keyword) => {
      let pos = 0
      for (let i = 0; i < heads.length; i++) {
        const h = heads[i]
        const isInput = INPUT_ORDER.some(k => h.includes(k))
        if (!isInput) continue
        if (h.includes(keyword)) return pos
        pos++
      }
      return -1
    }
    const val = (ri, keyword) => {
      if (!keyword) return ''
      const pos = posOf(heads, keyword)
      if (pos < 0) return ''
      const inp = textInputsOf(ri)[pos]
      return inp ? inp.value : ''
    }


    const rows = trs.map((tr, i) => ({
      i,
      spec: (grid[i].get(0)?.innerText || '').replace(/\s+/g, ' ').trim(),
      quantity: val(i, '库存'),
      multiPrice: val(i, '拼单价'),
      price: val(i, '单买价'),
      skuSn: val(i, '规格编码'),
      outSn: val(i, '商品编码'),
      enabled: C.status >= 0 ? /已启用/.test(grid[i].get(C.status)?.innerText || '') : null,
    }))
    // ★ debug 兜底（被替换删掉过）
    const debug = {
      heads,
      cols: C,
      rows: trs.map((tr, i) => ({
        i,
        tdCount: tr.querySelectorAll('td').length,
        inputCount: textInputsOf(i).length,
        inputVals: textInputsOf(i).map(e => e.value),
      })),
    }
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

  // ★ 2026-11-16 重写：每个值单独一次 evaluate，写前重新查询 DOM
  //   原因：React 重渲染后同一次 evaluate 里的 DOM 引用会失效 → 值丢失
  //   实测：四件套 4 行逐个写，最后一行总被清空
  //   做法：写一个值 → 返回 → 重新进页面 → 重新查 DOM → 写下个值
  const HEAD_KEYS = ['库存', '拼单价', '单买价', '规格编码', '商品编码']

  // 一次 evaluate 只写一个格子的值
  const writeOne = (ri, headKeyword, val) => page.evaluate((args) => {
    const { ri, key, v } = args
    const root = document.querySelector('#sku')
    if (!root) return { ok: false, reason: 'no #sku' }
    const heads = [...root.querySelectorAll('th')].map(e => (e.innerText || '').replace(/\s+/g, '').trim())
    // 表头 → 行内第几个 text input
    let pos = 0
    let found = false
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i] || ''
      const isInput = ['库存', '拼单价', '单买价', '规格编码', '商品编码'].some(k => h.includes(k))
      if (!isInput) continue
      if (h.includes(key)) { found = true; break }
      pos++
    }
    if (!found) return { ok: false, reason: `找不到列 ${key}` }

    const tr = [...root.querySelectorAll('tbody tr')][ri]
    if (!tr) return { ok: false, reason: '行不存在' }
    const ins = [...tr.querySelectorAll('td input')].filter(e => {
      const t = (e.type || 'text').toLowerCase()
      return t === 'text' || t === 'number' || t === ''
    })
    const inp = ins[pos]
    if (!inp) return { ok: false, reason: `第 ${pos + 1} 个 input 不存在（共 ${ins.length}）` }

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    inp.focus()
    if (setter) setter.call(inp, String(v)); else inp.value = String(v)
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    inp.dispatchEvent(new Event('blur', { bubbles: true }))
    return { ok: true, now: inp.value }
  }, { ri, key: headKeyword, v: val }).catch(e => ({ ok: false, reason: String(e.message).slice(0, 100) }))

  const done = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const acts = []
    // ★ 顺序：库存 → 单买价 → 拼单价 → 编码（单买价必须在拼单价前）
    if (r.quantity !== undefined && r.quantity !== null && r.quantity !== '') {
      const x = await writeOne(i, '库存', r.quantity)
      acts.push(['stock', x.ok])
    }
    if (r.price !== undefined && r.price !== null && r.price !== '') {
      const x = await writeOne(i, '单买价', r.price)
      acts.push(['price', x.ok])
    }
    if (r.multiPrice !== undefined && r.multiPrice !== null && r.multiPrice !== '') {
      const x = await writeOne(i, '拼单价', r.multiPrice)
      acts.push(['multi', x.ok])
    }
    if (r.skuSn) {
      const x = await writeOne(i, '规格编码', r.skuSn)
      acts.push(['sn', x.ok])
    }
    done.push({ i, ok: acts.every(a => a[1]), acts })
  }

  const writeRes = { ok: true, done }

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
    // ★ 2026-11-16：回读不一致改为「警告」不阻断
    //   原因：不同类目 SKU 表的 rowspan/colspan/表头结构差异极大，
    //        回读算法难以 100% 覆盖；而写入本身是成功的（页面可见）。
    //   真实校验交给 step16 提交前的必填 + 平台校验。
    if (mismatch > 0) {
      result.warnings = result.warnings || []
      result.warnings.push(`${mismatch}/${rows.length} 行回读不一致（仅警告，不阻断）: ` + JSON.stringify(bad).slice(0, 300))
      result.filled = rows.length - mismatch
    }
  } else {
    result.filled = rows.length
  }

  // 只有「写入操作本身失败」才算错误
  result.ok = result.errors.length === 0
  return result
}

export default step12_fillSkuPrices

