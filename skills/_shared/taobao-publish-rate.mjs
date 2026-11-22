/**
 * taobao-publish-rate.mjs —— 淘宝/天猫「发布频率控制」（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么必须有这一层（本仓此前完全没有）
 * ══════════════════════════════════════════════════════════════════
 *   现有发布引擎（mqs-publish.ts / taobao-publish.ts）只有**步骤内等待**：
 *     UI_STEP_DELAY_MS / formWaitMs / uploadWaitMs / skuCellWaitMs …
 *   这些是「一个商品内部点选要等多久」，**没有跨商品的发布频控**。
 *
 *   后果：批量发布 = 连续开浏览器 → 连续提交 → 淘宝判「机器批量铺货」。
 *   这正是 2026-10-15 闲鱼批量 8 条全被下架的同类问题（SKILL 里已记录）：
 *     「同模板批量铺货 + 类目错放」是平台判定要点。
 *
 * ══════════════════════════════════════════════════════════════════
 * 淘宝侧的真实约束（实测/经验，非官方文档）
 * ══════════════════════════════════════════════════════════════════
 *   淘宝**没有公开的发布配额**，但有以下可观察的软约束：
 *     ① 同一账号短时间连续发布 → 提交后出现「发布过于频繁，请稍后再试」
 *     ② 同一账号短时间发布多个**同标题/同主图**商品 → 判重复铺货
 *     ③ 新店/低信用店铺的容忍度显著低于老店
 *     ④ 单日发布量突增（相对店铺历史）→ 人工审核
 *
 *   ★ 这些阈值平台不公开，且会变。所以本模块**不硬编码平台配额**，
 *     而是提供「保守默认 + 可按账号配置 + 命中即停」，把不确定性交给用户判断。
 *
 * ══════════════════════════════════════════════════════════════════
 * 四层防护（对齐 PDD 基座 pdd-risk.mjs 的分层思路）
 * ══════════════════════════════════════════════════════════════════
 *   L1 单次间隔：两次发布之间最少间隔（默认 90s，可配）
 *   L2 滑动窗口：N 分钟内最多 M 次（默认 60 分钟内最多 5 次）
 *   L3 每日上限：单账号每日最多 N 次（默认 20，按账号可覆盖）
 *   L4 命中即停：识别「发布频繁」类错误 → 记冷却 + 整批停止，不重试
 *
 *   全部**落盘**（跨进程），因为每次 publish 都是新进程。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const STATE_FILE = path.join(os.homedir(), '.dsh', 'taobao-publish-rate.json')

/** 保守默认值（可被账号级配置覆盖） */
export const DEFAULT_LIMITS = {
  minIntervalMs: 90_000,        // L1：两次发布最少间隔 90 秒
  windowMs: 60 * 60_000,        // L2：滑动窗口 60 分钟
  windowMax: 5,                 // L2：60 分钟内最多 5 次
  dailyMax: 20,                 // L3：每日最多 20 次
  riskCooldownMs: 30 * 60_000,  // L4：命中「发布频繁」后冷却 30 分钟
}

/** 识别「发布频率」类平台提示 */
export const RATE_PATTERNS = [
  /发布.{0,6}(过于|太)频繁/,
  /操作.{0,6}(过于|太)频繁/,
  /请稍后再试/,
  /请求.{0,4}频繁/,
  /(发布|上架).{0,8}(上限|超出)/,
  /(daily|publish).{0,10}limit/i,
  /too many requests/i,
  /RGV587/i,
]

export function isRateLimited(text) {
  const s = String(text || '')
  return RATE_PATTERNS.some(re => re.test(s))
}

// ── 状态读写 ─────────────────────────────────────────────

function readAll() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return {} }
}

function writeAll(s) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1), 'utf8')
  } catch { /* 记账失败不阻塞 */ }
}

function todayKey(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 账号状态（含自动清理过期窗口） */
export function rateState(shopKey) {
  const all = readAll()
  const st = all[shopKey] || {}
  const now = Date.now()
  const history = (st.history || []).filter(t => now - t < DEFAULT_LIMITS.windowMs)
  const day = st.day || ''
  const todayCount = day === todayKey() ? (st.todayCount || 0) : 0
  const lastAt = st.lastAt || 0
  const cooldownUntil = st.cooldownUntil || 0
  return {
    history,
    todayCount,
    lastAt,
    cooldownUntil,
    cooling: cooldownUntil > now,
    cooldownRemainMs: Math.max(0, cooldownUntil - now),
    limits: { ...DEFAULT_LIMITS, ...(st.limits || {}) },
    lastError: st.lastError || '',
  }
}

/** 账号级配置覆盖（用户可按店铺调整） */
export function setLimits(shopKey, limits = {}) {
  const all = readAll()
  const st = all[shopKey] || {}
  st.limits = { ...(st.limits || {}), ...limits }
  all[shopKey] = st
  writeAll(all)
  return st.limits
}

/**
 * 检查「现在能不能发」——不消耗配额
 * @returns {{allowed:boolean, reason?:string, waitMs:number}}
 */
export function checkPublish(shopKey) {
  const st = rateState(shopKey)
  const now = Date.now()
  const L = st.limits

  if (st.cooling) {
    return {
      allowed: false, waitMs: st.cooldownRemainMs,
      reason: `账号 ${shopKey} 发布冷却中（剩余 ${Math.ceil(st.cooldownRemainMs / 1000)}s）`
        + (st.lastError ? `，原因：${st.lastError.slice(0, 100)}` : ''),
    }
  }

  // L1 单次间隔
  const sinceLast = now - st.lastAt
  if (st.lastAt && sinceLast < L.minIntervalMs) {
    const wait = L.minIntervalMs - sinceLast
    return {
      allowed: false, waitMs: wait,
      reason: `距上次发布仅 ${Math.round(sinceLast / 1000)}s，需间隔 ${Math.round(L.minIntervalMs / 1000)}s（还需 ${Math.ceil(wait / 1000)}s）`,
    }
  }

  // L2 滑动窗口
  if (st.history.length >= L.windowMax) {
    const oldest = st.history[0]
    const wait = (oldest + L.windowMs) - now
    return {
      allowed: false, waitMs: Math.max(0, wait),
      reason: `${Math.round(L.windowMs / 60000)} 分钟内已发 ${st.history.length} 次（上限 ${L.windowMax}），需等 ${Math.ceil(Math.max(0, wait) / 60000)} 分钟`,
    }
  }

  // L3 每日上限
  if (st.todayCount >= L.dailyMax) {
    return {
      allowed: false, waitMs: 0,
      reason: `今日已发 ${st.todayCount} 次，达每日上限 ${L.dailyMax}`,
    }
  }

  return { allowed: true, waitMs: 0 }
}

/**
 * 记一次「即将发布」——消耗配额
 * ★ 必须在真正提交**之前**调用：宁可多记一次，也不要漏记导致超发。
 */
export function consumePublish(shopKey) {
  const all = readAll()
  const st = all[shopKey] || {}
  const now = Date.now()
  const tk = todayKey()

  st.history = (st.history || []).filter(t => now - t < DEFAULT_LIMITS.windowMs)
  st.history.push(now)
  st.lastAt = now
  if (st.day !== tk) { st.day = tk; st.todayCount = 0 }
  st.todayCount = (st.todayCount || 0) + 1

  all[shopKey] = st
  writeAll(all)
  return { todayCount: st.todayCount, windowCount: st.history.length }
}

/**
 * 记一次「发布频控命中」——进入冷却（L4 命中即停）
 */
export function markRateLimited(shopKey, detail = '') {
  const all = readAll()
  const st = all[shopKey] || {}
  const L = { ...DEFAULT_LIMITS, ...(st.limits || {}) }
  st.cooldownUntil = Date.now() + L.riskCooldownMs
  st.lastError = String(detail).slice(0, 300)
  all[shopKey] = st
  writeAll(all)
  return {
    cooling: true,
    cooldownRemainMs: L.riskCooldownMs,
    limits: L,
  }
}

/** 手动解除冷却 / 重置当天计数（用户确认已过风控时）
 *
 * ★ 清 cooldown 时必须**一并清 lastAt**，否则 L1 间隔仍会拦下一次发布。
 *   （实测踩过：只清冷却，reset 完 checkPublish 仍返回「距上次发布仅 0s」。）
 */
export function resetPublishRate(shopKey, { cooldown = true, daily = false } = {}) {
  const all = readAll()
  const st = all[shopKey] || {}
  if (cooldown) {
    delete st.cooldownUntil
    delete st.lastError
    delete st.lastAt          // ★ 必须一起清，否则 L1 间隔继续生效
  }
  if (daily) { delete st.day; delete st.todayCount; delete st.history }
  all[shopKey] = st
  writeAll(all)
  return rateState(shopKey)
}

/**
 * ★ 包装一次发布：检查 → 消耗 → 执行 → 命中频控则记冷却
 *
 * @param {string} shopKey
 * @param {() => Promise<any>} fn   真正的发布动作
 * @param {object} [o]
 * @param {boolean} [o.dryRun]      只检查不消耗（预览阶段用）
 * @returns {Promise<{ok:boolean, skipped?:boolean, reason?:string, waitMs?:number, result?:any}>}
 */
export async function withPublishRate(shopKey, fn, o = {}) {
  const { dryRun = false } = o

  const chk = checkPublish(shopKey)
  if (!chk.allowed) {
    return {
      ok: false, skipped: true, reason: chk.reason, waitMs: chk.waitMs,
    }
  }
  if (dryRun) {
    const st = rateState(shopKey)
    return {
      ok: true, dryRun: true,
      reason: `配额可用（今日已发 ${st.todayCount}/${st.limits.dailyMax}，窗口 ${st.history.length}/${st.limits.windowMax}）`,
    }
  }

  // ★ 先消耗配额再执行：失败也算一次（避免失败重试把配额刷爆）
  const quota = consumePublish(shopKey)

  let result
  try {
    result = await fn()
  } catch (e) {
    const msg = String(e?.message || e)
    if (isRateLimited(msg)) {
      const r = markRateLimited(shopKey, msg)
      return {
        ok: false, rateLimited: true, reason: msg, quota,
        cooldownRemainMs: r.cooldownRemainMs,
      }
    }
    return { ok: false, reason: msg, quota }
  }

  // 结果里也可能带平台提示
  const text = typeof result === 'string' ? result : JSON.stringify(result || {})
  if (!result?.ok && isRateLimited(text)) {
    const r = markRateLimited(shopKey, text)
    return {
      ok: false, rateLimited: true, reason: text.slice(0, 300), quota,
      cooldownRemainMs: r.cooldownRemainMs,
    }
  }

  return { ok: !!result?.ok, result, quota }
}

/** 人类可读的配额摘要（给技能回报用） */
export function quotaSummary(shopKey) {
  const st = rateState(shopKey)
  const L = st.limits
  return {
    today: `${st.todayCount}/${L.dailyMax}`,
    window: `${st.history.length}/${L.windowMax}（${Math.round(L.windowMs / 60000)}分钟）`,
    minIntervalSec: Math.round(L.minIntervalMs / 1000),
    cooling: st.cooling,
    cooldownRemainSec: Math.ceil(st.cooldownRemainMs / 1000),
  }
}

export default {
  DEFAULT_LIMITS, isRateLimited, rateState, setLimits, checkPublish,
  consumePublish, markRateLimited, resetPublishRate, withPublishRate, quotaSummary,
}
