/**
 * step13.mjs — 拼多多上架 步骤 13
 * 组件依赖：见 modules/ 目录（由另一个 agent 维护）
 */
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..')
const ORIGIN = 'https://mms.pinduoduo.com'
const LIST_URL = ORIGIN + '/goods/goods_list'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const MOD = path.join(__dirname, '..', 'modules')
async function loadModules() {
  const load = (p) => import(pathToFileURL(path.join(MOD, p)).href)
  return {
    M: await load('01-image-upload/index.mjs'),
    F: await load('02-form-input/index.mjs'),
    B: await load('03-button/index.mjs'),
    S: await load('04-select/index.mjs'),
    R: await load('05-radio/index.mjs'),
    T: await load('06-sku-thumb/index.mjs'),
    A: await load('07-attributes/index.mjs'),
  }
}
// ═══════════════════════════════════════════════════════════════════
//  步骤 13：商品参考价
//
//  页面结构（实测 2026-11-08）
//    <div id="market_price" class="beast-input-goods-sku-row">
//      <div id="sku.market_price">
//        <label>商品参考价 *</label>
//        <input data-tracking-click-viewid="goods_advice_price"
//               placeholder="应大于商品最大单买价"
//               min="0" max="10000000">
//        <div class="IPT_appendCell">元</div>
//      </div>
//    </div>
//
//  规则：必填，且必须 > 该商品所有 SKU 中的最大单买价
// ═══════════════════════════════════════════════════════════════════

/**
 * 读商品参考价
 */
export async function readMarketPrice(page) {
  return page.evaluate(() => {
    const box = document.querySelector('#market_price')
    if (!box) return { found: false, value: '', placeholder: '' }
    const inp = box.querySelector('input')
    return {
      found: !!inp,
      value: inp ? inp.value : '',
      placeholder: inp ? (inp.placeholder || '') : '',
    }
  }).catch(() => ({ found: false, value: '', placeholder: '' }))
}

/**
 * 填商品参考价
 *
 * @param {object} page
 * @param {object} opts
 * @param {number|string} [opts.value]       指定参考价；不传则自动 = 最大单买价 + 1
 * @param {Array} [opts.skuRows]             用于自动算参考价的 SKU 行（同步骤 12）
 * @returns {Promise<{ok:boolean, value:string, autoCalc:boolean, errors:string[]}>}
 */
export async function step13_fillMarketPrice(page, opts = {}) {
  const result = { ok: false, value: '', autoCalc: false, errors: [] }

  const box = await page.evaluate(() => {
    const b = document.querySelector('#market_price')
    if (!b) return { found: false }
    const inp = b.querySelector('input')
    return { found: !!inp }
  }).catch(() => ({ found: false }))

  if (!box.found) {
    result.errors.push('找不到 #market_price 输入框')
    return result
  }

  // ① 决定填多少
  let val = opts.value
  if (val === undefined || val === null || val === '') {
    // 自动算：从 SKU 行里取最大单买价 + 1
    let maxPrice = 0
    if (Array.isArray(opts.skuRows) && opts.skuRows.length) {
      for (const r of opts.skuRows) {
        const p = Number(r.price)
        if (Number.isFinite(p) && p > maxPrice) maxPrice = p
      }
    } else {
      // 回读表格（readSkuTable 在 step12.mjs）
      const { readSkuTable } = await import(pathToFileURL(path.join(__dirname, 'step12.mjs')).href)
      const t = await readSkuTable(page)
      for (const r of (t.rows || [])) {
        const p = Number(r.price)
        if (Number.isFinite(p) && p > maxPrice) maxPrice = p
      }
    }
    if (!maxPrice) {
      result.errors.push('无法自动算参考价（没有 SKU 单买价），请显式传 value')
      return result
    }
    val = (maxPrice + 1).toFixed(2)
    result.autoCalc = true
  }

  // ② 写入
  const w = await page.evaluate((v) => {
    const box = document.querySelector('#market_price')
    if (!box) return { ok: false, reason: '找不到 #market_price' }
    const inp = box.querySelector('input')
    if (!inp) return { ok: false, reason: '找不到输入框' }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    inp.focus()
    if (setter) setter.call(inp, String(v)); else inp.value = String(v)
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    inp.dispatchEvent(new Event('blur', { bubbles: true }))
    return { ok: true, now: inp.value }
  }, val).catch(e => ({ ok: false, reason: String(e.message).slice(0, 120) }))

  if (!w?.ok) { result.errors.push(w?.reason || '写入失败'); return result }

  // ③ 回读
  await sleep(800)
  const after = await readMarketPrice(page)
  result.value = after.value

  // ★ 2026-11-24：数值比较（页面会把 20.90 规范化成 20.9，字符串比对误报回读不一致）
  if (Number(after.value) !== Number(val)) {
    result.errors.push(`回读不一致：期望 ${val}，实际 ${after.value}`)
    return result
  }

  result.ok = true
  return result
}




export default step13_fillMarketPrice






