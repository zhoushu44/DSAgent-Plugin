/**
 * step1.mjs — 拼多多上架 步骤 1
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
//  步骤 1：打开发布页
// ═══════════════════════════════════════════════════════════════════
/**
 * @returns {Promise<{ok, page?, browser?, catId?, goodsId?, url?, error?}>}
 */
export async function step1_openPublishPage(opts = {}) {
  const shopKey = opts.shopKey
  if (!shopKey) return { ok: false, error: '缺 shopKey' }

  const PROFILE = path.join(os.homedir(), '.dsh', 'browser-profiles', 'accounts', shopKey)
  const { default: puppeteer } = await import(
    pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href
  )

  let browser = null
  try {
    browser = await puppeteer.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: opts.headless === true,
      userDataDir: PROFILE,
      defaultViewport: null,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized',
        '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'],
      ignoreDefaultArgs: ['--enable-automation'],
      protocolTimeout: 600000,
    })

    // ★ 装滑块 hook（必须在 goto 之前，穿透 closed shadow root）
    try {
      const { installShadowHook } = await import(
        pathToFileURL(path.join(__dirname, '..', '..', '..', '_shared', '_unused', 'pdd-shadow-hook.mjs')).href
      )
      const pg0 = (await browser.pages())[0]
      if (pg0) await installShadowHook(pg0)
    } catch (e) { /* hook 失败不阻断流程，滑块求解器有降级 */ }

    // ★ 选页：优先用已打开的拼多多页面，其次新建（避免拿到 about:blank）
    const allPages = await browser.pages()
    let list = allPages.find(pg => /mms\.pinduoduo\.com/.test(pg.url())) || null
    if (!list) {
      list = allPages.find(pg => !/^about:/.test(pg.url()) && pg.url() !== '') || allPages[0] || null
    }
    if (!list) list = await browser.newPage()

    // ★ 导航：失败要重试，不能静默吞掉（否则停在 about:blank）
    let navErr = ''
    for (let i = 0; i < 3; i++) {
      try {
        await list.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
        navErr = ''
        break
      } catch (e) {
        navErr = String(e.message || e).slice(0, 150)
        await sleep(3000)
      }
    }
    if (navErr) {
      await browser.close().catch(() => { })
      return { ok: false, error: `导航到商品列表失败（重试 3 次）: ${navErr}` }
    }
    // 确认真的到了目标页
    const curUrl = list.url()
    if (/^about:/.test(curUrl) || curUrl === '') {
      await browser.close().catch(() => { })
      return { ok: false, error: `导航后页面仍是空白（${curUrl}），可能网络异常` }
    }

    // ★ 等页面稳定：轮询检查是否被踢到登录页
    let loggedOut = false
    for (let i = 0; i < 8; i++) {
      await sleep(2000)
      const u = list.url()
      if (/\/login/.test(u)) { loggedOut = true; break }
      // 页面有商品列表特征就提前结束
      const ready = await list.evaluate(() => {
        const t = document.body.innerText || ''
        return t.length > 1000 && (/发布新商品/.test(t) || /商品列表/.test(t))
      }).catch(() => false)
      if (ready) break
    }
    if (loggedOut) {
      await browser.close().catch(() => { })
      return { ok: false, error: '未登录：浏览器 profile 会话失效，请到「账号连接」重新登录' }
    }

    // ★ 点「发布新商品」：页面上有多处同名元素（侧边栏 nav-item / 顶部按钮），
    //   必须选「可见的 BUTTON 且在内容区（x > 200）」那个，否则会点到左侧菜单。
    const clicked = await list.evaluate(() => {
      const norm = s => (s || '').replace(/[\s\u3000]/g, '')
      const all = [...document.querySelectorAll('button,a,div,span')]
        .filter(e => norm(e.innerText) === '发布新商品')
      const scored = all.map(e => {
        const r = e.getBoundingClientRect()
        return {
          el: e, tag: e.tagName,
          x: Math.round(r.x), y: Math.round(r.y),
          w: Math.round(r.width), h: Math.round(r.height),
          visible: r.width > 20 && r.height > 10,
        }
      }).filter(o => o.visible)

      // 优先 BUTTON 且 x>200（内容区）；其次任意 x>200；最后兜底第一个可见
      const pick = scored.find(o => o.tag === 'BUTTON' && o.x > 200)
        || scored.find(o => o.x > 200)
        || scored[0]

      if (!pick) return { ok: false, error: '页面上找不到「发布新商品」', candidates: scored.length }

      pick.el.scrollIntoView({ block: 'center' })
      const r = pick.el.getBoundingClientRect()
      pick.el.click()
      return {
        ok: true, tag: pick.tag,
        x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
        candidates: scored.length,
      }
    }).catch(e => ({ ok: false, error: String(e.message).slice(0, 120) }))

    if (clicked?.ok) {
      // 若 el.click() 没生效（React 有时需要真实鼠标），用坐标补一次
      await sleep(3000)
      const opened = (await browser.pages()).some(pg => /goods\/category/.test(pg.url()))
      if (!opened && clicked.x && clicked.y) {
        await list.mouse.click(clicked.x, clicked.y)
      }
    }
    if (!clicked?.ok) {
      // 再确认一次是不是掉登录了
      const nowUrl = list.url()
      await browser.close().catch(() => { })
      if (/\/login/.test(nowUrl)) {
        return { ok: false, error: '未登录：页面被踢到登录页，请重新登录' }
      }
      return { ok: false, error: '点不到「发布新商品」: ' + (clicked?.error || '按钮未找到') + `（当前页面: ${nowUrl.slice(0, 80)}，文本长度: ...）` }
    }
    await sleep(8000)

    // 等新标签页
    let publishPage = null
    const t0 = Date.now()
    const cap = opts.timeoutMs ?? 120000
    while (Date.now() - t0 < cap) {
      const pages = await browser.pages()
      publishPage = pages.find(p => /goods\/category/.test(p.url()))
      if (publishPage) break
      if (/goods\/category/.test(list.url())) { publishPage = list; break }
      await sleep(2000)
    }
    if (!publishPage) {
      const urls = (await browser.pages()).map(p => p.url()).filter(Boolean)
      await browser.close().catch(() => { })
      return { ok: false, error: `等不到发布页。当前: ${urls.join(' | ').slice(0, 250)}` }
    }

    await publishPage.bringToFront()
    await sleep(10000)

    // 等第 1 步就绪：主图区出现（组件 probe）
    const { M } = await loadModules()
    let ready = false
    for (let i = 0; i < 20; i++) {
      const p = await M.probeImageRegion(publishPage, 'carousel').catch(() => ({ exists: false }))
      if (p?.exists) { ready = true; break }
      await sleep(3000)
    }
    if (!ready) {
      await browser.close().catch(() => { })
      return { ok: false, error: '发布页未渲染出主图区' }
    }

    const url = publishPage.url()
    return {
      ok: true, page: publishPage, browser, url,
      catId: Number((url.match(/[?&]id=(\d+)/) || [])[1] || 0),
      goodsId: Number((url.match(/[?&]goods_id=(\d+)/) || [])[1] || 0),
    }
  } catch (e) {
    if (browser) await browser.close().catch(() => { })
    return { ok: false, error: String(e?.message || e).slice(0, 300) }
  }
}



export default step1_openPublishPage












