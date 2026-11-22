/**
 * taobao-risk.mjs —— 淘宝风控网关（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 淘宝风控的真实形态（吸收自 gateway-proxy.ts + 2026-11-18 实测）
 * ══════════════════════════════════════════════════════════════════
 *
 * ① MTOP 层（JSON 响应）
 *    ret: ["FAIL_SYS_USER_VALIDATE", "RGV587_ERROR::SM::哎哟喂,被挤爆啦,请稍后重试"]
 *    data.url: .../_____tmd_____/punish?x5secdata=...&action=denycdc_forbidden&pureCaptcha=
 *
 * ② HTTP 层（HTML 响应 + 响应头）——官方优先判这条，比 body 关键词更早更准
 *    riskSubtype:
 *      'waf-block'   → 存在 bxpunish 头：**IP 级封锁，过滑块也没用，必须换网络出口**
 *      'bixi-punish' → 滑块页（punish URL 是权威信号）
 *      'waf-html'    → WAF 拦截页
 *
 * ③ 判断「有没有滑块可过」
 *    action=denycdc_forbidden + pureCaptcha 为空 → **接口级封禁，无滑块**（实测最常见）
 *    其它 action 且有 pureCaptcha → 可以人工过滑块
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ 一个必须记住的坑（FIX-LOG #50）
 * ══════════════════════════════════════════════════════════════════
 *   `x5secdata` **不是**「验证通过」凭证，而是「平台要求你验证」的挑战串。
 *   把它当通过凭证会导致：
 *     1. RGV587 响应本身携带 x5secdata → 误判为已通过 → 冷却被立刻解除，节流形同虚设
 *     2. riskVerify 一进 punish 页就能读到 x5secdata → 立刻「成功」返回，根本没等用户过滑块
 *   真正的通过凭证只有：`x5sec` / `_x5sec` / `x5sectag`（见 taobao-sign.mjs）
 *
 * ══════════════════════════════════════════════════════════════════
 * 冷却策略
 * ══════════════════════════════════════════════════════════════════
 *   官方：命中 risk_control 后 60s 内不再发请求。
 *   基座：指数退避 60s → 5min → 15min → 1h。
 *         实测详情接口的 denycdc_forbidden 恢复远慢于 60s，
 *         60s 就重试等于持续给账号加风险分。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const RISK_FILE = path.join(os.homedir(), '.dsh', 'taobao-risk.json')
const BACKOFF = [60_000, 300_000, 900_000, 3_600_000]   // 60s → 5min → 15min → 1h

// ── 域名级路由冷却（吸收自 gateway-proxy isRouteCoolingDown）──
// 域名连续失败 ≥2 次 → 冷却 60s。避免对一个已经挂掉的域持续打。
const ROUTE_FAILURE_THRESHOLD = 2
const ROUTE_COOLDOWN_MS = 60_000
const routeFailures = new Map()
const routeCooldownUntil = new Map()

function readState() {
  try { return JSON.parse(fs.readFileSync(RISK_FILE, 'utf8')) } catch { return {} }
}

function writeState(s) {
  try {
    fs.mkdirSync(path.dirname(RISK_FILE), { recursive: true })
    fs.writeFileSync(RISK_FILE, JSON.stringify(s, null, 1), 'utf8')
  } catch { /* 记账失败不阻塞 */ }
}

/** 该账号是否还在冷却 */
export function riskState(shopKey) {
  const st = readState()[shopKey] || {}
  const now = Date.now()
  const remain = Math.max(0, (st.until || 0) - now)
  return {
    cooling: remain > 0, remainMs: remain,
    strike: st.strike || 0, reason: st.reason || '', until: st.until || 0,
    verifyUrl: st.verifyUrl || '', riskKind: st.riskKind || '',
  }
}

/**
 * 记一次风控命中（指数退避）
 * @param {string} shopKey
 * @param {object|string} detail  {reason, verifyUrl, riskKind} 或字符串
 */
export function markRisk(shopKey, detail = '') {
  const all = readState()
  const prev = all[shopKey] || {}
  const strike = Math.min((prev.strike || 0) + 1, BACKOFF.length)
  const wait = BACKOFF[strike - 1] || BACKOFF[BACKOFF.length - 1]
  const d = typeof detail === 'string' ? { reason: detail } : (detail || {})
  all[shopKey] = {
    strike,
    until: Date.now() + wait,
    reason: String(d.reason || '').slice(0, 300),
    verifyUrl: String(d.verifyUrl || '').slice(0, 600),
    riskKind: String(d.riskKind || ''),
    updatedAt: new Date().toISOString(),
  }
  writeState(all)
  return {
    cooling: true, remainMs: wait, strike,
    reason: all[shopKey].reason, verifyUrl: all[shopKey].verifyUrl, riskKind: all[shopKey].riskKind,
  }
}

/** 手动解除账号冷却（风控已过 / 换号后） */
export function clearRisk(shopKey) {
  const all = readState()
  delete all[shopKey]
  writeState(all)
  return true
}

// ── 域名级路由冷却 ────────────────────────────────────────

export function isRouteCoolingDown(host) {
  const until = routeCooldownUntil.get(host)
  if (!until) return false
  if (Date.now() >= until) {
    routeCooldownUntil.delete(host)
    routeFailures.delete(host)
    return false
  }
  return true
}

export function reportRouteSuccess(host) {
  routeFailures.delete(host)
}

export function reportRouteFailure(host) {
  const count = (routeFailures.get(host) || 0) + 1
  routeFailures.set(host, count)
  if (count >= ROUTE_FAILURE_THRESHOLD) {
    routeCooldownUntil.set(host, Date.now() + ROUTE_COOLDOWN_MS)
  }
  return { count, cooling: count >= ROUTE_FAILURE_THRESHOLD }
}

export function routeState(host) {
  const until = routeCooldownUntil.get(host) || 0
  return {
    failures: routeFailures.get(host) || 0,
    cooling: until > Date.now(),
    remainMs: Math.max(0, until - Date.now()),
  }
}

// ── 识别 ───────────────────────────────────────────────

/** 判断 mtop 响应是不是风控（只认 ret 数组，避免被 UGC 文本误伤） */
export function isRiskPayload(payload) {
  const ret = Array.isArray(payload?.ret) ? payload.ret.join(',') : ''
  if (/FAIL_SYS_USER_VALIDATE|RGV587|被挤爆/i.test(ret)) return true
  const url = payload?.data?.url || ''
  if (/_____tmd_____|punish/i.test(url)) return true
  return false
}

/**
 * 风控子类型判定（吸收自 gateway-proxy riskSubtype）
 * @param {object} o
 * @param {string} [o.html]         HTML 响应体
 * @param {object} [o.headers]      响应头
 * @param {object} [o.payload]      JSON payload
 * @returns {{kind:string, canSolve:boolean, detail:string, enforceChangeIp:boolean}}
 */
export function riskKind({ html = '', headers = {}, payload = null } = {}) {
  const h = {}
  for (const [k, v] of Object.entries(headers || {})) h[String(k).toLowerCase()] = v

  // ① IP 级封锁：bxpunish 头（Accio 的 br 函数最先查这个）
  if (h['bxpunish'] || h['bxpunish-msg']) {
    return {
      kind: 'waf-block', canSolve: false, enforceChangeIp: true,
      detail: `bxpunish: ${h['bxpunish'] || h['bxpunish-msg']}`.slice(0, 300),
    }
  }

  // ② HTML 风控页
  const isHtml = /^\s*<!doctype|^\s*<html/i.test(html) || html.includes('bixi-intl.alicdn.com/punish')
  if (isHtml) {
    const isPunish = /punish/i.test(html)
    return {
      kind: isPunish ? 'bixi-punish' : 'waf-html',
      canSolve: isPunish,
      enforceChangeIp: false,
      detail: isPunish ? 'HTML 滑块页' : 'WAF 拦截页',
    }
  }

  // ③ MTOP JSON 层
  if (payload) {
    const ret = Array.isArray(payload.ret) ? payload.ret.join(',') : ''
    const url = payload?.data?.url || ''
    const banned = /denycdc_forbidden/i.test(url) || /pureCaptcha=(?:&|$)/.test(url)
    return {
      kind: banned ? 'ban' : 'captcha',
      canSolve: !banned,
      enforceChangeIp: false,
      detail: ret || url,
    }
  }

  return { kind: '', canSolve: false, enforceChangeIp: false, detail: '' }
}

/** 从 payload 里提取 verifyUrl（给用户去浏览器过滑块） */
export function extractVerifyUrl(payload) {
  const url = payload?.data?.url || ''
  if (!url) return ''
  return String(url).startsWith('http') ? url : `https:${url}`
}

export default {
  riskState, markRisk, clearRisk,
  isRouteCoolingDown, reportRouteSuccess, reportRouteFailure, routeState,
  isRiskPayload, riskKind, extractVerifyUrl,
}
