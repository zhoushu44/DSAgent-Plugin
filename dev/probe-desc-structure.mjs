/**
 * 抓「详情图在 formValues.desc 里的真实结构」。
 *
 * 做法：打开发布页 → 用页面自己的详情编辑器上传一张图（走 DOM，慢但真实）
 *      → dump formValues.desc / descQueryContent / components.desc.props.value
 * 目的：拿到正确结构后，就能用纯 URL 注入复刻（不依赖 DOM 上传）。
 *
 * 用法：node dev/probe-desc-structure.mjs [--cat=50013618]
 */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'

const argOf = (n) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir } = await import('../lib/browser-login.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
let account = argOf('account')
if (!account) account = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')[0]?.shop_key
const acc = store.get(account)
const catId = argOf('cat') || '50013618'

const SRC = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin',
  'skills', 'pdd-link-matrix', 'assets', 'src')
const IMG = join(SRC, 'detail_10.jpg')

const dir = profileDir('taobao', account)
const browser = await puppeteer.launch({
  headless: false,
  executablePath: findChromePath(),
  userDataDir: dir,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
  defaultViewport: null,
})
const page = (await browser.pages())[0] || (await browser.newPage())
const cookieList = Object.entries(acc.cookies || {})
  .filter(([, v]) => v !== '' && v != null)
  .flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.taobao.com', path: '/' },
    { name, value: String(value), domain: '.tmall.com', path: '/' },
  ]))
await page.setCookie(...cookieList)

// 抓页面自己发出的 upload / desc 相关请求与响应
const cdp = await page.target().createCDPSession()
await cdp.send('Network.enable')
const netlog = []
cdp.on('Network.requestWillBeSent', (e) => {
  if (/desc|upload|template|pic/i.test(e.request.url) && !/\.(css|woff2?|svg)/i.test(e.request.url)) {
    netlog.push({ phase: 'req', method: e.request.method, url: e.request.url.slice(0, 220), post: (e.request.postData || '').slice(0, 500) })
  }
})
cdp.on('Network.responseReceived', (e) => {
  if (/desc.*?(save|commit|render)|upload\.api/i.test(e.response.url)) {
    netlog.push({ phase: 'res', status: e.response.status, url: e.response.url.slice(0, 200) })
  }
})

await page.goto(`https://item.upload.taobao.com/sell/v2/publish.htm?catId=${catId}`,
  { waitUntil: 'domcontentloaded', timeout: 60000 })
console.log('URL:', page.url().slice(0, 100))

// 等表单
for (let i = 0; i < 30; i++) {
  await sleep(2000)
  const ok = await page.evaluate(() => !!document.querySelector('#struct-mainImagesGroup, button[name="button-submit"]')).catch(() => false)
  if (ok) { console.log('表单就绪', i); break }
}
await sleep(2000)

// dump 详情区现状
const before = await page.evaluate(() => {
  const fv = window.Json?.models?.formValues || {}
  return { desc: fv.desc, descType: fv.descType, hasEditor: !!document.querySelector('#lite-decoration-editor') }
})
console.log('上传前 desc =', JSON.stringify(before))

// 滚到详情区
await page.evaluate(() => {
  const el = document.querySelector('#struct-descRepublicOfSell, #struct-desc, [id*="descRepublicOfSell"]')
  if (el) el.scrollIntoView({ block: 'center' })
})
await sleep(1500)

// 找详情编辑器区域，试「添加」按钮
const clicked = await page.evaluate(() => {
  const txt = (e) => (e.textContent || '').replace(/\s+/g, '')
  const vis = (e) => e && e.offsetParent !== null
  const btns = Array.from(document.querySelectorAll('button,div,span,a'))
  const add = btns.find((e) => txt(e) === '添加' && vis(e) && e.children.length === 0)
  if (add) { add.click(); return 'add' }
  return 'no-add'
})
console.log('详情区点击:', clicked)
await sleep(1200)

// 点「图片」
const clicked2 = await page.evaluate(() => {
  const txt = (e) => (e.textContent || '').replace(/\s+/g, '')
  const vis = (e) => e && e.offsetParent !== null
  const items = Array.from(document.querySelectorAll('div,span,button,li,a'))
  const imgBtn = items.find((e) => txt(e) === '图片' && vis(e) && e.children.length <= 1)
  if (imgBtn) { imgBtn.click(); return 'img' }
  return 'no-img'
})
console.log('图片菜单:', clicked2)
await sleep(2500)

// 找 file input 传图
const inputs = await page.evaluate(() =>
  Array.from(document.querySelectorAll('input[type=file]')).map((i, n) => ({ n, accept: i.accept })))
console.log('file inputs:', JSON.stringify(inputs))
const handles = await page.$$('input[type=file]')
if (handles.length) {
  try {
    await handles[handles.length - 1].uploadFile(IMG)
    console.log('已投递详情图:', IMG)
  } catch (e) { console.log('uploadFile err', e.message) }
} else {
  console.log('⚠ 没有 file input，可能弹的是素材选择层')
}
await sleep(12000)

// dump 上传后的详情结构
const after = await page.evaluate(() => {
  const J = window.Json || {}
  const fv = J.models?.formValues || {}
  const d = J.components?.desc
  return {
    desc: typeof fv.desc === 'string' ? fv.desc.slice(0, 1500) : fv.desc,
    descType: fv.descType,
    descQueryContent: JSON.stringify(J.models?.descQueryContent)?.slice(0, 800),
    compDescValue: typeof d?.props?.value === 'string' ? d.props.value.slice(0, 1500) : JSON.stringify(d?.props?.value)?.slice(0, 800),
    wirelessDesc: JSON.stringify(fv.wirelessDesc)?.slice(0, 500),
    editorImgs: Array.from(document.querySelectorAll('#lite-decoration-editor img, [id*="desc"] img')).map((i) => i.src).slice(0, 5),
  }
})
mkdirSync(join('dev', '.ui-shots'), { recursive: true })
writeFileSync(join('dev', '.ui-shots', 'desc-structure.json'), JSON.stringify({ before, after, netlog }, null, 2))
console.log('\n===== 上传后 =====')
console.log('descType =', JSON.stringify(after.descType))
console.log('desc      =', String(after.desc).slice(0, 900))
console.log('compDesc  =', String(after.compDescValue).slice(0, 500))
console.log('wireless  =', after.wirelessDesc)
console.log('editor img=', JSON.stringify(after.editorImgs))
console.log('\nnetlog 条数', netlog.length)
for (const n of netlog.slice(0, 15)) console.log(' ', n.phase, n.method || n.status, n.url)
writeFileSync(join('dev', '.ui-shots', 'desc-netlog.json'), JSON.stringify(netlog, null, 2))

console.log('\n窗口保持打开 20s')
await sleep(20000)
await browser.close()
