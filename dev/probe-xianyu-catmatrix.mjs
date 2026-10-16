/**
 * 找出「既能在网页版发布、类目又合适」的分类。
 * 候选来自实测出现过的下拉项。
 * 只选类目 + 读状态，不点发布。
 */
import puppeteer from 'puppeteer-core'
import { findChromePath, profileDir, clearProfileLocks, sleep } from '../lib/browser-login.js'
import { CredentialStore } from '../lib/services/credential-store.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT = 'dev/.ui-shots'
mkdirSync(OUT, { recursive: true })

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().find(a => a.platform === 'xianyu' && a.status === 'valid')
const cookies = acc.cookies || {}
const dir = profileDir('xianyu', acc.shop_key)
clearProfileLocks(dir)

const browser = await puppeteer.launch({
  executablePath: findChromePath(), headless: false, userDataDir: dir, protocolTimeout: 600000,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })
await page.setCookie(...Object.entries(cookies).filter(([, v]) => v).flatMap(([name, value]) => ([
  { name, value: String(value), domain: '.goofish.com', path: '/' },
  { name, value: String(value), domain: '.taobao.com', path: '/' },
])))

// 用「互联网软硬件服务」类描述，能唤出较合适的候选集
const IMG = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/xianyu/img/deepseek-api/01-钩子-官方2折.jpg'
const DESC = '大模型 API 接口接入与配置服务，提供接口对接、参数调试与远程协助。\n\n支持接入主流大模型，按官网价折扣计费。'

await page.goto('https://www.goofish.com/publish', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(5000)
const fi = await page.$('input[type=file]')
if (fi) await fi.uploadFile(IMG)
await sleep(13000)
const SEL = 'div[contenteditable="true"]'
await page.click(SEL)
await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
await page.keyboard.press('Backspace')
await page.keyboard.type(DESC, { delay: 8 })
await sleep(11000)
await page.evaluate(() => {
  const i = Array.from(document.querySelectorAll('input[placeholder="0.00"]')).filter(e => e.offsetParent !== null)
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  if (s && i[0]) s.call(i[0], '1')
  if (i[0]) i[0].dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(13000)

const box = await page.evaluate(() => {
  const lab = Array.from(document.querySelectorAll('label'))
    .find(l => ((l.getAttribute('title') || l.innerText || '').trim()).startsWith('分类'))
  const sel = lab?.closest('.ant-form-item')?.querySelector('.ant-select')
  if (!sel) return null
  const r = sel.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})
if (!box) { console.log('NO_SELECT'); await browser.close(); process.exit(1) }

await page.mouse.click(box.x, box.y)
await sleep(3000)
const opts = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.ant-select-item-option')).map(e => (e.textContent || '').trim()))
console.log('候选:', JSON.stringify(opts))

const state = () => page.evaluate(() => {
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
  const m = t.match(/分类 \* ([^\s]+)/)
  const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === '发布')
  return { category: m ? m[1] : null, blocked: /网页版暂不支持发布此分类|请使用闲鱼APP扫码/.test(t),
           publishDisabled: btn ? btn.disabled : null }
})

const results = []
for (const opt of opts) {
  // 逐个选择
  await page.evaluate((tt) => {
    const el = Array.from(document.querySelectorAll('.ant-select-item-option')).find(e => (e.textContent || '').trim() === tt)
    if (el) { el.scrollIntoView({ block: 'center' })
              el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
              el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); el.click() }
  }, opt)
  await sleep(7000)
  const st = await state()
  results.push({ option: opt, ...st })
  console.log(`  ${st.blocked ? 'BLOCKED' : 'OK     '}  ${opt}  (${st.category})`)
  // 重开下拉
  await page.mouse.click(box.x, box.y)
  await sleep(2200)
}

console.log('\n=== 网页版可发布且类目合适的 ===')
for (const r of results.filter(x => !x.blocked)) {
  const good = /服务|技能|互联网|软硬件|软件|系统/.test(r.option)
  console.log(`  ${good ? '★' : ' '} ${r.option}`)
}

writeFileSync(`${OUT}/xianyu-cat-matrix.json`, JSON.stringify({ options: opts, results }, null, 2), 'utf-8')
console.log('\nDONE')
await browser.close()
