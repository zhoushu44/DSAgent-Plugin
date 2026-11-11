/**
 * step4.mjs — 步骤 4：类目检查 + 点「下一步，完善商品信息」
 *
 * ★ 用户指定的固定 XPath（不改）：
 *   显示类目   //*[@id="selectedCateId"]/div[1]/div[1]
 *   选择按钮   //*[@id="selectedCateId"]/div[2]/button
 *   搜索框     /html/body/div[6]/div/div/div[1]/div[2]/div/div[2]/div/div/div/div/div[2]/input
 *   确认按钮   //button[@data-tracking-click-viewid="cate_confirm"]
 *
 * 规则：
 *   ① 显示类目与模板一致 → 直接点下一步
 *   ② 没出现类目 / 文字不对 → 手动三步：
 *        一 点「选择商品分类」
 *        二 搜索框输入类目模板标题
 *        三 点「确认」
 *        四 点下一步
 */
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..')
const TPL_ROOT = path.join(PLUGIN, 'artifacts', 'pdd-templates')
const sleep = ms => new Promise(r => setTimeout(r, ms))

const MOD = path.join(__dirname, '..', 'modules')
async function loadModules() {
  const load = (p) => import(pathToFileURL(path.join(MOD, p)).href)
  return { B: await load('03-button/index.mjs') }
}

const XP = {
  shown: '//*[@id="selectedCateId"]/div[1]/div[1]',
  pickBtn: '//*[@id="selectedCateId"]/div[2]/button',
  // ★ 用户给的发布页「选择分类」按钮 XPath（没出现 selectedCateId 时用这个）
  publishPickBtn: '//*[@id="mf-mms-goods-container"]/div/div/div/div[3]/div[2]/div/div[1]/section/section[1]/div/div[1]/div/button',
  // ★ 类目搜索框：优先用 tracking id，XPath 里的 div[5]/div[6] 会随页面层级变化
  searchInput: '//input[@data-tracking-viewid="key_words_search"]',
  confirmBtn: '//button[@data-tracking-click-viewid="cate_confirm"]',
  // ★ 搜索面板里的第一个按钮（确定），用户实测
  confirmBtn2: '/html/body/div[5]/div/div/div[1]/div[3]/div[2]/div/div[2]/button[1]',
}
const SEL_SEARCH = 'input[data-tracking-viewid="key_words_search"]'

const norm = s => String(s || '').replace(/\s+/g, '').replace(/[>／/]/g, '').trim()

/** XPath 取第一个节点 */
function xpFirst(page, xpath) {
  return page.evaluateHandle((xp) => {
    const r = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    return r.singleNodeValue
  }, xpath).catch(() => null)
}

/** 读显示的类目文字 */
export async function readShownCategory(page) {
  return page.evaluate((xp) => {
    const r = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    const el = r.singleNodeValue
    if (!el) return { found: false, text: '' }
    return { found: true, text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() }
  }, XP.shown).catch(() => ({ found: false, text: '' }))
}

/** 按 catId 或类目名读模板 */
function loadTpl(catIdOrName) {
  const key = String(catIdOrName || '')
  if (!key || !fs.existsSync(TPL_ROOT)) return null
  const dirs = fs.readdirSync(TPL_ROOT, { withFileTypes: true }).filter(d => d.isDirectory())
  let dir = null
  if (/^\d+$/.test(key)) dir = dirs.find(d => d.name.endsWith(`-${key}`))
  if (!dir) dir = dirs.find(d => d.name.includes(key)) || null
  if (!dir) return null
  const f = path.join(TPL_ROOT, dir.name, 'template.json')
  if (!fs.existsSync(f)) return null
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null }
}

/** 模板比对候选 */
function tplNames(tpl) {
  const c = tpl?.category || {}
  const out = []
  if (c.fullName) out.push(c.fullName)
  if (Array.isArray(c.path)) out.push(...c.path, c.path.join(' > '))
  if (c.leafName) out.push(c.leafName)
  if (c.name) out.push(c.name)
  return [...new Set(out.filter(Boolean))]
}

function isMatch(shownText, tpl) {
  if (!shownText) return false
  const s = norm(shownText)
  return tplNames(tpl).some(n => {
    const t = norm(n)
    return t && (s.includes(t) || t.includes(s))
  })
}

/** 手动选择类目：三步（按文字找「选择分类」按钮） */
async function manualPick(page, tpl, log, force = false) {
  const c = tpl.category
  // ★ 搜索词（用户指定规则）：
  //   类目标题「女装/女士精品 > T恤 > T恤」→ 去掉 > / 和所有空格 → 「女装女士精品T恤T恤」
  const fullPath = c.fullName || c.name || c.leafName || (Array.isArray(c.path) ? c.path.join(' > ') : '')
  const keyword = String(fullPath)
    .replace(/\s*>\s*/g, '')
    .replace(/[/／]/g, '')
    .replace(/[\s\u3000]/g, '')
    .trim()
  const keywordList = [keyword]
  const catId = Number(c.catId)

  // 步骤一：点「选择分类」按钮（按文字直接找）
  const btnH = await page.evaluateHandle(() => {
    const nm = s => String(s || '').replace(/[\s\u3000]/g, '').trim()
    return [...document.querySelectorAll('button, a, span, div')].find(e => {
      const t = nm(e.innerText)
      return /选择分类|选择商品分类|修改分类/.test(t) && t.length <= 10 && e.getBoundingClientRect().width > 20
    }) || null
  }).catch(() => null)
  const btn = btnH ? btnH.asElement() : null
  if (!btn) {
    // 页面上没有「选择分类」按钮但有「下一步」→ 说明类目已默认选好，直接继续
    // ★ forceManual 模式下不跳过，直接返回失败让上层处理
    if (!force) {
      const hasNext = await page.evaluate(() => !!document.getElementById('bottomSubmitBtnId')).catch(() => false)
      if (hasNext) { log('  步骤一 无「选择分类」按钮，类目已默认选中，继续'); return { ok: true, shown: '' } }
    }
    return { ok: false, error: '步骤一：找不到「选择分类」按钮' }
  }
  await btn.evaluate(el => { el.scrollIntoView({ block: 'center' }); el.click() }).catch(() => { })
  log('  步骤一 已点「选择分类」')

  // 步骤二：逐个关键词试，搜到目标类目就停
  let inpH = await xpFirst(page, XP.searchInput)
  let inp = inpH ? inpH.asElement() : null
  if (!inp) inp = await page.$(SEL_SEARCH).catch(() => null)
  if (!inp) {
    inp = await page.$('input[placeholder*="关键词搜索分类"], input[placeholder*="类目"]').catch(() => null)
  }
  if (!inp) return { ok: false, error: '步骤二：找不到类目搜索输入框' }

  // 步骤二：输入（★ 输入后必须再点一下输入框，下拉才会出来）
  await inp.evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    el.focus()
    if (set) set.call(el, v); else el.value = v
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, keyword).catch(() => { })
  log(`  步骤二 输入「${keyword}」`)

  // ★ 点一下输入框，触发下拉
  await inp.click().catch(() => { })
  await inp.evaluate(el => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }).catch(() => { })
  log('  步骤二 已点输入框触发下拉')

  // ★ 等搜索结果出现 → 点第 1 项（点里面的 span，触发选中）
  let picked = false
  for (let i = 0; i < 40; i++) {
    picked = await page.evaluate(() => {
      const li = document.querySelector('li[class*="SPP_searchItem"]')
      if (!li) return false
      const r = li.getBoundingClientRect()
      if (r.width < 20 || r.height < 10) return false
      li.scrollIntoView({ block: 'center' })
      // 优先点里面的 highlight/important span（真正绑事件的是它）
      const inner = li.querySelector('span[class*="SPP_important"]') || li.querySelector('span') || li
      inner.click()
      li.click()
      return true
    }).catch(() => false)
    if (picked) break
    await sleep(400)
  }
  log('  步骤二 点搜索结果: ' + (picked ? '✅' : '❌ 没等到 li.SPP_searchItem'))
  await sleep(1000)

  // ★ 点完再校验确认按钮的 cat_id；不符就重新搜一次
  let confParams = await page.evaluate(() => {
    const b = document.querySelector('button[data-tracking-click-viewid="cate_confirm"]')
    return b ? (b.getAttribute('data-tracking-params') || '') : ''
  }).catch(() => '')
  if (confParams && !confParams.includes(`cat_id=${catId}`)) {
    log(`  ⚠ 首次点选没生效（cat_id=${confParams}），重试一次`)
    // 清空重输
    await inp.evaluate((el) => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      el.focus(); if (set) set.call(el, ''); else el.value = ''
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }).catch(() => { })
    await sleep(500)
    await inp.evaluate((el, v) => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      el.focus(); if (set) set.call(el, v); else el.value = v
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    }, keyword).catch(() => { })
    await sleep(1500)
    // 再点第 1 项
    await page.evaluate(() => {
      const li = document.querySelector('li[class*="SPP_searchItem"]')
      if (!li) return
      li.scrollIntoView({ block: 'center' })
      ;(li.querySelector('span') || li).click()
      li.click()
    }).catch(() => { })
    await sleep(800)
    confParams = await page.evaluate(() => {
      const b = document.querySelector('button[data-tracking-click-viewid="cate_confirm"]')
      return b ? (b.getAttribute('data-tracking-params') || '') : ''
    }).catch(() => '')
  }
  if (confParams) log(`  确认按钮: ${confParams}`)

  // 步骤三：点「确定」
  // 步骤三：点「确定」
  //   ① 主：button[data-tracking-click-viewid="cate_confirm"]（此时带 cat_id=目标）
  //   ② 兜底：用户给的固定 XPath
  //   ③ 兜底：面板里带「确定/确认」的按钮
  let conf = false
  const confH = await xpFirst(page, XP.confirmBtn)
  const confEl = confH ? confH.asElement() : null
  if (confEl) {
    confParams = await confEl.evaluate(el => el.getAttribute('data-tracking-params') || '').catch(() => '')
    await confEl.evaluate(e => { e.scrollIntoView({ block: 'center' }); e.click() }).catch(() => { })
    conf = true
    if (confParams && !confParams.includes(`cat_id=${catId}`)) log(`  ⚠ 确认按钮 cat_id: ${confParams}（期望 ${catId}）`)
    else if (confParams) log(`  ✅ 确认按钮 cat_id 匹配: ${confParams}`)
  }
  if (!conf) {
    conf = await page.evaluate((xp) => {
      const el = document.evaluate(xp, document, null, 9, null).singleNodeValue
      if (!el) return false
      const r = el.getBoundingClientRect()
      if (r.width < 10) return false
      el.scrollIntoView({ block: 'center' })
      el.click()
      return true
    }, XP.confirmBtn2).catch(() => false)
  }
  if (!conf) {
    conf = await page.evaluate(() => {
      const inp = document.querySelector('input[data-tracking-viewid="key_words_search"]')
      let root = inp
      for (let k = 0; k < 6 && root?.parentElement; k++) root = root.parentElement
      const scope = root || document.body
      const btns = [...scope.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 10)
      const target = btns.find(b => /确定|确认/.test(b.innerText || '')) || btns[0]
      if (target) { target.scrollIntoView({ block: 'center' }); target.click(); return true }
      return false
    }).catch(() => false)
  }
  if (!conf) return { ok: false, error: '步骤三：找不到「确定」按钮' }
  log('  步骤三 已点确定')
  await sleep(1500)

  const after = await readShownCategory(page)
  const ok = isMatch(after.text, tpl)
  log(`  步骤四 类目: ${after.text || '(空)'} → ${ok ? '✅一致' : '❌仍不一致'}`)
  return { ok, shown: after.text, keyword, confirmParams: '' }
}

/**
 * 检查类目，不一致就手动选择
 * @returns {Promise<{ok:boolean, matched?:boolean, manual?:boolean, shown?:string, error?:string}>}
 */
export async function ensureCategory(page, opts = {}) {
  const log = opts.log || console.log
  const tpl = loadTpl(opts.catId || opts.categoryName)
  if (!tpl) return { ok: false, error: '找不到类目模板' }

  // ★ forceManual：跳过"已默认选中"判断，强制走手动选类目
  if (opts.forceManual) {
    log('  forceManual → 直接手动选择类目')
    const r = await manualPick(page, tpl, log, true)
    return { ok: r.ok, matched: false, manual: true, shown: r.shown, error: r.error }
  }

  // 等类目区元素出现（元素出现即返回，不是固定等待）
  await page.waitForFunction(() => {
    if (document.getElementById('selectedCateId')) return true
    return [...document.querySelectorAll('button, a, span, div')].some(e => {
      const t = String(e.innerText || '').replace(/[\s\u3000]/g, '')
      return /选择分类|选择商品分类|修改分类/.test(t) && t.length <= 10 && e.getBoundingClientRect().width > 20
    })
  }, { timeout: 20000 }).catch(() => {})

  // ① 先检查 #selectedCateId 是否存在
  const hasRoot = await page.evaluate(() => !!document.getElementById('selectedCateId')).catch(() => false)

  if (hasRoot) {
    // 有 selectedCateId → 读 //*[@id="selectedCateId"]/div[1]/div[1]
    const shown = await readShownCategory(page)
    log(`类目检查: ${shown.found ? '"' + shown.text + '"' : '(节点存在但无文字)'} | 模板: ${tpl.category.fullName || tpl.category.name}`)

    if (shown.found && isMatch(shown.text, tpl)) {
      // 一致 → 直接到第 5 步
      log('  ✅ 一致，跳到第 5 步')
      return { ok: true, matched: true, manual: false, shown: shown.text }
    }
    // 不一致 → 手动三步
    log('  → 不一致，走手动选择分类')
    const r = await manualPick(page, tpl, log)
    return { ok: r.ok, matched: false, manual: true, shown: r.shown, error: r.error }
  }

  // ② 没有 selectedCateId → 直接手动三步
  log('类目检查: (未出现 selectedCateId) → 走手动选择分类')
  const r = await manualPick(page, tpl, log)
  return { ok: r.ok, matched: false, manual: true, shown: r.shown, error: r.error }
}

// ═══════════════════════════════════════════════════════════════════
//  点下一步
// ═══════════════════════════════════════════════════════════════════
export async function step4_clickNext(page, opts = {}) {
  const { B } = await loadModules()
  const log = opts.log || console.log

  // ★ 先检查类目（没出现 / 不对 → 手动选）
  if (opts.catId || opts.categoryName) {
    const cat = await ensureCategory(page, { catId: opts.catId, categoryName: opts.categoryName, log })
    if (!cat.ok) {
      return { ok: false, step2Ready: false, error: '类目检查失败: ' + (cat.error || '未知'), category: cat }
    }
  }

  // ── 点下一步 + 滑块 ────────────────────────────
  const { solveIfPresent } = await import(pathToFileURL(path.join(__dirname, 'helpers', 'slider.mjs')).href)

  const t0 = Date.now()
  const cap = opts.timeoutMs ?? 90000
  let ready = false
  let sliderSeen = false
  let sliderBlocked = false
  let clickCount = 0

  while (Date.now() - t0 < cap) {
    const st = await page.evaluate(() => ({
      isStep2Url: /goods_add\/index/.test(location.href),
      hasStep2Mark: /规格与库存|价格及库存|商品规格/.test(document.body.innerText || ''),
    })).catch(() => ({}))
    if (st.isStep2Url || st.hasStep2Mark) { ready = true; break }

    const h = await solveIfPresent(page, opts.shopKey, {
      step: '4 点下一步',
      onSlider: opts.onSlider,
      maxAttempts: 3,
    })
    if (h.had) {
      sliderSeen = true
      if (!h.ok) {
        sliderBlocked = true
        return {
          ok: false, step2Ready: false, url: page.url(), blockedBySlider: true,
          sliderKind: h.via === 'unsupported' ? 'click-shape' : 'slide',
          sliderText: h.text,
          error: (h.needManual ? '遇到点选几何体验证（需人工/基座处理）: ' : '滑块未通过: ') + (h.text || ''),
        }
      }
      log('  滑块已过')
      await sleep(1500)
    }

    // 点按钮（含滑块后重点）
    const r = await B.clickButton(page, {
      xpath: '//button[@id="bottomSubmitBtnId"]',
      text: '下一步',
    }).catch(e => ({ ok: false, error: String(e.message).slice(0, 120) }))
    clickCount++
    if (!r?.ok) {
      log(`  点下一步失败(${clickCount}): ${r?.error || ''}`)
    }
    await sleep(2500)
  }

  const errs = await page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('[class*="error"],[class*="tip"],[class*="warn"]')) {
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim()
      if (t && t.length < 100 && /必填|请|错误|不能|超|失败/.test(t) && !out.includes(t)) out.push(t)
    }
    return out.slice(0, 6)
  }).catch(() => [])

  return {
    ok: ready,
    step2Ready: ready,
    url: page.url(),
    catId: Number((page.url().match(/[?&]id=(\d+)/) || [])[1] || 0),
    sliderSeen,
    clickCount,
    pageErrors: errs,
    ...(ready ? {} : {
      error: sliderBlocked ? '滑块未通过' : '点了「下一步」但等不到第 2 步' + (sliderSeen ? '（过程中出现过滑块）' : ''),
    }),
  }
}

export default step4_clickNext











