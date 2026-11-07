/**
 * 发布组件 · 段1 导航 + 段2 选类目
 *
 * 从已验证的 test_components.mjs 抽取，逻辑一字未改。
 *
 *   段1：打开商品列表 → 点「发布新商品」→ 等类目页/表单页出现
 *   段2：类目页搜索 → 等结果稳定 → 点第一个结果 → 点「确认发布该类商品」→ 等表单页
 */
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ★ 2026-11-05：页面 URL 统一从基座注册表取（PDD 改版只改 _shared/pdd-api.mjs）
const { pageUrl } = await import('file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-api.mjs')
const LIST_URL = pageUrl('page.goodsList')

/**
 * 段1：打开商品列表并点「发布新商品」
 * @returns { page } 新开的类目页/表单页
 */
export async function openPublishEntry(page, opts = {}) {
  const log = opts.log || (() => {})
  log('段1 打开商品列表')

  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  // ★ 2026-10-30 优化：把固定 5s 等待改成轮询（等到按钮出现就继续，最多 8s）
  let pt = null
  for (let w = 0; w < 16; w++) {
    await sleep(500)
    pt = await page.evaluate(() => {
      const NAV = 'nav, aside, [class*="sidenav"], [class*="sideNav"], [class*="menu"]'
      const els = [...document.querySelectorAll('button, a, div, span')]
        .filter(el => (el.innerText || '').trim() === '发布新商品' && !el.closest(NAV))
      const el = els.find(e => e.tagName === 'BUTTON') || els[els.length - 1]
      if (!el) return null
      const r = el.getBoundingClientRect()
      if (r.width < 20 || r.y < 0 || r.y > window.innerHeight) return null
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }).catch(() => null)
    if (pt) break
  }
  if (!pt) throw new Error('找不到「发布新商品」按钮')

  await page.mouse.click(pt.x, pt.y)
  // ★ 轮询等类目页/表单页（原来固定 5s，改成等到 URL 变化）
  await sleep(1500)
  return page
}

/**
 * 等类目页/表单页出现
 * @returns { page } 目标页
 */
export async function waitForPublishPage(browser, opts = {}) {
  const timeoutMs = opts.timeoutMs || 90000   // ★ 60s → 90s（大促/晚上页面慢）
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const pages = await browser.pages()
    const hit = pages.find(p => /goods\/(category|goods_add)/.test(String(p.url() || '')))
    if (hit) {
      await hit.bringToFront()
      await sleep(2000)
      return hit
    }
    await sleep(500)
  }
  throw new Error('类目页/表单页未出现')
}

/**
 * 段2：选类目（搜索 → 等稳定 → 点第一个 → 确认）
 * @param page 类目页
 * @param category 类目关键词，如「儿童睡衣」
 * @returns { page } 表单页
 */
export async function selectCategory(page, category, opts = {}) {
  const log = opts.log || (() => {})
  const kw = String(category || '').trim()
  log(`段2 选类目: ${kw}`)

  // ★ 2026-10-30 优化：老类目用模板里的 catId 直达（跳过搜索，省 5s）
  //   注意：连接模式下 page.goto 会挂起，所以只有**新开浏览器**时才用直达
  if (opts.catId && !opts.connected) {
    const directUrl = `https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&id=${opts.catId}`
    log(`  用 catId=${opts.catId} 直达表单页`)
    await page.goto(directUrl, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {})
    // 等表单页就绪
    for (let i = 0; i < 30; i++) {
      await sleep(800)
      const ready = await page.evaluate(() => {
        const hasSpecBox = !!document.querySelector('#goods-spec-sku')
        const hasTitle = !!document.querySelector('input[placeholder*="商品标题组成"]')
        return hasSpecBox && hasTitle
      }).catch(() => false)
      if (ready) { log('  直达页已就绪'); await sleep(800); return page }
    }
    log('  ⚠ 直达页 24s 内未就绪，回退搜索选类目')
  }

  // ★ 2026-10-30：页面跳转时 frame 会失效（detached Frame）。
  //   所有页面操作包一层"frame 失效则等待重试"，最多重试 3 次。
  //   ★ 注意：内部必须调 page.evaluate（原始方法），不能再调 safeEval（会无限递归）
  const safeEval = async (fn, ...args) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await page.evaluate(fn, ...args)
      } catch (e) {
        const msg = String(e?.message || '')
        if (!/detached Frame|Execution context was destroyed|Target closed/.test(msg)) throw e
        log(`  页面跳转中，等待重试（${attempt + 1}/3）`)
        await sleep(2500)
      }
    }
    return null
  }

  const hasSearch = await safeEval(() =>
    !!document.querySelector('input[placeholder*="搜索分类"]')
  ).catch(() => false)

  if (!hasSearch) {
    // 没有搜索框 → 可能已经在表单页
    log('  无类目搜索框（可能已在表单页）')
    return page
  }

  const sp = await safeEval(() => {
    const e = document.querySelector('input[placeholder*="搜索分类"]')
    const r = e.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  await page.mouse.click(sp.x, sp.y)
  await sleep(400)

  // 清空再输入（避免上次残留）
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await sleep(200)
  await page.keyboard.type(kw, { delay: 100 })

  // ★ 等搜索结果稳定（li 数量连续 2 次相同）
  let prevCount = -1
  let stableTimes = 0
  for (let w = 0; w < 20; w++) {
    await sleep(600)
    const c = await safeEval(() =>
      [...document.querySelectorAll('li')].filter(el => /SPP_searchItem|searchItem/i.test(el.className || '')).length
    ).catch(() => 0)
    if (c > 0 && c === prevCount) {
      stableTimes++
      if (stableTimes >= 2) break
    } else {
      stableTimes = 0
    }
    prevCount = c
  }

  // 点第一个结果
  const picked = await safeEval(() => {
    const items = [...document.querySelectorAll('li')].filter(el => /SPP_searchItem|searchItem/i.test(el.className || ''))
    if (!items.length) return null
    const txt = (items[0].innerText || '').replace(/\s+/g, ' ').trim()
    items[0].click()
    return txt
  }).catch(() => null)
  log(`  选中类目: ${picked || '(空)'}`)
  await sleep(2000)

  // 点「确认发布该类商品」
  const cp = await safeEval(() => {
    const btns = [...document.querySelectorAll('button, a, div, span')]
      .map(e => {
        const r = e.getBoundingClientRect()
        return {
          tx: (e.innerText || e.textContent || '').trim(),
          x: Math.round(r.x + r.width / 2),
          y: Math.round(r.y + r.height / 2),
          w: Math.round(r.width),
        }
      })
      .filter(o => /确认发布该类商品/.test(o.tx) && o.w > 30)
    return btns[btns.length - 1] || null
  })
  if (cp) {
    await page.mouse.click(cp.x, cp.y)
    log('  点了确认')
  }
  // ★ 2026-10-30 优化：把固定 8s 等待改成轮询（等 URL 变到 goods_add，最多 12s）
  {
    const t0 = Date.now()
    while (Date.now() - t0 < 12000) {
      await sleep(500)
      const pages = await page.browser().pages()
      const hit = pages.find(p => /goods_add\/index/.test(String(p.url() || '')))
      if (hit) { await hit.bringToFront(); break }
    }
  }

  // 等表单页
  const deadline = Date.now() + 20000   // ★ 从 30s 降到 20s
  while (Date.now() < deadline) {
    if (/goods_add\/index/.test(String(page.url() || ''))) break
    const pages = await page.browser().pages()
    const hit = pages.find(p => /goods_add\/index/.test(String(p.url() || '')))
    if (hit) { await hit.bringToFront(); break }
    await sleep(500)   // ★ 从 1s 降到 500ms
  }

  // ★ 2026-10-30：等表单页**完全就绪**（不只是 URL 变了）
  //   判定三件事同时成立：
  //     ① 规格区容器 #goods-spec-sku 存在
  //     ② 标题输入框存在（说明基本信息区渲染完）
  //     ③ 「添加规格类型」按钮 或 预置规格行 至少有一个
  //   之前只等 ①，导致段4 一上来就找不到按钮、截图失败。
  let ready = false
  for (let i = 0; i < 40; i++) {
    await sleep(1000)
    ready = await safeEval(() => {
      const hasSpecBox = !!document.querySelector('#goods-spec-sku')
      const hasTitle = !!document.querySelector('input[placeholder*="商品标题组成"]')
      const hasAddBtn = [...document.querySelectorAll('button, div, span, a')].some(e => {
        const t = (e.innerText || '').trim()
        const r = e.getBoundingClientRect()
        return /^添加规格类型|^添加规格/.test(t) && r.width > 20
      })
      const hasSpecRow = !!document.querySelector('#goods-spec-sku .property-container-v2, #goods-spec-sku .goods-spec-row')
      return hasSpecBox && hasTitle && (hasAddBtn || hasSpecRow)
    }).catch(() => false)
    if (ready) break
  }
  if (ready) {
    log('  表单页完全就绪')
    await sleep(800)   // ★ 从 1500 降到 800（React 已渲染完，不需要再等）
  } else {
    log('  ⚠ 表单页 40s 内未完全就绪，仍尝试继续')
  }

  return page
}
