/**
 * 1) dump categoryId 附近的原始 JSON 上下文（看字段名）
 * 2) 查闲鱼类目树，把 50023914 / 201453616 等 ID 映射成中文名
 */
import puppeteer from 'puppeteer-core'
import { findChromePath, profileDir, clearProfileLocks, sleep } from '../lib/browser-login.js'
import { CredentialStore } from '../lib/services/credential-store.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT = 'dev/.ui-shots'
mkdirSync(OUT, { recursive: true })

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().find(a => a.platform === 'xianyu' && a.status === 'valid')
const cookies = acc.cookies || {}
const dir = profileDir('xianyu', acc.shop_key)
clearProfileLocks(dir)

const browser = await puppeteer.launch({
  executablePath: findChromePath(), headless: false, userDataDir: dir,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })
await page.setCookie(...Object.entries(cookies).filter(([, v]) => v).flatMap(([name, value]) => ([
  { name, value: String(value), domain: '.goofish.com', path: '/' },
  { name, value: String(value), domain: '.taobao.com', path: '/' },
])))

// ── 1) dump 上下文 ──
const caps = []
const onResp = async (res) => {
  const u = res.url()
  if (/mtop|api/i.test(u)) {
    try { const t = await res.text(); if (t.length > 500) caps.push({ url: u.slice(0, 180), body: t }) } catch {}
  }
}
page.on('response', onResp)
await page.goto('https://www.goofish.com/item?id=1052961253244', { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(9000)
page.off('response', onResp)

const ctxDump = []
for (const c of caps) {
  for (const m of c.body.matchAll(/.{200}(?:categoryId|channelCatId|category_id).{200}/g)) {
    ctxDump.push(m[0])
  }
}
console.log('===== categoryId 原始上下文 =====')
for (const s of [...new Set(ctxDump)].slice(0, 6)) console.log('...' + s + '...\n')

// 页面 DOM 里找类目文本
const domCat = await page.evaluate(() => {
  const t = (document.body?.innerText || '')
  // 闲鱼详情页通常有「分类」或面包屑
  const lines = t.split('\n').map(x => x.trim()).filter(Boolean)
  const idx = lines.findIndex(x => /分类|类目/.test(x))
  return { around: idx >= 0 ? lines.slice(Math.max(0, idx - 2), idx + 4) : [], head: lines.slice(0, 40) }
})
console.log('===== DOM 类目相关行 =====')
console.log(JSON.stringify(domCat, null, 1))

// ── 2) 尝试类目树接口 ──
const tree = await page.evaluate(async () => {
  const tryUrls = [
    'https://www.goofish.com/api/category/tree',
    'https://www.goofish.com/api/category/list',
    'https://h5api.m.goofish.com/h5/mtop.taobao.idle.category.query/1.0/',
  ]
  const out = []
  for (const u of tryUrls) {
    try { const r = await fetch(u, { credentials: 'include' }); out.push({ u, s: r.status, b: (await r.text()).slice(0, 500) }) }
    catch (e) { out.push({ u, err: String(e).slice(0, 100) }) }
  }
  return out
})
console.log('===== 类目树接口尝试 =====')
console.log(JSON.stringify(tree, null, 1))

// ── 3) 抓发布页的类目接口 ──
const pubCaps = []
const onResp2 = async (res) => {
  const u = res.url()
  if (/categor|prepublish|preget/i.test(u)) {
    try { pubCaps.push({ url: u.slice(0, 200), body: (await res.text()).slice(0, 8000) }) } catch {}
  }
}
page.on('response', onResp2)
await page.goto('https://www.goofish.com/publish', { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(7000)
page.off('response', onResp2)
console.log('===== 发布页类目相关接口 =====')
for (const c of pubCaps) { console.log('URL:', c.url); console.log('BODY:', c.body.slice(0, 1500), '\n') }

writeFileSync(`${OUT}/xianyu-cat-ctx.json`, JSON.stringify({ ctxDump: [...new Set(ctxDump)].slice(0, 10), domCat, tree, pubCaps }, null, 2), 'utf-8')
console.log('已保存')
await browser.close()
