/** 标题/价格到底存在 Json 的哪个位置（state vs components vs models） */
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

// 键入标题
const box = await page.evaluate(() => {
  const inp = Array.from(document.querySelectorAll('input')).find((e) => e.offsetParent !== null && /最多允许输入30个汉字/.test(e.placeholder || ''))
  if (!inp) return null
  inp.scrollIntoView({ block: 'center' })
  const r = inp.getBoundingClientRect()
  return { x: Math.round(r.x + 20), y: Math.round(r.y + r.height / 2) }
})
await page.mouse.click(box.x, box.y)
await sleep(500)
await page.keyboard.type('标题存哪测试', { delay: 40 })
await sleep(2000)

const r = await page.evaluate(() => {
  const J = window.Json || {}
  const out = {}
  out.fvKeys = Object.keys(J.models?.formValues || {})
  out.fvTitle = J.models?.formValues?.title
  out.modelsTitle = J.models?.title
  out.compTitle = J.components?.title?.props?.value
  out.compTitleKeys = J.components?.title ? Object.keys(J.components.title.props || {}) : null
  // 全局搜这个字符串
  const s = JSON.stringify(J)
  out.foundInJson = s.includes('标题存哪测试')
  // 搜 components 里含标题的
  for (const [k, c] of Object.entries(J.components || {})) {
    const v = c?.props?.value
    if (typeof v === 'string' && v.includes('标题存哪测试')) out.foundIn = 'components.' + k + '.props.value'
  }
  return out
})
console.log(JSON.stringify(r, null, 1))
console.log('\n窗口保持 8s')
await sleep(8000)
await browser.close()
