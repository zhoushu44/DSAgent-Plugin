/**
 * 发布组件 · 类目属性（唯一随类目变化的模块）
 *
 * 类目属性 = 平台按类目给的固定字段集（材质成分/安全等级/适用季节…），
 * 每个类目的字段名/候选都不一样，所以这里做「读页面真实候选 + 智能匹配」。
 *
 * 依赖的通用能力：
 *   · readAttrItems      读所有下拉型属性项（id/name/filled/placeholder）
 *   · openAttrDropdown   展开 beast-core Select 下拉
 *   · readOpenOptions    读当前展开面板的真实选项
 *   · clickOpenOption    点选项
 *   · fillIngredient     材质成分（IngredientList 特殊组件）
 *
 * ★ 别名映射：1688 属性名 → 拼多多属性名（ATTR_ALIAS）
 */
import { jsClick, sleep } from './spec-dims.mjs'

/** 1688 属性名 → 拼多多属性名 别名表 */
export const ATTR_ALIAS = {
  '材质成分': ['主面料成分', '面料成分', '材质', '材质成分'],
  '面料名称': ['面料名称', '面料', '面料俗称'],
  '适用性别': ['适用性别', '性别'],
  '适用年龄段': ['适合年龄段', '适用年龄段', '适合年龄'],
  '厚薄': ['厚薄', '厚度'],
  '安全等级': ['安全等级', '安全类别', '安全技术类别'],
  '风格': ['风格', '风格类型'],
  '图案': ['图案', '花色'],
  '流行元素': ['元素', '流行元素'],
  '适用季节': ['适合季节', '适用季节', '季节'],
  '上市时节': ['上市年份季节', '上市时节', '上市时间'],
  '领型': ['领型', '领子形状'],
  '袖长': ['袖长', '袖子长度'],
  '款式': ['款式', '版型'],
  '适用场景': ['适用场景', '场景'],
  '功能': ['功能', '功效'],
  '商品货号': ['货号', '商品货号'],
  '产地': ['产地', '生产地'],
  '品牌': ['品牌'],
}

/** 跳过的属性（不自动填） */
const ATTR_SKIP = /^(品牌|商品资质|资质|3C|检测报告)$/

/**
 * 读所有下拉型属性项
 * @returns [{ id, name, filled, placeholder, maxlength }]
 */
export async function readAttrItems(page) {
  return page.evaluate(() => {
    const out = []
    const items = [...document.querySelectorAll('.goods-propertys .property-item')]
    for (const it of items) {
      const fi = it.querySelector('[id^="basic.propertys."]')
      if (!fi) continue
      const inp = fi.querySelector('input[data-testid="beast-core-select-htmlInput"]')
      if (!inp) continue
      const labelEl = fi.querySelector('label')
      const name = (labelEl?.innerText || '').replace(/重要/g, '').replace(/[*＊]/g, '').replace(/\s+/g, '')
      out.push({
        id: fi.id,
        name,
        filled: !!(inp.value || '').trim(),
        placeholder: inp.placeholder || '',
        maxlength: Number(inp.getAttribute('maxlength')) || 0,
      })
    }
    return out
  }).catch(() => [])
}

/** 展开某个属性的下拉面板 */
export async function openAttrDropdown(page, id) {
  // 先按 Escape 关掉可能残留的面板
  const alive = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"]')].filter(p => p.offsetParent !== null)
    return panels.length
  }).catch(() => 0)
  if (alive > 0) {
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(200)
  }

  return page.evaluate((fid) => {
    const fi = document.getElementById(fid)
    if (!fi) return false
    const head = fi.querySelector('[data-testid="beast-core-select-header"]')
      || fi.querySelector('input[data-testid="beast-core-select-htmlInput"]')
    if (!head) return false
    head.scrollIntoView({ block: 'center' })
    try { fi.querySelector('input')?.focus() } catch { /* ignore */ }
    for (const ev of ['mousedown', 'mouseup', 'click']) {
      head.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }))
    }
    return true
  }, id).catch(() => false)
}

/** 读当前展开面板的选项文本 */
export async function readOpenOptions(page) {
  return page.evaluate(() => {
    const panels = [...document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"]')]
      .filter(p => p.offsetParent !== null)
    const panel = panels[panels.length - 1]
    if (!panel) return []
    const out = []
    const seen = new Set()
    const nodes = [...panel.querySelectorAll('li, [role="option"], [class*="ST_item"]')]
    for (const n of nodes) {
      const t = (n.innerText || '').trim()
      if (!t || seen.has(t)) continue
      seen.add(t)
      out.push(t)
    }
    return out
  }).catch(() => [])
}

/** 点某个选项 */
export async function clickOpenOption(page, text) {
  return page.evaluate((want) => {
    const panels = [...document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"]')]
      .filter(p => p.offsetParent !== null)
    const panel = panels[panels.length - 1]
    if (!panel) return false
    const nodes = [...panel.querySelectorAll('li, [role="option"], [class*="ST_item"]')]
    const hit = nodes.find(n => (n.innerText || '').trim() === want)
    if (!hit) return false
    hit.click()
    return true
  }, text).catch(() => false)
}

/** 关闭下拉（Escape） */
export async function closeAttrDropdown(page) {
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(200)
}

/** 验证属性值已选中 */
export async function verifyAttrValue(page, id, want) {
  return page.evaluate((fid, w) => {
    const fi = document.getElementById(fid)
    const inp = fi?.querySelector('input[data-testid="beast-core-select-htmlInput"]')
    const v = (inp?.value || '').trim()
    return v === w || v.includes(w)
  }, id, want).catch(() => false)
}

/**
 * 填「材质成分」IngredientList 组件
 * 按钮「添加材质成分(N/7)」→ 弹窗多选 → 「确定(N/7)」
 * ★ 弹窗勾选必须用坐标点击（JS click 是 untrusted，计数一直 0/7）
 */
export async function fillIngredient(page, value) {
  const v = String(value || '').trim()
  if (!v) return false

  // ★ 2026-10-29：按钮可能在视口外很远（实测 y≈1014+），必须 scrollIntoView 后重新取坐标
  const scrollOk = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /添加材质成分/.test(x.innerText || ''))
    if (!b) return false
    b.scrollIntoView({ block: 'center' })
    return true
  }).catch(() => false)
  if (!scrollOk) return false
  await sleep(1200)   // 等滚动 + 布局稳定

  const btnPos = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => /添加材质成分/.test(b.innerText || ''))
    const b = btns[btns.length - 1]
    if (!b) return null
    const r = b.getBoundingClientRect()
    if (r.width < 10 || r.y < 0 || r.y > window.innerHeight) return null
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }).catch(() => null)
  if (!btnPos) return false

  await jsClick(page, btnPos.x, btnPos.y)
  // 等弹窗出现（轮询，最多 8s）
  let modalReady = false
  for (let w = 0; w < 16; w++) {
    await sleep(500)
    modalReady = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => /确定\(\d+\/\d+\)/.test(b.innerText || '') && b.offsetParent !== null)
      return btns.length > 0
    }).catch(() => false)
    if (modalReady) break
  }
  if (!modalReady) return false

  // 弹窗多选：别名映射
  const alias = {
    '棉': ['棉', '纯棉'],
    '粘纤': ['粘纤', '粘胶纤维', '粘胶'],
    '聚酯纤维': ['涤纶（聚酯纤维）', '涤纶', '聚酯纤维'],
    '涤纶': ['涤纶（聚酯纤维）', '涤纶', '聚酯纤维'],
    '莫代尔': ['莫代尔', '再生纤维素纤维'],
  }
  const targets = alias[v] || [v]

  // 候选可能在弹窗内滚动区，先找可见的
  let optPos = await page.evaluate((tg) => {
    const labels = [...document.querySelectorAll('label, [class*="CBX"]')]
      .filter(e => e.offsetParent !== null && tg.some(t => (e.innerText || '').trim() === t))
    if (!labels.length) return null
    const r = labels[0].getBoundingClientRect()
    if (r.width < 5) return null
    labels[0].scrollIntoView({ block: 'center' })
    return { needScroll: true }
  }, targets).catch(() => null)

  if (optPos?.needScroll) {
    await sleep(800)
    optPos = await page.evaluate((tg) => {
      const labels = [...document.querySelectorAll('label, [class*="CBX"]')]
        .filter(e => e.offsetParent !== null && tg.some(t => (e.innerText || '').trim() === t))
      if (!labels.length) return null
      const r = labels[0].getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }, targets).catch(() => null)
  }
  if (optPos?.x) {
    await jsClick(page, optPos.x, optPos.y)
    await sleep(1200)
  }

  // 点「确定(n/7)」
  const okPos = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
      .filter(b => /确定\(\d+\/\d+\)/.test(b.innerText || '') && b.offsetParent !== null)
    const b = btns[btns.length - 1]
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }).catch(() => null)
  if (okPos) await jsClick(page, okPos.x, okPos.y)
  await sleep(2000)

  // 验证计数 > 0
  return page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => /添加材质成分/.test(b.innerText || ''))
    const txt = btns[btns.length - 1]?.innerText || ''
    const m = txt.match(/\((\d+)\/\d+\)/)
    return m ? parseInt(m[1], 10) > 0 : false
  }).catch(() => false)
}

/**
 * 填所有类目属性
 * @param page
 * @param values [{ name, value }]（1688 原始名或拼多多名都行）
 * @param opts { skip?: RegExp, model?: 宿主模型（可选） }
 * @returns { filled: string[], missed: string[] }
 */
export async function fillAttributes(page, values, opts = {}) {
  const filled = []
  const missed = []
  const skipRe = opts.skip || ATTR_SKIP

  // 显式值表（normalize 后的 name → value）
  const norm = s => String(s || '').replace(/\s+/g, '')
  const explicit = new Map()
  for (const v of (values || [])) {
    const n = norm(v?.name)
    const val = String(v?.value || '').trim()
    if (n && val) explicit.set(n, val)
  }

  // ① 材质成分（IngredientList，特殊的先处理）
  const matVal = explicit.get('材质成分') || explicit.get('面料成分') || explicit.get('主面料成分')
  if (matVal) {
    const ok = await fillIngredient(page, matVal)
    if (ok) filled.push(`材质成分=${matVal}`)
    else missed.push(`材质成分=${matVal}（添加后未确认）`)
  }

  // ② 其余下拉型属性
  const all = await readAttrItems(page)
  const todo = all.filter(i => i.name && !i.filled && !skipRe.test(i.name))

  for (const it of todo) {
    await openAttrDropdown(page, it.id)
    await sleep(600)
    let options = await readOpenOptions(page)

    if (!options.length) {
      await closeAttrDropdown(page)
      missed.push(`${it.name}（下拉未读到选项）`)
      continue
    }

    // 显式值匹配（含别名）
    let want = explicit.get(norm(it.name))
    if (!want) {
      const aliases = ATTR_ALIAS[norm(it.name)] || []
      for (const [k, v] of explicit.entries()) {
        if (aliases.some(a => norm(a) === k)) { want = v; break }
      }
    }

    let pick = null
    if (want && options.includes(want)) pick = want
    else if (want) {
      // 模糊：候选里含该值 or 该值含候选
      pick = options.find(o => o.includes(want) || want.includes(o)) || null
    }

    // ★ 2026-10-29（用户要求：属性必须真实，不许编）：
    //   没有显式值、也没匹配到 → **留空**，不猜。只在 opts.inferEmpty=true 时才用标题词兜底。
    if (!pick && opts.inferEmpty === true) {
      const titleWords = String(opts.title || '').split(/[\s/\\>＞、,，|]+/).filter(w => w.length >= 2)
      pick = options.find(o => titleWords.some(w => o.includes(w))) || options[0]
    }

    if (!pick) {
      await closeAttrDropdown(page)
      missed.push(`${it.name}（无真实值，留空）`)
      continue
    }

    const ok = await clickOpenOption(page, pick)
    await sleep(400)
    const confirmed = ok && await verifyAttrValue(page, it.id, pick)
    await closeAttrDropdown(page)

    if (confirmed) filled.push(`${it.name}=${pick}${want && pick === want ? '（显式指定）' : ''}`)
    else missed.push(`${it.name}（${want ? `显式值「${want}」` : ''}点选「${pick}」失败）`)
  }

  return { filled, missed }
}
