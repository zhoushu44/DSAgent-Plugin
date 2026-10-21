/**
 * 深挖详情编辑器结构：lite-decoration-editor 里面到底是什么，图渲染在哪个节点。
 * 并尝试直接给 formValues.descRepublicOfSell 写入带 templateContent 的值后观察。
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
await sleep(3000)

// 滚到「图文描述」tab 并点开
const tabClicked = await page.evaluate(() => {
  const vis = (e) => e && e.offsetParent !== null
  const tabs = Array.from(document.querySelectorAll('*')).filter((e) => vis(e) && (e.textContent || '').trim() === '图文描述' && e.children.length === 0)
  if (tabs[0]) { tabs[0].click(); return 'clicked' }
  return 'notfound'
})
console.log('图文描述 tab:', tabClicked)
await sleep(3000)

const snap = await page.evaluate(() => {
  const ed = document.querySelector('#lite-decoration-editor')
  const wrap = ed ? ed.closest('[class*="desc"], [id*="desc"]') : null
  const fv = window.Json?.models?.formValues || {}
  return {
    editorHtml: ed ? ed.innerHTML.slice(0, 600) : null,
    editorChildCount: ed ? ed.children.length : -1,
    editorRect: ed ? (({ width, height }) => ({ width, height }))(ed.getBoundingClientRect()) : null,
    wrapperId: wrap?.id, wrapperCls: (wrap?.className || '').toString().slice(0, 80),
    // 找所有含「详情」文案的可点区域
    descAreas: Array.from(document.querySelectorAll('[id*="desc"], [class*="desc"]')).slice(0, 12)
      .map((e) => ({ id: e.id, cls: (e.className || '').toString().slice(0, 60), imgs: e.querySelectorAll('img').length, hidden: e.classList.contains('hidden') })),
    fvDesc: String(fv.desc || '').slice(0, 100),
    fvDescRep: JSON.stringify(fv.descRepublicOfSell)?.slice(0, 200),
    fvDescType: fv.descType,
    fvNewDescVersion: fv.newDescVersion,
  }
})
console.log('\n=== 详情编辑器快照 ===')
console.log(JSON.stringify(snap, null, 1))

// 实验：直接写 descRepublicOfSell.templateContent + desc
const url = 'https://img.alicdn.com/imgextra/i4/2218891961201/O1CN01VNoZC41OTtI1bRyY_!!2218891961201.jpg'
const r = await page.evaluate((u) => {
  const fv = window.Json?.models?.formValues
  if (!fv) return 'no fv'
  const html = `<p><img src="${u}" /></p>`
  fv.desc = html
  fv.descType = '1'
  fv.descRepublicOfSell = {
    descPageCommitParam: { templateContent: html, opt: 0, clientType: 1, bizSource: 'sell', newItem: true, changed: true, params: 'params' },
  }
  const c = window.Json.components
  if (c?.desc?.props) c.desc.props.value = html
  if (c?.descRepublicOfSell?.props) c.descRepublicOfSell.props.value = fv.descRepublicOfSell
  return 'written'
}, url)
console.log('\n写入结果:', r)
await sleep(4000)

const after = await page.evaluate(() => {
  const ed = document.querySelector('#lite-decoration-editor')
  const all = Array.from(document.querySelectorAll('[id*="desc"]')).map((e) => ({ id: e.id, imgs: e.querySelectorAll('img').length }))
  return {
    editorImgs: ed ? ed.querySelectorAll('img').length : -1,
    editorHtml: ed ? ed.innerHTML.slice(0, 400) : null,
    descNodes: all,
    bodyHasUrl: (document.body.innerHTML || '').includes('O1CN01VNoZC41OTtI1bRyY'),
  }
})
console.log('\n=== 写入后 ===')
console.log(JSON.stringify(after, null, 1))

console.log('\n窗口保持 15s（可人工观察）')
await sleep(15000)
await browser.close()
