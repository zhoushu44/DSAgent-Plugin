/**
 * 抓存活竞品的完整描述文本，对比我的描述，定位敏感词差异。
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

const RIVALS = [
  ['1052961253244', 'DeepSeek API密钥直供(2633想要)'],
  ['1076162957423', 'OpenRouter额度直充(751想要)'],
  ['990439309590', '五个独立OpenRouter密钥(680想要)'],
  ['1077970965039', 'Qwen3.8 API 1.5折(143想要)'],
  ['1071866465607', '国产大模型api(167想要)'],
  ['1003172712659', '火山引擎豆包API(152想要)'],
  ['1088372435783', 'kimik3接口不限量'],
  ['1092932856164', '智谱GLM-5.3 日卡'],
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

const out = []
for (const [id, label] of RIVALS) {
  try {
    await page.goto(`https://www.goofish.com/item?id=${id}`, { waitUntil: 'domcontentloaded', timeout: 40000 })
    await sleep(5000)
    const r = await page.evaluate(() => {
      const t = (document.body?.innerText || '')
      // 详情正文：取「展开」前后的大段文字
      const lines = t.split('\n').map(x => x.trim()).filter(Boolean)
      const i = lines.findIndex(x => /举报|担保交易/.test(x))
      return {
        deleted: /宝贝被删掉了|已下架|已被删除/.test(t.replace(/\s+/g, ' ')),
        body: lines.slice(i + 1, i + 60).join('\n').slice(0, 2500),
      }
    })
    r.id = id; r.label = label
    out.push(r)
    console.log(`\n${'='.repeat(70)}\n${r.deleted ? 'DELETED' : 'ALIVE'}  ${label}\n${'='.repeat(70)}`)
    console.log(r.body.slice(0, 1400))
  } catch (e) {
    console.log(`ERR ${label}: ${String(e).slice(0, 100)}`)
    out.push({ id, label, error: String(e).slice(0, 100) })
  }
  await sleep(1500)
}

writeFileSync(`${OUT}/xianyu-rival-desc.json`, JSON.stringify(out, null, 2), 'utf-8')
console.log('\nDONE')
await browser.close()
