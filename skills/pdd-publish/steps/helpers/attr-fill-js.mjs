/**
 * attr-fill-js.mjs — 属性 JS 直填（提速版）
 *
 * 相比 modules/04-select 的 selectOptions，本组件：
 *   ① 全部改用轮询代替固定 sleep（快 3 倍）
 *   ② 多选面板用 window 派发 mousedown 关闭（唯一可靠的纯 JS 方式）
 *   ③ 支持成分列表组件（IngredientList）
 *
 * ════════════════════════════════════════════════════════════════
 *  实测数据（童装家居服 catId=15021，17 个属性）
 *
 *  旧 selectOptions:  39.4s（2.32s/个）
 *  本组件:            13.0s（0.87s/个）
 * ════════════════════════════════════════════════════════════════
 */

/**
 * 关闭所有下拉面板（多选必须手动关）
 * ★ 平台监听的是 window 上的 mousedown，必须派发到 window
 *   （document.body.click() / Esc / 点标题 都无效，实测过）
 */
export async function closeAllDropPanels(page) {
  return page.evaluate(() => {
    const ev = (t) => window.dispatchEvent(new MouseEvent(t, {
      bubbles: true, cancelable: true, view: window, clientX: 10, clientY: 10,
    }))
    ev('mousedown'); ev('mouseup'); ev('click')
  }).catch(() => { })
}

/**
 * 填一个下拉属性（JS 直填，轮询版）
 *
 * @param {object} page
 * @param {string} label       属性名（如「面料俗称」）
 * @param {string|string[]} values  要选的值（单选传 1 个，多选可传多个）
 * @param {object} [opts]      { log, timeoutMs }
 * @returns {Promise<{ok:boolean, label, picked:string[], isMulti:boolean, error?:string}>}
 */
export async function fillSelectByJs(page, label, values, opts = {}) {
  const log = opts.log || (() => { })
  const vals = (Array.isArray(values) ? values : [values]).map(String).filter(Boolean)
  if (!vals.length) return { ok: false, label, picked: [], error: '无值' }

  const res = { ok: false, label, picked: [], isMulti: false }

  for (let vi = 0; vi < vals.length; vi++) {
    const want = vals[vi]

    const r = await page.evaluate(async (args) => {
      const { label, want } = args
      const norm = s => String(s || '').replace(/[\s\u3000]/g, '').trim()
      const sl = ms => new Promise(x => setTimeout(x, ms))

      // ① 先关掉所有旧面板
      const closeAll = () => {
        const ev = (t) => window.dispatchEvent(new MouseEvent(t, {
          bubbles: true, cancelable: true, view: window, clientX: 10, clientY: 10,
        }))
        ev('mousedown'); ev('mouseup'); ev('click')
      }
      closeAll()
      for (let i = 0; i < 50; i++) {
        const n = [...document.querySelectorAll('ul[role="listbox"]')].filter(e => {
          const rr = e.getBoundingClientRect(); return rr.width > 0 && rr.height > 0
        }).length
        if (n === 0) break
        await sl(10)
      }

      // ② 找 form-item
      let item = null
      for (const it of document.querySelectorAll('[data-testid="beast-core-form-item"]')) {
        if (norm(it.querySelector('label')?.innerText).replace(/^重要/, '') === label) { item = it; break }
      }
      if (!item) return { ok: false, reason: '属性不存在' }

      const sel = item.querySelector('[data-testid="beast-core-select"]')
      if (!sel) return { ok: false, reason: '不是下拉框' }
      const inp = sel.querySelector('[data-testid="beast-core-select-htmlInput"]')
      if (!inp) return { ok: false, reason: '没有 input' }

      const isMulti = !!sel.querySelector('[class*="ST_selectValueMultiple"]')

      // ③ 点开下拉
      const h = sel.querySelector('[data-testid="beast-core-select-header"]') || inp
      inp.scrollIntoView({ block: 'center' })
      h.click()

      // ④ 轮询等 listbox 出现
      const getLb = () => {
        const lbs = [...document.querySelectorAll('ul[role="listbox"]')].filter(e => {
          const rr = e.getBoundingClientRect(); return rr.width > 0 && rr.height > 0
        })
        return lbs.length ? lbs[lbs.length - 1] : null   // ★ 取最后一个（最新打开的）
      }
      let lb = null
      for (let i = 0; i < 200; i++) {
        lb = getLb()
        if (lb && lb.querySelectorAll('li[role="option"]').length) break
        await sl(10)
      }
      if (!lb) return { ok: false, reason: '下拉未出现', isMulti }

      let opts = [...lb.querySelectorAll('li[role="option"]')]
      const findHit = () => opts.find(e => {
        const t = String(e.innerText || '').replace(/\s+/g, '').trim()
        const w = String(want).replace(/\s+/g, '').trim()
        return t === w || t.includes(w) || w.includes(t)
      })
      let hit = findHit()

      // ⑤ 找不到 → 输入筛选（虚拟列表必须这么做）
      if (!hit) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        inp.focus()
        if (setter) setter.call(inp, want); else inp.value = want
        inp.dispatchEvent(new Event('input', { bubbles: true }))
        inp.dispatchEvent(new Event('change', { bubbles: true }))

        for (let i = 0; i < 200; i++) {
          await sl(10)
          const l2 = getLb()
          if (!l2) continue
          opts = [...l2.querySelectorAll('li[role="option"]')]
          hit = findHit()
          if (hit) break
        }
      }

      if (!hit) {
        const all = opts.map(e => (e.innerText || '').trim()).filter(Boolean)
        closeAll()
        return { ok: false, reason: '找不到选项', available: all.slice(0, 12), isMulti }
      }

      // ⑥ 点选
      const pickedText = (hit.innerText || '').trim()
      hit.click()

      // ⑦ 轮询等生效
      let filled = false
      for (let i = 0; i < 200; i++) {
        await sl(10)
        if (isMulti) {
          filled = sel.querySelectorAll('[data-testid="beast-core-tagGroup-tag"]').length > 0
        } else {
          filled = String(inp.value || '').trim().length > 0
        }
        if (filled) break
      }

      // ⑧ 多选要手动关面板
      if (isMulti) {
        closeAll()
        for (let i = 0; i < 50; i++) {
          const n = [...document.querySelectorAll('ul[role="listbox"]')].filter(e => {
            const rr = e.getBoundingClientRect(); return rr.width > 0 && rr.height > 0
          }).length
          if (n === 0) break
          await sl(10)
        }
      }

      // ⑨ 读回
      let readBack = ''
      if (isMulti) {
        readBack = [...sel.querySelectorAll('[data-testid="beast-core-tagGroup-tag"]')]
          .map(e => (e.innerText || '').trim()).filter(Boolean).join(' | ')
      } else {
        readBack = String(inp.value || '').trim()
      }

      return { ok: filled, picked: pickedText, isMulti, readBack }
    }, { label, want }).catch(e => ({ ok: false, reason: String(e.message).slice(0, 100) }))

    if (!r.ok) {
      res.error = r.reason || '填充失败'
      res.available = r.available
      res.isMulti = r.isMulti
      log(`      ${label}「${want}」❌ ${res.error}`)
      return res
    }

    res.picked.push(r.picked)
    res.isMulti = r.isMulti
    res.readBack = r.readBack
    log(`      ${label}「${r.picked}」✅ ${r.isMulti ? '[多选]' : ''} → 回读 ${JSON.stringify(r.readBack)}`)
    await page.evaluate(() => new Promise(r => setTimeout(r, 40)))
  }

  res.ok = res.picked.length === vals.length
  return res
}

/**
 * 填成分列表（材质成分这类）
 *
 * 页面结构：
 *   <button><span class="IngredientList_addBtn">添加材质成分(0/7)</span></button>
 *   点开 → .IngredientList_checkItem 列表 → 勾选 → 点「确定(N/M)」
 */
export async function fillIngredientByJs(page, label, values, opts = {}) {
  const log = opts.log || (() => { })
  const vals = (Array.isArray(values) ? values : [values]).map(String).filter(Boolean)
  const res = { ok: false, label, picked: [] }

  const r = await page.evaluate(async (args) => {
    const { label, wants } = args
    const norm = s => String(s || '').replace(/[\s\u3000]/g, '').trim()
    const sl = ms => new Promise(x => setTimeout(x, ms))

    // 关旧面板
    const closeAll = () => {
      const ev = (t) => window.dispatchEvent(new MouseEvent(t, {
        bubbles: true, cancelable: true, view: window, clientX: 10, clientY: 10,
      }))
      ev('mousedown'); ev('mouseup'); ev('click')
    }
    closeAll()
    await sl(300)

    let item = null
    for (const it of document.querySelectorAll('[data-testid="beast-core-form-item"]')) {
      if (norm(it.querySelector('label')?.innerText) === label) { item = it; break }
    }
    if (!item) return { ok: false, reason: '属性不存在' }

    const btn = [...item.querySelectorAll('button')].find(b => /添加|继续添加/.test(b.innerText || ''))
    if (!btn) return { ok: false, reason: '找不到添加按钮' }
    btn.scrollIntoView({ block: 'center' })
    btn.click()

    // 轮询等面板
    let items = []
    for (let i = 0; i < 200; i++) {
      await sl(10)
      items = [...document.querySelectorAll('[class*="IngredientList_checkItem"]')]
      if (items.length) break
    }
    if (!items.length) return { ok: false, reason: '面板未出现' }

    const picked = []
    for (const want of wants) {
      let found = null
      for (const it2 of items) {
        const box = it2.querySelector('[data-testid="beast-core-checkbox"]')
        if (!box) continue
        const t = String(box.innerText || '').replace(/\s+/g, '').trim()
        if (t === want || t.includes(want) || want.includes(t)) { found = { box, text: t }; break }
      }
      if (!found) {
        const all = items.map(i => String(i.innerText || '').replace(/\s+/g, '').trim()).filter(Boolean)
        closeAll()
        return { ok: false, reason: '找不到成分「' + want + '」', available: all.slice(0, 15) }
      }
      if (found.box.getAttribute('data-checked') !== 'true') {
        found.box.click()
        await sl(120)
      }
      picked.push(found.text)
    }

    // 轮询等「确定」可用
    let okBtn = null
    for (let i = 0; i < 100; i++) {
      await sl(10)
      okBtn = [...document.querySelectorAll('button')].find(b => {
        const t = (b.innerText || '').replace(/\s+/g, '')
        return /^确定/.test(t) && !b.disabled && b.getBoundingClientRect().width > 0
      })
      if (okBtn) break
    }
    if (!okBtn) { closeAll(); return { ok: false, reason: '确定按钮不可用', picked } }

    const okText = (okBtn.innerText || '').replace(/\s+/g, '')
    okBtn.click()

    // 轮询等面板关闭
    for (let i = 0; i < 100; i++) {
      await sl(10)
      if (!document.querySelector('[class*="IngredientList_checkItem"]')) break
    }

    // 读回按钮文字
    const btnNow = [...item.querySelectorAll('button')].find(b => /\(\d+\/\d+\)/.test(b.innerText || ''))
    return { ok: true, picked, okText, btnText: btnNow ? (btnNow.innerText || '').replace(/\s+/g, '') : '' }
  }, { label, wants: vals }).catch(e => ({ ok: false, reason: String(e.message).slice(0, 100) }))

  if (r.ok) {
    res.ok = true
    res.picked = r.picked
    res.btnText = r.btnText
    log(`      ${label}「${r.picked.join(',')}」✅ ${r.okText} → ${r.btnText}`)
  } else {
    res.error = r.reason
    res.available = r.available
    log(`      ${label} ❌ ${r.reason}`)
  }
  return res
}

export default { closeAllDropPanels, fillSelectByJs, fillIngredientByJs }
