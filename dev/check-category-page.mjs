import * as fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const PROFILE = 'C:/Users/Administrator/.dsh/browser-profiles/accounts/pdd_mms_d3a914fe3bef95f065d9cfd33c23994d'
for (const f of ['SingletonLock','SingletonSocket','SingletonCookie','DevToolsActivePort','lockfile']) {
  try { fs.unlinkSync(`${PROFILE}/${f}`) } catch {}
}

const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false, userDataDir: PROFILE, defaultViewport: null,
  args: ['--no-sandbox','--disable-blink-features=AutomationControlled','--start-maximized'],
  ignoreDefaultArgs: ['--enable-automation'], protocolTimeout: 600000,
})

const p = await b.newPage()
console.log('打开商品列表…')
await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise(r => setTimeout(r, 6000))

// 点发布新商品
const clicked = await p.evaluate(() => {
  const NAV = 'nav, aside, [class*="sidenav"], [class*="menu"]'
  const btn = [...document.querySelectorAll('button, a, div, span')]
    .filter(el => (el.innerText || '').trim() === '发布新商品' && !el.closest(NAV))
    .find(el => { const r = el.getBoundingClientRect(); return r.width >= 20 && r.y >= 0 })
  if (!btn) return false
  btn.click()
  return true
})
console.log('点发布新商品:', clicked)
await new Promise(r => setTimeout(r, 8000))

// 检查页面
const st = await p.evaluate(() => {
  const txt = document.body.innerText || ''
  const searchInputs = [...document.querySelectorAll('input')]
    .filter(i => /搜索分类|搜索类目|请输入类目/.test(i.placeholder || ''))
    .map(i => ({ ph: i.placeholder, w: Math.round(i.getBoundingClientRect().width) }))
  return {
    url: location.href,
    isLogin: /\/login\//.test(location.href),
    searchInputs,
    allPlaceholders: [...new Set([...document.querySelectorAll('input')].map(i => i.placeholder).filter(Boolean))].slice(0, 12),
    bodyStart: txt.slice(0, 250).replace(/\n+/g, ' | '),
  }
})
console.log(JSON.stringify(st, null, 2))
await p.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/category_page.png' })
console.log('截图: category_page.png')
await new Promise(r => setTimeout(r, 90000))
