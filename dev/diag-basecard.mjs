/** 看 base-card 结构，找标题/价格/货号的真实字段路径 */
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
for (let i = 0; i < 30; i++) { await sleep(2000); if (await page.evaluate(() => !!document.querySelector('#struct-mainImagesGroup')).catch(() => false)) break }
await sleep(4000)

const r = await page.evaluate(() => {
  const J = window.Json || {}
  const bc = J.models?.formValues?.['base-card']
  const sc = J.models?.formValues?.['sale-card']
  const out = {}
  out.baseCard = bc ? JSON.stringify(bc).slice(0, 1500) : '(无)'
  out.baseCardType = typeof bc
  out.baseCardKeys = bc && typeof bc === 'object' ? Object.keys(bc) : null
  out.saleCard = sc ? JSON.stringify(sc).slice(0, 800) : '(无)'
  out.saleCardKeys = sc && typeof sc === 'object' ? Object.keys(sc) : null
  // components 里 base-card 的 value
  out.compBaseCard = J.components?.['base-card']?.props?.value ? JSON.stringify(J.components['base-card'].props.value).slice(0, 800) : '(无)'
  // title 组件
  out.compTitleVal = J.components?.title?.props?.value
  out.compPriceVal = J.components?.price?.props?.value
  // 顶层 fv.title/price
  out.fvTitle = J.models?.formValues?.title
  out.fvPrice = J.models?.formValues?.price
  return out
})
console.log(JSON.stringify(r, null, 1))
console.log('\n窗口保持 10s')
await sleep(10000)
await browser.close()
