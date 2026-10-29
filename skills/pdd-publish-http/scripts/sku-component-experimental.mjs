/**
 * SKU 组件 · 统一入口
 *
 * 三个子组件串起来，所有类目走同一条路：
 *   ① sku-specs.mjs  填规格维度（4 种页面结构自适应）
 *   ② sku-price.mjs  填价格表 + 参考价
 *   ③ sku-thumb.mjs  填每行预览图（按颜色名匹配）
 *
 * 用法（publish.mjs / lib 都只调这一个函数）：
 *   import { fillSku, onPageReady } from './sku-component.mjs'
 *   const r = await fillSku(page, product, { price, stock })
 *
 * 固定顺序（不要改）：
 *   尺码表停用 → 规格维度 → 尺码表二次停用 → 价格表 → 参考价 → 预览图
 *   理由：
 *     · 尺码表必须在填规格前停用（否则占住 SKU 表）
 *     · 填完尺码值后尺码表会重新生成，必须再停用一次
 *     · 价格表要在规格确定行数后填
 *     · 预览图要在价格表之后（行结构稳定）
 */
import { fillSpecDims, sleep, SPEC_ROOT } from './spec-dims.mjs'
import { fillPriceTable, fillRefPrice, readSkuRowCount } from './sku-table.mjs'
import { fillSkuThumbs, buildThumbMaps } from './sku-thumb.mjs'

/** 停用尺码表（两种入口都试） */
export async function disableSizeChart(page) {
  const found = await page.evaluate(() => {
    let link = document.querySelector('a[data-tracking-impr-viewid="disable_size_chart"]')
    if (!link) {
      const st = document.querySelector('#sizeTable')
      if (st) link = st.querySelector('div a')
    }
    if (link) { link.click(); return true }
    return false
  }).catch(() => false)
  if (!found) return false
  await sleep(800)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /确认停用/.test(b.textContent || ''))
    btn?.click()
  }).catch(() => {})
  await sleep(1000)
  return true
}

/**
 * 填整个 SKU 区（规格 + 价格 + 预览图）
 *
 * @param page Puppeteer page
 * @param product 统一商品 JSON（specs + skus + price + stock）
 * @param opts {
 *   price?: string,          覆盖 product.price
 *   stock?: string,          覆盖 product.stock
 *   refPrice?: string,       参考价（默认 price+15，对齐 .9）
 *   fillPriceTable?: bool,   默认 true
 *   fillRefPrice?: bool,     默认 true
 *   fillThumbs?: bool,       默认 true
 *   disableSizeChartTimes?: 默认 2
 *   onLog?: (msg) => void
 * }
 * @returns { ok, skuRows, specs, price, thumbs, message }
 */
export async function fillSku(page, product, opts = {}) {
  const log = opts.onLog || (() => {})
  const price = String(opts.price ?? product.price ?? '29.9')
  const stock = String(opts.stock ?? product.stock ?? '999')
  // ★ 2026-10-29（用户定）：参考价 = 最大拼单价 + 1
  //   最大拼单价取自 skus[].price（本次要填进页面的真实值），
  //   这样必然满足平台「参考价 > 最大单买价」（单买价 = 拼单价 + 1，参考价 = 最大拼单价 + 1 仍偏小）
  //   → 实际取「最大拼单价 + 1」后若 <= 最大单买价，再加到「最大单买价 + 1」
  let maxSkuPrice = 0
  for (const s of (product.skus || [])) {
    const p = parseFloat(s?.price)
    if (p > 0) maxSkuPrice = Math.max(maxSkuPrice, p)
  }
  if (!maxSkuPrice) maxSkuPrice = parseFloat(price) || 29.9
  const maxSinglePrice = maxSkuPrice + 1          // 单买价 = 拼单价 + 1（sku-table 的默认规则）
  // 参考价 = 最大拼单价 + 1；若仍不大于单买价，则取 最大单买价 + 1
  let refNum = maxSkuPrice + 1
  if (refNum <= maxSinglePrice) refNum = maxSinglePrice + 1
  const refPrice = String(opts.refPrice ?? refNum.toFixed(1))
  const t0 = Date.now()

  // ═══ ① 等规格区 ═══
  log('等规格区…')
  for (let i = 0; i < 20; i++) {
    await sleep(1500)
    if (await page.evaluate(() => !!document.querySelector('#goods-spec-sku')).catch(() => false)) break
    if (i === 19) return { ok: false, message: '规格区超时' }
  }

  // ═══ ② 尺码表停用（第一次：填规格前） ═══
  if (await disableSizeChart(page)) log('已停用尺码表')

  // ═══ ③ 规格维度 ═══
  const specs = (product.specs || [])
    .filter(d => d && d.name && Array.isArray(d.values) && d.values.length)
    .map(d => ({
      name: d.name,
      values: d.values.map(v => (v && typeof v === 'object') ? String(v.value ?? '').trim() : String(v ?? '').trim()).filter(Boolean),
    }))
    .filter(d => d.values.length)

  let specResult = { ok: true, dims: [] }
  if (specs.length) {
    specResult = await fillSpecDims(page, specs, { onLog: log })
    specs.forEach((s, i) => {
      const d = specResult.dims[i]
      if (d) log(`  ${d.user} → ${d.page}(${d.type}) ${d.values.filter(v => v.ok).length}/${d.values.length}`)
    })
  } else {
    log('无规格维度')
  }

  // ═══ ④ 尺码表二次停用（尺码值填完才生成） ═══
  if (await disableSizeChart(page)) log('已停用尺码表（二次）')

  // ═══ ⑤ 预览图（★ 2026-10-29 顺序修正：必须在价格表之前！
  //      实测：上传预览图会触发 SKU 表重渲染，把已填的库存/拼单价清空 →
  //      平台报「请输入第1行规格的库存」。所以先把图传完，再填价格。） ═══
  let thumbResult = { filled: 0, total: 0 }
  if (opts.fillThumbs !== false) {
    log('填预览图…')
    const maps = buildThumbMaps(product)
    thumbResult = await fillSkuThumbs(page, {
      ...maps,
      fallback: maps.fallback || product.images?.[0],
    })
    log(`  预览图 ${thumbResult.filled}/${thumbResult.total} 行`)
  }

  // ═══ ⑥ 参考价（默认关闭：publish-flow 段3 已按 product.price 填过） ═══
  let refOk = false
  if (opts.fillRefPrice === true) {
    refOk = await fillRefPrice(page, refPrice)
    log(`  参考价 ${refPrice} → ${refOk ? 'OK' : '未找到'}`)
  }

  // ═══ ⑦ 价格表（★ 在预览图之后填：此时行结构稳定） ═══
  let priceResult = { rows: 0, filled: 0 }
  const rowOverrides = (product.skus || []).map(s => ({ price: s.price, stock: s.stock }))
  if (opts.fillPriceTable !== false) {
    log('填价格表…')
    priceResult = await fillPriceTable(page, { price, stock, rows: rowOverrides })
    log(`  ${priceResult.rows} 行，填了 ${priceResult.filled} 格`)

    const recheck = await fillPriceTable(page, { price, stock, rows: rowOverrides })
    log(`  价格表校验：${recheck.filled} 格`)
    priceResult = recheck
  }

  // ═══ ⑧ 预览图补漏（★ 价格表填充会重建行 DOM，把已传的预览图清掉 → 必须再补一次） ═══
  if (opts.fillThumbs !== false) {
    const maps = buildThumbMaps(product)
    const retry = await fillSkuThumbs(page, {
      ...maps,
      fallback: maps.fallback || product.images?.[0],
      maxRounds: 3,
    })
    log(`  预览图补漏：${retry.filled}/${retry.total} 行`)
    if (retry.filled > thumbResult.filled) thumbResult = retry
  }

  // ═══ ⑧ 读最终 SKU 行数 ═══
  const rows = await readSkuRowCount(page)

  return {
    ok: specResult.ok && rows > 0,
    skuRows: rows,
    specs: specResult.dims,
    price: priceResult,
    thumbs: thumbResult,
    elapsedMs: Date.now() - t0,
    message: `SKU 完成：${specs.length} 维度 / ${rows} 行 / 价格 ${priceResult.filled} 格 / 预览图 ${thumbResult.filled}/${thumbResult.total}`,
  }
}

/** 给 publish.mjs 的 extra.domFillSpecs 用的适配器（保持原有接口） */
export function asDomFillSpecs(product, opts = {}) {
  return async (page) => fillSku(page, product, opts)
}

export { buildThumbMaps, readSkuRowCount, fillSpecDims, fillPriceTable, fillRefPrice, fillSkuThumbs }

