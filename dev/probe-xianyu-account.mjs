/**
 * 验证：账号发布权限是否仍在？「英伟达api」那条为何存活？
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

const out = {}

// 1) 存活那条的类目与详情
console.log('=== 存活的「英伟达api 1000个号」 ===')
const caps = []
const onResp = async (res) => {
  if (/mtop/i.test(res.url())) { try { caps.push(await res.text()) } catch {} }
}
page.on('response', onResp)
await page.goto('https://www.goofish.com/item?id=1065185364758', { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(6000)
page.off('response', onResp)

for (const b of caps) {
  for (const m of b.matchAll(/"itemCatDTO":\{([^}]+)\}/g)) {
    const s = m[1]
    console.log('  itemCatDTO:', s)
    out.survivorCat = s
  }
}
const dom = await page.evaluate(() => {
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
  return { deleted: /宝贝被删掉了/.test(t), text: t.slice(0, 800) }
})
out.survivor = dom
console.log('  存活:', !dom.deleted)
console.log('  文本:', dom.text.slice(0, 400))

// 2) 账号发布权限
console.log('\n=== 发布权限 ===')
await page.goto('https://www.goofish.com/publish', { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(7000)
const pc = await page.evaluate(() => {
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
  return {
    restricted: /限制发布|暂不能发布|发布权限|禁止发布|违规处罚|账号异常|已被限制/.test(t),
    text: t.slice(0, 1000),
    hasPublishBtn: !!Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === '发布'),
  }
})
out.publishCheck = pc
console.log('  受限:', pc.restricted, '| 发布按钮存在:', pc.hasPublishBtn)
console.log('  页面:', pc.text.slice(0, 300))

// 3) 账号设置页看有无处罚
console.log('\n=== 账号与安全 ===')
await page.goto('https://www.goofish.com/account', { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(6000)
const ac = await page.evaluate(() => {
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
  return { text: t.slice(0, 1500) }
})
out.account = ac
console.log(' ', ac.text.slice(0, 500))

writeFileSync(`${OUT}/xianyu-account-status.json`, JSON.stringify(out, null, 2), 'utf-8')
console.log('\nDONE')
await browser.close()
