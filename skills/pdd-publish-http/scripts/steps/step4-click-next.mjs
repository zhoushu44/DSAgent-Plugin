/**
 * step4-click-next.mjs — 步骤四：点击「下一步，完善商品信息」
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ 按钮结构                                                     │
 * │                                                              │
 * │ <button id="bottomSubmitBtnId"                               │
 * │         data-tracking-impr-viewid=                           │
 * │           "confirm_publish_this_type_product"                │
 * │         class="BTN_outerWrapper_5-194-0 BTN_primary_5-194-0  │
 * │                BTN_large_5-194-0 ..."                        │
 * │         type="button">                                       │
 * │   <span>下一步, 完善商品信息</span>                           │
 * │ </button>                                                    │
 * │                                                              │
 * │ 点击后跳转：                                                  │
 * │   goods_add/index?type=add&from=category&version=predictCate  │
 * │                  &id=<catId>                                  │
 * │   → 第 2 步：规格 / 价格 / 属性 / 提交                         │
 * └──────────────────────────────────────────────────────────────┘
 *
 * 用法：
 *   import { clickNextStep, waitStep2Ready } from './step4-click-next.mjs'
 *
 *   const r = await clickNextStep(page)
 *   // r = { ok, url, catId, errors }
 */
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..', '..')

// ═══════════════════════════════════════════════════════════════════
//  XPath 定义
// ═══════════════════════════════════════════════════════════════════

/** 主定位：按钮 id */
const XP_NEXT_BTN = '//button[@id="bottomSubmitBtnId"]'

/** 兜底：靠文本「下一步」 */
const XP_NEXT_BTN_TEXT =
  '//button[contains(normalize-space(.),"下一步") and contains(normalize-space(.),"完善商品信息")]'

/** 第 2 步就绪标志：规格区 / 提交按钮 / 价格表 任一出现 */
const XP_STEP2_MARKERS = [
  '#goods-spec-sku',
  'section[class*="specification"]',
  'div[class*="goodsCarousel"]',
]

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ═══════════════════════════════════════════════════════════════════
//  查找按钮
// ═══════════════════════════════════════════════════════════════════

/**
 * 找「下一步」按钮，返回 { handle, text, disabled, rect }
 */
async function findNextButton(page) {
  const handle = await page.evaluateHandle((args) => {
    let el = document.evaluate(args.xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    if (!el) el = document.evaluate(args.xpText, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    return el
  }, { xp: XP_NEXT_BTN, xpText: XP_NEXT_BTN_TEXT }).catch(() => null)

  const el = handle ? handle.asElement() : null
  if (!el) return null

  const info = await page.evaluate(b => {
    b.scrollIntoView({ block: 'center' })
    const r = b.getBoundingClientRect()
    return {
      text: (b.innerText || '').replace(/\s+/g, ' ').trim(),
      disabled: !!b.disabled || b.getAttribute('aria-disabled') === 'true',
      visible: r.width > 20 && r.height > 10,
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
    }
  }, el).catch(() => null)

  return info ? { handle: el, ...info } : null
}

// ═══════════════════════════════════════════════════════════════════
//  点完后检查是否被校验拦下
// ═══════════════════════════════════════════════════════════════════

/**
 * 读页面上的错误提示（如果有）
 */
async function readPageErrors(page) {
  return page.evaluate(() => {
    const out = []
    // 常见错误容器
    const sels = [
      '[class*="error"]',
      '[class*="Error"]',
      '[class*="toast"]',
      '[class*="Toast"]',
      '[class*="message"]',
      '[class*="Message"]',
    ]
    const seen = new Set()
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim()
        if (!t || t.length > 120) continue
        if (seen.has(t)) continue
        // 过滤掉非错误文案
        if (!/必填|不能为空|请填写|请上传|请选择|错误|失败|超|不合规|请输入/.test(t)) continue
        seen.add(t)
        out.push(t)
      }
    }
    return out.slice(0, 8)
  }).catch(() => [])
}

// ═══════════════════════════════════════════════════════════════════
//  等第 2 步就绪
// ═══════════════════════════════════════════════════════════════════

/**
 * 等第 2 步（规格/价格页）就绪
 * @returns {Promise<boolean>}
 */
export async function waitStep2Ready(page, timeoutMs = 90000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    // URL 变了
    const inStep2 = /goods_add\/index/.test(page.url())
    // 或页面出现规格区标记
    const hasMarker = await page.evaluate((sels) => {
      for (const s of sels) if (document.querySelector(s)) return true
      const t = document.body.innerText || ''
      return /规格与库存|价格及库存|商品规格/.test(t)
    }, XP_STEP2_MARKERS).catch(() => false)

    if (inStep2 || hasMarker) {
      // 再等 DOM 稳定
      await sleep(3000)
      const ready = await page.evaluate(() => {
        const t = document.body.innerText || ''
        return !/加载中/.test(t) && (/规格与库存|价格及库存|商品规格|提交并上架/.test(t))
      }).catch(() => false)
      if (ready) return true
    }
    await sleep(2500)
  }
  return false
}

// ═══════════════════════════════════════════════════════════════════
//  主函数
// ═══════════════════════════════════════════════════════════════════

/**
 * 点击「下一步，完善商品信息」
 *
 * @param {object} page
 * @param {object} [opts]
 * @param {boolean} [opts.waitReady=true]   点完等第 2 步就绪
 * @param {number}  [opts.timeoutMs=90000]  等就绪超时
 * @returns {Promise<{ok:boolean, url:string, catId:number, errors:string[], step2Ready:boolean}>}
 */
export async function clickNextStep(page, opts = {}) {
  const result = { ok: false, url: '', catId: 0, errors: [], step2Ready: false }

  // ── ① 找按钮 ────────────────────────────────────────────────
  const btn = await findNextButton(page)
  if (!btn) {
    result.errors.push('找不到「下一步，完善商品信息」按钮（XPath: //button[@id="bottomSubmitBtnId"]）')
    return result
  }
  if (!btn.visible) {
    result.errors.push(`按钮不可见（text="${btn.text}"）`)
    return result
  }
  if (btn.disabled) {
    result.errors.push(`按钮被禁用（说明第 1 步有必填项没填）`)
    const errs = await readPageErrors(page)
    if (errs.length) result.errors.push(...errs)
    return result
  }

  const urlBefore = page.url()

  // ── ② 点击 ──────────────────────────────────────────────────
  await page.mouse.click(btn.x, btn.y)
  await sleep(2500)

  // ── ③ 判断是否被校验拦下 ────────────────────────────────────
  const stillSameUrl = page.url() === urlBefore
  const errs = await readPageErrors(page)
  if (stillSameUrl && errs.length) {
    result.errors.push('点击后被校验拦下：', ...errs)
    return result
  }

  // ── ④ 等第 2 步就绪 ─────────────────────────────────────────
  if (opts.waitReady !== false) {
    result.step2Ready = await waitStep2Ready(page, opts.timeoutMs ?? 90000)
    if (!result.step2Ready) {
      const moreErrs = await readPageErrors(page)
      result.errors.push('点了「下一步」但等不到第 2 步（规格/价格页）')
      if (moreErrs.length) result.errors.push(...moreErrs)
      result.url = page.url()
      return result
    }
  }

  result.ok = true
  result.url = page.url()
  result.catId = Number((result.url.match(/[?&]id=(\d+)/) || [])[1] || 0)
  return result
}

// ═══════════════════════════════════════════════════════════════════
//  CLI
// ═══════════════════════════════════════════════════════════════════
if (process.argv[1] && process.argv[1].endsWith('step4-click-next.mjs')) {
  const argv = process.argv.slice(2)
  const arg = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 ? String(argv[i + 1] ?? d) : d }

  const shopKey = arg('shop', 'pdd_mms_2b1bca962e5fba5172e3edc19a09e406')
  const PROFILE = path.join(os.homedir(), '.dsh', 'browser-profiles', 'accounts', shopKey)
  const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href)

  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false, userDataDir: PROFILE, defaultViewport: null,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
    ignoreDefaultArgs: ['--enable-automation'], protocolTimeout: 600000,
  })

  const pages = await browser.pages()
  const page = pages.find(p => /goods\/category/.test(p.url())) || pages[0]

  console.log('页面:', page.url().slice(0, 90))
  const r = await clickNextStep(page)
  console.log('结果:', JSON.stringify(r, null, 1))

  if (!r.ok) process.exit(1)
  console.log('\n浏览器保持 30 分钟')
  await sleep(1800000)
}
