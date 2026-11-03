#!/usr/bin/env node
/**
 * 测试 Cookie 共享（用新登录的账号）
 * ① 从原 Profile 导出 Cookie
 * ② 全新 Profile 注入
 * ③ 验证登录态
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const SHOP = process.argv[2] || 'pdd_mms_d3a914fe3bef95f065d9cfd33c23994d'
const BASE = 'C:/Users/Administrator/.dsh/browser-profiles/accounts'
const SRC = path.join(BASE, SHOP)
const FRESH = path.join(BASE, `${SHOP}--fresh-${Date.now()}`)
const COOKIE_FILE = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/pdd_cookies_share.json'

console.log(`源 Profile: ${SRC}`)
console.log(`存在: ${fs.existsSync(SRC)}`)

async function launch(dir) {
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort', 'lockfile']) {
    try { fs.unlinkSync(path.join(dir, f)) } catch {}
  }
  return puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false, userDataDir: dir, defaultViewport: null,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
    ignoreDefaultArgs: ['--enable-automation'], protocolTimeout: 600000,
  })
}

// ═══ ① 导出 Cookie ═══
console.log('\n=== ① 从原 Profile 导出 Cookie ===')
let cookies = []
let srcOk = false
{
  const b = await launch(SRC)
  const p = await b.newPage()
  // 先开首页建立域，再开商品列表（登录后才会有 mms 域的 Cookie）
  await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise(r => setTimeout(r, 10000))
  const isLogin = await p.evaluate(() => /\/login\//.test(location.href))
  console.log(`原 Profile 登录态: ${isLogin ? '❌ 已失效' : '✅ 有效'}`)
  srcOk = !isLogin
  if (srcOk) {
    cookies = await p.cookies()
    const names = [...new Set(cookies.map(c => c.name))]
    console.log(`导出 ${cookies.length} 个 Cookie`)
    console.log(`关键: ${names.filter(n => /PASS_ID|PDD|USER|TOKEN|SESSION/i.test(n)).join(', ') || '(无明显登录 Cookie)'}`)
    console.log(`全部: ${names.join(', ')}`)
  }
  await b.close()
}

if (!srcOk) {
  console.log('\n❌ 原 Profile 未登录，无法导出有效 Cookie')
  process.exit(1)
}

fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2), 'utf8')
console.log(`✅ 已存 Cookie 文件 (${(fs.statSync(COOKIE_FILE).size / 1024).toFixed(1)} KB)`)

// ═══ ② 全新 Profile + 注入 ═══
console.log('\n=== ② 全新 Profile 注入 Cookie ===')
fs.mkdirSync(FRESH, { recursive: true })
const b2 = await launch(FRESH)
const p2 = await b2.newPage()
await p2.goto('https://mms.pinduoduo.com/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise(r => setTimeout(r, 3000))
await p2.setCookie(...cookies)
console.log(`✅ 注入 ${cookies.length} 个 Cookie 到全新 Profile`)

// ═══ ③ 验证 ═══
console.log('\n=== ③ 验证登录态 ===')
await p2.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise(r => setTimeout(r, 10000))

const st = await p2.evaluate(() => {
  const txt = document.body.innerText || ''
  const NAV = 'nav, aside, [class*="sidenav"], [class*="sideNav"], [class*="menu"]'
  const btns = [...document.querySelectorAll('button, a, div, span')]
    .filter(el => (el.innerText || '').trim() === '发布新商品' && !el.closest(NAV))
  return {
    url: location.href,
    isLogin: /\/login\//.test(location.href),
    shop: (txt.match(/空空商行|旗舰店/) || [])[0] || '',
    hasBtn: btns.length > 0,
  }
})

console.log(`URL: ${st.url.slice(0, 75)}`)
console.log(`登录: ${st.isLogin ? '❌ 失效' : '✅ 有效'}`)
console.log(`店铺: ${st.shop || '(未识别)'}`)
console.log(`发布按钮: ${st.hasBtn ? '✅ 可见' : '❌ 未找到'}`)

await p2.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/cookie_share2.png' })
await new Promise(r => setTimeout(r, 20000))
await b2.close()

console.log('\n=== 结论 ===')
console.log(st.isLogin ? '❌ Cookie 共享不可行' : '✅ Cookie 共享可行 —— 可并行操作')
console.log(`Cookie 文件: ${COOKIE_FILE}`)
