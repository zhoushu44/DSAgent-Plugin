/**
 * 探针 12：定位「型号」字段的真实容器（它可能不在类目属性区）。
 * 零风险：只读。
 *
 * 用法：node dev/probe-taobao-model.mjs <catId>
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const CAT_ID = process.argv[2]
if (!CAT_ID) { console.error('用法：node dev/probe-taobao-model.mjs <catId>'); process.exit(1) }

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { applyStealth } = await import('../lib/stealth-inject.js')
const { findChromePath, profileDir, clearProfileLocks, sleep, UI_STEP_DELAY_MS } = await import('../lib/browser-login.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().filter(a => a.platform === 'taobao' && a.status === 'valid')[0]
if (!acc) { console.error('无有效淘宝账号'); process.exit(1) }

const puppeteer = await import('puppeteer-core')
const dir = profileDir('淘宝型号定位探针')
clearProfileLocks(dir)
const browser = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: dir,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})

try {
  const page = await browser.newPage()
  await page.setCookie(...Object.entries(acc.cookies || {})
    .filter(([, v]) => v !== '' && v != null)
    .flatMap(([n, v]) => ([
      { name: n, value: String(v), domain: '.taobao.com', path: '/' },
      { name: n, value: String(v), domain: '.tmall.com', path: '/' },
    ])))
  await applyStealth(page)

  console.log(`直达 catId=${CAT_ID}，定位「型号」`)
  await page.goto(`https://item.upload.taobao.com/sell/v2/publish.htm?catId=${CAT_ID}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(UI_STEP_DELAY_MS * 3)
  for (let i = 0; i < 30; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('label').length).catch(() => 0)
    if (n > 3) break
    await sleep(500)
  }
  await sleep(3000)

  const probe = await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
    // 找所有 label 文本是「型号」的
    const labels = Array.from(document.querySelectorAll('label'))
    const hits = labels.filter(l => norm(l.innerText).replace(/[*＊\s]/g, '') === '型号')
    const out = []
    for (const hit of hits) {
      // 往上 8 层，记录每层的 id/class
      const chain = []
      let b = hit
      for (let i = 0; i < 8 && b; i++) {
        chain.push(`${b.tagName.toLowerCase()}${b.id ? '#' + b.id : ''}${typeof b.className === 'string' && b.className ? '.' + b.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : ''}`)
        b = b.parentElement
      }
      // 它所在的最近 .sell-catProp-item* 容器（若有）
      const inCatProp = !!hit.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]')
      const inp = (() => { let b = hit; for (let i = 0; i < 8 && b; i++) { const f = b.querySelector?.('input, textarea'); if (f) return f; b = b.parentElement } return null })()
      out.push({
        inCatProp,
        inputPh: inp?.getAttribute('placeholder') || '',
        inputReadonly: inp ? inp.readOnly : null,
        chain,
      })
    }
    // 也看看「型号」在 body 文本里的上下文
    const bodyTxt = norm(document.body?.innerText || '')
    const idx = bodyTxt.indexOf('型号')
    return { hitCount: hits.length, hits: out, bodyCtx: idx >= 0 ? bodyTxt.slice(Math.max(0, idx - 80), idx + 80) : null }
  }).catch((e) => ({ error: String(e).slice(0, 150) }))

  console.log('\n===== 「型号」定位 =====')
  console.log(JSON.stringify(probe, null, 2))
} catch (err) {
  console.error('异常：', err)
  process.exitCode = 1
} finally {
  await browser.close().catch(() => {})
}
