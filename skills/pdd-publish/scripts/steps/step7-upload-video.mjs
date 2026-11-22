/**
 * step7-upload-video.mjs — 步骤七：上传商品视频（主图视频）
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ 页面结构（实测 2026-11-08）                                   │
 * │                                                              │
 * │ <div data-testid="beast-core-form-item"                      │
 * │      id="basic.carousel_video">                              │ ← ★ 唯一 id 锚点
 * │   <label>商品视频</label>                                     │
 * │   <div class="video-material"                                │
 * │        data-tracking-impr-viewid="carousel_video"            │ ← 兜底锚点
 * │        data-tracking-params="goods_id=...&goods_commit_id=...">
 * │     <div class="video-cards" style="display:none"></div>      │ ← 已传视频卡片
 * │     <section style="display:block">                          │
 * │       <div class="uploadImgEnter">                           │
 * │         <svg .../>                                          │
 * │         <div class="uploadBtnText">上传视频</div>              │ ← 文本锚点
 * │       </div>                                                │
 * │       <div class="uploadImgEnter uploadImgEnterNew"          │
 * │            style="display:none">                            │
 * │         <button>图片空间上传</button>                          │
 * │         <span class="MmsUiUploadPicVideoButton___fileButton"> │
 * │           <button>                                          │
 * │             <span>本地上传</span>                             │
 * │             <input type="file"                              │ ← 上传入口
 * │                    data-tracking-click-viewid=               │ ★ 视频专用标识
 * │                      "merchandise_video_localfile_upload"   │
 * │                    accept="video/mp4,video/quicktime,..."   │
 * │                    multiple>                                │
 * │           </button>                                         │
 * │         </span>                                             │
 * │       </div>                                                │
 * │     </section>                                              │
 * │   </div>                                                     │
 * │ </div>                                                       │
 * │                                                              │
 * │ 规则：                                                       │
 * │   · 时长 ≤ 60 秒                                             │
 * │   · 宽高比 1:1 / 16:9 / 3:4                                  │
 * │   · 上传后展示在轮播图首位                                     │
 * │   · 是【可选】项，不上传也能提交                                │
 * └──────────────────────────────────────────────────────────────┘
 *
 * 用法：
 *   import { uploadVideo, readVideoState } from './step7-upload-video.mjs'
 *
 *   const r = await uploadVideo(page, { files: ['E:/v.mp4'] })
 *   // r = { ok, uploaded, hasVideo, errors }
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

/**
 * 视频区配置表
 *   carousel    = 商品视频（主图视频，60秒内，1:1/16:9/3:4）
 *   explanation = 商品讲解视频（10秒~5分钟，9:16）
 */
const VIDEO_KINDS = {
  carousel: {
    name: '商品视频',
    formItemId: 'basic.carousel_video',
    trackId: 'carousel_video',
    inputTrack: 'merchandise_video_localfile_upload',
    anchorText: '上传视频',
  },
  explanation: {
    name: '商品讲解视频',
    formItemId: 'basic.explanation_video',
    trackId: null,
    inputTrack: 'intro_video_localfile_upload',
    anchorText: '上传视频',
  },
}

/** 按类型生成 XPath */
function xpOf(kind) {
  const cfg = VIDEO_KINDS[kind] || VIDEO_KINDS.carousel
  return {
    xpItem: `//div[@id="${cfg.formItemId}"]`,
    xpTrack: cfg.trackId ? `//div[@data-tracking-impr-viewid="${cfg.trackId}"]` : '',
    xpText: `//*[normalize-space(text())="${cfg.anchorText}"]`,
    xpInputVideo: `.//input[@type="file" and contains(@data-tracking-click-viewid,"${cfg.inputTrack}")]`,
    xpInputAny: './/input[@type="file" and (contains(@accept,"video") or contains(@accept,"mp4"))]',
  }
}

/** 默认（兼容旧调用） */
const DEF_KIND = 'carousel'

/** 区内任意视频 input（按 accept 判断） */

/** 视频扩展名 */
const VIDEO_EXT = /\.(mp4|mov|m4v|flv|mkv|wmv|avi|rmvb|3gp)$/i
/** 大小上限（平台一般 100MB，这里保守 50MB） */
const MAX_SIZE = 50 * 1024 * 1024

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ═══════════════════════════════════════════════════════════════════
//  读状态
// ═══════════════════════════════════════════════════════════════════

/**
 * 读商品视频当前状态
 * @returns {Promise<{found:boolean, hasVideo:boolean, videoUrl:string, cardCount:number, statusText:string}>}
 */
export async function readVideoState(page, kind = DEF_KIND) {
  const xp = xpOf(kind)
  return page.evaluate((args) => {
    // 找 form-item
    let box = document.evaluate(args.xpItem, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    if (!box) {
      const t = document.evaluate(args.xpTrack, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      box = t.singleNodeValue
    }
    if (!box) {
      const a = document.evaluate(args.xpText, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      const anchor = a.singleNodeValue
      box = anchor ? anchor.closest('div[id^="basic."]') || anchor.parentElement : null
    }
    if (!box) return { found: false, hasVideo: false, videoUrl: '', cardCount: 0, statusText: '' }

    // 已传视频卡片
    const cards = box.querySelectorAll('.video-cards > *')
    const cardCount = cards.length

    // 从 video 标签或背景图取 url
    let videoUrl = ''
    const vids = box.querySelectorAll('video')
    for (const v of vids) {
      const s = v.currentSrc || v.src || v.getAttribute('src') || ''
      if (s && !s.startsWith('blob:') && !s.startsWith('data:')) { videoUrl = s; break }
    }
    if (!videoUrl) {
      for (const el of box.querySelectorAll('[style*="background-image"]')) {
        const m = (el.style.backgroundImage || '').match(/url\(["']?([^"')]+)["']?\)/)
        if (m && m[1] && /\.(mp4|mov)/i.test(m[1])) { videoUrl = m[1]; break }
      }
    }

    const status = box.querySelector('[class*="status"], [class*="tip"], [class*="error"]')
    const statusText = status ? (status.innerText || '').replace(/\s+/g, ' ').trim() : ''

    return {
      found: true,
      hasVideo: cardCount > 0 || !!videoUrl,
      videoUrl,
      cardCount,
      statusText,
    }
  }, { xpItem: xp.xpItem, xpTrack: xp.xpTrack, xpText: xp.xpText })
    .catch(e => ({ found: false, hasVideo: false, videoUrl: '', cardCount: 0, statusText: '', err: String(e.message).slice(0, 80) }))
}

/** 等视频区出现 */
export async function waitVideoRegion(page, timeoutMs = 30000, kind = DEF_KIND) {
  const xp = xpOf(kind)
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const ok = await page.evaluate((args) => {
      if (document.evaluate(args.xpItem, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue) return true
      if (document.evaluate(args.xpTrack, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue) return true
      return false
    }, { xpItem: xp.xpItem, xpTrack: xp.xpTrack }).catch(() => false)
    if (ok) return true
    await sleep(2000)
  }
  return false
}

// ═══════════════════════════════════════════════════════════════════
//  找 input
// ═══════════════════════════════════════════════════════════════════

async function getVideoFileInput(page, kind = DEF_KIND) {
  const xp = xpOf(kind)
  const kindCfg = VIDEO_KINDS[kind] || VIDEO_KINDS[DEF_KIND]
  // ① 从 form-item 容器内找
  const boxHandle = await page.evaluateHandle((args) => {
    let box = document.evaluate(args.xpItem, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    if (box) return box
    const t = document.evaluate(args.xpTrack, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    return t.singleNodeValue
  }, { xpItem: xp.xpItem, xpTrack: xp.xpTrack }).catch(() => null)

  const box = boxHandle ? boxHandle.asElement() : null
  if (box) {
    let input = await box.$(xp.xpInputVideo).catch(() => null)
    if (input) return input
    input = await box.$(xp.xpInputAny).catch(() => null)
    if (input) return input
  }

  // ② 全局兜底：靠 data-tracking 找
  const g = await page.$('input[data-tracking-click-viewid*="video_localfile_upload"]').catch(() => null)
  if (g) return g

  // ③ 全局：第一个 accept 含 video 的 input
  const all = await page.$$('input[type="file"]')
  for (const h of all) {
    const acc = await page.evaluate(el => el.accept || '', h).catch(() => '')
    if (/video|mp4/i.test(acc)) return h
  }
  return null
}

// ═══════════════════════════════════════════════════════════════════
//  主函数
// ═══════════════════════════════════════════════════════════════════

/**
 * 上传商品视频
 *
 * @param {object} page
 * @param {object} opts
 * @param {string[]} opts.files           本地视频路径（通常 1 个）
 * @param {number} [opts.timeoutMs=180000] 等上传 + 转码完成（视频比图片慢很多）
 * @param {function} [opts.onProgress]     (elapsedMs, state) => void
 * @returns {Promise<{
 *   ok:boolean,
 *   before:{hasVideo:boolean, cardCount:number},
 *   after:{hasVideo:boolean, videoUrl:string, cardCount:number, statusText:string},
 *   uploaded:number,
 *   errors:string[]
 * }>}
 */
export async function uploadVideo(page, opts = {}) {
  const kind = opts.kind || DEF_KIND
  const kindCfg = VIDEO_KINDS[kind] || VIDEO_KINDS[DEF_KIND]
  const result = {
    kind,
    ok: false,
    before: { hasVideo: false, cardCount: 0 },
    after: { hasVideo: false, videoUrl: '', cardCount: 0, statusText: '' },
    uploaded: 0,
    errors: [],
  }

  // ── ① 校验文件 ──────────────────────────────────────────────
  const raw = Array.isArray(opts.files) ? opts.files.filter(Boolean) : []
  if (!raw.length) { result.errors.push('未提供视频文件'); return result }

  const files = []
  for (const f of raw) {
    if (!fs.existsSync(f)) { result.errors.push(`文件不存在: ${f}`); continue }
    const st = fs.statSync(f)
    if (st.size > MAX_SIZE) {
      result.errors.push(`超过 ${MAX_SIZE / 1048576}MB: ${path.basename(f)} (${(st.size / 1048576).toFixed(1)}MB)`)
      continue
    }
    if (!VIDEO_EXT.test(f)) {
      result.errors.push(`格式不支持: ${path.basename(f)}（支持 mp4/mov/m4v/flv/mkv/wmv/avi/rmvb/3gp）`)
      continue
    }
    files.push(f)
  }
  if (!files.length) { result.errors.push('没有合规视频'); return result }

  // ── ② 等区域 ────────────────────────────────────────────────
  const ready = await waitVideoRegion(page, 30000, kind)
  if (!ready) {
    result.errors.push(`找不到商品视频区（XPath: ${xp.xpItem}）`)
    return result
  }

  // ── ③ 读上传前状态 ──────────────────────────────────────────
  const before = await readVideoState(page, kind)
  result.before = { hasVideo: before.hasVideo, cardCount: before.cardCount }

  // ── ④ 找 input ──────────────────────────────────────────────
  const input = await getVideoFileInput(page, kind)
  if (!input) {
    result.errors.push('找不到视频的 input[type=file]（本地上传入口）')
    return result
  }

  // ── ⑤ 塞文件 ────────────────────────────────────────────────
  try {
    await input.uploadFile(files[0])   // 视频只传 1 个
  } catch (e) {
    result.errors.push('uploadFile 失败: ' + String(e?.message || e).slice(0, 150))
    return result
  }

  // ── ⑥ 轮询等视频出现（上传 + 转码，慢）──────────────────────
  const timeout = opts.timeoutMs ?? 180000
  const t0 = Date.now()
  let after = before
  while (Date.now() - t0 < timeout) {
    await sleep(3000)
    after = await readVideoState(page, kind)
    if (typeof opts.onProgress === 'function') opts.onProgress(Date.now() - t0, after)
    if (after.hasVideo && after.cardCount > before.cardCount) break
    if (after.hasVideo && after.videoUrl && after.videoUrl !== before.videoUrl) break
    if (after.statusText && /失败|错误|不支持|超时/.test(after.statusText)) break
  }

  result.after = {
    hasVideo: after.hasVideo,
    videoUrl: after.videoUrl,
    cardCount: after.cardCount,
    statusText: after.statusText,
  }
  result.uploaded = after.hasVideo && after.cardCount > before.cardCount ? 1 : 0
  result.ok = result.uploaded > 0

  if (!result.ok) {
    if (after.statusText && /失败|错误|不支持|超时/.test(after.statusText)) {
      result.errors.push(`平台返回: ${after.statusText}`)
    } else if (after.hasVideo) {
      result.errors.push('视频卡片已存在但数量未变（可能是覆盖，或上传未生效）')
    } else {
      result.errors.push(`上传后仍无视频（等待 ${Math.round((Date.now() - t0) / 1000)}s）。可能是转码慢或格式/时长不合规`)
    }
  }
  return result
}

/** 删除已上传的视频 */
export async function clearVideo(page, kind = DEF_KIND) {
  const xp = xpOf(kind)
  return page.evaluate((args) => {
    let box = document.evaluate(args.xpItem, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    if (!box) {
      const t = document.evaluate(args.xpTrack, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      box = t.singleNodeValue
    }
    if (!box) return { ok: false, reason: '找不到视频区' }
    const del = box.querySelector('[class*="DeleteIcon"], [class*="delete"]')
    if (!del) return { ok: false, reason: '没有删除按钮（可能本来就没视频）' }
    del.click()
    return { ok: true }
  }, { xpItem: xp.xpItem, xpTrack: xp.xpTrack })
    .catch(e => ({ ok: false, reason: String(e.message).slice(0, 80) }))
}

// ═══════════════════════════════════════════════════════════════════
//  CLI
// ═══════════════════════════════════════════════════════════════════
if (process.argv[1] && process.argv[1].endsWith('step7-upload-video.mjs')) {
  const argv = process.argv.slice(2)
  const arg = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 ? String(argv[i + 1] ?? d) : d }

  const shopKey = arg('shop', 'pdd_mms_2b1bca962e5fba5172e3edc19a09e406')
  const filesArg = arg('files', '')
  const files = filesArg ? filesArg.split(',').map(s => s.trim()).filter(Boolean) : []
  if (!files.length) { console.error('❌ 需 --files "v.mp4"'); process.exit(1) }

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
  console.log('上传前:', JSON.stringify(await readVideoState(page)))

  const r = await uploadVideo(page, {
    files,
    onProgress: (ms, st) => { if (ms % 15000 < 3500) console.log(`  等待 ${Math.round(ms / 1000)}s | 卡片=${st.cardCount} url=${st.videoUrl ? '有' : '无'}`) },
  })
  console.log('结果:', JSON.stringify(r, null, 1))

  if (!r.ok) process.exit(1)
  console.log('\n浏览器保持 30 分钟')
  await sleep(1800000)
}



