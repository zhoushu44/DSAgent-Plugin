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
console.log('打开商品列表…')
await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise(r => setTimeout(r, 12000))

const info = await p.evaluate(() => {
  const rows = []
  for (const tr of document.querySelectorAll('tr')) {
    const t = tr.innerText || ''
    const m = t.match(/(?:商品)?ID\s*[:：]\s*(\d{10,20})/)
    if (m) rows.push({ id: m[1], txt: t.replace(/\n/g, ' | ').slice(0, 120) })
  }
  return { count: rows.length, rows: rows.slice(0, 8) }
})

console.log(`商品数: ${info.count}`)
console.log('\n=== 列表前 8 条 ===')
for (const r of info.rows) console.log(`  ${r.txt}`)

const hit = info.rows.find(r => /莫代尔长袖长裤|睡衣/.test(r.txt))
console.log(hit ? `\n✅ 找到睡衣: ${hit.id}` : '\n⚠ 前 8 条没看到（可能在后面）')

await p.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/list_p6.png' })
await new Promise(r => setTimeout(r, 20000))
process.exit(0)
