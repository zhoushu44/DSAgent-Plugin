/**
 * step6.mjs — 步骤 6：商品属性
 *
 * ══════════════════════════════════════════════════════════════
 *  定位策略（按优先级）
 * ══════════════════════════════════════════════════════════════
 *  ① 模板里有 formItemId  → 直接用（最快最准）
 *  ② 只有 label（属性名） → 扫页面找 label 对应的 form-item id
 *  ③ 兜底                → 用 placeholderText
 *
 *  组件要求（04-select）：
 *    selectOptions(page, { formItemId | placeholderText | selectXpath, values })
 *    ★ 不支持 { label } —— 必须先解析成 formItemId
 *
 * ══════════════════════════════════════════════════════════════
 *  页面结构
 * ══════════════════════════════════════════════════════════════
 *  <div data-testid="beast-core-form-item" id="basic.propertys.0.value">
 *    <label class="Form_itemLabelContent">品牌</label>
 *    <div data-testid="beast-core-select">
 *      <div data-testid="beast-core-select-header">
 *        <div class="ST_selectValueSingle">
 *          <input data-testid="beast-core-select-htmlInput" placeholder="请输入品牌名称搜索">
 *        </div>
 *      </div>
 *    </div>
 *  </div>
 *
 *  多选（适用场景）：
 *    <span class="ST_selectValueMultiple">
 *      <input placeholder="请选择">
 *    </span>
 *
 *  只读（规格类型）：
 *    <input readonly placeholder="规格类型1">
 */
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..')
const ORIGIN = 'https://mms.pinduoduo.com'
const LIST_URL = ORIGIN + '/goods/goods_list'
const TPL_ROOT = path.join(PLUGIN, 'artifacts', 'pdd-templates')
const sleep = ms => new Promise(r => setTimeout(r, ms))

const MOD = path.join(__dirname, '..', 'modules')
async function loadModules() {
  const load = (p) => import(pathToFileURL(path.join(MOD, p)).href)
  return {
    S: await load('04-select/index.mjs'),
    A: await load('07-attributes/index.mjs'),
  }
}

// ═══════════════════════════════════════════════════════════════════
//  模板
// ═══════════════════════════════════════════════════════════════════
function loadTemplateByCat(catId) {
  if (!catId || !fs.existsSync(TPL_ROOT)) return null
  const d = fs.readdirSync(TPL_ROOT, { withFileTypes: true })
    .filter(x => x.isDirectory() && x.name.endsWith(`-${catId}`))
    .map(x => path.join(TPL_ROOT, x.name))[0]
  if (!d) return null
  const f = path.join(d, 'template.json')
  if (!fs.existsSync(f)) return null
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null }
}

// ═══════════════════════════════════════════════════════════════════
//  label → formItemId
// ═══════════════════════════════════════════════════════════════════
/**
 * 扫页面，把属性名（label）映射到 form-item 的 id
 * @returns {Promise<Object<string,{formItemId,mode,placeholder,readonly}>>}
 */
export async function mapLabelsToFormIds(page) {
  return page.evaluate(() => {
    const out = {}
    const items = document.querySelectorAll('[data-testid="beast-core-form-item"]')
    for (const item of items) {
      const id = item.id || ''
      if (!id) continue
      const sel = item.querySelector('[data-testid="beast-core-select"]')
      if (!sel) continue

      // 属性名：取最内层 label 的文本
      let label = ''
      const lab = item.querySelector('label')
      // ★ 2026-11-16 归一化：平台会在 label 前加标记
      //   "*被里材质" → "被里材质"；"重要安全等级" → "安全等级"
      if (lab) {
        label = (lab.textContent || '')
          .replace(/[*＊]/g, '')
          .replace(/^重要/, '')
          .replace(/\s+/g, '')
          .trim()
      }
      if (!label) continue

      const input = sel.querySelector('[data-testid="beast-core-select-htmlInput"]')
      const multi = sel.querySelector('[class*="ST_selectValueMultiple"]')
      const single = sel.querySelector('[class*="ST_selectValueSingle"]')

      out[label] = {
        formItemId: id,
        mode: multi ? 'multiple' : (single ? 'single' : 'unknown'),
        placeholder: input ? (input.placeholder || '') : '',
        readonly: input ? !!input.readOnly : false,
      }
    }
    return out
  }).catch(() => ({}))
}

// ═══════════════════════════════════════════════════════════════════
//  主函数
// ═══════════════════════════════════════════════════════════════════

/**
 * 按属性名填属性
 *
 * @param {object} page
 * @param {object} opts
 * @param {Object<string,string|string[]>} opts.values   { '品牌':'爱绿森', '适用场景':['家用','办公'] }
 * @param {number} [opts.catId]        有模板时按其选项做预校验
 * @param {boolean} [opts.strict=true] 值不在模板选项内是否报错
 * @returns {Promise<{
 *   ok:boolean,
 *   results:Array<{label,ok,formItemId,error?}>,
 *   errors:string[],
 *   unmapped:string[]
 * }>}
 */
export async function step6_fillAttributes(page, opts = {}) {
  // ★ 属性值预校验（2026-11-16）：不在模板选项里的值直接剔除，避免「值不合规」
  if (opts.values && opts.catId) {
    try {
      const T = await import(pathToFileURL(path.join(PLUGIN, 'skills/pdd-publish-http/templates/index.mjs')).href)
      const tpl = T.loadTemplate(opts.catId)
      if (tpl?.attributes?.length) {
        const dropped = []
        for (const [label, val] of Object.entries(opts.values)) {
          const at = tpl.attributes.find(a => a.label === label)
          if (!at || !at.options?.length) continue   // 无选项的属性（输入框）不校验
          const hit = at.options.find(o => String(o.value) === String(val))
          if (!hit) {
            dropped.push({ label, value: val, options: at.options.slice(0, 5).map(o => o.value) })
            delete opts.values[label]
          }
        }
        if (dropped.length) {
          opts._droppedAttrs = dropped
        }
      }
    } catch { /* 校验失败不影响主流程 */ }
  }

  const { S } = await loadModules()
  const values = opts.values || opts.attrValues || {}
  const strict = opts.strict !== false
  const res = { ok: false, results: [], errors: [], unmapped: [] }

  const entries = Object.entries(values).filter(([, v]) =>
    v !== undefined && v !== null && (Array.isArray(v) ? v.length : String(v).trim() !== '')
  )
  if (!entries.length) { res.errors.push('没有要填的属性'); return res }

  // ① 模板（用于预校验）
  const tpl = opts.template || loadTemplateByCat(opts.catId)
  const tplByLabel = new Map()
  if (tpl?.attributes) for (const a of tpl.attributes) tplByLabel.set(a.label, a)

  // ② 扫页面拿 label → formItemId
  //   ★ 2026-11-16 修正：不能「扫到任意 1 个就停」——
  //     页面是分批渲染的，先出来「运费模板」，属性区还没渲染完
  //     要等「扫到的属性数 >= 模板属性数」（最多等 20 秒）
  const wantCount = Math.max(tpl?.attributes?.length || 0, 3)
  let labelMap = {}
  for (let i = 0; i < 80; i++) {
    labelMap = await mapLabelsToFormIds(page)
    const got = Object.keys(labelMap).length
    if (got >= wantCount) break
    if (i === 0 || got !== (labelMap._lastGot || -1)) {
      console.log('[s6] 等待属性渲染：' + got + '/' + wantCount)
    }
    labelMap._lastGot = got
    await new Promise(r => setTimeout(r, 250))
  }
  delete labelMap._lastGot

  // ★ 调试日志：扫到几个属性
  console.log('[s6] 扫到属性', Object.keys(labelMap).length, '个:', Object.keys(labelMap).slice(0,15).join(',') || '(空)')

  // ③ 逐个填（★ 每次重新扫 labelMap：级联属性要选完上一个才出现下一个）
  for (const [label, rawVal] of entries) {
    const vals = Array.isArray(rawVal) ? rawVal.map(String) : [String(rawVal)]

    // ★ 2026-11-16 重扫：平台属性是级联的，选好一个后下一个才渲染
    //   只在开头扫一次会导致后面的属性全部「页面找不到」
    for (let i = 0; i < 20; i++) {
      const fresh = await mapLabelsToFormIds(page)
      if (Object.keys(fresh).length >= Math.min(wantCount, 3)) { labelMap = fresh; break }
      await new Promise(r => setTimeout(r, 250))
    }

    // 预校验：值是否在模板选项内
    const t = tplByLabel.get(label)
    if (t && strict && t.options?.length) {
      const allowed = new Set(t.options.map(o => String(o.value)))
      const bad = vals.filter(v => !allowed.has(v))
      if (bad.length) {
        res.results.push({ label, ok: false, error: `值不在模板选项内：${bad.join('、')}（可选：${[...allowed].slice(0, 10).join('/')}）` })
        res.errors.push(`${label}: 值不合规`)
        continue
      }
    }

    // 找 formItemId
    // ★ 2026-11-16 归一化匹配（去 * 和「重要」）
    const normL = (s) => String(s || '').replace(/[*＊]/g, '').replace(/^重要/, '').replace(/\s+/g, '').trim()
    const wantL = normL(label)
    let hitKey = Object.keys(labelMap).find(k => normL(k) === wantL)
    if (!hitKey) hitKey = Object.keys(labelMap).find(k => {
      const kk = normL(k)
      return kk.includes(wantL) || wantL.includes(kk)
    })
    const hit = hitKey ? labelMap[hitKey] : null
    if (!hit?.formItemId) {
      res.results.push({ label, ok: false, error: '页面上找不到该属性（可能该类目无此属性，或页面未渲染完）' })
      res.unmapped.push(label)
      continue
    }

    console.log('[s6] 填', label, '=', JSON.stringify(vals), '  id=', hit.formItemId)

    // 调组件
    const r = await S.selectOptions(page, {
      formItemId: hit.formItemId,
      values: vals,
      timeoutMs: opts.timeoutMs ?? 30000,
      search: /品牌|型号|货号/.test(label),
    }).catch(e => ({ ok: false, error: String(e.message).slice(0, 150) }))

    res.results.push({ label, formItemId: hit.formItemId, mode: hit.mode, ...r })
    if (!r?.ok) res.errors.push(`${label}: ${r?.error || '失败'}`)
    // 等该属性的选中值回填（最多 1.5s，元素/值出现即走）
    for (let i = 0; i < 6; i++) {
      const done = await page.evaluate((fid) => {
        const el = document.getElementById(fid)
        if (!el) return true
        const t = (el.innerText || '').replace(/\s+/g, '')
        return t.length > 0 && !/请选择|^$/.test(t)
      }, hit.formItemId).catch(() => true)
      if (done) break
      await new Promise(r => setTimeout(r, 250))
    }
  }

  res.ok = res.errors.length === 0

  // ④ ★ 自动补齐页面上的必填项（模板里没有的，如 材质/成分含量）
  //    * 号在 span.Form_itemRequired 里，不在 label 文本
  if (opts.autoRequired !== false) {
    const filled = await fillRequiredRemaining(page)
    res.autoRequired = filled
    if (filled.length) res.results.push(...filled)
  }

  return res
}

/**
 * 补齐页面上所有「必填且未填」的下拉属性
 * 优先选合理值（棉/聚酯/涤纶…），否则第一个可选项
 */
export async function fillRequiredRemaining(page) {
  const out = []
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  const targets = await page.evaluate(() => {
    const arr = []
    for (const it of document.querySelectorAll('[data-testid="beast-core-form-item"]')) {
      const lab = (it.querySelector('label')?.innerText || '').replace(/\s+/g, '').trim()
      if (!lab) continue
      if (!it.querySelector('span[class*="Form_itemRequired"]')) continue
      if (/轮播图|价格及库存|商品规格|标题/.test(lab)) continue
      const inp = [...it.querySelectorAll('input')].find(e => ['text', '', 'number'].includes((e.type || 'text').toLowerCase()))
      const fid = it.id
      const val = inp ? inp.value : ''
      if (!fid) continue
      arr.push({ label: lab, id: fid, value: val, hasInput: !!inp })
    }
    return arr
  }).catch(() => [])

  for (const t of targets) {
    if (t.value) { out.push({ label: t.label, ok: true, already: t.value, auto: true }); continue }

    // 点开下拉
    await page.evaluate((fid) => {
      const el = document.getElementById(fid)
      if (!el) return
      const h = el.querySelector('[data-testid="beast-core-select-header"]')
        || el.querySelector('[data-testid="beast-core-select"]')
        || el.querySelector('input')
      if (h) { h.scrollIntoView({ block: 'center' }); h.click() }
    }, t.id).catch(() => { })
    await sleep(900)

    // 抓选项（按离属性框距离过滤，排除页脚客服）
    const opts = await page.evaluate((fid) => {
      const anchor = document.getElementById(fid)
      const ar = anchor ? anchor.getBoundingClientRect() : { top: 0, left: 0 }
      const all = [...document.querySelectorAll('li,[role="option"],[data-testid*="option"],[class*="option"]')]
      const seen = new Set(); const arr = []
      for (const e of all) {
        const r = e.getBoundingClientRect()
        if (r.width < 30 || r.height < 14) continue
        if (r.top < ar.top - 80 || r.top > ar.top + 500) continue
        if (Math.abs(r.left - ar.left) > 600) continue
        const txt = (e.innerText || '').replace(/\s+/g, ' ').trim()
        if (!txt || txt.length > 40) continue
        if (/官方|客服|发布助手|规则中心/.test(txt)) continue
        if (seen.has(txt)) continue
        seen.add(txt); arr.push(txt)
      }
      return arr.slice(0, 30)
    }, t.id).catch(() => [])

    if (!opts.length) { out.push({ label: t.label, ok: false, error: '下拉无选项', auto: true }); continue }

    const prefer = opts.find(o => /棉|聚酯|涤纶|粘纤|氨纶|其他/.test(o)) || opts[0]
    const clicked = await page.evaluate((args) => {
      const { want, fid } = args
      const anchor = document.getElementById(fid)
      const ar = anchor ? anchor.getBoundingClientRect() : { top: 0, left: 0 }
      const all = [...document.querySelectorAll('li,[role="option"],[data-testid*="option"],[class*="option"]')]
      for (const e of all) {
        const r = e.getBoundingClientRect()
        if (r.width < 30 || r.height < 14) continue
        if (r.top < ar.top - 80 || r.top > ar.top + 500) continue
        if (Math.abs(r.left - ar.left) > 600) continue
        if ((e.innerText || '').replace(/\s+/g, ' ').trim() === want) { e.click(); return true }
      }
      return false
    }, { want: prefer, fid: t.id }).catch(() => false)
    await sleep(500)
    out.push({ label: t.label, ok: clicked, picked: prefer, auto: true, options: opts.slice(0, 5) })
  }
  return out
}

/**
 * 只读：列出页面上所有可选属性（不填）
 */
export async function step6_listAttributes(page) {
  const { A } = await loadModules()
  return A.listAttributes(page)
}

export default step6_fillAttributes

