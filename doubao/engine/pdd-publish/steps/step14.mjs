/**
 * step14.mjs — 拼多多上架 步骤 14
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
//  步骤 14：满件折扣
//
//  页面结构（实测 2026-11-08）
//    <div id="batch_discount" class="goods-sku-row">
//      <div id="sku.batch_discount">
//        <label>满件折扣 *</label>
//        <div class="InputWithPrefixText_inputWithPrefixText">
//          <span>满2件</span>
//          <input placeholder="5.0~9.9" value="9.5">   ← 页面默认 9.5，本模块默认 9.9
//          <div class="IPT_appendCell">折</div>
//        </div>
//      </div>
//    </div>
//
//  规则：必填，取值范围 5.0 ~ 9.9（折）。本模块未传时默认 9.9
// ═══════════════════════════════════════════════════════════════════

/**
 * 读满件折扣
 */
export async function readBatchDiscount(page) {
  return page.evaluate(() => {
    const box = document.querySelector('#batch_discount')
    if (!box) return { found: false, value: '', placeholder: '', prefix: '' }
    const inp = box.querySelector('input')
    const prefixEl = box.querySelector('[class*="InputWithPrefixText_text"]')
    return {
      found: !!inp,
      value: inp ? inp.value : '',
      placeholder: inp ? (inp.placeholder || '') : '',
      prefix: prefixEl ? (prefixEl.innerText || '').trim() : '',
    }
  }).catch(() => ({ found: false, value: '', placeholder: '', prefix: '' }))
}

/**
 * 填满件折扣
 *
 * @param {object} page
 * @param {object} [opts]
 * @param {number|string} [opts.value]  折扣值，5.0~9.9；不传则保持页面默认
 * @returns {Promise<{ok:boolean, value:string, errors:string[]}>}
 */
export async function step14_fillBatchDiscount(page, opts = {}) {
  const result = { ok: false, value: '', errors: [] }

  const box = await page.evaluate(() => {
    const b = document.querySelector('#batch_discount')
    if (!b) return { found: false }
    return { found: !!b.querySelector('input') }
  }).catch(() => ({ found: false }))

  if (!box.found) { result.errors.push('找不到 #batch_discount 输入框'); return result }

  // 不传 value → 用页面默认值，只校验
  let val = opts.value
  if (val === undefined || val === null || val === '') {
    const cur = await readBatchDiscount(page)
    if (cur.value) {
      result.value = cur.value
      result.ok = true
      return result
    }
    val = '9.9'
  }

  const num = Number(val)
  if (!Number.isFinite(num) || num < 5.0 || num > 9.9) {
    result.errors.push(`折扣 ${val} 超出范围（5.0~9.9）`)
    return result
  }
  const v = num.toFixed(1)

  const w = await page.evaluate((vv) => {
    const b = document.querySelector('#batch_discount')
    if (!b) return { ok: false, reason: '#batch_discount 不存在' }
    const inp = b.querySelector('input')
    if (!inp) return { ok: false, reason: '输入框不存在' }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    inp.focus()
    if (setter) setter.call(inp, String(vv)); else inp.value = String(vv)
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    inp.dispatchEvent(new Event('blur', { bubbles: true }))
    return { ok: true, now: inp.value }
  }, v).catch(e => ({ ok: false, reason: String(e.message).slice(0, 120) }))

  if (!w?.ok) { result.errors.push(w?.reason || '写入失败'); return result }

  await sleep(600)
  const after = await readBatchDiscount(page)
  result.value = after.value

  if (String(after.value) !== v) {
    result.errors.push(`回读不一致：期望 ${v}，实际 ${after.value}`)
    return result
  }
  result.ok = true
  return result
}




export default step14_fillBatchDiscount






