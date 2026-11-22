/**
 * xhs-api.mjs —— 小红书 HTTP 直连（主链路）
 * ══════════════════════════════════════════════════════════════════
 * 纯 HTTP + 自算签名（xhs-sign.mjs），**不开浏览器、不占 Profile、不等页面渲染**。
 *
 * 这是主链路。xhs-browser.mjs（页面内代签名）是兜底：
 * 签名算法被平台改版打断、或需要借用只有页面才有的私有通道时才退回。
 *
 * ══════════════════════════════════════════════════════════════════
 * 能力边界（重要，来自真机逆向结论，勿想当然）
 * ══════════════════════════════════════════════════════════════════
 *
 *   ✅ 完全可纯 HTTP：
 *      · POST /api/sns/web/v1/note          （提交笔记）
 *      · POST /api/sns/web/v1/upload        （图文上传）
 *      · GET  /api/sns/web/v1/note_list     （笔记列表 / 分析）
 *      · GET  /api/sns/web/v2/user/me       （登录判据）
 *
 *   ⚠️ 必须借浏览器拿 permit（**硬限制**）：
 *      · GET /api/media/v1/upload/creator/permit
 *        逆向报告 §3.3 实测：permit 走上**上传 SDK 私有实例通道**，不是普通
 *        axios/fetch 层 —— 拿旧 x-s 打新 permit 必 406（补 x-xray-traceid 也无效）。
 *        所以视频发布的第①段（拿 permit）需要开浏览器 hook 页面自己的请求；
 *        第②段（COS PUT）与第③段（提交笔记）都可以纯 HTTP。
 *
 *   换句话说：
 *      图文发布  = 全 HTTP
 *      视频发布  = 浏览器拿 permit → 纯 HTTP 直传 + 提交
 *      笔记分析  = 全 HTTP
 *
 * ══════════════════════════════════════════════════════════════════
 * 发布三段式
 * ══════════════════════════════════════════════════════════════════
 *   图文：
 *     ① POST /api/sns/web/v1/upload             ← multipart 传图，拿 file_id
 *     ② POST /api/sns/web/v1/note               ← {title, desc, image_info, post_timer}
 *
 *   视频：
 *     ① GET  /api/media/v1/upload/creator/permit ← 需借浏览器（见上）
 *     ② PUT  https://<uploadAddr>/<fileId>       ← COS 直传，Authorization 自算（cos_sign.cjs）
 *     ③ POST /api/sns/web/v1/note               ← {title, desc, video_info, post_timer}
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么 POST body 必须用 signHeaders 返回的 bodyStr
 * ══════════════════════════════════════════════════════════════════
 *   x-s 是按 content_string 算的，content_string 里内嵌了 body 的 JSON 文本。
 *   如果发送时重新 JSON.stringify 一次（键序/空格/转义稍有不同），
 *   签名与体就对不上 → 平台 461。所以一律 `body: bodyStr`。
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { signHeaders, getXt } from './xhs-sign.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = process.env.DSAGENT_PLUGIN_ROOT || join(HERE, '..', '..')
const require_ = createRequire(import.meta.url)

/**
 * 腾讯云 COS v5 签名（视频直传用）。
 *
 * 复用技能目录里既有的 cos_sign.cjs（CJS，无法用 ESM import 直接拿到具名导出）。
 * permit 下发的 SecretId / SecretKey 字符串就是 `"null"` —— 服务端策略在
 * allowPrefixes 白名单里，客户端只能靠「key 精确等于 fileId」通过。
 */
let _cosSign = null
function loadCosSign() {
  if (_cosSign)
    return _cosSign
  const candidates = [
    join(HERE, '..', 'xhs-publish-re', 'cos_sign.cjs'),
    join(PLUGIN_ROOT, 'skills', 'xhs-publish-re', 'cos_sign.cjs'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      _cosSign = require_(p)
      return _cosSign
    }
  }
  return null
}

const CREATOR = 'https://creator.xiaohongshu.com'
const EDITH = 'https://edith.xiaohongshu.com'

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0'

/**
 * 这些失败类型值得退回浏览器兜底，其余直接报错。
 *
 *   sign_rejected  —— 签名被拒（-104）：算法被改版，页面代签能绕过
 *   risk_control   —— 风控（461/471）：页面有完整浏览器指纹，更容易过
 *   api_error      —— 接口路径/结构变动、返回 HTML 兜底页 —— 页面 DOM 能读
 *   parse_error    —— 同上（响应不是 JSON）
 *
 * ★ token_expired 刻意**不在**此列：账号过期时开浏览器也是白开，
 *   直接引导用户重新登录才是正确处置（也避免白等一次 Chrome 启动）。
 */
const FALLBACK_KINDS = new Set(['sign_rejected', 'risk_control', 'api_error', 'parse_error'])

export const shouldFallback = (failureKind) => FALLBACK_KINDS.has(failureKind)

/* ── 服务端错误归一 ─────────────────────────────────────── */
function classifyHttp(status, text) {
  if (status === 401 || status === 403)
    return { kind: 'token_expired', msg: `HTTP ${status}：登录态或权限不足` }
  if (status === 461 || status === 471)
    return { kind: 'risk_control', msg: `HTTP ${status}：风控拦截（签名或指纹被识别）` }
  if (status === 404)
    return { kind: 'api_error', msg: 'HTTP 404：接口路径可能已变更' }
  if (status >= 500)
    return { kind: 'api_error', msg: `HTTP ${status}` }
  void text
  return null
}

/** 小红书业务码归一 */
function classifyBiz(payload) {
  if (!payload || typeof payload !== 'object')
    return null
  const code = payload.code
  if (code === 0 && payload.success !== false)
    return null
  const msg = String(payload.msg || payload.message || `code=${code}`)
  if (code === -100 || code === -101 || /登录/.test(msg))
    return { kind: 'token_expired', msg }
  if (code === 461 || code === 471 || /风控|验证|签名/.test(msg))
    return { kind: 'risk_control', msg }
  if (code === -104)
    return { kind: 'sign_rejected', msg: `签名被拒（code=-104）：${msg}` }
  return { kind: 'api_error', msg: `code=${code} ${msg}` }
}

/* ── 统一请求 ───────────────────────────────────────────── */
/**
 * 打一个带签名的小红书接口。
 *
 * @param {object} o
 * @param {object} o.cookieStr  完整 cookie 串（至少含 a1 / web_session）
 * @param {string} o.method     GET / POST
 * @param {string} o.url        绝对 URL 或 path
 * @param {object} [o.payload]  POST body（会参与签名）
 * @param {object} [o.params]   GET query（会参与签名）
 * @param {string} [o.userAgent]
 * @returns {Promise<{ok:boolean, status:number, payload:any, raw:string,
 *                    failureKind?:string, message?:string}>}
 */
export async function xhsFetch(o) {
  const {
    cookieStr, method = 'POST', url, payload = null, params = null,
    userAgent = DEFAULT_UA, timeoutMs = 45000,
  } = o

  let target = url
  if (params && Object.keys(params).length) {
    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    target += (target.includes('?') ? '&' : '?') + qs
  }

  let signed
  try {
    signed = signHeaders(method, url, cookieStr, { payload, params, userAgent })
  } catch (e) {
    return { ok: false, status: 0, payload: null, raw: '', failureKind: 'token_expired', message: String(e.message || e) }
  }

  const headers = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    origin: 'https://creator.xiaohongshu.com',
    referer: 'https://creator.xiaohongshu.com/publish/publish?source=official',
    'user-agent': userAgent,
    cookie: cookieStr,
    ...signed.headers,
  }
  if (signed.bodyStr !== null)
    headers['content-type'] = 'application/json;charset=UTF-8'

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res
  try {
    res = await fetch(target, {
      method,
      headers,
      // ★ 必须用签名时那份字符串，不能重新序列化
      body: signed.bodyStr === null ? undefined : signed.bodyStr,
      signal: ctrl.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    return { ok: false, status: 0, payload: null, raw: '', failureKind: 'api_error', message: `网络失败：${e.message || e}` }
  }
  const raw = await res.text()
  clearTimeout(timer)

  let parsed = null
  try { parsed = JSON.parse(raw) } catch { /* 非 JSON：可能是 HTML 兜底页 */ }

  const httpErr = classifyHttp(res.status, raw)
  if (httpErr)
    return { ok: false, status: res.status, payload: parsed, raw, failureKind: httpErr.kind, message: httpErr.msg }

  const bizErr = classifyBiz(parsed)
  if (bizErr)
    return { ok: false, status: res.status, payload: parsed, raw, failureKind: bizErr.kind, message: bizErr.msg }

  if (parsed === null) {
    return {
      ok: false, status: res.status, payload: null, raw,
      failureKind: 'api_error',
      message: `响应不是 JSON（前 120 字）：${raw.slice(0, 120)}`,
    }
  }

  return { ok: true, status: res.status, payload: parsed, raw }
}

/* ── 图文：上传图片 ─────────────────────────────────────── */
/**
 * 图文上传走 multipart（/api/sns/web/v1/upload）。
 * 注意：multipart 的签名只需覆盖 uri，body 不参与 —— 与 JSON POST 不同。
 */
export async function uploadImage(o) {
  const { cookieStr, filePath, userAgent = DEFAULT_UA } = o
  const buf = readFileSync(filePath)

  // multipart 签名：method=POST + uri，payload 传空对象（与页面一致）
  let signed
  try {
    signed = signHeaders('POST', `${CREATOR}/api/sns/web/v1/upload`, cookieStr, {
      payload: {}, userAgent,
    })
  } catch (e) {
    return { ok: false, failureKind: 'token_expired', message: String(e.message || e) }
  }

  const boundary = '----WebKitFormBoundary' + createHash('md5').update(String(Date.now())).digest('hex').slice(0, 16)
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  const name = basename(filePath)

  const head = Buffer.from(
    `--${boundary}\r\n`
    + `Content-Disposition: form-data; name="file"; filename="${name}"\r\n`
    + `Content-Type: ${mime}\r\n\r\n`,
    'utf8')
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  const body = Buffer.concat([head, buf, tail])

  const headers = {
    accept: 'application/json, text/plain, */*',
    origin: 'https://creator.xiaohongshu.com',
    referer: 'https://creator.xiaohongshu.com/publish/publish?source=official',
    'user-agent': userAgent,
    cookie: cookieStr,
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length),
    ...signed.headers,
  }
  // multipart 不需要 JSON content-type，删掉避免冲突
  delete headers['content-type']
  headers['content-type'] = `multipart/form-data; boundary=${boundary}`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 120000)
  try {
    const res = await fetch(`${CREATOR}/api/sns/web/v1/upload`, { method: 'POST', headers, body, signal: ctrl.signal })
    const raw = await res.text()
    clearTimeout(timer)
    let j = null
    try { j = JSON.parse(raw) } catch { /* 忽略 */ }
    const biz = classifyBiz(j)
    if (!res.ok || biz)
      return { ok: false, failureKind: biz?.kind || 'api_error', message: biz?.msg || `HTTP ${res.status}`, raw: raw.slice(0, 300) }
    const fileId = j?.data?.fileId || j?.data?.file_id || j?.data?.id
    if (!fileId)
      return { ok: false, failureKind: 'api_error', message: '上传成功但未返回 fileId', raw: raw.slice(0, 300) }
    return { ok: true, fileId, payload: j }
  } catch (e) {
    clearTimeout(timer)
    return { ok: false, failureKind: 'api_error', message: `上传失败：${e.message || e}` }
  }
}

/* ── 图文：提交笔记 ─────────────────────────────────────── */
export async function publishImageNote(o) {
  const { cookieStr, title, desc = '', fileIds, timer = '', userAgent = DEFAULT_UA } = o
  const payload = {
    title,
    desc,
    type: 'normal',
    ats: [],
    image_info: { images: fileIds.map((file_id) => ({ file_id })) },
    post_timer: timer || '',
  }
  return xhsFetch({
    cookieStr, method: 'POST', url: `${CREATOR}/api/sns/web/v1/note`, payload, userAgent,
  })
}

/* ── 视频：申请 permit ──────────────────────────────────── */
/**
 * 申请上传 permit（拿到 COS STS token / fileId / uploadAddr）。
 *
 * ⚠️ **这一条纯 HTTP 大概率拿不到**：permit 走上「上传 SDK 私有实例通道」，
 * 逆向报告 §3.3 实测「旧 x-s 打新 permit → 406，补 x-xray-traceid 也无效」。
 * 这里仍保留纯 HTTP 尝试（万一平台放开），失败时调用方应改用
 * `xhs-browser.mjs` 的 `grabPermitViaPage()` —— 由页面 hook 自己发的 permit 请求。
 */
export async function requestPermit(o) {
  const { cookieStr, userAgent = DEFAULT_UA } = o
  return xhsFetch({
    cookieStr,
    method: 'GET',
    url: `${CREATOR}/api/media/v1/upload/creator/permit`,
    params: {
      biz_name: 'spectrum',
      scene: 'video',
      file_count: 1,
      version: 1,
      source: 'web',
    },
    userAgent,
  })
}

/**
 * 从 permit 响应里挑出要用的那一条（SDK 行为：按 qos 降序取第一个）。
 * @returns {{permit:object, fileId:string, uploadAddr:string}|null}
 */
export function pickPermit(payload) {
  const permits = payload?.data?.uploadTempPermits
    || payload?.data?.upload_temp_permits
    || []
  if (!Array.isArray(permits) || !permits.length)
    return null
  const permit = [...permits].sort((a, b) => (b.qos || 0) - (a.qos || 0))[0]
  const fileId = (permit.fileIds || permit.file_ids || [])[0]
  if (!fileId)
    return null
  return { permit, fileId, uploadAddr: permit.uploadAddr || permit.upload_addr }
}

/* ── 视频：提交笔记 ─────────────────────────────────────── */
export async function publishVideoNote(o) {
  const { cookieStr, title, desc = '', fileId, duration = 0, timer = '', userAgent = DEFAULT_UA } = o
  const payload = {
    title,
    desc,
    type: 'video',
    ats: [],
    video_info: { fileid: fileId, duration },
    post_timer: timer || '',
  }
  return xhsFetch({
    cookieStr, method: 'POST', url: `${CREATOR}/api/sns/web/v1/note`, payload, userAgent,
  })
}

/* ── 列笔记（分析用）────────────────────────────────────── */
/**
 * 创作中心笔记列表。
 *
 * 页面实测用的接口是 `/api/sns/web/v1/note_list`（GET，带 page / page_size）。
 * 若平台改版导致结构变动，调用方应退回页面兜底（xhs-browser 读 DOM）。
 */
export async function listNotes(o) {
  const { cookieStr, page = 0, pageSize = 30, userAgent = DEFAULT_UA } = o
  return xhsFetch({
    cookieStr,
    method: 'GET',
    url: `${CREATOR}/api/sns/web/v1/note_list`,
    params: { page, page_size: pageSize, sort: 'time' },
    userAgent,
  })
}

/**
 * 把笔记列表接口的响应归一成统一形态。
 *
 * 兼容字段：data.notes / data.items / data.list，每条取
 * id / title / desc / time / status / 互动数（likes/collected/comments/shared）。
 */
export function normalizeNoteList(payload) {
  const d = payload?.data || {}
  const raw = d.notes || d.items || d.list || d.note_list || []
  if (!Array.isArray(raw))
    return { notes: [], total: null }

  const notes = raw.map((n) => {
    const interact = n.interact_info || n.interactions || {}
    return {
      id: n.id || n.note_id || n.noteId || null,
      title: (n.title || n.display_title || n.name || '').trim(),
      desc: (n.desc || n.description || '').slice(0, 200),
      time: n.time || n.create_time || n.publish_time || n.updated_at || null,
      status: n.status || n.note_status || null,
      nums: [
        interact.liked_count ?? interact.likes ?? n.liked_count ?? null,
        interact.collected_count ?? interact.collected ?? n.collected_count ?? null,
        interact.comment_count ?? interact.comments ?? n.comment_count ?? null,
        interact.share_count ?? interact.shared ?? n.share_count ?? null,
      ].filter((v) => v !== null && v !== undefined).map(String),
      raw: JSON.stringify(n).slice(0, 300),
    }
  })

  const total = d.total ?? d.total_count ?? d.note_total ?? null
  return { notes, total: total === null ? null : String(total) }
}

/* ── 账号信息（登录判据，比页面 DOM 可靠）────────────────── */
export async function fetchSelfInfo(o) {
  const { cookieStr, userAgent = DEFAULT_UA } = o
  return xhsFetch({
    cookieStr,
    method: 'GET',
    url: `${EDITH}/api/sns/web/v2/user/me`,
    userAgent,
  })
}

/* ── 视频：COS 直传 ─────────────────────────────────────── */
/**
 * 把视频 PUT 到 ROS/COS。
 *
 * 关键点（来自逆向报告 §5.5）：
 *   · Authorization 用 COS v5 签名，ak/sk 就是字符串 "null"
 *   · x-cos-security-token 必须是 permit.token（STS 会话票据）
 *   · key 必须**精确等于** permit.fileIds[0]，加任何后缀都会 401 upload token deny
 *   · 单文件 >1MB 要分片（SliceSize=1MB），这里按 SDK 行为分片上传
 */
export async function uploadVideoToCos(o) {
  const { permit, filePath } = o
  const cos = loadCosSign()
  if (!cos)
    return { ok: false, failureKind: 'skill_error', message: '找不到 cos_sign.cjs（COS 签名器）' }

  const buf = readFileSync(filePath)
  const fileId = (permit.fileIds || permit.file_ids || [])[0]
  const uploadAddr = permit.uploadAddr || permit.upload_addr
  const token = permit.token
  const startTime = Math.floor((permit.startTime || Date.now()) / 1000)
  const expireTime = Math.floor((permit.expireTime || (Date.now() + 900000)) / 1000)

  if (!fileId || !uploadAddr || !token)
    return { ok: false, failureKind: 'api_error', message: 'permit 缺少 fileId / uploadAddr / token' }

  const SLICE = 1048576
  const isSlice = buf.length > SLICE
  const parts = isSlice ? Math.ceil(buf.length / SLICE) : 1

  for (let i = 0; i < parts; i++) {
    const chunk = isSlice ? buf.subarray(i * SLICE, Math.min((i + 1) * SLICE, buf.length)) : buf
    const query = isSlice
      ? { partNumber: String(i + 1), uploadId: String(permit.uploadId ?? '') }
      : {}

    const headersForSign = {
      host: uploadAddr,
      'content-length': String(chunk.length),
      'content-type': 'application/octet-stream',
    }
    let authorization
    try {
      authorization = cos.getAuth({
        method: 'PUT',
        Key: fileId,
        Query: query,
        Headers: headersForSign,
        SecretId: 'null',
        SecretKey: 'null',
        KeyTime: `${startTime};${expireTime}`,
        strict: true,
      })
    } catch (e) {
      return { ok: false, failureKind: 'skill_error', message: `COS 签名失败：${e.message || e}` }
    }

    const url = `https://${uploadAddr}/${fileId}`
      + (Object.keys(query).length
        ? '?' + Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
        : '')

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 300000)
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: authorization,
          'x-cos-security-token': token,
          'content-type': 'application/octet-stream',
          'content-length': String(chunk.length),
        },
        body: chunk,
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        return {
          ok: false,
          failureKind: res.status === 401 || res.status === 403 ? 'sign_rejected' : 'api_error',
          message: `COS PUT 失败 HTTP ${res.status}：${t.slice(0, 200)}`,
        }
      }
    } catch (e) {
      clearTimeout(timer)
      return { ok: false, failureKind: 'api_error', message: `COS PUT 异常：${e.message || e}` }
    }
  }

  return { ok: true, fileId, duration: o.duration || 0, size: buf.length, parts }
}

/** 把 cookie jar 转成请求用的 cookie 串 */
export function jarToCookieStr(jar) {
  return Object.entries(jar || {})
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

export { getXt }
