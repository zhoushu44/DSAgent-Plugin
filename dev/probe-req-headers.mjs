/**
 * 抓页面自己发的 asyncOpt 请求的完整头，照它发 previewDraftSubmit。
 * 同时直接回答：previewDraftSubmit 是「提交宝贝信息」= 正式发布吗？
 */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
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

// 抓请求头
const reqs = []
const cdp = await page.target().createCDPSession()
await cdp.send('Network.enable')
cdp.on('Network.requestWillBeSent', (e) => {
  if (/asyncOpt\.htm|previewDraftSubmit/.test(e.request.url)) {
    reqs.push({ url: e.request.url.slice(0, 120), headers: e.request.headers })
  }
})

await page.goto('https://item.upload.taobao.com/sell/v2/publish.htm?catId=50013618',
  { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(12000)

mkdirSync(join('dev', '.ui-shots'), { recursive: true })
writeFileSync(join('dev', '.ui-shots', 'req-headers.json'), JSON.stringify(reqs, null, 2))
console.log('抓到', reqs.length, '个请求')
if (reqs.length) {
  const h = reqs[reqs.length - 1].headers
  console.log('\n=== 最后一次 asyncOpt 的请求头 ===')
  for (const k of ['content-type', 'origin', 'referer', 'x-csrf-token', 'x-requested-with', 'accept', 'cookie'])
    if (h[k]) console.log(` ${k}: ${String(h[k]).slice(0, 100)}`)
}
console.log('\n窗口保持 8s')
await sleep(8000)
await browser.close()
