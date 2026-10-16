/**
 * 关键测试：选中候选集里普遍存在的「其他闲置」等类目，
 * 看「网页版暂不支持」是否消失（= 网页版能否发布）。
 * 同时测试能否用键盘在 ant-select 里搜索/输入类目。
 * 只选择+校验，不点发布。
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

const IMG = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/xianyu/img/deepseek-api/01-钩子-官方2折.jpg'
const DESC = '【官方2折】AI大模型API中转 Key 独享 DeepSeek/Claude/GPT/GLM/Kimi 通用\n\n官方2折，1元起测，按量计费不用不扣。'

await page.goto('https://www.goofish.com/publish', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(5000)
const fi = await page.$('input[type=file]')
if (fi) await fi.uploadFile(IMG)
await sleep(13000)
const SEL = 'div[contenteditable="true"]'
if (await page.$(SEL)) {
  await page.click(SEL)
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(DESC, { delay: 8 })
}
await sleep(11000)
await page.evaluate(() => {
  const i = Array.from(document.querySelectorAll('input[placeholder="0.00"]')).filter(e => e.offsetParent !== null)
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  if (s && i[0]) s.call(i[0], '1')
  if (i[0]) i[0].dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(14000)

const state = () => page.evaluate(() => {
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
  const m = t.match(/分类 \* ([^\s]+)/)
  const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === '发布')
  return { category: m ? m[1] : null,
           blocked: /网页版暂不支持发布此分类|请使用闲鱼APP扫码/.test(t),
           publishDisabled: btn ? btn.disabled : null,
           hint: (t.match(/分类 \*[^价]{0,120}/) || [''])[0] }
})

console.log('初始:', JSON.stringify(await state()))

const box = await page.evaluate(() => {
  const lab = Array.from(document.querySelectorAll('label'))
    .find(l => (l.getAttribute('title') || l.innerText || '').trim().startsWith('分类'))
  const sel = lab && lab.closest('.ant-form-item')?.querySelector('.ant-select')
  if (!sel) return null
  const r = sel.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})

// ── 测试1：点击「其他闲置」 ──
console.log('\n===== 测试1：选「其他闲置」 =====')
await page.mouse.click(box.x, box.y)
await sleep(3000)
let opts = await page.evaluate(() => Array.from(document.querySelectorAll('.ant-select-item-option')).map(e => (e.textContent || '').trim()))
console.log('候选:', JSON.stringify(opts))

for (const targetText of ['其他闲置', 'AI模型训练', 'AI提效工具']) {
  if (!opts.includes(targetText)) { console.log(`跳过（无 ${targetText}）`); continue }
  await page.evaluate((tt) => {
    const t = Array.from(document.querySelectorAll('.ant-select-item-option')).find(e => (e.textContent || '').trim() === tt)
    if (t) { t.scrollIntoView({ block: 'center' }); t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
             t.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); t.click() }
  }, targetText)
  await sleep(8000)
  const s = await state()
  console.log(`  选「${targetText}」→`, JSON.stringify(s))
  // 重新打开下拉以便下次选择
  await page.mouse.click(box.x, box.y)
  await sleep(2500)
  opts = await page.evaluate(() => Array.from(document.querySelectorAll('.ant-select-item-option')).map(e => (e.textContent || '').trim()))
}

// ── 测试2：能否用输入搜索类目 ──
console.log('\n===== 测试2：ant-select 输入搜索 =====')
await page.mouse.click(box.x, box.y)
await sleep(2000)
try {
  await page.keyboard.type('其他服务', { delay: 80 })
  await sleep(3500)
  const searched = await page.evaluate(() => ({
    opts: Array.from(document.querySelectorAll('.ant-select-item-option')).map(e => (e.textContent || '').trim()),
    empty: !!document.querySelector('.ant-select-item-empty'),
  }))
  console.log('搜索「其他服务」结果:', JSON.stringify(searched))
} catch (e) { console.log('搜索失败:', String(e).slice(0, 120)) }

await page.screenshot({ path: `${OUT}/xianyu-cat-tests.png`, fullPage: true })
writeFileSync(`${OUT}/xianyu-cat-tests.json`, JSON.stringify({ final: await state() }, null, 2), 'utf-8')
console.log('\n最终:', JSON.stringify(await state()))
await browser.close()
