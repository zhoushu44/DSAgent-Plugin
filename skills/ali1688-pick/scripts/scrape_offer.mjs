// 用已登录的持久化 Chrome Profile 打开 1688 商品详情页，导出页面数据对象。
// 由 run.py 调用：node scrape_offer.mjs <offerId> <outDir> [profileDir]
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'

const require = createRequire(import.meta.url)     // 技能在插件目录内 → 能解析插件的 node_modules
const puppeteer = require('puppeteer-core')

const offerId = process.argv[2]
const outDir = process.argv[3]
const headless = process.env.HEADLESS === '1'

if (!offerId || !outDir) { console.error('usage: scrape_offer.mjs <offerId> <outDir> [profile]'); process.exit(2) }
fs.mkdirSync(outDir, { recursive: true })

// Profile 发现：显式传参 > ~/.dsh/browser-profiles/ 下最新 alibaba* 目录（重绑账号后目录名会变，不能硬编码）
function discoverProfile() {
  const root = path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'browser-profiles')
  let dirs = []
  try {
    dirs = fs.readdirSync(root)
      .filter(n => /^alibaba/i.test(n))
      .map(n => {
        const p = path.join(root, n)
        try { return { p, mtime: fs.statSync(p).mtimeMs } } catch { return null }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
  } catch { /* 目录不存在 */ }
  return dirs.length ? dirs[0].p : null
}
const profile = process.argv[4] || discoverProfile()
if (!profile) {
  console.log(JSON.stringify({ ok: false, failure_kind: 'not_bound', message: '未找到 1688 登录 profile（~/.dsh/browser-profiles/alibaba*），请先绑定阿里账号' }))
  process.exit(1)
}

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
]
const chrome = CHROME_CANDIDATES.find(p => p && fs.existsSync(p))
if (!chrome) { console.log(JSON.stringify({ ok: false, failure_kind: 'skill_error', message: '未找到 Chrome' })); process.exit(1) }

const result = { ok: false, offerId, contextPath: null, globals: [], title: null }

let browser
try {
  browser = await puppeteer.launch({
    executablePath: chrome, userDataDir: profile, headless,
    defaultViewport: { width: 1500, height: 950 },
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                          '(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36')
  await page.goto(`https://detail.1688.com/offer/${offerId}.html`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await new Promise(r => setTimeout(r, 8000))

  result.title = await page.title()
  result.url = page.url()

  const names = ['context', '__INIT_DATA__', '__GLOBAL_DATA__', 'iData']
  for (const n of names) {
    try {
      const json = await page.evaluate(name => (window[name] ? JSON.stringify(window[name]) : null), n)
      if (json && json.length > 100) {
        fs.writeFileSync(path.join(outDir, `${n.replace(/[^\w]/g, '')}.json`), json, 'utf8')
        result.globals.push({ name: n, bytes: json.length })
        if (n === 'context') { result.contextPath = path.join(outDir, 'context.json'); result.ok = true }
      }
    } catch { /* 忽略 */ }
  }
  if (!result.ok && result.globals.length) { result.ok = true; result.contextPath = path.join(outDir, `${result.globals[0].name.replace(/[^\w]/g, '')}.json`) }
  if (!result.ok) { result.failure_kind = 'parse_error'; result.message = `未取到页面数据对象（页面标题：${result.title}）` }
} catch (e) {
  result.failure_kind = 'skill_error'
  result.message = e.message
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
}

console.log(JSON.stringify(result))
process.exit(result.ok ? 0 : 1)
