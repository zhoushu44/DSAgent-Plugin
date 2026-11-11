/**
 * step15.mjs — 拼多多上架 步骤 15
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
//  步骤 15：承诺发货时间（单选组）
//
//  页面结构（实测 2026-11-08）
//    <div id="shipment_limit_second"
//         data-tracking-impr-viewid="promise_time_choose">
//      <div id="service.shipment_limit_second">
//        <label>承诺发货时间 *</label>
//        <div data-testid="beast-core-radioGroup" class="RDG_outerWrapper">
//          <label data-testid="beast-core-radio" data-checked="true">   ← 已选
//            <input type="radio" class="RD_input" checked>
//            <div class="RD_textWrapper">48小时发货及揽收</div>
//          </label>
//          <label data-testid="beast-core-radio" data-checked="false">
//            <input type="radio" data-tracking-click-viewid="promise_time_choose">
//            <div class="RD_textWrapper">
//              <span>24小时发货及揽收<span>获额外流量扶持</span></span>
//            </div>
//          </label>
//          <label data-testid="beast-core-radio" data-checked="false">
//            <input type="radio" class="RD_input">
//            <div class="RD_textWrapper">当日发货及揽收</div>
//          </label>
//        </div>
//      </div>
//    </div>
//
//  选项：48小时发货及揽收（默认）/ 24小时发货及揽收 / 当日发货及揽收
// ═══════════════════════════════════════════════════════════════════

/** 读承诺发货时间所有选项及当前选中 */
export async function readShipmentOptions(page) {
  return page.evaluate(() => {
    const box = document.querySelector('#service\\.shipment_limit_second') || document.querySelector('#shipment_limit_second')
    if (!box) return { found: false, options: [], selected: '' }
    const labels = [...box.querySelectorAll('label[data-testid="beast-core-radio"]')]
    const options = labels.map((l, i) => {
      const txt = (l.innerText || '').replace(/\s+/g, ' ').replace(/获额外流量扶持/g, '').trim()
      const inp = l.querySelector('input[type="radio"]')
      return { i, text: txt, checked: !!(inp && inp.checked) }
    })
    const sel = options.find(o => o.checked)
    return { found: true, options, selected: sel ? sel.text : '' }
  }).catch(() => ({ found: false, options: [], selected: '' }))
}

/**
 * 选择承诺发货时间
 *
 * @param {object} page
 * @param {object} opts
 * @param {string} [opts.value]  选项文本，支持模糊匹配：
 *                               '48小时' / '24小时' / '当日'
 *                               不传则保持默认（48小时）
 * @returns {Promise<{ok:boolean, selected:string, options:string[], errors:string[]}>}
 */
export async function step15_selectShipmentTime(page, opts = {}) {
  const result = { ok: false, selected: '', options: [], errors: [] }

  const before = await readShipmentOptions(page)
  if (!before.found) { result.errors.push('找不到 #shipment_limit_second 单选组'); return result }
  result.options = before.options.map(o => o.text)

  const want = String(opts.value ?? '').trim()
  if (!want) {
    // 不指定 → 保持默认，只校验有选中项
    result.selected = before.selected
    result.ok = !!before.selected
    if (!result.ok) result.errors.push('没有任何选项被选中')
    return result
  }

  // 点击匹配的 label（按 index 点，稳）
  const clicked = await page.evaluate((keyword) => {
    const box = document.querySelector('#service\\.shipment_limit_second') || document.querySelector('#shipment_limit_second')
    if (!box) return { ok: false, reason: '找不到容器' }
    const labels = [...box.querySelectorAll('label[data-testid="beast-core-radio"]')]
    // 关键词 → 索引映射（页面固定顺序：0=48小时 1=24小时 2=当日）
    const k = String(keyword)
    let idx = -1
    if (/48/.test(k)) idx = 0
    else if (/24/.test(k)) idx = 1
    else if (/当日/.test(k)) idx = 2
    if (idx < 0 || !labels[idx]) {
      return { ok: false, reason: `找不到「${keyword}」对应选项`, all: labels.map(l => (l.innerText || '').replace(/\s+/g, ' ').trim()) }
    }
    const l = labels[idx]
    // 点 label 里的可点区域：优先 input，其次点击 svg 圆圈
    const inp = l.querySelector('input[type="radio"]')
    if (inp && !inp.checked) { inp.click(); return { ok: true, matched: (l.innerText || '').trim(), idx } }
    if (inp && inp.checked) return { ok: true, matched: (l.innerText || '').trim(), idx, already: true }
    const icon = l.querySelector('[data-testid="beast-core-radio-radioIcon"]') || l.querySelector('svg')
    if (icon) { icon.click(); return { ok: true, matched: (l.innerText || '').trim(), idx } }
    l.click()
    return { ok: true, matched: (l.innerText || '').trim(), idx }
  }, want).catch(e => ({ ok: false, reason: String(e.message).slice(0, 120) }))

  if (!clicked?.ok) {
    result.errors.push(clicked?.reason || '点击失败')
    if (clicked?.all) result.errors.push('可选: ' + clicked.all.join(' | '))
    return result
  }

  await sleep(1200)

  // 回读校验
  const after = await readShipmentOptions(page)
  result.selected = after.selected
  if (!after.selected || !after.selected.includes(want)) {
    result.errors.push(`选中项不符：期望含「${want}」，实际「${after.selected}」`)
    return result
  }
  result.ok = true
  return result
}




export default step15_selectShipmentTime





