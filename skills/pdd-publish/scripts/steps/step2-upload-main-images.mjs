/**
 * step2-upload-main-images.mjs — 步骤二：上传商品主图
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ 页面结构（实测 2026-11-08）                                   │
 * │                                                              │
 * │ <section class="goodsCarousel_uploadImgEnter__9UMu8">        │
 * │   <div class="goodsCarousel_originEnter__2jOqr">             │
 * │     <div class="goodsCarousel_uploadBtnText__VERV7">上传图片</div>
 * │     <div class="goodsCarousel_selected__1bK2N">(2/10)</div>  │ ← 计数器
 * │   </div>                                                     │
 * │   <section class="goodsCarousel_btns__22KMn"                 │
 * │            style="display: none;">                           │
 * │     <button>图片空间上传</button>                             │
 * │     <span class="MmsUiUploadPicVideoButton___fileButton___">  │
 * │       <button>                                               │
 * │         <span>本地上传</span>                                 │
 * │         <input type="file" accept="image/jpeg,image/png"     │ ← 上传入口
 * │                multiple>                                     │
 * │       </button>                                              │
 * │     </span>                                                  │
 * │   </section>                                                 │
 * │ </section>                                                   │
 * │                                                              │
 * │ 规则：                                                       │
 * │   · 每上传成功 1 张，(N/10) 的 N 递增 1                       │
 * │   · 上限 10 张，下限 1 张                                     │
 * └──────────────────────────────────────────────────────────────┘
 *
 * 用法：
 *   import { uploadMainImages, readMainImageCount } from './step2-upload-main-images.mjs'
 *
 *   const r = await uploadMainImages(page, {
 *     files: ['E:/a.png', 'E:/b.png'],
 *   })
 *   // r = { ok, before, after, uploaded, errors }
 *
 * 命令行：
 *   node step2-upload-main-images.mjs --shop <shopKey> --files "a.png,b.png"
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..', '..')

// ═══════════════════════════════════════════════════════════════════
//  XPath 定义
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
//  ★ 核心 XPath：靠「上传图片」这段文字定位
//     页面上每个图片区都有一个文本为「上传图片」的 div，
//     从它往上找最近的 section（该图片区的容器），
//     再在容器内找 input[type=file]。
//     这样主图 / 详情图 / 白底图 都能用同一套逻辑。
// ═══════════════════════════════════════════════════════════════════

/** 锚点：文本为「上传图片」的元素（可能有多个，按 index 选第几个区域） */
const XP_ANCHOR = '//*[normalize-space(text())="上传图片"]'

/** 从锚点往上找区域容器（section / div 均可） */
const XP_REGION_FROM_ANCHOR = 'ancestor::section[1]'

/** 区域内的计数器（形如 (2/10)） */
const XP_COUNTER_IN_REGION = './/*[contains(@class,"goodsCarousel_selected")]'

/** 区域内的文件 input */
const XP_FILE_INPUT = './/input[@type="file" and (contains(@accept,"jpeg") or contains(@accept,"png"))]'

/** 上限 / 下限 */
const MAX_IMAGES = 10
const MIN_IMAGES = 1

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ═══════════════════════════════════════════════════════════════════
//  底层：XPath 取值
// ═══════════════════════════════════════════════════════════════════

/**
 * 读主图计数，返回 { got, max, text }
 */
export async function readMainImageCount(page, index = 0) {
  return page.evaluate((args) => {
    const { xpAnchor, xpRegion, xpCounter, idx } = args
    // 1) 找所有「上传图片」锚点
    const snap = document.evaluate(xpAnchor, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
    if (snap.snapshotLength === 0) return { got: 0, max: 0, text: '', found: false, reason: '找不到「上传图片」文本' }
    const anchor = snap.snapshotItem(idx)
    if (!anchor) return { got: 0, max: 0, text: '', found: false, reason: `锚点总数 ${snap.snapshotLength}，取不到第 ${idx} 个` }

    // 2) 从锚点往上找区域
    const regRes = document.evaluate(xpRegion, anchor, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    const region = regRes.singleNodeValue || anchor.parentElement
    if (!region) return { got: 0, max: 0, text: '', found: false, reason: '锚点没有父容器' }

    // 3) 区域内找计数器
    const cRes = document.evaluate(xpCounter, region, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    const cEl = cRes.singleNodeValue
    const text = cEl ? (cEl.textContent || '').trim() : ''
    const m = text.match(/\((\d+)\s*\/\s*(\d+)\)/)
    return {
      got: m ? Number(m[1]) : 0,
      max: m ? Number(m[2]) : 10,
      text,
      found: m !== null,
      anchorCount: snap.snapshotLength,
      reason: m ? '' : '区域内没找到 (N/M) 计数器',
    }
  }, { xpAnchor: XP_ANCHOR, xpRegion: XP_REGION_FROM_ANCHOR, xpCounter: XP_COUNTER_IN_REGION, idx: index })
    .catch(e => ({ got: 0, max: 0, text: '', found: false, reason: 'evaluate 异常: ' + String(e.message).slice(0, 80) }))
}

/**
 * 等主图区出现
 */
export async function waitMainImageRegion(page, timeoutMs = 60000, index = 0) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const n = await page.evaluate((args) => {
      const snap = document.evaluate(args.xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
      return snap.snapshotLength
    }, { xp: XP_ANCHOR }).catch(() => 0)
    if (n > index) return true
    await sleep(2000)
  }
  return false
}

/**
 * 通过 XPath 拿到主图区的 file input 句柄
 */
async function getMainImageFileInput(page, index = 0) {
  // ① 从「上传图片」锚点往上找区域，区域内找 input
  const regionHandle = await page.evaluateHandle((args) => {
    const snap = document.evaluate(args.xpAnchor, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
    const anchor = snap.snapshotItem(args.idx)
    if (!anchor) return null
    const regRes = document.evaluate(args.xpRegion, anchor, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    return regRes.singleNodeValue || anchor.parentElement
  }, { xpAnchor: XP_ANCHOR, xpRegion: XP_REGION_FROM_ANCHOR, idx: index }).catch(() => null)

  const region = regionHandle ? regionHandle.asElement() : null
  if (region) {
    const input = await region.$(XP_FILE_INPUT).catch(() => null)
    if (input) return input
  }

  // ② 兜底：全局找第 index 个图片 input
  const all = await page.$$('input[type="file"]')
  const imgInputs = []
  for (const h of all) {
    const accept = await page.evaluate(el => el.accept || '', h).catch(() => '')
    if (/jpeg|png/i.test(accept)) imgInputs.push(h)
  }
  return imgInputs[index] || imgInputs[0] || null
}

// ═══════════════════════════════════════════════════════════════════
//  主函数
// ═══════════════════════════════════════════════════════════════════

/**
 * 上传商品主图
 *
 * @param {object} page
 * @param {object} opts
 * @param {string[]} opts.files       本地图片绝对路径（1~10 张）
 * @param {number} [opts.timeoutMs]   等上传完成，默认 120000
 * @param {function} [opts.onProgress] (got, max) => void
 * @returns {Promise<{
 *   ok: boolean,
 *   before: number, after: number, uploaded: number,
 *   max: number, errors: string[]
 * }>}
 */
export async function uploadMainImages(page, opts = {}) {
  const result = { ok: false, before: 0, after: 0, uploaded: 0, max: MAX_IMAGES, errors: [] }

  // ── ① 校验入参 ────────────────────────────────────────────────
  const raw = Array.isArray(opts.files) ? opts.files.filter(Boolean) : []
  if (!raw.length) {
    result.errors.push('未提供任何图片文件')
    return result
  }

  const files = []
  for (const f of raw) {
    if (!fs.existsSync(f)) { result.errors.push(`文件不存在: ${f}`); continue }
    const st = fs.statSync(f)
    if (st.size > 3 * 1024 * 1024) {
      result.errors.push(`超过 3MB: ${path.basename(f)} (${(st.size / 1048576).toFixed(1)}MB)`)
      continue
    }
    if (!/\.(png|jpe?g)$/i.test(f)) {
      result.errors.push(`格式不支持（只收 jpg/png）: ${path.basename(f)}`)
      continue
    }
    files.push(f)
  }
  if (!files.length) {
    result.errors.push('没有合规的图片可上传')
    return result
  }

  // ── ② 等主图区 ────────────────────────────────────────────────
  const ready = await waitMainImageRegion(page, 30000)
  if (!ready) {
    result.errors.push(`找不到主图区（XPath: ${XP_REGION}）`)
    return result
  }

  // ── ③ 读上传前计数 ────────────────────────────────────────────
  const before = await readMainImageCount(page)
  if (!before.found) {
    result.errors.push(`主图区存在但找不到计数器（XPath: ${XP_COUNTER}）`)
    return result
  }
  result.before = before.got
  const max = before.max || MAX_IMAGES
  result.max = max

  if (before.got >= max) {
    result.errors.push(`主图已达上限 ${before.got}/${max}，需先删除再上传`)
    return result
  }

  const space = max - before.got
  const willUpload = files.slice(0, space)
  if (files.length > space) {
    result.errors.push(`空间不足：剩余 ${space} 个，本次只传前 ${space} 张`)
  }

  // ── ④ 找 input ────────────────────────────────────────────────
  const input = await getMainImageFileInput(page)
  if (!input) {
    result.errors.push('找不到主图区的 input[type=file]（本地上传入口）')
    return result
  }

  // ── ⑤ 塞文件（CDP DOM.setFileInputFiles，display:none 也能用）──
  try {
    await input.uploadFile(...willUpload)
  } catch (e) {
    result.errors.push('uploadFile 调用失败: ' + String(e?.message || e).slice(0, 150))
    return result
  }

  // ── ⑥ 等计数递增到目标（每传成功 1 张，N 递增 1）──────────────
  const want = before.got + willUpload.length
  const timeout = opts.timeoutMs ?? 120000
  const t0 = Date.now()
  let cur = before.got
  let lastText = before.text

  while (Date.now() - t0 < timeout) {
    await sleep(2000)
    const c = await readMainImageCount(page)
    if (c.found) {
      cur = c.got
      lastText = c.text
      if (typeof opts.onProgress === 'function') opts.onProgress(cur, max)
      if (cur >= want) break
    }
  }

  result.after = cur
  result.uploaded = cur - before.got
  result.ok = result.uploaded > 0 && result.after >= MIN_IMAGES && result.after <= MAX_IMAGES

  if (result.uploaded <= 0) {
    result.errors.push(`计数未变（${before.got} → ${cur}，当前显示 ${lastText}）。可能：图片不合规 / 页面未响应 / 上传被拦`)
  } else if (result.uploaded < willUpload.length) {
    result.errors.push(`只成功 ${result.uploaded}/${willUpload.length} 张（${before.got} → ${cur}）`)
  }

  if (result.after < MIN_IMAGES) {
    result.errors.push(`主图数量 ${result.after} 低于下限 ${MIN_IMAGES}`)
    result.ok = false
  }
  if (result.after > MAX_IMAGES) {
    result.errors.push(`主图数量 ${result.after} 超过上限 ${MAX_IMAGES}`)
    result.ok = false
  }

  return result
}

/**
 * 校验当前主图数量是否满足「1 ≤ N ≤ 10」
 */
export async function validateMainImageCount(page) {
  const c = await readMainImageCount(page)
  const ok = c.found && c.got >= MIN_IMAGES && c.got <= MAX_IMAGES
  return { ...c, ok, min: MIN_IMAGES, max: MAX_IMAGES }
}

// ═══════════════════════════════════════════════════════════════════
//  CLI
// ═══════════════════════════════════════════════════════════════════
if (process.argv[1] && process.argv[1].endsWith('step2-upload-main-images.mjs')) {
  const argv = process.argv.slice(2)
  const arg = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 ? String(argv[i + 1] ?? d) : d }

  const shopKey = arg('shop', 'pdd_mms_2b1bca962e5fba5172e3edc19a09e406')
  const filesArg = arg('files', '')
  const files = filesArg ? filesArg.split(',').map(s => s.trim()).filter(Boolean) : []

  if (!files.length) {
    console.error('❌ 需 --files "a.png,b.png"')
    process.exit(1)
  }

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

  console.log('当前页面:', page.url().slice(0, 100))
  const before = await readMainImageCount(page)
  console.log('上传前:', before.text, `(${before.got}/${before.max})`)

  const r = await uploadMainImages(page, {
    files,
    onProgress: (n, m) => console.log(`  进度 ${n}/${m}`),
  })

  console.log('')
  console.log('结果:', JSON.stringify(r, null, 2))
  if (!r.ok) process.exit(1)

  console.log('\n浏览器保持打开 30 分钟')
  await sleep(1800000)
}



