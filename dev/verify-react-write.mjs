/**
 * 验证 React 受控写入：找到让程序写入被校验认可的方法。
 * 用真实 placeholder 定位标题框。
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

const errCount = () => page.evaluate(() => {
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
  const m = t.match(/错误\s*\((\d+)\)/)
  return m ? Number(m[1]) : -1
})

// 找到标题框坐标
const box = await page.evaluate(() => {
  const inp = Array.from(document.querySelectorAll('input'))
    .find((e) => e.offsetParent !== null && /最多允许输入30个汉字/.test(e.placeholder || ''))
  if (!inp) return null
  inp.scrollIntoView({ block: 'center' })
  const r = inp.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
console.log('标题框坐标:', JSON.stringify(box))

// 基线
await page.evaluate(() => { const b = document.querySelector('button[name="button-submit"]'); if (b) b.click() }).catch(() => { })
await sleep(2500)
console.log('基线错误数:', await errCount())

if (box) {
  // 法 A：真实键盘输入（标准可靠路径）
  await page.mouse.click(box.x, box.y)
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('真实键盘输入测试标题A', { delay: 15 })
  await page.keyboard.press('Tab')
  await sleep(1500)
  const v1 = await page.evaluate(() => Array.from(document.querySelectorAll('input')).find((e) => /最多允许输入30个汉字/.test(e.placeholder || ''))?.value)
  await page.evaluate(() => { const b = document.querySelector('button[name="button-submit"]'); if (b) b.click() }).catch(() => { })
  await sleep(2500)
  console.log('法A(键盘) 后 title value=', v1, '错误数=', await errCount())

  // 法 B：native setter + React 事件（同时触发 input + change）
  await page.evaluate(() => {
    const inp = Array.from(document.querySelectorAll('input')).find((e) => /最多允许输入30个汉字/.test(e.placeholder || ''))
    if (!inp) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(inp, 'native setter 测试标题B')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    inp.dispatchEvent(new Event('blur', { bubbles: true }))
  })
  await sleep(1500)
  const v2 = await page.evaluate(() => Array.from(document.querySelectorAll('input')).find((e) => /最多允许输入30个汉字/.test(e.placeholder || ''))?.value)
  await page.evaluate(() => { const b = document.querySelector('button[name="button-submit"]'); if (b) b.click() }).catch(() => { })
  await sleep(2500)
  console.log('法B(native) 后 title value=', v2, '错误数=', await errCount())

  // 法 C：React 内部 fiber 触发（key 带 __reactProps）
  await page.evaluate(() => {
    const inp = Array.from(document.querySelectorAll('input')).find((e) => /最多允许输入30个汉字/.test(e.placeholder || ''))
    if (!inp) return
    const key = Object.keys(inp).find((k) => k.startsWith('__reactProps'))
    const props = key ? inp[key] : null
    if (props?.onChange) {
      props.onChange({ target: inp, currentTarget: inp, nativeEvent: new Event('input') })
    }
  })
  await sleep(1500)
  const v3 = await page.evaluate(() => Array.from(document.querySelectorAll('input')).find((e) => /最多允许输入30个汉字/.test(e.placeholder || ''))?.value)
  await page.evaluate(() => { const b = document.querySelector('button[name="button-submit"]'); if (b) b.click() }).catch(() => { })
  await sleep(2500)
  console.log('法C(reactProps) 后 title value=', v3, '错误数=', await errCount())
}

console.log('\n窗口保持 12s')
await sleep(12000)
await browser.close()
