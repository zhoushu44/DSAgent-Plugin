/**
 * 决定性实验：抓 mtop.taobao.idle.kgraph.property.recommend 的响应，
 * 看「其他服务」(channelCatId=201461105) 是否作为可选类目下发。
 * 只做轻量 DOM 读取，避免 protocolTimeout。
 */
import puppeteer from 'puppeteer-core'
import { findChromePath, profileDir, clearProfileLocks, sleep } from '../lib/browser-login.js'
import { CredentialStore } from '../lib/services/credential-store.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT = 'dev/.ui-shots'
mkdirSync(OUT, { recursive: true })

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

const apiLog = []
page.on('response', async (res) => {
  const u = res.url()
  const m = u.match(/mtop\.[a-z0-9.]+/i)
  if (!m) return
  try {
    const body = await res.text()
    apiLog.push({ api: m[0], body })
  } catch {}
})

const IMG = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/xianyu/img/deepseek-api/01-钩子-官方2折.jpg'
const DESC = '【官方2折】AI大模型API中转 Key 独享 DeepSeek/Claude/GPT/GLM/Kimi 通用\n\n官方2折，1元起测，按量计费不用不扣。'

await page.goto('https://www.goofish.com/publish', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(5000)
const fi = await page.$('input[type=file]')
if (fi) await fi.uploadFile(IMG)
console.log('已上传图片')
await sleep(14000)

const SEL = 'div[contenteditable="true"]'
if (await page.$(SEL)) {
  await page.click(SEL)
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(DESC, { delay: 8 })
}
console.log('已填描述')
await sleep(12000)

await page.evaluate(() => {
  const i = Array.from(document.querySelectorAll('input[placeholder="0.00"]')).filter(e => e.offsetParent !== null)
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  if (s && i[0]) s.call(i[0], '1')
  if (i[0]) i[0].dispatchEvent(new Event('input', { bubbles: true }))
})
console.log('已填价格')
await sleep(14000)

// 轻量读取
const txt = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 600))
console.log('\n页面文本:', txt)

writeFileSync(`${OUT}/xianyu-api-log.json`, JSON.stringify(apiLog, null, 2), 'utf-8')
console.log('\n===== 抓到的接口 =====')
for (const a of apiLog) console.log(' ', a.api, `(${a.body.length}B)`)

// 找 property.recommend 的响应
console.log('\n' + '='.repeat(70))
console.log('kgraph.property.recommend 响应分析')
console.log('='.repeat(70))
for (const a of apiLog.filter(x => /property/i.test(x.api))) {
  console.log('\nAPI:', a.api)
  try {
    const j = JSON.parse(a.body)
    const data = j.data || {}
    const cards = data.cardList || []
    console.log('cardList 数:', cards.length)
    for (const c of cards) {
      const cd = c.cardData || c
      console.log(`  - propertyId=${cd.propertyId} propertyName=${cd.propertyName} values=${(cd.valuesList || []).length}`)
      if (String(cd.propertyId) === '-10000') {
        console.log('    ★ 类目卡片候选值:')
        for (const v of (cd.valuesList || [])) {
          console.log(`       catName=${v.catName} channelCatId=${v.channelCatId} catId=${v.catId} isClicked=${v.isClicked}`)
        }
      }
    }
    if (data.categoryPredictResult) {
      console.log('  categoryPredictResult:', JSON.stringify(data.categoryPredictResult))
    }
  } catch (e) {
    console.log('  解析失败, 原始前600:', a.body.slice(0, 600))
  }
}

// 找「暂不支持」这句话来自哪个接口
console.log('\n' + '='.repeat(70))
console.log('哪個接口返回「暂不支持/扫码」')
console.log('='.repeat(70))
for (const a of apiLog) {
  if (/暂不支持|扫码|APP/.test(a.body)) {
    const i = a.body.search(/暂不支持|扫码|APP/)
    console.log('API:', a.api)
    console.log('  上下文:', a.body.slice(Math.max(0, i - 200), i + 200))
  }
}

console.log('\n已保存')
await browser.close()
