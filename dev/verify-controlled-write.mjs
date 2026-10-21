/**
 * 唯一卡点验证：程序写入 formValues 后，让前端校验认可。
 * 淘宝发布页是 React 受控表单 —— fv.title='x' 直接赋值不进 React state，
 * 校验读的是 React state 而非 DOM/fv。
 * 这里试几种让它被认可的办法，找到可行的那个。
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

// 找标题输入框
const titleBox = await page.evaluate(() => {
  const inp = Array.from(document.querySelectorAll('input'))
    .find((e) => e.offsetParent !== null && /标题/.test(e.placeholder || ''))
  if (!inp) return null
  const r = inp.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, ph: inp.placeholder }
})
console.log('标题框:', JSON.stringify(titleBox))

// 读校验状态基线（点一次提交前的错误数）
const errCount = () => page.evaluate(() => {
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
  const m = t.match(/错误\s*\((\d+)\)/)
  return m ? Number(m[1]) : -1
})
await page.evaluate(() => { const b = document.querySelector('button[name="button-submit"]'); if (b) b.click() }).catch(() => { })
await sleep(3000)
console.log('基线错误数:', await errCount())

// 法 1：fv 赋值 + dispatchEvent input（受控不认）
await page.evaluate(() => {
  const fv = window.Json?.models?.formValues
  if (fv) fv.title = '程序写入测试标题'
})
await sleep(1500)
await page.evaluate(() => { const b = document.querySelector('button[name="button-submit"]'); if (b) b.click() }).catch(() => { })
await sleep(3000)
console.log('法1(fv赋值) 错误数:', await errCount())

// 法 2：真实键盘输入（fillField 走的路，应该有效）
if (titleBox) {
  await page.mouse.click(titleBox.x, titleBox.y)
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('真实键盘输入测试标题', { delay: 20 })
  await page.keyboard.press('Tab')
  await sleep(1500)
  await page.evaluate(() => { const b = document.querySelector('button[name="button-submit"]'); if (b) b.click() }).catch(() => { })
  await sleep(3000)
  console.log('法2(真实键盘) 错误数:', await errCount())
  const domVal = await page.evaluate(() => {
    const inp = Array.from(document.querySelectorAll('input')).find((e) => /标题/.test(e.placeholder || ''))
    return inp?.value || ''
  })
  console.log('法2 DOM value:', domVal)
}

// 法 3：native setter + input 事件
await page.evaluate(() => {
  const inp = Array.from(document.querySelectorAll('input')).find((e) => /标题/.test(e.placeholder || ''))
  if (!inp) return
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(inp, 'native setter 测试标题')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('change', { bubbles: true }))
})
await sleep(1500)
await page.evaluate(() => { const b = document.querySelector('button[name="button-submit"]'); if (b) b.click() }).catch(() => { })
await sleep(3000)
console.log('法3(native setter) 错误数:', await errCount())

console.log('\n窗口保持 15s')
await sleep(15000)
await browser.close()
