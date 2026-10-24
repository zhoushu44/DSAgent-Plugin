/**
 * PDD 纯 Node HTTP 请求器（无需浏览器）
 *
 * 核心能力（全部从官方 SDK 逆向）：
 *   ① anti-content 本地生成（pdd-antistring.mjs）
 *   ② 54001 静默自愈：清 token → 读 → 有值就重放（不弹滑块）
 *   ③ 43001 识别为会话过期（不是风控）
 *   ④ Token 双存储：localStorage["__VerifyAuthToken__"] + sessionStorage["mms-pc-captcha-storage-token"]
 *   ⑤ 频率控制（HTTP 430 是频率惩罚，不是风控）
 *   ⑥ webSpiderRule 由服务端下发，不硬编码
 *
 * ══════════════════════════════════════════════════════════════════
 * 官方错误码（从 test.js @924565 提取）
 * ══════════════════════════════════════════════════════════════════
 *   ERR_CAPTCHA_CODE      = 54001   风控（需要 VerifyAuthToken）
 *   ERR_SESSION_EXPIRED   = 43001   会话过期（重新登录 / 刷新 Cookie）
 *   ERR_NO_PERMISSION     = 40010   无权限
 *   ERR_LOGIN_NEEDED      = 40001   需要登录
 *   ERR_HIGH_FREQUENCY    = 40002   高频（降速）
 *
 * ══════════════════════════════════════════════════════════════════
 * 54001 静默自愈的官方逻辑（test.js @701840，逐行还原）
 * ══════════════════════════════════════════════════════════════════
 *
 *   if (res.errorCode === 54001) {
 *     // ① 先清掉 cookie 里的旧 token（-1000ms 立即过期）
 *     if (headers.VerifyAuthToken) {
 *       const d = new Date(); d.setTime(d.getTime() - 1e3)
 *       document.cookie = "msfe-pc-cookie-captcha-token=;path=/;expires=" + d.toUTCString()
 *     }
 *     // ② 再读一次 cookie
 *     if (readCookieCaptchaToken()) {
 *       retry()                       // ★ 还有值 → 直接重放，不弹窗
 *     } else {
 *       // ③ 真的没有 → 提取新 token 存起来 + 弹滑块
 *       const t = res.result.verifyAuthToken
 *       showCaptcha({ verifyAuthToken: t, captchaRetry: retry })
 *     }
 *   }
 *
 * 这里在 Node 侧实现同样语义（token 存文件而非 cookie）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
import { getAntiString } from './pdd-antistring.mjs'

const TOKEN_FILE = path.join(homedir(), '.dsh', 'pdd-captcha-tokens.json')
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'

/** 官方错误码 */
export const ERR = {
  CAPTCHA: 54001,
  SESSION_EXPIRED: 43001,
  NO_PERMISSION: 40010,
  LOGIN_NEEDED: 40001,
  HIGH_FREQUENCY: 40002,
}

/* ── Token 存储（文件侧；等价于浏览器的 localStorage/sessionStorage） ── */
function readTokens() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) || {} } catch { return {} }
}
function writeTokens(d) {
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true })
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(d, null, 1), 'utf8')
  } catch { /* ignore */ }
}

/** 存 VerifyAuthToken（10 分钟 TTL，与官方 6e5 ms 一致） */
export function saveVerifyToken(shopKey, token) {
  if (!token) return
  const d = readTokens()
  d[shopKey] = { token, savedAt: Date.now(), expiresAt: Date.now() + 6e5 }
  writeTokens(d)
}

/** 取有效 token（过期返回 null） */
export function getVerifyToken(shopKey) {
  const d = readTokens()
  const r = d[shopKey]
  if (!r?.token) return null
  if (Date.now() > r.expiresAt) { delete d[shopKey]; writeTokens(d); return null }
  return r.token
}

/** 清 token（54001 时调用，等价于官方清 cookie） */
export function clearVerifyToken(shopKey) {
  const d = readTokens()
  if (d[shopKey]) { delete d[shopKey]; writeTokens(d) }
}

/* ── 频率控制：避免 HTTP 430 ── */
const lastHit = new Map()
const MIN_GAP = 1800   // 官方 SDK 最常用间隔

async function throttle(url) {
  const now = Date.now()
  const gap = now - (lastHit.get(url) || 0)
  if (gap < MIN_GAP) await new Promise(r => setTimeout(r, MIN_GAP - gap))
  lastHit.set(url, Date.now())
}

/**
 * 发起请求（带 54001 自愈 + 限速）
 *
 * @param {object} opts
 * @param {string} opts.shopKey   账号
 * @param {string} opts.cookies   Cookie 字符串（PASS_ID=xxx; ...）
 * @param {string} opts.url       完整 URL
 * @param {object} [opts.body]    POST body
 * @param {string} [opts.method]  默认 POST
 * @param {string} [opts.referer]
 * @param {string} [opts.ua]
 * @param {string} [opts.webSpiderRule]  由服务端下发的值（可选）
 * @param {number} [opts.maxRetry]       54001 重试次数，默认 2
 */
export async function call(opts) {
  const {
    shopKey, cookies, url,
    body = {}, method = 'POST', referer,
    ua = DEFAULT_UA, webSpiderRule, maxRetry = 2,
  } = opts

  let lastErr = null
  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    await throttle(url)

    // ★ 每次重新生成签名（官方：绝不可缓存）
    const anti = getAntiString()
    // ★ 每次尝试都重新读 token（自愈后 token 会变）
    const vtk = getVerifyToken(shopKey)

    const headers = {
      'accept': '*/*',
      'accept-language': 'zh-CN,zh;q=0.9',
      'cache-control': 'max-age=0',
      'content-type': 'application/json',
      'origin': 'https://mms.pinduoduo.com',
      'priority': 'u=1, i',
      'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'anti-content': anti,
      'cookie': cookies,
      'user-agent': ua,
      'referer': referer || 'https://mms.pinduoduo.com/',
    }
    if (webSpiderRule) headers['webSpiderRule'] = webSpiderRule
    if (vtk) headers['VerifyAuthToken'] = vtk

    const reqOpts = { method, headers, signal: AbortSignal.timeout(20000) }
    if (method === 'POST') {
      // ★ body 里也带 crawlerInfo（官方双投放）
      reqOpts.body = JSON.stringify({ ...body, crawlerInfo: anti })
    }

    let resp, text, json
    try {
      resp = await fetch(url, reqOpts)
      text = await resp.text()
      try { json = JSON.parse(text) } catch { json = null }
    } catch (e) {
      lastErr = { ok: false, kind: 'network', text: e.message, attempts: attempt + 1 }
      if (attempt < maxRetry) continue
      return lastErr
    }

    const ec = Number(json?.error_code ?? json?.errorCode ?? 0)
    const ok = json?.success === true || ec === 1000000

    if (ok) {
      return { ok: true, json, text, http: resp.status, attempts: attempt + 1, anti, usedToken: !!vtk }
    }

    // ── 54001：官方静默自愈 ──
    if (ec === ERR.CAPTCHA) {
      const newToken = json?.result?.verifyAuthToken
      // ① 官方逻辑：先清旧 token
      clearVerifyToken(shopKey)
      if (newToken) {
        // ② 存新 token
        saveVerifyToken(shopKey, newToken)
        // ③ 有 token → 重放，不弹滑块
        if (attempt < maxRetry) continue
      }
      return {
        ok: false, kind: 'captcha', ec, http: resp.status, json, text,
        verifyAuthToken: newToken,
        attempts: attempt + 1,
        hint: newToken
          ? `已提取 verifyAuthToken 但重试 ${maxRetry} 次仍失败`
          : `54001 但响应无 verifyAuthToken（需要真的过滑块）`,
      }
    }

    // ── 43001：会话过期（不是风控！）──
    // ★ 2026-10-25：HTTP 430 与 body 43001 是两回事，必须分开。
    //   实测：queryMallScoreOverView 返回 http=430 + {"error_code":"43001"}，
    //   但 Cookie 明明是好的（同一 Cookie 打 queryMallFlowData 立刻成功）。
    //   → HTTP 430 是**网关级频率惩罚**（edge 层限流），不是会话过期。
    //   误判成 session_expired 会让上层去"重新登录"，纯属误导。
    if (resp.status === 430) {
      // 网关级惩罚：等更久再试（比 40002 更久）
      if (attempt < maxRetry) {
        const wait = 15000 * (attempt + 1)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      return {
        ok: false, kind: 'rate_limit', ec: ec || 430, http: resp.status, json, text,
        attempts: attempt + 1,
        hint: 'HTTP 430 网关级频率惩罚（Cookie 有效，是请求太密）。等 1~2 分钟再试。',
      }
    }
    if (ec === ERR.SESSION_EXPIRED) {
      return {
        ok: false, kind: 'session_expired', ec, http: resp.status, json, text,
        attempts: attempt + 1,
        hint: 'Cookie 已过期，请到「账号连接」重新登录拼多多商家后台',
      }
    }

    // ── 40002：高频，等更久 ──
    if (ec === ERR.HIGH_FREQUENCY) {
      if (attempt < maxRetry) {
        await new Promise(r => setTimeout(r, 5000 * (attempt + 1)))
        continue
      }
      return { ok: false, kind: 'rate_limit', ec, http: resp.status, json, text, attempts: attempt + 1 }
    }

    // ── 40001 / 40010 ──
    if (ec === ERR.LOGIN_NEEDED || ec === ERR.NO_PERMISSION) {
      return {
        ok: false, kind: ec === ERR.LOGIN_NEEDED ? 'login_needed' : 'no_permission',
        ec, http: resp.status, json, text, attempts: attempt + 1,
        hint: ec === ERR.LOGIN_NEEDED ? '需要登录' : '当前账号无该业务权限',
      }
    }

    // ── 业务错误（3000000 等）──
    return {
      ok: false, kind: 'api_error', ec, http: resp.status, json, text,
      msg: json?.error_msg ?? json?.errorMsg ?? '',
      attempts: attempt + 1,
    }
  }
  return lastErr || { ok: false, kind: 'unknown' }
}

/**
 * 便捷：从 CredentialStore 拿 Cookie 字符串
 */
export function cookiesOf(acc) {
  const ck = acc?.cookies || {}
  return Object.entries(ck).map(([k, v]) => `${k}=${v}`).join('; ')
}
