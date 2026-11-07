#!/usr/bin/env node
/**
 * 从 1688 详情页 DOM 抓「商品参数」表格
 * scrape_offer.mjs 只抓了接口，属性接口报错了，改从页面 DOM 拿
 *
 * 用法：node dev/scrape-attrs.mjs <offerId> <outDir>
 */
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const [offerId, outDir] = process.argv.slice(2)
if (!offerId || !outDir) { console.error('usage: scrape-attrs.mjs <offerId> <outDir>'); process.exit(1) }

// 复用 alibaba profile
const PROFILES = fs.readdirSync('C:/Users/Administrator/.dsh/browser-profiles/accounts')
  .filter(d => d.startsWith('alibaba_'))
const profile = process.argv[4] || PROFILES[0]
if (!profile) { console.error('没找到 alibaba profile'); process.exit(1) }

const PROFILE_DIR = `C:/Users/Administrator/.dsh/browser-profiles/accounts/${profile}`
for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort', 'lockfile']) {
  try { fs.unlinkSync(`${PROFILE_DIR}/${f}`) } catch {}
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  userDataDir: PROFILE_DIR,
  defaultViewport: null,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
  ignoreDefaultArgs: ['--enable-automation'],
  protocolTimeout: 300000,
})

const page = await browser.newPage()
console.log(`打开详情页 ${offerId}...`)
await page.goto(`https://detail.1688.com/offer/${offerId}.html`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise(r => setTimeout(r, 6000))

// 抓「商品参数」表格
const attrs = await page.evaluate(() => {
  const out = []
  // 常见容器：.obj-content / .offer-attr / table / dl
  const sels = [
    '.obj-content tr', '.offer-attr tr', '.attributes tr',
    '[class*="attribute"] tr', '[class*="param"] tr',
    '.offer-attr-list li', '.obj-attrs li',
  ]
  for (const sel of sels) {
    for (const tr of document.querySelectorAll(sel)) {
      const cells = [...tr.querySelectorAll('td, th')].map(c => (c.innerText || '').trim())
      if (cells.length >= 2 && cells[0] && cells[1]) {
        out.push({ name: cells[0], value: cells[1] })
      } else if (cells.length === 1 && cells[0].includes('：')) {
        const [k, ...v] = cells[0].split('：')
        if (k && v.length) out.push({ name: k.trim(), value: v.join('：').trim() })
      }
    }
    if (out.length) break
  }
  // 兜底：dl/dt/dd 结构
  if (!out.length) {
    const dts = [...document.querySelectorAll('dt')]
    for (const dt of dts) {
      const dd = dt.nextElementSibling
      if (dd && dd.tagName === 'DD') {
        out.push({ name: (dt.innerText || '').trim(), value: (dd.innerText || '').trim() })
      }
    }
  }
  return out
})

console.log(`抓到 ${attrs.length} 个属性`)
fs.writeFileSync(`${outDir}/attrs.json`, JSON.stringify(attrs, null, 2), 'utf8')
for (const a of attrs.slice(0, 8)) console.log(`  ${a.name} = ${a.value}`)

await page.close()
await browser.close()
