/** 新版 SKU 面板结构 + 一口价输入框 */
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

// 一口价：找含「一口价」label 的字段容器里的 input
const priceField = await page.evaluate(() => {
  const lbl = Array.from(document.querySelectorAll('.sell-component-info-wrapper-label, label, span')).find((e) => (e.textContent || '').trim() === '一口价' && e.offsetParent)
  if (!lbl) return null
  let box = lbl.parentElement
  for (let i = 0; i < 6 && box; i++) {
    if (box.querySelector('input, .next-input')) break
    box = box.parentElement
  }
  const inp = box?.querySelector('input')
  if (!inp) return { found: false, boxCls: String(box?.className).slice(0, 50) }
  inp.scrollIntoView({ block: 'center' })
  const r = inp.getBoundingClientRect()
  return { found: true, ph: inp.placeholder, type: inp.type, x: Math.round(r.x + 20), y: Math.round(r.y + r.height / 2) }
})
console.log('一口价字段:', JSON.stringify(priceField))
if (priceField?.found) {
  await page.mouse.click(priceField.x, priceField.y)
  await sleep(500)
  await page.keyboard.type('59.9', { delay: 60 })
  await page.keyboard.press('Tab')
  await sleep(1200)
  const v = await page.evaluate(() => {
    const lbl = Array.from(document.querySelectorAll('.sell-component-info-wrapper-label, label, span')).find((e) => (e.textContent || '').trim() === '一口价' && e.offsetParent)
    let box = lbl.parentElement
    for (let i = 0; i < 6 && box; i++) { if (box.querySelector('input')) break; box = box.parentElement }
    return box?.querySelector('input')?.value
  })
  console.log('一口价写入:', v)
}

// 新版 SKU 面板：dump #struct-sku 的结构
const skuPanel = await page.evaluate(() => {
  const sku = document.getElementById('struct-sku') || document.getElementById('struct-saleProp')
  if (!sku) return null
  const inputs = Array.from(sku.querySelectorAll('input')).filter((e) => e.offsetParent !== null).map((e) => ({ ph: e.placeholder || '', type: e.type, val: e.value }))
  const btns = Array.from(sku.querySelectorAll('button')).filter((e) => e.offsetParent !== null).map((e) => (e.innerText || '').trim()).filter(Boolean).slice(0, 12)
  const cls = Array.from(new Set(Array.from(sku.querySelectorAll('[class]')).map((e) => String(e.className).split(' ')[0]))).slice(0, 25)
  return { visible: !!sku.offsetParent, text: (sku.innerText || '').replace(/\s+/g, ' ').slice(0, 300), inputs, btns, cls }
})
console.log('\nSKU 面板:', JSON.stringify(skuPanel, null, 1))
console.log('\n窗口保持 12s')
await sleep(12000)
await browser.close()
