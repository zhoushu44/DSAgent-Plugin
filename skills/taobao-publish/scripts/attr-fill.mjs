/**
 * 淘宝发布组件 · 类目属性（通用版）
 *
 * ★ 为什么需要这个组件
 *   原引擎（lib/taobao-publish.js fillCategoryAttrs）在手机壳类目读到 0 项属性：
 *     pItems: 6, labelsAll: 66, labelsRequired: 0, labelsInRoot: 0
 *   页面明明有 6 个属性项、66 个 label，但扫描器没匹配到预期结构。
 *   参考拼多多的做法：**双路径采集** + **渲染稳定等待** + **两类控件分别校验**。
 *
 * ★ 与拼多多 attr-fill-generic 的对应关系
 *   | 拼多多              | 淘宝                        |
 *   | 单选下拉 inputValue | next-select，同样写 input.value |
 *   | 多选下拉 boxText    | 淘宝少见多选属性，仍兼容     |
 *   | 重要=必填           | 「*」或「必填」前缀          |
 *   | 级联 7→8 字段       | 品牌→型号 也是级联（引擎已见）|
 *
 * 用法：
 *   const { fields } = await harvestAttrs(page, { log })
 *   const r = await fillAttrs(page, { '材质': '棉' }, { log })
 */

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 采集类目属性（双路径 + 渲染稳定）
 *
 * 路径 A：扫带 struct-p-* id 的属性容器
 * 路径 B：扫所有 label，找它后面的控件（补齐 A 漏的）
 */
export async function harvestAttrs(page, opts = {}) {
  const log = opts.log || (() => {})

  // ★ 渲染稳定等待（用 .sell-catProp-item* 计数，比 struct-p-* 准）
  let lastCount = 0
  let stable = 0
  const t0 = Date.now()
  for (let w = 0; w < 30; w++) {
    const cnt = await page.evaluate(() => {
      // 用真实属性项容器计数（排除空壳 struct-p-*）
      return document.querySelectorAll('.sell-catProp-item-common, .sell-catProp-item').length
    }).catch(() => 0)
    if (cnt > 0 && cnt === lastCount) {
      stable++
      if (stable >= 3 && Date.now() - t0 >= 1500) break
    } else {
      stable = 0
    }
    lastCount = cnt
    await sleep(400)
  }
  log(`[attr] 属性区渲染稳定：${lastCount} 个属性项`)

  // ── 双路径采集 ──
  const fields = await page.evaluate(() => {
    const out = []
    const seen = new Set()

    const isVisible = el => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }

    const normLabel = s => String(s || '')
      .replace(/^[\s*＊]+/, '')
      .replace(/\s+/g, ' ')
      .trim()

    // 判断必填：★ 淘宝的标记方式有四种，都要认
    //   ① label 带 .required 类（最常见）
    //   ② label 文本含 * 或「必填」
    //   ③ 容器 class 含 required
    //   ④ 容器内有 .required 子元素
    const isRequired = (labelEl, container) => {
      if (labelEl?.classList?.contains('required')) return true
      if (labelEl?.querySelector?.('.required')) return true
      const raw = (labelEl?.innerText || '') + (labelEl?.textContent || '')
      if (/[*＊]|必填/.test(raw)) return true
      if (container) {
        const c = container.className || ''
        if (/required/i.test(c.toString())) return true
        if (container.querySelector('.required')) return true
      }
      return false
    }

    // ── 路径 A：从 **label 反向定位**属性项 ──
    //   ★ 关键：淘宝属性区有**两套 DOM 并存**
    //     · #struct-catProp 里 struct-p-* → 空壳/真 UI 混合
    //     · 页面其它区域有大量单选项（全新/是/否/发货时间/拍下减库存…）
    //   所以必须**严格限定在属性项容器内**，不能扫全页 label。
    const labelSet = new Set()
    // ★ 唯一可靠入口：.sell-catProp-item* 属性项容器
    for (const item of document.querySelectorAll('.sell-catProp-item-common, .sell-catProp-item')) {
      if (item.offsetParent === null) continue
      const lb = [...item.querySelectorAll('label')].find(l => (l.innerText || '').trim())
      if (lb) labelSet.add(lb)
    }
    // 补充：label.required 且必须在属性区内（限定 closest，不放开）
    for (const l of document.querySelectorAll('label.required')) {
      if (l.closest('.sell-catProp-item-common, .sell-catProp-item, #struct-catProp')) labelSet.add(l)
    }

    for (const labelEl of labelSet) {
      if (!isVisible(labelEl)) continue
      const name = normLabel(labelEl.innerText)
      if (!name || name.length > 20) continue
      if (seen.has(name)) continue

      // 从 label 往上找属性项容器（带 struct-p-* id 或 sell-catProp-item）
      // ★ 2026-10-31 修复：原写法用 `box` 做循环变量，循环结束时 box 已经是 null，
      //   导致 `if (!box)` 永远成立 → 退化成 labelEl.parentElement.parentElement，
      //   于是「全新/是/否」这些单选项也被当成属性采进来。改用独立变量 cur。
      let container = null
      let itemId = ''
      let cur = labelEl
      for (let d = 0; d < 8 && cur; d++) {
        if (cur.id && /^struct-p-/.test(cur.id)) { container = cur; itemId = cur.id; break }
        if (cur.className && /sell-catProp-item/.test(cur.className.toString())) { container = cur; itemId = cur.id || ''; break }
        cur = cur.parentElement
      }
      if (!container) {
        // 严格要求：必须在属性区内，否则不是类目属性
        const propArea = labelEl.closest('[class*="catProp"], [id^="struct-p-"]')
        if (!propArea) continue
        container = propArea
      }

      // ★ 空壳过滤：容器里必须有可见的输入控件
      const inputs = [...container.querySelectorAll('input')].filter(i => {
        const r = i.getBoundingClientRect()
        return r.width > 20 && r.height > 10
      })
      if (!inputs.length) continue

      const input = inputs[0]
      // ★ 排除单选项（实测：淘宝单选项的 input 也是 type=text 且 value="on"，
      //   不能只看 type。判据：value === 'on' 且容器内含 radio 类名 / 有 name 属性分组）
      const isRadioLike = inputs.every(i => {
        const v = String(i.value || '').toLowerCase()
        const cls = (i.className || '').toString()
        const parentCls = (i.parentElement?.className || '').toString()
        if (i.type === 'radio' || i.type === 'checkbox') return true
        if (v === 'on' && (i.name || /radio|checkbox/i.test(cls + parentCls))) return true
        return false
      })
      if (isRadioLike) continue

      seen.add(name)
      out.push({
        name,
        id: itemId,
        required: isRequired(labelEl, container),
        kind: input.readOnly || input.getAttribute('role') === 'combobox' ? 'select' : 'text',
        value: input.value || '',
        placeholder: input.placeholder || '',
        inputCount: inputs.length,
      })
    }

    // ★ 路径 B 已删除：会扫到全页 label（全新/是/否/发货时间/拍下减库存…）
    //   属性只从 .sell-catProp-item* 容器采集（见上方路径 A）

    return out.filter(f => f.name).slice(0, 60)
  }).catch(() => [])

  const reqCount = fields.filter(f => f.required).length
  log(`[attr] 采集到 ${fields.length} 个属性，其中必填 ${reqCount} 个`)
  fields.forEach(f => {
    if (f.required) log(`[attr]   ★必填「${f.name}」${f.kind}="${f.value}"`)
  })

  return { fields }
}

/**
 * 读某个属性下拉的候选（next-select）
 */
async function readPropOptions(page, propId) {
  return page.evaluate((id) => {
    const box = document.getElementById(id)
    if (!box) return []
    // 已展开的 next-overlay / 下拉面板
    const panels = [...document.querySelectorAll('.next-overlay-wrapper.opened, [class*="next-menu"], [class*="next-select-menu"]')]
      .filter(x => x.offsetParent !== null)
    const panel = panels[panels.length - 1]
    if (!panel) return []
    const out = []
    const seen = new Set()
    for (const n of panel.querySelectorAll('li, [role="option"], [class*="next-menu-item"]')) {
      const t = (n.innerText || '').trim()
      if (!t || seen.has(t) || t.length > 40) continue
      seen.add(t)
      out.push(t)
    }
    return out
  }, propId).catch(() => [])
}

/**
 * 打开属性下拉
 */
async function openProp(page, propId) {
  return page.evaluate((id) => {
    const box = document.getElementById(id)
    if (!box) return false
    const trigger = box.querySelector('[class*="next-select"]')
      || box.querySelector('input')
    if (!trigger) return false
    trigger.scrollIntoView({ block: 'center' })
    trigger.click()
    try { trigger.focus?.() } catch { /* ignore */ }
    return true
  }, propId).catch(() => false)
}

/**
 * 点选项（真实鼠标）
 */
async function clickOption(page, want) {
  const pos = await page.evaluate((w) => {
    const panels = [...document.querySelectorAll('.next-overlay-wrapper.opened, [class*="next-menu"], [class*="next-select-menu"]')]
      .filter(x => x.offsetParent !== null)
    const panel = panels[panels.length - 1]
    if (!panel) return null
    const norm = s => String(s || '').replace(/\s+/g, '')
    const nodes = [...panel.querySelectorAll('li, [role="option"], [class*="next-menu-item"]')]
      .filter(n => (n.innerText || '').trim())
    const W = norm(w)
    let hit = nodes.find(n => (n.innerText || '').trim() === w)
    if (!hit) hit = nodes.find(n => norm(n.innerText) === W)
    if (!hit) {
      const cands = nodes
        .filter(n => { const t = norm(n.innerText); return t.includes(W) || W.includes(t) })
        .sort((a, b) => norm(a.innerText).length - norm(b.innerText).length)
      hit = cands[0]
    }
    if (!hit) return null
    hit.scrollIntoView({ block: 'center' })
    const r = hit.getBoundingClientRect()
    if (r.width < 5) return null
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (hit.innerText || '').trim() }
  }, want).catch(() => null)

  if (!pos) return null
  await page.mouse.click(pos.x, pos.y)
  await sleep(400)
  return pos.text
}

/**
 * 校验属性是否已填（同时看 inputValue 和容器文本）
 */
async function verifyAttr(page, propId, want, name) {
  return page.evaluate(({ id, w, n }) => {
    const box = id ? document.getElementById(id) : null
    if (!box) {
      // 没有 id 的容器：按 label 找
      for (const lb of document.querySelectorAll('label')) {
        if ((lb.innerText || '').trim() !== n) continue
        let cur = lb.parentElement
        for (let d = 0; d < 6 && cur; d++) {
          const inp = cur.querySelector('input')
          if (inp) {
            const v = inp.value || ''
            const text = (cur.innerText || '').replace(/\n/g, '|')
            return { ok: v.includes(w) || text.includes(w), inputValue: v, boxText: text.slice(0, 150) }
          }
          cur = cur.parentElement
        }
      }
      return { ok: false, inputValue: '', boxText: '' }
    }
    const inp = box.querySelector('input')
    const inputValue = inp?.value || ''
    const boxText = (box.innerText || '').replace(/\n/g, '|')
    return { ok: inputValue.includes(w) || boxText.includes(w), inputValue, boxText: boxText.slice(0, 150) }
  }, { id: propId, w: want, n: name }).catch(() => ({ ok: false, inputValue: '', boxText: '' }))
}

/**
 * 填类目属性（两阶段：先全点选，再统一校验）
 *
 * @param page
 * @param values { [属性名]: 值 }
 * @param opts { log?, fields? }
 */
export async function fillAttrs(page, values, opts = {}) {
  const log = opts.log || (() => {})
  const fields = opts.fields || (await harvestAttrs(page, opts)).fields

  const filled = []
  const missed = []
  const clicked = []

  const cleanValue = v => String(v || '')
    .replace(/（缓存命中）/g, '').replace(/（显式指定）/g, '').replace(/（模板）/g, '')
    .trim()

  // ── 阶段 1：全部点选 ──
  for (const [name, rawWant] of Object.entries(values || {})) {
    const want = cleanValue(rawWant)
    if (!want) continue

    const f = fields.find(x => x.name === name)
      || fields.find(x => x.name.includes(name) || name.includes(x.name))
    if (!f) {
      missed.push(`${name}（未找到字段）`)
      continue
    }

    if (f.kind === 'text') {
      // 文本型：直接填
      const ok = await page.evaluate(({ id, n, v }) => {
        let el = id ? document.getElementById(id)?.querySelector('input') : null
        if (!el) {
          for (const lb of document.querySelectorAll('label')) {
            if ((lb.innerText || '').trim() !== n) continue
            let cur = lb.parentElement
            for (let d = 0; d < 6 && cur; d++) {
              const inp = cur.querySelector('input')
              if (inp) { el = inp; break }
              cur = cur.parentElement
            }
            if (el) break
          }
        }
        if (!el) return false
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        el.focus()
        setter.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        el.dispatchEvent(new Event('blur', { bubbles: true }))
        return true
      }, { id: f.id, n: f.name, v: want }).catch(() => false)

      if (ok) clicked.push({ name, want, id: f.id, kind: 'text' })
      else missed.push(`${name}（文本填写失败）`)
      continue
    }

    // 下拉型
    if (!(await openProp(page, f.id))) {
      missed.push(`${name}（下拉打不开）`)
      continue
    }
    await sleep(350)

    const picked = await clickOption(page, want)
    if (!picked) {
      await page.keyboard.press('Escape').catch(() => {})
      missed.push(`${name}（候选里没有「${want}」）`)
      continue
    }
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(120)
    clicked.push({ name, want, id: f.id, kind: 'select', picked })
  }

  // ── 阶段 2：统一校验 ──
  if (clicked.length) {
    await sleep(400)
    for (const item of clicked) {
      const v = await verifyAttr(page, item.id, item.want, item.name)
      if (v.ok) {
        filled.push(`${item.name}=${item.want}`)
        log(`[attr] 「${item.name}」= ${item.want} ✅`)
      } else {
        missed.push(`${item.name}（未确认）`)
        log(`[attr] 「${item.name}」= ${item.want} ❌ input="${v.inputValue}" text="${v.boxText}"`)
      }
    }
  }

  // ★ 2026-10-31：填完后**关闭所有残留下拉**（实测材质下拉会一直开着挡住后面的操作）
  try {
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(200)
    await page.evaluate(() => {
      // 点页面空白处
      const vp = { w: window.innerWidth, h: window.innerHeight }
      const el = document.elementFromPoint(Math.round(vp.w / 2), 60)
      if (el) el.click()
    }).catch(() => {})
    await sleep(300)
    log('[attr] 已关闭残留下拉')
  } catch { /* ignore */ }

  log(`[attr] 已填 ${filled.length} 项，未填 ${missed.length} 项`)
  return { filled, missed, fields }
}

/**
 * 复核必填项（参考拼多多 checkFieldFilled）
 */
export async function checkRequiredFilled(page, fields, opts = {}) {
  const log = opts.log || (() => {})
  const missing = []

  for (const f of fields.filter(x => x.required)) {
    const v = await page.evaluate(({ id, n }) => {
      let box = id ? document.getElementById(id) : null
      if (!box) {
        for (const lb of document.querySelectorAll('label')) {
          if ((lb.innerText || '').trim() !== n) continue
          let cur = lb.parentElement
          for (let d = 0; d < 6 && cur; d++) {
            if (cur.querySelector('input')) { box = cur; break }
            cur = cur.parentElement
          }
          if (box) break
        }
      }
      if (!box) return ''
      const inp = box.querySelector('input')
      const inputValue = (inp?.value || '').trim()
      const boxText = (box.innerText || '').replace(/\n/g, '|')
      let rest = boxText
        .replace(/[*＊]|必填|请选择|请输入/g, '')
        .replace(/[|｜\s？?。，,、：:；;！!…]+/g, '')
        .trim()
      const ln = String(n).replace(/\s+/g, '')
      if (ln) rest = rest.split(ln).join('')
      return inputValue || rest
    }, { id: f.id, n: f.name }).catch(() => '')

    if (!v) missing.push(f.name)
  }

  if (missing.length) {
    log(`[attr] ⚠⚠ 必填未填：${missing.join('、')}`)
  } else {
    log(`[attr] ✅ 所有必填项（${fields.filter(x => x.required).length} 个）已填`)
  }
  return { missing }
}
