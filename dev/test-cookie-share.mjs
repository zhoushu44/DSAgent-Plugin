#!/usr/bin/env node
/**
 * 测试 Cookie 共享方案
 * ① 从原 Profile 导出 Cookie（明文 JSON）
 * ② 用全新 Profile 启动
 * ③ 注入 Cookie
 * ④ 验证登录态
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const SHOP = 'pdd_mms_2384db98bbcb596936cded12513defe7'
const BASE = 'C:/Users/Administrator/.dsh/browser-profiles/accounts'
const SRC = path.join(BASE, SHOP)
const FRESH = path.join(BASE, `${SHOP}--fresh-${Date.now()}`)
const COOKIE_FILE = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/pdd_cookies.json'

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

// ═══ ① 从原 Profile 导出 Cookie ═══
console.log('=== ① 从原 Profile 导出 Cookie ===')
let cookies = []
{
  const b = await launch(SRC)
  const p = await b.newPage()
  await p.goto('https://mms.pinduoduo.com/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise(r => setTimeout(r, 6000))
  cookies = await p.cookies()
  await b.close()
}

// 过滤：只留拼多多相关的
const pdd = cookies.filter(c => /pinduoduo|yangkeduo|pdd/.test(c.domain))
console.log(`总 Cookie: ${cookies.length}`)
console.log(`拼多多相关: ${pdd.length}`)
const names = [...new Set(pdd.map(c => c.name))].slice(0, 20)
console.log(`关键 Cookie: ${names.join(', ')}`)

if (!pdd.length) {
  console.log('\n❌ 没导出到 Cookie，方案不可行')
  process.exit(1)
}

fs.writeFileSync(COOKIE_FILE, JSON.stringify(pdd, null, 2), 'utf8')
console.log(`✅ 已存 ${COOKIE_FILE} (${(fs.statSync(COOKIE_FILE).size / 1024).toFixed(1)} KB)`)

// ═══ ② 全新 Profile 启动 ═══
console.log('\n=== ② 全新 Profile 启动 ===')
fs.mkdirSync(FRESH, { recursive: true })
const b2 = await launch(FRESH)
console.log('✅ 全新 Profile 启动成功')
const p2 = await b2.newPage()

// ═══ ③ 注入 Cookie ═══
console.log('\n=== ③ 注入 Cookie ===')
await p2.goto('https://mms.pinduoduo.com/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise(r => setTimeout(r, 3000))
try {
  await p2.setCookie(...pdd)
  console.log(`✅ 注入 ${pdd.length} 个 Cookie`)
} catch (e) {
  console.log(`❌ 注入失败: ${String(e.message).slice(0, 120)}`)
  await b2.close()
  process.exit(1)
}

// ═══ ④ 验证登录态 ═══
console.log('\n=== ④ 验证登录态 ===')
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

await p2.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/cookie_share_test.png' })
await new Promise(r => setTimeout(r, 20000))
await b2.close()

console.log('\n=== 结论 ===')
console.log(st.isLogin
  ? '❌ Cookie 注入后仍未登录'
  : '✅ Cookie 共享可行 —— 两个对话可各用各的 Profile')

console.log(`\nCookie 文件: ${COOKIE_FILE}`)
console.log(`全新 Profile 保留在: ${FRESH}`)
