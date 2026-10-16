/**
 * 找违规原因：
 *   1) 打开已删除商品页，dump 全部链接与 HTML（可能有「查看原因/申诉」入口）
 *   2) 探测安全中心 / 违规记录 / 申诉 页面
 *   3) dump 个人中心所有 tab 链接
 * 只读。
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

const out = {}

// ── 1) 已删除商品页的链接 ──
console.log('STEP1 deleted item page links')
await page.goto('https://www.goofish.com/item?id=1091025114388', { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(5000)
out.deletedPage = await page.evaluate(() => {
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
  const links = Array.from(document.querySelectorAll('a')).map(a => ({
    text: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    href: a.href,
  })).filter(l => l.href && !/^javascript/.test(l.href))
  return { text: t.slice(0, 1500), links: links.slice(0, 40) }
})
console.log('  text:', out.deletedPage.text.slice(0, 300))
console.log('  links:', JSON.stringify(out.deletedPage.links.slice(0, 20), null, 1))

// ── 2) 安全中心等页面 ──
const URLS = [
  'https://www.goofish.com/safety-center',
  'https://www.goofish.com/security',
  'https://www.goofish.com/punish',
  'https://www.goofish.com/appeal',
  'https://www.goofish.com/personal?tab=account',
  'https://www.goofish.com/seller',
  'https://www.goofish.com/my',
]
console.log('STEP2 safety pages')
out.pages = []
for (const u of URLS) {
  try {
    await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 35000 })
    await sleep(4000)
    const r = await page.evaluate(() => {
      const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
      const links = Array.from(document.querySelectorAll('a')).map(a => ({
        text: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30), href: a.href,
      })).filter(l => l.href && /goofish/.test(l.href))
      return { url: location.href, text: t.slice(0, 1200), links: links.slice(0, 30) }
    })
    console.log(`  ${u} → ${r.url} | ${r.text.slice(0, 120)}`)
    out.pages.push(r)
  } catch (e) { console.log(`  ${u} ERR`); out.pages.push({ url: u, error: String(e).slice(0, 100) }) }
  await sleep(1000)
}

// ── 3) 个人中心所有 tab ──
console.log('STEP3 personal tabs')
await page.goto('https://www.goofish.com/personal', { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(6000)
out.personal = await page.evaluate(() => {
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
  const links = Array.from(document.querySelectorAll('a')).map(a => ({
    text: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30), href: a.href,
  })).filter(l => l.href && /goofish/.test(l.href))
  return { text: t.slice(0, 1500), links: [...new Map(links.map(l => [l.href, l])).values()].slice(0, 40) }
})
console.log('  tabs:', JSON.stringify(out.personal.links.slice(0, 25), null, 1))

writeFileSync(`${OUT}/xianyu-reason-probe.json`, JSON.stringify(out, null, 2), 'utf-8')
console.log('DONE')
await browser.close()
