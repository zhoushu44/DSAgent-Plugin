/**
 * 专项：把「图文描述」tab 点开，直到 #panel_edit 挂载。
 * 尝试多种点法，打印每种的结果，找出真正有效的那个。
 *
 * 用法：node dev/try-open-desc-tab.mjs
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
await sleep(2000)

const mounted = () => page.evaluate(() => {
  const ed = document.querySelector('#lite-decoration-editor')
  return !!(ed && ed.querySelector('#panel_edit'))
})
const edInfo = () => page.evaluate(() => {
  const ed = document.querySelector('#lite-decoration-editor')
  if (!ed) return null
  return { h: Math.round(ed.getBoundingClientRect().height), kids: ed.children.length, panel: !!ed.querySelector('#panel_edit') }
})
console.log('初始 mounted =', await mounted(), 'ed =', JSON.stringify(await edInfo()))

// ---- 找候选元素并打印 ----
const cands = await page.evaluate(() => {
  const vis = (e) => e && e.offsetParent !== null
  const out = []
  for (const e of Array.from(document.querySelectorAll('*'))) {
    if (!vis(e)) continue
    const t = (e.textContent || '').replace(/\s+/g, '')
    if (t === '图文描述') {
      const r = e.getBoundingClientRect()
      out.push({ exact: true, tag: e.tagName, cls: String(e.className).slice(0, 50), h: Math.round(r.height), w: Math.round(r.width), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) })
    }
  }
  if (!out.length) {
    // 片段命中，取最小
    const list = Array.from(document.querySelectorAll('*'))
      .filter((e) => vis(e) && /图文描述/.test(e.textContent || ''))
      .map((e) => { const r = e.getBoundingClientRect(); return { el: e, h: r.height, w: r.width, r } })
      .filter((o) => o.h > 10 && o.h < 120 && o.w > 20)
      .sort((a, b) => a.h * a.w - b.h * b.w)
    if (list[0]) {
      const { el, r } = list[0]
      out.push({ exact: false, tag: el.tagName, cls: String(el.className).slice(0, 50), h: Math.round(r.height), w: Math.round(r.width), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) })
    }
  }
  return out
})
console.log('候选:', JSON.stringify(cands))

// ---- 方法 A：元素 .click() ----
for (const c of cands) {
  await page.evaluate((sel) => {
    const vis = (e) => e && e.offsetParent !== null
    const list = Array.from(document.querySelectorAll('*'))
      .filter((e) => vis(e) && /图文描述/.test(e.textContent || ''))
      .map((e) => { const r = e.getBoundingClientRect(); return { el: e, h: r.height, w: r.width } })
      .filter((o) => o.h > 10 && o.h < 120 && o.w > 20)
      .sort((a, b) => a.h * a.w - b.h * b.w)
    if (list[0]) list[0].el.click()
  }, c.cls).catch(() => { })
  await sleep(2500)
  console.log('A(.click) ->', await mounted(), JSON.stringify(await edInfo()))
  if (await mounted()) break
}

// ---- 方法 B：真实鼠标点击 ----
if (!(await mounted()) && cands[0]) {
  const { x, y } = cands[0]
  await page.mouse.move(x, y)
  await sleep(300)
  await page.mouse.click(x, y)
  await sleep(3000)
  console.log('B(mouse) ->', await mounted(), JSON.stringify(await edInfo()))
}

// ---- 方法 C：滚到底再点 ----
if (!(await mounted())) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await sleep(1500)
  const pos = await page.evaluate(() => {
    const vis = (e) => e && e.offsetParent !== null
    const list = Array.from(document.querySelectorAll('*'))
      .filter((e) => vis(e) && /图文描述/.test(e.textContent || ''))
      .map((e) => { const r = e.getBoundingClientRect(); return { el: e, h: r.height, w: r.width, r } })
      .filter((o) => o.h > 10 && o.h < 120 && o.w > 20)
      .sort((a, b) => a.h * a.w - b.h * b.w)
    if (!list[0]) return null
    const r = list[0].r
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  if (pos) {
    await page.mouse.click(pos.x, pos.y)
    await sleep(3000)
    console.log('C(scroll+mouse) ->', await mounted(), JSON.stringify(await edInfo()))
  }
}

// ---- 最终：dump 详情区状态 ----
const fin = await page.evaluate(() => {
  const ed = document.querySelector('#lite-decoration-editor')
  const vis = (e) => e && e.offsetParent !== null
  const addItems = Array.from(document.querySelectorAll('*'))
    .filter((e) => vis(e) && /add_item/i.test(String(e.className)))
    .map((e) => (e.textContent || '').trim())
  return {
    edHeight: ed ? Math.round(ed.getBoundingClientRect().height) : -1,
    panel: ed ? !!ed.querySelector('#panel_edit') : false,
    addItems,
    hasAddTitle: Array.from(document.querySelectorAll('*')).some((e) => /add_title/i.test(String(e.className))),
  }
})
console.log('最终:', JSON.stringify(fin))
console.log('\n窗口保持 20s')
await sleep(20000)
await browser.close()
