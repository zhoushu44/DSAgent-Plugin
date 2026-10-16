/**
 * 1) 抓发布页 JS bundle，grep 类目名（其他服务 / DeepSeek服务 / 网页版暂不支持 等）
 *    → 判断网页版是否内置类目选择器，以及哪些类目被标记为「网页不可发」
 * 2) 检查类目 DOM 是否可点出选择器
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
  executablePath: findChromePath(), headless: false, userDataDir: dir, protocolTimeout: 300000,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })
await page.setCookie(...Object.entries(cookies).filter(([, v]) => v).flatMap(([name, value]) => ([
  { name, value: String(value), domain: '.goofish.com', path: '/' },
  { name, value: String(value), domain: '.taobao.com', path: '/' },
])))

const IMG = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/xianyu/img/deepseek-api/01-钩子-官方2折.jpg'
const DESC = '【官方2折】AI大模型API中转 Key 独享 DeepSeek/Claude/GPT/GLM/Kimi 通用\n\n官方2折，1元起测，按量计费不用不扣。'

// 收集所有 JS 资源
const jsUrls = new Set()
page.on('response', (res) => {
  const u = res.url()
  if (/\.js(\?|$)/.test(u)) jsUrls.add(u)
})

await page.goto('https://www.goofish.com/publish', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(6000)
const fi = await page.$('input[type=file]')
if (fi) await fi.uploadFile(IMG)
await sleep(12000)
const SEL = 'div[contenteditable="true"]'
if (await page.$(SEL)) {
  await page.click(SEL)
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(DESC, { delay: 8 })
}
await sleep(8000)
await page.evaluate(() => {
  const i = Array.from(document.querySelectorAll('input[placeholder="0.00"]')).filter(e => e.offsetParent !== null)
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  if (s && i[0]) s.call(i[0], '1')
  if (i[0]) i[0].dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(12000)

// ── 类目 DOM 深挖 ──
console.log('=== 类目 DOM 深挖 ===')
const domInfo = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('*'))
  const hits = all.filter(e => /分类/.test((e.innerText || '')) && (e.innerText || '').length < 300 && e.children.length <= 6)
  return hits.slice(0, 6).map(e => ({
    tag: e.tagName, cls: (e.className || '').toString().slice(0, 80),
    text: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
    cursor: getComputedStyle(e).cursor,
    html: e.outerHTML.slice(0, 600),
  }))
})
console.log(JSON.stringify(domInfo, null, 1).slice(0, 3000))

// 找「分类」值元素并尝试点击
const clicked = await page.evaluate(() => {
  const cand = Array.from(document.querySelectorAll('[class*=categoryText],[class*=CategoryText],[class*=categor]'))
  if (!cand.length) return { found: false }
  const el = cand[0]
  const r = el.getBoundingClientRect()
  return { found: true, cls: (el.className || '').toString(), text: (el.innerText || '').trim(),
           rect: { x: r.x, y: r.y, w: r.width, h: r.height } }
})
console.log('类目值元素:', JSON.stringify(clicked))
if (clicked.found && clicked.rect.w > 0) {
  await page.mouse.click(clicked.rect.x + clicked.rect.w / 2, clicked.rect.y + clicked.rect.h / 2)
  await sleep(3500)
  const after = await page.evaluate(() => {
    const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
    return {
      hasPicker: /选择分类|请选择分类|其他服务|重新选择|修改分类/.test(t),
      tail: t.slice(0, 900),
    }
  })
  console.log('点击后:', JSON.stringify(after, null, 1).slice(0, 1500))
}

// ── grep JS bundle ──
console.log('\n=== JS bundle 搜索 ===')
console.log('JS 数量:', jsUrls.size)
const KEYWORDS = ['其他服务', 'DeepSeek服务', '网页版暂不支持', '扫码去APP', 'newPublishChoice', '选择分类', 'channelCatId']
const findings = {}
for (const u of [...jsUrls].filter(x => /idle-pc|goofish|xy-site/i.test(x)).slice(0, 20)) {
  try {
    const txt = await page.evaluate(async (url) => {
      try { const r = await fetch(url); return await r.text() } catch { return '' }
    }, u)
    if (!txt) continue
    for (const k of KEYWORDS) {
      if (txt.includes(k)) {
        if (!findings[k]) findings[k] = []
        const i = txt.indexOf(k)
        findings[k].push({ url: u.slice(-70), ctx: txt.slice(Math.max(0, i - 200), i + 200) })
      }
    }
  } catch {}
}
console.log('命中关键词:', Object.keys(findings))
for (const [k, v] of Object.entries(findings)) {
  console.log(`\n--- ${k} (${v.length}) ---`)
  console.log(v[0].ctx.slice(0, 400))
}

writeFileSync(`${OUT}/xianyu-bundle-scan.json`, JSON.stringify({ domInfo, clicked, findings, jsUrls: [...jsUrls] }, null, 2), 'utf-8')
console.log('\n已保存')
await browser.close()
