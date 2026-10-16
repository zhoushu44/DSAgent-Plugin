/**
 * 竞品类目统计 v2：用「body 里直接匹配 channelCatId」的可靠方式（前次验证有效）。
 */
import puppeteer from 'puppeteer-core'
import { findChromePath, profileDir, clearProfileLocks, sleep } from '../lib/browser-login.js'
import { CredentialStore } from '../lib/services/credential-store.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT = 'dev/.ui-shots'
mkdirSync(OUT, { recursive: true })

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
  201454913: '其他技能服务',
  201451818: '其它互联网/软硬件相关服务',
  201703301: '网站/工具会员充值',
  201409706: '游戏其他',
  202036001: '其他游戏服务',
  200928013: '其他游戏道具',
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
  ['1092817996821', 'workbuddy自动签到', 3],
  ['1086373909824', 'BurpSuite专业版激活安装', 12],
  ['1039625174329', 'netcup免税账号直供', 21],
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
    const u = res.url()
    if (/mtop|api/i.test(u)) { try { caps.push(await res.text()) } catch {} }
  }
  page.on('response', onResp)
  const rec = { id, label, want }
  try {
    await page.goto(`https://www.goofish.com/item?id=${id}`, { waitUntil: 'domcontentloaded', timeout: 40000 })
    await sleep(7000)
    page.off('response', onResp)

    // 直接在整个 body 里找 channelCatId
    const hits = new Set()
    for (const b of caps) {
      for (const m of b.matchAll(/"channelCatId":"?(\d+)"?/g)) hits.add(m[1])
      for (const m of b.matchAll(/"channelCateId":(\d+)/g)) hits.add(m[1])
      for (const m of b.matchAll(/"category_id":"(\d+)"/g)) hits.add(m[1])
    }
    rec.channelCats = [...hits]
    rec.catNames = rec.channelCats.map(c => CAT_NAME[c] || `未知(${c})`)
    rec.alive = await page.evaluate(() => !/宝贝被删掉了|已下架|已被删除/.test((document.body?.innerText || '').replace(/\s+/g, ' ')))
  } catch (e) { rec.error = String(e).slice(0, 100) }
  rows.push(rec)
  console.log(`${rec.alive ? 'ALIVE' : 'DEL '}  ${(rec.catNames || []).join(' / ').padEnd(34)} ${label}`)
  await sleep(1000)
}

// 统计（取每条最可能的类目 = catNames 里非未知的第一个）
const tally = {}
for (const r of rows) {
  const names = (r.catNames || []).filter(n => !n.startsWith('未知'))
  const key = names[0] || '(未捕获)'
  tally[key] = (tally[key] || 0) + 1
}
console.log('\n=== 竞品类目分布 ===')
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(2)} 条   ${k}`)
}
console.log(`\n存活: ${rows.filter(r => r.alive).length}/${rows.length}`)
writeFileSync(`${OUT}/xianyu-rival-categories.json`, JSON.stringify({ rows, tally }, null, 2), 'utf-8')
console.log('DONE')
await browser.close()
