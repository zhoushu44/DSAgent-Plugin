/**
 * 发布组件 · 基础字段（标题 / 参考价以外的通用字段）
 *
 * 全类目通用，与规格/属性无关。
 *   · fillTitle         商品标题
 *   · fillField         通用「按 label 关键词找 input 填值」
 *   · fillItemNo        商家编码/货号
 *   · readCategory      读回表单页类目（用于校验）
 */
import { jsClick, jsBlur, sleep } from './spec-dims.mjs'

/**
 * 按 label/placeholder 关键词找输入框并填值（通用兜底）
 * @param page
 * @param keywords 正则，如 /商品参考价|参考价/
 * @param value
 * @param opts { scope?: selector, clear?: bool }
 */
export async function fillField(page, keywords, value, opts = {}) {
  const v = String(value ?? '').trim()
  if (!v) return false
  const scope = opts.scope || ''
  const kwSrc = keywords instanceof RegExp ? keywords.source : String(keywords)

  const pos = await page.evaluate((scopeSel, kwSource) => {
    const re = new RegExp(kwSource)
    const root = scopeSel ? document.querySelector(scopeSel) : document
    if (!root) return null
    const inps = [...root.querySelectorAll('input')].filter(e => {
      const ph = e.placeholder || ''
      const aria = e.getAttribute('aria-label') || ''
      const r = e.getBoundingClientRect()
      return r.width > 20 && !e.disabled && (re.test(ph) || re.test(aria))
    })
    const inp = inps[0]
    if (!inp) return null
    inp.scrollIntoView({ block: 'center' })
    window.__fillFieldInp = inp
    return { ok: true }
  }, scope, kwSrc).catch(() => null)
  if (!pos) return false

  await sleep(500)
  const pt = await page.evaluate(() => {
    const inp = window.__fillFieldInp
    if (!inp || !inp.isConnected) return null
    const r = inp.getBoundingClientRect()
    if (r.width < 20) return null
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }).catch(() => null)
  if (!pt) return false

  await jsClick(page, pt.x, pt.y)
  await sleep(300)
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await sleep(80)
  await page.keyboard.type(v, { delay: 35 })
  await sleep(200)
  await jsBlur(page)
  await sleep(400)

  const back = await page.evaluate(() => window.__fillFieldInp?.value || '').catch(() => '')
  return String(back).trim() === v || String(back).includes(v)
}

/**
 * 填商品标题
 * 锚点：input[placeholder*="商品标题组成"] 或 [data-tracking-click-viewid="title_input_area"]
 */
export async function fillTitle(page, title) {
  const t = String(title || '').trim()
  if (!t) return false
  // 用 fillField 的通用逻辑，但优先精确锚点
  return fillField(page, /商品标题组成|商品标题/, t)
}

/**
 * 填商家编码/货号
 */
export async function fillItemNo(page, itemNo) {
  const v = String(itemNo || '').trim()
  if (!v) return false
  return fillField(page, /商家编码|货号|商品编码/, v)
}

/**
 * 读回表单页类目（用于校验 vs 选类目时选的）
 */
export async function readCategory(page) {
  const txt = await page.evaluate(() => {
    const el = document.querySelector('#goods-category')
    return (el?.innerText || '').replace(/\s+/g, ' ').trim()
  }).catch(() => '')
  return txt && txt !== '商品分类' ? txt : ''
}
