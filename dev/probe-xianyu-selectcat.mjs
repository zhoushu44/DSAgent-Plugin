/**
 * 决定性实验：在网页版发布页把类目从「DeepSeek服务」改成「其他服务」。
 * 若能改成功且「网页版暂不支持」消失，则网页版发布链路完全打通。
 * 本脚本只做选择+校验，不点发布。
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
  executablePath: findChromePath(), headless: false, userDataDir: dir, protocolTimeout: 600000,
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

await page.goto('https://www.goofish.com/publish', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(5000)
const fi = await page.$('input[type=file]')
if (fi) await fi.uploadFile(IMG)
await sleep(14000)
const SEL = 'div[contenteditable="true"]'
if (await page.$(SEL)) {
  await page.click(SEL)
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(DESC, { delay: 8 })
}
await sleep(10000)
await page.evaluate(() => {
  const i = Array.from(document.querySelectorAll('input[placeholder="0.00"]')).filter(e => e.offsetParent !== null)
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  if (s && i[0]) s.call(i[0], '1')
  if (i[0]) i[0].dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(14000)

// 状态读取函数（轻量）
const readState = () => page.evaluate(() => {
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
  const m = t.match(/分类 \* ([^\s]+)/)
  return {
    category: m ? m[1] : null,
    blocked: /网页版暂不支持发布此分类|请使用闲鱼APP扫码/.test(t),
  }
})

console.log('=== 初始状态 ===')
const before = await readState()
console.log(JSON.stringify(before))

// 找「其他服务」元素
console.log('\n=== 查找「其他服务」 ===')
const found = await page.evaluate(() => {
  const out = []
  const all = document.querySelectorAll('div,span,li,button,a,p')
  for (const e of all) {
    const txt = (e.textContent || '').trim()
    if (txt === '其他服务' || txt === '其它互联网/软硬件相关服务' || txt === '其他技能服务') {
      const r = e.getBoundingClientRect()
      out.push({
        text: txt, tag: e.tagName,
        cls: (e.className || '').toString().slice(0, 90),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        visible: r.width > 0 && r.height > 0,
        depth: (() => { let d = 0, c = e; while (c.parentElement) { d++; c = c.parentElement } return d })(),
      })
    }
  }
  return out
})
console.log('候选元素数:', found.length)
console.log(JSON.stringify(found.slice(0, 15), null, 1))

// 也搜「分类」属性卡片区
const cardArea = await page.evaluate(() => {
  const all = document.querySelectorAll('*')
  for (const e of all) {
    const t = (e.textContent || '')
    if (/^分类\s*\*?/.test(t.trim()) && t.length < 400 && e.children.length < 12) {
      return { tag: e.tagName, cls: (e.className || '').toString().slice(0, 90), text: t.replace(/\s+/g, ' ').slice(0, 300),
               html: e.outerHTML.slice(0, 900) }
    }
  }
  return null
})
console.log('\n=== 分类卡片区 ===')
console.log(JSON.stringify(cardArea, null, 1))

writeFileSync(`${OUT}/xianyu-catclick-probe.json`, JSON.stringify({ before, found, cardArea }, null, 2), 'utf-8')

// 尝试点击「其他服务」
const target = found.find(f => f.text === '其他服务' && f.visible && f.rect.w > 0)
if (target) {
  console.log('\n=== 点击「其他服务」 ===')
  console.log('点击坐标:', JSON.stringify(target.rect))
  await page.evaluate(() => window.scrollTo(0, 0))
  await sleep(500)
  // 先滚动到元素位置
  await page.evaluate((t) => {
    const all = document.querySelectorAll('div,span,li,button,a,p')
    for (const e of all) {
      if ((e.textContent || '').trim() === t) { e.scrollIntoView({ block: 'center' }); return }
    }
  }, '其他服务')
  await sleep(1200)
  const rect2 = await page.evaluate((t) => {
    const all = document.querySelectorAll('div,span,li,button,a,p')
    for (const e of all) {
      if ((e.textContent || '').trim() === t) {
        const r = e.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) }
      }
    }
    return null
  }, '其他服务')
  console.log('滚动后坐标:', JSON.stringify(rect2))
  if (rect2 && rect2.w > 0) {
    await page.mouse.click(rect2.x, rect2.y)
    await sleep(5000)
    const after = await readState()
    console.log('\n=== 点击后状态 ===')
    console.log(JSON.stringify(after))
    await page.screenshot({ path: `${OUT}/xianyu-after-catclick.png`, fullPage: true })
  }
} else {
  console.log('\n未找到可点击的「其他服务」元素 —— 类目卡片可能未在 DOM 渲染')
}

await browser.close()
