/**
 * 摸清商品属性区的真实 DOM 结构（决定 required 判定与填值方式）。
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

const r = await page.evaluate(() => {
  const out = {}
  // ① catProp 根下到底有什么
  const root = document.getElementById('struct-catProp')
  out.rootPresent = !!root
  if (root) {
    out.rootChildIds = Array.from(root.querySelectorAll('[id]')).map((e) => e.id).slice(0, 40)
    out.rootHtmlLen = root.innerHTML.length
    out.textSample = (root.innerText || '').replace(/\s+/g, ' ').slice(0, 400)
  }
  // ② 「裤长」这个词出现在哪
  const hits = []
  for (const e of Array.from(document.querySelectorAll('*'))) {
    if (e.children.length === 0 && /^裤长$/.test((e.textContent || '').trim())) {
      let p = e, chain = []
      for (let i = 0; i < 5 && p; i++) {
        chain.push(`${p.tagName}${p.id ? '#' + p.id : ''}.${String(p.className || '').split(' ')[0]}`)
        p = p.parentElement
      }
      hits.push(chain.join(' < '))
    }
  }
  out.pantsLenChain = hits.slice(0, 3)
  // ③ 含「裤长」的字段容器（找最近的、带 input 的祖先）
  const labelEl = Array.from(document.querySelectorAll('*'))
    .find((e) => e.children.length === 0 && /^裤长$/.test((e.textContent || '').trim()))
  if (labelEl) {
    let box = labelEl.parentElement
    for (let i = 0; i < 6 && box; i++) {
      if (box.querySelector('input, textarea, .next-select')) break
      box = box.parentElement
    }
    out.pantsBox = box ? {
      tag: box.tagName, id: box.id, cls: String(box.className).slice(0, 90),
      hasInput: !!box.querySelector('input'),
      hasSelect: !!box.querySelector('.next-select'),
      text: (box.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
      html: box.innerHTML.slice(0, 400),
    } : null
  }
  // ④ 所有带 required 类名的元素
  out.reqEls = Array.from(document.querySelectorAll('[class*="required"], [class*="Required"]'))
    .slice(0, 12).map((e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 60), text: (e.textContent || '').trim().slice(0, 20) }))
  // ⑤ 属性区里独立的 * 元素
  const stars = Array.from(document.querySelectorAll('*'))
    .filter((e) => e.children.length === 0 && /^[*＊]$/.test((e.textContent || '').trim()))
    .slice(0, 20)
  out.stars = stars.map((e) => {
    let p = e.parentElement, name = ''
    for (let i = 0; i < 3 && p; i++) {
      const t = (p.innerText || '').replace(/[*＊\s]/g, '')
      if (t && t.length < 12) { name = t; break }
      p = p.parentElement
    }
    return { name, cls: String(e.className).slice(0, 40) }
  })
  return out
})
console.log(JSON.stringify(r, null, 1).slice(0, 4000))

await sleep(5000)
await browser.close()
