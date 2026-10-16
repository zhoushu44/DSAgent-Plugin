/**
 * 核心问题：网页版发布页能否唤出「类目选择器」并手动选「其他服务」？
 * 1) 点击类目文本区，看是否弹出选择器
 * 2) 扫描页面 JS 里的类目树（找「其他服务」）
 * 3) 重测 channelCatId URL 参数（提高 protocolTimeout）
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
  protocolTimeout: 240000,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})

const IMG = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/xianyu/img/deepseek-api/01-钩子-官方2折.jpg'
const DESC = '【官方2折】AI大模型API中转 Key 独享 DeepSeek/Claude/GPT/GLM/Kimi 通用\n\n官方2折，1元起测，按量计费不用不扣。'

async function prep(p, url) {
  await p.setViewport({ width: 1440, height: 900 })
  await p.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })
  await p.setCookie(...Object.entries(cookies).filter(([, v]) => v).flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.goofish.com', path: '/' },
    { name, value: String(value), domain: '.taobao.com', path: '/' },
  ])))
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(5000)
  const fi = await p.$('input[type=file]')
  if (fi) await fi.uploadFile(IMG)
  await sleep(12000)
  const SEL = 'div[contenteditable="true"]'
  if (await p.$(SEL)) {
    await p.click(SEL)
    await p.keyboard.down('Control'); await p.keyboard.press('KeyA'); await p.keyboard.up('Control')
    await p.keyboard.press('Backspace')
    await p.keyboard.type(DESC, { delay: 8 })
  }
  await sleep(8000)
  await p.evaluate(() => {
    const i = Array.from(document.querySelectorAll('input[placeholder="0.00"]')).filter(e => e.offsetParent !== null)
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (s && i[0]) s.call(i[0], '1')
    if (i[0]) i[0].dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(10000)
}

// ── A) 点击类目区，看能否唤出选择器 ──
const pA = await browser.newPage()
await prep(pA, 'https://www.goofish.com/publish')
console.log('=== A) 类目区可交互性 ===')
const catInfo = await pA.evaluate(() => {
  const el = document.querySelector('[class*=categoryText]')
  if (!el) return { found: false }
  const cs = getComputedStyle(el)
  // 向上找可点击祖先
  let cur = el, clickable = null
  for (let i = 0; i < 5 && cur; i++) {
    const s = getComputedStyle(cur)
    if (s.cursor === 'pointer' || cur.onclick || cur.getAttribute('role') === 'button') { clickable = cur.className; break }
    cur = cur.parentElement
  }
  return {
    found: true, text: (el.innerText || '').trim(), cls: (el.className || '').toString(),
    cursor: cs.cursor, pointerEvents: cs.pointerEvents, clickableAncestor: clickable,
    outerHTML: el.outerHTML.slice(0, 500),
    parentHTML: el.parentElement ? el.parentElement.outerHTML.slice(0, 700) : null,
  }
})
console.log(JSON.stringify(catInfo, null, 1))

// 尝试点击类目
let afterClick = null
try {
  const sel = '[class*=categoryText]'
  await pA.click(sel).catch(() => {})
  await sleep(3000)
  afterClick = await pA.evaluate(() => {
    const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
    const modals = Array.from(document.querySelectorAll('[class*=modal],[class*=drawer],[class*=popup],[role=dialog]'))
      .map(e => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 400)).filter(Boolean)
    return { modals: modals.slice(0, 6), hasCatPicker: /选择分类|请选择分类|其他服务|分类选择/.test(t) }
  })
} catch (e) { afterClick = { err: String(e).slice(0, 150) } }
console.log('点击类目后:', JSON.stringify(afterClick, null, 1))

// 扫描页面 bundle 里的类目树
const treeScan = await pA.evaluate(async () => {
  const hits = []
  const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src)
  return { scriptCount: scripts.length, scripts: scripts.slice(0, 15) }
})
console.log('页面脚本:', JSON.stringify(treeScan, null, 1).slice(0, 900))
await pA.close()

// ── B) 重测 channelCatId 参数 ──
console.log('\n=== B) channelCatId URL 参数重测 ===')
const pB = await browser.newPage()
try {
  await prep(pB, 'https://www.goofish.com/publish?channelCatId=201461105')
  const rB = await pB.evaluate(() => {
    const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
    const m = t.match(/分类 \* ([^\s]+)/)
    return { category: m ? m[1] : null, blocked: /网页版暂不支持发布此分类|请使用闲鱼APP扫码/.test(t) }
  })
  console.log('channelCatId=201461105 →', JSON.stringify(rB))
} catch (e) { console.log('B 出错:', String(e).slice(0, 200)) }
await pB.close()

// ── C) 抓发布页全部接口，找类目相关 ──
console.log('\n=== C) 发布页接口全量 ===')
const pC = await browser.newPage()
const apis = []
pC.on('response', async (res) => {
  const u = res.url()
  if (/mtop/i.test(u)) {
    try { apis.push({ api: (u.match(/mtop\.[a-z0-9.]+/i) || [''])[0], body: (await res.text()).slice(0, 400) }) } catch {}
  }
})
await prep(pC, 'https://www.goofish.com/publish')
for (const a of apis) console.log(a.api, '→', a.body.slice(0, 200))
await pC.close()

writeFileSync(`${OUT}/xianyu-picker-probe.json`, JSON.stringify({ catInfo, afterClick, treeScan }, null, 2), 'utf-8')
console.log('\n已保存')
await browser.close()
