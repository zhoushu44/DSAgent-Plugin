/**
 * 强制发出提交：清空页面 required 校验 → 点提交 → 抓真实正式提交体。
 * 核心：请求发出瞬间立刻抓 body（页面跳转后 requestId 会失效）。
 */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir } = await import('../lib/browser-login.js')
const { localImagesToSpaceUrls } = await import('../lib/taobao-image-space.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const account = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')[0]?.shop_key
const acc = store.get(account)
const SRC = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin',
  'skills', 'pdd-link-matrix', 'assets', 'src')

const main = await localImagesToSpaceUrls(['main_06.jpg', 'main_07.jpg'].map((n) => join(SRC, n)), { cookies: acc.cookies || {} })
const det = await localImagesToSpaceUrls(['detail_10.jpg', 'detail_11.jpg'].map((n) => join(SRC, n)), { cookies: acc.cookies || {} })

const browser = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: profileDir('taobao', account),
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,950'],
  defaultViewport: null,
})
const page = (await browser.pages())[0] || (await browser.newPage())

// ★ 在请求发出瞬间抓 body（跳转后 requestId 失效）
const captured = []
const cdp = await page.target().createCDPSession()
await cdp.send('Network.enable')
cdp.on('Network.requestWillBeSent', (e) => {
  if (e.request.method !== 'POST') return
  const u = e.request.url
  if (/\.(css|js|png|jpg|woff2?|svg)/i.test(u)) return
  if (/mmstat|aplus|arms|s\.gif|\.1\.1|\.1\.2/.test(u)) return
  void (async () => {
    try {
      const pd = await cdp.send('Network.getRequestPostData', { requestId: e.requestId })
      if (pd.postData && pd.postData.length > 100) captured.push({ url: u, body: pd.postData })
    } catch { }
  })()
})

await page.setCookie(...Object.entries(acc.cookies || {}).filter(([, v]) => v !== '' && v != null)
  .flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.taobao.com', path: '/' },
    { name, value: String(value), domain: '.tmall.com', path: '/' },
  ])))

await page.goto('https://item.upload.taobao.com/sell/v2/publish.htm?catId=50013618',
  { waitUntil: 'domcontentloaded', timeout: 60000 })
for (let i = 0; i < 30; i++) { await sleep(2000); if (await page.evaluate(() => !!document.querySelector('#struct-mainImagesGroup')).catch(() => false)) break }
await sleep(4000)

// ★ 清空 required 校验（让提交能发出去）
const cleared = await page.evaluate(() => {
  let n = 0
  for (const el of Array.from(document.querySelectorAll('.required, [class*="required"]'))) {
    el.classList.remove('required'); n++
  }
  for (const el of Array.from(document.querySelectorAll('[required]'))) {
    el.removeAttribute('required'); n++
  }
  return n
})
console.log('清除 required 标记:', cleared)

// 填基础数据
await page.evaluate((mainUrls, detUrls) => {
  const fv = window.Json?.models?.formValues
  if (!fv) return
  fv.title = 'intercept 秋冬儿童休闲长裤'
  fv.price = '59.9'
  fv.quantity = '100'
  fv.mainImagesGroup = { images: mainUrls.map((u) => ({ url: u, pix: '800x800' })) }
  fv.desc = detUrls.map((u) => `<img src="${u}"/>`).join('')
  fv.catProp = {
    'p-122276111': { value: '100-140cm', text: '100-140cm' },
    'p-414028073': { value: '休闲长裤', text: '休闲长裤' },
    'p-122216207': { value: '九分裤', text: '九分裤' },
    'p-20608': { value: '3岁', text: '3岁' },
    'p-24477': { value: '男女通用', text: '男女通用' },
    'p-149422948': { value: '其他', text: '其他' },
  }
  fv.tbExtractWay = { value: ['2'], template: '65293290580' }
}, main.urls, det.urls).catch(() => { })
await sleep(2500)

// 点提交
await page.evaluate(() => {
  const b = document.querySelector('button[name="button-submit"]')
  if (b && !b.disabled) { b.scrollIntoView({ block: 'center' }); b.click(); return }
  const t = Array.from(document.querySelectorAll('button')).find((x) => /提交|发布/.test(x.innerText || '') && !x.disabled)
  if (t) t.click()
}).catch(() => { })

// 跳转/重载前多读几次
for (let i = 0; i < 6; i++) { await sleep(2500) }

mkdirSync(join('dev', '.ui-shots'), { recursive: true })
writeFileSync(join('dev', '.ui-shots', 'force-commit-bodies.json'), JSON.stringify(captured, null, 2))
console.log('\n===== 抓到出向 POST =====')
console.log('共', captured.length, '条')
for (const c of captured) {
  console.log(`--- ${c.url.slice(0, 140)}  (${c.body.length}B)`)
  console.log(c.body.slice(0, 900))
  console.log()
}
if (!captured.length) {
  console.log('没抓到。当前 URL:', page.url())
}
console.log('\n窗口保持 15s')
await sleep(15000)
await browser.close()
