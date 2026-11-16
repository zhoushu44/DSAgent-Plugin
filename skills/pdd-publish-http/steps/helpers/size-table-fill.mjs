/**
 * size-table-fill.mjs — 尺码/鞋码表通用填充
 *
 * 兼容两种：
 *   ① 服装尺码：标签页 通用/中国码/欧码/英码/德码/美码/均码，值形如 160/84A 或 M/L/XL
 *   ② 运动鞋码：标签页 欧码/法码/英码，值形如 34 / 34.5 / 40
 *
 * 通用流程：
 *   1) 找维度块（按标题，或按内容特征兜底）
 *   2) 按目标值判断该切哪个标签页（可被模板 tabHint 覆盖）
 *   3) 逐个值 -> 找 label/div 文字等于目标值的元素 -> 点它绑定的 checkbox
 *   4) 若维度里有区间值表（身高/体重 或 脚长），勾表头区间值再填
 */

import { findDim } from './find-dim.mjs'

const norm = s => String(s || '').replace(/[\s\u3000]/g, '').trim()

/** 判断目标值属于哪类标签页 */
export function guessTab(values, tabHint = '') {
  if (tabHint) return tabHint
  const vs = values.map(v => String(v).trim())
  // 纯字母码 → 中国码
  if (vs.some(v => /^(XXS|XS|S|M|L|XL|XXL|XXXL|4XL|5XL|均码)$/i.test(v))) return '中国码'
  // 三段式 160/84A → 中国码
  if (vs.some(v => /^\d{3}\/\d{2}[A-Z]$/.test(v))) return '中国码'
  // 纯数字（34、40、42.5）→ 欧码
  if (vs.every(v => /^\d+(\.\d+)?$/.test(v))) return '欧码'
  return ''
}

/** 找维度块索引 */
export async function findSizeDim(page, dimName) {
  // ★ 统一走 find-dim 的三层定位（外层标题 → 内层标题 → 内容特征）
  const r = await findDim(page, dimName)
  if (r.ok) return r
  // 兜到底：任何带尺码表特征的块
  return page.evaluate(() => {
    const dims = [...document.querySelectorAll('.property-container-v2')]
    for (let i = 0; i < dims.length; i++) {
      const txt = dims[i].innerText || ''
      if (/全选以下规格值|尺码表/.test(txt)) return { ok: true, idx: i, why: 'fallback-content' }
    }
    return { ok: false, count: dims.length }
  }).catch(e => ({ ok: false, error: String(e.message).slice(0, 80) }))
}

/** 切换标签页 */
export async function switchSizeTab(page, idx, tabName) {
  if (!tabName) return { ok: true, skipped: true }
  return page.evaluate(async (args) => {
    const { idx, tabName } = args
    const sleepIn = ms => new Promise(x => setTimeout(x, ms))
    const dims = [...document.querySelectorAll('.property-container-v2')]
    const box = dims[idx]
    if (!box) return { ok: false, reason: '维度块不存在' }

    const nm = s => String(s || '').replace(/[\s\u3000]/g, '').trim()
    // 标签页通常是 label[class*=RD_outerWrapper]，也可能是 button/span
    const tabs = [
      ...box.querySelectorAll('label[class*="RD_outerWrapper"]'),
      ...box.querySelectorAll('button, [role="tab"], [class*="tab"]'),
    ]
    let want = tabs.find(t => nm(t.innerText) === nm(tabName))
    if (!want) want = tabs.find(t => nm(t.innerText).includes(nm(tabName)))
    if (!want) return { ok: false, reason: `没有「${tabName}」标签`, all: tabs.map(t => (t.innerText || '').trim()).slice(0, 12) }

    const radio = want.querySelector('input[type="radio"]')
    if (radio && !radio.checked) radio.click()
    else if (!radio) want.click()
    await sleepIn(900)
    return { ok: true, tab: tabName }
  }, { idx, tabName }).catch(e => ({ ok: false, reason: String(e.message).slice(0, 80) }))
}

/** 勾一个值 */
export async function checkSizeValue(page, idx, value) {
  return page.evaluate(async (args) => {
    const { idx, val } = args
    const sleepIn = ms => new Promise(x => setTimeout(x, ms))
    const nm = s => String(s || '').replace(/[\s\u3000]/g, '').trim()

    const dims = [...document.querySelectorAll('.property-container-v2')]
    const box = dims[idx]
    if (!box) return { ok: false, reason: '维度块不存在' }

    const want = nm(val)
    // 找文字精确等于目标值的候选（取最内层）
    const cands = [...box.querySelectorAll('label, li, div, span')].filter(e => {
      const t = nm(e.innerText)
      if (t !== want) return false
      const r = e.getBoundingClientRect()
      return r.width > 6 && r.height > 6
    })
    if (!cands.length) {
      const sample = [...new Set([...box.querySelectorAll('label,div,span')].map(e => nm(e.innerText)).filter(t => t && t.length < 12))].slice(0, 30)
      return { ok: false, reason: `找不到「${val}」`, sample }
    }

    const el = cands[cands.length - 1]

    // ① 元素自身或其 label 祖先里的 checkbox
    let cb = el.querySelector('input[type="checkbox"]')
    if (!cb) {
      const lab = el.closest('label')
      if (lab) cb = lab.querySelector('input[type="checkbox"]')
    }
    // ② 同级/父级找 checkbox
    if (!cb) {
      let p = el
      for (let k = 0; k < 4 && p && !cb; k++) {
        p = p.parentElement
        if (p) cb = p.querySelector('input[type="checkbox"]')
      }
    }
    if (cb) {
      if (!cb.checked) { cb.click(); await sleepIn(180) }
      return { ok: true, via: 'checkbox', checked: cb.checked }
    }

    // ③ 没有 checkbox → 点元素本身
    el.click(); await sleepIn(180)
    return { ok: true, via: 'click' }
  }, { idx, val: value }).catch(e => ({ ok: false, reason: String(e.message).slice(0, 100) }))
}

/** 表头「全选」或「区间值」勾选 */
export async function checkHeaderToggles(page, idx) {
  return page.evaluate(async (args) => {
    const { idx } = args
    const sleepIn = ms => new Promise(x => setTimeout(x, ms))
    const dims = [...document.querySelectorAll('.property-container-v2')]
    const box = dims[idx]
    if (!box) return { ok: false, reason: '维度块不存在' }

    const out = []
    // 表头里的 checkbox（如「区间值」）
    const headerCbs = [...box.querySelectorAll('thead input[type="checkbox"]')]
    for (const cb of headerCbs) {
      if (!cb.checked) { cb.click(); await sleepIn(350) }
      out.push({ checked: cb.checked })
    }
    await sleepIn(400)
    return { ok: true, toggles: out }
  }, { idx }).catch(e => ({ ok: false, reason: String(e.message).slice(0, 80) }))
}

/**
 * 通用入口
 * @param {object} opts { tabHint?: string, skipHeaderToggles?: boolean }
 */
export async function fillSizeTable(page, dimName, values, opts = {}) {
  const found = await findSizeDim(page, dimName)
  if (!found.ok) return { ok: false, error: `找不到「${dimName}」维度块（共 ${found.count || 0} 个：${(found.names || []).join('/')}）` }

  // 切标签页
  const tab = guessTab(values, opts.tabHint)
  let switched = { ok: true, skipped: true }
  if (tab) {
    switched = await switchSizeTab(page, found.idx, tab)
    // 切失败不致命（可能只有一页）
  }

  // 勾表头区间值（有才勾）
  let header = { ok: true }
  if (!opts.skipHeaderToggles) header = await checkHeaderToggles(page, found.idx)

  // 逐个值勾选
  const results = []
  for (const v of values) {
    const r = await checkSizeValue(page, found.idx, v)
    results.push({ value: v, ...r })
  }

  const ok = results.every(x => x.ok)
  return {
    ok,
    dimIdx: found.idx,
    why: found.why,
    tab: tab || '(未切)',
    tabSwitched: switched.ok && !switched.skipped,
    tabError: switched.ok ? '' : switched.reason,
    toggles: header.toggles || [],
    results,
    error: ok ? '' : results.filter(x => !x.ok).map(x => `${x.value}:${x.reason}${x.sample ? '(' + x.sample.join('|') + ')' : ''}`).join('; '),
  }
}

export default fillSizeTable
