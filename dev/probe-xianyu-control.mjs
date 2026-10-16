/**
 * 对照实验：用「实物」描述测试同一账号，确认网页版限制是「类目级」而非「账号级」。
 * 只读取识别结果，不点发布。
 */
import puppeteer from 'puppeteer-core'
import { findChromePath, profileDir, clearProfileLocks, sleep } from '../lib/browser-login.js'
import { CredentialStore } from '../lib/services/credential-store.js'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 用工作区已有的实物图做对照
const IMG = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/images/836319651332.jpg'
const DESC = '儿童摇粒绒家居服套装，加厚保暖，开衫设计好穿脱。全新未拆封，多色多码可选，包邮发货。'

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

await page.goto('https://www.goofish.com/publish', { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(4500)
const fi = await page.$('input[type=file]')
if (fi) await fi.uploadFile(IMG)
await sleep(11000)
const SEL = 'div[contenteditable="true"]'
await page.click(SEL)
await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
await page.keyboard.press('Backspace')
await page.keyboard.type(DESC, { delay: 8 })
await sleep(9000)
await page.evaluate(() => {
  const i = Array.from(document.querySelectorAll('input[placeholder="0.00"]')).filter(e => e.offsetParent !== null)
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  if (s) s.call(i[0], '49.9'); else i[0].value = '49.9'
  i[0].dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(11000)

const r = await page.evaluate(() => {
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
  const m = t.match(/分类 \* ([^ ]+)/)
  const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === '发布')
  return {
    category: m ? m[1] : null,
    blocked: /网页版暂不支持发布此分类|扫码去APP发布|请使用闲鱼APP扫码/.test(t),
    publishDisabled: btn ? btn.disabled : null,
    snippet: (t.match(/分类 \* [^#]{0,100}/) || [''])[0],
  }
})
console.log('===== 对照实验（实物类目）=====')
console.log(JSON.stringify(r, null, 1))
writeFileSync('dev/.ui-shots/xianyu-control.json', JSON.stringify(r, null, 2), 'utf-8')
await page.screenshot({ path: 'dev/.ui-shots/xianyu-control.png', fullPage: true })
await browser.close()
