/**
 * 探针 13：诊断「材质成分」行的点击与落值（零风险：不提交）。
 * 复刻 fillMaterialRows 的每一步，每步打印状态。
 *
 * 用法：node dev/probe-taobao-material2.mjs <catId> <材质值>
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const CAT_ID = process.argv[2]
const VALUE = process.argv[3] || '棉'
if (!CAT_ID) { console.error('用法：node dev/probe-taobao-material2.mjs <catId> <材质值>'); process.exit(1) }

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { applyStealth } = await import('../lib/stealth-inject.js')
const { findChromePath, profileDir, clearProfileLocks, sleep, UI_STEP_DELAY_MS } = await import('../lib/browser-login.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().filter(a => a.platform === 'taobao' && a.status === 'valid')[0]
if (!acc) { console.error('无有效淘宝账号'); process.exit(1) }

const puppeteer = await import('puppeteer-core')
const dir = profileDir('淘宝材质诊断2')
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

  console.log(`直达 catId=${CAT_ID}，目标材质「${VALUE}」`)
  await page.goto(`https://item.upload.taobao.com/sell/v2/publish.htm?catId=${CAT_ID}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(UI_STEP_DELAY_MS * 3)
  for (let i = 0; i < 30; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('label').length).catch(() => 0)
    if (n > 3) break
    await sleep(500)
  }
  await sleep(3000)

  // ① 找「材质成分」容器
  const box = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'))
    const hit = labels.find(l => /材质成分|面料成分|主面料成分/.test((l.innerText || '').trim()))
    if (!hit) return { found: false, all: labels.map(l => (l.innerText || '').trim().slice(0, 14)).slice(0, 40) }
    let b = hit
    for (let i = 0; i < 7 && b; i++) {
      const cand = b.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]')
      if (cand && cand.querySelector('.next-select, input, button')) {
        const rows = Array.from(cand.querySelectorAll('input[placeholder*="材质"]')).map(i => ({ v: i.value, ro: i.readOnly, ph: i.placeholder }))
        const btns = Array.from(cand.querySelectorAll('button, .next-btn')).filter(x => x.offsetParent !== null).map(x => (x.innerText || '').trim().slice(0, 20))
        return { found: true, id: cand.id || '', rows, btns, text: (cand.innerText || '').replace(/\s+/g, ' ').slice(0, 160) }
      }
      b = b.parentElement
    }
    return { found: false, why: 'no container' }
  }).catch((e) => ({ found: false, error: String(e).slice(0, 120) }))
  console.log('\n① 容器：', JSON.stringify(box, null, 2))

  if (!box.found) { await browser.close(); process.exit(0) }

  // ② 点第一个「请选择材质」input
  const rowPos = await page.evaluate((boxId) => {
    const cand = document.getElementById(boxId)
    if (!cand) return null
    const inps = Array.from(cand.querySelectorAll('input[placeholder*="材质"]'))
    const empty = inps.filter(i => !i.value || i.value === '请选择材质')
    const t = empty[empty.length - 1] || inps[inps.length - 1]
    if (!t) return null
    t.scrollIntoView({ block: 'center' })
    const r = t.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), total: inps.length, empty: empty.length }
  }, box.id).catch(() => null)
  console.log('\n② 行坐标：', JSON.stringify(rowPos))
  if (!rowPos) { await browser.close(); process.exit(0) }

  await page.mouse.move(rowPos.x, rowPos.y)
  await sleep(200)
  await page.mouse.click(rowPos.x, rowPos.y)
  await sleep(1500)

  // ③ 读展开的面板
  const panel = await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
    const panels = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).filter(p => p.offsetParent !== null)
    const p = panels[panels.length - 1]
    if (!p) return { count: panels.length, opts: [] }
    const opts = Array.from(p.querySelectorAll('.options-item, li, [role="option"]')).filter(n => n.offsetParent !== null)
      .map(n => norm(n.getAttribute('title') || n.innerText).slice(0, 24)).filter(Boolean)
    const search = p.querySelector('input[type="search"], .next-select-search input, input:not([readonly])')
    return { count: panels.length, opts: Array.from(new Set(opts)).slice(0, 20), hasSearch: !!search }
  })
  console.log('\n③ 面板：', JSON.stringify(panel, null, 2))

  // ④ 直接点目标值（若在候选中）
  const target = panel.opts?.find(o => o === VALUE) || panel.opts?.find(o => o.includes(VALUE))
  if (target) {
    const clicked = await page.evaluate((t) => {
      const panels = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).filter(p => p.offsetParent !== null)
      const p = panels[panels.length - 1]
      if (!p) return false
      const nodes = Array.from(p.querySelectorAll('.options-item, li, [role="option"]')).filter(n => n.offsetParent !== null)
      const hit = nodes.find(n => (n.getAttribute('title') || n.innerText || '').replace(/\s+/g, ' ').trim() === t)
      if (!hit) return false
      hit.click()
      return true
    }, target)
    console.log(`\n④ 点选「${target}」：${clicked ? '已点' : '失败'}`)
    await sleep(1500)

    // ⑤ 回读
    const after = await page.evaluate((boxId) => {
      const cand = document.getElementById(boxId)
      if (!cand) return null
      const inps = Array.from(cand.querySelectorAll('input[placeholder*="材质"]'))
      return { rows: inps.map(i => i.value || '(空)'), shown: (cand.querySelector('.next-select-values')?.innerText || '').trim() }
    }, box.id)
    console.log('\n⑤ 回读：', JSON.stringify(after, null, 2))
  } else {
    console.log(`\n④ 首屏无「${VALUE}」，尝试面板内搜索`)
    const searched = await page.evaluate((kw) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
      const panels = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).filter(p => p.offsetParent !== null)
      const p = panels[panels.length - 1]
      if (!p) return { ok: false, why: 'no panel' }
      // 面板内/面板旁的搜索框
      const s = (p.querySelector('input[type="search"], .next-select-search input, input:not([readonly])')
        || p.parentElement?.querySelector('input[type="search"], .next-select-search input, input:not([readonly])'))
      if (!s) return { ok: false, why: 'no search box', panelCls: String(p.className).slice(0, 60) }
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(s), 'value')
        || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      s.focus()
      if (desc?.set) desc.set.call(s, kw); else s.value = kw
      s.dispatchEvent(new Event('input', { bubbles: true }))
      return { ok: true, cls: String(s.className).slice(0, 50), ph: s.placeholder }
    }, VALUE)
    console.log('  搜索框：', JSON.stringify(searched))
    await sleep(1800)
    const after = await page.evaluate((kw) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
      const panels = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).filter(p => p.offsetParent !== null)
      const p = panels[panels.length - 1]
      if (!p) return { opts: [] }
      const opts = Array.from(p.querySelectorAll('.options-item, li, [role="option"]')).filter(n => n.offsetParent !== null)
        .map(n => norm(n.getAttribute('title') || n.innerText).slice(0, 24)).filter(Boolean)
      return { opts: Array.from(new Set(opts)).slice(0, 15), has: opts.some(o => o === kw) }
    }, VALUE)
    console.log('  搜索后：', JSON.stringify(after, null, 2))

    const target = after.opts?.find(o => o === VALUE) || after.opts?.find(o => o.includes(VALUE))
    if (target) {
      // 先拿坐标，用**真实鼠标**点（JS click 对 next-select 选项无效，与引擎其它坑一致）
      const rect = await page.evaluate((t) => {
        const panels = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).filter(p => p.offsetParent !== null)
        const p = panels[panels.length - 1]
        if (!p) return null
        const nodes = Array.from(p.querySelectorAll('.options-item, li, [role="option"]')).filter(n => n.offsetParent !== null)
        const hit = nodes.find(n => (n.getAttribute('title') || n.innerText || '').replace(/\s+/g, ' ').trim() === t)
        if (!hit) return null
        hit.scrollIntoView({ block: 'center' })
        const r = hit.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), tag: hit.tagName, cls: String(hit.className).slice(0, 50) }
      }, target)
      console.log(`  选项坐标：`, JSON.stringify(rect))
      let clicked = false
      if (rect) {
        await page.mouse.move(rect.x, rect.y)
        await sleep(250)
        await page.mouse.click(rect.x, rect.y)
        clicked = true
      }
      console.log(`  点选「${target}」：${clicked ? '已点(鼠标)' : '失败'}`)
      await sleep(1800)
      const fin = await page.evaluate((boxId) => {
        const cand = document.getElementById(boxId)
        if (!cand) return null
        const inps = Array.from(cand.querySelectorAll('input[placeholder*="材质"]'))
        return { rowCount: inps.length, rows: inps.map(i => i.value || '(空)'), shown: (cand.querySelector('.next-select-values')?.innerText || '').trim(), text: (cand.innerText || '').replace(/\s+/g, ' ').slice(0, 120) }
      }, box.id)
      console.log('  最终回读：', JSON.stringify(fin, null, 2))
    }
  }
} catch (err) {
  console.error('异常：', err)
  process.exitCode = 1
} finally {
  await browser.close().catch(() => {})
}
