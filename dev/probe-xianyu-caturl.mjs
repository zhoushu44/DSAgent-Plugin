/**
 * 1) 完整保存竞品详情响应，取出「其他服务」类目证据
 * 2) 测试发布页能否用 URL 参数（channelCatId 等）指定类目
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

// ── 1) 完整详情响应 ──
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })
await page.setCookie(...Object.entries(cookies).filter(([, v]) => v).flatMap(([name, value]) => ([
  { name, value: String(value), domain: '.goofish.com', path: '/' },
  { name, value: String(value), domain: '.taobao.com', path: '/' },
])))

let full = ''
page.on('response', async (res) => {
  if (/detail/i.test(res.url()) && /mtop/i.test(res.url())) {
    try { const t = await res.text(); if (t.length > full.length) full = t } catch {}
  }
})
await page.goto('https://www.goofish.com/item?id=1052961253244', { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(9000)
writeFileSync(`${OUT}/xianyu-detail-full.json`, full, 'utf-8')
console.log('完整详情响应长度:', full.length)

// 提取 properties 片段（不截断）
const props = [...full.matchAll(/properties=([^"\\\s]+)/g)].map(m => m[1])
console.log('properties 片段数:', props.length)
const uniq = [...new Set(props)]
writeFileSync(`${OUT}/xianyu-props-raw.json`, JSON.stringify(uniq, null, 2), 'utf-8')
for (const p of uniq.slice(0, 5)) {
  console.log('---')
  console.log('raw:', p.slice(0, 200))
  let s = p
  for (let i = 0; i < 5; i++) { const n = decodeURIComponent(s); if (n === s) break; s = n }
  console.log('dec:', s.slice(0, 400))
}
await page.close()

// ── 2) 测试发布页 URL 参数 ──
const CANDIDATES = [
  { name: '无参数(基线)', url: 'https://www.goofish.com/publish' },
  { name: 'channelCatId=201461105', url: 'https://www.goofish.com/publish?channelCatId=201461105' },
  { name: 'channelCatId+properties', url: 'https://www.goofish.com/publish?channelCatId=201461105&properties=%5B%7B%22valueId%22%3A%22201461105%22%2C%22channelCateId%22%3A%22201461105%22%2C%22propertyName%22%3A%22%E5%88%86%E7%B1%BB%22%2C%22valueName%22%3A%22%E5%85%B6%E4%BB%96%E6%9C%8D%E5%8A%A1%22%7D%5D' },
  { name: 'bizFrom=skill', url: 'https://www.goofish.com/publish?bizFrom=skill&channelCatId=201461105' },
]

const IMG = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/xianyu/img/deepseek-api/01-钩子-官方2折.jpg'
const DESC = '【官方2折】AI大模型API中转 Key 独享 DeepSeek/Claude/GPT/GLM/Kimi 通用\n\n官方2折，1元起测，按量计费不用不扣。'

const out2 = []
for (const c of CANDIDATES) {
  const p = await browser.newPage()
  await p.setViewport({ width: 1440, height: 900 })
  await p.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })
  await p.setCookie(...Object.entries(cookies).filter(([, v]) => v).flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.goofish.com', path: '/' },
    { name, value: String(value), domain: '.taobao.com', path: '/' },
  ])))
  try {
    await p.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await sleep(5000)
    const fi = await p.$('input[type=file]')
    if (fi) await fi.uploadFile(IMG)
    await sleep(11000)
    const SEL = 'div[contenteditable="true"]'
    if (await p.$(SEL)) {
      await p.click(SEL)
      await p.keyboard.down('Control'); await p.keyboard.press('KeyA'); await p.keyboard.up('Control')
      await p.keyboard.press('Backspace')
      await p.keyboard.type(DESC, { delay: 8 })
    }
    await sleep(9000)
    await p.evaluate(() => {
      const i = Array.from(document.querySelectorAll('input[placeholder="0.00"]')).filter(e => e.offsetParent !== null)
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      if (s && i[0]) s.call(i[0], '1')
      if (i[0]) i[0].dispatchEvent(new Event('input', { bubbles: true }))
    })
    await sleep(10000)
    const r = await p.evaluate(() => {
      const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
      const m = t.match(/分类 \* ([^\s]+)/)
      const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === '发布')
      return {
        category: m ? m[1] : null,
        blocked: /网页版暂不支持发布此分类|扫码去APP发布|请使用闲鱼APP扫码/.test(t),
        publishDisabled: btn ? btn.disabled : null,
      }
    })
    r.name = c.name
    r.url = c.url.slice(0, 120)
    console.log(`[${c.name}] 类目=${r.category} 被拦=${r.blocked} 发布键禁用=${r.publishDisabled}`)
    out2.push(r)
  } catch (e) {
    out2.push({ name: c.name, error: String(e).slice(0, 150) })
    console.log(`[${c.name}] 出错:`, String(e).slice(0, 120))
  }
  await p.close()
}

writeFileSync(`${OUT}/xianyu-caturl-test.json`, JSON.stringify(out2, null, 2), 'utf-8')
console.log('\n===== URL 参数测试汇总 =====')
console.log(JSON.stringify(out2, null, 1))
await browser.close()
