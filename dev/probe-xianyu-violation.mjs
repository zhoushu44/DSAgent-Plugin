/**
 * 查违规原因：打开闲鱼「我发布的」与违规记录页，抓取下架原因。
 * 只读，不做任何写操作。
 */
import puppeteer from 'puppeteer-core'
import { findChromePath, profileDir, clearProfileLocks, sleep } from '../lib/browser-login.js'
import { CredentialStore } from '../lib/services/credential-store.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT = 'dev/.ui-shots'
mkdirSync(OUT, { recursive: true })

const MY_ITEMS = [
  '1091025114388', // DeepSeek API
  '1093180064414', // OpenRouter
  '1090124195633', // 大模型 API
  '1091041322440', // Claude API
  '1090124699884', // Kimi API
  '1091042258008', // GLM API
  '1092123509654', // ChatGPT API
  '1090125739800', // API 中转
]

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().find(a => a.platform === 'xianyu' && a.status === 'valid')
if (!acc) { console.log('无有效闲鱼账号'); process.exit(1) }
const cookies = acc.cookies || {}
const dir = profileDir('xianyu', acc.shop_key)
clearProfileLocks(dir)

const browser = await puppeteer.launch({
  executablePath: findChromePath(), headless: false, userDataDir: dir, protocolTimeout: 600000,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })
await page.setCookie(...Object.entries(cookies).filter(([, v]) => v).flatMap(([name, value]) => ([
  { name, value: String(value), domain: '.goofish.com', path: '/' },
  { name, value: String(value), domain: '.taobao.com', path: '/' },
])))

const log = {}

// ── 1) 逐条查商品页状态 ──
console.log('='.repeat(70))
console.log('逐条商品状态')
console.log('='.repeat(70))
const itemStates = []
for (const id of MY_ITEMS) {
  const rec = { id }
  try {
    await page.goto(`https://www.goofish.com/item?id=${id}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await sleep(4500)
    const st = await page.evaluate(() => {
      const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
      return {
        url: location.href,
        text: t.slice(0, 900),
        removed: /已下架|已被删除|商品不存在|不存在或已下架|违规|无法查看|已被移除/.test(t),
        // 抓具体提示
        hints: (t.match(/(已下架|已被删除|商品不存在|不存在或已下架|违规|已被移除|处置)[^。]{0,80}/g) || []).slice(0, 4),
      }
    })
    rec.status = st.removed ? '下架/删除' : '在线'
    rec.hints = st.hints
    rec.text = st.text.slice(0, 300)
    console.log(`\n[${id}] ${rec.status}`)
    if (st.hints.length) console.log('  提示:', JSON.stringify(st.hints))
    console.log('  页面:', st.text.slice(0, 200))
  } catch (e) {
    rec.error = String(e).slice(0, 150)
    console.log(`\n[${id}] 出错: ${rec.error}`)
  }
  itemStates.push(rec)
  await sleep(1500)
}
log.itemStates = itemStates

// ── 2) 查违规记录页 ──
console.log('\n' + '='.repeat(70))
console.log('违规记录页')
console.log('='.repeat(70))
const VIOLATION_URLS = [
  'https://www.goofish.com/im/violation',
  'https://www.goofish.com/violation',
  'https://www.goofish.com/personal?tab=violation',
  'https://www.goofish.com/my/violation',
  'https://www.goofish.com/seller/violation',
]
const viol = []
for (const u of VIOLATION_URLS) {
  try {
    await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 40000 })
    await sleep(4000)
    const r = await page.evaluate(() => {
      const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
      return { url: location.href, text: t.slice(0, 1500) }
    })
    console.log(`\n${u}\n  → ${r.url}\n  ${r.text.slice(0, 300)}`)
    viol.push(r)
  } catch (e) {
    console.log(`\n${u} → 出错 ${String(e).slice(0, 100)}`)
  }
}
log.violation = viol

// ── 3) 「我发布的」列表 ──
console.log('\n' + '='.repeat(70))
console.log('我发布的列表')
console.log('='.repeat(70))
for (const u of ['https://www.goofish.com/my/item', 'https://www.goofish.com/personal?tab=sold']) {
  try {
    await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 40000 })
    await sleep(5000)
    const r = await page.evaluate(() => {
      const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
      return { url: location.href, text: t.slice(0, 2000) }
    })
    console.log(`\n${u}\n  → ${r.url}\n  ${r.text.slice(0, 600)}`)
    log[`list_${u}`] = r
  } catch (e) { console.log(`${u} → ${String(e).slice(0, 100)}`) }
}

writeFileSync(`${OUT}/xianyu-violation-check.json`, JSON.stringify(log, null, 2), 'utf-8')
console.log('\n已保存 dev/.ui-shots/xianyu-violation-check.json')
await browser.close()
