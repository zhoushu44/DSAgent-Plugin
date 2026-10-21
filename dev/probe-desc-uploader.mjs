/**
 * 找详情编辑器的真实上传入口（照觅千手：往页面上传器塞文件，不自己调接口）。
 * 打开 tab → 在 #lite-decoration-editor 里找「添加」/图片按钮/file input → 记录结构。
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
const dir = profileDir('taobao', account)

const browser = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: dir,
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

// 点开 tab
for (let i = 0; i < 6; i++) {
  const r = await page.evaluate(() => {
    const vis = (e) => e && e.offsetParent !== null
    const ed = document.querySelector('#lite-decoration-editor')
    if (ed && ed.children.length > 0 && ed.getBoundingClientRect().height > 100) return { mounted: true }
    const hit = Array.from(document.querySelectorAll('*'))
      .find((e) => vis(e) && (e.textContent || '').trim() === '图文描述' && e.children.length === 0)
    if (hit) { hit.scrollIntoView({ block: 'center' }); hit.click(); return { clicked: true } }
    return {}
  }).catch(() => ({}))
  if (r.mounted) break
  await sleep(2500)
}
await sleep(2000)

const info = await page.evaluate(() => {
  const ed = document.querySelector('#lite-decoration-editor')
  const out = { edPresent: !!ed, edges: [] }
  if (!ed) return out
  // 编辑器内的按钮/可点元素
  const clickables = Array.from(ed.querySelectorAll('button, [role=button], [class*="btn"], [class*="add"], [class*="Add"]'))
  out.clickables = clickables.slice(0, 25).map((e) => ({
    tag: e.tagName,
    cls: (e.className || '').toString().slice(0, 60),
    text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
    vis: !!e.offsetParent,
  }))
  // 编辑器内的 file input
  out.fileInputs = Array.from(ed.querySelectorAll('input[type=file]')).map((i, n) => ({ n, accept: i.accept }))
  // 全页 file inputs
  out.allFileInputs = Array.from(document.querySelectorAll('input[type=file]')).length
  // 编辑器内的关键容器 id/cls
  out.innerIds = Array.from(ed.querySelectorAll('[id]')).map((e) => e.id).slice(0, 20)
  out.innerCls = Array.from(new Set(Array.from(ed.querySelectorAll('[class]')).map((e) => (e.className || '').toString().split(' ')[0]))).slice(0, 25)
  // 「添加」文本元素
  out.addTexts = Array.from(ed.querySelectorAll('*'))
    .filter((e) => e.children.length === 0 && /^(添加|上传图片|图片)$/.test((e.textContent || '').trim()) && e.offsetParent)
    .slice(0, 10).map((e) => ({ tag: e.tagName, text: e.textContent.trim(), cls: (e.className || '').toString().slice(0, 50) }))
  return out
})
console.log(JSON.stringify(info, null, 1))

console.log('\n窗口保持 15s')
await sleep(15000)
await browser.close()
