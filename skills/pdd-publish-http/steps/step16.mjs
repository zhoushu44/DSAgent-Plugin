/**
 * step16.mjs — 拼多多上架 步骤 16
 * 组件依赖：见 modules/ 目录（由另一个 agent 维护）
 */
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..')
const ORIGIN = 'https://mms.pinduoduo.com'
const LIST_URL = ORIGIN + '/goods/goods_list'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const MOD = path.join(__dirname, '..', 'modules')
async function loadModules() {
  const load = (p) => import(pathToFileURL(path.join(MOD, p)).href)
  return {
    M: await load('01-image-upload/index.mjs'),
    F: await load('02-form-input/index.mjs'),
    B: await load('03-button/index.mjs'),
    S: await load('04-select/index.mjs'),
    R: await load('05-radio/index.mjs'),
    T: await load('06-sku-thumb/index.mjs'),
    A: await load('07-attributes/index.mjs'),
  }
}
// ═══════════════════════════════════════════════════════════════════
//  步骤 16：提交并上架
//  步骤 17：保存草稿（可选）
//
//  页面结构（实测 2026-11-08）
//    <div class="goods-footer">
//      <div class="goods-footer-main">
//        <button id="submit_button" class="BTN_primary">      ← 提交并上架
//          <span>提交并上架</span>
//        </button>
//        <button data-tracking-viewid="save_draft" class="BTN_gray">  ← 保存草稿
//          <span>保存草稿</span>
//        </button>
//      </div>
//    </div>
//
//  成功标志：
//    · URL 跳到 goods_add/success?goods_id=...
//    · 或页面出现「发布成功」「提交成功」
//  失败标志：
//    · 页面出现「错误（N）」面板，含具体原因
// ═══════════════════════════════════════════════════════════════════

/**
 * 读提交/草稿按钮状态
 */
export async function readSubmitButtons(page) {
  return page.evaluate(() => {
    const sub = document.querySelector('#submit_button')
    const draft = document.querySelector('[data-tracking-viewid="save_draft"]')
    const info = (el) => el ? {
      exists: true,
      text: (el.innerText || '').replace(/\s+/g, ' ').trim(),
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      visible: el.getBoundingClientRect().width > 0,
    } : { exists: false }
    return { submit: info(sub), draft: info(draft) }
  }).catch(() => ({ submit: { exists: false }, draft: { exists: false } }))
}

/**
 * 读页面错误面板
 */
async function readPageError(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || ''
    // 「错误（N）」面板
    const m = t.match(/错误（(\d+)）/)
    if (m && Number(m[1]) > 0) {
      const idx = t.indexOf('错误（')
      return { hasError: true, count: Number(m[1]), text: t.slice(idx, idx + 400).replace(/\s+/g, ' ') }
    }
    // 常见错误 toast
    const toasts = []
    for (const el of document.querySelectorAll('[class*="toast"],[class*="Toast"],[class*="message"],[class*="Message"]')) {
      const x = (el.innerText || '').replace(/\s+/g, ' ').trim()
      if (x && x.length < 150 && /失败|错误|必填|请|不能|超/.test(x) && !toasts.includes(x)) toasts.push(x)
    }
    return { hasError: toasts.length > 0, count: toasts.length, text: toasts.slice(0, 4).join(' | ') }
  }).catch(() => ({ hasError: false, count: 0, text: '' }))
}

/**
 * 提交前必填校验
 * 扫页面上所有带 span.Form_itemRequired 的表单项，判断是否已填
 *
 * @returns {Promise<{ok:boolean, total:number, required:number, missing:Array, filled:Array}>}
 */
export async function checkRequiredBeforeSubmit(page) {
  const r = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-testid="beast-core-form-item"]')]
    const out = { total: 0, required: 0, missing: [], filled: [] }

    // 主图：多种文案兜底
    let imgCount = -1
    const bodyTxt = document.body.innerText || ''
    const patterns = [
      /上传图片\s*[（(]\s*(\d+)\s*\/\s*(\d+)\s*[）)]/,
      /已上传\s*(\d+)\s*\/\s*(\d+)\s*张/,
      /上传图片[^\d]{0,8}(\d+)\s*\/\s*(\d+)/,
    ]
    for (const re of patterns) {
      const m = bodyTxt.match(re)
      if (m) { imgCount = Number(m[1]); break }
    }
    // 兜底：看轮播图容器里有没有 img
    if (imgCount < 0) {
      const car = document.querySelector('[id*="carousel"], [class*="goodsCarousel"]')
      if (car) imgCount = car.querySelectorAll('img').length
    }

    for (const it of items) {
      const label = (it.querySelector('label')?.innerText || '').replace(/\s+/g, '').trim()
      if (!label) continue
      out.total++
      const isReq = !!it.querySelector('span[class*="Form_itemRequired"]')
      if (!isReq) continue
      out.required++

      const id = it.id || ''
      // 轮播图：用计数判断
      if (/轮播图/.test(label)) {
        if (imgCount > 0) out.filled.push({ label, id, via: 'count', value: String(imgCount) })
        else out.missing.push({ label, id, control: 'file' })
        continue
      }

      const inputs = [...it.querySelectorAll('input')]
      const textInp = inputs.find(e => ['text', '', 'number'].includes((e.type || 'text').toLowerCase()))
      const fileInp = inputs.find(e => (e.type || '').toLowerCase() === 'file')
      const radios = inputs.filter(e => (e.type || '').toLowerCase() === 'radio')
      const checks = inputs.filter(e => (e.type || '').toLowerCase() === 'checkbox')

      // 文件类：看是否有 uploadFile / 预览 / files
      if (fileInp && !textInp) {
        const has = (fileInp.files && fileInp.files.length > 0) || /预览|删除/.test(it.innerText || '')
        if (has) out.filled.push({ label, id, via: 'file' })
        else out.missing.push({ label, id, control: 'file' })
        continue
      }
      // 单选组
      if (radios.length && !textInp) {
        const checked = radios.find(x => x.checked)
        if (checked) {
          const lab = checked.closest('label')
          out.filled.push({ label, id, via: 'radio', value: (lab?.innerText || '').replace(/\s+/g, ' ').trim() })
        } else out.missing.push({ label, id, control: 'radio' })
        continue
      }
      // 多选组
      if (checks.length && !textInp) {
        const any = checks.some(x => x.checked)
        if (any) out.filled.push({ label, id, via: 'checkbox' })
        else out.missing.push({ label, id, control: 'checkbox' })
        continue
      }
      // 输入/下拉
      if (textInp) {
        const v = (textInp.value || '').trim()
        if (v) out.filled.push({ label, id, via: 'input', value: v })
        else out.missing.push({ label, id, control: textInp.placeholder === '请选择' ? 'select' : 'input' })
        continue
      }
      // 无 input（如纯下拉 header）
      const shown = (it.innerText || '').replace(/\s+/g, '').replace(label, '')
      if (shown && !/请选择|请输入|不能为空/.test(shown)) out.filled.push({ label, id, via: 'text' })
      else out.missing.push({ label, id, control: 'unknown' })
    }

    out.ok = out.missing.length === 0
    return out
  }).catch(e => ({ ok: false, total: 0, required: 0, missing: [], filled: [], error: String(e.message).slice(0, 150) }))

  // 页面「错误（N）」面板也算不通过
  const panelErr = await page.evaluate(() => {
    const t = document.body.innerText || ''
    const m = t.match(/错误（(\d+)）/)
    if (!m || Number(m[1]) === 0) return null
    const idx = t.indexOf('错误（')
    return { count: Number(m[1]), text: t.slice(idx, idx + 300).replace(/\s+/g, ' ') }
  }).catch(() => null)
  if (panelErr) {
    r.ok = false
    r.panelError = panelErr
    r.missing.push({ label: `页面错误面板(${panelErr.count})`, id: '', control: 'panel', text: panelErr.text })
  }
  return r
}

/**
 * 步骤 16：提交并上架
 *
 * ★ 提交前内置必填校验：扫页面所有 Form_itemRequired，有空的就不提交
 *
 * @param {object} page
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=180000]  等提交结果
 * @param {boolean} [opts.skipRequiredCheck=false] 跳过必填校验（慎用）
 * @returns {Promise<{ok:boolean, goodsId:number, url:string, error:string, pageError:object, required?:object}>}
 */
export async function step16_submit(page, opts = {}) {
  const result = { ok: false, goodsId: 0, url: '', error: '', pageError: {} }

  // ★ 已经是成功页 → 直接返回成功（避免重复提交/误报找不到按钮）
  const already = await page.evaluate(() => {
    const st = document.querySelector('.success-title')
    const t = (st?.innerText || '').trim()
    return /提交成功|发布成功|上架成功/.test(t) ? t : ''
  }).catch(() => '')
  if (/success/.test(page.url()) || already) {
    result.ok = true
    result.url = page.url()
    result.goodsId = Number((page.url().match(/goods_id=(\d+)/) || [])[1] || 0)
    if (already) result.successText = already
    return result
  }

  // ★★ 提交前必填校验（内置）
  if (opts.skipRequiredCheck !== true) {
    const req = await checkRequiredBeforeSubmit(page)
    result.required = req
    if (!req.ok) {
      result.error = `必填项未完成（${req.missing.length} 项）：${req.missing.map(m => m.label).join('、')}`
      result.pageError = { hasError: true, count: req.missing.length, text: result.error, missing: req.missing }
      return result
    }
  }

  const btns = await readSubmitButtons(page)
  if (!btns.submit?.exists) { result.error = '找不到 #submit_button（提交并上架）'; return result }
  if (!btns.submit.visible) { result.error = '提交按钮不可见'; return result }
  if (btns.submit.disabled) {
    result.error = '提交按钮被禁用（说明有必填项未完成）'
    result.pageError = await readPageError(page)
    return result
  }

  // 点击
  const clicked = await page.evaluate(() => {
    const b = document.querySelector('#submit_button')
    if (!b) return { ok: false }
    b.scrollIntoView({ block: 'center' })
    b.click()
    return { ok: true }
  }).catch(e => ({ ok: false, reason: String(e.message).slice(0, 120) }))

  if (!clicked?.ok) { result.error = clicked?.reason || '点击失败'; return result }

  // 等结果
  const t0 = Date.now()
  const cap = opts.timeoutMs ?? 180000
  let success = false
  let successText = ''
  while (Date.now() - t0 < cap) {
    await sleep(1500)
    const url = page.url()
    // 成功：跳成功页
    if (/goods_add\/success/.test(url) || /\/success\?/.test(url)) { success = true; break }
    // ★ 成功：页面出现 .success-title 且文本含「提交成功」（用户实测标志）
    const st = await page.evaluate(() => {
      const el = document.querySelector('.success-title')
      if (!el) return ''
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
      return /提交成功|发布成功|上架成功/.test(t) ? t : ''
    }).catch(() => '')
    if (st) { success = true; successText = st; break }
    // 成功：页面文案
    const okText = await page.evaluate(() => /发布成功|提交成功|上架成功/.test(document.body.innerText || '')).catch(() => false)
    if (okText) { success = true; break }
    // 失败：错误面板
    const err = await readPageError(page)
    if (err.hasError) { result.pageError = err; break }
  }

  result.url = page.url()
  result.goodsId = Number((result.url.match(/goods_id=(\d+)/) || [])[1] || 0)
  if (successText) result.successText = successText

  if (success) { result.ok = true; return result }

  // 未成功，抓最后一次错误
  if (!result.pageError?.hasError) result.pageError = await readPageError(page)
  result.error = result.pageError?.text || '提交后没有跳成功页，也没有明确报错（可能超时）'
  return result
}

/**
 * 步骤 17：保存草稿（可选）
 */
export async function step17_saveDraft(page, opts = {}) {
  const result = { ok: false, error: '' }

  const btns = await readSubmitButtons(page)
  if (!btns.draft?.exists) { result.error = '找不到「保存草稿」按钮'; return result }
  if (btns.draft.disabled) { result.error = '保存草稿按钮被禁用'; return result }

  const clicked = await page.evaluate(() => {
    const b = document.querySelector('[data-tracking-viewid="save_draft"]')
    if (!b) return { ok: false }
    b.scrollIntoView({ block: 'center' })
    b.click()
    return { ok: true }
  }).catch(e => ({ ok: false, reason: String(e.message).slice(0, 120) }))

  if (!clicked?.ok) { result.error = clicked?.reason || '点击失败'; return result }

  await sleep(4000)
  const err = await readPageError(page)
  if (err.hasError) { result.error = err.text; return result }

  result.ok = true
  return result
}

// ═══════════════════════════════════════════════════════════════════
//  完整流程（按需跳过某些步骤）
// ═══════════════════════════════════════════════════════════════════
/**
 * @param {object} opts
 * @param {string} opts.shopKey
 * @param {string} opts.title
 * @param {string[]} opts.mainImages
 * @param {string[]} [opts.whiteBg]
 * @param {string[]} [opts.carouselVideo]
 * @param {string[]} [opts.explanationVideo]
 * @param {Array} [opts.attrs]
 * @param {boolean} [opts.dry]  只跑步骤 1-4
 */

export default step16_submit
export { step16_submit as submit, step17_saveDraft as saveDraft }






