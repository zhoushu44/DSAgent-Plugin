/**
 * 规格值控件是 **cascader 级联选择器**（.ecom-g-cascader-picker）。
 *
 * ★★★ 关键结构（2026-10-23 实测，之前一直搞错）：
 *   div.style_skuValueBox__QqbEj 里有**多个** cascader：
 *     [0] label="白色"  ← 已选的规格值（旁边有删除图标 sp-icon-parcel style_delete）
 *     [1] label=""     ← ★ 空的！这才是「新增规格值」的入口
 *   → 必须选**最后一个（label 为空）**的 cascader，
 *     选第一个只会改已有值，不会新增（实测坑：rows 恒 0）
 *
 * 面板：.ecom-g-cascader-menus > .ecom-g-cascader-menu > .ecom-g-cascader-menu-item
 * 选项两层：色系/颜色（「红色系/红色」）
 *
 * 有效操作序列：
 *   1. 点最后一个 cascader 的 .ecom-g-cascader-picker-arrow → 展开
 *   2. 在 .ecom-g-cascader-input 输关键词 → 过滤
 *   3. 点 .ecom-g-cascader-menu-item（排除「暂无相似选项」）→ 新增一个规格值
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 空态文案（点选项时要排除） */
const EMPTY_RE = /暂无|没有|重新选择|无匹配|no data|empty/i

/** 取「新增规格值」用的 cascader（最后一个 label 为空的） */
const PICK_EMPTY = `(() => {
  const all = [...document.querySelectorAll('.ecom-g-cascader-picker')]
  if (!all.length) return null
  const empty = all.filter(p => !(p.querySelector('.ecom-g-cascader-picker-label')?.textContent || '').trim())
  return empty.length ? empty[empty.length - 1] : all[all.length - 1]
})()`

/** 读当前 SKU 状态 */
export async function readSkuState(page) {
  return await page.evaluate(() => {
    const t = [...document.querySelectorAll('table')]
      .find(x => /价格/.test([...x.querySelectorAll('th')].map(h => h.textContent || '').join('')))

    const picker = document.querySelector('.ecom-g-cascader-picker')
    return {
      rows: t ? t.querySelectorAll('tbody tr').length : 0,
      filledRows: t ? [...t.querySelectorAll('tbody tr')].filter(r => {
        const i = r.querySelector('input')
        return i && i.value
      }).length : 0,
      headers: t ? [...t.querySelectorAll('th')].map(h => (h.textContent || '').trim()) : [],
      pickerLabels: [...document.querySelectorAll('.ecom-g-cascader-picker-label')]
        .map(l => (l.textContent || '').trim()).filter(Boolean),
      hasEmptyPicker: [...document.querySelectorAll('.ecom-g-cascader-picker')]
        .some(p => !(p.querySelector('.ecom-g-cascader-picker-label')?.textContent || '').trim()),
    }
  })
}

/**
 * 展开「新增规格值」的 cascader 面板
 *
 * ★★★ 关键实证（probe-compare-ctrl 对比 React props）：
 *   .ecom-g-cascader-picker          onClick=function  onMouseDown=function  ✅ 点这个
 *   .ecom-g-cascader-picker-arrow    onClick=null                            ❌ 点这个没用
 *   .ecom-g-input.ecom-g-cascader-input  onClick=function                    ✅ 也可以
 *
 * 之前一直点箭头 → 永远打不开/选不中（白试几十次）
 */
async function openPicker(ev) {
  return await ev(() => {
    const all = [...document.querySelectorAll('.ecom-g-cascader-picker')]
    if (!all.length) return false
    const empty = all.filter(p => !(p.querySelector('.ecom-g-cascader-picker-label')?.textContent || '').trim())
    const picker = (empty.length ? empty[empty.length - 1] : all[all.length - 1])
    const r = picker.getBoundingClientRect()
    if (r.width <= 0) return false
    picker.scrollIntoView({ block: 'center' })
    const r2 = picker.getBoundingClientRect()
    const o = { bubbles: true, cancelable: true, view: window, clientX: r2.x + r2.width / 2, clientY: r2.y + r2.height / 2 }
    // 完整序列（picker 上 onMouseDown + onClick 都有）
    for (const t of ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click']) picker.dispatchEvent(new MouseEvent(t, o))
    return true
  })
}

/** 关面板 */
async function closePicker(ev) {
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
  await sleep(1500)
}

/** 在 cascader 搜索框输入关键词（★ input 的 onClick 是真函数，先点它激活） */
async function typeInPicker(ev, keyword) {
  return await ev((kw) => {
    const inps = [...document.querySelectorAll('.ecom-g-cascader-input')]
      .filter(i => { const r = i.getBoundingClientRect(); return r.width > 0 })
    const inp = inps[inps.length - 1]
    if (!inp) return false
    // 先点它（激活 cascader 的输入态）
    const r = inp.getBoundingClientRect()
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }
    for (const t of ['mousedown', 'mouseup', 'click']) inp.dispatchEvent(new MouseEvent(t, o))
    inp.focus()
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(inp, kw)
    for (const t of ['input', 'compositionend', 'change', 'keyup']) inp.dispatchEvent(new Event(t, { bubbles: true }))
    return true
  }, keyword)
}

/** 点第 n 个菜单项，返回选中文本（★ 排除「暂无相似选项」等空态项） */
async function pickMenuItem(ev, nth = 0) {
  return await ev((n) => {
    const EMPTY = /暂无|没有|重新选择|请选择|无匹配|no data|empty/i
    const items = [...document.querySelectorAll('.ecom-g-cascader-menu-item')]
      .filter(e => {
        const r = e.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return false
        const txt = (e.textContent || '').trim()
        if (!txt) return false
        if (EMPTY.test(txt)) return false          // ★ 排除空态项
        if (/disabled|aria-disabled="true"/i.test((e.className || '') + (e.getAttribute('aria-disabled') || ''))) return false
        return true
      })
    if (!items.length || n >= items.length) return null
    const el = items[n]
    const r = el.getBoundingClientRect()
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }
    // ★ 完整鼠标序列 + focus + 原生 click（Ant Design cascader 靠 mousedown 触发选中）
    if (el.focus) { try { el.focus() } catch { /* ignore */ } }
    for (const t of ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, o))
    if (typeof el.click === 'function') { try { el.click() } catch { /* ignore */ } }
    return (el.textContent || '').trim().slice(0, 40)
  }, nth)
}

/**
 * 填一个规格值（cascader 方式）
 * @returns {Promise<{ok:boolean, picked:string|null, reason?:string}>}
 */
async function fillOneSpecValue(ev, keyword) {
  // ① 展开
  const opened = await openPicker(ev)
  if (!opened) return { ok: false, picked: null, reason: '打不开 cascader' }
  await sleep(3000)

  // ② 输入关键词（空则看全部）
  let picked = null
  if (keyword) {
    await typeInPicker(ev, keyword)
    await sleep(2500)
    picked = await pickMenuItem(ev, 0)
  }

  // ③ 关键词没匹配上 → 清空，取第一个标准色（保证有值，发布不被拦）
  if (!picked) {
    if (keyword) {
      await typeInPicker(ev, '')
      await sleep(2500)
    }
    picked = await pickMenuItem(ev, 0)
  }
  if (!picked) {
    await closePicker(ev)
    return { ok: false, picked: null, reason: '无可用选项' }
  }

  // ④ 关面板前先等 React 把新值写进 state（pickerLabels 增加）
  //    Ant Design cascader 选中后面板会自动关，且新增一个规格值 chip
  for (let i = 0; i < 6; i++) {
    await sleep(1000)
    const labels = await ev(() => [...document.querySelectorAll('.ecom-g-cascader-picker-label')]
      .map(l => (l.textContent || '').trim()).filter(Boolean))
    if (labels && labels.length > 0 && !labels.includes(picked) === false) break
    // 值已进 labels 就退出
    if (labels && labels.some(l => l.includes(picked.split('/').pop()))) break
  }
  await closePicker(ev)
  await sleep(3000)
  return { ok: true, picked }
}

/**
 * 填 SKU 规格值 + 价格库存
 *
 * @param {Object} sku  {
 *   values: ["红茶","白茶"],     ← 规格值（会在 cascader 里搜这些词）
 *   price: "12",                 ← 单价（元）
 *   stock: "500",                ← 每行库存
 *   totalStock: "1500",          ← 总库存（可选）
 *   itemNo: "YCB001"             ← 货号（可选）
 * }
 */
export async function fillSkuTable(page, sku = {}) {
  const log = []
  const before = await readSkuState(page)
  log.push(`SKU 表：${before.rows} 行；已有规格值：[${(before.pickerLabels || []).join(', ')}]；空入口=${before.hasEmptyPicker ? '有' : '无'}`)

  if (before.hasEmptyPicker === false) {
    return { ok: false, before, after: before, log: [...log, '未找到空的规格值入口（可能类目不匹配或页面未就绪）'] }
  }

  const values = sku.values || []
  if (!values.length) {
    return { ok: false, before, after: before, log: [...log, '未提供 sku.values'] }
  }

  // 用 CDP 直调（页面重绘时 puppeteer evaluate 易 detached）
  const ev = async (fn, ...args) => {
    const expr = `(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(',')})`
    for (let i = 0; i < 6; i++) {
      try {
        const cdp = await page.target().createCDPSession()
        await cdp.send('Runtime.enable')
        const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
        if (r.exceptionDetails) {
          const msg = r.exceptionDetails.text || r.exceptionDetails.exception?.description || ''
          if (/detached|Cannot find|Target closed|Execution context/i.test(msg)) { await sleep(3000); continue }
          return null
        }
        return r.result?.value ?? null
      } catch (e) {
        if (/detached|Execution context|Cannot find|Target closed|Protocol|Session/i.test(String(e?.message))) { await sleep(3000); continue }
        throw e
      }
    }
    return null
  }

  // 逐个填规格值
  const filled = []
  for (const v of values) {
    const r = await fillOneSpecValue(ev, v)
    if (r.ok) {
      filled.push({ value: v, picked: r.picked })
      log.push(`  「${v}」→ 选中「${r.picked}」`)
    } else {
      log.push(`  「${v}」→ 失败（${r.reason}）`)
    }
    await sleep(1500)
  }

  await sleep(4000)
  const after = await readSkuState(page)
  log.push(`填充后：${after.rows} 行，规格值 [${(after.pickerLabels || []).join(', ')}]`)

  // 逐行填价格/库存（如果生成了行）
  if (after.rows > 0) {
    const price = String(sku.price || '')
    const stock = String(sku.stock || '')
    for (let i = 0; i < after.rows; i++) {
      if (price) {
        await ev((idx, val) => {
          const inps = [...document.querySelectorAll('table tbody input')].filter(x => /价格/.test(x.placeholder || ''))
          const inp = inps[idx]
          if (!inp) return
          const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
          set.call(inp, val)
          for (const t of ['input', 'compositionend', 'change', 'keyup', 'blur']) inp.dispatchEvent(new Event(t, { bubbles: true }))
        }, i, price)
      }
      if (stock) {
        await ev((idx, val) => {
          const inps = [...document.querySelectorAll('table tbody input')].filter(x => /库存/.test(x.placeholder || ''))
          const inp = inps[idx]
          if (!inp) return
          const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
          set.call(inp, val)
          for (const t of ['input', 'compositionend', 'change', 'keyup', 'blur']) inp.dispatchEvent(new Event(t, { bubbles: true }))
        }, i, stock)
      }
      await sleep(800)
    }
    // 总库存
    if (sku.totalStock) {
      await ev((val) => {
        const inp = [...document.querySelectorAll('input')].find(i => /请输入库存/.test(i.placeholder || ''))
        if (inp) {
          const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
          set.call(inp, val)
          for (const t of ['input', 'compositionend', 'change', 'keyup', 'blur']) inp.dispatchEvent(new Event(t, { bubbles: true }))
        }
      }, String(sku.totalStock))
    }
    const final = await readSkuState(page)
    log.push(`价格/库存填完：${final.rows} 行，${final.filledRows} 行有值`)
    return { ok: final.filledRows > 0, before, after: final, log }
  }

  log.push('⚠️ 规格值已选中但表格未生成行（需研究确认动作）')
  return { ok: false, before, after, log }
}
