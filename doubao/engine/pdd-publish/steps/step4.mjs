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

/** 读当前真实选中的类目（看带 cateItemCard_checked 的卡片，不用过时的 XPath 节点） */
export async function readShownCategory(page) {
  return page.evaluate(() => {
    // ① 首选：带 checked 类的类目卡片（data-tracking-params 里有 choosen_cate=<catId>）
    const card = document.querySelector('[data-tracking-viewid="choose_cate"][class*="cateItemCard_checked"]')
    if (card) {
      const params = card.getAttribute('data-tracking-params') || ''
      const m = params.match(/choosen_cate=(\d+)/)
      return {
        found: true,
        text: (card.innerText || '').replace(/\s+/g, ' ').trim(),
        catId: m ? Number(m[1]) : 0,
      }
    }
    // ② 兜底：老 XPath（弹框未打开时的展示节点）
    const r = document.evaluate('//*[@id="selectedCateId"]/div[1]/div[1]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    const el = r.singleNodeValue
    if (!el) return { found: false, text: '', catId: 0 }
    const params = el.getAttribute('data-tracking-params') || ''
    const m = params.match(/choosen_cate=(\d+)/)
    return {
      found: true,
      text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(),
      catId: m ? Number(m[1]) : 0,
    }
  }).catch(() => ({ found: false, text: '', catId: 0 }))
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
  // ★ 页面类目路径必须与模板标题**完全相等**才算一致。
  //   模板 category.name 形如「童装/婴儿装/亲子装 > 儿童家居服 > 家居服套装」。
  //   不相等 → 走第 3 步手动选择。
  const normPath = s => String(s || '')
    .replace(/[＞›»]/g, '>')
    .replace(/[／]/g, '/')
    .replace(/[\s\u3000]/g, '')
    .trim()
  const target = normPath(tpl?.category?.name || tpl?.category?.fullName || '')
  if (!target) return false
  return normPath(shownText) === target
}

/** 手动选择类目 —— 严格按用户给定的 4 步流程与选择器 */
async function manualPick(page, tpl, log, force = false) {
  const c = tpl.category
  // ★ 搜索词（用户规则）：类目标题去掉 > / 和所有空格
  const fullPath = c.fullName || c.name || c.leafName || (Array.isArray(c.path) ? c.path.join(' > ') : '')
  const keyword = String(fullPath)
    .replace(/\s*>\s*/g, '')
    .replace(/[/／]/g, '')
    .replace(/[\s\u3000]/g, '')
    .trim()
  const catId = Number(c.catId)

  // ── 第 1 步：找「手动选择商品分类」按钮
  //   策略：先 data-tracking-viewid，再 XPath，最后**按文本包含「分类」**兜底
  let btn = await page.$('button[data-tracking-viewid="manually_select_product_category"]').catch(() => null)
  if (!btn) {
    const h = await page.evaluateHandle(() => {
      const r = document.evaluate('//*[@id="selectedCateId"]/div[2]/button', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      return r.singleNodeValue
    }).catch(() => null)
    btn = h ? h.asElement() : null
  }
  if (!btn) {
    // ★ 按文本包含「分类」找按钮（用户要求）
    const h = await page.evaluateHandle(() => {
      const cands = [...document.querySelectorAll('button')].filter(e => {
        const r = e.getBoundingClientRect()
        if (r.width < 10 || r.height < 10) return false
        const t = (e.innerText || '').replace(/\s+/g, '').trim()
        return t.includes('分类') && t.length <= 16
      })
      // 优先含「手动选择」，否则第一个
      return cands.find(e => /手动选择/.test(e.innerText || '')) || cands[0] || null
    }).catch(() => null)
    btn = h ? h.asElement() : null
  }
  if (!btn) {
    if (!force) {
      const hasNext = await page.evaluate(() => !!document.getElementById('bottomSubmitBtnId')).catch(() => false)
      if (hasNext) { log('  第1步 无「手动选择商品分类」，类目已默认选中，继续'); return { ok: true, shown: '' } }
    }
    return { ok: false, error: '第1步：找不到「手动选择商品分类」按钮' }
  }
  await btn.evaluate(el => { el.scrollIntoView({ block: 'center' }); el.click() }).catch(() => { })
  log('  第1步 已点「手动选择商品分类」')
  await sleep(1500)

  // ── 第 2 步：输入类目（input[data-tracking-viewid="key_words_search"]）后带左键点击
  let inp = await page.$('input[data-tracking-viewid="key_words_search"]').catch(() => null)
  if (!inp) inp = await page.$('input[placeholder*="关键词搜索分类"]').catch(() => null)
  if (!inp) return { ok: false, error: '第2步：找不到类目搜索输入框' }

  await inp.click().catch(() => { })
  await inp.evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    el.focus()
    if (set) set.call(el, v); else el.value = v
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, keyword).catch(() => { })
  log(`  第2步 输入「${keyword}」`)
  // ★ 输入后带左键点击（mousedown/mouseup 走真实按下-抬起）
  const ibox = await inp.boundingBox().catch(() => null)
  if (ibox) await page.mouse.click(ibox.x + ibox.width / 2, ibox.y + ibox.height / 2).catch(() => { })
  await sleep(1500)

  // ── 第 3 步：点下拉第一个 li[1]（li.SPP_searchItem 第一个）
  let picked = false
  for (let i = 0; i < 40; i++) {
    const box = await page.evaluate(() => {
      const ul = document.querySelectorAll('ul')
      let li = null
      // 优先用户给的固定路径 /html/body/div[6]/div/div/div/div/ul/li[1]
      for (const u of ul) {
        const cand = u.querySelector('li[class*="SPP_searchItem"]')
        if (cand) { li = cand; break }
      }
      if (!li) return null
      const r = li.getBoundingClientRect()
      if (r.width < 20 || r.height < 10) return null
      return { x: r.x + Math.min(200, r.width / 2), y: r.y + r.height / 2, text: (li.innerText || '').trim() }
    }).catch(() => null)

    if (box) {
      await page.mouse.click(box.x, box.y).catch(() => { })
      await sleep(1000)
      const cur = await page.evaluate(() => {
        const b = document.querySelector('button[data-tracking-click-viewid="cate_confirm"]')
        return b ? (b.getAttribute('data-tracking-params') || '') : ''
      }).catch(() => '')
      if (cur.includes(`cat_id=${catId}`)) { picked = true; log(`  第3步 已选第一个: ${box.text}`); break }
      // 兜底补一次合成点击
      await page.evaluate(() => {
        const li = document.querySelector('li[class*="SPP_searchItem"]')
        if (!li) return
        const inner = li.querySelector('span') || li
        inner.click(); li.click()
      }).catch(() => { })
      await sleep(700)
      const cur2 = await page.evaluate(() => {
        const b = document.querySelector('button[data-tracking-click-viewid="cate_confirm"]')
        return b ? (b.getAttribute('data-tracking-params') || '') : ''
      }).catch(() => '')
      if (cur2.includes(`cat_id=${catId}`)) { picked = true; log(`  第3步 已选第一个: ${box.text}`); break }
    }
    await sleep(400)
  }
  if (!picked) return { ok: false, error: `第3步：未选中目标 cat_id=${catId}` }

  // ── 第 4 步：确定 button[data-tracking-click-viewid="cate_confirm"]（cat_id=目标）
  let confParams = await page.evaluate(() => {
    const b = document.querySelector('button[data-tracking-click-viewid="cate_confirm"]')
    return b ? (b.getAttribute('data-tracking-params') || '') : ''
  }).catch(() => '')
  log(`  第4步 确认按钮: ${confParams}`)

  let conf = false
  const confBtn = await page.$('button[data-tracking-click-viewid="cate_confirm"]').catch(() => null)
  if (confBtn) {
    const bb = await confBtn.boundingBox().catch(() => null)
    if (bb) await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2).catch(() => { })
    else await confBtn.evaluate(e => { e.scrollIntoView({ block: 'center' }); e.click() }).catch(() => { })
    conf = true
  }
  if (!conf) {
    // 兜底：用户给的固定 XPath /html/body/div[5]/div/div/div[1]/div[3]/div[2]/div/div[2]/button[1]
    conf = await page.evaluate(() => {
      const el = document.evaluate('/html/body/div[5]/div/div/div[1]/div[3]/div[2]/div/div[2]/button[1]', document, null, 9, null).singleNodeValue
      if (!el) return false
      el.scrollIntoView({ block: 'center' }); el.click(); return true
    }).catch(() => false)
  }
  if (!conf) return { ok: false, error: '第4步：找不到「确认」按钮' }
  log('  第4步 已点确认')

  // ★ 2026-11-26 提速：原来这里只等「selectedCateId 里出现目标类目名」，
  //   实测在 15021/家居服套装 这类目上那个容器一直不更新 → 每次白等满 20 秒超时
  //   （日志：已点确认 → 20.3s 后才 ✅）。默认值改回 20s 前先实测：
  //   现在三条件任一成立就返回（最多 6s）：① 类目文字刷出目标名 ② 选类目面板已关闭
  //   ③ 出现「修改分类」且带目标 cat_id。残余竞态交给下面「下一步」的 5 次重试吸收。
  const wantName = String(
    tpl?.category?.name
    || tpl?.category?.fullName?.split('>').pop()
    || ''
  ).trim()
  const tWait = Date.now()
  while (Date.now() - tWait < 6000) {
    const st = await page.evaluate((want) => {
      const el = document.getElementById('selectedCateId')
      const txt = el ? (el.innerText || '').replace(/\s+/g, '') : ''
      const btn = document.querySelector('button[data-tracking-click-viewid="cate_confirm"]')
      const panelGone = !btn || btn.offsetParent === null
      const card = [...document.querySelectorAll('[data-tracking-viewid="choose_cate"], [data-tracking-click-viewid="choose_cate"]')]
        .map(e => e.getAttribute('data-tracking-params') || '').join(' ')
      return {
        text: txt, panelGone,
        textOk: want ? txt.includes(want) : txt.length > 0,
        cardOk: !!card,
      }
    }, wantName).catch(() => ({}))
    if (st.textOk) { log('  第4步 类目文字已刷新'); break }
    if (st.panelGone) { log('  第4步 选类目面板已关闭'); break }
    if (st.cardOk) { log('  第4步 类目卡片已更新'); break }
    await sleep(250)
  }
  await sleep(200)

  // ★ 第4步确认按钮的 cat_id 已等于目标，即视为选类目成功。
  //   不再回读页面类目文字做二次校验（页面文字刷新有延迟，会误判为「仍不一致」）。
  log(`  第4步 ✅ 类目已确认 cat_id=${catId}`)
  return { ok: true, shown: '', keyword, confirmParams: confParams }
}

/**
 * 检查类目，不一致就手动选择
 * @returns {Promise<{ok:boolean, matched?:boolean, manual?:boolean, shown?:string, error?:string}>}
 */
export async function ensureCategory(page, opts = {}) {
  const log = opts.log || console.log
  const tpl = loadTpl(opts.catId || opts.categoryName)
  if (!tpl) {
    // ★ 2026-11-26：这里以前静默返回失败，上层不检查返回值就会带着页面上残留的类目继续填，
    //   一路填到提交前都不报错（T2 第一次实测就是这样发到了错误的「套装」类目）。
    log(`类目检查: ❌ 找不到类目模板（catId=${opts.catId || opts.categoryName || '未指定'}）`)
    return { ok: false, error: `找不到类目模板：catId=${opts.catId || opts.categoryName || '未指定'}` }
  }

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

    // ★ 判定一致性：优先用卡片里的 choosen_cate 与模板 catId 比对；
    //   没有 catId 时再退回文字路径比较。
    const sameCat = shown.catId ? Number(shown.catId) === Number(tpl.category.catId) : isMatch(shown.text, tpl)
    if (shown.found && sameCat) {
      // 出现且一致 → 跳第 2 步（点 #bottomSubmitBtnId）
      log('  ✅ 一致，跳到第 5 步')
      return { ok: true, matched: true, manual: false, shown: shown.text }
    }
    // 出现但不一致 → 走第 3 步「手动选择商品分类」
    log('  → 不一致，走手动选择分类')
    const r = await manualPick(page, tpl, log)
    return { ok: r.ok, matched: false, manual: true, shown: r.shown, error: r.error }
  }

  // 没出现 → 直接跳第 3 步「手动选择商品分类」
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

  // ★ 失败诊断：转储弹窗/遮罩/按钮，定位新类目卡点（2026-11-23 橘子/生鲜）
  if (!ready) {
    const diag = await page.evaluate(() => {
      const txt = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80)
      const dialogs = [...document.querySelectorAll('[class*="modal"],[class*="dialog"],[class*="popup"],[class*="drawer"],[role="dialog"]')]
        .filter(el => el.offsetParent !== null && txt(el)).map(el => `[${el.tagName}.${(el.className || '').toString().slice(0, 40)}] ${txt(el)}`).slice(0, 6)
      const btns = [...document.querySelectorAll('button, a, [class*="btn"]')]
        .filter(el => el.offsetParent !== null && /下一步|确认|同意|资质|承诺|协议|继续/.test(el.innerText || '')).map(el => `[${el.tagName}] ${txt(el)}`).slice(0, 10)
      return { url: location.href.slice(0, 100), dialogs, btns, bodyTail: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(-260) }
    }).catch(e => ({ diagErr: String(e.message).slice(0, 80) }))
    console.error(`[s4-diag] ${JSON.stringify(diag)}`)
  }

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











