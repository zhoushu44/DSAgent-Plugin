/**
 * 诊断：闲鱼发布页「描述编辑器」为什么收不到键盘输入。
 *
 * 背景：2026-10-20 17:50 起，xianyu-publish 连续两次在「填描述」这一步失败：
 *   描述已输入但页面未接收（编辑器内容仍为空）
 * 而当天上午 16:19 / 16:32 同样的代码两次发布成功。
 *
 * 本脚本只读页面结构，不做任何发布动作。
 *
 * 用法：node dev/probe-xianyu-desc-now.mjs
 */
import { findChromePath, profileDir, clearProfileLocks, sleep } from '../lib/browser-login.js'
import { CredentialStore } from '../lib/services/credential-store.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const OUT = 'dev/.ui-shots'
mkdirSync(OUT, { recursive: true })

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().find(a => a.platform === 'xianyu' && a.status !== 'invalid')
if (!acc) { console.log('无闲鱼账号'); process.exit(1) }
console.log('账号:', acc.shop_key, acc.status)

const dir = profileDir('xianyu', acc.shop_key)
clearProfileLocks(dir)

const browser = await puppeteer.launch({
  executablePath: findChromePath(), headless: false, userDataDir: dir, protocolTimeout: 600000,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })

const cookies = acc.cookies || {}
await page.setCookie(...Object.entries(cookies).filter(([, v]) => v).flatMap(([name, value]) => ([
  { name, value: String(value), domain: '.goofish.com', path: '/' },
  { name, value: String(value), domain: '.taobao.com', path: '/' },
])))

await page.goto('https://www.goofish.com/publish', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(6000)

const report = await page.evaluate(() => {
  const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ')
  const cedit = Array.from(document.querySelectorAll('[contenteditable]')).map(el => {
    const h = el
    const r = h.getBoundingClientRect()
    // 稳定的 class 指纹（去掉 hash 后缀，便于看是否改名）
    const cls = (h.className || '').toString().split(/\s+/).map(c => c.split('--')[0]).filter(Boolean)
    return {
      tag: h.tagName,
      contenteditable: h.getAttribute('contenteditable'),
      classRaw: (h.className || '').toString().slice(0, 160),
      classBase: cls.slice(0, 4),
      placeholder: h.getAttribute('data-placeholder') || h.getAttribute('placeholder') || h.getAttribute('aria-label') || '',
      visible: h.offsetParent !== null,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      textLen: (h.textContent || '').trim().length,
      innerHTMLLen: (h.innerHTML || '').length,
    }
  })
  const fileInputs = Array.from(document.querySelectorAll('input[type=file]')).map(el => ({
    name: el.getAttribute('name'), accept: el.getAttribute('accept'), multiple: el.multiple,
  }))
  const zeroInputs = Array.from(document.querySelectorAll('input[placeholder="0.00"]')).map(el => ({
    visible: el.offsetParent !== null, type: el.type,
  }))
  // 疑似编辑器容器：class 里带 editor / textarea / rich
  const editorish = Array.from(document.querySelectorAll('[class*="editor"],[class*="textarea"],[class*="rich"]'))
    .slice(0, 12)
    .map(el => ({ tag: el.tagName, classRaw: (el.className || '').toString().slice(0, 140), textLen: (el.textContent || '').trim().length }))
  return {
    url: location.href,
    title: document.title,
    loginRequired: /立即登录|登录后可以/.test(bodyText),
    blocked: /网页版暂不支持发布此分类|请使用闲鱼APP扫码|扫码去APP发布/.test(bodyText),
    bodyHead: bodyText.slice(0, 600),
    contenteditables: cedit,
    fileInputs,
    zeroInputs,
    editorish,
    uploadHintVisible: /上传图片|添加图片|发闲置/.test(bodyText),
  }
})

console.log('\n=== 页面结构 ===')
console.log(JSON.stringify(report, null, 2))

// 尝试真实键盘输入，看新选区是否被接收
console.log('\n=== 键盘输入试验 ===')
const target = report.contenteditables.find(c => c.visible) || report.contenteditables[0]
if (target) {
  const sel = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('[contenteditable]')).find(e => e.offsetParent !== null)
    if (!el) return null
    el.setAttribute('data-probe-target', '1')
    return true
  })
  if (sel) {
    await page.click('[data-probe-target="1"]')
    await sleep(500)
    const focused = await page.evaluate(() => {
      const el = document.activeElement
      return { tag: el?.tagName, cls: (el?.className || '').toString().slice(0, 100), editable: el?.getAttribute('contenteditable') }
    })
    console.log('点击后焦点:', JSON.stringify(focused))
    await page.keyboard.type('诊断测试ABC', { delay: 30 })
    await sleep(1500)
    const after = await page.evaluate(() => {
      const el = document.querySelector('[data-probe-target="1"]')
      return { textLen: (el?.textContent || '').trim().length, text: (el?.textContent || '').slice(0, 80) }
    })
    console.log('输入后:', JSON.stringify(after))
  }
} else {
  console.log('未找到任何 contenteditable 元素')
}

// 截图留证
await page.screenshot({ path: `${OUT}/xianyu-desc-probe-${Date.now()}.png`, fullPage: false })
writeFileSync(`${OUT}/xianyu-desc-probe.json`, JSON.stringify(report, null, 2), 'utf-8')
console.log('\n已写入 dev/.ui-shots/xianyu-desc-probe.json')
await browser.close()
