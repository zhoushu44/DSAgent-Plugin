/**
 * 发布组件 · 属性填写（通用版 v3，基于真机验证）
 *
 * ★★ 2026-10-30 真机定论 ★★
 *
 *   拼多多属性区结构：
 *     <div class="property-item">
 *       <label>适用场景</label>
 *       <div id="basic.propertys.2.value">
 *         <div data-testid="beast-core-select-header">
 *           <input data-testid="beast-core-select-htmlInput">
 *         </div>
 *       </div>
 *     </div>
 *
 *   两种控件类型（必须区分！）：
 *     ① **单选下拉**：点选项后自动关闭，`input.value` 被写入 → 用 inputValue 校验
 *     ② **多选下拉**：点选项后**面板不关闭**，`input.value` 仍为空，
 *        但 **box.innerText 里会显示已选值** → 用 boxText 校验
 *
 *   ✗ 之前只校验 inputValue → 多选全部误报「未确认」
 *   ✓ 正确判据：inputValue 或 boxText 任一包含目标值
 *
 *   填法：
 *     ① 找字段：从 [id^="basic.propertys."] 往上找 label（最内层、长度<=15）
 *     ② 开下拉：header mousedown/mouseup/click（JS 事件，React 认）
 *     ③ 点选项：**真实鼠标坐标点击**（JS click 对选项无效）
 *     ④ 校验：inputValue 或 boxText 包含目标值
 *     ⑤ 关闭：Escape
 */

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 找某个属性字段的 box id */
async function findFieldBoxId(page, fieldName) {
  return page.evaluate((name) => {
    const root = document.querySelector('#property') || document.querySelector('.goods-propertys')
    if (!root) return ''
    for (const box of root.querySelectorAll('[id^="basic.propertys."]')) {
      let label = ''
      let cur = box
      for (let d = 0; d < 6 && cur; d++) {
        const lb = cur.querySelector('label')
        if (lb) {
          const t = (lb.innerText || '').replace(/重要|必填|[*＊]/g, '').trim()
          if (t && t.length <= 15) { label = t; break }
        }
        cur = cur.parentElement
      }
      if (label === name) return box.id
    }
    return ''
  }, fieldName).catch(() => '')
}

/** 打开下拉 */
async function openDropdown(page, boxId) {
  return page.evaluate((id) => {
    const box = document.getElementById(id)
    if (!box) return false
    const head = box.querySelector('[data-testid="beast-core-select-header"]')
      || box.querySelector('input[data-testid="beast-core-select-htmlInput"]')
    if (!head) return false
    head.scrollIntoView({ block: 'center' })
    for (const ev of ['mousedown', 'mouseup', 'click']) {
      head.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }))
    }
    return true
  }, boxId).catch(() => false)
}

/** 读当前面板选项 */
async function readOptions(page) {
  return page.evaluate(() => {
    const panels = [...document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"], [class*="PP_popover"]')]
      .filter(x => x.offsetParent !== null)
    const panel = panels[panels.length - 1]
    if (!panel) return []
    const out = []
    const seen = new Set()
    for (const n of panel.querySelectorAll('li, [role="option"], [class*="ST_item"]')) {
      const t = (n.innerText || '').trim()
      if (!t || seen.has(t) || t.length > 40) continue
      seen.add(t)
      out.push(t)
    }
    return out
  }).catch(() => [])
}

/** 点某个选项（真实鼠标） */
async function clickOption(page, want) {
  const pos = await page.evaluate((w) => {
    const panels = [...document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"], [class*="PP_popover"]')]
      .filter(x => x.offsetParent !== null)
    const panel = panels[panels.length - 1]
    if (!panel) return null
    const nodes = [...panel.querySelectorAll('li, [role="option"], [class*="ST_item"]')]
    let hit = nodes.find(n => (n.innerText || '').trim() === w)
    if (!hit) hit = nodes.find(n => (n.innerText || '').trim().includes(w))
    if (!hit) return null
    hit.scrollIntoView({ block: 'center' })
    const r = hit.getBoundingClientRect()
    if (r.width < 5) return null
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }, want).catch(() => null)

  if (!pos) return false
  await page.mouse.click(pos.x, pos.y)
  await sleep(700)
  return true
}

/** 校验：inputValue 或 boxText 任一包含目标值 */
async function verifyField(page, boxId, want) {
  return page.evaluate((id, w) => {
    const box = document.getElementById(id)
    if (!box) return { ok: false, inputValue: '', boxText: '' }
    const inp = box.querySelector('input[data-testid="beast-core-select-htmlInput"]')
    const inputValue = inp?.value || ''
    const boxText = (box.innerText || '').replace(/\n/g, '|')
    return {
      ok: inputValue.includes(w) || boxText.includes(w),
      inputValue,
      boxText: boxText.slice(0, 200),
    }
  }, boxId, want).catch(() => ({ ok: false, inputValue: '', boxText: '' }))
}

/**
 * 采集所有属性字段 + 候选值
 *
 * @param page
 * @param opts { log? }
 * @returns { fields: [{ name, id, required, options }] }
 */
export async function harvestAttributes(page, opts = {}) {
  const log = opts.log || (() => {})

  // ① 列出所有字段
  const fields = await page.evaluate(() => {
    const root = document.querySelector('#property') || document.querySelector('.goods-propertys')
    if (!root) return []
    const out = []
    for (const box of root.querySelectorAll('[id^="basic.propertys."]')) {
      let label = ''
      let cur = box
      for (let d = 0; d < 6 && cur; d++) {
        const lb = cur.querySelector('label')
        if (lb) {
          const t = (lb.innerText || '').replace(/重要|必填|[*＊]/g, '').trim()
          if (t && t.length <= 15) { label = t; break }
        }
        cur = cur.parentElement
      }
      if (!label) continue
      out.push({
        name: label,
        id: box.id,
        required: /重要|必填/.test((box.closest('.property-item')?.innerText || '').slice(0, 60)),
        hasSelect: !!box.querySelector('input[data-testid="beast-core-select-htmlInput"]'),
      })
    }
    return out
  }).catch(() => [])

  log(`[attr] 发现 ${fields.length} 个属性字段`)

  // ② 逐个读候选
  for (const f of fields) {
    if (!f.hasSelect) continue
    if (!(await openDropdown(page, f.id))) { f.options = []; continue }
    await sleep(800)
    f.options = await readOptions(page)
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(250)
    log(`[attr] 「${f.name}」${f.options.length} 个候选`)
  }

  return { fields }
}

/**
 * 填属性（通用版）
 *
 * @param page
 * @param values { [fieldName]: value }
 * @param opts { log? }
 * @returns { filled, missed, detail }
 */
export async function fillAttributesGeneric(page, values, opts = {}) {
  const log = opts.log || (() => {})
  const filled = []
  const missed = []
  const detail = []

  for (const [name, want] of Object.entries(values || {})) {
    if (!want) continue

    const boxId = await findFieldBoxId(page, name)
    if (!boxId) {
      missed.push(`${name}（未找到字段）`)
      detail.push({ name, ok: false, err: 'not-found' })
      continue
    }

    if (!(await openDropdown(page, boxId))) {
      missed.push(`${name}（下拉打不开）`)
      detail.push({ name, ok: false, err: 'no-dropdown' })
      continue
    }
    await sleep(800)

    const clicked = await clickOption(page, want)
    if (!clicked) {
      await page.keyboard.press('Escape').catch(() => {})
      missed.push(`${name}（候选里没有「${want}」）`)
      detail.push({ name, ok: false, err: 'option-not-found' })
      continue
    }

    // ★ 多选：面板不关闭，直接校验 boxText
    const verified = await verifyField(page, boxId, want)
    if (verified.ok) {
      filled.push(`${name}=${want}`)
      log(`[attr] 「${name}」= ${want} ✅`)
    } else {
      missed.push(`${name}（未确认）`)
      log(`[attr] 「${name}」= ${want} ❌ input="${verified.inputValue}" text="${verified.boxText}"`)
    }
    detail.push({ name, ok: verified.ok, ...verified })

    await page.keyboard.press('Escape').catch(() => {})
    await sleep(350)
  }

  log(`[attr] 已填 ${filled.length} 项，未填 ${missed.length} 项`)
  return { filled, missed, detail }
}
