/**
 * step5-upload-white-bg.mjs — 步骤五：上传商品辅助图（白底图）
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ 页面结构（实测 2026-11-08）                                   │
 * │                                                              │
 * │ <div class="mui-form-group activity-materials-pic">          │
 * │   <label>商品辅助图</label>                                   │
 * │   <div class="goods-basic-materials-pic-wrapper-v2">         │
 * │     <div data-tracking-impr-viewid="upload_white_bg_img"     │
 * │          data-tracking-params="goods_id=...&goods_commit_id=...">
 * │       <div class="MaterialModalButton_v2_materialContainer">  │
 * │         <section>                                            │
 * │           <div class="uploadImgEnter">                       │ ← 点击区
 * │             <svg .../>                                       │
 * │             <div class="uploadBtnText">上传图片</div>          │ ← 文本锚点
 * │             <div class="markTitle">白底图</div>                │ ← ★ 白底图标识
 * │           </div>                                             │
 * │           <section class="uploadImgEnter uploadImgEnterNew"  │
 * │                    style="display: none;">                   │
 * │             <button>图片空间上传</button>                      │
 * │             <span class="MmsUiUploadPicVideoButton___fileButton">
 * │               <button>                                     │
 * │                 <span>本地上传</span>                        │
 * │                 <input type="file"                          │ ← 上传入口
 * │                        data-tracking-click-viewid=          │
 * │                          "white_bg_img_localfile_upload"    │ ★ 唯一标识
 * │                        accept="image/jpeg,image/png"        │
 * │                        multiple>                            │
 * │               </button>                                     │
 * │             </span>                                         │
 * │           </section>                                        │
 * │         </section>                                          │
 * │       </div>                                                │
 * │     </div>                                                  │
 * │   </div>                                                    │
 * │ </div>                                                      │
 * │                                                              │
 * │ 与主图区的区别：                                              │
 * │   · 没有 (N/M) 计数器                                         │
 * │   · 用 <div class="markTitle">白底图</div> 做标识              │
 * │   · input 的 data-tracking-click-viewid 含 white_bg_img      │
 * └──────────────────────────────────────────────────────────────┘
 *
 * 用法：
 *   import { uploadWhiteBg, readWhiteBgState } from './step5-upload-white-bg.mjs'
 *
 *   const r = await uploadWhiteBg(page, { files: ['E:/white.png'] })
 *   // r = { ok, uploaded, errors }
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

/** 锚点 1：文本为「白底图」的标识（最稳） */
const XP_ANCHOR_MARK = '//div[contains(@class,"markTitle") and normalize-space(text())="白底图"]'

/** 锚点 2（兜底）：data-tracking 属性含 upload_white_bg_img 的容器 */
const XP_ANCHOR_TRACK = '//div[@data-tracking-impr-viewid="upload_white_bg_img"]'

/** 从锚点找最近的上传区（uploadImgEnter） */
const XP_UPLOAD_ENTER = 'ancestor-or-self::div[contains(@class,"uploadImgEnter")][1]'

/** 从锚点找整个辅助图容器 */
const XP_BLOCK = 'ancestor::div[contains(@class,"goods-basic-materials-pic-wrapper-v2")][1]'

/** 区内的文件 input（白底图专用标识） */
const XP_FILE_INPUT_WHITE =
  './/input[@type="file" and contains(@data-tracking-click-viewid,"white_bg_img")]'

/** 区内任意图片 input（兜底） */
const XP_FILE_INPUT_ANY =
  './/input[@type="file" and (contains(@accept,"jpeg") or contains(@accept,"png"))]'

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ═══════════════════════════════════════════════════════════════════
//  读状态
// ═══════════════════════════════════════════════════════════════════

/**
 * 读白底图当前状态
 * @returns {Promise<{found:boolean, hasImage:boolean, imgUrl:string, statusText:string}>}
 */
export async function readWhiteBgState(page) {
  return page.evaluate((args) => {
    // 找锚点
    let anchor = document.evaluate(args.xpMark, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    let block = null
    if (anchor) {
      const bres = document.evaluate(args.xpBlock, anchor, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      block = bres.singleNodeValue
    }
    if (!block) {
      const tres = document.evaluate(args.xpTrack, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      block = tres.singleNodeValue
    }
    if (!block) return { found: false, hasImage: false, imgUrl: '', statusText: '' }

    // 区内是否已有缩略图（MaterialModalButton_v2_imageBox 的 background-image）
    const boxes = block.querySelectorAll('[class*="MaterialModalButton_v2_imageBox"]')
    let imgUrl = ''
    for (const b of boxes) {
      const bg = (b.style.backgroundImage || '').match(/url\(["']?([^"')]+)["']?\)/)
      if (bg && bg[1] && !bg[1].startsWith('data:')) { imgUrl = bg[1]; break }
    }

    // 状态文案容器
    const status = block.querySelector('.imageStatus')
    const statusText = status ? (status.innerText || '').replace(/\s+/g, ' ').trim() : ''

    return {
      found: true,
      hasImage: !!imgUrl,
      imgUrl,
      statusText,
    }
  }, { xpMark: XP_ANCHOR_MARK, xpTrack: XP_ANCHOR_TRACK, xpBlock: XP_BLOCK })
    .catch(e => ({ found: false, hasImage: false, imgUrl: '', statusText: '', err: String(e.message).slice(0, 80) }))
}

/**
 * 等白底图区出现
 */
export async function waitWhiteBgRegion(page, timeoutMs = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const ok = await page.evaluate((args) => {
      const a = document.evaluate(args.xpMark, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
      if (a) return true
      const b = document.evaluate(args.xpTrack, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
      return !!b
    }, { xpMark: XP_ANCHOR_MARK, xpTrack: XP_ANCHOR_TRACK }).catch(() => false)
    if (ok) return true
    await sleep(2000)
  }
  return false
}

// ═══════════════════════════════════════════════════════════════════
//  找 input
// ═══════════════════════════════════════════════════════════════════

/**
 * 拿白底图区的 file input 句柄
 */
async function getWhiteBgFileInput(page) {
  // ① 从「白底图」文字锚点往上找容器，容器内找 input
  const blockHandle = await page.evaluateHandle((args) => {
    let anchor = document.evaluate(args.xpMark, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    if (anchor) {
      const bres = document.evaluate(args.xpBlock, anchor, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      if (bres.singleNodeValue) return bres.singleNodeValue
    }
    const tres = document.evaluate(args.xpTrack, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    return tres.singleNodeValue
  }, { xpMark: XP_ANCHOR_MARK, xpTrack: XP_ANCHOR_TRACK, xpBlock: XP_BLOCK }).catch(() => null)

  const block = blockHandle ? blockHandle.asElement() : null
  if (block) {
    // 优先白底图专用 input
    let input = await block.$(XP_FILE_INPUT_WHITE).catch(() => null)
    if (input) return input
    // 兜底区内任意图片 input
    input = await block.$(XP_FILE_INPUT_ANY).catch(() => null)
    if (input) return input
  }

  // ② 全局兜底：靠 data-tracking-click-viewid 找
  const globalInput = await page.$('input[data-tracking-click-viewid*="white_bg_img"]').catch(() => null)
  return globalInput || null
}

// ═══════════════════════════════════════════════════════════════════
//  主函数
// ═══════════════════════════════════════════════════════════════════

/**
 * 上传白底图（商品辅助图）
 *
 * @param {object} page
 * @param {object} opts
 * @param {string[]} opts.files          本地图片路径（通常 1 张）
 * @param {number} [opts.timeoutMs=90000] 等上传完成
 * @param {function} [opts.onProgress]   (elapsedMs) => void
 * @returns {Promise<{
 *   ok: boolean,
 *   before: {hasImage:boolean, imgUrl:string},
 *   after:  {hasImage:boolean, imgUrl:string, statusText:string},
 *   uploaded: number,
 *   errors: string[]
 * }>}
 */
export async function uploadWhiteBg(page, opts = {}) {
  const result = {
    ok: false,
    before: { hasImage: false, imgUrl: '' },
    after: { hasImage: false, imgUrl: '', statusText: '' },
    uploaded: 0,
    errors: [],
  }

  // ── ① 校验文件 ──────────────────────────────────────────────
  const raw = Array.isArray(opts.files) ? opts.files.filter(Boolean) : []
  if (!raw.length) { result.errors.push('未提供图片文件'); return result }

  const files = []
  for (const f of raw) {
    if (!fs.existsSync(f)) { result.errors.push(`文件不存在: ${f}`); continue }
    const st = fs.statSync(f)
    if (st.size > 3 * 1024 * 1024) {
      result.errors.push(`超过 3MB: ${path.basename(f)}`)
      continue
    }
    if (!/\.(png|jpe?g)$/i.test(f)) { result.errors.push(`格式不支持: ${path.basename(f)}`); continue }
    files.push(f)
  }
  if (!files.length) { result.errors.push('没有合规图片'); return result }

  // ── ② 等区域 ────────────────────────────────────────────────
  const ready = await waitWhiteBgRegion(page, 30000)
  if (!ready) {
    result.errors.push(`找不到白底图区（XPath: ${XP_ANCHOR_MARK} 或 ${XP_ANCHOR_TRACK}）`)
    return result
  }

  // ── ③ 读上传前状态 ──────────────────────────────────────────
  const before = await readWhiteBgState(page)
  result.before = { hasImage: before.hasImage, imgUrl: before.imgUrl }

  // ── ④ 找到 input ────────────────────────────────────────────
  const input = await getWhiteBgFileInput(page)
  if (!input) {
    result.errors.push('找不到白底图区的 input[type=file]（上传入口）')
    return result
  }

  // ── ⑤ 塞文件 ────────────────────────────────────────────────
  try {
    await input.uploadFile(...files.slice(0, 1)) // 白底图通常只要 1 张
  } catch (e) {
    result.errors.push('uploadFile 失败: ' + String(e?.message || e).slice(0, 150))
    return result
  }

  // ── ⑥ 轮询等出现缩略图（没有计数器，靠 imgUrl 变化判断）────
  const timeout = opts.timeoutMs ?? 90000
  const t0 = Date.now()
  let after = before
  while (Date.now() - t0 < timeout) {
    await sleep(2000)
    after = await readWhiteBgState(page)
    if (typeof opts.onProgress === 'function') opts.onProgress(Date.now() - t0)
    if (after.hasImage && after.imgUrl !== before.imgUrl) break
    // 有些情况 imgUrl 相同但已成功，看 statusText
    if (after.statusText && /成功|已上传/.test(after.statusText)) break
  }

  result.after = { hasImage: after.hasImage, imgUrl: after.imgUrl, statusText: after.statusText }
  result.uploaded = after.hasImage && after.imgUrl !== before.imgUrl ? 1 : 0
  result.ok = result.uploaded > 0

  if (!result.ok) {
    result.errors.push(
      after.hasImage
        ? '上传后图片 URL 未变化（可能覆盖了原图，或上传未生效）'
        : '上传后仍无图片（可能不合规 / 页面未响应）'
    )
  }
  return result
}

/**
 * 删除白底图（如果已存在）
 * 用于「重新上传前先清空」
 */
export async function clearWhiteBg(page) {
  return page.evaluate((args) => {
    let anchor = document.evaluate(args.xpMark, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    let block = null
    if (anchor) {
      const b = document.evaluate(args.xpBlock, anchor, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      block = b.singleNodeValue
    }
    if (!block) {
      const t = document.evaluate(args.xpTrack, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      block = t.singleNodeValue
    }
    if (!block) return { ok: false, reason: '找不到白底图区' }
    const del = block.querySelector('[class*="DeleteIcon_v2_delete"]')
    if (!del) return { ok: false, reason: '没有删除按钮（可能本来就没图）' }
    del.click()
    return { ok: true }
  }, { xpMark: XP_ANCHOR_MARK, xpTrack: XP_ANCHOR_TRACK, xpBlock: XP_BLOCK })
    .catch(e => ({ ok: false, reason: String(e.message).slice(0, 80) }))
}

// ═══════════════════════════════════════════════════════════════════
//  CLI
// ═══════════════════════════════════════════════════════════════════
if (process.argv[1] && process.argv[1].endsWith('step5-upload-white-bg.mjs')) {
  const argv = process.argv.slice(2)
  const arg = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 ? String(argv[i + 1] ?? d) : d }

  const shopKey = arg('shop', 'pdd_mms_2b1bca962e5fba5172e3edc19a09e406')
  const filesArg = arg('files', '')
  const files = filesArg ? filesArg.split(',').map(s => s.trim()).filter(Boolean) : []
  if (!files.length) { console.error('❌ 需 --files "white.png"'); process.exit(1) }

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
  const page = pages.find(p => /goods\/category|goods_add/.test(p.url())) || pages[0]

  console.log('页面:', page.url().slice(0, 90))
  console.log('上传前:', JSON.stringify(await readWhiteBgState(page)))

  const r = await uploadWhiteBg(page, { files, onProgress: ms => console.log(`  等待 ${Math.round(ms / 1000)}s`) })
  console.log('结果:', JSON.stringify(r, null, 1))

  if (!r.ok) process.exit(1)
  console.log('\n浏览器保持 30 分钟')
  await sleep(1800000)
}
