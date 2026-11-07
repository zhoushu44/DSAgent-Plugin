import * as fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const PROFILE = 'C:/Users/Administrator/.dsh/browser-profiles/accounts/pdd_mms_d3a914fe3bef95f065d9cfd33c23994d'
if (!fs.existsSync(`${PROFILE}/DevToolsActivePort`)) { console.log('浏览器已关'); process.exit(0) }
const port = fs.readFileSync(`${PROFILE}/DevToolsActivePort`, 'utf8').split('\n')[0].trim()
const b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null })

const p = await b.newPage()
await p.setViewport({ width: 1600, height: 1000 })
console.log('打开商品列表…')
await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise(r => setTimeout(r, 12000))

const info = await p.evaluate(() => {
  const ids = []
  const rows = []
  for (const tr of document.querySelectorAll('tr')) {
    const m = (tr.innerText || '').match(/(?:商品)?ID\s*[:：]\s*(\d{10,20})/)
    if (m) {
      ids.push(m[1])
      const txt = (tr.innerText || '').replace(/\n/g, ' | ')
      rows.push({ id: m[1], txt: txt.slice(0, 130) })
    }
  }
  return { count: ids.length, rows: rows.slice(0, 6) }
})

console.log(`商品数: ${info.count}`)
console.log('\n=== 最近的商品 ===')
for (const r of info.rows) console.log(`  ${r.txt}`)

// 找刚提交的睡衣（标题含「莫代尔长袖长裤」）
const hit = info.rows.find(r => /莫代尔长袖长裤|睡衣套装/.test(r.txt))
console.log(hit ? `\n✅ 找到新睡衣: ${hit.id}` : '\n（列表前 6 条里没看到，可能在第 2 页）')

await p.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/list_after_p6.png' })
await new Promise(r => setTimeout(r, 20000))
process.exit(0)
