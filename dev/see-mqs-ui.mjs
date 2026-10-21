/** 装了觅千手扩展后，发布页上它的入口/UI 长什么样 */
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
  headless: false, executablePath: findChromePath(), userDataDir: profileDir('taobao', account),
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,950',
    `--disable-extensions-except=${MQS}`, `--load-extension=${MQS}`],
  defaultViewport: null,
})
const page = (await browser.pages())[0] || (await browser.newPage())
await page.setCookie(...Object.entries(acc.cookies || {}).filter(([, v]) => v !== '' && v != null)
  .flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.taobao.com', path: '/' },
    { name, value: String(value), domain: '.tmall.com', path: '/' },
  ])))
await page.goto('https://item.upload.taobao.com/sell/v2/publish.htm?catId=50013618', { waitUntil: 'domcontentloaded', timeout: 60000 })
for (let i = 0; i < 25; i++) { await sleep(2000); if (await page.evaluate(() => !!document.querySelector('#struct-mainImagesGroup')).catch(() => false)) break }
await sleep(6000)

// 觅千手自己的 UI / 元素（kdds / kdcm / 搬家 / 填充 相关）
const mqsUi = await page.evaluate(() => {
  const hits = []
  for (const e of Array.from(document.querySelectorAll('[id], [class]'))) {
    const id = e.id || ''
    const cls = String(e.className || '')
    if (/kdds|kdcm|mqs|qianshou|搬家|一键|填充|采集/.test(id + ' ' + cls + ' ' + (e.textContent || '').slice(0, 30))) {
      const r = e.getBoundingClientRect()
      if (r.width > 0 && e.offsetParent) hits.push({ tag: e.tagName, id: id.slice(0, 40), cls: cls.slice(0, 60), text: (e.textContent || '').trim().slice(0, 30), x: Math.round(r.x), y: Math.round(r.y) })
    }
  }
  return { count: hits.length, hits: hits.slice(0, 20), bodyText: (document.body.innerText || '').slice(0, 400) }
})
console.log('觅千手 UI 元素:', mqsUi.count)
for (const h of mqsUi.hits) console.log(' ', JSON.stringify(h))
await page.screenshot({ path: 'dev/.ui-shots/mqs-extension-page.png' })
console.log('\n截图已存。窗口保持 20s 供人工看。')
await sleep(20000)
await browser.close()
