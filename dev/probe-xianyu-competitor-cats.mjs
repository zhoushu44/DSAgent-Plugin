/**
 * 扒竞品类目：打开高「想要数」的竞品商品页，提取它挂载的分类。
 * 这是回答「别人为什么能发」的关键证据。
 */
import puppeteer from 'puppeteer-core'
import { findChromePath, profileDir, clearProfileLocks, sleep } from '../lib/browser-login.js'
import { CredentialStore } from '../lib/services/credential-store.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT = 'dev/.ui-shots'
mkdirSync(OUT, { recursive: true })

// 来自 xianyu-crawl 的高想要数竞品（想要数越高越能说明该分类可发布且能出单）
const TARGETS = [
  { id: '1052961253244', want: 2633, kw: 'DeepSeek API', note: 'DeepSeek API密钥直供百万并发' },
  { id: '1066281638723', want: 1710, kw: 'DeepSeek API', note: 'DeepSeek-V4-Flash无限使用' },
  { id: '937827311802',  want: 1374, kw: 'DeepSeek API', note: '满血版DeepSeek-R1' },
  { id: '1076162957423', want: 751,  kw: 'OpenRouter',   note: 'OpenRouter 官方额度直充可开票' },
  { id: '990439309590',  want: 680,  kw: 'OpenRouter',   note: '五个独立OpenRouter API密钥' },
  { id: '975181877810',  want: 475,  kw: 'OpenRouter',   note: 'Open router免费Key' },
  { id: '1063968640369', want: 378,  kw: '大模型API',     note: 'MiniMax-M3超低价大模型 API' },
  { id: '1050781473609', want: 328,  kw: 'Claude API',   note: '出Anyrouter API Key令牌' },
  { id: '1071866465607', want: 167,  kw: '大模型API',     note: '国产大模型api可生图视频' },
  { id: '1003172712659', want: 152,  kw: '大模型API',     note: '火山引擎豆包大模型API' },
]

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().find(a => a.platform === 'xianyu' && a.status === 'valid')
if (!acc) { console.log('无有效闲鱼账号'); process.exit(1) }
const cookies = acc.cookies || {}
const dir = profileDir('xianyu', acc.shop_key)
clearProfileLocks(dir)

const browser = await puppeteer.launch({
  executablePath: findChromePath(), headless: false, userDataDir: dir,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })
await page.setCookie(...Object.entries(cookies).filter(([, v]) => v).flatMap(([name, value]) => ([
  { name, value: String(value), domain: '.goofish.com', path: '/' },
  { name, value: String(value), domain: '.taobao.com', path: '/' },
])))

const results = []
for (const t of TARGETS) {
  const rec = { ...t }
  try {
    // 拦截详情接口，直接拿结构化数据（类目常在其中）
    const captured = []
    const onResp = async (res) => {
      const u = res.url()
      if (/detail|item|idleitem/i.test(u) && /mtop|api/i.test(u)) {
        try { captured.push({ url: u.slice(0, 160), body: (await res.text()).slice(0, 12000) }) } catch {}
      }
    }
    page.on('response', onResp)

    await page.goto(`https://www.goofish.com/item?id=${t.id}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await sleep(7000)

    const dom = await page.evaluate(() => {
      const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
      // 常见类目展示位
      const catEls = Array.from(document.querySelectorAll('[class*=categor],[class*=Categor],[class*=breadcrumb],[class*=Breadcrumb]'))
        .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 10)
      return { url: location.href, text: t.slice(0, 2500), catEls }
    })
    page.off('response', onResp)

    // 从接口响应里挖类目字段
    const catHits = []
    for (const c of captured) {
      for (const m of c.body.matchAll(/"(?:categor\w*|catId|cat_id|categoryId|channelCat\w*|fishCat\w*|tagname)"\s*:\s*("?[^",}]{0,60}"?)/gi)) {
        catHits.push(m[0].slice(0, 120))
      }
    }
    rec.dom = { url: dom.url, catEls: dom.catEls }
    rec.apiCatHits = [...new Set(catHits)].slice(0, 25)
    rec.textSnippet = dom.text.slice(0, 700)
    console.log(`\n=== [${t.kw}] ${t.id} (想要${t.want}) ===`)
    console.log('URL:', dom.url)
    console.log('类目元素:', JSON.stringify(dom.catEls))
    console.log('接口类目字段:', JSON.stringify(rec.apiCatHits.slice(0, 12)))
  } catch (e) {
    rec.error = String(e).slice(0, 200)
    console.log(`\n=== ${t.id} 出错:`, String(e).slice(0, 150))
  }
  results.push(rec)
  await sleep(2500)
}

writeFileSync(`${OUT}/xianyu-competitor-cats.json`, JSON.stringify(results, null, 2), 'utf-8')
console.log('\n已保存 dev/.ui-shots/xianyu-competitor-cats.json')
await browser.close()
