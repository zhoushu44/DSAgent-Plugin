/**
 * taobao-upload.mjs —— 淘宝图片空间上传（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要（吸收自 src/taobao-image-space.ts 的逆向结论）
 * ══════════════════════════════════════════════════════════════════
 *   发布类技能原本靠 DOM 点「上传文件」：每张 8~20s、结构一改就断、
 *   详情图编辑器几乎无法稳定驱动、批量发布每件都要重走一遍风控。
 *
 *   逆向结论：真正上传只要 **1 个 POST，且不需要 mtop 签名**。
 *   先把本地图传成 img.alicdn.com URL，再把 URL 塞进表单 state —— 完全不碰文件控件。
 *   这正是觅千手 v5.61「预上传」的做法。
 *
 * ══════════════════════════════════════════════════════════════════
 * 实测参数（2026-10，本机验证）
 * ══════════════════════════════════════════════════════════════════
 *   POST https://stream-upload.taobao.com/api/upload.api
 *        ?_input_charset=utf-8&appkey=tu&folderId=0
 *        &picCompress=false&watermark=false
 *   multipart/form-data:
 *        name = <文件名>    ← 普通文本字段（不是 file 的 filename，必须单独给）
 *        file = <二进制>, filename=<文件名>, Content-Type=image/jpeg
 *
 *   200 → { object: { fileId, folderId, url, fileName, size, pix, quality }, success: true }
 *   失败 → { success: false, errorCode: "NOT_ALLOW_UPLOAD_1x1_IMAGE", message }
 *
 *   ★ 1x1 占位图被拒；jpg/png/webp/gif/bmp/heic 通吃；>5MB 单包也过
 *     （服务端 multiPartUploadMinSize 只是「建议分片阈值」，实测不分片同样成功）。
 *
 *   Cookie 只需 .taobao.com 域登录态（cookie2 / _tb_token_ / unb / tfstk / _m_h5_tk …），
 *   凭证库的 cookies 字段正好就是这些，**无需浏览器**。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pickTaobaoAccount } from './taobao-account.mjs'
import { cookieHeader } from './taobao-sign.mjs'
import { desktopUserAgent } from './taobao-ua.mjs'

const UPLOAD_URL = 'https://stream-upload.taobao.com/api/upload.api'
const RT_URL = 'https://stream-upload.taobao.com/api/collect_client_upload_rt.api'
/** 与发布页一致的 Referer/Origin：接口会校验来源域 */
const REFERER = 'https://qn.taobao.com/home.htm/material-center/mine-material/sucai-tu'
const ORIGIN = 'https://qn.taobao.com'
const MAX_BYTES = 20 * 1024 * 1024

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
  '.heic': 'image/heic',
}

/**
 * 上传一张本地图到淘宝图片空间
 * @param {string} filePath 本地绝对路径
 * @param {object} [opts]
 * @param {string} [opts.account]    shopKey
 * @param {string} [opts.folderId]   目录 id，默认 '0'
 * @param {string} [opts.appkey]     bizCode，默认 'tu'（素材图/图片空间）
 * @param {boolean} [opts.picCompress]
 * @param {boolean} [opts.watermark]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ok:boolean, local:string, url?:string, fileId?:string, error?:string}>}
 */
export async function uploadImage(filePath, opts = {}) {
  const {
    account = '', folderId = '0', appkey = 'tu',
    picCompress = false, watermark = false, timeoutMs = 60_000,
  } = opts

  if (!fs.existsSync(filePath)) {
    return { ok: false, local: filePath, error: '文件不存在' }
  }
  const stat = fs.statSync(filePath)
  if (stat.size > MAX_BYTES) {
    return { ok: false, local: filePath, error: `超过 ${MAX_BYTES / 1024 / 1024}MB 上限` }
  }
  const ext = path.extname(filePath).toLowerCase()
  const mime = MIME[ext]
  if (!mime) {
    return { ok: false, local: filePath, error: `不支持的图片格式 ${ext}` }
  }

  const pick = await pickTaobaoAccount({ want: account })
  if (!pick.ok) {
    return { ok: false, local: filePath, error: pick.text || '无可用淘宝账号' }
  }

  const fileName = path.basename(filePath)
  const buf = fs.readFileSync(filePath)

  const qs = new URLSearchParams({
    _input_charset: 'utf-8',
    appkey,
    folderId: String(folderId),
    picCompress: String(picCompress),
    watermark: String(watermark),
  })

  const form = new FormData()
  form.append('name', fileName)               // ★ 普通文本字段，必须单独给
  form.append('file', new Blob([buf], { type: mime }), fileName)

  const t0 = Date.now()
  let res, text = ''
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    res = await fetch(`${UPLOAD_URL}?${qs}`, {
      method: 'POST',
      headers: {
        'cookie': cookieHeader(pick.cookies || {}),
        'user-agent': desktopUserAgent(),
        'referer': REFERER,
        'origin': ORIGIN,
        'accept': 'application/json, text/plain, */*',
      },
      body: form,
      signal: ctl.signal,
    })
    clearTimeout(timer)
    text = await res.text()
  } catch (e) {
    return { ok: false, local: filePath, error: String(e?.message || e) }
  }

  let json = null
  try { json = JSON.parse(text) } catch { /* 非 JSON */ }
  if (!json) {
    return {
      ok: false, local: filePath,
      error: `非 JSON 响应（status=${res.status}）：${text.slice(0, 160)}`,
    }
  }
  if (!json.success || !json.object?.url) {
    return {
      ok: false, local: filePath,
      error: json.errorCode || json.message || `上传失败（status=${res.status}）`,
    }
  }

  // 埋点（可选，失败不影响）
  try {
    fetch(`${RT_URL}?file_Id=${encodeURIComponent(json.object.fileId)}&rt=${Date.now()}&appkey=${appkey}`, {
      headers: { 'cookie': cookieHeader(pick.cookies || {}), 'user-agent': desktopUserAgent() },
    }).catch(() => {})
  } catch { /* ignore */ }

  return {
    ok: true,
    local: filePath,
    url: json.object.url,
    fileId: json.object.fileId,
    fileName: json.object.fileName || fileName,
    size: json.object.size,
    pix: json.object.pix,
    ms: Date.now() - t0,
  }
}

/** 批量上传（串行，失败逐条记录） */
export async function uploadImages(filePaths, opts = {}) {
  const results = []
  const list = [...filePaths]
  for (let i = 0; i < list.length; i++) {
    if (opts.onProgress) opts.onProgress(i + 1, list.length, list[i])
    results.push(await uploadImage(list[i], opts))
  }
  return {
    ok: results.every(r => r.ok),
    results,
    urls: results.filter(r => r.ok).map(r => r.url),
    failed: results.filter(r => !r.ok),
  }
}

export default { uploadImage, uploadImages }
