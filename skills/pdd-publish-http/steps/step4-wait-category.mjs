/**
 * step4-wait-category.mjs — 第 4 步：等待类目卡出现并确认选中
 *
 * 页面结构（实测 2026-11-08）
 *
 *   <div class="cateItemCard_chooseCategory__25S_M cateItemCard_checked__3oUZQ"
 *        data-tracking-viewid="choose_cate"
 *        data-tracking-params="cate_list=16675,16669,...&choosen_cate=16675">
 *     餐饮具 > 一次性餐桌用品 > 纸杯
 *     <div class="cateItemCard_triangeCheck__39rKY">✓</div>
 *   </div>
 *
 * 关键：
 *   · 定位【框本身】：data-tracking-viewid="choose_cate"
 *   · 选中态：className 含 cateItemCard_checked
 *   · 类目 id：data-tracking-params 里的 choosen_cate=NNNN
 *   · 这个卡片在「填完标题之后」才出现，要轮询等
 */
import path from 'node:path'            // eslint-disable-line
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 类目卡选择器 */
const XP_CARD = '//div[@data-tracking-viewid="choose_cate"]'
const CSS_CARD = '[data-tracking-viewid="choose_cate"]'

/**
 * 读所有类目卡
 * @returns {Promise<{found:boolean, cards:Array<{i:number,text:string,cateId:string,checked:boolean}>}>}
 */
export async function readCategoryCards(page) {
  return page.evaluate((sel) => {
    const cards = [...document.querySelectorAll(sel)]
    return {
      found: cards.length > 0,
      cards: cards.map((c, i) => {
        const params = c.getAttribute('data-tracking-params') || ''
        const m = params.match(/choosen_cate=(\d+)/)
        return {
          i,
          text: (c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          cateId: m ? m[1] : '',
          checked: /cateItemCard_checked/.test(c.className || ''),
        }
      }),
    }
  }, CSS_CARD).catch(() => ({ found: false, cards: [] }))
}

/**
 * 等待类目卡出现（默认 60 秒）
 * @returns {Promise<{ok:boolean, cards:Array, elapsedMs:number, error:string}>}
 */
export async function waitCategoryCards(page, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60000
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const r = await readCategoryCards(page)
    if (r.found && r.cards.length > 0) {
      return { ok: true, cards: r.cards, elapsedMs: Date.now() - t0, error: '' }
    }
    await sleep(800)
  }
  return { ok: false, cards: [], elapsedMs: Date.now() - t0, error: `等 ${timeoutMs}ms 类目卡仍未出现（确认标题已填？）` }
}

/**
 * 选指定类目（按 cateId 或 文本包含）
 */
export async function pickCategory(page, opts = {}) {
  const { cateId, keyword } = opts
  const r = await page.evaluate((args) => {
    const { sel, cateId, keyword } = args
    const cards = [...document.querySelectorAll(sel)]
    for (const c of cards) {
      const params = c.getAttribute('data-tracking-params') || ''
      const m = params.match(/choosen_cate=(\d+)/)
      const id = m ? m[1] : ''
      const text = (c.innerText || '').replace(/\s+/g, ' ').trim()
      const hit = (cateId && id === String(cateId)) || (keyword && text.includes(keyword))
      if (hit) {
        if (/cateItemCard_checked/.test(c.className || '')) return { ok: true, already: true, cateId: id, text }
        c.scrollIntoView({ block: 'center' })
        c.click()
        return { ok: true, already: false, cateId: id, text }
      }
    }
    return { ok: false, reason: '找不到匹配的类目卡', all: cards.map(c => (c.innerText || '').replace(/\s+/g, ' ').trim()) }
  }, { sel: CSS_CARD, cateId: cateId ? String(cateId) : '', keyword: keyword || '' })
    .catch(e => ({ ok: false, reason: String(e.message).slice(0, 120) }))

  if (r.ok && !r.already) await sleep(1800)
  return r
}

/**
 * 第 4 步主函数：等类目卡 → 确认已有选中（或改选目标类目）
 *
 * @param {object} page
 * @param {object} opts
 * @param {string|number} [opts.cateId]   期望类目 id（如 16675 纸杯）
 * @param {string} [opts.keyword]         或按文本关键词（如「纸杯」）
 * @param {number} [opts.timeoutMs=60000]
 * @returns {Promise<{ok:boolean, cateId:string, text:string, cards:Array, elapsedMs:number, errors:string[]}>}
 */
export async function step4_waitCategory(page, opts = {}) {
  const result = { ok: false, cateId: '', text: '', cards: [], elapsedMs: 0, errors: [] }

  // ① 等卡出现
  const w = await waitCategoryCards(page, { timeoutMs: opts.timeoutMs ?? 60000 })
  result.elapsedMs = w.elapsedMs
  result.cards = w.cards
  if (!w.ok) { result.errors.push(w.error); return result }

  const wantId = opts.cateId !== undefined && opts.cateId !== null && opts.cateId !== '' ? String(opts.cateId) : ''
  const wantKw = opts.keyword || ''

  // ② 已经有选中项
  const checked = w.cards.find(c => c.checked)

  if (checked && (!wantId && !wantKw)) {
    // 没指定目标 → 接受平台默认选中
    result.ok = true
    result.cateId = checked.cateId
    result.text = checked.text
    return result
  }

  if (checked && (wantId || wantKw)) {
    const hit = (wantId && checked.cateId === wantId) || (wantKw && checked.text.includes(wantKw))
    if (hit) {
      result.ok = true
      result.cateId = checked.cateId
      result.text = checked.text
      return result
    }
    // 选中的不是目标 → 改选
  }

  // ③ 改选目标
  const pick = await pickCategory(page, { cateId: wantId, keyword: wantKw })
  if (!pick.ok) {
    result.errors.push(pick.reason || '改选类目失败')
    if (pick.all) result.errors.push('可选: ' + pick.all.join(' | '))
    return result
  }

  // ④ 复核
  await sleep(1200)
  const after = await readCategoryCards(page)
  const ck = after.cards.find(c => c.checked)
  if (!ck) { result.errors.push('改选后没有任何选中项'); return result }

  result.ok = true
  result.cateId = ck.cateId
  result.text = ck.text
  result.cards = after.cards
  return result
}

export default step4_waitCategory

