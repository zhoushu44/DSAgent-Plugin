/**
 * 竞品类目统计：抓 24 条 AI/API 类竞品的真实类目，映射成中文名并统计分布。
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

// channelCatId → 类目名（来自实测 kgraph.property.recommend 响应）
const CAT_NAME = {
  201453616: '软件/程序/网站开发',
  201459411: '其他闲置',
  201461105: '其他服务',
  202038701: 'AI模型训练',
  202148345: 'DeepSeek服务',
  202152829: 'AI提效工具',
  202145854: 'AI办公工具/服务',
  202157121: 'AI编程工具/服务',
  202153031: 'AI客服工具/服务',
  202154631: 'AI设计工具/服务',
  202156031: 'AI图文工具/服务',
  201454708: '设计素材/源文件',
  201409706: '游戏其他',
  201454913: '其他技能服务',
  201451818: '其它互联网/软硬件相关服务',
  201703301: '网站/工具会员充值',
  202036001: '其他游戏服务',
  200928013: '其他游戏道具',
  201450801: '(root)',
  201458716: '(level3)',
  201458715: '(level2)',
}

const RIVALS = [
  ['1052961253244', 'DeepSeek API密钥直供', 2633],
  ['1066281638723', 'DeepSeek-V4-Flash无限使用', 1710],
  ['937827311802', '满血版DeepSeek-R1', 1374],
  ['1076162957423', 'OpenRouter额度直充可开票', 751],
  ['990439309590', '五个独立OpenRouter密钥', 680],
  ['975181877810', 'OpenRouter免费Key', 475],
  ['1063968640369', 'MiniMax-M3超低价API', 378],
  ['1050781473609', 'Anyrouter API Key', 328],
  ['1071866465607', '国产大模型api可生图', 167],
  ['1003172712659', '火山引擎豆包API', 152],
  ['1077970965039', 'Qwen3.8 API 1.5折', 143],
  ['1088278315813', 'Coze积分额度代购', 68],
  ['1088372435783', 'kimik3接口不限量', 66],
  ['1027189015072', 'qoder2300Credits月pro', 69],
  ['1092932856164', '智谱GLM-5.3 日卡', 0],
  ['1075687421145', 'DeepSeek V4.1 flash', 0],
  ['1086099365232', 'TypeSafe Jev模型APIKey', 52],
  ['1088614833857', 'OpenRouter 余额直充', 81],
  ['1070565407167', 'Kimi K2.7 API密钥', 24],
  ['1053779757031', 'AI大模型RAG与Agent开发教程', 28],
  ['1092664076650', '软件定制/AI Agent/大模型服务', 0],
  ['1092690132342', 'Harness 安装与基础配置', 0],
  ['1065185364758', '我自己的-英伟达api(存活)', 0],
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

const rows = []
for (const [id, label, want] of RIVALS) {
  const caps = []
  const onResp = async (res) => {
    if (/mtop/i.test(res.url())) { try { caps.push(await res.text()) } catch {} }
  }
  page.on('response', onResp)
  let rec = { id, label, want }
  try {
    await page.goto(`https://www.goofish.com/item?id=${id}`, { waitUntil: 'domcontentloaded', timeout: 40000 })
    await sleep(5500)
    page.off('response', onResp)
    for (const b of caps) {
      for (const m of b.matchAll(/"itemCatDTO":\{([^}]+)\}/g)) {
        const s = m[1]
        const g = (k) => (s.match(new RegExp(`"${k}":(\\d+)`)) || [])[1]
        rec.channelCatId = g('channelCatId')
        rec.catId = g('catId')
        rec.level2 = g('level2ChannelCatId')
        rec.level3 = g('level3ChannelCatId')
      }
    }
    rec.alive = await page.evaluate(() => !/宝贝被删掉了|已下架|已被删除/.test((document.body?.innerText || '').replace(/\s+/g, ' ')))
  } catch (e) {
    rec.error = String(e).slice(0, 100)
  }
  rec.catName = CAT_NAME[rec.channelCatId] || `未知(${rec.channelCatId})`
  rows.push(rec)
  console.log(`${rec.alive ? 'ALIVE' : 'DEL '} ch=${String(rec.channelCatId).padEnd(10)} ${String(rec.catName).padEnd(22)} ${label}`)
  await sleep(1200)
}

// 统计
const tally = {}
for (const r of rows) {
  const k = r.catName
  tally[k] = (tally[k] || 0) + 1
}
console.log('\n=== 竞品类目分布 ===')
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(2)} 条   ${k}`)
}

writeFileSync(`${OUT}/xianyu-rival-categories.json`, JSON.stringify({ rows, tally }, null, 2), 'utf-8')
console.log('\nDONE')
await browser.close()
