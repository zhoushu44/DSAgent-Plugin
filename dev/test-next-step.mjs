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
await p.goto('https://mms.pinduoduo.com/goods/category', { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise(r => setTimeout(r, 5000))

// 点「下一步，完善商品信息」
const btn = await p.evaluate(() => {
  const b = [...document.querySelectorAll('button, div, span')]
    .find(e => /下一步/.test(e.innerText || ''))
  if (!b) return null
  const r = b.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (b.innerText || '').trim() }
})
console.log('下一步按钮:', JSON.stringify(btn))

if (btn) {
  await p.mouse.click(btn.x, btn.y)
  console.log('已点击，等待 8s…')
  await new Promise(r => setTimeout(r, 8000))
}

const st = await p.evaluate(() => {
  const searchInputs = [...document.querySelectorAll('input')]
    .filter(i => /搜索分类|搜索类目/.test(i.placeholder || ''))
    .map(i => ({ ph: i.placeholder, w: Math.round(i.getBoundingClientRect().width) }))
  return {
    url: location.href,
    searchInputs,
    propBoxes: document.querySelectorAll('[id^="basic.propertys."]').length,
    bodyStart: (document.body.innerText || '').slice(0, 200).replace(/\n+/g, ' | '),
  }
})
console.log(JSON.stringify(st, null, 2))
await p.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/after_next.png' })
console.log('截图: after_next.png')
await new Promise(r => setTimeout(r, 30000))
process.exit(0)
