/**
 * 探针 5：借引擎的选类目能力拿 catId。
 * 走引擎正常链路（会自动填品牌/型号让「确认，下一步」可用），但不点提交，
 * 只在进入发布页后从 URL 抓 catId 并立即中断。
 *
 * ★ 实现方式：monkey-patch 太重，这里改用「读引擎已有逻辑」——直接调 taobaoPublish
 *   带 categoryKeyword + brand，confirm=false 时引擎只出预览（不会进浏览器）。
 *   所以本脚本改为：复刻引擎 selectCategory 的最小必要步骤（搜索 → 点路径 →
 *   填品牌 → 点确认），从跳转 URL 拿 catId。
 *
 * 用法：node dev/probe-taobao-catid3.mjs <关键词> [品牌]
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const KEYWORD = process.argv[2]
const BRAND = process.argv[3] || ''
if (!KEYWORD) { console.error('用法：node dev/probe-taobao-catid3.mjs <关键词> [品牌]'); process.exit(1) }

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { applyStealth } = await import('../lib/stealth-inject.js')
const { findChromePath, profileDir, clearProfileLocks, sleep, UI_STEP_DELAY_MS } = await import('../lib/browser-login.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().filter(a => a.platform === 'taobao' && a.status === 'valid')[0]
if (!acc) { console.error('无有效淘宝账号'); process.exit(1) }

const puppeteer = await import('puppeteer-core')
const chromePath = findChromePath()
const dir = profileDir('淘宝类目探针3')
clearProfileLocks(dir)
const browser = await puppeteer.launch({
  headless: false, executablePath: chromePath, userDataDir: dir,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})

const taobaoPage = async () => {
  const ps = await browser.pages()
  return ps.find(p => /taobao\.com|tmall\.com/.test(p.url())) || ps[0] || null
}

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

  console.log(`选类目页，搜索「${KEYWORD}」`)
  await page.goto('https://item.upload.taobao.com/sell/ai/category.htm?force=true', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(UI_STEP_DELAY_MS * 2)

  let cur = await taobaoPage()
  const hasBox = await cur.evaluate(() => !!document.querySelector('input[placeholder*="类目关键词"]')).catch(() => false)
  if (!hasBox) {
    await cur.evaluate(() => {
      const any = Array.from(document.querySelectorAll('button, a')).find(b => /开启/.test((b.textContent || '').trim()) && b.offsetParent)
      if (any) any.click()
    }).catch(() => {})
    await sleep(3000)
  }

  cur = await taobaoPage()
  await cur.click('input[placeholder*="类目关键词"]').catch(() => {})
  await cur.type('input[placeholder*="类目关键词"]', KEYWORD, { delay: 60 }).catch(() => {})
  await sleep(2000)
  await cur.keyboard.press('Enter').catch(() => {})
  await sleep(4000)

  // 点第一条类目路径
  cur = await taobaoPage()
  const pick = await cur.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
    const paths = Array.from(document.querySelectorAll('[class*="result-cate-path"]'))
      .filter(e => e.offsetParent !== null && norm(e.innerText).length > 3 && norm(e.innerText).length < 60)
    if (!paths.length) return { via: '(no path)' }
    paths[0].click()
    return { via: 'path', text: norm(paths[0].innerText).slice(0, 60) }
  }).catch((e) => ({ error: String(e).slice(0, 120) }))
  console.log('选中类目：', JSON.stringify(pick))
  await sleep(2500)

  // 轮询等「确认，下一步」可用；期间若出现品牌/型号必填，用 JS 填
  cur = await taobaoPage()
  let ready = false
  for (let i = 0; i < 24; i++) {
    const st = await cur.evaluate((brand) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
      const btn = Array.from(document.querySelectorAll('button, a')).find(b => /确认.*下一步/.test(norm(b.textContent)) && b.offsetParent !== null)
      if (btn && btn.disabled !== true) return { ready: true }

      // 尝试填右侧「类目必填属性」：品牌（combobox：键入→选中）+ 型号（文本）
      const items = Array.from(document.querySelectorAll('.sell-catProp-item-common, .sell-catProp-item'))
        .filter(e => e.offsetParent !== null)
      const req = items.filter(e => e.querySelector('label.required') || /[*＊]/.test(e.innerText || ''))
      let acted = 0
      for (const it of req) {
        const label = norm(it.querySelector('label')?.innerText || '').replace(/[*＊]/g, '')
        if (!brand) continue
        if (/品牌/.test(label)) {
          const inp = it.querySelector('input')
          if (inp && !inp.value) {
            inp.focus(); inp.click()
            inp.value = brand
            inp.dispatchEvent(new Event('input', { bubbles: true }))
            acted++
          }
        }
      }
      return { ready: false, reqCount: req.length, acted, brand }
    }, BRAND).catch(() => ({ ready: false }))
    if (st.ready) { ready = true; break }
    // 品牌键入后等一下让候选刷新并选中
    if (st.acted) {
      await sleep(1200)
      await cur.evaluate(() => {
        const panels = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).filter(p => p.offsetParent !== null)
        const p = panels[panels.length - 1]
        if (!p) return
        const opt = Array.from(p.querySelectorAll('.options-item, li, [class*="option"]')).find(n => n.offsetParent !== null)
        if (opt) opt.click()
      }).catch(() => {})
    }
    await sleep(600)
  }

  console.log(`确认按钮可用：${ready}`)

  if (ready) {
    await cur.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
      const btn = Array.from(document.querySelectorAll('button, a')).find(b => /确认.*下一步/.test(norm(b.textContent)) && b.offsetParent !== null)
      if (btn) btn.click()
    }).catch(() => {})
  }

  // 等新标签页 / 跳转
  for (let i = 0; i < 20; i++) {
    await sleep(600)
    for (const p of await browser.pages()) {
      const m = p.url().match(/catId=(\d+)/)
      if (m) {
        console.log(`\n★ catId=${m[1]}`)
        console.log(`URL：${p.url()}`)
        console.log(`\n下一步：node dev/publish-taobao-direct.mjs --catId=${m[1]} --confirm --brand=${BRAND || '<品牌>'}`)
        await browser.close().catch(() => {})
        process.exit(0)
      }
    }
  }
  console.log('\n未捕获 catId（确认按钮可能仍未可用，或该类目要求型号等属性）')
} catch (err) {
  console.error('探针异常：', err)
  process.exitCode = 1
} finally {
  await browser.close().catch(() => {})
}
