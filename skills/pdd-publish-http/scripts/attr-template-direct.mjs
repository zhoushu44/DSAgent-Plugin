/**
 * 发布组件 · 模板直填（跳过属性扫描，2026-11-02）
 *
 * ★ 为什么需要
 *   模板（category-template.json）里已经存了「字段名 → 值」的完整映射：
 *     {"name":"品牌","value":"其他"}, {"name":"适用性别","value":"女"}, ...
 *   但当前流程每次都要：
 *     ① harvestAttributes(ultraFast)  拿 required 名单
 *     ② harvestAttributes(skipOptions) 拿完整字段
 *     ③ 可能再重采一次
 *   每次扫描 3-6 秒，纯属重复劳动。
 *
 * ★ 本组件思路
 *   直接用模板里的 name→value，按 DOM 结构定位字段并填值，**不预先扫描**。
 *   定位策略（按优先级）：
 *     ① 用 label 文本精确匹配 → 找它所属的 property box
 *     ② 用 [id^="basic.propertys."] 遍历 + label 比对
 *     ③ 填完后一次轻量复核（只查「必填是否都已填」，不读候选）
 *
 * ★ 与通用流程的关系
 *   - 模板命中且字段齐全 → 走本组件（快）
 *   - 模板缺失 / 有字段没在模板里 → 回落到通用流程（慢但全）
 */

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 建立「字段名 → boxId」映射（一次 DOM 遍历，很便宜）
 */
async function buildFieldIndex(page) {
  return page.evaluate(() => {
    const out = {}
    const root = document.querySelector('#property') || document.querySelector('.goods-propertys') || document.body
    const boxes = [...root.querySelectorAll('[id^="basic.propertys."]')]
    for (const box of boxes) {
      // 找 label
      let label = ''
      const own = box.querySelector('label')
      if (own) label = (own.innerText || '').trim()
      if (!label) {
        let cur = box
        for (let d = 0; d < 6 && cur; d++) {
          const lb = cur.querySelector('label')
          if (lb && !lb.contains(box)) { label = (lb.innerText || '').trim(); break }
          cur = cur.parentElement
        }
      }
      if (!label) continue
      const name = label.replace(/重要|必填|[*＊\s]/g, '').trim()
      if (!name) continue
      const required = /重要|[*＊]/.test(label)
      if (!out[name]) out[name] = { id: box.id, required, label }
    }
    return out
  }).catch(() => ({}))
}

/**
 * 填一个下拉/文本字段（不读候选，直接键入 + 点第一个匹配候选）
 *
 * @returns { ok, actual }
 */
async function fillOneField(page, boxId, want, opts = {}) {
  const log = opts.log || (() => {})

  // ① 找字段的输入控件
  const info = await page.evaluate((id) => {
    const box = document.getElementById(id)
    if (!box) return null
    const inp = box.querySelector('input')
    if (!inp) return { noInput: true, text: (box.innerText || '').slice(0, 80) }
    inp.scrollIntoView({ block: 'center' })
    const r = inp.getBoundingClientRect()
    return {
      ok: true,
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
      readOnly: inp.readOnly,
      value: inp.value || '',
      placeholder: inp.placeholder || '',
    }
  }, boxId).catch(() => null)

  if (!info) return { ok: false, err: 'box-not-found' }
  if (info.noInput) return { ok: false, err: 'no-input', text: info.text }

  // ② 已经有正确值 → 跳过
  if (info.value && (info.value.includes(want) || want.includes(info.value))) {
    return { ok: true, actual: info.value, skipped: true }
  }

  // ③ 点击聚焦
  await page.mouse.click(info.x, info.y).catch(() => {})
  await sleep(120)

  if (info.readOnly) {
    // 下拉型：点开后找候选
    await sleep(220)
    const picked = await page.evaluate((w) => {
      const panels = [...document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"], [class*="PP_popover"], [class*="next-menu"]')]
        .filter(x => x.offsetParent !== null)
      const panel = panels[panels.length - 1]
      if (!panel) return null
      const norm = s => String(s || '').replace(/\s+/g, '')
      const nodes = [...panel.querySelectorAll('li, [role="option"], [class*="ST_item"]')]
        .filter(n => (n.innerText || '').trim())
      const W = norm(w)
      let hit = nodes.find(n => norm(n.innerText) === W)
      if (!hit) hit = nodes.find(n => norm(n.innerText).includes(W) || W.includes(norm(n.innerText)))
      // 兜底：通用值取第一个
      if (!hit && /^(其他|其它|无|通用|否)/.test(w)) hit = nodes[0]
      if (!hit) return { none: true, options: nodes.slice(0, 6).map(n => (n.innerText || '').trim()) }
      hit.scrollIntoView({ block: 'center' })
      const r = hit.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (hit.innerText || '').trim() }
    }, want).catch(() => null)

    if (!picked) return { ok: false, err: 'no-panel', actual: info.value }
    if (picked.none) {
      await page.keyboard.press('Escape').catch(() => {})
      return { ok: false, err: 'no-match', options: picked.options, actual: info.value }
    }
    await page.mouse.click(picked.x, picked.y).catch(() => {})
    await sleep(180)
    return { ok: true, actual: picked.text }
  }

  // ④ 文本型：清空 + 键入 + Tab
  await page.keyboard.down('Control').catch(() => {})
  await page.keyboard.press('KeyA').catch(() => {})
  await page.keyboard.up('Control').catch(() => {})
  await page.keyboard.press('Delete').catch(() => {})
  await sleep(80)
  await page.keyboard.type(String(want), { delay: 25 }).catch(() => {})
  await sleep(180)
  await page.keyboard.press('Tab').catch(() => {})
  await sleep(200)

  const after = await page.evaluate((id) => {
    const box = document.getElementById(id)
    const inp = box?.querySelector('input')
    return inp?.value || ''
  }, boxId).catch(() => '')

  const ok = !!after && (after.includes(want) || want.includes(after))
  return { ok, actual: after }
}

/**
 * 模板直填主入口
 *
 * @param page
 * @param templateAttrs  [{name, value}]  模板里的属性
 * @param userAttrs      [{name, value}]  用户传的属性（优先级更高）
 * @param opts { log, onProgress }
 * @returns { filled, missed, usedTemplate, needFallback }
 */
export async function fillAttrsFromTemplate(page, templateAttrs, userAttrs = [], opts = {}) {
  const log = opts.log || (() => {})
  const filled = []
  const missed = []

  // 合并：用户值优先
  const merged = new Map()
  for (const a of templateAttrs || []) {
    const n = String(a.name || '').replace(/\s+/g, '')
    const v = String(a.value || '').trim()
    if (n && v) merged.set(n, { name: a.name, value: v })
  }
  for (const a of userAttrs || []) {
    const n = String(a.name || '').replace(/\s+/g, '')
    const v = String(a.value || '').trim()
    if (n && v) merged.set(n, { name: a.name, value: v })   // 覆盖模板值
  }

  if (!merged.size) {
    return { filled, missed, usedTemplate: 0, needFallback: true }
  }

  // ① 一次 DOM 遍历建索引（很便宜，~50ms）
  const index = await buildFieldIndex(page)
  const indexNames = Object.keys(index)
  log(`[tpl-direct] 模板 ${merged.size} 项，页面 ${indexNames.length} 个字段`)

  // ② 逐个填（不读候选，直接点选）
  let okCount = 0
  let skipCount = 0
  const notFound = []

  for (const [normName, item] of merged) {
    // 找页面字段（精确 → 包含）
    let boxId = index[item.name]?.id
    if (!boxId) {
      const hit = indexNames.find(k => k.replace(/\s+/g, '') === normName)
      if (hit) boxId = index[hit].id
    }
    if (!boxId) {
      const hit = indexNames.find(k => {
        const kn = k.replace(/\s+/g, '')
        return kn.includes(normName) || normName.includes(kn)
      })
      if (hit) boxId = index[hit].id
    }

    if (!boxId) {
      notFound.push(item.name)
      continue
    }

    const r = await fillOneField(page, boxId, item.value, { log })
    if (r.ok) {
      okCount++
      if (r.skipped) skipCount++
      filled.push(`${item.name}=${r.actual || item.value}`)
    } else {
      missed.push(`${item.name}（${r.err}${r.options ? '：' + r.options.join('/') : ''}）`)
    }
  }

  log(`[tpl-direct] 已填 ${okCount}/${merged.size}（其中 ${skipCount} 个已有值），未找到 ${notFound.length} 个字段`)

  // ③ 判断是否需要回落到通用流程
  //   ★ 2026-11-02 修正：原判据 notFound.length > 0 太严 —— 模板里有商品的旧字段
  //     （如「商品货号」这种一物一码的），页面上本来就没有，不该因此回落。
  //   新判据（只看真正的风险）：
  //     a. 必填填充率 < 80%          → 回落（必填没填上，提交必失败）
  //     b. 有【必填】字段没找到       → 回落（模板结构与页面不符）
  //     c. 非必填字段没找到          → 不回落（不影响发布）
  const requiredTotal = indexNames.filter(n => index[n].required).length
  const requiredFilled = filled.filter(f => {
    const n = f.split('=')[0].replace(/\s+/g, '')
    return indexNames.some(k => index[k].required && k.replace(/\s+/g, '') === n)
  }).length
  const fillRate = requiredTotal ? requiredFilled / requiredTotal : 1

  // 只统计「必填字段」里没找到的
  const missingRequired = notFound.filter(n => {
    const nn = String(n).replace(/\s+/g, '')
    return indexNames.some(k => index[k].required && (k.replace(/\s+/g, '') === nn || k.replace(/\s+/g, '').includes(nn)))
  })

  const needFallback = fillRate < 0.8 || missingRequired.length > 0

  return {
    filled,
    missed,
    usedTemplate: okCount,
    requiredTotal,
    requiredFilled,
    fillRate,
    needFallback,
    notFound,
    missingRequired,
  }
}
