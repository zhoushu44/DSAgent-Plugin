/** find_goods.mjs — 全站搜索 goodsId：草稿箱+已驳回+已下架+在售，用页面请求翻页 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PLUGIN = 'e:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const SHOP = process.argv[2]
const IDS = process.argv.slice(3)

const { default: puppeteer } = await import(pathToFileURL(path.join(PLUGIN, 'node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js')).href)
const { launchStealth } = await import(pathToFileURL(path.join(PLUGIN, 'skills/_shared/pdd-launch.mjs')).href)

const { browser, page: p } = await launchStealth(SHOP, puppeteer)
await p.setViewport({ width: 1680, height: 1200 })
await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise(r => setTimeout(r, 8000))
await p.evaluate(() => { document.querySelectorAll('[class*="close"],[class*="Close"]').forEach(e => { const r = e.getBoundingClientRect(); if (r.width > 5 && r.width < 40) e.click() }) })

// 拦所有 goodsList 类请求（含不同 tab）
const caps = []
p.on('request', (req) => {
  const u = req.url()
  if (/goodsList|goods_list|draft|reject/i.test(u) && req.method() === 'POST') {
    try { caps.push({ url: u, headers: req.headers(), body: JSON.parse(req.postData() || '{}') }) } catch { }
  }
})

// 依次点各 tab，采集各自的请求模板
const TABS = ['草稿箱', '已驳回', '发布中', '在售中']
const found = []
for (const tab of TABS) {
  await p.evaluate((t) => {
    const el = [...document.querySelectorAll('div,span,button,a')].find(e => {
      const x = (e.innerText || '').trim()
      return (x === t || x.startsWith(t)) && e.getBoundingClientRect().width > 10 && x.length < 12
    })
    if (el) { el.scrollIntoView({ block: 'center' }); el.click() }
  }, tab)
  await new Promise(r => setTimeout(r, 5000))
  const rows = await p.evaluate(() => [...document.querySelectorAll('tbody tr')].map(tr => {
    const t = (tr.innerText || '').replace(/\s+/g, ' ')
    const m = t.match(/ID:\s*(\d{12,20})/)
    return m ? { id: m[1], text: t.slice(0, 140) } : null
  }).filter(Boolean))
  const hits = rows.filter(r => IDS.includes(r.id))
  console.log(`[${tab}] 本页 ${rows.length} 条 | 命中 ${hits.length}`)
  hits.forEach(h => { console.log('   ✔', h.id, h.text.slice(0, 100)); found.push({ tab, ...h }) })
}
console.log('\n抓到的列表请求数:', caps.length)
caps.slice(0, 5).forEach(c => console.log('  ', c.url.replace('https://mms.pinduoduo.com', ''), '=', JSON.stringify(c.body).slice(0, 150)))
fs.writeFileSync('E:/360MoveData/Users/Administrator/Desktop/童装/睡衣20款/find_goods.json',
  JSON.stringify({ found, caps: caps.slice(0, 8) }, null, 2), 'utf8')
await browser.close().catch(() => { })
process.exit(0)
