/**
 * PDD 防风控引擎
 *
 * ══════════════════════════════════════════════════════════════════
 * 设计原则（全部有实测依据）
 * ══════════════════════════════════════════════════════════════════
 *
 * ① 节流的维度是「账号」不是「进程」
 *    实测：每次 skill 是新 Node 子进程，内存计时器归零 → 首请求立即发
 *          N 并发时实际 ≈ N × 1/5s，等于没节流
 *    → 必须落盘持久化「上次请求时间 + 下次允许时间」
 *
 * ② 时间槽预留（防并发穿透）
 *    错误做法：await sleep(gap) 然后发请求
 *              → 并发协程读到同一旧值，同时放行
 *    正确做法：先同步占用 nextAllowedAt，再 await
 *
 * ③ 后台防节流（Chrome flags）
 *    浏览器挂后台时渲染器被节流 → CDP 超时
 *    → 四个 flag 必须加
 *
 * ④ 错误码分级（官方错误码表）
 *    54001  风控      → 清 token + 提取新 token + 重放（不弹滑块）
 *    43001  会话过期  → 重新登录（不是风控！）
 *    40001  未登录    → 重新登录
 *    40002  高频      → 长冷却 240s（官方实测：240s 冷却也无效，只能降级）
 *    40010  无权限    → 换号
 *
 * ⑤ 指数退避 + 抖动
 *    官方 SDK：2^r × n（r=重试次数，n=基础间隔）
 *
 * ⑥ 账号健康分
 *    54001 → -10
 *    静默拒绝/43001 → -30
 *    今日 ≥3 次 54001 → 冷却 2 小时
 *    health < 30 → 废弃
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'

const STATE_FILE = path.join(homedir(), '.dsh', 'pdd-throttle-state.json')

/** 官方错误码 */
export const ERR = {
  CAPTCHA: 54001,
  SESSION_EXPIRED: 43001,
  NO_PERMISSION: 40010,
  LOGIN_NEEDED: 40001,
  HIGH_FREQUENCY: 40002,
}

/** 默认节流参数（实测值） */
export const THROTTLE = {
  baseGapMs: 4000,        // 基础间隔 4s
  jitterMs: 2000,         // 随机抖动 0~2s
  perEndpointGapMs: 1800, // 同接口最小间隔（官方 SDK 最常用值）
  cooldownAfterRiskMs: 60 * 1000,      // 命中风控后 60s 冷却
  cooldownAfterFreqMs: 240 * 1000,     // 40002 后 240s（官方实测）
  cooldownLongMs: 2 * 60 * 60 * 1000,  // 今日 ≥3 次风控 → 2 小时
}

/** 账号健康分规则 */
export const HEALTH = {
  init: 100,
  captchaHit: -10,
  sessionLost: -30,
  rateLimit: -20,
  restoredPerHour: 10,
  discardBelow: 30,
  dailyCaptchaThreshold: 3,
}

/* ── 状态持久化 ── */
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {} } catch { return {} }
}
function writeState(s) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1), 'utf8')
  } catch { /* ignore */ }
}

function today() { return new Date().toISOString().slice(0, 10) }

/**
 * ★ 时间槽预留（同步占位，防并发穿透）
 *
 * @param {string} shopKey
 * @param {string} endpoint 接口路径（用于 per-endpoint 节流）
 * @returns {Promise<{ waitMs: number, allowedAt: number }>}
 */
export async function reserveSlot(shopKey, endpoint = '') {
  const state = readState()
  const now = Date.now()

  const acct = state[shopKey] || {}
  if (acct.date !== today()) { acct.date = today(); acct.captchaCount = 0 }

  // ① 检查冷却
  if (acct.cooldownUntil && now < acct.cooldownUntil) {
    return { waitMs: acct.cooldownUntil - now, allowedAt: acct.cooldownUntil, cooling: true, reason: acct.cooldownReason || '风控冷却' }
  }

  // ② 账号级时间槽
  const gap = THROTTLE.baseGapMs + Math.floor(Math.random() * THROTTLE.jitterMs)
  const acctNext = Math.max(now, acct.nextAllowedAt || 0)
  const acctAllowedAt = acctNext

  // ③ 接口级时间槽
  acct.endpoints = acct.endpoints || {}
  const ep = acct.endpoints[endpoint] || 0
  const epAllowedAt = Math.max(now, ep + THROTTLE.perEndpointGapMs)

  const allowedAt = Math.max(acctAllowedAt, epAllowedAt)
  const waitMs = Math.max(0, allowedAt - now)

  // ★ 同步占位：立刻写入文件，防止并发读到同一旧值
  acct.nextAllowedAt = allowedAt + gap
  acct.endpoints[endpoint] = allowedAt
  acct.lastRequestAt = allowedAt
  state[shopKey] = acct
  writeState(state)

  return { waitMs, allowedAt, cooling: false }
}

/**
 * 记录一次请求结果，更新健康分 / 冷却
 * @param {string} shopKey
 * @param {'ok'|'captcha'|'session'|'rate_limit'|'other'} kind
 * @param {object} [detail]
 */
export function recordResult(shopKey, kind, detail = {}) {
  const state = readState()
  const acct = state[shopKey] || { health: HEALTH.init, date: today(), captchaCount: 0 }
  if (acct.date !== today()) { acct.date = today(); acct.captchaCount = 0 }

  acct.stats = acct.stats || { ok: 0, captcha: 0, session: 0, rateLimit: 0, other: 0 }
  acct.health = acct.health ?? HEALTH.init

  const now = Date.now()

  if (kind === 'ok') {
    acct.stats.ok++
    // 每小时恢复 10 分
    if (acct.lastRestoreAt && now - acct.lastRestoreAt > 3600_000) {
      acct.health = Math.min(HEALTH.init, acct.health + HEALTH.restoredPerHour)
      acct.lastRestoreAt = now
    }
  } else if (kind === 'captcha') {
    acct.stats.captcha++
    acct.captchaCount = (acct.captchaCount || 0) + 1
    acct.health = Math.max(0, acct.health + HEALTH.captchaHit)
    acct.cooldownUntil = now + THROTTLE.cooldownAfterRiskMs
    acct.cooldownReason = `54001 风控（今日第 ${acct.captchaCount} 次）`
    // 今日 ≥3 次 → 长冷却
    if (acct.captchaCount >= HEALTH.dailyCaptchaThreshold) {
      acct.cooldownUntil = now + THROTTLE.cooldownLongMs
      acct.cooldownReason = `今日 54001 已达 ${acct.captchaCount} 次，冷却 2 小时`
    }
  } else if (kind === 'session') {
    acct.stats.session++
    acct.health = Math.max(0, acct.health + HEALTH.sessionLost)
    acct.needRelogin = true
  } else if (kind === 'rate_limit') {
    acct.stats.rateLimit++
    acct.health = Math.max(0, acct.health + HEALTH.rateLimit)
    acct.cooldownUntil = now + THROTTLE.cooldownAfterFreqMs
    acct.cooldownReason = '40002 高频限流'
  } else {
    acct.stats.other++
  }

  state[shopKey] = acct
  writeState(state)
  return acct
}

/** 查账号状态 */
export function getAccountState(shopKey) {
  const state = readState()
  return state[shopKey] || null
}

/** 是否可用（未冷却 + 健康分够） */
export function canUse(shopKey) {
  const st = getAccountState(shopKey)
  if (!st) return { ok: true, health: HEALTH.init }
  const now = Date.now()
  if (st.cooldownUntil && now < st.cooldownUntil) {
    return { ok: false, reason: st.cooldownReason || '冷却中', remainMs: st.cooldownUntil - now, health: st.health }
  }
  if ((st.health ?? 100) < HEALTH.discardBelow) {
    return { ok: false, reason: `健康分过低（${st.health}），建议换号`, health: st.health }
  }
  if (st.needRelogin) {
    return { ok: false, reason: '需要重新登录', health: st.health }
  }
  return { ok: true, health: st.health }
}

/** 人工清除冷却（用户重新登录/过滑块后） */
export function clearCooldown(shopKey) {
  const state = readState()
  const acct = state[shopKey]
  if (!acct) return
  delete acct.cooldownUntil
  delete acct.cooldownReason
  delete acct.needRelogin
  acct.health = Math.min(HEALTH.init, (acct.health ?? 0) + 20)
  state[shopKey] = acct
  writeState(state)
}

/**
 * 指数退避等待
 * @param {number} retry 第几次重试（从 0 开始）
 * @param {number} baseMs 基础间隔
 */
export async function backoffWait(retry, baseMs = 1800) {
  const ms = Math.pow(2, retry) * baseMs
  const jitter = Math.floor(Math.random() * 500)
  await new Promise(r => setTimeout(r, Math.min(ms, 30000) + jitter))
}

/** 可读剩余时间 */
export function fmtRemain(ms) {
  const m = Math.ceil(ms / 60000)
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  return `${h} 小时 ${m % 60} 分钟`
}

/** 节流统计（调试用） */
export function getStats(shopKey) {
  const st = getAccountState(shopKey)
  if (!st) return null
  return {
    health: st.health,
    todayCaptcha: st.captchaCount || 0,
    stats: st.stats || {},
    cooldownUntil: st.cooldownUntil || null,
    cooldownReason: st.cooldownReason || null,
    lastRequestAt: st.lastRequestAt || null,
  }
}
