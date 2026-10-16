/**
 * 全流程探查（不点发布）：上传图 → 填描述 → 填价格 → 读取「自动识别」的类目与属性，
 * 并拦截 prepublish/preget 等接口响应，确认「扫码去APP发布」的触发条件。
 */
import puppeteer from 'puppeteer-core'
import { findChromePath, profileDir, clearProfileLocks, sleep } from '../lib/browser-login.js'
import { CredentialStore } from '../lib/services/credential-store.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT = 'dev/.ui-shots'
mkdirSync(OUT, { recursive: true })

const IMGS = [
  'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/xianyu/img/deepseek-api/01-钩子-官方2折.jpg',
  'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/xianyu/img/deepseek-api/02-权益-不做套路.jpg',
  'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/xianyu/img/deepseek-api/03-接入-支持模型.jpg',
]
const DESC = '【官方2折】AI大模型API中转 Key 独享 DeepSeek/Claude/GPT/GLM/Kimi 通用\n\n官方 2 折，1 元起测，按量计费不用不扣。'

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().find(a => a.platform === 'xianyu' && a.status === 'valid')
if (!acc) { console.log('无有效闲鱼账号'); process.exit(1) }
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

// 拦截关键接口
const apiLog = []
page.on('response', async (res) => {
  const u = res.url()
  if (/prepublish|preget|idleitem|category|cate|publish/i.test(u)) {
    let body = ''
    try { body = (await res.text()).slice(0, 3000) } catch {}
    apiLog.push({ url: u.slice(0, 200), status: res.status(), body })
  }
})

await page.goto('https://www.goofish.com/publish', { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(5000)

// 上传图片
const fi = await page.$('input[type=file]')
await fi.uploadFile(...IMGS)
console.log('已上传图片，等待识别...')
await sleep(15000)

// 填描述（必须真实键盘输入）
const SEL = 'div[contenteditable="true"]'
await page.click(SEL)
await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
await page.keyboard.press('Backspace')
await page.keyboard.type(DESC, { delay: 10 })
console.log('已填描述')
await sleep(8000)

// 填价格
await page.evaluate((v) => {
  const inputs = Array.from(document.querySelectorAll('input[placeholder="0.00"]')).filter(e => e.offsetParent !== null)
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  if (setter) setter.call(inputs[0], v); else inputs[0].value = v
  inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
  inputs[0].dispatchEvent(new Event('change', { bubbles: true }))
}, '1')
console.log('已填价格，等待类目识别...')
await sleep(12000)

const state = await page.evaluate(() => {
  const txt = (document.body?.innerText || '').replace(/\s+/g, ' ')
  const cat = document.querySelector('[class*=categoryText]')
  const props = Array.from(document.querySelectorAll('[class*=property],[class*=prop],[class*=attr],[class*=spec]'))
    .slice(0, 30).map(e => ({ cls: (e.className || '').toString().slice(0, 60), t: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 100) }))
  const dialogs = Array.from(document.querySelectorAll('[class*=modal],[class*=dialog],[role=dialog]'))
    .map(e => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 300)).filter(Boolean)
  return {
    url: location.href,
    categoryText: cat ? (cat.innerText || '').replace(/\s+/g, ' ') : null,
    hasAppQR: /扫码去APP发布|网页版暂不支持|去APP发布/.test(txt),
    textTail: txt.slice(0, 1800),
    props, dialogs,
  }
})

console.log('\n===== 识别结果 =====')
console.log('URL:', state.url)
console.log('categoryText:', state.categoryText)
console.log('hasAppQR:', state.hasAppQR)
console.log('--- 属性区 ---')
console.log(JSON.stringify(state.props, null, 1))
console.log('--- 弹窗 ---')
console.log(JSON.stringify(state.dialogs, null, 1))
console.log('--- 页面文本 ---')
console.log(state.textTail)
console.log('\n--- 接口 ---')
console.log(JSON.stringify(apiLog, null, 1).slice(0, 6000))

await page.screenshot({ path: `${OUT}/xianyu-recognized.png`, fullPage: true })
writeFileSync(`${OUT}/xianyu-recognized.json`, JSON.stringify({ state, apiLog }, null, 2), 'utf-8')
console.log('\n已保存到', OUT)
await browser.close()
