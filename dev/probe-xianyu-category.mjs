/**
 * 探查闲鱼发布页的类目机制：确认「扫码去APP发布」是硬门禁还是可切换类目绕过。
 * 只读探查，不点发布。
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
const accounts = store.listAccounts().filter(a => a.platform === 'xianyu')
console.log('xianyu 账号:', accounts.map(a => `${a.shop_key} (${a.status})`))
const acc = accounts.find(a => a.status === 'valid') || accounts[0]
if (!acc) { console.log('无闲鱼账号'); process.exit(1) }
console.log('使用账号:', acc.shop_key)

const cookies = acc.cookies || {}
console.log('Cookie 数:', Object.keys(cookies).length)

const dir = profileDir('xianyu', acc.shop_key)
clearProfileLocks(dir)
const exe = findChromePath()
console.log('Chrome:', exe)

const browser = await puppeteer.launch({
  executablePath: exe, headless: false, userDataDir: dir,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })

const cookieList = Object.entries(cookies).filter(([, v]) => v).flatMap(([name, value]) => ([
  { name, value: String(value), domain: '.goofish.com', path: '/' },
  { name, value: String(value), domain: '.taobao.com', path: '/' },
]))
if (cookieList.length) await page.setCookie(...cookieList)

console.log('打开发布页...')
await page.goto('https://www.goofish.com/publish', { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(6000)

const info = await page.evaluate(() => {
  const txt = (document.body?.innerText || '').replace(/\s+/g, ' ')
  const btns = Array.from(document.querySelectorAll('button')).map(b => ({
    t: (b.innerText || '').trim(), disabled: b.disabled,
    cls: (b.className || '').slice(0, 60),
  }))
  const sel = Array.from(document.querySelectorAll('[class*=select],[class*=category],[class*=cate]'))
    .slice(0, 25).map(e => ({ tag: e.tagName, cls: (e.className || '').toString().slice(0, 70),
                              t: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 60) }))
  const inputs = Array.from(document.querySelectorAll('input')).map(e => ({
    ph: e.placeholder, name: e.name, type: e.type, vis: e.offsetParent !== null,
  }))
  return { url: location.href, textHead: txt.slice(0, 1200), btns, sel, inputs }
})

console.log('URL:', info.url)
console.log('--- 页面文本(前1200) ---')
console.log(info.textHead)
console.log('--- 按钮 ---')
console.log(JSON.stringify(info.btns, null, 1))
console.log('--- 类目相关元素 ---')
console.log(JSON.stringify(info.sel, null, 1))
console.log('--- input ---')
console.log(JSON.stringify(info.inputs, null, 1))

await page.screenshot({ path: `${OUT}/xianyu-publish-probe.png`, fullPage: true })
writeFileSync(`${OUT}/xianyu-publish-probe.json`, JSON.stringify(info, null, 2), 'utf-8')
console.log('截图与 JSON 已保存到', OUT)
await browser.close()
