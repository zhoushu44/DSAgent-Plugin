/**
 * 只读探针：goods_list → 发布新商品 后落到的 /goods/category 页面结构
 * 目的：确认类目页选择器（搜索框 placeholder 可能不是「搜索分类」），以及是否有「确认发布该类商品」。
 */
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')
const SHOP_KEY = process.env.PDD_SHOP_KEY || 'pdd_mms_d105b9eff40aa53674b4da4091f76a4a'
const PROFILE = `C:/Users/Administrator/.dsh/browser-profiles/accounts/${SHOP_KEY}`
const sleep = ms => new Promise(r => setTimeout(r, ms))
for (const f of ['SingletonLock','SingletonSocket','SingletonCookie','DevToolsActivePort','lockfile']) { try { fs.unlinkSync(`${PROFILE}/${f}`) } catch {} }
const out = { shopKey: SHOP_KEY, steps: [], pages: [], errors: [] }
let browser
try {
  browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false, userDataDir: PROFILE, defaultViewport: null,
    args: ['--no-sandbox','--disable-blink-features=AutomationControlled','--start-maximized','--window-size=1600,1000'],
    ignoreDefaultArgs: ['--enable-automation'], protocolTimeout: 600000,
  })
  const p = await (await browser.pages())[0] || await browser.newPage()
  await p.setViewport({ width: 1600, height: 1000 })
  await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(4000)
  // dump 「发布新商品」候选
  out.publishBtns = await p.evaluate(() => {
    const norm = t => (t || '').replace(/\s+/g, ' ').trim()
    return [...document.querySelectorAll('button,a,div,span')].filter(e => norm(e.innerText) === '发布新商品' || /发布新商品/.test(norm(e.innerText)) && norm(e.innerText).length < 20)
      .map(e => { const r = e.getBoundingClientRect(); return { tag: e.tagName, text: norm(e.innerText).slice(0,30), cls: (e.className||'').slice(0,60), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), href: e.getAttribute('href') || '' } })
      .slice(0, 10)
  })
  const pt = await p.evaluate(() => {
    const NAV = 'nav, aside, [class*="sidenav"], [class*="sideNav"], [class*="menu"]'
    const els = [...document.querySelectorAll('button, a, div, span')].filter(el => (el.innerText || '').trim() === '发布新商品' && !el.closest(NAV))
    const el = els.find(e => e.tagName === 'BUTTON') || els[els.length - 1]
    if (!el) return null
    const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }
  })
  if (pt) { await p.mouse.click(pt.x, pt.y) }
  await sleep(6000)

  const pages = await browser.pages()
  out.pages = pages.map(x => x.url())
  let cp = pages.find(x => /goods\/(category|goods_add)/.test(String(x.url() || ''))) || p
  await cp.bringToFront().catch(() => {})

  out.catPage = await cp.evaluate(() => {
    const norm = t => (t || '').replace(/\s+/g, ' ').trim()
    const inputs = [...document.querySelectorAll('input')].map(i => { const r = i.getBoundingClientRect(); return { ph: i.placeholder || '(无)', w: Math.round(r.width), h: Math.round(r.height), cls: (i.className||'').slice(0,50), visible: r.width>15&&r.height>8 } }).filter(x => x.visible)
    const btns = [...document.querySelectorAll('button')].map(b => norm(b.innerText)).filter(Boolean).slice(0, 25)
    return {
      url: location.href,
      bodyText: norm(document.body.innerText).slice(0, 1500),
      inputs,
      buttons: btns,
      hasConfirm: /确认发布该类商品/.test(document.body.innerText),
      hasSearchBox: !!document.querySelector('input[placeholder*="搜索"]'),
      liCount: document.querySelectorAll('li').length,
      title: document.title,
    }
  })
  await cp.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/artifacts/preset-dim-category-page.png' }).catch(() => {})
} catch (e) { out.errors.push(String(e?.stack || e)) }
finally {
  try { if (browser) await browser.close() } catch {}
  fs.writeFileSync('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/artifacts/preset-dim-category-probe.json', JSON.stringify(out, null, 2), 'utf8')
  console.log(JSON.stringify(out, null, 2).slice(0, 6000))
}
