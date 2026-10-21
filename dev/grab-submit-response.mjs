/**
 * 抓 previewDraftSubmit 的真实响应（Network 域，不是 Fetch 域），看它是预览还是发布。
 */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir } = await import('../lib/browser-login.js')
const { localImagesToSpaceUrls } = await import('../lib/taobao-image-space.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const account = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')[0]?.shop_key
const acc = store.get(account)
const SRC = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin',
  'skills', 'pdd-link-matrix', 'assets', 'src')
const main = await localImagesToSpaceUrls(['main_06.jpg'].map((n) => join(SRC, n)), { cookies: acc.cookies || {} })

const browser = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: profileDir('taobao', account),
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,950'],
  defaultViewport: null,
})
const page = (await browser.pages())[0] || (await browser.newPage())

// Network 域抓响应
const cdp = await page.target().createCDPSession()
await cdp.send('Network.enable')
const responses = []
const reqMap = new Map()
cdp.on('Network.requestWillBeSent', (e) => {
  if (/previewDraftSubmit|submit|publish/i.test(e.request.url) && !/asyncOpt|mmstat/.test(e.request.url)) {
    reqMap.set(e.requestId, { url: e.request.url, post: e.request.postData || '' })
  }
})
cdp.on('Network.loadingFinished', async (e) => {
  if (!reqMap.has(e.requestId)) return
  try {
    const b = await cdp.send('Network.getResponseBody', { requestId: e.requestId })
    const text = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body
    responses.push({ url: reqMap.get(e.requestId).url, status: '?', body: text.slice(0, 2000) })
  } catch (e) { }
})

await page.setCookie(...Object.entries(acc.cookies || {}).filter(([, v]) => v !== '' && v != null)
  .flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.taobao.com', path: '/' },
    { name, value: String(value), domain: '.tmall.com', path: '/' },
  ])))
await page.goto('https://item.upload.taobao.com/sell/v2/publish.htm?catId=50013618',
  { waitUntil: 'domcontentloaded', timeout: 60000 })
for (let i = 0; i < 30; i++) { await sleep(2000); if (await page.evaluate(() => !!document.querySelector('#struct-mainImagesGroup')).catch(() => false)) break }
await sleep(3000)

// 填数据 + 清校验 + 点提交
await page.evaluate((mainUrls) => {
  const fv = window.Json?.models?.formValues
  if (!fv) return
  fv.title = '探针 秋冬儿童休闲长裤'
  fv.price = '59.9'
  fv.quantity = '100'
  fv.mainImagesGroup = { images: mainUrls.map((u) => ({ url: u, pix: '800x800' })) }
  fv.tbExtractWay = { value: ['2'], template: '65293290580' }
  for (const el of Array.from(document.querySelectorAll('.required, [class*="required"]'))) el.classList.remove('required')
  for (const el of Array.from(document.querySelectorAll('[required]'))) el.removeAttribute('required')
}, main.urls).catch(() => { })
await sleep(1500)
await page.evaluate(() => {
  const b = document.querySelector('button[name="button-submit"]')
  if (b && !b.disabled) { b.scrollIntoView({ block: 'center' }); b.click(); return }
  const t = Array.from(document.querySelectorAll('button')).find((x) => /提交|发布/.test(x.innerText || '') && !x.disabled)
  if (t) t.click()
}).catch(() => { })

await sleep(15000)
console.log('===== 抓到的提交响应 =====')
console.log('条数:', responses.length)
for (const r of responses) {
  console.log('---', r.url.slice(0, 120))
  console.log(r.body)
}
if (!responses.length) console.log('（没抓到响应）')
console.log('\n窗口保持 12s')
await sleep(12000)
await browser.close()
