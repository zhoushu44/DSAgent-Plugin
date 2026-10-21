/**
 * 最后一个卡点：真实键盘输入后，React state 是否更新。
 * 之前 native setter 只改 DOM 不改 state。用 page.keyboard 真实键入。
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

const snap = () => page.evaluate(() => {
  const fv = window.Json?.models?.formValues || {}
  const dom = Array.from(document.querySelectorAll('input')).find((e) => /最多允许输入30个汉字/.test(e.placeholder || ''))
  return { stateTitle: fv.title ?? '(无此字段)', domTitle: dom?.value || '' }
})

const box = await page.evaluate(() => {
  const inp = Array.from(document.querySelectorAll('input')).find((e) => e.offsetParent !== null && /最多允许输入30个汉字/.test(e.placeholder || ''))
  if (!inp) return null
  inp.scrollIntoView({ block: 'center' })
  const r = inp.getBoundingClientRect()
  return { x: Math.round(r.x + 20), y: Math.round(r.y + r.height / 2) }
})
console.log('标题框:', JSON.stringify(box), '\n初始:', JSON.stringify(await snap()))

if (box) {
  await page.mouse.click(box.x, box.y)
  await sleep(600)
  // 逐字真实键入
  await page.keyboard.type('真实键盘测试标题', { delay: 40 })
  await sleep(1000)
  await page.keyboard.press('Tab')
  await sleep(1500)
  console.log('真实键入后:', JSON.stringify(await snap()))
}

console.log('\n窗口保持 10s')
await sleep(10000)
await browser.close()
