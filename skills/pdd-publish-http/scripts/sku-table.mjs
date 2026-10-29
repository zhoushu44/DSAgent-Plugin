/**
 * SKU 组件 · ② 价格表 + 参考价
 *
 * 职责：填 #sku 表格的 库存/拼单价/单买价 + 商品参考价。
 *
 * ★ 2026-10-29 真机踩坑定论（改代码前必读）：
 *   1. **合并单元格**：颜色列 rowspan=N，同色后续行少一个 td → 列索引错位。
 *      必须用「td 内 text input 序号」定位：0=库存 1=拼单价 2=单买价 3=规格编码。
 *   2. **行文本会被污染**：校验提示「单买价至少比拼单价高1元」被塞进 td，
 *      所以行 key 不能取整行文本，只能用维度值（见 sku-rows.mjs）。
 *   3. **单买价必须严格 > 拼单价 + 1**：实测差 1.00 被判不合格，故取 +1.01 两位小数。
 *   4. **参考价 = 最大拼单价 + 1**（用户定），且必须 > 最大单买价。
 */
import { jsClick, jsBlur, SPEC_ROOT, sleep } from './spec-dims.mjs'
import { readRowKeys } from './sku-rows.mjs'

/**
 * 找到「拼单价」表头的那个 table，返回列索引映射
 */
export async function findSkuTable(page) {
  return page.evaluate(() => {
    const tables = [...document.querySelectorAll('#sku table')]
    for (let ti = 0; ti < tables.length; ti++) {
      const heads = [...tables[ti].querySelectorAll('thead th')].map(th => th.textContent.trim())
      if (heads.some(h => /拼单价/.test(h))) {
        return {
          ti,
          heads,
          stockIdx: heads.findIndex(h => /库存/.test(h)),
          priceIdx: heads.findIndex(h => /拼单价/.test(h)),
          singleIdx: heads.findIndex(h => /单买价/.test(h)),
          thumbIdx: heads.findIndex(h => /预览图/.test(h)),
          itemNoIdx: heads.findIndex(h => /货号|编码/.test(h)),
          rows: tables[ti].querySelectorAll('tbody tr').length,
        }
      }
    }
    return null
  }).catch(() => null)
}

/**
 * 在「指定行」的指定 text input 序号里填值
 * @param rowKey 行标识（维度值拼接，如「黄色 100」，已处理 rowspan 继承）
 * @param ord 0=库存 1=拼单价 2=单买价 3=规格编码
 */
async function setCellByKey(page, rowKey, ord, value) {
  const v = String(value ?? '')
  if (!rowKey || ord < 0) return { ok: false, back: '', via: 'bad-args' }

  // 统一的「按 key 找行 + 取第 ord 个 text input」逻辑
  const RUN = (key, o, val, mode) => {
    const trs = [...document.querySelectorAll('#sku table tbody tr')]
    let carriedColor = ''
    for (const tr of trs) {
      const tds = [...tr.querySelectorAll('td')]
      const dimVals = []
      for (const td of tds) {
        if (td.querySelector('input')) continue
        const t = (td.textContent || '').trim()
        if (!t) continue
        if (/本地上传|已启用|已停用|至少比|不能为空|请输入|点击上传/.test(t)) continue
        if (t.length > 12) continue
        if (dimVals.length === 0 && td.rowSpan > 1) { carriedColor = t; dimVals.push(t); continue }
        dimVals.push(t)
        if (dimVals.length >= 2) break
      }
      if (dimVals.length === 1 && carriedColor) dimVals.unshift(carriedColor)
      if (dimVals.join(' ') !== key) continue

      const inputs = [...tr.querySelectorAll('input')].filter(i => i.type !== 'file')
      const el = inputs[o]
      if (!el) return null

      if (mode === 'set') {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        if (!setter) return null
        setter.call(el, val)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        el.dispatchEvent(new Event('blur', { bubbles: true }))
        return { ok: true }
      }
      if (mode === 'read') return { val: el.value || '' }
      if (mode === 'scroll') { tr.scrollIntoView({ block: 'center' }); return { ok: true } }
      if (mode === 'pos') {
        const r = el.getBoundingClientRect()
        if (r.width < 5 || r.y < 0) return null
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      }
    }
    return null
  }

  // ① JS setter
  await page.evaluate(`(${RUN.toString()})(${JSON.stringify(rowKey)}, ${ord}, ${JSON.stringify(v)}, 'set')`).catch(() => null)
  await sleep(180)

  // ② 回读
  const readBack = async () => {
    const r = await page.evaluate(`(${RUN.toString()})(${JSON.stringify(rowKey)}, ${ord}, '', 'read')`).catch(() => null)
    return r?.val || ''
  }
  let back = await readBack()
  if (String(back).trim() === v) return { ok: true, back, via: 'js' }

  // ③ 键盘兜底
  await page.evaluate(`(${RUN.toString()})(${JSON.stringify(rowKey)}, ${ord}, '', 'scroll')`).catch(() => null)
  await sleep(400)
  const pos = await page.evaluate(`(${RUN.toString()})(${JSON.stringify(rowKey)}, ${ord}, '', 'pos')`).catch(() => null)
  if (!pos?.x) return { ok: false, back, via: 'no-pos' }

  await jsClick(page, pos.x, pos.y)
  await sleep(200)
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await sleep(60)
  await page.keyboard.type(v, { delay: 30 })
  await sleep(150)
  await page.keyboard.press('Enter')
  await sleep(400)

  back = await readBack()
  return { ok: String(back).trim() === v, back, via: 'keyboard' }
}

/**
 * 填价格表（库存 + 拼单价 + 单买价）
 * @param opts { price, stock, rows?: [{ price, stock, single }] }
 */
export async function fillPriceTable(page, opts = {}) {
  const price = String(opts.price || '29.9')
  const stock = String(opts.stock || '999')
  const rowOverrides = opts.rows || []

  const rowKeys = await readRowKeys(page)
  if (!rowKeys.length) return { rows: 0, filled: 0, detail: [], message: '读不到 SKU 行' }

  const detail = []
  let filled = 0

  for (const rk of rowKeys) {
    const ov = rowOverrides[rk.ri] || {}
    const rowPrice = String(ov.price || price)
    // ★ 单买价 = 拼单价 + 1；平台要求严格 >1 元，取 +1.01（两位小数）
    const pNum = parseFloat(rowPrice) || 0
    const rowSingle = ov.single
      ? String(ov.single)
      : (Math.round((pNum + 1.01) * 100) / 100).toFixed(2)
    const rowStock = String(ov.stock || stock)

    const cells = []
    for (const [name, ord, val] of [
      ['库存', 0, rowStock],
      ['拼单价', 1, rowPrice],
      ['单买价', 2, rowSingle],
    ]) {
      const res = await setCellByKey(page, rk.key, ord, val)
      if (res.ok) filled++
      cells.push({ name, ord, want: val, back: res.back, ok: res.ok, via: res.via })
    }
    detail.push({ row: rk.ri, key: rk.key, cells })
  }

  return { rows: rowKeys.length, filled, detail }
}

/**
 * 读表格当前所有行的 库存/拼单价/单买价（校验用）
 */
export async function readPriceSnapshot(page) {
  return page.evaluate(() => {
    const trs = [...document.querySelectorAll('#sku table tbody tr')]
    const out = []
    let carriedColor = ''
    trs.forEach((tr, ri) => {
      const tds = [...tr.querySelectorAll('td')]
      const dimVals = []
      for (const td of tds) {
        if (td.querySelector('input')) continue
        const t = (td.textContent || '').trim()
        if (!t) continue
        if (/本地上传|已启用|已停用|至少比|不能为空|请输入|点击上传/.test(t)) continue
        if (t.length > 12) continue
        if (dimVals.length === 0 && td.rowSpan > 1) { carriedColor = t; dimVals.push(t); continue }
        dimVals.push(t)
        if (dimVals.length >= 2) break
      }
      if (dimVals.length === 1 && carriedColor) dimVals.unshift(carriedColor)
      const inputs = [...tr.querySelectorAll('input')].filter(i => i.type !== 'file')
      out.push({
        ri,
        key: dimVals.join(' '),
        stock: inputs[0]?.value || '',
        price: inputs[1]?.value || '',
        single: inputs[2]?.value || '',
      })
    })
    return out
  }).catch(() => [])
}

/**
 * 填参考价
 * ★ 真机实测：placeholder 是「应大于商品最大单买价」，在 #goods-spec-sku 内但 y≈3600
 */
export async function fillRefPrice(page, refPrice) {
  const v = String(refPrice || '')
  if (!v) return false

  const scrolled = await page.evaluate((sel) => {
    let inp = [...(document.querySelector(sel)?.querySelectorAll('input') || [])].find(e => /大于/.test(e.placeholder || ''))
    if (!inp) inp = [...document.querySelectorAll('input')].find(e => /大于/.test(e.placeholder || ''))
    if (!inp) return false
    inp.scrollIntoView({ block: 'center' })
    window.__refInp = inp
    return true
  }, SPEC_ROOT).catch(() => false)
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
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await sleep(100)
  await page.keyboard.type(v, { delay: 45 })
  await sleep(300)
  await page.keyboard.press('Enter')
  await sleep(800)
  await jsBlur(page)
  await sleep(500)

  const back = await page.evaluate(() => window.__refInp?.value || '').catch(() => '')
  return String(back).trim() === v || String(back).includes(v)
}

/** 读 SKU 表行数 */
export async function readSkuRowCount(page) {
  return (await readRowKeys(page)).length
}
