/**
 * promo-hybrid.mjs - 推广域混合模式
 *
 * 问题：推广域纯 Node 签名在 jsdom 里不稳定（用户信息类接口被拒）
 * 方案：浏览器只负责签名，请求仍走 Node
 *
 * 优点：
 *   - 签名质量 = 真实浏览器级别
 *   - 请求走 Node（可并发、可拦截、可复用 cookie）
 *   - 比全浏览器快（不用每次跳页面）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const SHOP = 'pdd_mms_2b1bca962e5fba5172e3edc19a09e406'
const PROFILE = path.join(os.homedir(), '.dsh', 'browser-profiles', 'accounts', SHOP)
const ORIGIN = 'https://yingxiao.pinduoduo.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36'

let _browser = null
let _page = null
let _SDK = null

/** 启动浏览器（只用来签名，headless） */
export async function initPromoBrowser() {
  if (_page) return _page
  const puppeteer = (await import(pathToFileURL(path.join(ROOT, 'node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js')).href)).default
  const { clearProfileLocks } = await import(pathToFileURL(path.join(ROOT, 'skills/_shared/pdd-launch.mjs')).href)
  clearProfileLocks(PROFILE)

  _browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    userDataDir: PROFILE,
    headless: true,                       // 无头，不占屏幕
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--no-first-run', '--no-default-browser-check'],
  })
  _page = (await _browser.pages())[0] || await _browser.newPage()
  await _page.goto(ORIGIN + '/mains/promotionOverview', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await new Promise(s => setTimeout(s, 12000))

  // 取模块 22768
  _SDK = await _page.evaluate(() => {
    const chunks = window.rspackChunk_N_E
    const mods = {}
    for (const c of chunks) { if (c && c[1]) Object.assign(mods, c[1]) }
    const key = mods['22768'] ? '22768' : 22768
    const m = { exports: {} }
    mods[key].call(m.exports, m, m.exports, (id) => mods[id])
    // 只保留构造函数，序列化不了函数 → 标记已就绪
    return { ready: typeof (m.exports.default || m.exports) === 'function' }
  })
  if (!_SDK?.ready) throw new Error('推广域 SDK 未就绪')
  return _page
}

/** 用浏览器生成签名 */
export async function signPromoInBrowser() {
  const page = await initPromoBrowser()
  return await page.evaluate(async () => {
    const chunks = window.rspackChunk_N_E
    const mods = {}
    for (const c of chunks) { if (c && c[1]) Object.assign(mods, c[1]) }
    const key = mods['22768'] ? '22768' : 22768
    const m = { exports: {} }
    mods[key].call(m.exports, m, m.exports, (id) => mods[id])
    const D = m.exports.default || m.exports
    const inst = new D({ serverTime: Date.now() })
    return String(await inst.messagePack())
  })
}

/**
 * 调用推广域接口（浏览器签名 + Node 请求）
 */
export async function callPromoHybrid(pathname, body = {}, opts = {}) {
  const sig = await signPromoInBrowser()
  const cookie = opts.cookie || await cookieString()
  const url = pathname.startsWith('http') ? pathname : ORIGIN + pathname

  const r = await fetch(url, {
    method: opts.method || 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      referer: opts.referer || ORIGIN + '/mains/promotionOverview',
      'user-agent': UA,
      cookie,
      accept: 'application/json, text/plain, */*',
    },
    ...(opts.method === 'GET' ? {} : { body: JSON.stringify({ ...body, crawlerInfo: sig }) }),
  })
  const t = await r.text()
  let j = null
  try { j = JSON.parse(t) } catch { /* 非 JSON */ }
  const ec = j?.errorCode ?? j?.error_code
  const ok = j?.success === true || ec === 1000 || ec === 1000000
  return { ok, ec, result: j?.result, raw: j, sigLen: sig.length, text: ok ? '' : t.slice(0, 200) }
}

/** 从浏览器拿 Cookie 串 */
async function cookieString() {
  const page = await initPromoBrowser()
  const cookies = await page.cookies()
  return cookies.map(c => `${c.name}=${c.value}`).join('; ')
}

export async function closePromoBrowser() {
  try { await _browser?.close() } catch { }
  _browser = null; _page = null; _SDK = null
}

export const PROMO_HYBRID_INFO = {
  mode: 'browser-sign + node-request',
  browser: 'headless',
  initMs: '~15000 (一次性)',
  signMs: '~10 (每次)',
  benefit: '签名质量 = 真实浏览器，请求走 Node',
}
