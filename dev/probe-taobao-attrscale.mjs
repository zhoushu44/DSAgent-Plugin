/**
 * 探针 8：直达发布页后读「类目属性」区结构（不填表、不提交，零风险）。
 *
 * 用途：多属性类目（童装/女装，属性常 10~20 项）发布前先摸清属性规模：
 *   共几项 / 几项必填 / 每项是 select 还是 combobox 还是 text / 预填了没有。
 * 这样能提前判断「要填几项、品牌是不是必填、哪些是 combobox（键入路径）」。
 *
 * 用法：node dev/probe-taobao-attrscale.mjs <catId>
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const CAT_ID = process.argv[2]
if (!CAT_ID) { console.error('用法：node dev/probe-taobao-attrscale.mjs <catId>'); process.exit(1) }

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { applyStealth } = await import('../lib/stealth-inject.js')
const { findChromePath, profileDir, clearProfileLocks, sleep, UI_STEP_DELAY_MS } = await import('../lib/browser-login.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().filter(a => a.platform === 'taobao' && a.status === 'valid')[0]
if (!acc) { console.error('无有效淘宝账号'); process.exit(1) }

const puppeteer = await import('puppeteer-core')
const dir = profileDir('淘宝属性规模探针')
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

  console.log(`直达发布页 catId=${CAT_ID}`)
  await page.goto(`https://item.upload.taobao.com/sell/v2/publish.htm?catId=${CAT_ID}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(UI_STEP_DELAY_MS * 3)

  // 等属性区渲染（label 出现）
  for (let i = 0; i < 30; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('label').length).catch(() => 0)
    if (n > 3) break
    await sleep(500)
  }
  await sleep(3000)

  const probe = await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
    const items = Array.from(document.querySelectorAll('.sell-catProp-item-common, .sell-catProp-item'))
      .filter(e => e.offsetParent !== null)
      .map(e => {
        const label = norm(e.querySelector('label')?.innerText || '').replace(/[*＊]/g, '')
        const inp = e.querySelector('input, textarea')
        const sel = e.querySelector('.next-select, .next-select-trigger')
        const isCombo = !!e.querySelector('.next-select-auto-complete')
        const shown = norm(e.querySelector('.next-select-values')?.innerText || '')
        const val = (inp?.value || '').trim()
        const ph = inp?.getAttribute('placeholder') || ''
        const empty = !val && !shown
        return {
          name: label.slice(0, 18),
          req: /[*＊]/.test(e.innerText || '') || !!e.querySelector('label.required'),
          kind: isCombo ? 'combobox' : (sel ? 'select' : (inp ? 'text' : 'other')),
          filled: !empty,
          cur: (val || shown).slice(0, 18),
          ph: ph.slice(0, 12),
        }
      })
      .filter(i => i.name)

    // 「重要属性 N/M」进度（页面上直接写着）
    const prog = (document.body?.innerText || '').match(/重要属性\s*(\d+\s*\/\s*\d+)/)

    return {
      url: location.href,
      total: items.length,
      requiredCount: items.filter(i => i.req).length,
      emptyRequired: items.filter(i => i.req && !i.filled).length,
      kindCount: {
        select: items.filter(i => i.kind === 'select').length,
        combobox: items.filter(i => i.kind === 'combobox').length,
        text: items.filter(i => i.kind === 'text').length,
        other: items.filter(i => i.kind === 'other').length,
      },
      progress: prog ? norm(prog[1]) : null,
      items,
    }
  }).catch((e) => ({ error: String(e).slice(0, 160) }))

  console.log('\n===== 类目属性规模 =====')
  console.log(JSON.stringify(probe, null, 2))

  const shotDir = join('E:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin', 'dev', '.ui-shots')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(shotDir, { recursive: true })
  const shot = join(shotDir, `taobao-attrscale-${CAT_ID}-${Date.now()}.png`)
  await page.screenshot({ path: shot })
  console.log(`\n截图：${shot}`)
} catch (err) {
  console.error('探针异常：', err)
  process.exitCode = 1
} finally {
  await browser.close().catch(() => {})
}
