/**
 * douyin-guard.mjs —— 抖音（抖店）技能统一风控闸门（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要（对照 pdd-guard.mjs 的教训）
 * ══════════════════════════════════════════════════════════════════
 * 拼多多那边审计出 4 个真实问题，抖音这边**全部原样存在**，甚至更严重：
 *
 *   skill            账号锁  冷却检查  账号级节流  记冷却  假成功检测
 *   douyin-goods      ✅      ❌        ❌         ❌      ✅(有桩守卫)
 *   douyin-shop       ✅      ❌        ❌         ❌      ✅
 *   douyin-order      ✅      ❌        ❌         ❌      ✅
 *   douyin-activity   ✅      ❌        ❌         ❌      ✅
 *   douyin-promo      ✅      ❌        ❌         ❌      ✅
 *   douyin-publish-*  ❌      ❌        ❌         ❌      ❌  ← 最危险
 *
 * 而且抖音特有：
 *   · 10001010A「环境风险」一旦出现，**重试只会更糟**
 *   · 每次 goto + sleep(12000~16000)，天然就是低频，但一旦改成 Node
 *     就会失去这层「意外的节流」，必须显式补回来
 *
 * ══════════════════════════════════════════════════════════════════
 * 用法
 * ══════════════════════════════════════════════════════════════════
 *   const g = await openTask('douyin-goods', shopKey)
 *   const r = await g.call('goods.list', { pageSize: 20 }, { account })
 *   await g.close()
 *
 *   或最省事：
 *   await withDouyinGuard('douyin-goods', shopKey, async (g) => {
 *     const r = await g.call('goods.list', {}, { account })
 *   })
 *
 * ══════════════════════════════════════════════════════════════════
 * 设计原则
 * ══════════════════════════════════════════════════════════════════
 *   1. 失败开放（fail-open）但留痕：闸门自己异常绝不阻断业务
 *   2. 单一数据源：冷却/健康分全部落盘到一个 state 文件，不做多套并行状态
 *   3. 不猜错误语义：只有实测过的码才归类（见 douyin-request.classify）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const load = (f) => import(pathToFileURL(path.join(HERE, f)).href)

const STATE_DIR = path.join(os.homedir(), '.dsh', 'douyin-guard')
const STATE_FILE = path.join(STATE_DIR, 'state.json')

/* ══════════════════════════════════════════════════════════════════
 * 节流配置（保守起步，实测后可放宽）
 * ══════════════════════════════════════════════════════════════════ */
export const THROTTLE = {
  readGapMs: 250,           // 读接口最小间隔（实测 1.5s 很安全，250ms 先试）
  writeGapMs: 3000,         // 写接口间隔
  perEndpointGapMs: 500,    // 同一接口最小间隔
  scanWindowMs: 60000,      // 扫描检测窗口
  scanDistinctLimit: 25,    // 60s 内不同接口上限（抖店比 PDD 宽松）
  scanCooldownMs: 120000,   // 触发扫描冷却 2 分钟
  riskCooldownMs: 300000,   // 10001010A 冷却 5 分钟
  rateCooldownMs: 90000,    // 频控冷却 90s
  // ★ 2026-11-11 实测补充：抖店 / 千川只读全部免签，实测 162 接口连打无频控。
  //   原来 3s 的账号级间隔对「串行 5 个接口」= 多耗 12~15 秒，纯属浪费。
  //   改成「同接口 500ms，不同接口 250ms」实测 5 接口串行 1.4s 稳过。
  burstWindowMs: 60000,     // 突发窗口
  burstLimit: 60,           // 60s 内最多 60 次（实测 30 次零间隔全过，留 2x 余量）
}

/* ══════════════════════════════════════════════════════════════════
 * 状态持久化
 * ══════════════════════════════════════════════════════════════════ */
function ensureDir() {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }) } catch { /* ignore */ }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return { accounts: {}, updatedAt: null }
  }
}

function writeState(state) {
  ensureDir()
  state.updatedAt = new Date().toISOString()
  try {
    const tmp = STATE_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
    fs.renameSync(tmp, STATE_FILE)
  } catch (e) {
    log(`状态写入失败（fail-open）：${e?.message}`)
  }
}

function acctState(state, shopKey) {
  if (!state.accounts[shopKey]) {
    state.accounts[shopKey] = {
      health: 100,
      cooldownUntil: 0,
      cooldownReason: '',
      lastCallAt: 0,
      endpointLast: {},
      recentEndpoints: [],
      stats: { ok: 0, fail: 0, risk: 0, rateLimit: 0, session: 0 },
    }
  }
  return state.accounts[shopKey]
}

/* ══════════════════════════════════════════════════════════════════
 * 公开：查询 / 运维
 * ══════════════════════════════════════════════════════════════════ */

export function getAccountState(shopKey) {
  const s = readState()
  const a = s.accounts[shopKey]
  if (!a) return { shopKey, health: 100, cooling: false, waitMs: 0, stats: null }
  const waitMs = Math.max(0, (a.cooldownUntil || 0) - Date.now())
  return { shopKey, ...a, cooling: waitMs > 0, waitMs }
}

export function clearCooldown(shopKey) {
  const s = readState()
  const a = acctState(s, shopKey)
  a.cooldownUntil = 0
  a.cooldownReason = ''
  a.health = Math.min(100, a.health + 20)
  writeState(s)
  return getAccountState(shopKey)
}

export function guardHealth() {
  const s = readState()
  const out = Object.entries(s.accounts).map(([k, a]) => ({
    shopKey: k,
    health: a.health,
    cooling: (a.cooldownUntil || 0) > Date.now(),
    waitMs: Math.max(0, (a.cooldownUntil || 0) - Date.now()),
    stats: a.stats,
  }))
  return { ok: true, accounts: out, stateFile: STATE_FILE }
}

/* ══════════════════════════════════════════════════════════════════
 * 节流决策
 * ══════════════════════════════════════════════════════════════════ */
function decideWait(a, endpoint, isWrite) {
  const now = Date.now()
  const reasons = []
  let waitMs = 0

  // ① 冷却中
  const cd = (a.cooldownUntil || 0) - now
  if (cd > 0) {
    reasons.push(`冷却中(${a.cooldownReason})`)
    waitMs = Math.max(waitMs, cd)
  }

  // ② 同接口间隔
  const lastEp = a.endpointLast?.[endpoint] || 0
  const epWait = lastEp + THROTTLE.perEndpointGapMs - now
  if (epWait > 0) {
    reasons.push('同接口间隔')
    waitMs = Math.max(waitMs, epWait)
  }

  // ③ 账号级间隔
  const base = isWrite ? THROTTLE.writeGapMs : THROTTLE.readGapMs
  const gWait = (a.lastCallAt || 0) + base - now
  if (gWait > 0) {
    reasons.push('账号级间隔')
    waitMs = Math.max(waitMs, gWait)
  }

  // ④ 扫描式探测检测
  const recent = (a.recentEndpoints || []).filter((x) => now - x.t < THROTTLE.scanWindowMs)
  const distinct = new Set(recent.map((x) => x.ep))
  if (distinct.size >= THROTTLE.scanDistinctLimit && !distinct.has(endpoint)) {
    reasons.push(`60s 内已访问 ${distinct.size} 个不同接口`)
    waitMs = Math.max(waitMs, THROTTLE.scanCooldownMs)
  }

  return { waitMs, reasons }
}

function recordCall(a, endpoint) {
  const now = Date.now()
  a.lastCallAt = now
  a.endpointLast = a.endpointLast || {}
  a.endpointLast[endpoint] = now
  a.recentEndpoints = (a.recentEndpoints || []).filter((x) => now - x.t < THROTTLE.scanWindowMs)
  a.recentEndpoints.push({ ep: endpoint, t: now })
}

/* ══════════════════════════════════════════════════════════════════
 * 开任务
 * ══════════════════════════════════════════════════════════════════ */

const PROFILE_LOCKS = new Map()

/**
 * 开一个任务（账号锁 + 冷却检查 + 健康分）
 * @param {string} skillName  如 'douyin-goods'
 * @param {string} shopKey
 * @param {object} opts { needProfile?: boolean, timeoutMs?: number }
 */
export async function openTask(skillName, shopKey, opts = {}) {
  const started = Date.now()
  const notes = []

  // ① 账号锁（防同一账号并发跑两个任务 → 抢 Profile / 互相限流）
  if (PROFILE_LOCKS.has(shopKey)) {
    const holder = PROFILE_LOCKS.get(shopKey)
    if (Date.now() - holder.at < 10 * 60 * 1000) {
      throw new Error(`账号 ${shopKey} 正被 ${holder.skill} 占用（${Math.round((Date.now() - holder.at) / 1000)}s 前）`)
    }
    notes.push('检测到陈旧锁，已接管')
  }
  PROFILE_LOCKS.set(shopKey, { skill: skillName, at: Date.now() })

  // ② 冷却 / 健康分检查
  const state = readState()
  const a = acctState(state, shopKey)
  const st = getAccountState(shopKey)
  if (st.cooling) {
    log(`账号冷却中：${Math.ceil(st.waitMs / 1000)}s（${a.cooldownReason}）`)
  }
  if (a.health < 30) {
    notes.push(`健康分偏低(${a.health})，建议先跑 clearCooldown 或重新登录`)
  }
  writeState(state)

  let closed = false

  return {
    skillName,
    shopKey,
    notes,

    /** 带节流的请求 */
    async call(name, params = {}, callOpts = {}) {
      const R = await load('douyin-request.mjs')
      const spec = (await load('douyin-registry.mjs')).resolve(name, { allowUnverified: callOpts.allowUnverified })
      const endpoint = spec.path
      // ★ 不能用 method==='POST' 判断读写！
      //   千川的只读查询（list-summary / statQuery / getAnalysisReport）全是 POST，
      //   按 POST 判写会让每次查询白等 3 秒（实测 5 接口 overview 因此拖到 7 秒）。
      //   正确做法：注册表显式标 isWrite，没标的一律按读处理。
      const isWrite = spec.isWrite === true

      // 节流
      const s2 = readState()
      const a2 = acctState(s2, shopKey)
      const { waitMs, reasons } = decideWait(a2, endpoint, isWrite)
      if (waitMs > 0) {
        if (waitMs > 1000) log(`⏳ 等待 ${Math.ceil(waitMs / 1000)}s（${reasons.join(' / ')}）`)
        await sleep(waitMs)
      }
      recordCall(a2, endpoint)
      writeState(s2)

      // 发请求（重试策略由 classify 决定）
      const maxRetry = callOpts.noRetry ? 0 : 2
      let r = null
      for (let attempt = 0; attempt <= maxRetry; attempt++) {
        r = await R.request(name, params, { ...callOpts, account: callOpts.account })

        const s3 = readState()
        const a3 = acctState(s3, shopKey)
        if (r.ok) {
          a3.stats.ok++
          a3.health = Math.min(100, a3.health + 1)
          writeState(s3)
          return r
        }

        // 失败记账
        const kind = r.errorKind
        if (kind === 'risk_control') {
          a3.stats.risk++
          a3.cooldownUntil = Date.now() + THROTTLE.riskCooldownMs
          a3.cooldownReason = '10001010A 环境风险'
          a3.health = Math.max(0, a3.health - 25)
          writeState(s3)
          log(`❌ ${name} 环境风险 → 冷却 ${THROTTLE.riskCooldownMs / 1000}s（不重试）`)
          return r
        }
        if (kind === 'rate_limit') {
          a3.stats.rateLimit++
          a3.cooldownUntil = Date.now() + THROTTLE.rateCooldownMs
          a3.cooldownReason = '频控'
          a3.health = Math.max(0, a3.health - 10)
          writeState(s3)
          if (attempt < maxRetry) {
            log(`⚠ ${name} 频控，等 ${THROTTLE.rateCooldownMs / 1000}s 重试（${attempt + 1}/${maxRetry}）`)
            await sleep(THROTTLE.rateCooldownMs)
            continue
          }
          return r
        }
        if (kind === 'session') {
          a3.stats.session++
          a3.health = Math.max(0, a3.health - 20)
          writeState(s3)
          a3.needReloginUntil = Date.now() + 15 * 60 * 1000   // ★ 15 分钟有效，不永久锁死
          writeState(s3)
          return r
        }
        if (kind === 'server' && attempt < maxRetry) {
          await sleep(1500 * (attempt + 1))
          continue
        }
        a3.stats.fail++
        writeState(s3)
        return r
      }
      return r
    },

    /** 收尾 */
    async close() {
      if (closed) return
      closed = true
      const lock = PROFILE_LOCKS.get(shopKey)
      if (lock && lock.skill === skillName) PROFILE_LOCKS.delete(shopKey)
      const s = readState()
      const a = acctState(s, shopKey)
      log(`[${skillName}] 收尾：ok=${a.stats.ok} fail=${a.stats.fail} risk=${a.stats.risk} 健康分=${a.health} 用时=${Date.now() - started}ms`)
      writeState(s)
    },
  }
}

/** 最省事写法 */
export async function withDouyinGuard(skillName, shopKey, fn) {
  const g = await openTask(skillName, shopKey)
  try {
    return await fn(g)
  } finally {
    await g.close().catch(() => {})
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const log = (msg) => console.error('[douyin-guard] ' + msg)

export default { openTask, withDouyinGuard, getAccountState, clearCooldown, guardHealth, THROTTLE }
