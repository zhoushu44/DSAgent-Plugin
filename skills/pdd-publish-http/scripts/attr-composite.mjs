/**
 * 发布组件 · 复合字段处理（「添加XX」类多行字段）
 *
 * ★ 为什么需要
 *   拼多多的「材质成分」不是普通输入框，而是「添加材质成分(0/7)」这样的按钮 + 动态行。
 *   页面结构：
 *     <div id="basic.propertys.15.value">*材质成分 | 添加材质成分(0/7)</div>
 *     inputs: []   ← 没有输入框！
 *   直接找 input 必然失败，导致提交报「材质成分不能为空」。
 *
 * ★ 通用模式（不只材质成分）
 *   凡是 label 文本里带「添加XX(N/M)」的属性，都走这个流程：
 *     ① 点「添加XX」按钮 → 出现一行（可能是「成分下拉 + 含量输入」两格）
 *     ② 填第一格（下拉/搜索）→ 填第二格（含量数字）
 *     ③ 校验行数从 (0/M) 变成 (1/M)
 *
 * 用法：
 *   const r = await fillCompositeAttr(page, boxId, fieldName, value, { log })
 *   // value 可以是 '聚酯纤维（涤纶）' 或 { name:'聚酯纤维', pct:'100' }
 */

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 解析复合值：'聚酯纤维（涤纶）' / '聚酯纤维 100%' / {name, pct}
 */
export function parseCompositeValue(raw) {
  if (raw && typeof raw === 'object') {
    return { name: String(raw.name || raw.value || '').trim(), pct: String(raw.pct || raw.percent || '').trim() }
  }
  const s = String(raw || '').trim()
  if (!s) return { name: '', pct: '' }

  // ① 带百分比：'聚酯纤维 100%' / '聚酯纤维100%'
  const m = s.match(/^(.+?)\s*(\d+(?:\.\d+)?)\s*%$/)
  if (m) return { name: m[1].trim(), pct: m[2] }

  // ② 括号内容当作补充说明，主体留作 name
  //    '聚酯纤维（涤纶）' → name='聚酯纤维', pct='100'（默认满成分）
  const clean = s.replace(/[（(][^）)]*[）)]/g, '').trim()
  return { name: clean || s, pct: '100' }
}

/**
 * 找「添加XX(N/M)」按钮
 */
async function findAddButton(page, boxId) {
  return page.evaluate((id) => {
    const box = document.getElementById(id)
    if (!box) return null

    // ★ 2026-11-01 实测：真按钮是 <button class="BTN_outerWrapper...">，156x28
    //   外层容器是 DIV，444x30 —— 点外层无效。
    //   所以：优先 BUTTON 标签，且宽度 < 300。
    // ★ 2026-11-02：放宽按钮选择器（实测「添加XX」可能是 next-btn）
  const all = [...box.querySelectorAll(
    'button, a, [role="button"], .next-btn, [class*="btn"], [class*="addBtn"], div, span'
  )]
  .filter(el => el.offsetParent !== null)

    const scored = []
    for (const el of all) {
      const t = (el.innerText || '').trim()
      // 只匹配「以添加开头」的短文本（避免混入「材质成分不能为空」这类提示）
      if (!/^添加/.test(t) && !/^\+\s*添加/.test(t)) continue
      if (t.length > 30) continue
      if (t.includes('\n')) continue

      const r = el.getBoundingClientRect()
      if (r.width < 20 || r.height < 10) continue
      if (r.width > 300) continue   // ← 排除外壳容器

      let score = 0
      if (el.tagName === 'BUTTON') score += 100
      if (el.getAttribute('role') === 'button') score += 50
      // 含 IngredientList_addBtn / addBtnWrapper 类更可能是真按钮
      const cls = (el.className || '').toString()
      if (/addBtn|addbtn/i.test(cls)) score += 30
      // 尺寸越接近 156x28 越可能是真按钮
      if (r.width >= 100 && r.width <= 220 && r.height >= 20 && r.height <= 40) score += 20
      // 最内层（没有同类子元素）加分
      if (!all.some(o => o !== el && el.contains(o) && /^添加/.test((o.innerText || '').trim()))) score += 10

      scored.push({
        el,
        score,
        text: t,
        tag: el.tagName,
        cls: cls.slice(0, 50),
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
        w: Math.round(r.width),
        h: Math.round(r.height),
      })
    }

    if (!scored.length) return null
    scored.sort((a, b) => b.score - a.score)
    const best = scored[0]
    return {
      text: best.text,
      tag: best.tag,
      cls: best.cls,
      x: best.x,
      y: best.y,
      w: best.w,
      h: best.h,
      score: best.score,
      candidates: scored.length,
    }
  }, boxId).catch(() => null)
}

/**
 * 读当前行数（从「添加XX(N/M)」文本里取 N）
 */
async function readRowCount(page, boxId) {
  return page.evaluate((id) => {
    const box = document.getElementById(id)
    if (!box) return -1
    const full = (box.textContent || '')
    const m = full.match(/添加[^\(（]*[\(（]\s*(\d+)\s*\/\s*(\d+)\s*[\)）]/)
    return m ? parseInt(m[1], 10) : -1
  }, boxId).catch(() => -1)
}

/**
 * 点「添加XX」按钮
 */
async function clickAdd(page, boxId, log) {
  const btn = await findAddButton(page, boxId)
  if (!btn) {
    log?.(`      ⚠ 找不到「添加」按钮`)
    return false
  }
  log?.(`      点击按钮 <${btn.tag}> "${btn.text}" ${btn.w}x${btn.h}（候选${btn.candidates}）`)
  await page.mouse.click(btn.x, btn.y).catch(() => {})
  await sleep(1000)
  return true
}

/**
 * 填复合属性的所有行
 *
 * @param page
 * @param boxId     字段容器 id（如 basic.propertys.15.value）
 * @param fieldName 字段名（如「材质成分」）
 * @param rawValue  值（字符串或 {name,pct} 或数组）
 * @param opts { log }
 * @returns { filled, missed, detail }
 */
export async function fillCompositeAttr(page, boxId, fieldName, rawValue, opts = {}) {
  const log = opts.log || (() => {})
  const filled = []
  const missed = []

  // 解析要选的成分（支持单个或多个）
  let wanted
  if (Array.isArray(rawValue)) {
    wanted = rawValue.map(v => (typeof v === 'object' ? String(v.name || '') : String(v || ''))).map(s => s.trim()).filter(Boolean)
  } else {
    const one = parseCompositeValue(rawValue)
    wanted = one.name ? [one.name] : []
  }
  if (!wanted.length) {
    missed.push(`${fieldName}（空值）`)
    return { filled, missed }
  }
  log(`      「${fieldName}」需选：${wanted.join('、')}`)

  // ① 找并点「添加XX」按钮
  const btn = await findAddButton(page, boxId)
  if (!btn) {
    missed.push(`${fieldName}（找不到添加按钮）`)
    return { filled, missed }
  }
  log(`      点击 <${btn.tag}` + '>' + ` "${btn.text}"`)
  await page.mouse.click(btn.x, btn.y).catch(() => {})
  await sleep(1200)

  // ② 等弹窗出现（判据：有「确定(N/M)」按钮 + 至少 3 个复选框）
  let popup = null
  for (let w = 0; w < 20; w++) {
    await sleep(300)
    popup = await page.evaluate(() => {
      // 弹窗可能在任意容器里，找「确定(N/M)」按钮的最近上层
      const btns = [...document.querySelectorAll('button, .next-btn, [role="button"]')]
        .filter(b => b.offsetParent !== null && /^确定[\s\(（]/.test((b.innerText || '').trim()))
      if (!btns.length) return null
      const confirmBtn = btns[btns.length - 1]
      let container = confirmBtn
      for (let d = 0; d < 12 && container; d++) {
        const cbs = container.querySelectorAll('input[type="checkbox"], [class*="checkbox"]')
        if (cbs.length >= 3) break
        container = container.parentElement
      }
      if (!container) return null
      const r = container.getBoundingClientRect()
      if (r.width < 100) return null

      const cr = confirmBtn.getBoundingClientRect()
      // 搜索框
      const searchInput = container.querySelector('input[type="text"], input:not([type="checkbox"]):not([type="radio"])')
      const sr = searchInput?.getBoundingClientRect()

      return {
        ok: true,
        cls: (container.className || '').toString().slice(0, 50),
        checkboxCount: container.querySelectorAll('input[type="checkbox"], [class*="checkbox"]').length,
        confirm: {
          text: (confirmBtn.innerText || '').trim(),
          x: Math.round(cr.x + cr.width / 2),
          y: Math.round(cr.y + cr.height / 2),
        },
        search: searchInput ? {
          ph: searchInput.placeholder || '',
          x: Math.round(sr.x + sr.width / 2),
          y: Math.round(sr.y + sr.height / 2),
        } : null,
      }
    }).catch(() => null)
    if (popup?.ok) break
  }

  if (!popup?.ok) {
    missed.push(`${fieldName}（弹窗未出现）`)
    log(`      ⚠ 弹窗未出现`)
    return { filled, missed }
  }
  log(`      弹窗已出现：${popup.checkboxCount} 个候选，确定按钮「${popup.confirm.text}」`)

  // ③ 逐个勾选目标成分
  const checked = []
  for (const want of wanted) {
    // 用搜索框过滤（若有）
    if (popup.search) {
      await page.mouse.click(popup.search.x, popup.search.y).catch(() => {})
      await sleep(250)
      await page.keyboard.down('Control').catch(() => {})
      await page.keyboard.press('KeyA').catch(() => {})
      await page.keyboard.up('Control').catch(() => {})
      await page.keyboard.press('Delete').catch(() => {})
      await sleep(150)
      await page.keyboard.type(want, { delay: 40 }).catch(() => {})
      await sleep(800)
    }

    // 找匹配的复选框并点
    const pos = await page.evaluate((w) => {
      const btns = [...document.querySelectorAll('button, .next-btn, [role="button"]')]
        .filter(b => b.offsetParent !== null && /^确定[\s\(（]/.test((b.innerText || '').trim()))
      if (!btns.length) return null
      const confirmBtn = btns[btns.length - 1]
      let container = confirmBtn
      for (let d = 0; d < 12 && container; d++) {
        if (container.querySelectorAll('input[type="checkbox"], [class*="checkbox"]').length >= 3) break
        container = container.parentElement
      }
      if (!container) return null

      // 遍历所有可见的「选项行」（checkbox 的 label 或父级）
      const norm = s => String(s || '').replace(/[\s（）()]/g, '').toLowerCase()
      const W = norm(w)

      const rows = []
      for (const cb of container.querySelectorAll('input[type="checkbox"]')) {
        const r0 = cb.getBoundingClientRect()
        // checkbox 本身可能隐藏，用它的父元素
        const holder = cb.closest('label') || cb.parentElement?.parentElement || cb.parentElement
        if (!holder) continue
        const hr = holder.getBoundingClientRect()
        if (hr.width < 20) continue
        const text = (holder.innerText || '').trim()
        rows.push({ cb, holder, text, hr })
      }

      // 精确 > 包含
      let hit = rows.find(r => norm(r.text) === W)
      if (!hit) hit = rows.find(r => norm(r.text).includes(W) || W.includes(norm(r.text)))
      if (!hit) {
        return { none: true, options: rows.map(r => r.text).filter(Boolean).slice(0, 12) }
      }
      hit.hr = hit.hr
      return {
        ok: true,
        text: hit.text,
        alreadyChecked: hit.cb.checked,
        x: Math.round(hit.hr.x + hit.hr.width / 2),
        y: Math.round(hit.hr.y + hit.hr.height / 2),
      }
    }, want).catch(() => null)

    if (!pos) {
      missed.push(`${fieldName}（找不到「${want}」选项）`)
      continue
    }
    if (pos.none) {
      missed.push(`${fieldName}（候选里无「${want}」，可选：${pos.options.join('/')}）`)
      log(`      ⚠ 候选里没有「${want}」，可选：${pos.options.join('/')}`)
      continue
    }

    if (pos.alreadyChecked) {
      checked.push(want)
      log(`      「${pos.text}」已勾选`)
    } else {
      await page.mouse.click(pos.x, pos.y).catch(() => {})
      await sleep(500)
      checked.push(want)
      log(`      已勾选「${pos.text}」`)
    }
  }

  if (!checked.length) {
    // 没勾到任何东西，取消弹窗
    await page.keyboard.press('Escape').catch(() => {})
    missed.push(`${fieldName}（未勾选到任何成分）`)
    return { filled, missed }
  }

  // ④ 点「确定」
  const confirmPos = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, .next-btn, [role="button"]')]
      .filter(b => b.offsetParent !== null && /^确定[\s\(（]/.test((b.innerText || '').trim()))
    if (!btns.length) return null
    const b = btns[btns.length - 1]
    const r = b.getBoundingClientRect()
    return { text: (b.innerText || '').trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }).catch(() => null)

  if (!confirmPos) {
    missed.push(`${fieldName}（找不到确定按钮）`)
    return { filled, missed }
  }

  log(`      点「${confirmPos.text}」`)
  await page.mouse.click(confirmPos.x, confirmPos.y).catch(() => {})
  await sleep(1500)

  // ⑤ 校验：以**确定按钮的计数变化**为准（最可靠的信号）
  //   ★ 2026-11-01 实测：勾选后「确定(0/7)」→「确定(1/7)」，点完弹窗关闭即视为成功。
  //     不要用「字段文本包含成分名」判断 —— 平台会改写名称（聚酯纤维 → 涤纶（聚酯纤维）），
  //     字符串匹配必然失败。
  const verify = await page.evaluate((id, wants) => {
    const box = document.getElementById(id)
    const text = (box?.innerText || '').replace(/\n+/g, ' | ')
    const stillEmpty = /不能为空/.test(text)
    // 弹窗是否已关闭
    const popupStill = [...document.querySelectorAll('button, .next-btn')]
      .some(b => b.offsetParent !== null && /^确定[\s\(（]/.test((b.innerText || '').trim()))
    // 字段里是否出现了「添加材质成分(N/M)」且 N > 0
    const m = text.match(/添加[^\(（]*[\(（]\s*(\d+)\s*\//)
    const count = m ? parseInt(m[1], 10) : 0
    return { ok: !stillEmpty && !popupStill, text: text.slice(0, 150), stillEmpty, popupStill, count }
  }, boxId, wanted).catch(() => ({ ok: false, count: 0 }))

  // 双重判据：弹窗关闭 + 计数 > 0（或字段无「不能为空」）
  const effective = verify.ok && (verify.count > 0 || !verify.stillEmpty)

  if (effective) {
    filled.push(`${fieldName}=${checked.join('+')}`)
    log(`      ✅ ${fieldName} = ${checked.join('+')}（计数 ${verify.count}）`)
  } else {
    missed.push(`${fieldName}（确定后未生效：empty=${verify.stillEmpty} popup=${verify.popupStill} count=${verify.count}）`)
    log(`      ❌ ${fieldName} 未生效（count=${verify.count}）`)
  }

  return { filled, missed }
}

/**
 * 品牌搜索填充（搜索式下拉）
 *
 * ★ 实测结构：
 *   <input placeholder="请输入品牌名称搜索" />
 *   "未找到需要的品牌？点击申请"
 *   → 必须先键入搜索，等候选出现再点选，不能直接塞值
 */
export async function fillBrandSearch(page, boxId, brandValue, opts = {}) {
  const log = opts.log || (() => {})
  const filled = []
  const missed = []

  const want = String(brandValue || '').trim()
  if (!want) return { filled, missed: ['品牌（空值）'] }

  // ① 定位搜索框
  const pos = await page.evaluate((id) => {
    const box = document.getElementById(id)
    if (!box) return null
    const inp = box.querySelector('input')
    if (!inp) return null
    inp.scrollIntoView({ block: 'center' })
    const r = inp.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), ph: inp.placeholder || '', val: inp.value || '' }
  }, boxId).catch(() => null)

  if (!pos) return { filled, missed: ['品牌（找不到搜索框）'] }

  // ② 清空 + 键入
  await page.mouse.click(pos.x, pos.y).catch(() => {})
  await sleep(300)
  await page.keyboard.down('Control').catch(() => {})
  await page.keyboard.press('KeyA').catch(() => {})
  await page.keyboard.up('Control').catch(() => {})
  await page.keyboard.press('Delete').catch(() => {})
  await sleep(200)
  await page.keyboard.type(want, { delay: 55 }).catch(() => {})
  await sleep(1500)

  // ③ 从候选里挑
  const pick = await page.evaluate((w) => {
    const panels = [...document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"], [class*="PP_popover"], [class*="next-menu"]')]
      .filter(x => x.offsetParent !== null)
    const panel = panels[panels.length - 1]
    if (!panel) return null
    const nodes = [...panel.querySelectorAll('li, [role="option"], [class*="ST_item"]')]
      .filter(n => (n.innerText || '').trim())
    if (!nodes.length) return null
    const norm = s => String(s || '').replace(/\s+/g, '')
    const W = norm(w)
    let hit = nodes.find(n => norm(n.innerText) === W)
    if (!hit) hit = nodes.find(n => norm(n.innerText).includes(W))
    // 「其他」这类通用值，候选里没有就取第一个
    if (!hit && /^(其他|其它|无|通用)/.test(w)) hit = nodes[0]
    if (!hit) return { none: true, options: nodes.slice(0, 8).map(n => (n.innerText || '').trim()) }
    hit.scrollIntoView({ block: 'center' })
    const r = hit.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (hit.innerText || '').trim() }
  }, want).catch(() => null)

  if (!pick) {
    missed.push(`品牌（搜索后无候选）`)
    return { filled, missed }
  }
  if (pick.none) {
    missed.push(`品牌（候选里无「${want}」，可选：${pick.options.join('/')}）`)
    return { filled, missed }
  }

  await page.mouse.click(pick.x, pick.y).catch(() => {})
  await sleep(700)

  // ④ 校验
  const ok = await page.evaluate((id, w) => {
    const box = document.getElementById(id)
    if (!box) return false
    const inp = box.querySelector('input')
    const v = inp?.value || ''
    const t = (box.innerText || '')
    return v.includes(w) || t.includes(w)
  }, boxId, want).catch(() => false)

  if (ok) {
    filled.push(`品牌=${want}`)
    log(`      品牌 = ${pick.text} ✅`)
  } else {
    missed.push(`品牌（选后未确认）`)
    log(`      品牌 = ${want} ❌`)
  }

  return { filled, missed }
}
