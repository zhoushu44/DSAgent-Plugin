/** 找「一口价」输入框 + 看销售属性填完后 SKU 表状态 */
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

// 找价格框：含「一口价」文字的区域附近
const priceBox = await page.evaluate(() => {
  const out = []
  for (const e of Array.from(document.querySelectorAll('input'))) {
    if (e.offsetParent === null) continue
    const ph = e.placeholder || ''
    if (/一口价|价格|单价/.test(ph)) { out.push({ ph, val: e.value, type: e.type }); continue }
    // 附近 label 含「一口价」
    let p = e.closest('[class*="item"], [class*="field"], [class*="wrap"], [id^="struct-"]')
    const lbl = p?.querySelector('label')?.innerText || ''
    if (/一口价|价格/.test(lbl)) out.push({ byLabel: lbl, ph, val: e.value, type: e.type })
  }
  // 也搜所有含「一口价」的可见元素
  const priceTexts = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && /一口价/.test(e.textContent || '') && e.offsetParent).map((e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 40), text: (e.textContent || '').trim() }))
  return { inputs: out, priceTexts: priceTexts.slice(0, 5) }
})
console.log('价格框:', JSON.stringify(priceBox, null, 1))

// 填销售属性看 SKU 表
await page.evaluate(() => {
  const box = document.getElementById('struct-saleProp')
  if (!box) return
  const inp = Array.from(box.querySelectorAll('input')).find((e) => e.offsetParent !== null && /主色/.test(e.placeholder || ''))
  if (!inp) return
  inp.scrollIntoView({ block: 'center' })
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(inp, '格蕾灰')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('change', { bubbles: true }))
  inp.dispatchEvent(new Event('blur', { bubbles: true }))
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
}).catch(() => { })
await sleep(3000)
const skuState = await page.evaluate(() => {
  const sku = document.getElementById('struct-sku')
  const rows = sku ? sku.querySelectorAll('tr.sku-table-row').length : -1
  const tags = Array.from(document.querySelectorAll('[class*="tag"], [class*="label-item"]')).filter((e) => e.offsetParent !== null).map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 10)
  const colorCount = (document.querySelector('.info-content')?.innerText || '').match(/颜色分类\((\d+)\)/)
  return { skuRows: rows, tags, colorCount: colorCount ? colorCount[1] : '?', skuVisible: sku ? !!sku.offsetParent : false, skuText: sku ? (sku.innerText || '').replace(/\s+/g, ' ').slice(0, 200) : null }
})
console.log('\n销售属性/SKU:', JSON.stringify(skuState, null, 1))
console.log('\n窗口保持 12s')
await sleep(12000)
await browser.close()
