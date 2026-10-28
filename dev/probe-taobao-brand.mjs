/**
 * 探针 2：淘宝发布页「品牌」属性能否自动填。
 * 直达 catId 页，读品牌属性项结构，尝试 JS click 展开下拉、读候选、点第一项，回读结果。
 * 零风险：不提交。
 *
 * 用法：node dev/probe-taobao-brand.mjs [catId]
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const CAT_ID = process.argv[2] || '150708'

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { applyStealth } = await import('../lib/stealth-inject.js')
const { findChromePath, profileDir, clearProfileLocks, sleep, UI_STEP_DELAY_MS } = await import('../lib/browser-login.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().filter(a => a.platform === 'taobao' && a.status === 'valid')[0]
if (!acc) { console.error('无有效淘宝账号'); process.exit(1) }

const puppeteer = await import('puppeteer-core')
const chromePath = findChromePath()
const dir = profileDir('淘宝品牌探针')
clearProfileLocks(dir)
const browser = await puppeteer.launch({
  headless: false, executablePath: chromePath, userDataDir: dir,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()

try {
  const page = await browser.newPage()
  const cookies = Object.entries(acc.cookies || {})
    .filter(([, v]) => v !== '' && v != null)
    .flatMap(([name, value]) => ([
      { name, value: String(value), domain: '.taobao.com', path: '/' },
      { name, value: String(value), domain: '.tmall.com', path: '/' },
    ]))
  await page.setCookie(...cookies)
  await applyStealth(page)

  console.log(`打开直达发布页 catId=${CAT_ID}`)
  await page.goto(`https://item.upload.taobao.com/sell/v2/publish.htm?catId=${CAT_ID}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(UI_STEP_DELAY_MS * 3)
  for (let i = 0; i < 30; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('label').length).catch(() => 0)
    if (n > 3) break
    await sleep(500)
  }
  await sleep(3000)

  // ① 读「品牌」属性项的完整 DOM 线索
  const brandProbe = await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
    const labels = Array.from(document.querySelectorAll('label'))
    const brandLabel = labels.find(l => {
      const t = norm(l.innerText).replace(/[*＊\s]/g, '')
      return t === '品牌'
    })
    if (!brandLabel) return { found: false, allLabels: labels.map(l => norm(l.innerText).slice(0, 16)).slice(0, 60) }
    let box = brandLabel, chain = []
    for (let i = 0; i < 7 && box; i++) {
      chain.push({
        tag: box.tagName.toLowerCase(),
        id: box.id || '',
        cls: (typeof box.className === 'string' ? box.className : '').slice(0, 90),
      })
      box = box.parentElement
    }
    // 找最近的值控件
    let c = brandLabel
    for (let i = 0; i < 7 && c; i++) {
      if (c.querySelector && c.querySelector('.next-select, input')) break
      c = c.parentElement
    }
    const ctrl = c && c.querySelector ? c : null
    return {
      found: true,
      chain,
      ctrlTag: ctrl?.tagName,
      ctrlId: ctrl?.id || '',
      ctrlCls: (typeof ctrl?.className === 'string' ? ctrl.className : '').slice(0, 120),
      hasSelect: !!ctrl?.querySelector?.('.next-select'),
      hasInput: !!ctrl?.querySelector?.('input'),
      inputPh: ctrl?.querySelector?.('input')?.getAttribute('placeholder') || '',
      inputMax: ctrl?.querySelector?.('input')?.getAttribute('maxlength') || '',
      innerText: norm(ctrl?.innerText || '').slice(0, 200),
    }
  })
  console.log('\n===== ① 品牌属性项 DOM =====')
  console.log(JSON.stringify(brandProbe, null, 2))

  // ② 尝试 JS 原生 click 展开下拉（引擎已验证只有 element.click() 有效）
  const opened = await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/[*＊\s]/g, '')
    const labels = Array.from(document.querySelectorAll('label'))
    const bl = labels.find(l => norm(l.innerText) === '品牌')
    if (!bl) return { ok: false, why: 'no label' }
    let box = bl
    for (let i = 0; i < 7 && box; i++) {
      const trig = box.querySelector?.('.next-select-trigger, .next-select, [class*="select"]')
      if (trig) { trig.click(); return { ok: true, via: trig.className } }
      box = box.parentElement
    }
    return { ok: false, why: 'no trigger found' }
  })
  console.log('\n===== ② 展开品牌下拉 =====')
  console.log(JSON.stringify(opened, null, 2))
  await sleep(1500)

  // ③ 读候选（新增品牌 是特殊入口，先看候选长什么样）
  const options = await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
    const sels = [
      '.next-overlay-wrapper.opened [class*="option"]',
      '.next-menu-item',
      '[role="option"]',
      '.options-item',
      '.next-select-menu li',
    ]
    for (const s of sels) {
      const els = Array.from(document.querySelectorAll(s)).filter(e => e.offsetParent !== null)
      if (els.length) {
        return { sel: s, count: els.length, texts: els.slice(0, 15).map(e => norm(e.innerText).slice(0, 40)) }
      }
    }
    // 兜底：全页找可见的「新增品牌」
    const addBtn = Array.from(document.querySelectorAll('button, a, span')).find(e => /新增品牌/.test(e.textContent || '') && e.offsetParent !== null)
    return { sel: '(none)', count: 0, texts: [], hasAddBrandBtn: !!addBtn, addBtnText: norm(addBtn?.textContent || '') }
  })
  console.log('\n===== ③ 品牌候选 =====')
  console.log(JSON.stringify(options, null, 2))

  // ④ 点第一个候选（如果存在）并回读
  if (options.count > 0) {
    const picked = await page.evaluate((sel) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
      const els = Array.from(document.querySelectorAll(sel)).filter(e => e.offsetParent !== null)
      const first = els[0]
      if (!first) return { ok: false }
      const text = norm(first.innerText)
      first.click()
      return { ok: true, pickedText: text.slice(0, 40) }
    }, options.sel)
    console.log('\n===== ④ 点选第一个候选 =====')
    console.log(JSON.stringify(picked, null, 2))
    await sleep(1200)

    const after = await page.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
      const labels = Array.from(document.querySelectorAll('label'))
      const bl = labels.find(l => norm(l.innerText).replace(/[*＊\s]/g, '') === '品牌')
      let box = bl
      for (let i = 0; i < 7 && box; i++) {
        if (box.querySelector?.('.next-select-values')) break
        box = box.parentElement
      }
      const v = norm(box?.querySelector?.('.next-select-values')?.innerText || '')
      const m = document.body.innerText.match(/重要属性\s*(\d+\/\d+)/)
      return { brandValue: v, importantProgress: m ? m[1] : null }
    })
    console.log('\n===== ④ 回读 =====')
    console.log(JSON.stringify(after, null, 2))
  }

  const shotDir = join('E:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin', 'dev', '.ui-shots')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(shotDir, { recursive: true })
  const shot = join(shotDir, `taobao-brand-probe-${Date.now()}.png`)
  await page.screenshot({ path: shot })
  console.log(`\n截图：${shot}`)
} catch (err) {
  console.error('探针异常：', err)
  process.exitCode = 1
} finally {
  await browser.close().catch(() => {})
}
