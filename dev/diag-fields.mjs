/**
 * 精确诊断：每个字段写完后，立即回读 state（Json.formValues）和 DOM value，
 * 看哪些写进去了、哪些没进。这决定提交校验为什么不认。
 */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir } = await import('../lib/browser-login.js')
const { localImagesToSpaceUrls } = await import('../lib/taobao-image-space.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const account = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')[0]?.shop_key
const acc = store.get(account)
const SRC = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin', 'skills', 'pdd-link-matrix', 'assets', 'src')
const mainUp = await localImagesToSpaceUrls(['main_06.jpg'].map((n) => join(SRC, n)), { cookies: acc.cookies || {} })

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

const snapshot = () => page.evaluate(() => {
  const fv = window.Json?.models?.formValues || {}
  const domTitle = Array.from(document.querySelectorAll('input')).find((e) => /最多允许输入30个汉字/.test(e.placeholder || ''))?.value
  const domPrice = Array.from(document.querySelectorAll('input')).find((e) => /最多输入30字符/.test(e.placeholder || ''))?.value
  return {
    fvTitle: fv.title, fvPrice: fv.price, fvQty: fv.quantity,
    fvMain: (fv.mainImagesGroup?.images || []).length,
    fvSku: (fv.sku || []).length,
    fvSaleProp: fv.saleProp ? Object.keys(fv.saleProp) : [],
    domTitle: domTitle ? domTitle.slice(0, 20) : '', domPrice,
  }
})

console.log('=== 初始 ===')
console.log(JSON.stringify(await snapshot()))

// 1) 标题
await page.evaluate(() => {
  const inp = Array.from(document.querySelectorAll('input')).find((e) => e.offsetParent !== null && /最多允许输入30个汉字/.test(e.placeholder || ''))
  if (!inp) return
  inp.scrollIntoView({ block: 'center' })
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(inp, '诊断标题 秋冬儿童长裤')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('change', { bubbles: true }))
  inp.dispatchEvent(new Event('blur', { bubbles: true }))
})
await sleep(1500)
console.log('=== 写标题后 ===')
console.log(JSON.stringify(await snapshot()))

// 2) 找价格输入框的真实 placeholder
const allInputs = await page.evaluate(() => Array.from(document.querySelectorAll('input'))
  .filter((e) => e.offsetParent !== null && /text|number/.test(e.type || 'text'))
  .map((e) => ({ ph: e.placeholder || '', val: e.value || '', label: (e.closest('[class*="item"],[class*="field"],[class*="wrap"]')?.querySelector('label')?.innerText || '').slice(0, 20) })))
console.log('\n=== 所有文本输入框 ===')
for (const i of allInputs) console.log(' ', JSON.stringify(i))

console.log('\n窗口保持 12s')
await sleep(12000)
await browser.close()
