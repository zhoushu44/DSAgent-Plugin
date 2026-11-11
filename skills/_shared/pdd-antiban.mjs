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

/**
 * 默认节流参数
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ 2026-11-07 实测校准（重要）
 * ══════════════════════════════════════════════════════════════════
 *
 * 实测（pdd_pure_test/ratelimit-probe.mjs）：
 *   A. 轻接口 common/query/status，间隔 1s × 20 次   → 20/20 全过
 *   B. 重接口 glide/goodsList，  间隔 2s × 12 次   → 12/12 全过
 *   C. 重接口 glide/goodsList，  **零间隔** × 30 次 → 30/30 全过 ✅
 *   D. 读接口 1s × 3 次                            → 3/3 全过
 *
 * 结论：**只读接口没有速率限制**，零间隔连打 30 次也不限。
 *
 * 那 54001「操作太过频繁」从哪来？
 *   → 只在「短时间内打大量**不同**接口」时出现（扫描式探测特征）
 *   → 正常业务反复读同一批接口，不会触发
 *
 * ══════════════════════════════════════════════════════════════════
 * 旧配置 baseGapMs=4000 是**过度保守**的
 * ══════════════════════════════════════════════════════════════════
 *   旧：每次间隔 4~6 秒 → 读 100 个商品 400~600 秒
 *   新：读接口 150ms     → 读 100 个商品约 15 秒（快 30 倍）
 *
 * 但**写操作**仍需保守（平台对写有独立频控，写错代价高）。
 *
 * ══════════════════════════════════════════════════════════════════
 * 关键新增：扫描检测
 * ══════════════════════════════════════════════════════════════════
 * 真正触发限流的是「单位时间内访问**不同接口**的数量」。
 *   60 秒内访问 > 12 个不同接口 → 判定扫描，主动冷却 90 秒。
 *
 * 正常业务：一个 skill 反复读 2~5 个接口 → 永不触发
 * 接口探测：一分钟打 20 个 → 触发，正是平台想拦的
 */
export const THROTTLE = {
  // ── 只读接口 ──
  readGapMs: 150,
  readJitterMs: 100,

  // ── 写接口 ──
  writeGapMs: 3000,
  writeJitterMs: 2000,

  // ── 域级额外间隔 ──
  //   商品域：零间隔 30 次全过
  //   推广域：比商品域严格，但真限流阈值是「60s 内 13+ 个**不同**接口」
  //   （2026-11-09 实测：连打 11 个推广接口即进 429，恢复慢）
  //   靠下面 scanDistinctLimit=12 的扫描闸门兜底即可，逐次 15s 太保守
  //   （一次 overview 要 8 个接口 → 120s，用户等不起）。
  domainGapMs: {
    yingxiao: 6000,      // 推广域 6 秒/次（配合 12 个/60s 扫描闸门）
    live: 5000,          // 视频域 5 秒/次
    mms: 0,              // 商品域不加额外间隔
  },

  // ── 扫描检测（真正的限流诱因）──
  scanWindowMs: 60 * 1000,
  scanDistinctLimit: 12,
  scanCooldownMs: 90 * 1000,

  // ── 兼容旧字段（其他模块仍在引用）──
  baseGapMs: 4000,         // @deprecated → readGapMs / writeGapMs
  jitterMs: 2000,          // @deprecated
  perEndpointGapMs: 1800,  // @deprecated
  cooldownAfterRiskMs: 60 * 1000,
  cooldownAfterFreqMs: 240 * 1000,
  cooldownLongMs: 2 * 60 * 60 * 1000,
}

/**
 * 判断接口是读还是写
 * @param {string} pathOrUrl
 * @returns {'read'|'write'}
 */
export function classifyEndpoint(pathOrUrl) {
  const u = String(pathOrUrl || '').toLowerCase()

  // ★ 例外优先：这些路径含 "add/edit" 等词但其实是**只读查询**
  //   glide/addProperties/goodsList  = 商品属性列表（读）
  //   glide/addProperties/goods/count = 商品属性计数（读）
  if (/addproperties\/goods(\/count|list)?$/.test(u)) return 'read'
  if (/\/gray\/status/.test(u)) return 'read'
  if (/\/common\/query\//.test(u)) return 'read'

  // 明确的写操作
  if (/\/(onsale|offsale|batchonsale|batchoffsale|batchincrease|batchdecrease|edit|commit|create|delete|update|submit|save|modify|publish|enroll|cancel|apply|setquantity|updatestock)/.test(u)) return 'write'

  // 查询类
  if (/\/(query|list|get|detail|count|status|search|is_exist|info|statistics|report|statics|effect|home)/.test(u)) return 'read'

  return 'write'   // 默认保守
}

/** 按 URL 判断所属域 */
export function detectDomainOf(pathOrUrl) {
  const u = String(pathOrUrl || '')
  if (/yingxiao\.pinduoduo\.com|^\/mms-gateway\//.test(u)) return 'yingxiao'
  if (/live\.pinduoduo\.com|^\/api\/backbone\//.test(u) || /^\/mms\/amco\//.test(u) || /^\/kiwi\//.test(u)) return 'live'
  return 'mms'
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
 * ★ 2026-11-07 重写：区分读/写 + 扫描检测
 *
 * 规则：
 *   读接口 → 150ms 间隔（实测可零间隔，只留余量）
 *   写接口 → 3000ms 间隔（保守）
 *   扫描检测 → 60s 内不同接口 > 12 个 → 冷却 90s
 *
 * @param {string} shopKey
 * @param {string} endpoint 接口路径
 * @param {object} [opts] { kind?: 'read'|'write' } 不传则自动判断
 * @returns {Promise<{ waitMs:number, allowedAt:number, cooling:boolean, reason?:string, kind:string }>}
 */
export async function reserveSlot(shopKey, endpoint = '', opts = {}) {
  const state = readState()
  const now = Date.now()

  const acct = state[shopKey] || {}
  if (acct.date !== today()) { acct.date = today(); acct.captchaCount = 0 }

  // ① 检查冷却
  if (acct.cooldownUntil && now < acct.cooldownUntil) {
    return {
      waitMs: acct.cooldownUntil - now, allowedAt: acct.cooldownUntil,
      cooling: true, reason: acct.cooldownReason || '风控冷却',
      kind: opts.kind || 'read',
    }
  }

  // ② 判定读/写
  const kind = opts.kind || classifyEndpoint(endpoint)

  // ③ 扫描检测：窗口内不同接口数
  acct.scan = acct.scan || { windowStart: now, seen: [] }
  if (now - (acct.scan.windowStart || 0) > THROTTLE.scanWindowMs) {
    acct.scan = { windowStart: now, seen: [] }
  }
  if (endpoint && !acct.scan.seen.includes(endpoint)) {
    acct.scan.seen.push(endpoint)
    if (acct.scan.seen.length > THROTTLE.scanDistinctLimit) {
      // 判定为扫描式探测 → 主动冷却
      acct.cooldownUntil = now + THROTTLE.scanCooldownMs
      acct.cooldownReason = `扫描检测：${THROTTLE.scanWindowMs / 1000}s 内访问了 ${acct.scan.seen.length} 个不同接口`
      acct.scan = { windowStart: now, seen: [] }
      state[shopKey] = acct
      writeState(state)
      return {
        waitMs: THROTTLE.scanCooldownMs, allowedAt: acct.cooldownUntil,
        cooling: true, reason: acct.cooldownReason, kind,
      }
    }
  }

  // ④ 账号级时间槽（读/写间隔 + 域级额外间隔）
  const dom = detectDomainOf(endpoint)
  const domainExtra = THROTTLE.domainGapMs?.[dom] || 0
  const baseGap = (kind === 'write' ? THROTTLE.writeGapMs : THROTTLE.readGapMs) + domainExtra
  const jitter = kind === 'write' ? THROTTLE.writeJitterMs : THROTTLE.readJitterMs
  const gap = baseGap + Math.floor(Math.random() * jitter)
  const acctAllowedAt = Math.max(now, acct.nextAllowedAt || 0)

  // ⑤ 接口级时间槽（同接口连续调用，读接口几乎不需等待）
  acct.endpoints = acct.endpoints || {}
  const ep = acct.endpoints[endpoint] || 0
  const epGap = kind === 'write' ? THROTTLE.writeGapMs : THROTTLE.readGapMs
  const epAllowedAt = Math.max(now, ep + epGap)

  const allowedAt = Math.max(acctAllowedAt, epAllowedAt)
  const waitMs = Math.max(0, allowedAt - now)

  // ★ 同步占位：立刻写入文件，防止并发读到同一旧值
  acct.nextAllowedAt = allowedAt + gap
  acct.endpoints[endpoint] = allowedAt
  acct.lastRequestAt = allowedAt
  state[shopKey] = acct
  writeState(state)

  return { waitMs, allowedAt, cooling: false, kind }
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

    // ★ 2026-11-07：区分「限流型 54001」和「真风控型 54001」
    //
    // 实测发现 54001 有两种完全不同的语义：
    //   ① error_msg 含「频繁 / 稍后」→ 只是限流，等 60~90 秒即可恢复，不是风控
    //   ② 其它（含 verifyAuthToken、滑块）→ 真风控，需要更长的退避
    //
    // 旧逻辑一刀切按风控处理 → 一次正常限流就冷却 60s，
    // 当天第 3 次 → 480s（8 分钟），账号被自己锁死。
    const msg = String(detail?.errorMsg || detail?.msg || '')
    const isThrottleOnly = /频繁|稍后|太快|slow down/i.test(msg)
      && !detail?.verifyAuthToken

    if (isThrottleOnly) {
      // 限流：轻量冷却，不累计风控计数
      acct.captchaCount = Math.max(0, (acct.captchaCount || 1) - 1)
      acct.stats.rateLimit = (acct.stats.rateLimit || 0) + 1
      acct.cooldownUntil = now + THROTTLE.scanCooldownMs
      acct.cooldownReason = `54001 限流（操作频繁），冷却 ${THROTTLE.scanCooldownMs / 1000}s`
    } else {
      // 真风控：指数退避（与原逻辑一致）
      const mult = Math.min(8, Math.pow(2, acct.captchaCount - 1))
      acct.cooldownUntil = now + THROTTLE.cooldownAfterRiskMs * mult
      acct.cooldownReason = `54001 风控（今日第 ${acct.captchaCount} 次，退避 ×${mult}）`
      if (acct.captchaCount >= HEALTH.dailyCaptchaThreshold) {
        acct.heavyRiskToday = true
      }
    }
  } else if (kind === 'session') {
    acct.stats.session++
    acct.health = Math.max(0, acct.health + HEALTH.sessionLost)
    // ★ 2026-11-11：`needRelogin` 原来是**永久标记**，一次 43001 就锁死账号，
    //   但实测 43001 经常是**瞬时**的（Cookie 自愈后立刻就能用）——
    //   结果用户明明重登了、或会话自己恢复了，技能还一直报「需要重新登录」。
    //   → 加 15 分钟有效期；过期自动失效。真正的长期失效靠 health 分兜底。
    acct.needRelogin = true
    acct.needReloginUntil = now + 15 * 60 * 1000
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
    // ★ 2026-11-11：按有效期判断（默认 15 分钟）。
    //   canUse 是只读函数，这里不写盘；过期标记会在下一次
    //   recordToAntiban / clearCooldown 时被覆盖或清掉。
    //   老数据没有 needReloginUntil → 视为已过期（避免历史遗留的永久锁死账号）。
    const until = st.needReloginUntil || 0
    if (now < until) {
      const remain = Math.ceil((until - now) / 60000)
      return { ok: false, reason: `需要重新登录（${remain} 分钟后自动重试）`, remainMs: until - now, health: st.health }
    }
    // 已过期 → 放行
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
  delete acct.needReloginUntil
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
/**
 * 可读剩余时间。
 *
 * ★ 2026-10-27：改为从 pdd-risk 复用，删掉本文件里逐字重复的实现。
 *   原先两个模块各有一份完全相同的 fmtRemain，属于"改一处漏一处"的隐患。
 *   pdd-risk 不依赖本模块，故无循环依赖风险。
 */
export { fmtRemain } from './pdd-risk.mjs'

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
