/**
 * 决定性实验：点开「分类」ant-select 下拉框，选择「其他服务」，
 * 验证「网页版暂不支持」是否消失 → 网页版发布链路是否可打通。
 * 只选择 + 校验，不点发布。
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
await sleep(14000)
const SEL = 'div[contenteditable="true"]'
if (await page.$(SEL)) {
  await page.click(SEL)
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(DESC, { delay: 8 })
}
await sleep(10000)
await page.evaluate(() => {
  const i = Array.from(document.querySelectorAll('input[placeholder="0.00"]')).filter(e => e.offsetParent !== null)
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  if (s && i[0]) s.call(i[0], '1')
  if (i[0]) i[0].dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(14000)

const readState = () => page.evaluate(() => {
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
  const m = t.match(/分类 \* ([^\s]+)/)
  return { category: m ? m[1] : null, blocked: /网页版暂不支持发布此分类|请使用闲鱼APP扫码/.test(t) }
})

console.log('=== 初始 ===', JSON.stringify(await readState()))

// 定位分类的 ant-select
const selInfo = await page.evaluate(() => {
  const labels = Array.from(document.querySelectorAll('label'))
  const lab = labels.find(l => (l.getAttribute('title') || l.innerText || '').trim().startsWith('分类'))
  if (!lab) return { found: false }
  const item = lab.closest('.ant-form-item')
  if (!item) return { found: false, why: 'no form-item' }
  const sel = item.querySelector('.ant-select')
  if (!sel) return { found: false, why: 'no ant-select' }
  const r = sel.getBoundingClientRect()
  const inp = sel.querySelector('input')
  return {
    found: true,
    cls: (sel.className || '').toString(),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    expanded: inp ? inp.getAttribute('aria-expanded') : null,
    // 下拉选项容器 id
    ariaOwns: inp ? inp.getAttribute('aria-owns') : null,
  }
})
console.log('分类下拉框:', JSON.stringify(selInfo))

if (selInfo.found) {
  // 点开下拉
  await page.mouse.click(selInfo.rect.x + selInfo.rect.w / 2, selInfo.rect.y + selInfo.rect.h / 2)
  await sleep(3000)

  const opened = await page.evaluate(() => {
    const inp = document.querySelector('.ant-select-selection-search-input')
    const expanded = inp ? inp.getAttribute('aria-expanded') : null
    // 选项
    const opts = Array.from(document.querySelectorAll('.ant-select-item-option, .ant-select-item'))
      .map(e => ({ text: (e.textContent || '').trim(), cls: (e.className || '').toString().slice(0, 70) }))
    const dropdowns = Array.from(document.querySelectorAll('.ant-select-dropdown'))
      .map(e => ({ cls: (e.className || '').toString().slice(0, 80), hidden: e.classList.contains('ant-select-dropdown-hidden'),
                   text: (e.textContent || '').replace(/\s+/g, ' ').slice(0, 300) }))
    return { expanded, opts: opts.slice(0, 30), dropdowns }
  })
  console.log('\n=== 下拉打开后 ===')
  console.log('aria-expanded:', opened.expanded)
  console.log('下拉容器:', JSON.stringify(opened.dropdowns, null, 1))
  console.log('选项数:', opened.opts.length)
  console.log(JSON.stringify(opened.opts, null, 1))

  writeFileSync(`${OUT}/xianyu-dropdown.json`, JSON.stringify({ selInfo, opened }, null, 2), 'utf-8')

  // 找「其他服务」
  const target = opened.opts.find(o => o.text === '其他服务')
  if (target) {
    console.log('\n=== 选择「其他服务」 ===')
    const clicked = await page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll('.ant-select-item-option'))
      const t = opts.find(e => (e.textContent || '').trim() === '其他服务')
      if (!t) return false
      t.scrollIntoView({ block: 'center' })
      t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      t.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      t.click()
      return true
    })
    console.log('点击结果:', clicked)
    await sleep(8000)
    const after = await readState()
    console.log('\n★★★ 选择后状态:', JSON.stringify(after))
    await page.screenshot({ path: `${OUT}/xianyu-after-select.png`, fullPage: true })
    writeFileSync(`${OUT}/xianyu-after-select.json`, JSON.stringify({ before: await readState(), after }, null, 2), 'utf-8')
  } else {
    console.log('\n下拉中未找到「其他服务」，可选值:', opened.opts.map(o => o.text))
  }
}

await browser.close()
