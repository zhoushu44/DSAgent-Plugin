/**
 * 探针 10：读「材质成分」这类特殊属性项的真实 DOM 与填写方式。
 * 零风险：只读 + 尝试一次弹窗操作后立即关闭，不提交。
 *
 * 用法：node dev/probe-taobao-material.mjs <catId>
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const CAT_ID = process.argv[2]
if (!CAT_ID) { console.error('用法：node dev/probe-taobao-material.mjs <catId>'); process.exit(1) }

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { applyStealth } = await import('../lib/stealth-inject.js')
const { findChromePath, profileDir, clearProfileLocks, sleep, UI_STEP_DELAY_MS } = await import('../lib/browser-login.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().filter(a => a.platform === 'taobao' && a.status === 'valid')[0]
if (!acc) { console.error('无有效淘宝账号'); process.exit(1) }

const puppeteer = await import('puppeteer-core')
const dir = profileDir('淘宝材质成分探针')
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

  console.log(`直达 catId=${CAT_ID}，读「材质成分」DOM`)
  await page.goto(`https://item.upload.taobao.com/sell/v2/publish.htm?catId=${CAT_ID}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(UI_STEP_DELAY_MS * 3)
  for (let i = 0; i < 30; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('label').length).catch(() => 0)
    if (n > 3) break
    await sleep(500)
  }
  await sleep(3000)

  const dom = await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
    const labels = Array.from(document.querySelectorAll('label'))
    const hit = labels.find(l => /材质/.test(norm(l.innerText)))
    if (!hit) return { found: false, all: labels.map(l => norm(l.innerText).slice(0, 16)).slice(0, 40) }
    let box = hit
    for (let i = 0; i < 7 && box; i++) {
      const cand = box.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]')
      if (cand && cand.querySelector('.next-select, input, button')) { box = cand; break }
      box = box.parentElement
    }
    if (!box) return { found: false, why: 'no container' }
    const btns = Array.from(box.querySelectorAll('button, .next-btn')).filter(b => b.offsetParent !== null)
      .map(b => norm(b.innerText).slice(0, 40))
    const inp = box.querySelector('input, textarea')
    const sel = box.querySelector('.next-select, .next-select-trigger')
    return {
      found: true,
      boxId: box.id || '',
      label: norm(hit.innerText).slice(0, 20),
      hasSelect: !!sel,
      hasInput: !!inp,
      inputReadonly: inp ? inp.readOnly : null,
      buttons: btns,
      boxText: norm(box.innerText).slice(0, 200),
      required: /[*＊]/.test(box.innerText || ''),
    }
  }).catch((e) => ({ error: String(e).slice(0, 150) }))

  console.log('\n===== 材质成分 DOM =====')
  console.log(JSON.stringify(dom, null, 2))

  // 若有「添加材质成分」按钮，点开弹窗看结构（看完立即关）
  if (dom.found && dom.buttons?.length) {
    const clicked = await page.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
      const labels = Array.from(document.querySelectorAll('label'))
      const hit = labels.find(l => /材质/.test(norm(l.innerText)))
      if (!hit) return null
      let box = hit
      for (let i = 0; i < 7 && box; i++) {
        const cand = box.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]')
        if (cand && cand.querySelector('.next-select, input, button')) { box = cand; break }
        box = box.parentElement
      }
      const btn = Array.from(box?.querySelectorAll('button, .next-btn') || []).find(b => b.offsetParent !== null)
      if (!btn) return null
      btn.scrollIntoView({ block: 'center' })
      const r = btn.getBoundingClientRect()
      btn.click()
      return { text: norm(btn.innerText).slice(0, 30), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }).catch(() => null)
    console.log(`\n点了按钮：${JSON.stringify(clicked)}`)
    await sleep(2500)

    // 点按钮后对比：页面上新增/变化了什么（而不是猜弹窗选择器）
    const after = await page.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
      const labels = Array.from(document.querySelectorAll('label'))
      const hit = labels.find(l => /材质/.test(norm(l.innerText)))
      let box = hit
      for (let i = 0; i < 7 && box; i++) {
        const cand = box.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]')
        if (cand && cand.querySelector('.next-select, input, button')) { box = cand; break }
        box = box.parentElement
      }
      // 整个 body 里可见的 select / input / button 快照（前 30 个）
      const vis = Array.from(document.querySelectorAll('.next-select, .next-select-trigger, input, button'))
        .filter(e => e.offsetParent !== null)
        .slice(0, 30)
        .map(e => {
          const cls = typeof e.className === 'string' ? e.className : ''
          return `${e.tagName.toLowerCase()}${cls ? '.' + cls.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : ''}${e.placeholder ? '[' + e.placeholder + ']' : ''}${norm(e.innerText) ? '"' + norm(e.innerText).slice(0, 18) + '"' : ''}`
        })
      return {
        boxText: norm(box?.innerText || '').slice(0, 260),
        rowCount: box ? box.querySelectorAll('input, .next-select').length : 0,
        visible: vis,
      }
    }).catch((e) => ({ error: String(e).slice(0, 120) }))
    console.log('\n===== 点「添加材质成分」后的可见控件 =====')
    console.log(JSON.stringify(after, null, 2))

    // 关掉弹窗（不提交）
    await page.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
      const dlgs = Array.from(document.querySelectorAll('.next-dialog, [class*="modal"], [role="dialog"]')).filter(d => d.offsetParent !== null)
      const d = dlgs[dlgs.length - 1]
      const cancel = d && Array.from(d.querySelectorAll('button')).find(b => /取消|关闭/.test(norm(b.textContent)))
      if (cancel) cancel.click()
    }).catch(() => {})
    await sleep(1000)
  }
} catch (err) {
  console.error('异常：', err)
  process.exitCode = 1
} finally {
  await browser.close().catch(() => {})
}
