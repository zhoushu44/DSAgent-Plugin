/** check_goods_status.mjs — 逐个 tab 精确统计 total，并搜查目标 goodsId */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PLUGIN = 'e:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const SHOP = process.argv[2]
const IDS = process.argv.slice(3)

const { createSession } = await import(pathToFileURL(path.join(PLUGIN, 'skills/_shared/pdd-client.mjs')).href)
const s = await createSession(SHOP, {})
const p = s.page
await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise(r => setTimeout(r, 8000))

// 抓页面真实请求的 headers + 各 tab 的 body
const calls = []
p.on('request', (req) => {
  const u = req.url()
  if (/display\/mall\/goodsList/.test(u) && req.method() === 'POST') {
    try { calls.push({ url: u, headers: req.headers(), body: JSON.parse(req.postData() || '{}') }) } catch { }
  }
})
await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(e => (e.innerText || '').trim() === '查询'); if (b) b.click() })
await new Promise(r => setTimeout(r, 4000))
if (!calls.length) { console.log('NO CALL'); process.exit(1) }

const cap = calls[0]
console.log('基线 body:', JSON.stringify(cap.body))

const TABS = [
  { name: '在售中', patch: { is_onsale: 1, sold_out: 0 } },
  { name: '已下架', patch: { is_onsale: 0 } },
  { name: '已售罄', patch: { is_onsale: 1, sold_out: 1 } },
  { name: '全部', patch: {} },
]

for (const t of TABS) {
  const all = []
  let total = 0
  for (let pg = 1; pg <= 6; pg++) {
    const res = await p.evaluate(async (args) => {
      const h = Object.assign({}, args.headers); delete h['content-length']
      const body = Object.assign({}, args.body, args.patch, { page: args.pg, size: 100 })
      const r = await fetch(args.url, { method: 'POST', credentials: 'include', headers: h, body: JSON.stringify(body) })
      return await r.json()
    }, { url: cap.url, headers: cap.headers, body: cap.body, patch: t.patch, pg })
    const list = res?.result?.goods_list || []
    total = res?.result?.total ?? total
    if (!list.length) break
    all.push(...list)
    if (all.length >= total) break
    await new Promise(x => setTimeout(x, 900))
  }
  const hits = all.filter(g => IDS.includes(String(g.id)))
  console.log(`[${t.name}] total=${total} scanned=${all.length} hits=${hits.length}`)
  hits.forEach(h => console.log('   ✔', String(h.id), (h.goods_name || '').slice(0, 32), '| onSale=', h.is_on_sale))
  if (t.name === '全部') {
    fs.writeFileSync('E:/360MoveData/Users/Administrator/Desktop/童装/睡衣20款/status_scan.json',
      JSON.stringify({ total, scanned: all.length, hits, sample: all.slice(0, 3) }, null, 2), 'utf8')
  }
}
await s.browser.close().catch(() => { })
process.exit(0)
