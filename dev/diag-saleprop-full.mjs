/**
 * 完整销售属性流程：颜色键入 → 尺码弹层选值+确定 → 等 SKU 表出现 → 填 SKU 价格/库存。
 * 新版 SKU 面板是 sell-sku-table-wrapper-new，只有成套后才渲染。
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

const skuStatus = () => page.evaluate(() => {
  const w = document.querySelector('.sell-sku-table-wrapper-new')
  const tbl = document.querySelector('.sell-new-sku-table-content')
  return {
    wrapperVisible: w ? !!w.offsetParent : false,
    tableVisible: tbl ? !!tbl.offsetParent : false,
    inputs: w ? Array.from(w.querySelectorAll('input')).filter((e) => e.offsetParent !== null).map((e) => ({ ph: e.placeholder || '', val: e.value })) : [],
    text: tbl ? (tbl.innerText || '').replace(/\s+/g, ' ').slice(0, 300) : null,
  }
})

// ① 颜色分类：真实键入 + Enter
await page.evaluate(() => {
  const box = document.getElementById('struct-saleProp')
  const inp = box ? Array.from(box.querySelectorAll('input')).find((e) => e.offsetParent !== null && /主色/.test(e.placeholder || '')) : null
  if (!inp) return
  inp.scrollIntoView({ block: 'center' })
  inp.focus()
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(inp, '格蕾灰')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('change', { bubbles: true }))
  inp.dispatchEvent(new Event('blur', { bubbles: true }))
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }))
}).catch(() => { })
await sleep(3000)
console.log('① 颜色后 SKU:', JSON.stringify(await skuStatus()))

// ② 尺码弹层
await page.evaluate(() => {
  const box = document.getElementById('struct-saleProp')
  const inp = box ? Array.from(box.querySelectorAll('input')).find((e) => e.offsetParent !== null && /请选择尺码/.test(e.placeholder || '')) : null
  if (inp) { inp.scrollIntoView({ block: 'center' }); inp.click(); inp.dispatchEvent(new Event('mousedown', { bubbles: true })) }
}).catch(() => { })
await sleep(2500)

// dump 弹层，找「全选」和「确定」
const popup = await page.evaluate(() => {
  const panel = Array.from(document.querySelectorAll('.sell-size-sale-props-standard-size-popup, .next-overlay-wrapper.opened')).filter((p) => p.offsetParent).pop()
  if (!panel) return null
  const btns = Array.from(panel.querySelectorAll('button')).filter((b) => b.offsetParent !== null).map((b) => (b.innerText || '').trim())
  return { btns, text: (panel.innerText || '').replace(/\s+/g, ' ').slice(0, 200) }
})
console.log('② 尺码弹层:', JSON.stringify(popup))

// 勾 100cm（checkbox）
const picked = await page.evaluate(() => {
  const panel = Array.from(document.querySelectorAll('.sell-size-sale-props-standard-size-popup, .next-overlay-wrapper.opened')).filter((p) => p.offsetParent).pop()
  if (!panel) return null
  const items = Array.from(panel.querySelectorAll('label, .next-checkbox-wrapper')).filter((e) => e.offsetParent !== null && /^100cm$/.test((e.textContent || '').trim()))
  if (!items.length) return 'no-100cm'
  const t = items[0]
  const cb = t.querySelector('input[type=checkbox]') || (t.tagName === 'LABEL' ? t.control : null)
  if (cb && !cb.checked) cb.click()
  else t.click()
  return 'picked-100cm'
})
console.log('   勾选:', picked)
await sleep(1500)

// 点「确定」
const confirmed = await page.evaluate(() => {
  const panel = Array.from(document.querySelectorAll('.sell-size-sale-props-standard-size-popup, .next-overlay-wrapper.opened')).filter((p) => p.offsetParent).pop()
  if (!panel) return 'no-panel'
  const btn = Array.from(panel.querySelectorAll('button')).find((b) => (b.innerText || '').trim() === '确定' && !b.disabled)
  if (!btn) return 'no-ok'
  btn.click()
  return 'ok-clicked'
})
console.log('   确定:', confirmed)
await sleep(4000)
console.log('② 尺码后 SKU:', JSON.stringify(await skuStatus()))

// ③ 等 SKU 表出现
for (let i = 0; i < 20; i++) {
  await sleep(1500)
  const st = await skuStatus()
  if (st.tableVisible || st.inputs.length) { console.log('③ SKU 表出现:', JSON.stringify(st)); break }
  if (i === 19) console.log('③ SKU 表未出现:', JSON.stringify(st))
}

console.log('\n窗口保持 15s')
await sleep(15000)
await browser.close()
