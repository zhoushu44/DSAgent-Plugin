/**
 * fill-by-group.mjs — 通用规格填充：按「组」配对，不区分预设/自定义
 *
 * 页面结构（实测，各品类通用）：
 *   每个规格值 = 一组
 *   .package-item-container 或 .custom-input-container
 *     ☐ input[type=checkbox]         ← 点这一组
 *     [规格名输入框]                  ← 第 1 个 text input（预设值可能预填，也可能为空）
 *     [备注输入框]                    ← 第 2 个，不写
 *
 * 规则（用户明确要求）：
 *   ① 第 i 个值 → 第 i 组，绝不共用第 1 个输入框
 *   ② 先输值，再勾选
 *   ③ 预设值组：输入框可能已有值（如"白色"），匹配到就直接勾选
 *   ④ 自定义组：输入框为空，写入目标值再勾选
 *   ⑤ 组不够 → 找「自定义」/「添加」按钮生成新组
 */

/**
 * @param {object} page
 * @param {string} dimName 维度名
 * @param {string[]} values 目标值
 * @param {object} [dim] 模板维度（allowCustom / isAllValue）
 */
export async function fillByGroup(page, dimName, values, dim = {}) {
  const results = []

  for (let idx = 0; idx < values.length; idx++) {
    const v = values[idx]
    const r = await page.evaluate(async (args) => {
      const { name, val, index, allowCustom, isAllValue } = args
      const norm = s => String(s || '').replace(/[\s\u3000]/g, '').trim()
      const sleepIn = ms => new Promise(x => setTimeout(x, ms))

      // ── 找维度容器 ──
      let box = null
      for (const c of document.querySelectorAll('.property-container-v2')) {
        if (norm(c.querySelector('.property-name-title')?.innerText) === norm(name)) { box = c; break }
      }
      if (!box) return { ok: false, reason: `找不到维度「${name}」` }

      // ── 收集所有组（预设 + 自定义）──
      const GROUP_SEL = '.package-item-container, .custom-input-container'
      const collect = () => [...box.querySelectorAll(GROUP_SEL)]

      // 组内取「规格名输入框」（第 1 个 text input，排除备注）
      const nameInputOf = (g) => {
        const all = [...g.querySelectorAll('input')].filter(e =>
          ['text', '', 'number'].includes((e.type || 'text').toLowerCase()))
        const isNote = e => /备注|说明|note/i.test(e.placeholder || '')
        const cand = all.filter(e => !isNote(e))
        return cand[0] || null
      }

      const wantNorm = norm(val)
      let groups = collect()

      // ══ 兜底模式：没有 group 容器 → 裸输入框按顺序配对 ══
      //    典型：运动鞋「颜色分类」= [选择或输入主色] [备注] [上传] × N 行
      if (!groups.length) {
        const isNote = e => /备注|说明|note/i.test(e.placeholder || '')
        const bareInputs = [...box.querySelectorAll('input')].filter(e => {
          const t = (e.type || 'text').toLowerCase()
          if (t !== 'text' && t !== '' && t !== 'number') return false
          if (isNote(e)) return false
          return true
        })
        if (!bareInputs.length) {
          return { ok: false, reason: `维度「${name}」里没有可用输入框`, groupCount: 0 }
        }
        const inp = bareInputs[index]
        if (!inp) {
          return { ok: false, reason: `第 ${index + 1} 个输入框不存在（共 ${bareInputs.length} 个）`, groupCount: 0, available: bareInputs.map(e => e.placeholder) }
        }

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        inp.focus()
        if (setter) setter.call(inp, String(val)); else inp.value = String(val)
        inp.dispatchEvent(new Event('input', { bubbles: true }))
        inp.dispatchEvent(new Event('change', { bubbles: true }))
        await sleepIn(200)
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
        inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
        await sleepIn(250)
        inp.dispatchEvent(new Event('blur', { bubbles: true }))
        await sleepIn(250)

        return {
          ok: true,
          mode: 'bare-input',
          hasCheckbox: false,
          groupIndex: index,
          groupCount: bareInputs.length,
          wrote: String(val),
          valueNow: inp.value,
          cbChecked: null,
        }
      }

      // ── ① 先在已有组里找「值相等」的预设组 ──
      let target = groups.find(g => {
        const inp = nameInputOf(g)
        const inVal = norm(inp?.value || '')
        const wrapper = norm(g.querySelector('.check-wrapper')?.innerText || '')
        const whole = norm(g.innerText || '')
        return inVal === wantNorm || wrapper === wantNorm || wrapper.includes(wantNorm) || whole.includes(wantNorm)
      })

      let mode = 'preset'

      // ── ② 没找到 → 用第 index 组（自定义输入），或找空组 ──
      if (!target) {
        mode = 'custom'
        if (!(allowCustom || isAllValue || true)) {
          return { ok: false, reason: `「${val}」不在可选范围`, groupCount: groups.length }
        }

        // 优先：第 index 组且输入框为空
        if (groups[index]) {
          const inp = nameInputOf(groups[index])
          if (inp && !norm(inp.value)) target = groups[index]
        }
        // 其次：任何输入框为空的组
        if (!target) target = groups.find(g => { const inp = nameInputOf(g); return inp && !norm(inp.value) })
        // 再其次：找「自定义」组
        if (!target) target = groups.find(g => /自定义/.test(g.innerText || ''))
        // 最后：点「添加」生成新组
        if (!target) {
          const addBtn = [...box.querySelectorAll('button, a, span, div')].find(e => {
            const t = norm(e.innerText)
            return /^(\+)?(添加|新增)(规格值|自定义|更多)?$/.test(t) && e.getBoundingClientRect().width > 10 && e.children.length <= 2
          })
          if (addBtn) {
            addBtn.click()
            await sleepIn(600)
            groups = collect()
            target = groups[groups.length - 1]
          }
        }
        if (!target) return { ok: false, reason: `「${val}」没有可用组（共 ${groups.length} 组）`, groupCount: groups.length, available: groups.map(g => norm(g.innerText)).slice(0, 20) }
      }

      // ── ③ 先输值（自定义模式才写；预设模式值已存在就不动）──
      const inp = nameInputOf(target)
      let wrote = null
      if (inp) {
        const cur = norm(inp.value)
        if (!cur || (mode === 'custom' && cur !== wantNorm)) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          inp.focus()
          if (setter) setter.call(inp, String(val)); else inp.value = String(val)
          inp.dispatchEvent(new Event('input', { bubbles: true }))
          inp.dispatchEvent(new Event('change', { bubbles: true }))
          await sleepIn(150)
          inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
          inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
          await sleepIn(200)
          inp.dispatchEvent(new Event('blur', { bubbles: true }))
          await sleepIn(200)
          wrote = String(val)
        }
      }

      // ── ④ 再勾选这一组（有 checkbox 才勾；纯输入组没有 checkbox 就跳过）──
      const cb = target.querySelector('input[type="checkbox"]')
      let cbState = null
      let hasCheckbox = false
      if (cb) {
        hasCheckbox = true
        if (!cb.checked) { cb.click(); await sleepIn(250) }
        cbState = cb.checked
      } else {
        const lab = target.querySelector('label')
        if (lab) { lab.click(); await sleepIn(200) }
        const sq = target.querySelector('div[class*="CBX_hasCheckSquare"]')
        if (sq) {
          hasCheckbox = true
          if (!/CBX_active_/.test(sq.className)) { sq.click(); await sleepIn(200) }
          cbState = /CBX_active_/.test(sq.className)
        }
        // ★ 纯输入组（如运动鞋颜色分类）：没有勾选框，只要把值写进输入框即可
      }

      return {
        ok: true,
        mode,
        hasCheckbox,
        groupIndex: groups.indexOf(target),
        groupCount: groups.length,
        wrote,
        valueNow: inp ? inp.value : '',
        cbChecked: cbState,
      }
    }, { name: dimName, val: v, index: idx, allowCustom: dim?.allowCustom, isAllValue: dim?.isAllValue })
      .catch(e => ({ ok: false, reason: String(e.message).slice(0, 150) }))

    if (!r.ok) { results.push({ value: v, ok: false, error: r.reason, available: r.available }); continue }
    // ★ 校验：有勾选框要勾上；纯输入组只要值写进去了就算成功
    const valueOk = r.hasCheckbox
      ? (r.cbChecked !== false)
      : (r.valueNow === v || r.mode === 'preset')
    results.push({
      value: v,
      ok: valueOk,
      ...r,
    })
  }

  const ok = results.every(x => x.ok)
  return {
    ok,
    results,
    error: ok ? '' : results.filter(x => !x.ok).map(x => `${x.value}:${x.error || '校验失败'}`).join('; '),
  }
}

export default fillByGroup
