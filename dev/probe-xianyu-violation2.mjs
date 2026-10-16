/**
 * 查违规原因（证据优先）：
 *   1) 逐条判定存活/删除
 *   2) 抓「我发布的」列表接口原始 JSON（可能含下架原因字段）
 *   3) 打开消息中心，找系统通知/违规通知
 *   4) 检查账号是否被限制发布
 * 只读。结果写 JSON（避免控制台中文乱码）。
 */
import puppeteer from 'puppeteer-core'
import { findChromePath, profileDir, clearProfileLocks, sleep } from '../lib/browser-login.js'
import { CredentialStore } from '../lib/services/credential-store.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT = 'dev/.ui-shots'
mkdirSync(OUT, { recursive: true })

const MY = [
  ['1091025114388', 'DeepSeek API'],
  ['1093180064414', 'OpenRouter'],
  ['1090124195633', '大模型 API'],
  ['1091041322440', 'Claude API'],
  ['1090124699884', 'Kimi API'],
  ['1091042258008', 'GLM API'],
  ['1092123509654', 'ChatGPT API'],
  ['1090125739800', 'API 中转'],
]

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().find(a => a.platform === 'xianyu' && a.status === 'valid')
if (!acc) { console.log('NO_ACCOUNT'); process.exit(1) }
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

const apiBodies = []
page.on('response', async (res) => {
  const u = res.url()
  const m = u.match(/mtop\.[a-z0-9._]+/i)
  if (!m) return
  if (!/item|violation|notice|message|im\.|xyh/i.test(m[0])) return
  try { apiBodies.push({ api: m[0], body: (await res.text()).slice(0, 60000) }) } catch {}
})

const result = { items: [], apis: [], im: null, publishCheck: null }

// ── 1) 逐条判定 ──
console.log('STEP1 item status')
for (const [id, kw] of MY) {
  const rec = { id, kw }
  try {
    await page.goto(`https://www.goofish.com/item?id=${id}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await sleep(4000)
    const st = await page.evaluate(() => {
      const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
      const deleted = /宝贝被删掉了|已下架|已被删除|商品不存在|不存在或已下架|已被移除/.test(t)
      const mine = /tbNick_f1lhy/.test(t)
      return { deleted, mine, head: t.slice(0, 400) }
    })
    rec.alive = !st.deleted
    rec.head = st.head.slice(0, 250)
    console.log(`  ${id} ${rec.alive ? 'ALIVE' : 'DELETED'}`)
  } catch (e) { rec.error = String(e).slice(0, 120); console.log(`  ${id} ERR`) }
  result.items.push(rec)
  await sleep(1200)
}

// ── 2) 我发布的列表接口原始 JSON ──
console.log('STEP2 item list api')
apiBodies.length = 0
try {
  await page.goto('https://www.goofish.com/personal', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(7000)
  result.apis = apiBodies.map(a => ({ api: a.api, body: a.body }))
  console.log(`  captured ${result.apis.length} apis`)
} catch (e) { console.log('  ERR', String(e).slice(0, 100)) }

// ── 3) 消息中心 ──
console.log('STEP3 im center')
apiBodies.length = 0
try {
  await page.goto('https://www.goofish.com/im', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(8000)
  const im = await page.evaluate(() => {
    const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
    const convs = Array.from(document.querySelectorAll('[class*=conversation],[class*=session],[class*=chat-item],[class*=contact]'))
      .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 40)
    return { url: location.href, text: t.slice(0, 2500), convs }
  })
  result.im = im
  result.imApis = apiBodies.map(a => ({ api: a.api, body: a.body.slice(0, 30000) }))
  console.log('  im captured')
  // 尝试点系统通知
  const clicked = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('div,span,li,a'))
    const hit = all.find(e => /系统通知|闲鱼官方|违规|通知/.test((e.innerText || '').trim()) && (e.innerText || '').trim().length < 30)
    if (hit) { hit.click(); return (hit.innerText || '').trim() }
    return null
  })
  if (clicked) {
    console.log('  clicked:', Buffer.from(clicked).toString('hex').slice(0, 40))
    await sleep(6000)
    const detail = await page.evaluate(() => {
      const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
      return t.slice(0, 3000)
    })
    result.imDetail = detail
  }
} catch (e) { console.log('  ERR', String(e).slice(0, 100)) }

// ── 4) 发布页是否被限制 ──
console.log('STEP4 publish restriction')
try {
  await page.goto('https://www.goofish.com/publish', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(7000)
  const pc = await page.evaluate(() => {
    const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
    return {
      restricted: /限制发布|暂不能发布|发布权限|被封禁|禁止发布|违规处罚|账号异常/.test(t),
      text: t.slice(0, 1200),
    }
  })
  result.publishCheck = pc
  console.log('  restricted:', pc.restricted)
} catch (e) { console.log('  ERR', String(e).slice(0, 100)) }

writeFileSync(`${OUT}/xianyu-violation-evidence.json`, JSON.stringify(result, null, 2), 'utf-8')
console.log('DONE saved')
await browser.close()
