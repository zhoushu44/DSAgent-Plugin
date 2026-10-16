/**
 * 竞品存活研究：检查一批 AI/API 类竞品链接的存活状态，
 * 找出「什么样的写法能活」。
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

// 来自「为你推荐」的 AI/API 类竞品
const CANDIDATES = [
  ['1092817996821', 'workbuddy自动签到'],
  ['1092932856164', '智谱GLM-5.3 不限词元 日卡'],
  ['1092690132342', 'Harness 安装与基础配置'],
  ['1088278315813', 'Coze积分额度代购分享'],
  ['1090930945673', '大模型API教学一对一'],
  ['1090800154639', 'Workbuddy模型直连'],
  ['1092804664879', 'workbuddy长期薅羊毛软件'],
  ['1092664076650', '软件定制/AI Agent/大模型服务'],
  ['1075687421145', 'DeepSeek V4.1 flash'],
  ['1088372435783', 'kimik3接口不限量'],
  ['1086373909824', 'BurpSuite专业版激活安装'],
  ['1039625174329', 'netcup免税账号直供'],
  ['1052961253244', 'DeepSeek API密钥直供(2633想要)'],
  ['1076162957423', 'OpenRouter额度直充(751想要)'],
  ['990439309590', '五个独立OpenRouter API密钥(680想要)'],
  ['1063968640369', 'MiniMax-M3超低价API(378想要)'],
  ['1050781473609', 'Anyrouter API Key(328想要)'],
  ['1071866465607', '国产大模型api可生图(167想要)'],
  ['1003172712659', '火山引擎豆包API(152想要)'],
  ['1077970965039', 'Qwen3.8 API 官价1.5折(143想要)'],
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

const results = []
for (const [id, label] of CANDIDATES) {
  const rec = { id, label }
  try {
    await page.goto(`https://www.goofish.com/item?id=${id}`, { waitUntil: 'domcontentloaded', timeout: 40000 })
    await sleep(3500)
    const st = await page.evaluate(() => {
      const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
      return {
        deleted: /宝贝被删掉了|已下架|已被删除|不存在或已下架/.test(t),
        title: (t.match(/¥ [\d.]+ [^¥]{0,120}/) || [''])[0].slice(0, 160),
        text: t.slice(0, 700),
      }
    })
    rec.alive = !st.deleted
    rec.text = st.text
    console.log(`${rec.alive ? 'ALIVE  ' : 'DELETED'}  ${label}`)
  } catch (e) {
    rec.error = String(e).slice(0, 100)
    console.log(`ERR      ${label}`)
  }
  results.push(rec)
  await sleep(1200)
}

writeFileSync(`${OUT}/xianyu-competitor-survival.json`, JSON.stringify(results, null, 2), 'utf-8')
console.log('\n存活:', results.filter(r => r.alive).length, '/', results.length)
await browser.close()
