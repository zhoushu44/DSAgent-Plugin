/**
 * pdd-token-refresh.mjs —— 推广域「换 token」基座（2026-11-18 新增）
 *
 * ══════════════════════════════════════════════════════════════════
 * 解决什么
 * ══════════════════════════════════════════════════════════════════
 * 2026-11-18 实测：空空商行（pdd_mms）拉推广数据时，pdd-promo 连续 6 次被宿主的
 * 「60 秒无输出 → idle 超时」杀掉。排查后确认：
 *
 *   · 推广域（yingxiao.pinduoduo.com）的签名 token 与 mms 域**不同源**，
 *     且必须满足「header.anti-content 值 == body.crawlerInfo（同一个 token）」。
 *   · 旧实现里，「换 token」散落在两处、各自独立：
 *       ① pdd-request.mjs 的签名器切换（jsdom ↔ hybrid）—— 只在 54001/54003 触发
 *       ② pdd-request.mjs 的 Cookie 自愈（healCookies）   —— 只在 43001/40001 触发
 *     两处**都不覆盖** 54001 的「清旧 token → 提新票 → 重放」自愈语义，
 *     而且**都没有单飞锁**：同一账号并发失败时，每个请求都去开一次浏览器 →
 *     Profile 锁竞争 → 反而更容易超时。
 *
 * 本模块把「换 token」收敛成**一条基座级链路**：
 *   ① 单飞（single-flight）：同账号并发只跑一次刷新，其余共享同一结果
 *   ② 冷却（cooldown）：刷新失败后一段时间内不再试（避免累计行为分数上升）
 *   ③ 预算（deadline）：总耗时封顶，宿主 60s idle 上限内必须能优雅退出
 *   ④ 阶梯（ladder）：按「代价从低到高」依次尝试换 token，每一级都用真实请求验证
 *
 * ══════════════════════════════════════════════════════════════════
 * 阶梯（上一级失败才升一级）
 * ══════════════════════════════════════════════════════════════════
 *   L1 resign        重置签名环境 + 同签名器重取签名
 *                   （jsdom 的 initPromoV2 是模块级单例，画像变了不 reset 就一直用旧的）
 *   L2 switch-signer 换签名器（jsdom ↔ hybrid），成功后**记住**该账号用哪个
 *   L3 renew-cookie  从 Profile / 常驻签名服务提新票（Cookie），再用原签名器重签
 *   L4 reset-all     环境 + 票 + 签名 一起换
 *   L5 captcha       滑块闭环（pdd-captcha-gate.mjs）—— 只在 54001 且有 page 时
 *
 * ══════════════════════════════════════════════════════════════════
 * 铁律（违反会让风控更严重）
 * ══════════════════════════════════════════════════════════════════
 *   · 54003 不进阶梯（security_blocked：重扫无效，只能等）
 *   · 40002 / 100001 不进阶梯（频控：换 token 没用，还延长封禁）
 *   · HTTP 429 / 430 不进阶梯（网关级限流）
 *   · 写操作不自动重放（调用方传 noBrowserFallback 时整条阶梯跳过）
 *   · 刷新失败**不重复登录**（重登只会刷新风控基线）
 *   · 任何内部异常都 fail-open（返回 ok:false，让调用方走原有路径，绝不把请求带崩）
 */

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const load = (f) => import(pathToFileURL(path.join(SELF_DIR, f)).href)

/* ── 常量 ────────────────────────────────────────────────────────── */

/** 宿主 idle 上限 60s；基座预算留 25s 余量给上层组装结果 */
export const DEFAULT_DEADLINE_MS = 35_000
/** 阶梯中途失败的冷却（90s） */
const COOLDOWN_PARTIAL_MS = 90_000
/** 阶梯全灭的冷却（300s） */
const COOLDOWN_FULL_MS = 300_000
/** 冷却期内的强制刷新预算：最多 3 次，之后必须等 */
const FORCE_BUDGET = 3

/**
 * 可自愈的 token 类错误码。
 * ★ 54003 **不在**里面：security_blocked（重扫无效，只能等），重试只会延长封禁。
 * ★ 40002 / 100001 **不在**里面：频控，换 token 没用。
 * ★ HTTP 429 / 430 不在：网关级限流。
 */
export const TOKEN_ERRORS = new Set([54001, 43001, 40001])

/* ── 状态 ────────────────────────────────────────────────────────── */

/** shopKey → Promise（单飞：同账号并发只跑一次刷新） */
const _inflight = new Map()
/** shopKey → { until, reason }（冷却） */
const _cooldown = new Map()
/** shopKey → { count, at }（冷却期内的强制刷新计数） */
const _forceBudget = new Map()

/* ── 公开 API ────────────────────────────────────────────────────── */

/** 这个错误码是否值得「换 token」 */
export function isTokenError(ec) {
  return TOKEN_ERRORS.has(Number(ec))
}

/** 冷却剩余毫秒（0 = 不在冷却期） */
export function tokenCooldownRemaining(shopKey) {
  if (!shopKey) return 0
  const c = _cooldown.get(shopKey)
  if (!c) return 0
  const left = c.until - Date.now()
  if (left <= 0) { _cooldown.delete(shopKey); return 0 }
  return left
}

/** 手动清冷却（用户人工过滑块 / 重新登录后调用） */
export function clearTokenCooldown(shopKey) {
  if (!shopKey) return
  _cooldown.delete(shopKey)
  _forceBudget.delete(shopKey)
}

/** 诊断快照 */
export function tokenRefreshState(shopKey) {
  return {
    cooldownRemainingMs: tokenCooldownRemaining(shopKey),
    cooldownReason: _cooldown.get(shopKey)?.reason || null,
    inflight: _inflight.has(shopKey),
    forceCount: _forceBudget.get(shopKey)?.count || 0,
  }
}

/**
 * 换 token 主入口。
 *
 * @param {string} shopKey 账号标识
 * @param {object} opts
 *   ec          number  触发原因的错误码（54001 / 43001 / 40001）
 *   deadlineMs  number  总时间预算（默认 35s，宿主 idle 上限 60s）
 *   currentMode string  当前签名器模式（'jsdom' | 'hybrid'）
 *   modes       string[] 可用签名器顺序
 *   page        any     浏览器页（可选，L5 滑块闭环需要）
 *   force       boolean 冷却期内是否强制刷新（受 FORCE_BUDGET 限制）
 *   capabilities {
 *     sign(mode, {force, persist}) → {sig, cookies, ua} | null
 *     renewCookies()               → {cookies, ua} | null
 *     resetEnv()                   → void
 *     solveCaptcha()               → {ticket} | null
 *   }
 *   probe(token) → {ok, ec, res?}   用这枚 token 实打一次，返回是否真的通了
 *
 * @returns {Promise<{ok, token?, steps, probe?, skipped?, exhausted?, hint?}>}
 */
export async function refreshToken(shopKey, opts = {}) {
  if (!shopKey) {
    return { ok: false, skipped: 'no_shopKey', steps: [], hint: '缺少 shopKey，无法定位账号' }
  }
  try {
    return await _refreshToken(shopKey, opts)
  } catch (e) {
    // ★ fail-open：基座新链路出错，绝不能把原来的请求路径带崩
    return {
      ok: false, skipped: 'exception', steps: [],
      hint: '换 token 内部异常（已忽略，走原有路径）：' + String(e?.message || e).slice(0, 120),
    }
  }
}

async function _refreshToken(shopKey, opts) {
  const ec = Number(opts.ec || 0)
  const steps = []

  if (!isTokenError(ec)) {
    return { ok: false, skipped: 'not_token_error', steps, hint: `ec=${ec} 不是可自愈的 token 类错误` }
  }

  // ① 冷却闸门
  const left = tokenCooldownRemaining(shopKey)
  if (left > 0) {
    if (!opts.force) {
      return {
        ok: false, skipped: 'cooldown', steps, retryAfterMs: left,
        hint: `换 token 冷却中（还剩 ${Math.ceil(left / 1000)}s）：${_cooldown.get(shopKey)?.reason || ''}；`
          + '冷却期内不重复尝试，避免累计行为分数上升。',
      }
    }
    const fb = _forceBudget.get(shopKey) || { count: 0 }
    if (fb.count >= FORCE_BUDGET) {
      return {
        ok: false, skipped: 'force_budget', steps,
        hint: `强制换 token 连续 ${fb.count} 次未成功，已停手（冷却还剩 ${Math.ceil(left / 1000)}s）。`
          + '继续强刷只会加重风控，请人工过滑块或稍后再试。',
      }
    }
    fb.count += 1
    fb.at = Date.now()
    _forceBudget.set(shopKey, fb)
  }

  // ② 单飞：同账号并发只跑一次刷新，其余共享同一结果
  const running = _inflight.get(shopKey)
  if (running) {
    try {
      const r = await running
      return { ...r, shared: true }
    } catch (e) {
      return { ok: false, skipped: 'shared_failed', steps: [], hint: String(e?.message || e).slice(0, 120) }
    }
  }

  const deadline = Date.now() + Math.max(2000, Number(opts.deadlineMs || DEFAULT_DEADLINE_MS))
  const p = runLadder(shopKey, opts, deadline, steps)
  _inflight.set(shopKey, p)
  try {
    return await p
  } finally {
    if (_inflight.get(shopKey) === p) _inflight.delete(shopKey)
  }
}

/**
 * 阶梯执行器。
 * 每一级都产出新签名，并用 `probe` 真实打一次验证——**不靠"生成成功"当成功**。
 */
async function runLadder(shopKey, opts, deadline, steps) {
  const caps = opts.capabilities || {}
  const ladder = buildLadder(opts)
  let lastProbe = null
  let gotSig = false

  for (const step of ladder) {
    if (Date.now() >= deadline) {
      return {
        ok: false, exhausted: 'deadline', steps, probe: lastProbe,
        hint: `换 token 超出时间预算（还剩 ${Math.max(0, Math.round((deadline - Date.now()) / 1000))}s），已停止尝试。`,
      }
    }
    try {
      // ① 本级前置动作：重置环境 / 提新票 / 过滑块
      if (step.resetEnv && caps.resetEnv) await caps.resetEnv()

      if (step.renewCookies && caps.renewCookies) {
        const c = await caps.renewCookies()
        if (!c || !c.cookies || !Object.keys(c.cookies).length) {
          steps.push({ name: step.name, ok: false, detail: '提新票失败' })
          continue
        }
      }

      if (step.captcha && caps.solveCaptcha) {
        const t = await caps.solveCaptcha()
        if (!t) {
          steps.push({ name: step.name, ok: false, detail: '滑块未通过' })
          // 滑块没过，后面几级也没意义（同源的签名/票据都不会凭空变好）
          break
        }
      }

      // ② 用本级签名器重新签名
      const token = caps.sign ? await caps.sign(step.mode, { force: !!step.force, persist: !!step.persist }) : null
      if (!token || !token.sig) {
        steps.push({ name: step.name, ok: false, detail: '签名生成失败' })
        continue
      }
      gotSig = true

      // ③ 真实请求验证
      if (typeof opts.probe !== 'function') {
        steps.push({ name: step.name, ok: true, detail: `签名器=${step.mode}（未提供 probe，未验证）` })
        return { ok: true, token: { ...token, mode: step.mode }, steps, probe: null }
      }
      let pr = null
      try {
        pr = await opts.probe(token)
      } catch (e) {
        pr = { ok: false, ec: 'exception', error: String(e?.message || e).slice(0, 100) }
      }
      lastProbe = pr
      steps.push({ name: step.name, ok: !!pr?.ok, ec: pr?.ec ?? null, detail: `签名器=${step.mode}` })

      if (pr?.ok) {
        clearTokenCooldown(shopKey)
        return { ok: true, token: { ...token, mode: step.mode }, steps, probe: pr }
      }
      // ★ 闸门拦截（账号冷却 / 限流）—— 这不是 token 的问题，换 token 也没意义，
      //   而且**不能**因此记 token 冷却（否则把限流误记成签名问题，冷却期会误导排查）。
      if (pr?.blocked) {
        return {
          ok: false, exhausted: 'guard_blocked', steps, probe: pr,
          hint: pr.hint || '闸门拦截（账号冷却/限流），换 token 无意义，已停止尝试。',
        }
      }
      // probe 失败：只有 token 类错误才值得继续换 token；其他错误换多少次都一样
      if (pr && !isTokenError(pr.ec)) break
    } catch (e) {
      steps.push({ name: step.name, ok: false, detail: String(e?.message || e).slice(0, 100) })
    }
  }

  const reason = gotSig
    ? '阶梯走完仍未拿到可用签名（真实请求仍被拒）'
    : '所有签名器都拿不到签名'
  const cd = gotSig ? COOLDOWN_PARTIAL_MS : COOLDOWN_FULL_MS
  markCooldown(shopKey, reason, cd)
  return {
    ok: false, exhausted: 'ladder', steps, probe: lastProbe,
    hint: `${reason}。已进入冷却（${Math.round(cd / 1000)}s），期间不再自动重试；`
      + '如需强刷，请人工过滑块后调用 clearTokenCooldown()。',
  }
}

/**
 * 阶梯定义。
 * 签名器顺序：current（正在用的）→ other（另一个）→ current（带新票）→ other（全换）。
 */
function buildLadder(opts) {
  const ec = Number(opts.ec || 0)
  const all = Array.isArray(opts.modes) && opts.modes.length ? opts.modes.slice() : ['jsdom', 'hybrid']
  const cur = opts.currentMode && all.includes(opts.currentMode) ? opts.currentMode : all[0]
  const alt = all.find((m) => m !== cur) || cur

  const L = [
    // L1 重置签名环境 + 同签名器重签
    { name: 'resign', mode: cur, force: true, resetEnv: true },
    // L2 换签名器（jsdom ↔ hybrid），成功后记住该账号用哪个
    { name: 'switch-signer', mode: alt, force: true, resetEnv: true, persist: true },
    // L3 提新票（Cookie）+ 用原签名器重签
    { name: 'renew-cookie', mode: cur, force: true, renewCookies: true },
    // L4 环境 + 票 + 签名 全换
    { name: 'reset-all', mode: alt, force: true, resetEnv: true, renewCookies: true, persist: true },
  ]
  // L5 滑块闭环 —— 只在 54001（可自愈的风控）且有浏览器页时才有意义
  if (ec === 54001 && opts.page) {
    L.push({
      name: 'captcha', mode: alt, force: true,
      resetEnv: true, renewCookies: true, persist: true, captcha: true,
    })
  }
  return L
}

function markCooldown(shopKey, reason, ms) {
  _cooldown.set(shopKey, { until: Date.now() + ms, reason })
}

export default {
  refreshToken,
  isTokenError,
  tokenCooldownRemaining,
  clearTokenCooldown,
  tokenRefreshState,
  TOKEN_ERRORS,
  DEFAULT_DEADLINE_MS,
}
