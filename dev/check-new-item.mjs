/**
 * 确认新发布那条的真实状态（是审核中还是已删除）。
 * 只读。
 */
import puppeteer from 'puppeteer-core'
import { findChromePath, profileDir, clearProfileLocks, sleep } from '../lib/browser-login.js'
import { CredentialStore } from '../lib/services/credential-store.js'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ID = '1093209692370'

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

await page.goto(`https://www.goofish.com/item?id=${ID}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(7000)
const r = await page.evaluate(() => {
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
  return {
    deleted: /宝贝被删掉了|已下架|已被删除|不存在或已下架/.test(t),
    hasReview: /审核中|审核|待审核|发布成功/.test(t),
    text: t.slice(0, 700),
  }
})
console.log('URL:', page.url())
console.log('已删除:', r.deleted)
console.log('含审核字样:', r.hasReview)
console.log('页面文本:', r.text.slice(0, 500))

// 个人中心列表
await page.goto('https://www.goofish.com/personal', { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(6000)
const p = await page.evaluate(() => {
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
  return t.slice(0, 1200)
})
console.log('\n--- 个人中心 ---')
console.log(p.slice(0, 700))
await browser.close()
