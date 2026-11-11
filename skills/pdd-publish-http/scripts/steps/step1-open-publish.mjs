/**
 * step1-open-publish.mjs — 步骤一：打开发布页面
 *
 * 输出下一步需要的上下文：
 *   { ok, page, browser, catId, goodsId, url, error }
 *
 * ────────────────────────────────────────────────────────────────
 * 流程（实测 2026-11-08）
 *
 *   1. 打开 https://mms.pinduoduo.com/goods/goods_list
 *   2. 点「发布新商品」→ 会开【新标签页】
 *   3. 新标签页 URL 形如：
 *        goods/category?id=205728997389&goods_id=1027054525071&type=add&sourcePage=
 *      id           = 页面用的 catId（注意：不是叶子类目 id）
 *      goods_id     = 草稿商品 id
 *   4. 该页即「第 1 步：主图 + 标题」
 * ────────────────────────────────────────────────────────────────
 */
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..', '..')

const ORIGIN = 'https://mms.pinduoduo.com'
const LIST_URL = `${ORIGIN}/goods/goods_list`

/**
 * 打开发布页（第 1 步）
 *
 * @param {object} opts
 * @param {string} opts.shopKey  浏览器 profile 的账号 key
 * @param {boolean} [opts.headless=false]
 * @param {number} [opts.timeoutMs=120000]
 * @returns {Promise<{ok:boolean, page?:object, browser?:object, catId?:number, goodsId?:number, url?:string, error?:string}>}
 */
export async function openPublishPage(opts = {}) {
  const shopKey = opts.shopKey
  if (!shopKey) return { ok: false, error: '缺 shopKey' }

  const PROFILE = path.join(os.homedir(), '.dsh', 'browser-profiles', 'accounts', shopKey)
  const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href)

  let browser = null
  try {
    browser = await puppeteer.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: opts.headless === true,
      userDataDir: PROFILE,
      defaultViewport: null,
      args: [
        '--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized',
        '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
      protocolTimeout: 600000,
    })

    const list = (await browser.pages())[0] || await browser.newPage()

    // ① 打开商品列表
    await list.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => { })
    await sleep(12000)

    if (/login/.test(list.url())) {
      await browser.close().catch(() => { })
      return { ok: false, error: '未登录：浏览器 profile 会话失效，需到「账号连接」重新登录' }
    }

    // ② 找并点「发布新商品」
    const btn = await findPublishButton(list)
    if (!btn) {
      await browser.close().catch(() => { })
      return { ok: false, error: '找不到「发布新商品」按钮（页面可能未加载完或有验证码）' }
    }
    await list.mouse.click(btn.x, btn.y)
    await sleep(8000)

    // ③ 等新标签页出现
    let publishPage = null
    const t0 = Date.now()
    const cap = opts.timeoutMs ?? 120000
    while (Date.now() - t0 < cap) {
      const pages = await browser.pages()
      publishPage = pages.find(p => /goods\/category/.test(p.url()))
      if (publishPage) break
      // 有些情况不开新标签，直接跳转
      if (/goods\/category/.test(list.url())) { publishPage = list; break }
      await sleep(2000)
    }

    if (!publishPage) {
      const pages = await browser.pages()
      const urls = pages.map(p => p.url()).filter(Boolean)
      await browser.close().catch(() => { })
      return { ok: false, error: `等不到发布页。当前标签页: ${urls.join(' | ').slice(0, 300)}` }
    }

    await publishPage.bringToFront()
    await sleep(10000)

    // ④ 等页面渲染（「上传图片」出现即视为就绪）
    const ready = await waitStep1Ready(publishPage, 60000)
    if (!ready) {
      await browser.close().catch(() => { })
      return { ok: false, error: '发布页未渲染出主图区（可能加载慢或触发验证码）' }
    }

    // ⑤ 解析 URL 参数
    const url = publishPage.url()
    const catId = Number((url.match(/[?&]id=(\d+)/) || [])[1] || 0)
    const goodsId = Number((url.match(/[?&]goods_id=(\d+)/) || [])[1] || 0)

    await publishPage.evaluate(() => { window.__step1Ready = true }).catch(() => { })

    return { ok: true, page: publishPage, browser, catId, goodsId, url }

  } catch (e) {
    if (browser) await browser.close().catch(() => { })
    return { ok: false, error: String(e?.message || e).slice(0, 300) }
  }
}

/** 找「发布新商品」按钮坐标 */
async function findPublishButton(page) {
  return page.evaluate(() => {
    const norm = s => (s || '').replace(/\s+/g, '').trim()
    const cands = [...document.querySelectorAll('button,a,div,span')].filter(e => norm(e.innerText) === '发布新商品')
    // 优先 button
    const el = cands.find(e => e.tagName === 'BUTTON') || cands[0]
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    if (r.width < 20 || r.height < 10) return null
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }).catch(() => null)
}

/** 等第 1 步就绪（主图区出现） */
async function waitStep1Ready(page, timeoutMs = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const ok = await page.evaluate(() => {
      const hasCarousel = !!document.querySelector('section[class*="goodsCarousel_uploadImgEnter"]')
      const hasTitle = !!document.querySelector('input[placeholder*="商品标题组成"]')
      const loading = /加载中/.test(document.body.innerText || '')
      return hasCarousel || (hasTitle && !loading)
    }).catch(() => false)
    if (ok) return true
    await sleep(3000)
  }
  return false
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── CLI ──────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('step1-open-publish.mjs')) {
  const argv = process.argv.slice(2)
  const arg = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 ? String(argv[i + 1] ?? d) : d }
  const shopKey = arg('shop', 'pdd_mms_2b1bca962e5fba5172e3edc19a09e406')

  console.log('打开发布页，shopKey =', shopKey)
  const r = await openPublishPage({ shopKey })

  if (!r.ok) {
    console.log('❌', r.error)
    process.exit(1)
  }
  console.log('✅ 发布页已打开')
  console.log('   URL    :', r.url)
  console.log('   catId  :', r.catId)
  console.log('   goodsId:', r.goodsId)
  console.log('')
  console.log('浏览器保持打开 30 分钟，可直接继续操作')
  await sleep(1800000)
}
