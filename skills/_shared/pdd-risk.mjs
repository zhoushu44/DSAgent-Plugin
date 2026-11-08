/**
 * PDD 风控防护模块（所有 pdd 技能共用）
 *
 * 背景（2026-10-22 实测）：
 *   拼多多按「接口前缀分级」风控，且是**账号级 + 全局滑块**双重机制：
 *     - /vodka/*  /glide/*   （商品域）  最易被限流，返回 54001「操作太过频繁」
 *     - /sydney/* /cambridge/* （经营/活动域） 相对宽松
 *     - /lakemms/* 活动写操作  有独立 2 小时频控（100001）
 *   触发后页面会弹「请向右滑块完成拼图」遮罩，盖住所有按钮。
 *
 *   硬打 → 滑块 → 更长封禁。所以必须**主动降速 + 遇控即停 + 自动过滑块**。
 *
 * 四层防护：
 *   L1 请求节流：同一接口最小间隔（默认 3s），全局并发 1
 *   L2 遇控即停：54001 / 100001 / 网络繁忙 → 立即停止该批次，不再重试
 *   L3 滑块自动过：检测到遮罩 → 自动调 pdd-slider-solver（yydsocr 识别 + 人类化轨迹）
 *   L4 冷却记忆：命中频控后记录冷却截止时间，冷却期内同类操作直接拒绝
 *
 * ★★★ L0 通行证复用（2026-10-23 从觅千手 SDK 源码逆向补上）★★★
 *
 *   此前所有失败的根本原因：**每次都是新会话、从不保存 captcha-token**，
 *   于是「无 token → 必弹滑块 → 自动过 → 常失败 → 再试」死循环，把账号打废。
 *
 *   SDK 原始逻辑（AesApp.js 191384~191800 行）：
 *
 *     // 收到 54001
 *     if (errorCode === 54001) {
 *       // ① 先清掉旧 token Cookie（防止用过期 token 空转）
 *       const d = new Date(); d.setTime(d.getTime() - 1000)
 *       document.cookie = "msfe-pc-cookie-captcha-token=;path=/;expires=" + d.toUTCString()
 *
 *       if (已有token && 有VerifyAuthToken) {
 *         retry()                       // ② 有有效 token → 直接重试，不弹滑块
 *       } else {
 *         const t = res.result.verifyAuthToken || ""
 *         // ③ 存 Cookie，有效期 10 分钟（6e5 ms）
 *         const n = new Date(); n.setTime(n.getTime() + 6e5)
 *         document.cookie = "msfe-pc-cookie-captcha-token=" + encodeURIComponent(t) + ";path=/;expires=" + n.toUTCString()
 *         emit("FLOATING_CAPTCHA", { verifyAuthToken: t, captchaRetry: retry, captchaCallback: done })
 *       }
 *     }
 *
 *   → 结论：滑块过一次 = 拿到 10 分钟通行证。
 *     存下来复用，10 分钟内所有请求带 VerifyAuthToken 头 → 不再弹滑块。
 *
 *   本模块实现：
 *     saveCaptchaToken(shopKey, token)   存 token（含 10 分钟过期时间）
 *     getCaptchaToken(shopKey)           取有效 token（过期返回 null）
 *     clearCaptchaToken(shopKey)         清除（54001 时先清旧的）
 *     extractCaptchaToken(json)          从 54001 响应里提取 verifyAuthToken
 *     recordCaptchaPass(shopKey)         记录一次「手动过滑块成功」，用于统计
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const COOL_FILE = path.join(homedir(), '.dsh', 'pdd-risk-cooldown.json')
/** ★ captcha 通行证存储（SDK 里是 Cookie，这里落盘更可靠，重启不丢） */
const CAPTCHA_FILE = path.join(homedir(), '.dsh', 'pdd-captcha-tokens.json')
/** SDK 里 token 有效期 10 分钟（6e5 ms） */
const CAPTCHA_TTL_MS = 10 * 60 * 1000
const HERE = path.dirname(fileURLToPath(import.meta.url))

/**
 * 频控错误码 → 基础冷却时长（ms）
 *
 * ★ 2026-10-27 修（两处）：
 *
 * (1) 补 `40002`。原表里没有它，而 `pdd-works/query.mjs` 会调
 *     `markCooldown(SHOP, 40002, ...)` → 命中下面 `if (!base) return`
 *     → **冷却被静默吞掉**，调用方以为记了、实际什么都没记。
 *
 * (2) `54001` 基础时长从 1 小时降到 60 秒，与 `pdd-antiban.mjs` 的
 *     `THROTTLE.cooldownAfterRiskMs = 60_000` 对齐。
 *     原值 1 小时（再乘自适应倍数最高 8 小时）与 `pdd-client.mjs` 的
 *     「54001 可静默自愈（清 token→提新票→重放，不算严重事件）」方向相反：
 *     `query.mjs` 在 clientCall 已自愈重试 2 次仍失败后，又记 1 小时冷却
 *     → **一次滑块失败 = 账号冻结大半天**，而实际可能只是需要过一次滑块。
 *
 *     现在：54001 首击只冷却 60s（够让滑块完成），只有**当日累计**才升级
 *     （见 markCooldown 的 hits 逻辑）——与 pdd-error.mjs 的语义一致：
 *     54001 是「可自愈、失败要人工」，不是「直接长封」。
 */
/**
 * ★ 限流型 54001 —— 与真风控 54001 分开处理（2026-11-07 实测新增）
 *
 * 实测（pdd_pure_test/ratelimit-probe.mjs）：
 *   · 只读接口零间隔连打 30 次 → 30/30 全过，**无速率限制**
 *   · 54001 的两种语义：
 *       ① error_msg 含「频繁/稍后」→ 只是限流，等 60~90 秒即恢复
 *       ② 带 verifyAuthToken / 要滑块 → 真风控，需要长退避
 *
 * 旧逻辑把 ① 也当 ② 处理：
 *   一次正常限流 → 60s；当天第 3 次 → 240s；第 4 次起 → 480s
 *   → 账号被自己的冷却逻辑锁死。
 *
 * 现在：限流型只冷却 THROTTLE.scanCooldownMs（90s），且**不计入 24h 命中次数**，
 *       不触发指数退避。
 */
export function isThrottleOnly(json) {
  if (!json || typeof json !== 'object') return false
  const code = json.error_code ?? json.errorCode
  if (Number(code) !== 54001) return false
  const msg = String(json.error_msg ?? json.errorMsg ?? '')
  const hasVtk = !!(json.result?.verifyAuthToken || json.verifyAuthToken)
  return /频繁|稍后|太快|slow down/i.test(msg) && !hasVtk
}

/** 限流型冷却时长（毫秒），与 pdd-antiban.THROTTLE.scanCooldownMs 对齐 */
const THROTTLE_ONLY_COOLDOWN_MS = 90 * 1000

const RISK_CODES = {
  54001: 60 * 1000,
  // ★ 2026-11-05 新增：54003 = 安全验证未通过、暂时无法登录。
  //   与 54001/40002 不同，它是「停机」型：重扫码无效，只能等。
  //   故基础时长直接给 24h，且不进指数退避（退避是给可恢复的频控用的）。
  //   ⚠️ 如果不加进这张表，markCooldown 会在 `if (!base) return` 处静默返回，
  //     冷却写不进去 —— 这与历史上「40002 不在 RISK_CODES 被吞掉」是同一个坑。
  54003: 24 * 60 * 60 * 1000,
  40002: 240 * 1000,          // 高频限流 → 240s（官方实测此码无法本地修复，只能降级或等待）
  100001: 2 * 60 * 60 * 1000, // 当前请求频繁，请2小时后重试 → 2 小时
  2000000: 30 * 60 * 1000,    // 网络繁忙，请不要频繁操作 → 30 分钟
  600001: 5 * 60 * 1000,      // 编辑不存在 → 短冷却（可能是参数问题）
}

/**
 * ★ 自适应退避倍数（2026-10-22 新增）。
 * 按账号「24 小时内累计命中次数」动态延长冷却：
 *   第 1 次 → ×1（基础时长）
 *   第 2 次 → ×2
 *   第 3 次 → ×4
 *   第 4 次+ → ×8（封顶）
 * 原理：拼多多按「累计行为分数」限流，固定时长冷却会导致「刚解又打、打了又封」。
 */
function backoffMultiplier(hitCount) {
  if (hitCount <= 1) return 1
  return Math.min(8, Math.pow(2, hitCount - 1))
}

/** 读冷却记录 */
function readCooldown() {
  try { return JSON.parse(fs.readFileSync(COOL_FILE, 'utf8')) } catch { return {} }
}

/** 写冷却记录 */
function writeCooldown(obj) {
  try {
    fs.mkdirSync(path.dirname(COOL_FILE), { recursive: true })
    fs.writeFileSync(COOL_FILE, JSON.stringify(obj, null, 1))
  } catch { /* 忽略 */ }
}

/**
 * 判断某账号是否在冷却中。
 * @returns { cooling: boolean, remainMs: number, reason: string }
 */
export function checkCooldown(shopKey) {
  const cd = readCooldown()
  const rec = cd[shopKey]
  if (!rec) return { cooling: false, remainMs: 0, reason: '' }
  const now = Date.now()
  if (now >= rec.until) {
    // 已过期，清掉
    delete cd[shopKey]
    writeCooldown(cd)
    return { cooling: false, remainMs: 0, reason: '' }
  }
  return {
    cooling: true,
    remainMs: rec.until - now,
    reason: rec.reason || '',
    code: rec.code,
    multiplier: rec.multiplier || 1,
    hits: (rec.hits || []).length,
  }
}

/** 记录冷却（按错误码 + 累计命中次数自适应延长） */
export function markCooldown(shopKey, code, extraReason) {
  const base = RISK_CODES[code]
  if (!base) return
  const cd = readCooldown()
  const now = Date.now()
  const prev = cd[shopKey]

  // ★ 2026-11-07：限流型 54001 走「轻冷却」，不计入 24h 命中次数
  //   判据：reason 里带「限流」或「频繁」且没有「风控」字样
  const reasonStr = String(extraReason || '')
  const throttleOnly = Number(code) === 54001
    && /频繁|稍后|限流/.test(reasonStr)
    && !/风控|滑块|verifyAuthToken/i.test(reasonStr)

  // 统计 24h 内累计命中次数（hitCount + 历史 hits）
  const hits = (prev?.hits || []).filter(t => now - t < 24 * 3600 * 1000)
  if (!throttleOnly) hits.push(now)

  const mult = throttleOnly ? 1 : backoffMultiplier(hits.length)
  const ms = throttleOnly
    ? THROTTLE_ONLY_COOLDOWN_MS
    : Math.min(base * mult, 24 * 3600 * 1000)   // 封顶 24 小时

  cd[shopKey] = {
    until: now + ms,
    code,
    reason: extraReason || (throttleOnly ? `限流 code=${code}` : `命中频控 code=${code}`),
    hits,
    baseMs: throttleOnly ? THROTTLE_ONLY_COOLDOWN_MS : base,
    multiplier: mult,
    throttleOnly,
  }
  writeCooldown(cd)

  const mins = Math.round(ms / 1000)
  if (throttleOnly) {
    console.warn(`[pdd-risk] ${shopKey} 限流冷却 ${mins}s（code=${code}，不计入风控次数）`)
  } else {
    console.warn(`[pdd-risk] ${shopKey} 进入冷却 ${Math.round(ms / 60000)} 分钟`
      + `（code=${code}，基础 ${Math.round(base / 60000)} 分钟 × ${mult} 倍，24h 内第 ${hits.length} 次命中）`)
  }
}

/** 清除冷却（用户手动过滑块后调用） */
export function clearCooldown(shopKey) {
  const cd = readCooldown()
  if (cd[shopKey]) { delete cd[shopKey]; writeCooldown(cd) }
}

/**
 * 从接口响应里识别频控错误码。
 * 拼多多有三种 error 字段名：error_code / errorCode，且 msg 会带中文提示。
 */
export function detectRiskCode(json) {
  if (!json || typeof json !== 'object') return null
  const code = json.error_code ?? json.errorCode ?? null
  const msg = String(json.error_msg ?? json.errorMsg ?? '')
  // 显式码
  if (code && RISK_CODES[code]) return code
  // 兜底：按 msg 识别（有些接口不返码只返 msg）
  if (/操作太过频繁|请求频繁|请稍后再试|请不要频繁操作|系统繁忙/.test(msg)) return 54001
  if (/2小时后重试/.test(msg)) return 100001
  return null
}

/** 人类可读的剩余时间 */
export function fmtRemain(ms) {
  const m = Math.ceil(ms / 60000)
  if (m < 60) return `${m} 分钟`
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分钟`
}

/* ══════════════════════════════════════════════════════════════════════
 * captcha 通行证（verifyAuthToken）持久化
 *
 * 从觅千手 SDK 逆向：滑块过一次 → 拿 verifyAuthToken → 有效期 10 分钟
 * 这 10 分钟内所有请求带 VerifyAuthToken 请求头 → 不再弹滑块
 * ══════════════════════════════════════════════════════════════════════ */

function readCaptchaStore() {
  try { return JSON.parse(fs.readFileSync(CAPTCHA_FILE, 'utf8')) || {} } catch { return {} }
}

/**
 * ★ 2026-10-27：原子写（临时文件 + rename）。
 *
 * 背景：`~/.dsh/pdd-captcha-tokens.json` 被**三个模块**（pdd-risk / pdd-client /
 * pdd-http）各自以「读整个文件 → 改 → 写整个文件」的方式维护，原本都是裸
 * `writeFileSync`。两个技能并发跑时，后写的会把前一个刚保存的 token 抹掉
 * → 下一次又弹滑块。
 *
 * `renameSync` 在同一卷上是原子操作：读者要么看到旧完整内容，要么看到新完整
 * 内容，绝不会看到写了一半的 JSON。这把「并发互相覆盖」的窗口从「整个写入
 * 过程」缩小到「读-改的那一瞬间」。
 *
 * 仍无法完全消除并发丢更新（需要文件锁才能做到），但对 10 分钟 TTL 的通行证
 * 来说，最坏情况只是多弹一次滑块，可接受。
 */
function writeCaptchaStore(d) {
  const tmp = `${CAPTCHA_FILE}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.mkdirSync(path.dirname(CAPTCHA_FILE), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(d, null, 1), 'utf8')
    fs.renameSync(tmp, CAPTCHA_FILE)      // ★ 原子替换
  } catch {
    // rename 失败（如跨卷/权限）→ 退化为直接写，至少不比原来差
    try { fs.writeFileSync(CAPTCHA_FILE, JSON.stringify(d, null, 1), 'utf8') } catch { /* ignore */ }
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
}

/** 导出给 pdd-client / pdd-http 复用（收敛到单一存储实现，见 P2-10） */
export { readCaptchaStore, writeCaptchaStore, CAPTCHA_FILE, CAPTCHA_TTL_MS }

/**
 * 存 captcha 通行证（SDK 里存 Cookie `msfe-pc-cookie-captcha-token`，有效期 10 分钟）
 * @param shopKey 账号
 * @param token verifyAuthToken 值
 */
export function saveCaptchaToken(shopKey, token) {
  if (!token) return false
  const store = readCaptchaStore()
  store[shopKey] = {
    token: String(token),
    savedAt: Date.now(),
    expiresAt: Date.now() + CAPTCHA_TTL_MS,
  }
  writeCaptchaStore(store)
  return true
}

/**
 * 取有效的 captcha 通行证。过期/不存在返回 null。
 * @returns {{ token: string, remainMs: number } | null}
 */
export function getCaptchaToken(shopKey) {
  const store = readCaptchaStore()
  const rec = store[shopKey]
  if (!rec?.token) return null
  const remainMs = rec.expiresAt - Date.now()
  if (remainMs <= 0) { delete store[shopKey]; writeCaptchaStore(store); return null }
  return { token: rec.token, remainMs }
}

/** 清除通行证（收到 54001 时先清旧的，防止拿过期 token 空转） */
export function clearCaptchaToken(shopKey) {
  const store = readCaptchaStore()
  if (store[shopKey]) { delete store[shopKey]; writeCaptchaStore(store) }
}

/**
 * 从 54001 响应里提取 verifyAuthToken。
 * SDK 原文：`const o = r.result && r.result.verifyAuthToken || ""`
 */
export function extractCaptchaToken(json) {
  if (!json || typeof json !== 'object') return null
  const t = json.result?.verifyAuthToken ?? json.data?.verifyAuthToken ?? null
  return typeof t === 'string' && t.length > 10 ? t : null
}

/**
 * 记录一次「滑块通过」事件，供统计「今天弹了几次」。
 */
export function recordCaptchaPass(shopKey, via = 'manual') {
  const store = readCaptchaStore()
  const rec = store[shopKey] || {}
  const today = new Date().toISOString().slice(0, 10)
  if (rec.statDate !== today) { rec.statDate = today; rec.passCount = 0; rec.failCount = 0 }
  rec.passCount = (rec.passCount || 0) + 1
  rec.lastPassAt = Date.now()
  rec.lastPassVia = via
  rec.consecutiveFails = 0          // ★ 成功即清零连续失败
  store[shopKey] = rec
  writeCaptchaStore(store)
}

/**
 * ★ 2026-10-27 新增：记录一次「滑块求解失败」。
 *
 * 原实现只统计通过次数，不统计失败 —— 于是无法回答「自动过滑块到底行不行」，
 * 也没有"连续失败就停"的保护，导致反复自动试失败、每次都要人工介入。
 *
 * 现在同时记：
 *   · 今日失败数 failCount
 *   · 连续失败数 consecutiveFails（成功即清零）
 */
export function recordCaptchaFail(shopKey, reason = '') {
  const store = readCaptchaStore()
  const rec = store[shopKey] || {}
  const today = new Date().toISOString().slice(0, 10)
  if (rec.statDate !== today) { rec.statDate = today; rec.passCount = 0; rec.failCount = 0 }
  rec.failCount = (rec.failCount || 0) + 1
  rec.consecutiveFails = (rec.consecutiveFails || 0) + 1
  rec.lastFailAt = Date.now()
  rec.lastFailReason = String(reason).slice(0, 200)
  store[shopKey] = rec
  writeCaptchaStore(store)
  return rec.consecutiveFails
}

/**
 * ★ 2026-10-27 新增：当前是否应该停止自动过滑块。
 *
 * 规则：同一账号**连续失败 N 次**（默认 3）后，10 分钟内不再自动尝试。
 * 理由：拼多多的滑块带行为检测（速度曲线/加速度/微停顿），OCR 方案的
 * 成功率会持续下降；继续自动试只会反复失败 + 每次失败都可能加重风控评分。
 * 此时正确做法是引导人工过一次，人工成功会拿到 10 分钟通行证。
 *
 * @param {string} shopKey
 * @param {number} [maxConsecutive] 连续失败上限，默认 3
 * @returns {{ stop: boolean, consecutiveFails: number, reason: string }}
 */
export function shouldStopAutoSlider(shopKey, maxConsecutive = 3) {
  const rec = readCaptchaStore()[shopKey]
  const fails = rec?.consecutiveFails || 0
  // 10 分钟内连续失败才生效（超过 10 分钟视为新一轮）
  const recent = rec?.lastFailAt && (Date.now() - rec.lastFailAt < 10 * 60 * 1000)
  if (fails >= maxConsecutive && recent) {
    return {
      stop: true,
      consecutiveFails: fails,
      reason: `已连续 ${fails} 次自动过滑块失败，暂停自动尝试。请人工完成一次验证（通过后会拿到 10 分钟通行证）。`,
    }
  }
  return { stop: false, consecutiveFails: fails, reason: '' }
}

/**
 * 组装请求头：有有效通行证就带 `VerifyAuthToken`
 * @returns {Record<string,string>}
 */
export function captchaHeaders(shopKey) {
  const t = getCaptchaToken(shopKey)
  return t ? { VerifyAuthToken: t.token } : {}
}

/* ─────────────────────────────────────────────────────────────
 * ★ 全局请求节流器（2026-10-22 新增）
 *
 * 问题：pdd-shop/promo/activity 靠 hook 页面响应，一次导航触发几十个请求，
 *       全速打 → 必被 54001。之前只有 pdd-works 的 call() 有节流。
 *
 * 方案：账号级「滑动窗口」——记录最近请求时间戳，超密度就 sleep（跨进程共享）。
 *   商品域（/vodka /glide）：严格 20 次/分钟
 *   其他域（/sydney /act yingxiao）：宽松 60 次/分钟
 * ───────────────────────────────────────────────────────────── */
const THROTTLE = {
  strict: { windowMs: 60_000, maxReq: 20 },
  loose:  { windowMs: 60_000, maxReq: 60 },
}
const THROTTLE_FILE = path.join(homedir(), '.dsh', 'pdd-throttle.json')

const readThrottle = () => { try { return JSON.parse(fs.readFileSync(THROTTLE_FILE, 'utf8')) } catch { return {} } }
const writeThrottle = (o) => {
  try {
    fs.mkdirSync(path.dirname(THROTTLE_FILE), { recursive: true })
    fs.writeFileSync(THROTTLE_FILE, JSON.stringify(o))
  } catch { /* 忽略 */ }
}

/**
 * 请求前节流（跨进程共享，会 sleep 到允许为止）。
 * @param shopKey 账号 shopKey
 * @param kind 'strict'（商品域，默认）| 'loose'（其他域）
 */
export async function throttleRequest(shopKey, kind = 'strict') {
  const cfg = THROTTLE[kind] || THROTTLE.strict
  const key = `${shopKey}:${kind}`
  for (;;) {
    const all = readThrottle()
    const now = Date.now()
    const hits = (all[key] || []).filter(t => now - t < cfg.windowMs)
    if (hits.length < cfg.maxReq) {
      hits.push(now)
      all[key] = hits
      writeThrottle(all)
      return
    }
    const wait = cfg.windowMs - (now - hits[0]) + 200
    console.warn(`[pdd-risk] ${shopKey} ${kind} 节流：${hits.length}/${cfg.maxReq} 次每分钟，等 ${Math.round(wait / 1000)}s`)
    await new Promise(r => setTimeout(r, Math.min(wait, 30_000)))
  }
}

/* ─────────────────────────────────────────────────────────────
 * 账号级并发锁（2026-10-22 新增）
 *
 * 问题：5 个 pdd 技能同时跑 = 5 个 Chrome + 5 套请求同时打同一个号，
 *       必然触发 54001。之前没有跨进程协调。
 *
 * 方案：文件锁（~/.dsh/pdd-account-locks/<shopKey>.lock）
 *   - 内容：{ pid, at, label }
 *   - 获取：tryAcquireAccountLock(shopKey, label, waitMs)
 *   - 释放：releaseAccountLock(shopKey)
 *   - 兜底：锁超过 STALE_MS（10 分钟）视为僵尸，可强夺
 * ───────────────────────────────────────────────────────────── */
const LOCK_DIR = path.join(homedir(), '.dsh', 'pdd-account-locks')
const LOCK_STALE_MS = 10 * 60 * 1000     // 10 分钟无心跳视为僵尸

const lockPath = (shopKey) => path.join(LOCK_DIR, `${shopKey.replace(/[^\w-]/g, '_')}.lock`)

/** 尝试获取账号锁。@returns { ok, holder?, waitedMs? } */
export async function tryAcquireAccountLock(shopKey, label = '', waitMs = 0) {
  const p = lockPath(shopKey)
  const start = Date.now()
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR, { recursive: true })
      // O_EXCL 语义：已存在则抛错
      fs.writeFileSync(p, JSON.stringify({ pid: process.pid, at: Date.now(), label }), { flag: 'wx' })
      return { ok: true }
    } catch {
      // 锁已存在 → 看是否僵尸
      try {
        const st = JSON.parse(fs.readFileSync(p, 'utf8'))
        if (Date.now() - st.at > LOCK_STALE_MS) {
          console.warn(`[pdd-risk] 账号锁僵尸（${st.pid} @ ${new Date(st.at).toISOString()}），强夺`)
          fs.unlinkSync(p)
          continue   // 立刻重试
        }
      } catch { /* 锁文件损坏，强夺 */ fs.unlinkSync(p); continue }

      // 等待
      if (Date.now() - start >= waitMs) {
        let holder = ''
        try { holder = JSON.parse(fs.readFileSync(p, 'utf8')).label || '' } catch { /* ignore */ }
        return { ok: false, holder }
      }
      await new Promise(r => setTimeout(r, 2000))
    }
  }
}

/** 释放账号锁 */
export function releaseAccountLock(shopKey) {
  try {
    const p = lockPath(shopKey)
    const st = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (st.pid === process.pid) fs.unlinkSync(p)
  } catch { /* 已被别人清 */ }
}

/** 心跳续锁（长时间任务用，防被判僵尸） */
export function heartbeatAccountLock(shopKey, label = '') {
  try {
    const p = lockPath(shopKey)
    const st = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (st.pid === process.pid) {
      fs.writeFileSync(p, JSON.stringify({ pid: process.pid, at: Date.now(), label: label || st.label }))
    }
  } catch { /* 锁没了就算了 */ }
}

/**
 * L3：检测页面是否有滑块遮罩。
 * @returns Promise<boolean>
 */
export async function detectSlider(page) {
  return await page.evaluate(() => {
    // ★ 2026-11-05 修：优先用 SDK 真实锚点（与 pdd-slider-solver 保持一致）。
    //   原实现靠 `[class*="captcha"]` 侥幸能中，但**要求文案匹配**：
    //   /滑块|拼图|安全验证|向右/ —— type 71 旋转验证码文案是「拖动圆形滑块完成旋转拼图」，
    //   type 61 是「请按住滑块…」，type 81 是「点击下方安全验证」——
    //   这些都可能漏判，导致「明明有验证码却判定为没有」→ 上层不调求解器 → 卡死。
    const ANCHOR = '#slide-captcha-dialog, .captcha-wrapper__slider, .captcha-wrapper, .slide-handlebar'
    const anchors = Array.from(document.querySelectorAll(ANCHOR))
      .filter(m => { const r = m.getBoundingClientRect(); return r.width > 200 && r.height > 100 })
    if (anchors.length) return true   // 锚点存在即视为有验证码，不看文案

    // 兜底：类名 + 文案双判（兼容旧版/灰度）
    const ms = Array.from(document.querySelectorAll('[class*="Modal"], [class*="modal"], [class*="MDL"], [class*="Dialog"], [class*="captcha"], [class*="Captcha"], [class*="verify"], [class*="Verify"]'))
      .filter(m => { const r = m.getBoundingClientRect(); return r.width > 200 && r.height > 150 })
    return ms.some(m => /滑块|拼图|安全验证|向右|旋转|拖动|点击/.test((m.innerText || '').slice(0, 60)))
  }).catch(() => false)
}

/**
 * L3：自动过滑块。
 *
 * 两种模式：
 *  ① 传 page：在**已打开的浏览器**里直接跑求解逻辑（不新起进程，避免 profile 锁冲突）
 *  ② 不传 page：起子进程跑 pdd-slider-solver.mjs（会新开一个浏览器窗口）
 *
 * @param shopKey 账号 shopKey
 * @param page 可选，puppeteer page（父进程已开的浏览器）
 * @param opts {{ dryRun?: boolean, timeoutMs?: number }}
 */
export async function autoSolveSlider(shopKey, page = null, opts = {}) {
  // ① 有 page → 内联跑（推荐：无锁冲突）
  if (page) {
    try {
      const mod = await import('./pdd-slider-solver.mjs').catch((e) => { console.error('[pdd-risk] import solver 失败:', e.message); return null })
      if (typeof mod?.solveSliderInPage === 'function') {
        // ★ 内联模式绝不落子进程：子进程会开同 profile 的 Chrome，
        //   把父进程的 Target 挤掉（Target closed → 后续 goto 全 detached）。
        //   内联失败就直接返回失败，让调用方决定重试或人工介入。
        return await mod.solveSliderInPage(page, shopKey, opts)
      }
      console.error('[pdd-risk] solver 无 solveSliderInPage 导出')
      return { ok: false, text: '滑块求解器缺少 solveSliderInPage 导出' }
    } catch (e) {
      console.error('[pdd-risk] 内联求解异常:', e.message)
      return { ok: false, text: `内联求解异常：${e.message}` }
    }
  }
  // ② 无 page 才起子进程（独立 CLI 场景）
  //
  // ★ 2026-10-27 修：execSync → execFile（异步）。
  //
  //   原实现用同步 `execSync` 跑滑块求解器（timeout 最长 180s）。同步子进程会
  //   **阻塞 Node 事件循环**：期间 `setInterval` 心跳、promise 回调、CDP 消息
  //   全部停摆。而账号锁的僵尸判定是 10 分钟、心跳是 3 分钟 —— 心跳一旦被阻塞
  //   超过 10 分钟，别的任务会判锁僵尸并强夺 → **两个浏览器同时操作同一账号**。
  //
  //   改为异步 `execFile` 后，等待子进程期间事件循环照常运转，心跳不停。
  const { execFile } = await import('node:child_process')
  const solver = path.join(HERE, 'pdd-slider-solver.mjs')
  if (!fs.existsSync(solver)) return { ok: false, text: '滑块求解器不存在（pdd-slider-solver.mjs）' }
  const args = ['--shop', shopKey]
  if (opts.dryRun) args.push('--dry-run')
  const runSolver = () => new Promise((resolve) => {
    execFile(process.execPath, [solver, ...args], {
      encoding: 'utf8', timeout: opts.timeoutMs ?? 180000, maxBuffer: 8 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      resolve({ stdout: stdout || String(err?.stdout || ''), stderr, err })
    })
  })
  try {
    const { stdout } = await runSolver()
    const line = String(stdout).split('\n').find(l => l.startsWith('__DSAGENT_RESULT__')) || ''
    if (!line) return { ok: false, text: '滑块求解器无结果输出' }
    const j = JSON.parse(line.replace('__DSAGENT_RESULT__', ''))
    return { ok: j.ok === true, text: j.text || JSON.stringify(j).slice(0, 200), raw: j }
  } catch (e) {
    // 子进程非零退出也可能有结果行
    const line = String(e.stdout || '').split('\n').find(l => l.startsWith('__DSAGENT_RESULT__')) || ''
    if (line) {
      try {
        const j = JSON.parse(line.replace('__DSAGENT_RESULT__', ''))
        return { ok: j.ok === true, text: j.text || '', raw: j }
      } catch { /* ignore */ }
    }
    return { ok: false, text: `滑块求解异常：${e.message?.slice(0, 150) || String(e)}` }
  }
}

/**
 * 统一风控守卫：在一次接口调用前后做「滑块检测 + 自动过滑块」。
 *
 * 用法（在技能的 call() 里包一层）：
 *   const r = await guard(page, SHOP, () => call(url, body))
 *
 * 行为：
 *   - 调用前：有滑块遮罩 → 自动过滑块 → 通过则继续，失败则抛错
 *   - 调用后：返回 54001/100001 等 → 记冷却 + 抛错（由调用方决定是否重试）
 *
 * @param page puppeteer page
 * @param shopKey 账号 shopKey
 * @param fn 实际执行的一次接口调用
 * @param opts {{ autoSlider?: boolean }} autoSlider 默认 true
 */
export async function guard(page, shopKey, fn, opts = {}) {
  const autoSlider = opts.autoSlider !== false
  const maxRetry = opts.maxRetry ?? 2

  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    // ① 调用前检测滑块
    if (autoSlider && page && await detectSlider(page)) {
      // ★ 先看有没有有效通行证 —— 有就不用过滑块
      const tk = getCaptchaToken(shopKey)
      if (tk) {
        console.warn(`[pdd-risk] 有有效通行证（剩 ${fmtRemain(tk.remainMs)}），跳过滑块检测`)
      } else {
        // ★ 2026-10-27：连续失败 N 次后暂停自动尝试，引导人工
        const stop = shouldStopAutoSlider(shopKey)
        if (stop.stop) {
          const err = new Error('RISK_SLIDER_STOPPED')
          err.riskCode = 54001
          err.riskMsg = stop.reason
          err.needManualCaptcha = true
          throw err
        }
        console.warn('[pdd-risk] 检测到滑块遮罩且无通行证，尝试自动过滑块...')
        const solved = await autoSolveSlider(shopKey, page)
        if (!solved.ok) {
          // ★ 记失败（用于连续失败降级判断）
          recordCaptchaFail(shopKey, solved.text || '未知原因')
          const err = new Error(`RISK_SLIDER_UNSOLVED`)
          err.riskCode = 54001
          err.riskMsg = `滑块自动过失败：${solved.text}`
          err.needManualCaptcha = true
          throw err
        }
        console.warn(`[pdd-risk] 滑块已过：${solved.text}`)
        recordCaptchaPass(shopKey, 'auto')
        await new Promise(r => setTimeout(r, 2000))
      }
    }

    // ② 实际调用
    const r = await fn()

    // ③ 调用后识别频控码
    const code = detectRiskCode(r)
    if (!code) return r

    // ★★★ 54001 处理（对齐觅千手 SDK）★★★
    if (code === 54001) {
      // ★ 2026-11-07：先判断是不是「纯限流」——这类不需要过滑块，等 90 秒即可
      //
      // 实测：error_msg 含「操作太过频繁，请稍后再试」且无 verifyAuthToken
      //   → 平台只是限流，不是风控。重试无意义，过滑块更无意义。
      //   旧逻辑会在这种场景下清 token、提 token、重试、再判风控，最终冷却 60~480s，
      //   把一次正常的频率限制放大成「账号被锁」。
      if (isThrottleOnly(r)) {
        markCooldown(shopKey, 54001, `限流：${r?.error_msg || r?.errorMsg || '操作太过频繁'}`)
        const err = new Error('RISK_54001_THROTTLE')
        err.riskCode = 54001
        err.throttleOnly = true            // ★ 上层据此判断「只需等待，不用过滑块」
        err.riskMsg = r?.error_msg || r?.errorMsg || ''
        err.riskData = r
        err.needManualCaptcha = false      // ★ 不需要人工干预
        throw err
      }

      // 先清掉旧 token（SDK：防止用过期 token 空转）
      clearCaptchaToken(shopKey)
      // 从响应里提取新 token
      const newToken = extractCaptchaToken(r)
      if (newToken) {
        saveCaptchaToken(shopKey, newToken)
        console.warn(`[pdd-risk] 收到 54001，已提取新通行证（10 分钟内有效）`)
        // 有 token 且还能重试 → 直接重试，不弹滑块
        if (attempt < maxRetry) {
          await new Promise(r2 => setTimeout(r2, 1800))   // SDK 最常用间隔 1800ms
          continue
        }
        // ★ 2026-10-27：有票但重试后仍 54001 —— 这不是"账号被长封"，
        //   而是「这一击确实打中了」。只记短冷却（60s，够一次滑块的时间），
        //   并把原因写清楚，别让上层看到"冷却剩余 7 小时"却不知为何。
        markCooldown(shopKey, 54001, '54001 已提取通行证但重放仍失败，需人工过一次滑块')
        const err = new Error('RISK_54001')
        err.riskCode = 54001
        err.riskMsg = r?.error_msg || r?.errorMsg || ''
        err.riskData = r
        err.needManualCaptcha = true     // ★ 提示上层：引导人工过滑块即可恢复
        throw err
      }
      // 没拿到 token → 真的需要过滑块。同样只记短冷却 + 明确原因。
      console.warn('[pdd-risk] 54001 但响应无 verifyAuthToken，需人工过滑块')
      markCooldown(shopKey, 54001, '54001 响应无 verifyAuthToken，需人工过一次滑块验证')
      const err = new Error('RISK_54001')
      err.riskCode = 54001
      err.riskMsg = r?.error_msg || r?.errorMsg || ''
      err.riskData = r
      err.needManualCaptcha = true
      throw err
    }

    // 其他码（40002/100001/2000000/600001）：确实是平台侧限流，记冷却并带上原因
    markCooldown(shopKey, code, `命中频控 code=${code}：${r?.error_msg || r?.errorMsg || '平台限流'}`)
    const err = new Error(`RISK_${code}`)
    err.riskCode = code
    err.riskMsg = r?.error_msg || r?.errorMsg || ''
    err.riskData = r
    throw err
  }
  // 理论不可达
  const err = new Error('RISK_54001')
  err.riskCode = 54001
  throw err
}
