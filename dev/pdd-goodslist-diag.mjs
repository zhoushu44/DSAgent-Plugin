// 诊断：用发布侧同款方式（Profile + Cookie 注入）打开商品列表页，看落地 URL / 标题 / 正文片段
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const LIB = resolve(fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, ''), '..', 'lib')
const libImport = (rel) => import(pathToFileURL(join(LIB, rel)).href)

const filter = process.argv[2] || '3b422bc'
const { CredentialStore } = await libImport('services/credential-store.js')
const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().find(a => a.platform === 'pdd_mms' && String(a.shop_key || '').includes(filter))
if (!acc) { console.error('未找到账号'); process.exit(1) }
console.log('账号:', acc.shop_key, '状态:', acc.status, 'Cookie 数:', Object.keys(acc.cookies || {}).length)
console.log('PASS_ID 存在:', !!(acc.cookies || {}).PASS_ID)

const { profileDir } = await libImport('browser-login.js')
const dir = profileDir('pdd_mms', acc.shop_key)
console.log('Profile 目录:', dir)

const NO_INJECT = process.argv.includes('--no-inject')
const puppeteer = await import('puppeteer-core')
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: dir,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
if (!NO_INJECT) {
  const cookieList = Object.entries(acc.cookies || {})
    .filter(([, v]) => v !== '' && v != null)
    .flatMap(([name, value]) => ([
      { name, value: String(value), domain: '.pinduoduo.com', path: '/' },
      { name, value: String(value), domain: 'mms.pinduoduo.com', path: '/' },
    ]))
  await page.setCookie(...cookieList)
  console.log('已注入 Cookie 条数:', cookieList.length)
} else {
  console.log('对照模式：不注入 Cookie，纯用 Profile 自身登录态')
}
console.log('凭证库 Cookie 清单:', Object.keys(acc.cookies || {}).join(', '))

await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 45000 })
await new Promise(r => setTimeout(r, 6000))
// 顺带看未注入前 Profile 自身 Cookie 是否存活（拿 document.cookie 与最终 URL）
const info = await page.evaluate(() => ({
  url: location.href,
  title: document.title,
  bodyHead: (document.body?.innerText || '').slice(0, 800),
}))
console.log('── 落地状态 ──')
console.log('URL:', info.url)
console.log('标题:', info.title)
console.log('正文前 800 字:\n', info.bodyHead)
await browser.close()
