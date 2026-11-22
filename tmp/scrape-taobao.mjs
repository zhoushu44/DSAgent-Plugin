/**
 * scrape-taobao.mjs — 用浏览器打开淘宝商品页，抓标题/图片/价格/SKU
 * ★ 不关闭浏览器
 */
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
const P = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const { default: puppeteer } = await import(pathToFileURL(P + '/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js').href)
const { CredentialStore } = await import(pathToFileURL(P + '/lib/services/credential-store.js').href)

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = path.join(os.homedir(), '.dsh', 'browser-profiles', 'taobao-scrape')
const sleep = ms => new Promise(r => setTimeout(r, ms))

const URLS = [
  { key: 'tmall_knife', url: 'https://detail.tmall.com/item.htm?id=819241838637', name: '高精度刀柄' },
  { key: 'tb_shirt', url: 'https://e.tb.cn/h.jlFsvkfncX2RV7m?tk=HTdw646k1Gr', name: '蕾丝拼接衬衫' },
  { key: 'tb_orange', url: 'https://e.tb.cn/h.jlFG3W8UfWqhLYJ?tk=Pmv5646kTs6', name: '涌泉蜜桔' },
]

fs.rmSync(BASE, { recursive: true, force: true })
fs.mkdirSync(BASE, { recursive: true })
for (const n of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort']) {
  try { fs.rmSync(path.join(BASE, n), { force: true, recursive: true }) } catch { }
}

const port = await new Promise((res, rej) => {
  const srv = net.createServer()
  srv.on('error', rej)
  srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => res(p)) })
})

const proc = spawn(CHROME, [
  `--user-data-dir=${BASE}`,
  `--remote-debugging-port=${port}`,
  '--remote-debugging-address=127.0.0.1',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-position=100,50',
  '--window-size=1600,950',
  '--disable-blink-features=AutomationControlled',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })
console.log('chrome pid:', proc.pid)

for (let i = 0; i < 200; i++) {
  await sleep(100)
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })
    if (r.ok) break
  } catch { }
}

const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null })
const pages = await browser.pages()
const p = pages[0] || await browser.newPage()

const out = {}

for (const U of URLS) {
  console.log(`\n=== ${U.name} ===`)
  try {
    await p.goto(U.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => console.log('  goto:', e.message.slice(0, 60)))
    await sleep(6000)

    const realUrl = p.url()
    console.log('  实际 URL:', realUrl.slice(0, 110))

    const d = await p.evaluate(() => {
      const t = (s) => String(s || '').replace(/\s+/g, ' ').trim()
      // 标题
      const titleEl = document.querySelector('h1[class*="ItemHeader"], h1[class*="mainTitle"], [class*="Title--title"], h1')
      const title = t(titleEl?.innerText)

      // 图片
      const imgs = []
      for (const img of document.querySelectorAll('img')) {
        const src = img.src || ''
        if (!/alicdn|tbcdn/.test(src)) continue
        const w = img.naturalWidth || img.width
        if (w < 300) continue
        const clean = src.split('_')[0] + (src.includes('.jpg') ? '.jpg' : src.includes('.png') ? '.png' : '')
        if (!imgs.includes(clean)) imgs.push(clean)
      }

      // 价格
      const priceText = t(document.querySelector('[class*="Price--priceText"], [class*="priceText"], .tm-price, .tb-rmb-num')?.innerText)

      // SKU / 规格
      const skuGroups = []
      for (const dl of document.querySelectorAll('[class*="SkuContent"], [class*="skuWrapper"], dl')) {
        const label = t(dl.querySelector('dt, [class*="SkuTitle"], [class*="skuTitle"]')?.innerText)
        const vals = [...dl.querySelectorAll('dd [class*="valueItem"], dd li, [class*="SkuValue"] [class*="item"]')]
          .map(e => t(e.innerText)).filter(Boolean)
        if (label && vals.length) skuGroups.push({ label, values: [...new Set(vals)].slice(0, 20) })
      }

      return {
        title,
        titleLen: title.length,
        imageCount: imgs.length,
        images: imgs.slice(0, 10),
        price: priceText,
        skuGroups,
        bodyHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 150),
      }
    })

    console.log('  标题:', d.title)
    console.log('  图片:', d.imageCount, '张')
    d.images.slice(0, 3).forEach(x => console.log('    ', x.slice(0, 100)))
    console.log('  价格:', d.price)
    console.log('  SKU 组:', JSON.stringify(d.skuGroups))
    if (!d.title) console.log('  页面内容:', d.bodyHead)

    out[U.key] = { name: U.name, url: realUrl, ...d }
  } catch (e) {
    console.log('  ❌', e.message.slice(0, 100))
    out[U.key] = { name: U.name, url: U.url, error: e.message.slice(0, 100) }
  }
}

fs.writeFileSync('tmp/scraped.json', JSON.stringify(out, null, 2), 'utf8')
console.log('\n=== 已写入 tmp/scraped.json ===')
console.log('★ 窗口保留')
setInterval(() => { }, 60000)
