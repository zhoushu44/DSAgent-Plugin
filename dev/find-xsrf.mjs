/** 找发布页真实的 XSRF-TOKEN 来源（cookie / meta / 全局变量） */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir } = await import('../lib/browser-login.js')
const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const account = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')[0]?.shop_key
const acc = store.get(account)
const browser = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: profileDir('taobao', account),
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,950'],
  defaultViewport: null,
})
const page = (await browser.pages())[0] || (await browser.newPage())
await page.setCookie(...Object.entries(acc.cookies || {}).filter(([, v]) => v !== '' && v != null)
  .flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.taobao.com', path: '/' },
    { name, value: String(value), domain: '.tmall.com', path: '/' },
  ])))
await page.goto('https://item.upload.taobao.com/sell/v2/publish.htm?catId=50013618', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(8000)

const r = await page.evaluate(() => {
  const out = {}
  out.cookieXsrf = (document.cookie.match(/XSRF-TOKEN=([^;]+)/) || [])[1] || null
  out.metaXsrf = document.querySelector('meta[name*="csrf" i], meta[name*="xsrf" i]')?.getAttribute('content') || null
  // 全局变量里找
  out.winKeys = Object.keys(window).filter((k) => /xsrf|csrf|token/i.test(k)).slice(0, 10)
  // Json.request.submit 里可能带
  try {
    const s = JSON.stringify(window.Json?.request || {})
    out.submitHasXsrf = /xsrf|csrf/i.test(s)
  } catch (e) { }
  // 全局对象
  out.globals = ['g_config', 'g_page_config', 'window.__INIT__', 'initData'].map((k) => {
    try { return { k, has: !!window[k] } } catch (e) { return { k, has: false } }
  })
  return out
})
console.log(JSON.stringify(r, null, 1))
console.log('\n窗口保持 10s')
await sleep(10000)
await browser.close()
