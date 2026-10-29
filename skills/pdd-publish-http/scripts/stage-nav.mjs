/**
 * 发布组件 · 段1 导航 + 段2 选类目
 *
 * 从已验证的 test_components.mjs 抽取，逻辑一字未改。
 *
 *   段1：打开商品列表 → 点「发布新商品」→ 等类目页/表单页出现
 *   段2：类目页搜索 → 等结果稳定 → 点第一个结果 → 点「确认发布该类商品」→ 等表单页
 */
const sleep = ms => new Promise(r => setTimeout(r, ms))

const LIST_URL = 'https://mms.pinduoduo.com/goods/goods_list'

/**
 * 段1：打开商品列表并点「发布新商品」
 * @returns { page } 新开的类目页/表单页
 */
export async function openPublishEntry(page, opts = {}) {
  const log = opts.log || (() => {})
  log('段1 打开商品列表')

  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(5000)

  // 找「发布新商品」按钮（排除左侧导航里的同名项）
  const pt = await page.evaluate(() => {
    const NAV = 'nav, aside, [class*="sidenav"], [class*="sideNav"], [class*="menu"]'
    const els = [...document.querySelectorAll('button, a, div, span')]
      .filter(el => (el.innerText || '').trim() === '发布新商品' && !el.closest(NAV))
    const el = els.find(e => e.tagName === 'BUTTON') || els[els.length - 1]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  if (!pt) throw new Error('找不到「发布新商品」按钮')

  await page.mouse.click(pt.x, pt.y)
  await sleep(5000)
  return page
}

/**
 * 等类目页/表单页出现
 * @returns { page } 目标页
 */
export async function waitForPublishPage(browser, opts = {}) {
  const timeoutMs = opts.timeoutMs || 60000
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const pages = await browser.pages()
    const hit = pages.find(p => /goods\/(category|goods_add)/.test(String(p.url() || '')))
    if (hit) {
      await hit.bringToFront()
      await sleep(3000)
      return hit
    }
    await sleep(1000)
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

  const hasSearch = await page.evaluate(() =>
    !!document.querySelector('input[placeholder*="搜索分类"]')
  ).catch(() => false)

  if (!hasSearch) {
    // 没有搜索框 → 可能已经在表单页
    log('  无类目搜索框（可能已在表单页）')
    return page
  }

  const sp = await page.evaluate(() => {
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
    const c = await page.evaluate(() =>
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
  const picked = await page.evaluate(() => {
    const items = [...document.querySelectorAll('li')].filter(el => /SPP_searchItem|searchItem/i.test(el.className || ''))
    if (!items.length) return null
    const txt = (items[0].innerText || '').replace(/\s+/g, ' ').trim()
    items[0].click()
    return txt
  }).catch(() => null)
  log(`  选中类目: ${picked || '(空)'}`)
  await sleep(2000)

  // 点「确认发布该类商品」
  const cp = await page.evaluate(() => {
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
  await sleep(8000)

  // 等表单页
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (/goods_add\/index/.test(String(page.url() || ''))) break
    const pages = await page.browser().pages()
    const hit = pages.find(p => /goods_add\/index/.test(String(p.url() || '')))
    if (hit) { await hit.bringToFront(); break }
    await sleep(1000)
  }

  // 等规格区渲染
  for (let i = 0; i < 15; i++) {
    await sleep(1500)
    const ready = await page.evaluate(() => !!document.querySelector('#goods-spec-sku')).catch(() => false)
    if (ready) break
  }
  return page
}
