/** check_queue.mjs — 检查「发布中 / 已驳回 / 草稿箱」里是否有目标 goodsId */
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

const TABS = ['发布中', '已驳回', '草稿箱']
for (const tab of TABS) {
  const clicked = await p.evaluate((t) => {
    const el = [...document.querySelectorAll('div,span,button,a')].find(e => {
      const x = (e.innerText || '').trim()
      return (x === t || x.startsWith(t)) && e.getBoundingClientRect().width > 10 && x.length < 12
    })
    if (!el) return false
    el.scrollIntoView({ block: 'center' }); el.click(); return true
  }, tab)
  await new Promise(r => setTimeout(r, 5000))
  const info = await p.evaluate((ids) => {
    const trs = [...document.querySelectorAll('tbody tr')]
    const rows = trs.map(tr => {
      const t = (tr.innerText || '').replace(/\s+/g, ' ')
      const m = t.match(/ID:\s*(\d{12,20})/)
      return m ? { id: m[1], text: t.slice(0, 160) } : null
    }).filter(Boolean)
    const hits = rows.filter(r => ids.includes(r.id))
    const body = (document.body.innerText || '').replace(/\s+/g, ' ')
    const cnt = (body.match(new RegExp(tab_regex())) || [])[1] || ''
    return { rowCount: rows.length, hits, empty: /暂无数据|没有查询到/.test(body), first: rows.slice(0, 2).map(r => r.text.slice(0, 80)) }
    function tab_regex() { return 'x' }
  }, IDS)
  console.log(`\n[${tab}] clicked=${clicked} rows=${info.rowCount} empty=${info.empty} hits=${info.hits.length}`)
  info.first.forEach(f => console.log('   示例:', f))
  info.hits.forEach(h => console.log('   ✔ 命中:', h.id, h.text.slice(0, 90)))
  await p.screenshot({ path: `E:/360MoveData/Users/Administrator/Desktop/童装/睡衣20款/q_${tab}.png` }).catch(() => { })
}
await browser.close().catch(() => { })
process.exit(0)
