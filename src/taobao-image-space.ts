/**
 * 淘宝图片空间「逆向 HTTP 上传」—— 复刻觅千手 v5.61 的图片预上传链路。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么要有这个模块（vs. 原来的 DOM 文件上传）
 * ══════════════════════════════════════════════════════════════════════
 *   原链路：puppeteer 点「上传文件」→ waitForFileChooser → 塞本地文件 →
 *     等 #struct-mainImagesGroup 出现 img。缺点：
 *       ① 慢（每张 8~20s，5 主图 + 12 详情图要几分钟）；
 *       ② 脆（主图区结构一改就断，弹层 / iframe / 真实鼠标点击三重依赖）；
 *       ③ 详情图编辑器（Flux 富文本）几乎无法稳定驱动；
 *       ④ 批量发布时每件商品都要重走一遍，风控暴露面大。
 *   新链路（觅千手同款）：先用**图片空间上传接口**把本地图传成 img.alicdn.com URL，
 *     再把 URL 通过 Json/Json2 劫持重放塞进表单 state —— 完全不碰页面文件控件。
 *     这正是觅千手「搬品」的做法：图片走 URL，DOM 只负责最终提交。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 逆向结论（本机实测，2026-10）
 * ══════════════════════════════════════════════════════════════════════
 *   真正上传只要 1 个 POST，**不需要 mtop 签名**：
 *
 *     POST https://stream-upload.taobao.com/api/upload.api
 *          ?_input_charset=utf-8
 *          &appkey=tu              ← bizCode：素材图 / 图片空间 = tu
 *          &folderId=0             ← 目录 id，0 = 根（「全部图片」）
 *          &picCompress=false      ← true 会服务端压体积（画质降）
 *          &watermark=false        ← 服务端水印开关
 *
 *     multipart/form-data:
 *          name = <文件名>          ← 普通文本字段（不是 file 的 filename，必须单独给）
 *          file = <二进制>, filename=<文件名>, Content-Type=image/jpeg
 *
 *     200 → {"object":{"fileId":"1120108866397369159",
 *                      "folderId":"0",
 *                      "url":"https://img.alicdn.com/imgextra/i1/2218891961201/O1CN01....png",
 *                      "fileName":"x.png","size":"5187816","pix":"2048x2048","quality":100},
 *             "success":true,"status":0,"message":""}
 *
 *     失败：{"success":false,"errorCode":"NOT_ALLOW_UPLOAD_1x1_IMAGE","message":"不允许上传1x1图片"}
 *       ★ 1x1 占位图被拒；jpg/png/webp/bmp/heic 通吃；>5MB 单包也过（服务端说
 *         multiPartUploadMinSize=5242880 只是「建议分片阈值」，实测不分片同样成功）。
 *
 *   Cookie 只需 .taobao.com 域下的登录态那一套（cookie2 / _tb_token_ / SGCookie /
 *   unb / tfstk / _m_h5_tk / cookie17 / tracknick ...）。凭证库里的 cookies
 *   字段正好就是这些，直接把 map 拼成 Cookie 头即可，无需浏览器。
 *
 *   上传后前端还会发一发埋点（可省）：
 *     GET https://stream-upload.taobao.com/api/collect_client_upload_rt.api
 *         ?file_Id=<fileId>&rt=<rand>&appkey=tu
 *
 * ══════════════════════════════════════════════════════════════════════
 * 与觅千手对齐点
 * ══════════════════════════════════════════════════════════════════════
 *   · 觅千手「预上传」= 先图后表：图片先落图片空间拿 CDN URL，再随表单提交；
 *   · 本模块把「拿 URL」这一步做成纯 HTTP，浏览器只负责最后的表单渲染与提交；
 *   · 拿到的 URL 直接喂给 buildTaobaoJsonDocument({imageUrls, detailImageUrls})。
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'

/** 图片空间上传接口（素材图 bizCode = tu） */
const UPLOAD_URL = 'https://stream-upload.taobao.com/api/upload.api'
/** 上传埋点接口（可选；失败不影响结果） */
const RT_URL = 'https://stream-upload.taobao.com/api/collect_client_upload_rt.api'
/** 与发布页一致的 Referer/Origin：接口会校验来源域 */
const REFERER = 'https://qn.taobao.com/home.htm/material-center/mine-material/sucai-tu'
const ORIGIN = 'https://qn.taobao.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'

/** 单张上限（图片空间本身允许更大；这里对齐发布侧 20MB 上限） */
const MAX_BYTES = 20 * 1024 * 1024

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
}

export interface ImageSpaceUploadOptions {
  /**
   * Cookie 键值对（凭证库 account.cookies）。只需 .taobao.com 域下的登录态 Cookie。
   * 会自动剔除值为空 / 显式过期的项。
   */
  cookies: Record<string, string>
  /** 目录 id；默认 '0'（全部图片根目录） */
  folderId?: string
  /** bizCode；默认 'tu'（素材图 / 图片空间）。其它入口（详情图等）另有 bizCode */
  appkey?: string
  /** 服务端压缩；默认 false（保持原图画质） */
  picCompress?: boolean
  /** 服务端水印；默认 false */
  watermark?: boolean
  /** 是否发埋点（默认 true；发失败静默忽略） */
  collectRt?: boolean
  /** 单张超时（毫秒）。大图 / 弱网可调大 */
  timeoutMs?: number
}

export interface ImageSpaceUploadResult {
  /** 本地路径 */
  local: string
  ok: boolean
  /** 图片空间 fileId（后续可用于管理素材） */
  fileId?: string
  /** CDN URL —— 喂给 replay 的 imageUrls / detailImageUrls */
  url?: string
  /** 服务端记录的文件名（默认取本地文件名） */
  fileName?: string
  size?: string
  /** 像素尺寸，如 "800x800" */
  pix?: string
  /** 服务端质量分（0~100，非压缩率） */
  quality?: number
  /** 失败原因（HTTP 码 / errorCode / 异常信息） */
  error?: string
}

/* ══════════════════════════════════════════════════════════════════
 * Cookie 头拼装
 * ══════════════════════════════════════════════════════════════════ */

/** 值为空 / 明显失效的 Cookie 直接丢弃，避免服务端把整条会话判成匿名 */
function pickCookiePairs(cookies: Record<string, string>): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const [k, v] of Object.entries(cookies || {})) {
    if (!k) continue
    if (v == null) continue
    const s = String(v)
    if (!s || s === 'undefined' || s === 'null') continue
    out.push([k, s])
  }
  return out
}

/** 上传前的最小会话自检：缺这些基本等于未登录，早点报清楚比等 401 好 */
export function checkLoginCookies(cookies: Record<string, string>): string | null {
  const has = (n: string) => {
    const v = cookies?.[n]
    return v != null && String(v) !== ''
  }
  if (!has('cookie2') && !has('cookie17') && !has('unb')) {
    return '账号 Cookie 缺少登录态标识（cookie2 / cookie17 / unb 全缺），图片空间上传会退化成匿名请求。'
      + '请到「账号连接」页面重新登录淘宝。'
  }
  return null
}

/* ══════════════════════════════════════════════════════════════════
 * multipart 组包（不引第三方库：Node 18+ 自带 fetch + FormData/Blob）
 * ══════════════════════════════════════════════════════════════════ */

function mimeOf(file: string): string {
  return MIME[extname(file).toLowerCase()] || 'application/octet-stream'
}

/**
 * 上传单张图到图片空间，返回 CDN URL。
 * 失败不抛异常（批量场景要求「一张坏不拖垮整批」），用 ok/error 表达。
 */
export async function uploadImageToSpace(
  file: string,
  opts: ImageSpaceUploadOptions,
): Promise<ImageSpaceUploadResult> {
  const base: ImageSpaceUploadResult = { local: file, ok: false }

  // ── 本地校验 ──
  if (!file || !existsSync(file)) return { ...base, error: `文件不存在：${file}` }
  let size = 0
  try {
    const st = statSync(file)
    if (!st.isFile() || st.size === 0) return { ...base, error: `文件不可用（非文件或 0 字节）：${file}` }
    size = st.size
  } catch (e) {
    return { ...base, error: `无法读取文件：${e instanceof Error ? e.message : String(e)}` }
  }
  if (size > MAX_BYTES) {
    return { ...base, error: `超过单张上限 20MB（${(size / 1024 / 1024).toFixed(2)}MB）：${file}` }
  }

  const loginErr = checkLoginCookies(opts.cookies || {})
  if (loginErr) return { ...base, error: loginErr }

  const pairs = pickCookiePairs(opts.cookies || {})
  const cookieHeader = pairs.map(([k, v]) => `${k}=${v}`).join('; ')
  const filename = basename(file)
  const params = new URLSearchParams({
    _input_charset: 'utf-8',
    appkey: opts.appkey || 'tu',
    folderId: String(opts.folderId ?? '0'),
    picCompress: opts.picCompress ? 'true' : 'false',
    watermark: opts.watermark ? 'true' : 'false',
  })

  // ── 组 multipart ──
  // ★ name 字段必须独立给（页面侧就是 name=<文件名> + file=<二进制>），
  //   只给 file 的 filename 时服务端会拿不到展示名。
  const form = new FormData()
  form.append('name', filename)
  try {
    const buf = readFileSync(file)
    form.append('file', new Blob([buf], { type: mimeOf(file) }), filename)
  } catch (e) {
    return { ...base, error: `读取图片失败：${e instanceof Error ? e.message : String(e)}` }
  }

  // ── POST ──
  let resp: Response
  try {
    resp = await fetch(`${UPLOAD_URL}?${params.toString()}`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Referer: REFERER,
        Origin: ORIGIN,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Cookie: cookieHeader,
        // ★ 不要手动设 Content-Type：让 fetch 自己带 boundary
      },
      body: form,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
    })
  } catch (e) {
    return { ...base, error: `上传请求失败：${e instanceof Error ? e.message : String(e)}` }
  }

  const raw = await resp.text().catch(() => '')
  let json: any = null
  try { json = JSON.parse(raw) } catch { /* 非 JSON：下面按原始文本报错 */ }

  if (!json) {
    return { ...base, error: `响应非 JSON（HTTP ${resp.status}）：${raw.slice(0, 300)}` }
  }
  const obj = json.object || {}
  if (json.success === true && obj.fileId && obj.url) {
    // 埋点：失败静默（不影响上传结论）
    if (opts.collectRt !== false) {
      try {
        await fetch(`${RT_URL}?file_Id=${encodeURIComponent(String(obj.fileId))}`
          + `&rt=${Date.now() % 10000}&appkey=${encodeURIComponent(opts.appkey || 'tu')}`, {
          method: 'GET',
          headers: {
            'User-Agent': UA, Referer: REFERER, Origin: ORIGIN,
            Accept: 'application/json, text/plain, */*', Cookie: cookieHeader,
          },
          signal: AbortSignal.timeout(20_000),
        })
      } catch { /* 埋点失败忽略 */ }
    }
    return {
      local: file,
      ok: true,
      fileId: String(obj.fileId),
      url: String(obj.url),
      fileName: obj.fileName ? String(obj.fileName) : filename,
      size: obj.size != null ? String(obj.size) : String(size),
      pix: obj.pix ? String(obj.pix) : undefined,
      quality: typeof obj.quality === 'number' ? obj.quality : undefined,
    }
  }

  // ── 失败归因 ──
  const code = json.errorCode ? String(json.errorCode) : ''
  const msg = json.message ? String(json.message) : ''
  let error = `上传被拒（HTTP ${resp.status}）`
  if (code === 'NOT_ALLOW_UPLOAD_1x1_IMAGE') error = '不允许上传 1x1 图片（占位图），请换真实商品图'
  else if (code === 'BAXIA_BLOCKED') error = '命中滑块风控（BAXIA_BLOCKED），需先在图片空间完成验证'
  else if (code || msg) error = `${code ? `[${code}] ` : ''}${msg || '未知原因'}`
  else if (!raw) error = `空响应（HTTP ${resp.status}）`
  return { ...base, error: `${error}：${file}` }
}

/**
 * 批量上传（串行 + 可配并发）。默认并发 3：
 * 图片空间单账号对并发较敏感，3 路既能把 17 张压到 10s 级，又不容易触发限流。
 * 返回顺序与入参一致；失败的项带 error，调用方决定是否整批中止。
 */
export async function uploadImagesToSpace(
  files: string[],
  opts: ImageSpaceUploadOptions & { concurrency?: number },
): Promise<ImageSpaceUploadResult[]> {
  const list = (Array.isArray(files) ? files : []).map(f => String(f || '').trim()).filter(Boolean)
  if (!list.length) return []
  const limit = Math.max(1, Math.min(6, Number(opts.concurrency) || 3))
  const out: ImageSpaceUploadResult[] = new Array(list.length)
  let cursor = 0
  const worker = async () => {
    while (true) {
      const i = cursor++
      if (i >= list.length) return
      out[i] = await uploadImageToSpace(list[i], opts)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker))
  return out
}

/**
 * 把一批本地图换成图片空间 URL（只回成功的），并汇总失败信息。
 * 给发布主流程用：拿到的 URL 直接进 replay payload。
 */
export async function localImagesToSpaceUrls(
  files: string[],
  opts: ImageSpaceUploadOptions & { concurrency?: number },
): Promise<{ urls: string[]; failed: Array<{ local: string; error: string }>; results: ImageSpaceUploadResult[] }> {
  const results = await uploadImagesToSpace(files, opts)
  const urls = results.filter(r => r.ok && r.url).map(r => String(r.url))
  const failed = results.filter(r => !r.ok).map(r => ({ local: r.local, error: r.error || '未知错误' }))
  return { urls, failed, results }
}
