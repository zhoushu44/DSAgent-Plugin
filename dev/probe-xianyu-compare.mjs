/**
 * 对比分析：我的 8 条（6删2活）与竞品的差异。
 * 重点查：类目、标题、描述措辞。
 * 只读。
 */
import puppeteer from 'puppeteer-core'
import { findChromePath, profileDir, clearProfileLocks, sleep } from '../lib/browser-login.js'
import { CredentialStore } from '../lib/services/credential-store.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT = 'dev/.ui-shots'
mkdirSync(OUT, { recursive: true })

const MINE = [
  ['1091025114388', 'DeepSeek API'],
  ['1093180064414', 'OpenRouter'],
  ['1090124195633', '大模型 API'],
  ['1091041322440', 'Claude API'],
  ['1090124699884', 'Kimi API'],
  ['1091042258008', 'GLM API'],
  ['1092123509654', 'ChatGPT API'],
  ['1090125739800', 'API 中转'],
]
// 存活竞品（同品类、高想要）
const RIVALS = [
  ['1052961253244', '竞品-DeepSeek API密钥(2633想要)'],
  ['1076162957423', '竞品-OpenRouter额度直充(751想要)'],
  ['1077970965039', '竞品-Qwen3.8 API 1.5折(143想要)'],
  ['1071866465607', '竞品-国产大模型api(167想要)'],
]

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().find(a => a.platform === 'xianyu' && a.status === 'valid')
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

// 抓详情接口里的类目
const catOf = async (id) => {
  const caps = []
  const onResp = async (res) => {
    const u = res.url()
    if (/mtop/i.test(u) && /detail|item/i.test(u)) {
      try { caps.push(await res.text()) } catch {}
    }
  }
  page.on('response', onResp)
  await page.goto(`https://www.goofish.com/item?id=${id}`, { waitUntil: 'domcontentloaded', timeout: 40000 })
  await sleep(5000)
  page.off('response', onResp)
  const info = { catId: null, channelCatId: null, level2: null, level3: null, deleted: false, title: null }
  for (const b of caps) {
    for (const m of b.matchAll(/"itemCatDTO":\{([^}]+)\}/g)) {
      const s = m[1]
      const g = (k) => (s.match(new RegExp(`"${k}":(\\d+)`)) || [])[1]
      info.catId = g('catId'); info.channelCatId = g('channelCatId')
      info.level2 = g('level2ChannelCatId'); info.level3 = g('level3ChannelCatId')
    }
    const t = b.match(/"title":"([^"]{5,120})"/)
    if (t && !info.title) info.title = t[1]
  }
  const dom = await page.evaluate(() => {
    const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
    return {
      deleted: /宝贝被删掉了|已下架|已被删除|不存在或已下架/.test(t),
      categoryLine: (t.match(/分类[:：]?\s*([^\s]{2,20})/) || [''])[0],
    }
  })
  Object.assign(info, dom)
  return info
}

const out = { mine: [], rivals: [] }
console.log('=== 我的 8 条 ===')
for (const [id, kw] of MINE) {
  const r = await catOf(id)
  r.id = id; r.kw = kw
  console.log(`${r.deleted ? 'DELETED' : 'ALIVE  '}  ${kw.padEnd(14)} catId=${r.catId} channel=${r.channelCatId} level3=${r.level3}`)
  out.mine.push(r)
  await sleep(1200)
}
console.log('\n=== 竞品 ===')
for (const [id, kw] of RIVALS) {
  const r = await catOf(id)
  r.id = id; r.kw = kw
  console.log(`${r.deleted ? 'DELETED' : 'ALIVE  '}  ${kw.padEnd(30)} catId=${r.catId} channel=${r.channelCatId} level3=${r.level3}`)
  out.rivals.push(r)
  await sleep(1200)
}

writeFileSync(`${OUT}/xianyu-compare.json`, JSON.stringify(out, null, 2), 'utf-8')
console.log('\nDONE')
await browser.close()
