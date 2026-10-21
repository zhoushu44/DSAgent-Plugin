/**
 * 找到「宝贝标题」输入框的真实锚点（直达发布页），然后试 React 受控写入。
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
await page.goto('https://item.upload.taobao.com/sell/v2/publish.htm?catId=50013618',
  { waitUntil: 'domcontentloaded', timeout: 60000 })
for (let i = 0; i < 30; i++) { await sleep(2000); if (await page.evaluate(() => !!document.querySelector('#struct-mainImagesGroup')).catch(() => false)) break }
await sleep(3000)

// 全部可见 input 列出来
const inputs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('input, textarea'))
    .filter((e) => e.offsetParent !== null && !e.disabled && !e.readOnly)
    .map((e) => ({
      ph: e.placeholder || '', name: e.name || '', id: e.id || '',
      cls: String(e.className).slice(0, 50), type: e.type,
      // 最近的 label
      label: (e.closest('[class*="item"], [class*="field"], [class*="wrap"]')?.querySelector('label')?.innerText || '').slice(0, 20),
      val: e.value || '',
    }))
})
console.log('可见输入框', inputs.length, '个:')
for (const i of inputs) console.log(' ', JSON.stringify(i))

// 锁定标题框
const titleSel = await page.evaluate(() => {
  const inp = Array.from(document.querySelectorAll('input, textarea'))
    .find((e) => e.offsetParent !== null && /标题|宝贝/.test((e.placeholder || '') + (e.getAttribute('aria-label') || '')))
  return inp ? { found: true, ph: inp.placeholder, id: inp.id } : { found: false }
})
console.log('标题框:', JSON.stringify(titleSel))
await sleep(8000)
await browser.close()
