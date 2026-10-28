/**
 * 探针 11：填完属性后、提交前，回读每个属性项的「页面显示值」与「重要属性 N/M」进度，
 * 找出「显示有值但进度没涨」的属性（即没进 React state 的那个）。
 *
 * 复用引擎填属性逻辑（不提交），填完立即 dump。
 *
 * 用法：node dev/probe-taobao-fillcheck.mjs <catId> [--attrs=...] [--brand=...] [--title=...]
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const CAT_ID = process.argv[2]
if (!CAT_ID) { console.error('用法：node dev/probe-taobao-fillcheck.mjs <catId>'); process.exit(1) }
const argOf = (n) => { const h = process.argv.find(a => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : undefined }
const ATTRS = (argOf('attrs') || '').split(/[,，]/).map(s => s.trim()).filter(Boolean).map(p => {
  const i = p.indexOf('='); return i > 0 ? { name: p.slice(0, i).trim(), value: p.slice(i + 1).trim() } : null
}).filter(Boolean)

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { taobaoPublish } = await import('../lib/taobao-publish.js')
const { applyStealth } = await import('../lib/stealth-inject.js')
const { findChromePath, profileDir, clearProfileLocks, sleep, UI_STEP_DELAY_MS } = await import('../lib/browser-login.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().filter(a => a.platform === 'taobao' && a.status === 'valid')[0]
if (!acc) { console.error('无有效淘宝账号'); process.exit(1) }

// 用引擎的预览模式拿不到页面，这里自己起浏览器 + 调引擎的 confirm=false 只会返回预览。
// 所以本探针只做「读」：直接打开发布页，把引擎已填好的状态读出来。
// ★ 但引擎填属性需要跑完整链路 —— 因此这里改为：调 taobaoPublish 时 confirm=true 会真发布。
// 为避免误发布，本探针**不调引擎**，只打开页面并 dump 当前（未填）状态，供人工对照。
const puppeteer = await import('puppeteer-core')
const dir = profileDir('淘宝填表核查探针')
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

  console.log(`直达 catId=${CAT_ID}`)
  await page.goto(`https://item.upload.taobao.com/sell/v2/publish.htm?catId=${CAT_ID}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(UI_STEP_DELAY_MS * 3)
  for (let i = 0; i < 30; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('label').length).catch(() => 0)
    if (n > 3) break
    await sleep(500)
  }
  await sleep(3000)

  const dump = await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
    const items = Array.from(document.querySelectorAll('.sell-catProp-item-common, .sell-catProp-item'))
      .filter(e => e.offsetParent !== null)
      .map(e => {
        const label = norm(e.querySelector('label')?.innerText || '').replace(/[*＊]/g, '')
        const inp = e.querySelector('input, textarea')
        const sel = e.querySelector('.next-select-values')
        const btns = Array.from(e.querySelectorAll('button, .next-btn')).filter(b => b.offsetParent !== null).map(b => norm(b.innerText).slice(0, 20))
        return {
          name: label.slice(0, 18),
          req: /[*＊]/.test(e.innerText || '') || !!e.querySelector('label.required'),
          shown: (sel ? norm(sel.innerText) : (inp?.value || '')).slice(0, 24),
          ph: inp?.getAttribute('placeholder') || '',
          btns: btns.slice(0, 3),
        }
      }).filter(i => i.name)
    const prog = (document.body?.innerText || '').match(/重要属性\s*(\d+\s*\/\s*\d+)/)
    // 页面顶部的「错误(N)」/「建议」计数
    const errTab = (document.body?.innerText || '').match(/错误\s*[（(]\s*(\d+)\s*[)）]/)
    return {
      total: items.length,
      reqCount: items.filter(i => i.req).length,
      progress: prog ? norm(prog[1]) : null,
      errorCount: errTab ? errTab[1] : null,
      items,
    }
  }).catch((e) => ({ error: String(e).slice(0, 150) }))

  console.log('\n===== 当前属性状态（未填基线）=====')
  console.log(JSON.stringify(dump, null, 2))
  console.log(`\n（本次传入的显式属性：${JSON.stringify(ATTRS)}）`)
} catch (err) {
  console.error('异常：', err)
  process.exitCode = 1
} finally {
  await browser.close().catch(() => {})
}
