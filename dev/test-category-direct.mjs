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

console.log('直接 goto https://mms.pinduoduo.com/goods/category')
await p.goto('https://mms.pinduoduo.com/goods/category', { waitUntil: 'domcontentloaded', timeout: 60000 })

let ok = false
for (let w = 0; w < 30; w++) {
  await new Promise(r => setTimeout(r, 300))
  ok = await p.evaluate(() => !!document.querySelector('input[placeholder*="搜索分类"]')).catch(() => false)
  if (ok) break
}

const st = await p.evaluate(() => {
  const inp = document.querySelector('input[placeholder*="搜索分类"]')
  const r = inp?.getBoundingClientRect()
  return {
    url: location.href,
    isLogin: /\/login\//.test(location.href),
    hasSearch: !!inp,
    searchRect: r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) } : null,
    bodyStart: (document.body.innerText || '').slice(0, 150).replace(/\n+/g, ' | '),
  }
})
console.log(JSON.stringify(st, null, 2))
await p.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/category_direct.png' })
console.log('截图: category_direct.png')
await new Promise(r => setTimeout(r, 30000))
process.exit(0)
