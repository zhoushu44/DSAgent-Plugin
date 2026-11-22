/**
 * 03-button/index.mjs — 拼多多「通用按钮模块」（XPath 版）
 *
 * 用 XPath 定位元素，直接调 el.click()，不用鼠标坐标。
 *
 * ════════════════════════════════════════════════════════════════
 *  页面结构（实测）
 *
 *   <button id="bottomSubmitBtnId"
 *           data-tracking-impr-viewid="confirm_publish_this_type_product"
 *           class="BTN_outerWrapper_5-194-0 BTN_primary_5-194-0 ..."
 *           data-testid="beast-core-button" type="button">
 *     <span>下一步, 完善商品信息</span>
 *   </button>
 *
 *  ★ 三个稳定锚点（class 的 _5-194-0 后缀会变，不要用）
 *    ① id="bottomSubmitBtnId"
 *    ② data-tracking-impr-viewid="confirm_publish_this_type_product"
 *    ③ 按钮文字
 * ════════════════════════════════════════════════════════════════
 *
 * 用法
 *   import { clickButton, findButton, waitButtonReady, listButtons } from './03-button/index.mjs'
 *
 *   // ① 直接给 XPath（最灵活）
 *   await clickButton(page, { xpath: '//button[@id="bottomSubmitBtnId"]' })
 *
 *   // ② 按 id 自动生成 XPath
 *   await clickButton(page, { id: 'bottomSubmitBtnId' })
 *
 *   // ③ 按 tracking id 自动生成 XPath（语义最清晰，推荐）
 *   await clickButton(page, { trackingId: 'confirm_publish_this_type_product' })
 *
 *   // ④ 按文字自动生成 XPath
 *   await clickButton(page, { text: '下一步 完善商品信息' })
 *
 *   // 点完等跳转
 *   await clickButton(page, { trackingId: '...', waitNavigation: true })
 */

/** XPath 字符串转义（处理含引号的文字） */
function xpLiteral(s) {
  const str = String(s || '')
  if (!str.includes("'")) return `'${str}'`
  if (!str.includes('"')) return `"${str}"`
  // 两种引号都有：用 concat()
  const parts = str.split("'").map(p => `'${p}'`)
  return `concat(${parts.join(`, "'", `)})`
}

/**
 * 按参数生成 XPath
 */
export function buildXPath(opts = {}) {
  if (opts.xpath) return opts.xpath

  const scope = opts.scope || '//'
  // 按钮可能不是 button 标签（div[role=button] / a）
  const tagCond = opts.anyTag ? '*[self::button or self::a or @role="button"]' : 'button'

  if (opts.id) {
    return `//${tagCond}[@id=${xpLiteral(opts.id)}]`
  }
  if (opts.volta) {
    return `//${tagCond}[@data-volta=${xpLiteral(opts.volta)}]`
  }
  if (opts.trackingId) {
    return `//${tagCond}[@data-tracking-impr-viewid=${xpLiteral(opts.trackingId)}]`
      + ` | //${tagCond}[@data-tracking-viewid=${xpLiteral(opts.trackingId)}]`
      + ` | //${tagCond}[@data-tracking-click-viewid=${xpLiteral(opts.trackingId)}]`
  }
  if (opts.text) {
    const t = xpLiteral(opts.text)
    const norm = xpLiteral(String(opts.text).replace(/[\s\u3000]/g, ''))
    // ★ 带 svg 图标的按钮（如「添加规格类型」）：
    //   textContent 含图标空白，必须同时按 span 文字匹配
    return `//${tagCond}[normalize-space(.)=${t}]`
      + ` | //${tagCond}[.//span[normalize-space(.)=${t}]]`
      + ` | //${tagCond}[contains(normalize-space(.), ${t})]`
      + ` | //${tagCond}[.//span[contains(normalize-space(.), ${t})]]`
      + ` | //${tagCond}[contains(translate(normalize-space(.), ' ', ''), ${norm})]`
  }
  if (opts.icon) {
    // 按图标 data-testid 找（如 beast-core-icon-plus = 加号按钮）
    const ic = xpLiteral(opts.icon)
    return `//${tagCond}[svg[@data-testid=${ic}]]`
  }
  return null
}

/** 页面内：XPath 找元素 + 状态判定 */
const RUN = function (xpath, action) {
  function evaluate(xp) {
    try {
      const r = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
      const list = []
      for (let i = 0; i < r.snapshotLength; i++) list.push(r.snapshotItem(i))
      return list
    } catch (e) { return [] }
  }

  function isDisabled(el) {
    if (!el) return true
    if (el.disabled) return true
    const cls = String(el.className || '')
    if (/BTN_disabled|_disabled/i.test(cls)) return true
    if (el.getAttribute('aria-disabled') === 'true') return true
    return false
  }

  function isLoading(el) {
    const t = (el.textContent || '').replace(/\s+/g, '')
    if (/加载中|提交中|loading/i.test(t)) return true
    if (el.querySelector && el.querySelector('[class*="spin"],[class*="Spin"],[class*="loading"]')) return true
    return false
  }

  const all = evaluate(xpath)
  // 优先可见的
  let el = all.find(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }) || all[0]
  if (!el) return { ok: false, error: 'NOT_FOUND', xpath }

  const rect = el.getBoundingClientRect()
  const info = {
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    volta: el.getAttribute('data-volta') || '',
    trackingId: el.getAttribute('data-tracking-impr-viewid') || el.getAttribute('data-tracking-viewid') || '',
    icon: (el.querySelector('svg[data-testid]') || {}).getAttribute
      ? (el.querySelector('svg[data-testid]') || {}).getAttribute('data-testid') || ''
      : '',
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    disabled: isDisabled(el),
    loading: isLoading(el),
    visible: rect.width > 0 && rect.height > 0,
    matched: all.length,
  }

  if (action === 'probe') return { ok: true, info }

  if (action === 'click') {
    if (info.disabled) return { ok: false, error: `按钮禁用（${info.text}）`, info }
    el.scrollIntoView({ block: 'center' })
    // ★ 直接元素点击，不用坐标
    el.click()
    return { ok: true, info }
  }

  return { ok: false, error: 'unknown action' }
}

/**
 * 探测按钮（不点击）
 */
export async function findButton(page, opts = {}) {
  const xp = buildXPath(opts)
  if (!xp) return { found: false, error: '无法生成 XPath（需传 xpath/id/trackingId/text）' }
  const r = await page.evaluate(RUN, xp, 'probe').catch(e => ({ ok: false, error: String(e.message).slice(0, 120) }))
  return r.ok ? { found: true, xpath: xp, info: r.info } : { found: false, xpath: xp, error: r.error }
}

/**
 * 等按钮可点（可见 + 非禁用 + 非加载）
 */
export async function waitButtonReady(page, opts = {}) {
  const xp = buildXPath(opts)
  if (!xp) return { ok: false, error: '无法生成 XPath' }
  const timeout = opts.timeoutMs ?? 30000
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < timeout) {
    last = await page.evaluate(RUN, xp, 'probe').catch(() => null)
    if (last?.ok && last.info.visible && !last.info.disabled && !last.info.loading) {
      return { ok: true, xpath: xp, info: last.info }
    }
    await page.evaluate(() => new Promise(r => setTimeout(r, 400)))
  }
  return { ok: false, xpath: xp, error: last?.error || `等 ${timeout}ms 仍不可点`, info: last?.info }
}

/**
 * 点击按钮（XPath + el.click()，无坐标）
 *
 * @returns {Promise<{ok, xpath?, info?, urlBefore?, urlAfter?, navigated?, error?}>}
 */
export async function clickButton(page, opts = {}) {
  const res = { ok: false, error: '' }
  const xp = buildXPath(opts)
  if (!xp) { res.error = '无法生成 XPath（需传 xpath/id/trackingId/text）'; return res }
  res.xpath = xp

  // ① 等可点
  if (!opts.force) {
    const ready = await waitButtonReady(page, opts)
    if (!ready.ok) { res.error = ready.error; res.info = ready.info; return res }
    res.info = ready.info
  }

  const urlBefore = page.url()
  res.urlBefore = urlBefore

  // ② 元素点击
  let clicked = null
  for (let attempt = 0; attempt < 2; attempt++) {
    clicked = await page.evaluate(RUN, xp, 'click').catch(e => ({ ok: false, error: String(e.message).slice(0, 120) }))
    if (clicked?.ok) break
    // 元素可能被 React 重渲染，等 500ms 重试
    await page.evaluate(() => new Promise(r => setTimeout(r, 500)))
  }
  if (!clicked?.ok) {
    res.error = clicked?.error || '点击失败'
    res.info = clicked?.info
    return res
  }
  res.ok = true
  res.info = res.info || clicked.info

  // ③ 等跳转 / 等反应
  const timeout = opts.timeoutMs ?? 30000
  if (opts.waitNavigation) {
    const t0 = Date.now()
    let navigated = false
    while (Date.now() - t0 < timeout) {
      await page.evaluate(() => new Promise(r => setTimeout(r, 400)))
      if (page.url() !== urlBefore) { navigated = true; break }
    }
    res.navigated = navigated
    res.urlAfter = page.url()
    if (!navigated) res.error = `点后 ${timeout}ms URL 未变（可能有校验拦截）`
  } else {
    await page.evaluate(() => new Promise(r => setTimeout(r, 600)))
    res.urlAfter = page.url()
    res.navigated = res.urlAfter !== urlBefore
  }

  return res
}

/**
 * 列出页面所有按钮（调试用，同时给出推荐 XPath）
 */
export async function listButtons(page) {
  return page.evaluate(() => {
    function isDisabled(el) {
      if (el.disabled) return true
      const cls = String(el.className || '')
      return /disabled/i.test(cls) || el.getAttribute('aria-disabled') === 'true'
    }
    return [...document.querySelectorAll('button, [role="button"]')].map(el => {
      const r = el.getBoundingClientRect()
      const id = el.id || ''
      const tid = el.getAttribute('data-tracking-impr-viewid') || el.getAttribute('data-tracking-viewid') || ''
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
      return {
        id,
        trackingId: tid,
        text: text.slice(0, 30),
        disabled: isDisabled(el),
        visible: r.width > 0 && r.height > 0,
        xpath: id ? `//button[@id="${id}"]` : (tid ? `//button[@data-tracking-impr-viewid="${tid}"]` : ''),
      }
    }).filter(b => b.text)
  }).catch(() => [])
}

export { xpLiteral }

