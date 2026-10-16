/**
 * 主图上传专项探针 v3：
 *   1. dump 主图区（「轮播图」文本附近）DOM 结构 → 看上传热区形态（tab/按钮）
 *   2. 挂网络监听（POST /upload 类请求）→ 判断直投是否真的发出上传请求
 *   3. 依次尝试：carousel input 直投 → 点「本地上传」热区后再投 → 离屏 input（-999）直投
 *   4. 每步做精确文本 diff（新增行）+ 计数 + 缩略图 img 数量
 * 只传图不提交，无不可逆副作用。
 */
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core')
const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir, tryAcquireProfile, releaseProfile } = await import('../lib/browser-login.js')

const KEYWORD = '童装'
const SHOPKEY = 'pdd_mms_1-eSLJh8boXfOooWozRRaJtxit9Ge0C51kkuF224B1xHqhDtLV90iBBQVzyvdg52'
const SRC = 'e:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/pdd-link-matrix/assets/src'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (m) => console.log(`[probe3] ${m}`)

const cs = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const account = cs.listAccounts().find(a => a.shop_key === SHOPKEY)
const dir = profileDir('pdd_mms', SHOPKEY)
if (!tryAcquireProfile(dir, '主图探针v3')) { console.error('Profile 被占用'); process.exit(1) }

const browser = await puppeteer.launch({
  headless: false,
  executablePath: findChromePath(),
  userDataDir: dir,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})
log('Chrome 已启动')

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

/** 精确 diff：返回 after 相比 before 新增/消失的文本行 */
const diffLines = (before, after) => {
  const b = new Set(before.split('\n').map(s => s.trim()).filter(Boolean))
  const a = new Set(after.split('\n').map(s => s.trim()).filter(Boolean))
  const added = [...a].filter(x => !b.has(x))
  const removed = [...b].filter(x => !a.has(x))
  return { added: added.slice(0, 12), removed: removed.slice(0, 6) }
}

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })
  const accountCookies = account.cookies || {}
  const cookieList = Object.entries(accountCookies)
    .filter(([, v]) => v !== '' && v != null)
    .flatMap(([name, value]) => ([
      { name, value: String(value), domain: '.pinduoduo.com', path: '/' },
      { name, value: String(value), domain: 'mms.pinduoduo.com', path: '/' },
    ]))
  if (cookieList.length) await page.setCookie(...cookieList)

  // ── 段 1-3（v8 同款） ──
  await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(4000)
  const t0 = Date.now()
  while (Date.now() - t0 < 60000) {
    const ok = await page.evaluate(() => /商品列表/.test(document.title || '') || /发布新商品/.test(document.body?.innerText || '')).catch(() => false)
    if (ok) break
    await sleep(2000)
  }
  await page.evaluate(() => {
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
  })
  const step1 = await waitForPage(/\/goods\/category\?/, 60000)
  if (!step1) throw new Error('类目选择页未出现')
  await step1.bringToFront().catch(() => {})
  const t1 = Date.now()
  while (Date.now() - t1 < 30000) {
    if (await step1.evaluate(sel => !!document.querySelector(sel), 'input[placeholder*="搜索分类"]').catch(() => false)) break
    await sleep(2000)
  }
  const inputHandle = await step1.$('input[placeholder*="搜索分类"]')
  await inputHandle.click({ delay: 30 }).catch(() => {})
  await step1.keyboard.type(KEYWORD, { delay: 120 })
  await sleep(3500)
  await step1.evaluate(kw => {
    const items = (Array.from(document.querySelectorAll('li, span, div')))
      .filter(el => {
        const r = el.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return false
        const t = (el.innerText || '').trim()
        return (t === kw || t.includes(kw)) && t.length < 35 && t.split('\n').length === 1 && !/教程|课程|已学习/.test(t)
      })
    if (!items.length) return ''
    const inner = items.filter(e => !items.some(o => o !== e && e.contains(o)))
    const el = inner.find(e => /cate/i.test(e.className)) || inner[0]
    el.click()
    return (el.innerText || '').trim().slice(0, 60)
  }, KEYWORD)
  await sleep(800)
  await step1.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === '确认发布该类商品')
    if (btn && !btn.disabled) btn.click()
  })
  const step2 = await waitForPage(/\/goods\/goods_add\//, 25000)
  if (!step2) throw new Error('表单页未出现')
  await step2.bringToFront().catch(() => {})
  const t2 = Date.now()
  while (Date.now() - t2 < 60000) {
    if (await step2.evaluate(() => !!document.querySelector('input[data-tracking-click-viewid="title_input_area"], #goods-category')).catch(() => false)) break
    await sleep(2000)
  }
  log('表单页就绪')
  await sleep(4000)

  // ── 0. 网络监听 ──
  const netLog = []
  step2.on('request', r => {
    const u = r.url()
    if (r.method() === 'POST' && /upload|material|media|file|img/i.test(u)) netLog.push(u.slice(0, 150))
  })

  const bodyTxt = () => step2.evaluate(() => document.body?.innerText || '')

  // ── 1. dump 主图区 DOM ──
  const mainDump = await step2.evaluate(() => {
    const label = Array.from(document.querySelectorAll('div,span,label'))
      .find(e => /轮播图/.test((e.innerText || '').trim()) && (e.innerText || '').trim().length < 30)
    if (!label) return '（找不到「轮播图」文本）'
    let box = label
    for (let i = 0; i < 5 && box.parentElement; i++) box = box.parentElement
    // 收集上传相关要素
    const info = {
      labelText: (label.innerText || '').trim(),
      tabs: Array.from(box.querySelectorAll('div,span')).map(e => (e.innerText || '').trim())
        .filter(t => t && t.length <= 12 && /本地上传|图片空间|上传|拖拽|粘贴/.test(t)).slice(0, 10),
      buttons: Array.from(box.querySelectorAll('button')).map(b => (b.innerText || '').trim()).filter(Boolean).slice(0, 10),
      imgCount: box.querySelectorAll('img').length,
      firstImgSrcs: Array.from(box.querySelectorAll('img')).slice(0, 5).map(i => (i.src || '').slice(-60)),
    }
    return JSON.stringify(info, null, 1) + '\n--- outerHTML 片段 ---\n' + box.outerHTML.replace(/\s+/g, ' ').slice(0, 3000)
  })
  log(`主图区 dump：\n${mainDump}`)

  // ── 2. 路径 A：carousel input 直投 + 网络监听 ──
  const beforeA = await bodyTxt()
  netLog.length = 0
  const mainInput = await step2.$('input[data-tracking-click-viewid="carousel_img_localfile_upload"]')
  if (mainInput) {
    await mainInput.uploadFile(join(SRC, 'main_06.jpg')).catch(e => log(`A 直投异常：${e.message}`))
    await sleep(10000)
    const afterA = await bodyTxt()
    const dA = diffLines(beforeA, afterA)
    const cntA = (afterA.match(/\(\s*(\d+)\s*\/\s*10\s*\)/) || [])[1]
    const thumbsA = await step2.evaluate(() => {
      const label = Array.from(document.querySelectorAll('div,span,label'))
        .find(e => /轮播图/.test((e.innerText || '').trim()) && (e.innerText || '').trim().length < 30)
      if (!label) return 0
      let box = label
      for (let i = 0; i < 5 && box.parentElement; i++) box = box.parentElement
      return box.querySelectorAll('img').length
    })
    log(`路径A（carousel直投）：计数=${cntA ?? '无'} 缩略图=${thumbsA} 上传请求=${netLog.length}条`)
    if (netLog.length) netLog.slice(0, 3).forEach(u => log(`  REQ ${u}`))
    if (dA.added.length) log(`  新增文本：${JSON.stringify(dA.added)}`)
    if (dA.removed.length) log(`  消失文本：${JSON.stringify(dA.removed)}`)
  } else log('未找到 carousel input')

  // ── 3. 路径 B：点主图区「本地上传」热区 → 再直投 ──
  const beforeB = await bodyTxt()
  netLog.length = 0
  const hotClicked = await step2.evaluate(() => {
    const label = Array.from(document.querySelectorAll('div,span,label'))
      .find(e => /轮播图/.test((e.innerText || '').trim()) && (e.innerText || '').trim().length < 30)
    if (!label) return ''
    let box = label
    for (let i = 0; i < 5 && box.parentElement; i++) box = box.parentElement
    const hot = Array.from(box.querySelectorAll('div,span,button')).find(e => {
      const t = (e.innerText || '').trim()
      return /本地上传|点击上传|拖拽/.test(t) && t.length <= 30
    })
    if (!hot) return ''
    hot.scrollIntoView({ block: 'center' })
    hot.click()
    return (hot.innerText || '').trim().slice(0, 30)
  })
  log(`路径B：热区点击=${hotClicked || '未找到'}，1s 后再投`)
  await sleep(1000)
  const mainInput2 = await step2.$('input[data-tracking-click-viewid="carousel_img_localfile_upload"]')
  if (mainInput2 && hotClicked) {
    await mainInput2.uploadFile(join(SRC, 'main_07.jpg')).catch(e => log(`B 直投异常：${e.message}`))
    await sleep(10000)
    const afterB = await bodyTxt()
    const cntB = (afterB.match(/\(\s*(\d+)\s*\/\s*10\s*\)/) || [])[1]
    const dB = diffLines(beforeB, afterB)
    log(`路径B（热区后直投）：计数=${cntB ?? '无'} 上传请求=${netLog.length}条`)
    if (netLog.length) netLog.slice(0, 3).forEach(u => log(`  REQ ${u}`))
    if (dB.added.length) log(`  新增文本：${JSON.stringify(dB.added)}`)
  }

  // ── 4. 路径 C：离屏 input（rect<0，无 viewid）直投 ──
  const beforeC = await bodyTxt()
  netLog.length = 0
  const offInput = await step2.evaluateHandle(() => {
    return Array.from(document.querySelectorAll('input[type=file]'))
      .find(el => !el.getAttribute('data-tracking-click-viewid') && el.getBoundingClientRect().x < -100)
  })
  if (offInput && offInput.asElement()) {
    await offInput.asElement().uploadFile(join(SRC, 'main_08.jpg')).catch(e => log(`C 直投异常：${e.message}`))
    await sleep(10000)
    const afterC = await bodyTxt()
    const cntC = (afterC.match(/\(\s*(\d+)\s*\/\s*10\s*\)/) || [])[1]
    const dC = diffLines(beforeC, afterC)
    log(`路径C（离屏input）：计数=${cntC ?? '无'} 上传请求=${netLog.length}条`)
    if (netLog.length) netLog.slice(0, 3).forEach(u => log(`  REQ ${u}`))
    if (dC.added.length) log(`  新增文本：${JSON.stringify(dC.added)}`)
  } else log('路径C：未找到离屏 input')

  // ── 5. 终态：主图区缩略图 + 全部 file input 状态 ──
  const finalState = await step2.evaluate(() => {
    const label = Array.from(document.querySelectorAll('div,span,label'))
      .find(e => /轮播图/.test((e.innerText || '').trim()) && (e.innerText || '').trim().length < 30)
    let thumbInfo = '（无轮播图区）'
    if (label) {
      let box = label
      for (let i = 0; i < 5 && box.parentElement; i++) box = box.parentElement
      const imgs = Array.from(box.querySelectorAll('img'))
      thumbInfo = `缩略图=${imgs.length} srcs=${JSON.stringify(imgs.slice(0, 6).map(i => (i.src || '').slice(-50)))}`
    }
    const inputs = Array.from(document.querySelectorAll('input[type=file]')).map((el, i) => {
      const r = el.getBoundingClientRect()
      const files = el.files ? el.files.length : 0
      return `[${i}] viewid=${el.getAttribute('data-tracking-click-viewid') || '-'} files=${files} rect=${Math.round(r.x)},${Math.round(r.y)}`
    })
    return thumbInfo + '\n' + inputs.join('\n')
  })
  log(`终态：\n${finalState}`)
  await step2.screenshot({ path: 'dev/.ui-shots/probe3-final.png' }).catch(() => {})
} catch (e) {
  log(`探针异常：${e.message}`)
} finally {
  await browser.close().catch(() => {})
  await sleep(2000)
  releaseProfile(dir, '主图探针v3')
  log('结束')
}
