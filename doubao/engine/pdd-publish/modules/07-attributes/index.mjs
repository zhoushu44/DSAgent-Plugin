/**
 * 07-attributes/index.mjs — 拼多多「商品属性批量填写模块」
 *
 * 基于 04-select/index.mjs，批量填商品属性区（品牌/产地/适用场景/功能特点/材质/使用对象…）
 *
 * ════════════════════════════════════════════════════════════════
 *  页面结构（实测）
 *
 *   <div data-testid="beast-core-form-item" id="basic.propertys.0.value">
 *     <label class="Form_itemLabelContent">品牌</label>
 *     <div data-testid="beast-core-select">…</div>
 *   </div>
 *   <div data-testid="beast-core-form-item" id="basic.propertys.1.value"> 重要产地
 *   <div data-testid="beast-core-form-item" id="basic.propertys.2.value"> 适用场景（多选）
 *   <div data-testid="beast-core-form-item" id="basic.propertys.3.value"> 功能特点（多选）
 *   <div data-testid="beast-core-form-item" id="basic.propertys.4.value"> 是否支持定制（单选）
 *   <div data-testid="beast-core-form-item" id="basic.propertys.5.value"> 重要材质
 *   <div data-testid="beast-core-form-item" id="basic.propertys.6.value"> 使用对象（多选）
 *   <div data-testid="beast-core-form-item" id="basic.propertys.7.value"> 是否接触食品（单选）
 *   <div data-testid="beast-core-form-item" id="service.qualification_id_list"> 商品资质（多选）
 *
 *  ★ 属性 id 是「basic.propertys.{序号}.value」，
 *    序号由类目决定，不同类目数量和顺序不同 → 必须按【名称】映射，不能写死序号
 * ════════════════════════════════════════════════════════════════
 *
 * 用法
 *   import { fillAttributes, listAttributes, fillAttributesByName } from './index.mjs'
 *
 *   // 按属性名填（推荐）
 *   await fillAttributesByName(page, {
 *     '品牌': ['无品牌/无注册商标'],
 *     '适用场景': ['家用', '办公'],
 *     '重要材质': ['原木浆纸'],
 *     '是否支持定制': ['支持定制'],
 *   })
 *
 *   // 按属性 id 填
 *   await fillAttributes(page, {
 *     'basic.propertys.0.value': ['无品牌/无注册商标'],
 *     'basic.propertys.2.value': ['家用'],
 *   })
 *
 *   // 列出页面所有属性（拿真实名称和 id）
 *   const attrs = await listAttributes(page)
 */

import { selectOptions, readSelected, probeSelect, closeAllSelects } from '../04-select/index.mjs'

/**
 * 列出页面所有可选属性（有 select 的表单项）
 * @returns {Promise<Array<{formItemId, label, mode, placeholder, required, selected}>>}
 */
export async function listAttributes(page) {
  return page.evaluate(() => {
    const out = []
    document.querySelectorAll('[data-testid="beast-core-form-item"]').forEach(item => {
      const sel = item.querySelector('[data-testid="beast-core-select"]')
      if (!sel) return
      const id = item.id || ''
      if (!id) return
      const labelEl = item.querySelector('label')
      const label = labelEl ? (labelEl.textContent || '').trim() : ''
      const header = sel.querySelector('[data-testid="beast-core-select-header"]')
      const input = sel.querySelector('[data-testid="beast-core-select-htmlInput"]')
      const single = sel.querySelector('[class*="ST_selectValueSingle"]')
      const multi = sel.querySelector('[class*="ST_selectValueMultiple"]')
      // 必填标记
      const required = !!item.querySelector('[class*="required"],[class*="Required"]')
        || /^\*/.test((item.textContent || '').trim())

      // 已选值
      let selected = []
      const container = multi || single
      if (container) {
        const tags = [...container.querySelectorAll('[class*="tag"] [class*="content"], [class*="Tag"] [class*="content"]')]
          .map(e => (e.textContent || '').trim()).filter(Boolean)
        if (tags.length) selected = tags
        else {
          const txt = (container.textContent || '').replace(/\s+/g, ' ').trim()
          const ph = input ? (input.placeholder || '').trim() : ''
          if (txt && txt !== ph) selected = [txt]
        }
      }

      out.push({
        formItemId: id,
        label,
        mode: multi ? 'multiple' : (single ? 'single' : 'unknown'),
        placeholder: input ? (input.placeholder || '') : '',
        readonly: input ? !!input.readOnly : false,
        required,
        expanded: header ? header.getAttribute('data-status') : '',
        selected,
      })
    })
    return out
  }).catch(() => [])
}

/**
 * 按属性 id 批量填
 *
 * @param {object} page
 * @param {Object<string, string|string[]>} mapping  { formItemId: 值 或 值数组 }
 * @param {object} [opts]
 * @param {boolean} [opts.stopOnError=true]
 * @returns {Promise<{ok:boolean, done:number, total:number, results:Array, errors:Array}>}
 */
export async function fillAttributes(page, mapping = {}, opts = {}) {
  const res = { ok: false, done: 0, total: 0, results: [], errors: [] }
  const entries = Object.entries(mapping).filter(([, v]) => v != null && (Array.isArray(v) ? v.length : String(v).length))
  res.total = entries.length
  if (!entries.length) { res.errors.push('mapping 为空'); return res }

  for (const [formItemId, val] of entries) {
    const values = Array.isArray(val) ? val : [val]
    const r = await selectOptions(page, { formItemId, values, timeoutMs: opts.timeoutMs || 12000 })
    res.results.push({ formItemId, values, ok: r.ok, selected: r.selected, error: r.error })
    if (r.ok) res.done++
    else {
      res.errors.push(`${formItemId}: ${r.error}`)
      if (opts.stopOnError !== false) break
    }
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)))
  }

  await closeAllSelects(page)
  res.ok = res.done === res.total
  return res
}

/**
 * 按属性【名称】批量填（推荐，不依赖序号）
 *
 * @param {object} page
 * @param {Object<string, string|string[]>} byName  { '品牌': '无品牌/无注册商标', '适用场景': ['家用','办公'] }
 * @param {object} [opts]
 * @param {boolean} [opts.requiredOnly=false] 只填必填项
 * @param {boolean} [opts.stopOnError=true]
 * @returns {Promise<{ok:boolean, done:number, total:number, results:Array, errors:Array, missing:Array}>}
 */
export async function fillAttributesByName(page, byName = {}, opts = {}) {
  const res = { ok: false, done: 0, total: 0, results: [], errors: [], missing: [] }

  const attrs = await listAttributes(page)
  if (!attrs.length) { res.errors.push('页面没有属性下拉框'); return res }

  const entries = Object.entries(byName || {}).filter(([, v]) => v != null && (Array.isArray(v) ? v.length : String(v).length))
  res.total = entries.length

  for (const [name, val] of entries) {
    // 按名称找属性（完全匹配 → 包含匹配）
    const want = String(name).replace(/[\s\u3000*]/g, '')
    const hit = attrs.find(a => a.label.replace(/[\s\u3000*]/g, '') === want)
      || attrs.find(a => a.label.replace(/[\s\u3000*]/g, '').includes(want))
      || attrs.find(a => want.includes(a.label.replace(/[\s\u3000*]/g, '')))

    if (!hit) {
      res.missing.push(name)
      res.errors.push(`找不到属性「${name}」，页面有: ${attrs.map(a => a.label).join(' / ')}`)
      if (opts.stopOnError !== false) break
      continue
    }

    const values = Array.isArray(val) ? val : [val]
    const r = await selectOptions(page, { formItemId: hit.formItemId, values, timeoutMs: opts.timeoutMs || 12000 })
    res.results.push({ name, formItemId: hit.formItemId, values, ok: r.ok, selected: r.selected, error: r.error })
    if (r.ok) res.done++
    else {
      res.errors.push(`${name}: ${r.error}`)
      if (opts.stopOnError !== false) break
    }
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)))
  }

  await closeAllSelects(page)
  res.ok = res.done === res.total
  return res
}

/**
 * 检查必填属性是否都填了
 * @returns {Promise<{ok:boolean, missing:Array<{label,formItemId}>}>}
 */
export async function checkRequiredAttributes(page) {
  const attrs = await listAttributes(page)
  const missing = attrs.filter(a => a.required && !(a.selected || []).length)
    .map(a => ({ label: a.label, formItemId: a.formItemId }))
  return { ok: missing.length === 0, missing }
}

export { selectOptions, readSelected, probeSelect, closeAllSelects }


