/**
 * 属性候选表 + 智能匹配填属性
 *
 * 用法（被 ai-publish.mjs 调用）：
 *   import { dumpAttrCandidates, smartFillAttrs } from './attr-fill.mjs'
 *
 * 流程：
 *   ① dumpAttrCandidates(page)     逐个点开未填属性的下拉，拿全部候选值
 *   ② smartFillAttrs(page, hints)  按 hints（用户指定/AI 推断）匹配候选并选中
 *
 * 匹配策略（优先级）：
 *   1. hints 里显式指定 value_name → 精确匹配
 *   2. hints 里给关键词 → 候选值包含该关键词
 *   3. 无 hint → 选第一个（保底，保证必填项不空）
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 需要处理的属性名（必填优先） */
export const REQUIRED_ATTRS = ['适用温度', '材质', '容量', '数量', '款式']
/** 跳过不自动填的属性（涉授权/需人工判断） */
export const SKIP_ATTRS = ['品牌', '使用品牌名', '批量上传规格图']

/**
 * 容错 evaluate（页面重绘会 frame detached）
 */
function makeEv(page) {
  return async (fn, ...args) => {
    for (let i = 0; i < 5; i++) {
      try { return await page.evaluate(fn, ...args) } catch (e) {
        if (/detached|Execution context|Cannot find context/i.test(String(e?.message))) { await sleep(3000); continue }
        throw e
      }
    }
    return null
  }
}

/** 关闭已展开的下拉面板（温和方式：Escape + 点空白，不动 DOM style） */
async function closePanels(ev) {
  await ev(() => {
    for (const tgt of [document.body, document.documentElement]) {
      tgt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }))
    }
    const blank = document.elementFromPoint(5, 5)
    if (blank) {
      const r = blank.getBoundingClientRect()
      const o = { bubbles: true, cancelable: true, view: window, clientX: r.x + 2, clientY: r.y + 2 }
      for (const t of ['mousedown', 'mouseup', 'click']) blank.dispatchEvent(new MouseEvent(t, o))
    }
  })
  await sleep(1200)
}

/** 滚到属性区 */
async function scrollToAttrs(ev) {
  await ev(() => {
    const els = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && (e.textContent || '').trim() === '属性信息')
    if (els.length) window.scrollTo(0, els[0].getBoundingClientRect().top + window.scrollY - 300)
  })
  await sleep(4000)
}

/**
 * 读取当前所有属性的填充状态
 * @param {boolean} noScroll  true 时不滚动（循环内复用时避免反复滚）
 */
export async function readAttrState(page, noScroll = false) {
  const ev = makeEv(page)
  if (!noScroll) { await scrollToAttrs(ev) }
  return await ev(() => {
    const out = []
    const NAME_RE = /材质|容量|数量|款式|适用温度|品牌|场景|规格|风格|图案|产地|功能|型号|购买规格|适用人数/
    for (const lb of document.querySelectorAll('label,dt,.semi-form-field-label,[class*="label"]')) {
      const t = (lb.textContent || '').trim().replace(/^\*/, '')
      if (!t || t.length > 20) continue
      if (!NAME_RE.test(t)) continue
      // 向上找最近含 .ecom-g-select 的容器
      let row = lb.parentElement
      for (let i = 0; i < 8 && row; i++) {
        if (row.querySelector && row.querySelector('.ecom-g-select')) break
        row = row.parentElement
      }
      const gsel = row?.querySelector('.ecom-g-select')
      out.push({
        label: t,
        filled: gsel ? !/请选择/.test(gsel.textContent || '') : false,
        text: gsel ? (gsel.textContent || '').trim().slice(0, 40) : '',
      })
    }
    return out
  }) || []
}

/**
 * 点开某个属性的下拉，返回全部候选值
 */
async function openAttrOptions(page, ev, label) {
  await closePanels(ev)
  await sleep(800)
  const opened = await ev((nm) => {
    const labels = [...document.querySelectorAll('*')]
      .filter(e => e.children.length === 0 && (e.textContent || '').trim().replace(/^\*/, '') === nm)
    if (!labels.length) return false
    let row = labels[0].parentElement
    for (let i = 0; i < 8 && row; i++) {
      if (row.querySelector && row.querySelector('.ecom-g-select')) break
      row = row.parentElement
    }
    const ctrl = row?.querySelector('.ecom-g-select-selector') || row?.querySelector('.ecom-g-select')
    if (!ctrl) return false
    const r = ctrl.getBoundingClientRect()
    if (r.width <= 0) return false
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }
    for (const t of ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click']) ctrl.dispatchEvent(new MouseEvent(t, o))
    return true
  }, label)
  if (!opened) return []
  await sleep(2800)
  const opts = await ev(() => [...document.querySelectorAll('.ecom-g-select-item')]
    .filter(e => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && (e.textContent || '').trim() &&
        /ecom-g-select-item-option/.test((e.className || '').toString())
    })
    .map(e => (e.textContent || '').trim().slice(0, 40)))
  return opts || []
}

/**
 * 点击当前下拉里的第 n 个选项
 */
async function clickOption(ev, nth = 0) {
  return await ev((n) => {
    const items = [...document.querySelectorAll('.ecom-g-select-item')]
      .filter(e => {
        const r = e.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && (e.textContent || '').trim() &&
          /ecom-g-select-item-option/.test((e.className || '').toString())
      })
    if (!items.length || n >= items.length) return null
    const el = items[n]
    const r = el.getBoundingClientRect()
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }
    for (const t of ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, o))
    return (el.textContent || '').trim().slice(0, 40)
  }, nth)
}

/**
 * ① 导出属性候选表（逐个点开未填属性）
 * @returns {Promise<Object<string, string[]>>} { 属性名: [候选值...] }
 */
export async function dumpAttrCandidates(page, attrs = REQUIRED_ATTRS) {
  const ev = makeEv(page)
  await scrollToAttrs(ev)
  const table = {}
  for (const label of attrs) {
    const opts = await openAttrOptions(page, ev, label)
    table[label] = opts
    await closePanels(ev)
    await sleep(700)
  }
  return table
}

/**
 * ② 智能填属性
 * @param {Object} hints  用户/AI 指定的属性值，如 { 材质: '玻璃', 容量: '300' }
 *                        值可以是完整候选名，也可以是关键词
 * @param {Object} candTable  可选：已知候选表（不传则现场 dump）
 * @returns {Promise<{filled:Array, failed:Array, table:Object}>}
 */
export async function smartFillAttrs(page, hints = {}, candTable = null) {
  const ev = makeEv(page)
  await scrollToAttrs(ev)

  // ★ 等属性区渲染就绪：刚进第二级时 .ecom-g-select 可能还没挂上，
  //   立即读会拿到 0 个属性（实测：直接报「无需填」但实际啥也没填）
  let state = []
  for (let i = 0; i < 10; i++) {
    state = await readAttrState(page, i > 0)   // 第一次滚，后续不滚
    if (state.length >= 3) break
    await sleep(2000)
    if (i === 0) await scrollToAttrs(ev)
  }
  if (!state.length) return { filled: [], failed: [{ label: '(全部)', why: '未读到属性（页面未渲染或定位失败）' }], table: candTable || {} }

  const pending = state.filter(a => !a.filled && !SKIP_ATTRS.includes(a.label))
  if (!pending.length) return { filled: [], failed: [], table: candTable || {} }

  const table = candTable || await dumpAttrCandidates(page, pending.map(a => a.label))
  const filled = [], failed = []

  for (const attr of pending) {
    const label = attr.label
    const cands = table[label] || []
    if (!cands.length) { failed.push({ label, why: '无候选值' }); continue }

    // ── 匹配策略 ──
    const hint = hints[label] ?? hints[label.replace(/\s/g, '')] ?? ''
    let pickIdx = -1
    if (hint) {
      const h = String(hint).trim()
      // 1) 完整名精确匹配
      pickIdx = cands.findIndex(c => c === h)
      // 2) 候选包含关键词
      if (pickIdx < 0) pickIdx = cands.findIndex(c => c.includes(h))
      // 3) 关键词包含候选（hint 更长时）
      if (pickIdx < 0) pickIdx = cands.findIndex(c => h.includes(c))
      // 4) 数字/单位模糊匹配（hint='300' → 命中含 300 的候选）
      if (pickIdx < 0) {
        const nums = h.match(/\d+/g)
        if (nums) pickIdx = cands.findIndex(c => nums.some(n => c.includes(n)))
      }
    }
    // 5) 无 hint 或无匹配 → 第一个（保底）
    if (pickIdx < 0) pickIdx = 0

    // ── 点开该属性下拉（带重试：连续开合会让页面丢状态）──
    let opened = false
    for (let attempt = 0; attempt < 3 && !opened; attempt++) {
      await closePanels(ev)
      await sleep(900)
      opened = await ev((nm) => {
        const labels = [...document.querySelectorAll('*')]
          .filter(e => e.children.length === 0 && (e.textContent || '').trim().replace(/^\*/, '') === nm)
        if (!labels.length) return false
        let row = labels[0].parentElement
        for (let i = 0; i < 8 && row; i++) { if (row.querySelector && row.querySelector('.ecom-g-select')) break; row = row.parentElement }
        const ctrl = row?.querySelector('.ecom-g-select-selector') || row?.querySelector('.ecom-g-select')
        if (!ctrl) return false
        const r = ctrl.getBoundingClientRect()
        if (r.width <= 0) return false
        ctrl.scrollIntoView({ block: 'center' })
        const r2 = ctrl.getBoundingClientRect()
        const o = { bubbles: true, cancelable: true, view: window, clientX: r2.x + r2.width / 2, clientY: r2.y + r2.height / 2 }
        for (const t of ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click']) ctrl.dispatchEvent(new MouseEvent(t, o))
        return true
      }, label)
      if (opened) {
        // 确认面板真的出了选项
        await sleep(2500)
        const cnt = await ev(() => [...document.querySelectorAll('.ecom-g-select-item')]
          .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && /item-option/.test(e.className || '') }).length)
        if (!cnt) opened = false   // 面板没真开，重试
      }
    }
    if (!opened) { failed.push({ label, why: '打不开下拉' }); continue }

    const picked = await clickOption(ev, pickIdx)
    await closePanels(ev)
    if (picked) {
      filled.push({ label, value: picked, matched: hint ? `hint=${hint}` : '默认第一个' })
    } else {
      failed.push({ label, why: '选项点击失败' })
    }
    await sleep(1500)
  }

  return { filled, failed, table }
}
