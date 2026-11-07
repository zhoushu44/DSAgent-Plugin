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
await p.setViewport({ width: 1600, height: 1000 })

// 直接用搜索：搜标题关键词
console.log('搜索「莫代尔长袖长裤」…')
await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise(r => setTimeout(r, 10000))

// 找商品名称搜索框
const box = await p.evaluate(() => {
  const inp = [...document.querySelectorAll('input')].find(i => /请输入商品名称/.test(i.placeholder || ''))
  if (!inp) return null
  inp.scrollIntoView({ block: 'center' })
  const r = inp.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), ph: inp.placeholder }
})
console.log('搜索框:', JSON.stringify(box))

if (box) {
  await p.mouse.click(box.x, box.y)
  await new Promise(r => setTimeout(r, 400))
  await p.keyboard.type('莫代尔长袖长裤', { delay: 60 })
  await new Promise(r => setTimeout(r, 600))
  // 点查询
  const q = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button, span, div')].find(e => /^查询$/.test((e.innerText || '').trim()))
    if (!btn) return null
    const r = btn.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  if (q) { await p.mouse.click(q.x, q.y); console.log('已点查询') }
  await new Promise(r => setTimeout(r, 8000))
}

const res = await p.evaluate(() => {
  const rows = []
  for (const tr of document.querySelectorAll('tr')) {
    const t = tr.innerText || ''
    const m = t.match(/(?:商品)?ID\s*[:：]\s*(\d{10,20})/)
    if (m) rows.push(t.replace(/\n/g, ' | ').slice(0, 150))
  }
  return rows.slice(0, 6)
})
console.log(`\n搜索结果 ${res.length} 条:`)
for (const r of res) console.log('  ' + r)
await p.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/search_pajama.png' })
await new Promise(r => setTimeout(r, 20000))
process.exit(0)
