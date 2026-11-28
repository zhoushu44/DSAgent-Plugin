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
import { getAntiString } from './pdd-antistring.mjs'
import * as signMod from './pdd-sign.mjs'
import { signPlan } from './pdd-sign-scope.mjs'

/* ── UA 与客户端提示头（sec-ch-ua）──
 *
 * ★ 2026-10-27 修：原来 sec-ch-ua 硬编码 `v="128"`，而同一文件里的
 *   DEFAULT_UA 写的是 `Chrome/155.0.0.0` —— **同一次请求的两个头自相矛盾**。
 *   这种不一致本身就是风控信号（真实浏览器这两个值必然同源）。
 *
 *   现在改为从实际 chrome.exe 版本推导，UA 与 sec-ch-ua 永远一致。
 *   推导失败时退到 DEFAULT_UA 的主版本号，保证两者仍自洽。
 */
import { execFileSync } from 'node:child_process'

/** 探测本机 Chrome 主版本号（失败返回 null） */
function detectChromeMajor() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.CHROME_PATH,
  ].filter(Boolean)
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue
      const out = execFileSync('powershell', ['-NoProfile', '-Command',
        `(Get-Item '${p}').VersionInfo.ProductVersion`], { encoding: 'utf8', timeout: 8000 })
      const major = String(out).trim().split('.')[0]
      if (/^\d+$/.test(major)) return major
    } catch { /* 试下一个 */ }
  }
  return null
}

const CHROME_MAJOR = detectChromeMajor() || '155'
/** UA 与 sec-ch-ua 共用同一个主版本号，确保自洽 */
const DEFAULT_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`
const SEC_CH_UA = `"Google Chrome";v="${CHROME_MAJOR}", "Chromium";v="${CHROME_MAJOR}", "Not(A:Brand";v="24"`

/** 官方错误码 */
export const ERR = {
  CAPTCHA: 54001,
  SESSION_EXPIRED: 43001,
  NO_PERMISSION: 40010,
  LOGIN_NEEDED: 40001,
  HIGH_FREQUENCY: 40002,
  // ★ 2026-11-04 补：403 + 310120000 → 官方语义是「reload 页面」，不是登录失效。
  //   证据：推广域 msfe-9d32834f5061ec2a.js@529922（eR=31012e4）与 @531800
  //   `res.status===403 && data.errorCode===310120000 → window.location.reload()`
  RELOAD_REQUIRED: 310120000,
}

/* ── Token 存储（文件侧；等价于浏览器的 localStorage/sessionStorage） ──
 *
 * ★ 2026-10-27：改为复用 pdd-risk 的存储实现（原子写），不再自带一套裸 writeFileSync。
 *   三个模块原本各自「读整个→改→写整个」同一个文件，并发时互相覆盖 token → 又弹滑块。
 *   数据结构与 TTL 三者本就一致（{token, savedAt, expiresAt}，10 分钟），收敛无行为变化。
 */
import { readCaptchaStore, writeCaptchaStore } from './pdd-risk.mjs'

function readTokens() { return readCaptchaStore() }
function writeTokens(d) { writeCaptchaStore(d) }

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

/* ── 频率控制：避免 HTTP 430 ──
 *
 * ★ 2026-10-27 修：原实现是**进程内存 Map + 按 URL 节流**：
 *
 *     const lastHit = new Map()
 *     async function throttle(url) { ... }
 *
 * 这等于**零账号级节流**。原因：每次 `dsagent_execute_skill` 都是新的 Node
 * 子进程，`lastHit` 归零 → 首个请求立即发出；并发跑 N 个技能时各自按 1.8s
 * 节流、互不知情，同一账号实际出口频率 ≈ N × 1/1.8s，必然触发风控。
 *
 * 而 `pdd-shop` 的 t1 通道（shop.mjs:105）正是用本文件 —— 这就是
 * `dsagent_pitfalls` 里 `[pdd-shop] goods 使用 t3 通道` 复现 4 次的直接原因。
 *
 * 现在改为复用 `pdd-antiban.mjs` 的 `reserveSlot`（落盘持久化 + 时间槽预留，
 * 先同步占位再 await，防并发穿透）。这是全项目唯一的账号级节流实现。
 */
let _antibanMod = null
async function antiban() {
  if (!_antibanMod) {
    try { _antibanMod = await import('./pdd-antiban.mjs') }
    catch { _antibanMod = null }
  }
  return _antibanMod
}

/**
 * 账号级节流（落盘，跨进程生效）。shopKey 缺省时退化为原进程内节流。
 *
 * ★ 2026-10-27 修（实测 bug）：原来只判断 `slot.waitMs > 0` 然后 sleep，
 *   **完全忽略 `slot.cooling`**。后果：账号命中 40002 进入 240s 冷却后，
 *   本函数会老老实实 sleep 240 秒再把请求发出去 —— 技能被挂住 4 分钟，
 *   用户看到的就是"卡住不动"。（实测：`pdd-http.call` 在冷却态下耗时 240026ms）
 *
 *   正确语义：**冷却期内直接拒绝，不发请求**。这既符合"冷却期内请勿重复调用"
 *   的产品约定，也避免把技能挂死。
 *
 * @param {string} shopKey
 * @param {string} url
 * @returns {Promise<{blocked: boolean, waitMs: number, reason?: string}>}
 *   blocked=true 表示调用方应立即返回，不要发请求
 */
async function throttle(shopKey, url) {
  const mod = await antiban()
  if (mod?.reserveSlot && shopKey) {
    const slot = await mod.reserveSlot(shopKey, url)
    if (slot.cooling) {
      return { blocked: true, waitMs: slot.waitMs, reason: slot.reason || '账号冷却中' }
    }
    if (slot.waitMs > 0) await new Promise(r => setTimeout(r, slot.waitMs))
    return { blocked: false, waitMs: slot.waitMs }
  }
  // 兜底：无 shopKey 时保留原来的进程内行为（至少不会比之前更差）
  const now = Date.now()
  const gap = now - (lastHit.get(url) || 0)
  if (gap < 1800) await new Promise(r => setTimeout(r, 1800 - gap))
  lastHit.set(url, Date.now())
  return { blocked: false, waitMs: 0 }
}

/** @deprecated 仅作无 shopKey 时的兜底，见 throttle() 注释 */
const lastHit = new Map()

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
    // ★ 账号级节流（落盘跨进程），不再是进程内存计时器
    //   ★ 2026-10-27：冷却期内直接返回，不 sleep 等待、不发请求
    //     （原来会 sleep 到冷却结束，把技能挂死几分钟）
    const slot = await throttle(shopKey, url)
    if (slot.blocked) {
      return {
        ok: false,
        kind: 'rate_limit',
        ec: 40002,
        attempts: attempt,
        hint: `账号处于风控冷却中（${slot.reason}），剩余约 ${Math.ceil(slot.waitMs / 1000)} 秒。`
          + '期间请勿重复调用（会延长封禁）。',
      }
    }

    // ★ 每次重新生成签名（官方：绝不可缓存）
    // ★★ 2026-11-04 二次修正（真机证伪后）：
    //   平台有【两个互相独立】的条件，作用在两个不同的东西上，不能合并：
    //     ① isCrawlerInfoRequired(url) = 162 条【路径前缀】白名单 → 只决定 body 要不要塞 crawlerInfo
    //     ② shouldAddAntiHeader(url)   = 【域名】正则（mms|ims|...）→ 决定 header 要不要带 Anti-Content
    //   只要域名是 mms.pinduoduo.com，Anti-Content 头就一定要带；
    //   实测反例：/vodka/v2/mms/query/display/mall/goodsList 不在 162 名单，
    //   我按「名单外=不签名」处理 → 直接 54001。详见 pdd-sign-scope.mjs 顶部注释。
    const plan = signPlan(url)
    const shouldSign = plan.headerAnti
    const shouldSendCrawlerInfo = plan.bodyCrawlerInfo
    const whitelistHit = plan.whitelistRule
    // ★ 2026-11-05：签名改走基座统一入口 pdd-sign（t1 通道 = 纯 Node 简化签名）
    //   pdd-http 只走 t1，等价于原来的 getAntiString()，但入口统一了。
    const anti = shouldSign ? (await signMod.sign({ url, tier: 't1' })).sig : null
    // ★ 每次尝试都重新读 token（自愈后 token 会变）
    const vtk = getVerifyToken(shopKey)

    const headers = {
      'accept': '*/*',
      'accept-language': 'zh-CN,zh;q=0.9',
      'cache-control': 'max-age=0',
      'content-type': 'application/json',
      'origin': 'https://mms.pinduoduo.com',
      'priority': 'u=1, i',
      'sec-ch-ua': SEC_CH_UA,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'cookie': cookies,
      'user-agent': ua,
      'referer': referer || 'https://mms.pinduoduo.com/',
    }
    if (shouldSign) headers['anti-content'] = anti
    if (webSpiderRule) headers['webSpiderRule'] = webSpiderRule
    if (vtk) headers['VerifyAuthToken'] = vtk

    const reqOpts = { method, headers, signal: AbortSignal.timeout(20000) }
    if (method === 'POST') {
      // ★ body 里也带 crawlerInfo（官方双投放，仅签名范围内）
      reqOpts.body = JSON.stringify(shouldSendCrawlerInfo ? { ...body, crawlerInfo: anti } : body)
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
      return { ok: true, json, text, http: resp.status, attempts: attempt + 1, anti, signed: shouldSign, crawlerInfoInBody: shouldSendCrawlerInfo, whitelistHit, usedToken: !!vtk }
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

    // ── 403 + 310120000：官方语义是「刷新页面」 ──
    //   ★ 2026-11-04 新增。原文：`res.status===403 && data.errorCode===310120000
    //     → window.location.reload()`（推广域 msfe @531800）。
    //   ⚠️ 不要把它当 43001/40001 去跳登录：真断了登录态返回的是 40001。
    //   这里返回 kind='reload_required'，由上层决定是重开页面还是重试。
    if (resp.status === 403 && ec === ERR.RELOAD_REQUIRED) {
      return {
        ok: false, kind: 'reload_required', ec, http: resp.status, json, text,
        attempts: attempt + 1,
        hint: '403 + 310120000 = 页面上下文已失效（不是登录失效）。重开/刷新页面后重试。',
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
