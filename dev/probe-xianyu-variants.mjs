/**
 * 测试不同描述/图片组合能否被识别为「网页版可发布」的类目。
 * 只读取识别结果，不点发布。
 */
import puppeteer from 'puppeteer-core'
import { findChromePath, profileDir, clearProfileLocks, sleep } from '../lib/browser-login.js'
import { CredentialStore } from '../lib/services/credential-store.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT = 'dev/.ui-shots'
mkdirSync(OUT, { recursive: true })

const IMG = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/xianyu/img/api-relay/01-钩子-官方2折.jpg'

const VARIANTS = [
  { name: 'A-API中转(当前)', desc: '【官方2折】AI大模型API中转 Key 独享 DeepSeek/Claude/GPT/GLM/Kimi 通用\n\n官方2折，1元起测，按量计费不用不扣。' },
  { name: 'B-教程资料', desc: 'AI大模型使用教程与接入资料，含配置文档和提示词合集，网盘发货。\n\n适合想学AI工具的朋友，一次购买长期可用。' },
  { name: 'C-纯软件', desc: 'AI助手软件客户端，支持多模型切换，安装即用。\n\n支持Windows和Mac，正版授权，长期可用。' },
  { name: 'D-技术服务', desc: '提供软件配置与调试服务，远程协助安装部署，不含任何账号。\n\n一对一指导，直到跑通为止。' },
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

const results = []
for (const v of VARIANTS) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })
  await page.setCookie(...Object.entries(cookies).filter(([, val]) => val).flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.goofish.com', path: '/' },
    { name, value: String(value), domain: '.taobao.com', path: '/' },
  ])))
  try {
    await page.goto('https://www.goofish.com/publish', { waitUntil: 'domcontentloaded', timeout: 45000 })
    await sleep(4500)
    const fi = await page.$('input[type=file]')
    if (fi) await fi.uploadFile(IMG)
    await sleep(11000)
    const SEL = 'div[contenteditable="true"]'
    if (await page.$(SEL)) {
      await page.click(SEL)
      await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
      await page.keyboard.press('Backspace')
      await page.keyboard.type(v.desc, { delay: 8 })
    }
    await sleep(9000)
    await page.evaluate(() => {
      const i = Array.from(document.querySelectorAll('input[placeholder="0.00"]')).filter(e => e.offsetParent !== null)
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      if (s) s.call(i[0], '1'); else i[0].value = '1'
      i[0].dispatchEvent(new Event('input', { bubbles: true }))
    })
    await sleep(11000)
    const r = await page.evaluate(() => {
      const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
      const m = t.match(/分类 \* ([^ ]+)/)
      return {
        category: m ? m[1] : null,
        blocked: /网页版暂不支持发布此分类|扫码去APP发布|请使用闲鱼APP扫码/.test(t),
        snippet: (t.match(/分类 \* [^#]{0,120}/) || [''])[0],
      }
    })
    r.name = v.name
    console.log(`[${v.name}] 类目=${r.category} 网页被拦=${r.blocked}`)
    console.log('   ', r.snippet)
    results.push(r)
  } catch (e) {
    results.push({ name: v.name, error: String(e).slice(0, 200) })
    console.log(`[${v.name}] 出错:`, String(e).slice(0, 160))
  }
  await page.close()
}

writeFileSync(`${OUT}/xianyu-variants.json`, JSON.stringify(results, null, 2), 'utf-8')
console.log('\n===== 汇总 =====')
console.log(JSON.stringify(results, null, 1))
await browser.close()
