/**
 * 探针 9：读某个属性项的完整控件 DOM，用于判断它到底是 select / combobox / text。
 * 零风险：只读，不填不提交。
 *
 * 用法：node dev/probe-taobao-attrkind.mjs <catId> <属性名>
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const CAT_ID = process.argv[2]
const WANT = process.argv[3]
if (!CAT_ID || !WANT) { console.error('用法：node dev/probe-taobao-attrkind.mjs <catId> <属性名>'); process.exit(1) }

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { applyStealth } = await import('../lib/stealth-inject.js')
const { findChromePath, profileDir, clearProfileLocks, sleep, UI_STEP_DELAY_MS } = await import('../lib/browser-login.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().filter(a => a.platform === 'taobao' && a.status === 'valid')[0]
if (!acc) { console.error('无有效淘宝账号'); process.exit(1) }

const puppeteer = await import('puppeteer-core')
const dir = profileDir('淘宝属性类型探针')
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

  console.log(`直达 catId=${CAT_ID}，读「${WANT}」控件 DOM`)
  await page.goto(`https://item.upload.taobao.com/sell/v2/publish.htm?catId=${CAT_ID}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(UI_STEP_DELAY_MS * 3)
  for (let i = 0; i < 30; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('label').length).catch(() => 0)
    if (n > 3) break
    await sleep(500)
  }
  await sleep(3000)

  const probe = await page.evaluate((want) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
    const labels = Array.from(document.querySelectorAll('label'))
    const hit = labels.find(l => norm(l.innerText).replace(/[*＊]/g, '') === want)
    if (!hit) return { found: false, all: labels.map(l => norm(l.innerText).slice(0, 14)).slice(0, 40) }

    // 往上找属性项容器
    let box = hit
    for (let i = 0; i < 7 && box; i++) {
      const cand = box.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]')
      if (cand && cand.querySelector('.next-select, input')) { box = cand; break }
      box = box.parentElement
    }
    if (!box) return { found: false, why: 'no container' }

    const desc = []
    for (const el of Array.from(box.querySelectorAll('*')).slice(0, 40)) {
      const cls = typeof el.className === 'string' ? el.className : ''
      if (/next-select|auto-complete|next-input|combobox/i.test(cls)) {
        desc.push(`${el.tagName.toLowerCase()}.${cls.split(/\s+/).filter(Boolean).slice(0, 4).join('.')}`)
      }
    }
    const inp = box.querySelector('input')
    return {
      found: true,
      boxId: box.id || '',
      boxCls: (typeof box.className === 'string' ? box.className : '').slice(0, 90),
      hasAutoComplete: !!box.querySelector('.next-select-auto-complete'),
      hasSelect: !!box.querySelector('.next-select'),
      hasTrigger: !!box.querySelector('.next-select-trigger'),
      hasInput: !!inp,
      inputCls: inp ? String(inp.className).slice(0, 80) : null,
      inputPh: inp?.getAttribute('placeholder') || '',
      inputReadonly: inp ? inp.readOnly : null,
      selectClasses: Array.from(new Set(desc)).slice(0, 10),
      boxText: norm(box.innerText).slice(0, 140),
    }
  }, WANT).catch((e) => ({ error: String(e).slice(0, 150) }))

  console.log('\n===== 控件 DOM =====')
  console.log(JSON.stringify(probe, null, 2))

  // 展开该属性下拉，读真实候选（验证 readPropOptions 是否串位）
  if (probe.found) {
    await page.evaluate((want) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
      const labels = Array.from(document.querySelectorAll('label'))
      const hit = labels.find(l => norm(l.innerText).replace(/[*＊]/g, '') === want)
      if (!hit) return
      let box = hit
      for (let i = 0; i < 7 && box; i++) {
        const cand = box.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]')
        if (cand && cand.querySelector('.next-select, input')) { box = cand; break }
        box = box.parentElement
      }
      const trig = box?.querySelector('.next-select-trigger, .next-select')
      if (trig) trig.click()
    }, WANT).catch(() => {})
    await sleep(1800)
    const opts = await page.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
      const panels = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).filter(p => p.offsetParent !== null)
      const out = []
      for (const p of panels) {
        const nodes = Array.from(p.querySelectorAll('.options-item, li, [role="option"], [class*="option"]'))
          .filter(n => n.offsetParent !== null)
          .map(n => norm(n.getAttribute('title') || n.innerText).slice(0, 30))
          .filter(Boolean)
        out.push({ panelCls: String(p.className).slice(0, 60), count: nodes.length, sample: Array.from(new Set(nodes)).slice(0, 20) })
      }
      return { panelCount: panels.length, panels: out }
    }).catch((e) => ({ error: String(e).slice(0, 120) }))
    console.log('\n===== 展开后的下拉面板（真实候选）=====')
    console.log(JSON.stringify(opts, null, 2))

    // 试在该 select 里搜索目标值（有些 next-select 展开后会出现搜索框）
    if (probe.found) {
      const searchProbe = await page.evaluate((want) => {
        const panels = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).filter(p => p.offsetParent !== null)
        const p = panels[panels.length - 1]
        if (!p) return { has: false }
        const s = p.querySelector('input[type="search"], .next-select-search input, input:not([readonly])')
        return {
          has: !!s,
          cls: s ? String(s.className).slice(0, 60) : null,
          ph: s?.getAttribute('placeholder') || '',
          scrollH: p.scrollHeight,
          clientH: p.clientHeight,
          hasMore: p.scrollHeight > p.clientHeight + 20,
        }
      }, WANT).catch((e) => ({ error: String(e).slice(0, 120) }))
      console.log('\n===== 面板内是否有搜索框 / 是否可滚动 =====')
      console.log(JSON.stringify(searchProbe, null, 2))

      // 有搜索框就键入关键词再读一次
      if (searchProbe?.has) {
        await page.evaluate((kw) => {
          const panels = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).filter(p => p.offsetParent !== null)
          const p = panels[panels.length - 1]
          const s = p?.querySelector('input[type="search"], .next-select-search input, input:not([readonly])')
          if (!s) return
          const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(s), 'value')
            || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
          s.focus()
          if (desc?.set) desc.set.call(s, kw); else s.value = kw
          s.dispatchEvent(new Event('input', { bubbles: true }))
        }, process.argv[4] || WANT).catch(() => {})
        await sleep(1800)
        const after = await page.evaluate((kw) => {
          const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
          const panels = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).filter(p => p.offsetParent !== null)
          const p = panels[panels.length - 1]
          if (!p) return { found: false }
          const nodes = Array.from(p.querySelectorAll('.options-item, li, [role="option"], [class*="option"]'))
            .filter(n => n.offsetParent !== null)
            .map(n => norm(n.getAttribute('title') || n.innerText).slice(0, 30))
            .filter(Boolean)
          return { kw, count: nodes.length, has: nodes.some(n => n.includes(kw)), sample: Array.from(new Set(nodes)).slice(0, 12) }
        }, process.argv[4] || WANT).catch((e) => ({ error: String(e).slice(0, 120) }))
        console.log(`\n===== 搜索「${process.argv[4] || WANT}」后的候选 =====`)
        console.log(JSON.stringify(after, null, 2))
      }
    }
  }
} catch (err) {
  console.error('异常：', err)
  process.exitCode = 1
} finally {
  await browser.close().catch(() => {})
}
