/**
 * v8 生产链路验证（2026-10-14，配合 pdd-publish.ts 新类目选择流程）
 *
 * 目的：验证重写后的段 1-3 能走通 —— 入口点击 → 类目搜索选择 → 同页跳转表单页。
 * ★ 安全边界：到「表单页就绪 + 表单页读回类目」为止，**不点任何提交按钮**，不产生真实副作用。
 *
 * 走生产同款路径：复用 credential-store 的账号与 Profile（browser-profiles/accounts/{shopKey}），
 * 不用临时目录 —— 这正是生产代码的启动方式（差异仅在于直接走 lib/pdd-publish.js 编译产物）。
 *
 * ★ 为最大化对齐生产逻辑，直接 import 生产模块 lib/pdd-publish.js 的内部无法做到（pddPublish
 *   是整链函数，会一路跑到提交）。因此本脚本手动复刻段 1-3 的关键步骤与锚点，逐段打点验证；
 *   任何一段失败都打印现场（URL + 页面文案前 400 字）便于定位。
 */
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core')

// ─── 生产同款常量（与 src/pdd-publish.ts 保持一致） ───────────────────────
const PDD_GOODS_LIST_URL = 'https://mms.pinduoduo.com/goods/goods_list'
const STEP1_URL_RE = /\/goods\/category\?/
const STEP2_URL_RE = /\/goods\/goods_add\//
const CATE_SEARCH_INPUT = 'input[placeholder*="搜索分类"]'
const CATE_CONFIRM_TEXT = '确认发布该类商品'
const STEP2_READY_SELECTOR = 'input[data-tracking-click-viewid="title_input_area"], #goods-category'

const KEYWORD = process.argv[2] || '童装'
const ACCOUNT = process.argv[3] || ''   // 可选：指定 shopKey 前缀过滤

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const PROFILES = join(homedir(), '.dsh', 'browser-profiles', 'accounts')

// ─── 挑账号：与生产同款（~/.dsh/dsagent-accounts.json + CredentialStore） ──
const store = await import('../lib/services/credential-store.js').catch(() => null)
if (!store) {
  console.error('❌ 无法加载 lib/services/credential-store.js —— 请先 npm run build:host')
  process.exit(1)
}
const Cred = store.CredentialStore
if (typeof Cred !== 'function') {
  console.error('❌ lib/services/credential-store.js 未导出 CredentialStore')
  process.exit(1)
}
const cs = new Cred(join(homedir(), '.dsh', 'dsagent-accounts.json'))

let accounts = []
try {
  accounts = cs.listAccounts().filter(a => a.platform === 'pdd_mms')
} catch (e) {
  console.error('listAccounts 调用失败:', e?.message || e)
}
if (!accounts?.length) {
  console.error('❌ 凭证库里没有 pdd_mms 账号')
  process.exit(1)
}
if (ACCOUNT) accounts = accounts.filter(a => String(a.shop_key || '').includes(ACCOUNT))
if (!accounts.length) {
  console.error(`❌ 没有匹配「${ACCOUNT}」的 pdd_mms 账号`)
  process.exit(1)
}
const account = accounts[0]
const dir = join(PROFILES, account.shop_key)
console.log(`[v8] 账号：${account.display_label || account.account_id}（${account.shop_key}）`)
console.log(`[v8] Profile：${dir}（存在=${existsSync(dir)}）`)

// ─── 启动（生产同款 launchOpts） ─────────────────────────────────────────
const findChromePath = (await import('../lib/browser-login.js')).findChromePath
const chromePath = findChromePath()
if (!chromePath) { console.error('❌ 未找到 Chrome/Edge'); process.exit(1) }

const browser = await puppeteer.launch({
  headless: false,
  executablePath: chromePath,
  userDataDir: dir,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})
console.log(`[v8] Chrome 已启动（${chromePath}）`)

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })

  // Cookie 注入（生产同款：.pinduoduo.com + mms.pinduoduo.com 双域）
  const accountCookies = account.cookies || {}
  const cookieList = Object.entries(accountCookies)
    .filter(([, v]) => v !== '' && v != null)
    .flatMap(([name, value]) => ([
      { name, value: String(value), domain: '.pinduoduo.com', path: '/' },
      { name, value: String(value), domain: 'mms.pinduoduo.com', path: '/' },
    ]))
  if (cookieList.length) await page.setCookie(...cookieList)
  console.log(`[v8] 已注入 ${cookieList.length} 个 Cookie（PASS_ID=${accountCookies.PASS_ID ? '有' : '★无'}）`)

  // ── 段 1：商品列表 → 点「发布新商品」 ─────────────────────────────────
  console.log(`[v8] 段 1 打开商品列表…`)
  await page.goto(PDD_GOODS_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await sleep(4000)

  // 列表就绪轮询（60s）
  const t0 = Date.now()
  let listReady = false
  while (Date.now() - t0 < 60_000) {
    listReady = await page.evaluate(() =>
      /商品列表/.test(document.title || '') || /发布新商品/.test(document.body?.innerText || ''))
      .catch(() => false)
    if (listReady) break
    await sleep(2000)
  }
  if (!listReady) {
    console.error('❌ 段 1 失败：60s 内商品列表未就绪（可能登录失效/滑块）')
    console.error('当前 URL:', page.url())
    process.exit(2)
  }
  console.log('[v8] 段 1 ✓ 商品列表就绪，点「发布新商品」…')

  // 生产同款入口点击（排除左侧导航）
  const entryClicked = await page.evaluate(() => {
    const NAV_SEL = 'nav, aside, [class*="sidenav"], [class*="sideNav"], [class*="menu"]'
    const all = (Array.from(document.querySelectorAll('button, a, div, span')))
      .filter(el => {
        const r = el.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return false
        if ((el.innerText || '').trim() !== '发布新商品') return false
        return !el.closest(NAV_SEL)
      })
    if (!all.length) return false
    const innermost = all.filter(e => !all.some(o => o !== e && e.contains(o)))
    const el = innermost.find(e => e.tagName === 'BUTTON') || innermost[innermost.length - 1]
    el.click()
    return true
  }).catch(() => false)
  if (!entryClicked) {
    console.error('❌ 段 1 失败：未找到「发布新商品」入口')
    process.exit(2)
  }
  console.log('[v8] 段 1 ✓ 入口已点击，等类目选择页（新标签页）…')

  // ── 段 2：类目选择页 → 搜索 → 选类目 → 确认 ─────────────────────────
  const waitForPage = async (re, timeoutMs) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const pages = await browser.pages()
      const hit = pages.find(p => re.test(String(p.url() || '')))
      if (hit) return hit
      await sleep(1000)
    }
    return null
  }

  const step1 = await waitForPage(STEP1_URL_RE, 60_000)
  if (!step1) {
    console.error('❌ 段 2 失败：60s 内未出现类目选择页（/goods/category）')
    process.exit(3)
  }
  await step1.bringToFront().catch(() => {})
  await step1.setViewport({ width: 1440, height: 900 }).catch(() => {})
  console.log('[v8] 段 2 ✓ 类目选择页已出现:', step1.url())

  // 就绪：类目搜索框
  const t1 = Date.now()
  let step1Ready = false
  while (Date.now() - t1 < 150_000) {
    step1Ready = await step1.evaluate(sel => !!document.querySelector(sel), CATE_SEARCH_INPUT).catch(() => false)
    if (step1Ready) break
    await sleep(2000)
  }
  if (!step1Ready) {
    console.error('❌ 段 2 失败：150s 内类目搜索框未出现')
    console.error('当前 URL:', step1.url())
    process.exit(3)
  }
  console.log('[v8] 段 2 ✓ 类目搜索框就绪')

  // selectCategory 复刻（生产逻辑同款）
  const inputHandle = await step1.$(CATE_SEARCH_INPUT).catch(() => null)
  if (!inputHandle) { console.error('❌ 段 2 失败：拿不到搜索框句柄'); process.exit(3) }
  await inputHandle.click({ delay: 30 }).catch(() => {})
  await step1.keyboard.type(KEYWORD, { delay: 120 })
  console.log(`[v8] 已输入关键词「${KEYWORD}」，等 3.5s 搜索结果…`)
  await sleep(3500)

  const picked = await step1.evaluate(kw => {
    const items = (Array.from(document.querySelectorAll('li, span, div')))
      .filter(el => {
        const r = el.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return false
        const t = (el.innerText || '').trim()
        return (t === kw || t.includes(kw)) && t.length < 35 && t.split('\n').length === 1
          && !/教程|课程|已学习/.test(t)
      })
    if (!items.length) return ''
    const inner = items.filter(e => !items.some(o => o !== e && e.contains(o)))
    const el = inner.find(e => /cate/i.test(e.className)) || inner[0]
    el.click()
    return (el.innerText || '').trim().slice(0, 60)
  }, KEYWORD).catch(() => '')
  if (!picked) {
    console.error(`❌ 段 2 失败：关键词「${KEYWORD}」无匹配搜索结果`)
    const txt = await step1.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 400)).catch(() => '')
    console.error('页面文案:', txt)
    process.exit(3)
  }
  console.log(`[v8] 段 2 ✓ 已点选类目：${picked}`)
  await sleep(800)

  const confirmed = await step1.evaluate(btnText => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => (b.innerText || '').trim() === btnText)
    if (!btn || btn.disabled) return false
    btn.click()
    return true
  }, CATE_CONFIRM_TEXT).catch(() => false)
  if (!confirmed) {
    console.error('❌ 段 2 失败：「确认发布该类商品」按钮不可点')
    process.exit(3)
  }
  console.log('[v8] 段 2 ✓ 已点「确认发布该类商品」，等同页跳转表单页…')

  // ── 段 3：同页跳转 → 表单页就绪 ────────────────────────────────────────
  const step2 = await waitForPage(STEP2_URL_RE, 25_000)
  if (!step2) {
    console.error('❌ 段 3 失败：25s 内未跳到表单页（/goods/goods_add/）')
    console.error('类目页当前 URL:', step1.url())
    process.exit(4)
  }
  await step2.bringToFront().catch(() => {})
  console.log('[v8] 段 3 ✓ 表单页已出现（同页跳转）:', step2.url())

  const t2 = Date.now()
  let step2Ready = false
  while (Date.now() - t2 < 150_000) {
    step2Ready = await step2.evaluate(sel => !!document.querySelector(sel), STEP2_READY_SELECTOR).catch(() => false)
    if (step2Ready) break
    await sleep(2000)
  }
  if (!step2Ready) {
    console.error('❌ 段 3 失败：表单页 150s 内未就绪')
    process.exit(4)
  }
  console.log('[v8] 段 3 ✓ 表单页就绪（标题输入框/类目展示区出现）')

  // 类目对账（生产段 4 读回逻辑）
  const cateText = await step2.evaluate(() => {
    const el = document.querySelector('#goods-category')
    return (el?.innerText || '').replace(/\s+/g, ' ').trim()
  }).catch(() => '')
  console.log(`[v8] 表单页读回类目：${cateText || '（无 #goods-category 元素，但就绪锚点已命中）'}`)

  // ★ 安全边界：到此为止。不点提交、不填任何字段。关页收尾。
  console.log('')
  console.log('════════════════════════════════════════════')
  console.log('✅ 段 1-3 全部走通：新发布链路验证通过（未提交，无真实副作用）')
  console.log(`   入口 → 类目选择（${picked}）→ 表单页就绪`)
  console.log('════════════════════════════════════════════')
} finally {
  console.log('[v8] 关闭浏览器…')
  await browser.close().catch(() => {})
  // 生产同款：等 Chrome 进程真正退出再还锁，避免下次启动撞 SingletonLock
  await sleep(2000)
}
