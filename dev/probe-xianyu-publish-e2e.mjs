/**
 * 端到端验证：选「其他闲置」解除限制后，真正点「发布」，
 * 确认网页版链路能否发布成功。
 *
 * 注意：这是真实发布操作（L2）。执行前用户已确认要跑通链路。
 * 用最低风险配置：价格 1 元。
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

const IMGS = [
  'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/xianyu/img/deepseek-api/01-钩子-官方2折.jpg',
  'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/xianyu/img/deepseek-api/02-权益-不做套路.jpg',
  'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/xianyu/img/deepseek-api/03-接入-支持模型.jpg',
]
const DESC = `【官方2折】AI大模型API中转 Key 独享 | DeepSeek/Claude/GPT/GLM/Kimi 通用

官方 2 折，1 元起测，按量计费，不用不扣。

支持模型：DeepSeek V4 全系、Claude、GPT、Gemini、GLM、Kimi、Qwen、MiniMax。
OpenAI 兼容接口，改一下 base_url 就能用，Cherry Studio / Cursor / Chatbox / Dify / n8n 都能接。

为什么选我们：
1. 独享 Key，不掺量、不共享号池
2. 额度长期有效，不做日卡次卡的过期套路
3. 余额和消耗明细实时可查
4. 一个 Key 通用全部模型，不用分开充值
5. 支持小额先测后买，不会配置可协助接入

虚拟商品，一经发出不支持退换，请确认需求后再拍。
不会配置的下单后联系我，远程协助到你跑通为止。`

await page.goto('https://www.goofish.com/publish', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(5000)
const fi = await page.$('input[type=file]')
await fi.uploadFile(...IMGS)
console.log('已上传 3 张图')
await sleep(16000)

const SEL = 'div[contenteditable="true"]'
await page.click(SEL)
await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
await page.keyboard.press('Backspace')
await page.keyboard.type(DESC, { delay: 8 })
console.log('已填描述')
await sleep(11000)

await page.evaluate(() => {
  const i = Array.from(document.querySelectorAll('input[placeholder="0.00"]')).filter(e => e.offsetParent !== null)
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  if (s && i[0]) s.call(i[0], '1')
  if (i[0]) { i[0].dispatchEvent(new Event('input', { bubbles: true })); i[0].dispatchEvent(new Event('change', { bubbles: true })) }
})
console.log('已填价格 1 元')
await sleep(14000)

// ── 选「其他闲置」解除限制 ──
const box = await page.evaluate(() => {
  const lab = Array.from(document.querySelectorAll('label'))
    .find(l => (l.getAttribute('title') || l.innerText || '').trim().startsWith('分类'))
  const sel = lab && lab.closest('.ant-form-item')?.querySelector('.ant-select')
  if (!sel) return null
  const r = sel.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})
await page.mouse.click(box.x, box.y)
await sleep(3000)
const opts = await page.evaluate(() => Array.from(document.querySelectorAll('.ant-select-item-option')).map(e => (e.textContent || '').trim()))
console.log('类目候选:', JSON.stringify(opts))

const pick = opts.includes('其他闲置') ? '其他闲置' : opts[opts.length - 1]
await page.evaluate((tt) => {
  const t = Array.from(document.querySelectorAll('.ant-select-item-option')).find(e => (e.textContent || '').trim() === tt)
  if (t) { t.scrollIntoView({ block: 'center' }); t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
           t.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); t.click() }
}, pick)
console.log(`已选类目: ${pick}`)
await sleep(9000)

const st = await page.evaluate(() => {
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
  const m = t.match(/分类 \* ([^\s]+)/)
  return { category: m ? m[1] : null, blocked: /网页版暂不支持发布此分类|请使用闲鱼APP扫码/.test(t) }
})
console.log('发布前状态:', JSON.stringify(st))
await page.screenshot({ path: `${OUT}/xianyu-before-publish.png`, fullPage: true })

if (st.blocked) {
  console.log('\n仍被拦截，终止（不点发布）')
  await browser.close()
  process.exit(0)
}

// ── 点发布 ──
console.log('\n点击「发布」...')
const clicked = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find(x => (x.innerText || '').trim() === '发布' && !x.disabled)
  if (!b) return false
  b.click()
  return true
})
console.log('点击结果:', clicked)

// 等待结果
const deadline = Date.now() + 120000
let finalUrl = '', bodyText = '', success = false, errText = ''
while (Date.now() < deadline) {
  await sleep(2500)
  finalUrl = page.url()
  try { bodyText = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 3000)) } catch {}
  if (/\/item(\?|\/)/.test(finalUrl)) { success = true; break }
  if (/发布成功|已发布|宝贝已发布/.test(bodyText)) { success = true; break }
  if (/扫码去APP发布|网页版暂不支持发布此分类/.test(bodyText)) { errText = '仍被拦截'; break }
  const e = bodyText.match(/发布失败[^。]{0,80}|内容违规[^。]{0,60}|请输入[^。]{0,30}/)
  if (e) { errText = e[0]; break }
}

console.log('\n' + '='.repeat(60))
console.log('成功:', success)
console.log('最终URL:', finalUrl)
console.log('错误:', errText || '(无)')
console.log('页面片段:', bodyText.slice(0, 500))
console.log('='.repeat(60))
await page.screenshot({ path: `${OUT}/xianyu-after-publish.png`, fullPage: true })
writeFileSync(`${OUT}/xianyu-publish-result.json`, JSON.stringify({ success, finalUrl, errText, bodyText: bodyText.slice(0, 2000), category: st.category }, null, 2), 'utf-8')
await browser.close()
