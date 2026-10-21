/**
 * 专探「身高/尺码」维度：点开下拉看真实候选结构，以及它是怎么出候选的。
 * 关键：「销售属性必须成套使用，颜色分类+身高 请全选或全不选」。
 * 之前点开返回「无候选」——要弄清是没触发加载，还是选择器不对。
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
await sleep(4000)

// 先填颜色分类（触发后端联动）
console.log('① 填颜色分类「格蕾灰」...')
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
})
await sleep(3500)

// 点开身高下拉，dump 真实候选
const opened = await page.evaluate(() => {
  const box = document.getElementById('struct-saleProp')
  if (!box) return 'no-box'
  const inp = Array.from(box.querySelectorAll('input')).find((e) => e.offsetParent !== null && /请选择尺码/.test(e.placeholder || ''))
  if (!inp) return 'no-input'
  inp.scrollIntoView({ block: 'center' })
  inp.click()
  inp.dispatchEvent(new Event('mousedown', { bubbles: true }))
  inp.dispatchEvent(new Event('click', { bubbles: true }))
  return 'clicked'
})
console.log('身高点击:', opened)
await sleep(3000)

// dump 所有可见 overlay / panel 的内容
const panels = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('.next-overlay-wrapper, [class*="overlay"], [class*="popup"], [class*="menu"], [class*="dropdown"]'))
  return all.filter((p) => p.offsetParent !== null).map((p) => ({
    cls: String(p.className).slice(0, 60),
    text: (p.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
    items: Array.from(p.querySelectorAll('.options-item, li, [role=option]')).map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 12),
  })).filter((p) => p.items.length > 0)
})
console.log('展开的候选面板:', JSON.stringify(panels, null, 1).slice(0, 1500))

// 身高区域自身结构
const heightArea = await page.evaluate(() => {
  const box = document.getElementById('struct-saleProp')
  const labels = Array.from(box.querySelectorAll('*')).filter((e) => e.children.length === 0 && /^身高$/.test((e.textContent || '').trim()))
  if (!labels.length) return null
  const l = labels[0]
  let box2 = l
  for (let i = 0; i < 6 && box2; i++) {
    if (box2.querySelector('input, .next-select, [class*="select"]')) break
    box2 = box2.parentElement
  }
  return {
    cls: String(box2?.className || '').slice(0, 60),
    html: box2 ? box2.innerHTML.slice(0, 600) : null,
  }
})
console.log('\n身高区结构:', JSON.stringify(heightArea, null, 1))

console.log('\n窗口保持 20s')
await sleep(20000)
await browser.close()
