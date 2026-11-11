/**
 * step3-fill-title.mjs — 步骤三：填写商品标题
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ 页面结构                                                     │
 * │                                                              │
 * │ <div class="Form_itemContentBody_5-194-0">                   │
 * │   <input placeholder="商品标题组成：商品描述+规格，           │
 * │          最多输入30个汉字（60个字符）"                        │
 * │          maxlength="60" value="">                            │
 * │ </div>                                                       │
 * │                                                              │
 * │ 规则：                                                       │
 * │   · 最多 30 个汉字（60 个字符）                                │
 * │   · 中文按 1 个字算，超了平台直接拒                            │
 * │   · 必须走 React 的 native setter + input 事件               │
 * └──────────────────────────────────────────────────────────────┘
 *
 * 用法：
 *   import { fillTitle, readTitle, validateTitle } from './step3-fill-title.mjs'
 *
 *   const r = await fillTitle(page, { title: '双层中空纸杯一次性咖啡杯' })
 *   // r = { ok, value, cjk, len, errors }
 *
 * 命令行：
 *   node step3-fill-title.mjs --title "双层中空纸杯"
 */
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..', '..')

// ═══════════════════════════════════════════════════════════════════
//  XPath 定义
// ═══════════════════════════════════════════════════════════════════

/** 标题输入框：靠 placeholder 文本定位 */
const XP_TITLE_INPUT = '//input[contains(@placeholder,"商品标题组成")]'

/** 兜底：靠 maxlength=60 定位 */
const XP_TITLE_INPUT_BACKUP = '//input[@maxlength="60" and contains(@placeholder,"标题")]'

/** 限制 */
const MAX_CJK = 30
const MAX_CHARS = 60

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ═══════════════════════════════════════════════════════════════════
//  读 / 校验
// ═══════════════════════════════════════════════════════════════════

/** 读当前标题 */
export async function readTitle(page) {
  return page.evaluate((args) => {
    let el = document.evaluate(args.xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    if (!el) el = document.evaluate(args.xpBak, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    if (!el) return { found: false, value: '' }
    return {
      found: true,
      value: el.value || '',
      maxlength: el.getAttribute('maxlength') || '',
      placeholder: el.getAttribute('placeholder') || '',
    }
  }, { xp: XP_TITLE_INPUT, xpBak: XP_TITLE_INPUT_BACKUP })
    .catch(e => ({ found: false, value: '', err: String(e.message).slice(0, 80) }))
}

/** 汉字数 / 总字符数 */
export function countTitle(s) {
  const str = String(s || '')
  const cjk = (str.match(/[\u4e00-\u9fa5]/g) || []).length
  return { cjk, len: str.length }
}

/** 校验标题是否合规（不改 DOM） */
export function validateTitle(title) {
  const { cjk, len } = countTitle(title)
  const errors = []
  if (!String(title || '').trim()) errors.push('标题为空')
  if (cjk > MAX_CJK) errors.push(`汉字 ${cjk} 个，超过上限 ${MAX_CJK}`)
  if (len > MAX_CHARS) errors.push(`字符 ${len} 个，超过上限 ${MAX_CHARS}`)
  return { ok: errors.length === 0, cjk, len, maxCjk: MAX_CJK, maxChars: MAX_CHARS, errors }
}

// ═══════════════════════════════════════════════════════════════════
//  填写
// ═══════════════════════════════════════════════════════════════════

/**
 * 填写商品标题
 *
 * @param {object} page
 * @param {object} opts
 * @param {string} opts.title   标题文本
 * @param {boolean} [opts.verify=true]  填完回读确认
 * @returns {Promise<{ok:boolean, value:string, cjk:number, len:number, errors:string[]}>}
 */
export async function fillTitle(page, opts = {}) {
  const title = String(opts.title ?? '')
  const result = { ok: false, value: '', cjk: 0, len: 0, errors: [] }

  // ── ① 先做本地校验（不合规不碰页面）──────────────────────────
  const v = validateTitle(title)
  result.cjk = v.cjk
  result.len = v.len
  if (!v.ok) {
    result.errors = v.errors.slice()
    return result
  }

  // ── ② 找输入框 ──────────────────────────────────────────────
  const handle = await page.evaluateHandle((args) => {
    let el = document.evaluate(args.xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    if (!el) el = document.evaluate(args.xpBak, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    return el
  }, { xp: XP_TITLE_INPUT, xpBak: XP_TITLE_INPUT_BACKUP }).catch(() => null)

  const input = handle ? handle.asElement() : null
  if (!input) {
    result.errors.push(`找不到标题输入框（XPath: ${XP_TITLE_INPUT}）`)
    return result
  }

  // ── ③ 滚入视野 + 聚焦 ───────────────────────────────────────
  await page.evaluate(el => {
    el.scrollIntoView({ block: 'center' })
    el.focus()
  }, input).catch(() => { })

  // ── ④ 用 React native setter 写值 + 派发事件 ─────────────────
  const written = await page.evaluate((el, val) => {
    // React 受控组件必须用原型上的 setter，否则 React 不认
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    el.focus()
    if (setter) setter.call(el, val)
    else el.value = val
    // 三个事件都要发：input（React onChange）、change、blur
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new Event('blur', { bubbles: true }))
    return el.value
  }, input, title).catch(e => {
    result.errors.push('写值失败: ' + String(e.message).slice(0, 100))
    return null
  })

  if (written === null) return result

  // ── ⑤ 回读确认 ──────────────────────────────────────────────
  if (opts.verify !== false) {
    await sleep(800)
    const cur = await readTitle(page)
    result.value = cur.value
    if (cur.value !== title) {
      // 二次尝试：用键盘输入覆盖
      try {
        await input.click({ clickCount: 3 }).catch(() => { })
        await page.keyboard.press('Backspace').catch(() => { })
        await page.keyboard.type(title, { delay: 30 })
        await sleep(600)
        const again = await readTitle(page)
        result.value = again.value
      } catch { /* ignore */ }
    }
    if (result.value !== title) {
      result.errors.push(`回读不一致：期望"${title}"，实际"${result.value}"`)
      return result
    }
  } else {
    result.value = written
  }

  result.ok = true
  return result
}

// ═══════════════════════════════════════════════════════════════════
//  CLI
// ═══════════════════════════════════════════════════════════════════
if (process.argv[1] && process.argv[1].endsWith('step3-fill-title.mjs')) {
  const argv = process.argv.slice(2)
  const arg = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 ? String(argv[i + 1] ?? d) : d }

  const shopKey = arg('shop', 'pdd_mms_2b1bca962e5fba5172e3edc19a09e406')
  const title = arg('title', '')
  if (!title) { console.error('❌ 需 --title "标题"'); process.exit(1) }

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
  console.log('填写前:', JSON.stringify(await readTitle(page)))

  const r = await fillTitle(page, { title })
  console.log('结果:', JSON.stringify(r, null, 1))

  if (!r.ok) process.exit(1)
  console.log('\n浏览器保持 30 分钟')
  await sleep(1800000)
}
