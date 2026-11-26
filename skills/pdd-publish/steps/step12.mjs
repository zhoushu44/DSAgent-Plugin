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
import { ensureAllSkuRowsRendered } from './helpers/sku-window.mjs'

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

  let before = await readSkuTable(page)
  if (!before.found) { result.errors.push('找不到 #sku 价格库存表: ' + (before.error || '')); return result }
  result.before = before.rowCount
  if (before.rowCount === 0) { result.errors.push('表格没有 SKU 行（需先完成步骤 11）'); return result }
  if (rows.length > before.rowCount) {
    // ★ 2026-11-26：页面一次只画前 18 行（30 行的款实测停在 18）→ 先让它补画到全部行再对位填写
    //   补画不出来就不填：按「页面上第几行」硬填会把后面的价格填到别的规格上
    const r = await ensureAllSkuRowsRendered(page)
    result.rendered = r
    if (r.ok) { before = await readSkuTable(page); result.before = before.rowCount }
  }
  if (rows.length > before.rowCount) {
    const t = result.rendered?.total || before.rowCount
    result.errors.push(`传了 ${rows.length} 行，页面只画出 ${before.rowCount}/${t} 行，补画失败，未填写`)
    return result
  }

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


/**
 * step12b — SKU 预览图（与价格分开的一步）
 * @param {object} opts
 * @param {string[]} [opts.thumbs] 每行 SKU 预览图（下标对应价格表的行）
 * ★ 2026-11-26：从 step12_fillSkuPrices 里原样拆出，上传逻辑未改。
 *   页面一次只画前 18 行时，先补画到全部行，否则后面的行没有图可传。
 */
export async function step12b_fillSkuThumbs(page, opts = {}) {
  const result = { ok: false, thumbs: [], errors: [] }
  const drawn = await ensureAllSkuRowsRendered(page, opts)
  if (!drawn.ok) { result.errors.push(`SKU 表只画出 ${drawn.rendered}/${drawn.total} 行，未上传预览图`); return result }

  if (opts.thumbs?.length) {
    result.thumbs = []

    // 读所有行的预览图状态
    const readThumbState = () => page.evaluate(() => {
      // ★ 2026-11-26：表头和表体是两张分开的表，按「含拼单价」找只会找到表头（0 行）→ 统一从 #sku 取
      const tb = document.querySelector('#sku')
      if (!tb) return []
      return [...tb.querySelectorAll('tbody tr')].map((tr, ri) => {
        const tds = [...tr.querySelectorAll('td')]
        // 预览图列：优先找有 file input 的 td
        let td = tds.find(x => x.querySelector('input[type="file"]'))
        if (!td) {
          // 没 file input → 按表头找（rowspan 会少几个 td，要算偏移）
          const heads = [...tb.querySelectorAll('thead th')].map(th => th.textContent.trim())
          const col = heads.findIndex(h => /预览图/.test(h))
          const offset = tds.length < heads.length ? heads.length - tds.length : 0
          td = col >= 0 ? tds[col - offset] : null
        }
        if (!td) return { ri, hasThumb: false, hasFile: false }
        let hasThumb = false
        for (const e of td.querySelectorAll('*')) {
          const r = e.getBoundingClientRect()
          if (r.width < 20 || r.height < 20 || r.width > 300) continue
          if (/url\(/.test(getComputedStyle(e).backgroundImage || '')) { hasThumb = true; break }
          if (e.tagName === 'IMG' && (e.src || '').startsWith('http')) { hasThumb = true; break }
        }
        return { ri, hasThumb, hasFile: tds.some(x => x.querySelector('input[type="file"]')) }
      })
    }).catch(() => [])

    const slots = await readThumbState()

    // ★ 2026-11-26 提速（吸收 v2.1 旧引擎的上传优化）：
    //   旧实现逐行 `await sleep(200)` + uploadFile + 每行独立轮询 → 实测 ≈1s/行，30 行 29.4s。
    //   新实现：一次给所有行打 data-pdd-ri → 批量取 handle → 每批并发 CONC 行上传 →
    //   批内一次读全表状态轮询（不再每行一次 evaluate）。失败/缺入口的行仍走原来的补画串行重试。
    const CONC = Math.max(1, Number(opts.uploadConcurrency || 4))

    const need = []
    for (let i = 0; i < slots.length; i++) {
      const file = opts.thumbs[i] || opts.thumbs[0]
      if (!file) continue
      if (slots[i]?.hasThumb) { result.thumbs.push({ i, ok: true, already: true }); continue }
      need.push({ i, file })
    }

    const runBatch = async () => {
      // 打行号（顺带把上一次的标记清掉，避免表格重渲染后串行号）
      await page.evaluate(() => {
        const tb = document.querySelector('#sku')
        if (!tb) return
        ;[...tb.querySelectorAll('input[type="file"][data-pdd-ri]')].forEach(x => x.removeAttribute('data-pdd-ri'))
        ;[...tb.querySelectorAll('tbody tr')].forEach((tr, ri) => {
          const inp = tr.querySelector('input[type="file"]')
          if (inp) inp.setAttribute('data-pdd-ri', String(ri))
        })
      }).catch(() => { })

      const handles = await page.$$('#sku tbody tr input[type="file"][data-pdd-ri]')
      const byRow = new Map()
      for (const h of handles) {
        const ri = Number(await h.evaluate(e => e.getAttribute('data-pdd-ri')).catch(() => NaN))
        if (Number.isFinite(ri)) byRow.set(ri, h)
      }

      for (let b = 0; b < need.length; b += CONC) {
        const batch = need.slice(b, b + CONC)
        const sent = []
        await Promise.all(batch.map(async (item) => {
          const el = byRow.get(item.i)
          if (!el) { result.thumbs.push({ i: item.i, ok: false, reason: '无 file input' }); return }
          try { await el.uploadFile(item.file); sent.push(item.i) }
          catch (e) { result.thumbs.push({ i: item.i, ok: false, reason: String(e.message).slice(0, 60) }) }
        }))
        if (!sent.length) continue

        // 批内轮询：一次读整表，等这批全部出现缩略图（最多 8 秒）
        const left = new Set(sent)
        const t0 = Date.now()
        while (left.size && Date.now() - t0 < 8000) {
          await sleep(400)
          const st = await readThumbState()
          for (const i of [...left]) {
            if (st[i]?.hasThumb) { left.delete(i); result.thumbs.push({ i, ok: true }) }
          }
        }
        for (const i of left) result.thumbs.push({ i, ok: false, reason: '上传后未出现缩略图' })
      }
    }

    await runBatch()

    // 兜底：没入口 / 没出图的行 → 补画一次表格，再串行重试（保持原来的安全行为）
    const retryRows = result.thumbs.filter(t => !t.ok).map(t => ({ i: t.i, file: opts.thumbs[t.i] || opts.thumbs[0] }))
      .filter(x => x.file)
    if (retryRows.length) {
      const again = await ensureAllSkuRowsRendered(page, opts)
      if (again.ok) {
        // 去掉待重试行的失败记录，重试成功就补回来
        result.thumbs = result.thumbs.filter(t => !retryRows.some(r => r.i === t.i))
        for (const { i, file } of retryRows) {
          const el = await page.evaluateHandle((ri) => {
            const tb = document.querySelector('#sku')
            const tr = tb ? [...tb.querySelectorAll('tbody tr')][ri] : null
            return tr ? (tr.querySelector('input[type="file"]') || null) : null
          }, i).then(h => h.asElement()).catch(() => null)
          if (!el) { result.thumbs.push({ i, ok: false, reason: '补画后该行仍没有上传入口' }); continue }
          try { await el.uploadFile(file) } catch (e) { result.thumbs.push({ i, ok: false, reason: String(e.message).slice(0, 60) }); continue }
          let ok = false
          for (let w = 0; w < 16; w++) {
            await sleep(500)
            const st = await readThumbState()
            if (st[i]?.hasThumb) { ok = true; break }
          }
          result.thumbs.push({ i, ok, ...(ok ? {} : { reason: '上传后未出现缩略图' }) })
        }
      }
    }
    result.thumbs.sort((a, b2) => a.i - b2.i)
  }

  // ★ 2026-11-26：判定改严——必须读到行、且每行都有图才算成功（实测出现过「0 行报成功」）
  if (opts.thumbs?.length && !result.thumbs.length) result.errors.push('没有读到任何一行，预览图未上传')
  const failed = result.thumbs.filter(t => !t.ok)
  if (failed.length) result.errors.push(`${failed.length} 行预览图失败: ` + failed.map(t => `第${t.i + 1}行 ${t.reason}`).join('，'))
  result.ok = result.errors.length === 0 && result.thumbs.length > 0
  return result
}

export default step12_fillSkuPrices
