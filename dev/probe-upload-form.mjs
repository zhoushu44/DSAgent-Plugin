/**
 * 上传控件真机探针 v2：复用 v8 已验证段 1-3 流程（新标签页形态），然后探测：
 *   A. 枚举所有 input[type=file]
 *   B. 主图 uploadFile 直投 → 观察计数
 *   C. 若 B 无效：「本地上传」按钮 + waitForFileChooser
 *   D. 详情图直投 1 张
 *   E. 点「添加规格类型」→ dump 规格区形态
 * 只传 2 张图，不点提交，无不可逆副作用。
 */
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core')
const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir, tryAcquireProfile, releaseProfile } = await import('../lib/browser-login.js')

const KEYWORD = process.argv[2] || '童装'
const SHOPKEY = 'pdd_mms_1-eSLJh8boXfOooWozRRaJtxit9Ge0C51kkuF224B1xHqhDtLV90iBBQVzyvdg52'
const SRC = 'e:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/pdd-link-matrix/assets/src'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (m) => console.log(`[probe] ${m}`)

const cs = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const account = cs.listAccounts().find(a => a.shop_key === SHOPKEY)
const dir = profileDir('pdd_mms', SHOPKEY)
if (!tryAcquireProfile(dir, '上传探针')) { console.error('Profile 被占用'); process.exit(1) }

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
  log(`已注入 ${cookieList.length} 个 Cookie`)

  // ── 段 1-3（v8 同款） ──
  await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(4000)
  const t0 = Date.now()
  while (Date.now() - t0 < 60000) {
    const ok = await page.evaluate(() => /商品列表/.test(document.title || '') || /发布新商品/.test(document.body?.innerText || '')).catch(() => false)
    if (ok) break
    await sleep(2000)
  }
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
  })
  log(`入口点击：${entryClicked}`)
  const step1 = await waitForPage(/\/goods\/category\?/, 60000)
  if (!step1) throw new Error('类目选择页未出现')
  await step1.bringToFront().catch(() => {})
  log(`类目页：${step1.url()}`)
  const t1 = Date.now()
  while (Date.now() - t1 < 30000) {
    if (await step1.evaluate(sel => !!document.querySelector(sel), 'input[placeholder*="搜索分类"]').catch(() => false)) break
    await sleep(2000)
  }
  const inputHandle = await step1.$('input[placeholder*="搜索分类"]')
  await inputHandle.click({ delay: 30 }).catch(() => {})
  await step1.keyboard.type(KEYWORD, { delay: 120 })
  await sleep(3500)
  const picked = await step1.evaluate(kw => {
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
  log(`点选类目：${picked}`)
  await sleep(800)
  await step1.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === '确认发布该类商品')
    if (btn && !btn.disabled) btn.click()
  })
  const step2 = await waitForPage(/\/goods\/goods_add\//, 25000)
  if (!step2) throw new Error('表单页未出现')
  await step2.bringToFront().catch(() => {})
  log(`表单页：${step2.url()}`)
  const t2 = Date.now()
  while (Date.now() - t2 < 60000) {
    if (await step2.evaluate(() => !!document.querySelector('input[data-tracking-click-viewid="title_input_area"], #goods-category')).catch(() => false)) break
    await sleep(2000)
  }
  log('表单页就绪')
  await sleep(4000)

  // ── A. 枚举 file input ──
  const inputs = await step2.evaluate(() => Array.from(document.querySelectorAll('input[type=file]')).map((el, i) => {
    const r = el.getBoundingClientRect()
    return {
      i,
      viewid: el.getAttribute('data-tracking-click-viewid') || '',
      multiple: el.multiple,
      visible: r.width > 0 || r.height > 0,
      rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
    }
  }))
  log(`file input 枚举（${inputs.length} 个）：`)
  for (const x of inputs) log(`  [${x.i}] viewid=${x.viewid} multiple=${x.multiple} visible=${x.visible} rect=${x.rect}`)

  const bodyTxt = () => step2.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 5000))
  const before = await bodyTxt()

  // ── B. 主图 uploadFile 直投 ──
  const mainInput = await step2.$('input[data-tracking-click-viewid="carousel_img_localfile_upload"]')
  if (mainInput) {
    await mainInput.uploadFile(join(SRC, 'main_06.jpg')).catch(e => log(`主图直投异常：${e.message}`))
    log('主图直投完成，等 12s…')
    await sleep(12000)
    const after = await bodyTxt()
    const cnt = (after.match(/\(\s*(\d+)\s*\/\s*10\s*\)/) || [])[1]
    log(`主图直投结果：计数=${cnt ?? '无'} 页面变化=${after !== before}`)
  } else log('未找到主图 input')

  // ── C. 主图 file chooser 路径（B 无计数时） ──
  const cntNow = ((await bodyTxt()).match(/\(\s*(\d+)\s*\/\s*10\s*\)/) || [])[1]
  if (!cntNow) {
    log('直投无效 → 试 file chooser 路径')
    const btnFound = await step2.evaluate(() => {
      const els = Array.from(document.querySelectorAll('div,span,button')).filter(e => {
        const t = (e.innerText || '').trim()
        return /本地上传|上传图片|点击上传/.test(t) && t.length < 20 && e.getBoundingClientRect().height > 0
      })
      if (!els.length) return ''
      els[0].scrollIntoView({ block: 'center' })
      els[0].click()
      return els[0].innerText.trim().slice(0, 30)
    })
    log(`上传按钮：${btnFound || '未找到'}`)
    if (btnFound) {
      try {
        const chooser = await step2.waitForFileChooser({ timeout: 8000 })
        await chooser.accept([join(SRC, 'main_07.jpg')])
        log('chooser 已接受文件，等 12s…')
        await sleep(12000)
        const cnt2 = ((await bodyTxt()).match(/\(\s*(\d+)\s*\/\s*10\s*\)/) || [])[1]
        log(`chooser 路径结果：计数=${cnt2 ?? '无'}`)
      } catch (e) { log(`chooser 路径失败：${e.message}`) }
    }
  }

  // ── D. 详情图直投 1 张 ──
  const detInput = await step2.$('input[data-tracking-click-viewid="detail_img_localfile_upload"]')
  if (detInput) {
    const b4 = await bodyTxt()
    await detInput.uploadFile(join(SRC, 'detail_10.jpg')).catch(e => log(`详情图直投异常：${e.message}`))
    await sleep(12000)
    const af = await bodyTxt()
    const m = af.match(/已上传\s*(\d+)\s*\/\s*(\d+)\s*张/)
    log(`详情图直投结果：计数=${m ? `${m[1]}/${m[2]}` : '无'} 页面变化=${af !== b4}`)
  } else log('未找到详情图 input')

  // ── E. 规格区形态 ──
  const addClicked = await step2.evaluate(() => {
    const els = Array.from(document.querySelectorAll('div,span,button')).filter(e => {
      const t = (e.innerText || '').trim()
      return /^添加规格类型/.test(t) && e.getBoundingClientRect().height > 0
    })
    if (!els.length) return false
    els[0].scrollIntoView({ block: 'center' })
    els[0].click()
    return true
  })
  log(`点「添加规格类型」：${addClicked}`)
  await sleep(3500)
  const specDump = await step2.evaluate(() => {
    for (const s of ['.goods-spec', '[class*="spec"]', '[class*="Spec"]']) {
      const el = document.querySelector(s)
      if (el) return `容器=${s}\n${el.outerHTML.slice(0, 2200)}`
    }
    return '（找不到规格容器）'
  })
  log(`规格区 dump：\n${specDump}`)
  await step2.screenshot({ path: 'dev/.ui-shots/probe-upload-final.png' }).catch(() => {})
} catch (e) {
  log(`探针异常：${e.message}`)
} finally {
  await browser.close().catch(() => {})
  await sleep(2000)
  releaseProfile(dir, '上传探针')
  log('结束')
}
