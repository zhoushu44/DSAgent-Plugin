/**
 * PDD 54001 静默自愈（官方五步闭环）
 *
 * ══════════════════════════════════════════════════════════════════
 * 逆向来源：拼多多官方 mms-fe SDK（shenbi_asar/test.js @700770 / @18110）
 * ══════════════════════════════════════════════════════════════════
 *
 * 官方逻辑（原文还原）：
 *
 *   function A(t, e, n) {
 *     var r = t.data
 *     if (r && 54001 === r.errorCode) {
 *       // ① 先清 cookie msfe-pc-cookie-captcha-token（-1000ms 立即过期）
 *       if (n && n.VerifyAuthToken && function () {
 *         try {
 *           var d = new Date(); d.setTime(d.getTime() - 1e3)
 *           document.cookie = "msfe-pc-cookie-captcha-token=;path=/;expires=" + d.toUTCString()
 *         } catch (t) {}
 *       }(),
 *       // ② 再读一次 cookie
 *       D()) {
 *         e()                      // ← 有值 → 直接重放，不弹窗
 *       } else {
 *         var i = r.result && r.result.verifyAuthToken || ""
 *         g.emit("FLOATING_CAPTCHA", { verifyAuthToken: i, captchaRetry: e, captchaCallback: k })
 *       }
 *     }
 *   }
 *
 * 关键点：**先清 cookie，再检查**。清完还有值说明是别处刚写回的，
 * 此时直接重放原请求即可，不需要弹滑块。
 *
 * ══════════════════════════════════════════════════════════════════
 * Token 存储位置（三处，官方都写）
 * ══════════════════════════════════════════════════════════════════
 *   document.cookie   msfe-pc-cookie-captcha-token   TTL 6e5 ms = 10 分钟
 *   localStorage     __VerifyAuthToken__
 *   sessionStorage   mms-pc-captcha-storage-token
 *
 * 请求时三处取值，优先级 sessionStorage > localStorage > cookie。
 * body 字段名是 `verifyauthtoken`（全小写）。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'

/** 官方常量 */
export const CAPTCHA_COOKIE_KEY = 'msfe-pc-cookie-captcha-token'
export const CAPTCHA_TTL_MS = 6 * 60 * 1000   // 10 分钟（官方 6e5）
export const CAPTCHA_LS_KEY = '__VerifyAuthToken__'
export const CAPTCHA_SS_KEY = 'mms-pc-captcha-storage-token'

export const ERR = {
  CAPTCHA: 54001,
  SESSION_EXPIRED: 43001,
  NO_PERMISSION: 40010,
  LOGIN_NEEDED: 40001,
  HIGH_FREQUENCY: 40002,
} as const

const TOKEN_FILE = path.join(homedir(), '.dsh', 'pdd-captcha-tokens.json')

/* ── Node 侧 token 持久化（等价于浏览器的三处存储） ── */

function readTokens(): Record<string, { token: string; savedAt: number; expiresAt: number }> {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) || {} } catch { return {} }
}
function writeTokens(d: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true })
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(d, null, 1), 'utf8')
  } catch { /* 忽略 */ }
}

/** 存 token（10 分钟 TTL） */
export function saveCaptchaToken(shopKey: string, token: string): void {
  if (!token) return
  const d = readTokens()
  d[shopKey] = { token, savedAt: Date.now(), expiresAt: Date.now() + CAPTCHA_TTL_MS }
  writeTokens(d)
}

/** 取有效 token，过期返回 null */
export function getCaptchaToken(shopKey: string): string | null {
  const d = readTokens()
  const r = d[shopKey]
  if (!r?.token) return null
  if (Date.now() > r.expiresAt) { delete d[shopKey]; writeTokens(d); return null }
  return r.token
}

/** 清 token（官方：54001 时先清） */
export function clearCaptchaToken(shopKey: string): void {
  const d = readTokens()
  if (d[shopKey]) { delete d[shopKey]; writeTokens(d) }
}

/** 从响应里提取 verifyAuthToken */
export function extractCaptchaToken(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const t = (json as Record<string, any>).result?.verifyAuthToken
    ?? (json as Record<string, any>).data?.verifyAuthToken
  return typeof t === 'string' && t.length > 10 ? t : null
}

/** 从浏览器页面读 token（sessionStorage > localStorage > cookie） */
export async function readTokenFromPage(page: any): Promise<string | null> {
  try {
    return await page.evaluate(([ss, ls, ck]: string[]) => {
      return (sessionStorage.getItem(ss) || localStorage.getItem(ls)
        || (document.cookie.match(new RegExp('(?:^|.*;\\s*)' + ck + '\\s*=\\s*([^;]*).*$')) || [])[1] || null) as string | null
    }, [CAPTCHA_SS_KEY, CAPTCHA_LS_KEY, CAPTCHA_COOKIE_KEY])
  } catch { return null }
}

/** 把 token 写进浏览器三处存储 */
export async function writeTokenToPage(page: any, token: string): Promise<void> {
  try {
    await page.evaluate(([ss, ls, ck, tk]: string[]) => {
      try { sessionStorage.setItem(ss, tk) } catch { /* 忽略 */ }
      try { localStorage.setItem(ls, tk) } catch { /* 忽略 */ }
      try {
        const d = new Date(); d.setTime(d.getTime() + 600000)
        document.cookie = ck + '=' + encodeURIComponent(tk) + ';path=/;expires=' + d.toUTCString()
      } catch { /* 忽略 */ }
    }, [CAPTCHA_SS_KEY, CAPTCHA_LS_KEY, CAPTCHA_COOKIE_KEY, token])
  } catch { /* 忽略 */ }
}

/** 清掉浏览器里的旧 token（官方：-1000ms 立即过期） */
export async function clearTokenInPage(page: any): Promise<void> {
  try {
    await page.evaluate((ck: string) => {
      try { sessionStorage.removeItem('mms-pc-captcha-storage-token') } catch { /* 忽略 */ }
      try { localStorage.removeItem('__VerifyAuthToken__') } catch { /* 忽略 */ }
      try {
        const d = new Date(); d.setTime(d.getTime() - 1000)
        document.cookie = ck + '=;path=/;expires=' + d.toUTCString()
      } catch { /* 忽略 */ }
    }, CAPTCHA_COOKIE_KEY)
  } catch { /* 忽略 */ }
}

/**
 * ★ 54001 静默自愈（官方闭环的 Node 实现）
 *
 * 流程：
 *   ① 若请求带了 VerifyAuthToken → 先清掉（Node 侧 + 浏览器侧）
 *   ② 从响应提取新 verifyAuthToken → 存起来
 *   ③ 读一次：还有值 → 返回「应重放」（不弹滑块）
 *      没有值 → 返回「需人工过滑块」
 *
 * @param page       浏览器页面（可传 null，则只操作 Node 侧）
 * @param shopKey    账号
 * @param respJson   54001 的响应
 * @param hadToken   原请求是否带了 VerifyAuthToken 头
 */
export async function handleCaptcha(
  page: any | null,
  shopKey: string,
  respJson: unknown,
  hadToken: boolean,
): Promise<{ action: 'replay' | 'need_slider'; token: string | null }> {
  // ① 先清（官方：只有带了 token 才清）
  if (hadToken) {
    clearCaptchaToken(shopKey)
    if (page) await clearTokenInPage(page)
  }
  // ② 提取新 token
  const newToken = extractCaptchaToken(respJson)
  if (newToken) {
    saveCaptchaToken(shopKey, newToken)
    if (page) await writeTokenToPage(page, newToken)
  }
  // ③ 再读一次：有值 → 重放；空 → 弹滑块
  const after = getCaptchaToken(shopKey) || (page ? await readTokenFromPage(page) : null)
  if (after) return { action: 'replay', token: after }
  return { action: 'need_slider', token: newToken }
}

/** 人类可读的剩余时间 */
export function fmtRemain(ms: number): string {
  const m = Math.ceil(ms / 60000)
  if (m < 60) return `${m} 分钟`
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分钟`
}

/**
 * ★ 页面内 54001 自愈脚本（evaluateOnNewDocument）
 *
 * 复刻官方 SDK 的行为：hook XHR + fetch 的响应，
 * 一旦看到 errorCode 54001 就执行「清 token → 存新 token → 有值就重放」。
 *
 * 为什么不做：
 *   · 不自动拖滑块（PDD 滑块服务端校验轨迹，且会把账号打到重量级风控）
 *   · 只做「有 token 就重放」这一层 —— 这是官方自己也是这么干的
 */
export const CAPTCHA_SELF_HEAL = `(function () {
  var CK = '${CAPTCHA_COOKIE_KEY}'
  var SS = '${CAPTCHA_SS_KEY}'
  var LS = '${CAPTCHA_LS_KEY}'

  function readToken() {
    try {
      return sessionStorage.getItem(SS) || localStorage.getItem(LS)
        || (document.cookie.match(new RegExp('(?:^|.*;\\\\s*)' + CK + '\\\\s*=\\\\s*([^;]*).*$')) || [])[1] || ''
    } catch (e) { return '' }
  }
  function writeToken(tk) {
    try { sessionStorage.setItem(SS, tk) } catch (e) {}
    try { localStorage.setItem(LS, tk) } catch (e) {}
    try {
      var d = new Date(); d.setTime(d.getTime() + 600000)
      document.cookie = CK + '=' + encodeURIComponent(tk) + ';path=/;expires=' + d.toUTCString()
    } catch (e) {}
  }
  function clearToken() {
    try { sessionStorage.removeItem(SS) } catch (e) {}
    try { localStorage.removeItem(LS) } catch (e) {}
    try {
      var d = new Date(); d.setTime(d.getTime() - 1000)
      document.cookie = CK + '=;path=/;expires=' + d.toUTCString()
    } catch (e) {}
  }

  /** 从响应体里找 54001 + verifyAuthToken */
  function parse(text) {
    try {
      var j = JSON.parse(text)
      var ec = j && (j.errorCode || j.error_code)
      if (Number(ec) === 54001) {
        var tk = (j.result && j.result.verifyAuthToken) || ''
        return { hit: true, token: tk }
      }
    } catch (e) {}
    return { hit: false }
  }

  /** hook XHR */
  function hookXHR() {
    try {
      var O = XMLHttpRequest.prototype.open
      var S = XMLHttpRequest.prototype.send
      XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; this.__m = m; this.__hadTok = false; return O.apply(this, arguments) }
      var origSet = XMLHttpRequest.prototype.setRequestHeader
      XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
        if (/^verifyauthtoken$/i.test(k) && v) this.__hadTok = true
        return origSet.apply(this, arguments)
      }
      XMLHttpRequest.prototype.send = function (body) {
        var self = this
        this.__body = body
        this.addEventListener('load', function () {
          try {
            var txt = self.responseText
            if (!txt || txt.indexOf('54001') < 0) return
            var r = parse(txt)
            if (!r.hit) return
            // ① 先清（官方：只有带了 token 才清）
            if (self.__hadTok) clearToken()
            // ② 存新 token
            if (r.token) writeToken(r.token)
            // ③ 有值 → 重放一次（只重放一次，防环）
            var after = readToken()
            if (after && !self.__replayed) {
              self.__replayed = true
              try {
                self.setRequestHeader('VerifyAuthToken', after)
              } catch (e) {}
              setTimeout(function () {
                try { self.abort() } catch (e) {}
                var x2 = new XMLHttpRequest()
                x2.open(self.__m || 'POST', self.__u, true)
                x2.setRequestHeader('VerifyAuthToken', after)
                x2.send(self.__body || null)
              }, 1800)
            }
          } catch (e) {}
        })
        return S.apply(this, arguments)
      }
    } catch (e) {}
  }

  /** hook fetch */
  function hookFetch() {
    try {
      var OF = window.fetch
      window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || ''
        var hadTok = !!(init && init.headers && (
          (typeof init.headers.get === 'function' && init.headers.get('VerifyAuthToken'))
          || init.headers['VerifyAuthToken'] || init.headers['verifyauthtoken']))
        return OF.apply(this, arguments).then(function (resp) {
          try {
            var c = resp.clone()
            c.text().then(function (txt) {
              if (!txt || txt.indexOf('54001') < 0) return
              var r = parse(txt)
              if (!r.hit) return
              if (hadTok) clearToken()
              if (r.token) writeToken(r.token)
              var after = readToken()
              if (after) {
                // 有 token：下次请求会自动带上（fetch 侧不重放，避免副作用）
                if (window.console && window.console.debug) {
                  window.console.debug('[pdd-captcha] 54001 自愈：已刷新 VerifyAuthToken')
                }
              }
            }).catch(function () {})
          } catch (e) {}
          return resp
        })
      }
    } catch (e) {}
  }

  hookXHR()
  hookFetch()
})()`
