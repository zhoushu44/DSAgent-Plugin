/**
 * 把觅千手扩展整个装进 Chrome，验证它在发布页是否自动接管。
 * 用法：node dev/load-mqs-extension.mjs
 */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir } = await import('../lib/browser-login.js')
const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const account = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')[0]?.shop_key
const acc = store.get(account)
const MQS = 'E:\\360MoveData\\Users\\Administrator\\Desktop\\觅千手'

const browser = await puppeteer.launch({
  headless: false,
  executablePath: findChromePath(),
  userDataDir: profileDir('taobao', account),
  args: [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1440,950',
    `--disable-extensions-except=${MQS}`,
    `--load-extension=${MQS}`,
  ],
  defaultViewport: null,
})
const page = (await browser.pages())[0] || (await browser.newPage())
await page.setCookie(...Object.entries(acc.cookies || {}).filter(([, v]) => v !== '' && v != null)
  .flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.taobao.com', path: '/' },
    { name, value: String(value), domain: '.tmall.com', path: '/' },
  ])))
await page.goto('https://item.upload.taobao.com/sell/v2/publish.htm?catId=50013618',
  { waitUntil: 'domcontentloaded', timeout: 60000 })

// 等觅千手注入
for (let i = 0; i < 20; i++) {
  await sleep(2000)
  const st = await page.evaluate(() => ({
    formReady: !!document.querySelector('#struct-mainImagesGroup'),
    hasHook: !!window.__KDDS_BEFOREUNLOAD_BLOCKED__ || !!localStorage.getItem('kdds_taobao_detailData'),
    kddsKeys: Object.keys(localStorage).filter((k) => /kdds/i.test(k)),
    loaderReady: !!window.__kddsJsonHookInstalled,
  })).catch(() => null)
  if (st) console.log(`[${i}]`, JSON.stringify(st))
  if (st?.formReady && st?.hasHook) break
}

console.log('\n窗口保持 25s（可人工观察觅千手是否接管）')
await sleep(25000)
await browser.close()
