/**
 * pdd-seed-auto.mjs —— 种子自动维护（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么做这个（2026-11-07）
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯 Node 签名依赖 localStorage 种子（_nano_fp / MMS-LOGIN-FP / ISLOGIN ...）。
 * 这些字段会随登录状态变化 → 种子过期 → 签名被拒 → 降级浏览器（变慢）。
 *
 * 手工维护不现实（"每次登录后跑一次"没人会记得）。
 * 所以做**自动检测 + 自动刷新**，挂在 openTask 上，业务无感。
 *
 * ══════════════════════════════════════════════════════════════════
 * 触发时机（四档，按成本从低到高）
 * ══════════════════════════════════════════════════════════════════
 *
 *   ① 种子不存在        → 必须导出（否则纯 Node 完全不可用）
 *   ② 种子超过 7 天     → 后台异步刷新（不阻塞当前任务）
 *   ③ 签名连续失败 2 次 → 立即刷新
 *   ④ Cookie 的 _nano_fp 与种子不一致 → 立即刷新（登录态变了）
 *
 * ══════════════════════════════════════════════════════════════════
 * 关键设计
 * ══════════════════════════════════════════════════════════════════
 *
 *   · **不阻塞**：② 走后台异步，当前请求照常降级浏览器
 *   · **防抖**：同一账号 10 分钟内最多刷一次（避免频繁开浏览器）
 *   · **可从 Cookie 判断**：账号 Cookie 里的 _nano_fp 是权威值，
 *     与种子里的不一致 → 说明登录态变了 → 立刻刷新
 *   · **失败不抛**：刷新失败只记日志，绝不影响业务
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const STATE_FILE = path.join(os.homedir(), '.dsh', 'pdd-seed-state.json')
const SEED_DIR = path.join(os.homedir(), '.dsh', 'pdd-risk-seeds')

/** 同一账号最短刷新间隔（防抖） */
const MIN_REFRESH_GAP_MS = 10 * 60 * 1000
/** 种子有效期 */
const SEED_TTL_MS = 7 * 24 * 3600 * 1000

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {} } catch { return {} }
}
function writeState(s) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1), 'utf8')
  } catch { /* ignore */ }
}
function seedPath(shopKey) {
  return path.join(SEED_DIR, `${String(shopKey).replace(/[^\w.-]/g, '_')}.json`)
}

/**
 * 判断种子是否需要刷新
 * @param {string} shopKey
 * @param {object} cookies 账号 Cookie（用于比对 _nano_fp）
 * @returns {{ need:boolean, reason:string, urgent:boolean }}
 */
export function checkSeedHealth(shopKey, cookies = {}) {
  const p = seedPath(shopKey)
  if (!fs.existsSync(p)) {
    return { need: true, reason: '种子不存在', urgent: true }
  }

  let seed = null
  try { seed = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { /* 损坏 */ }
  if (!seed || !seed.localStorage) {
    return { need: true, reason: '种子损坏', urgent: true }
  }

  // ★ 注意：**不能**用 Cookie 的 _nano_fp 和种子的 _nano_fp 比对！
  //   实测两者本来就是不同值（Cookie 是会话级、localStorage 是设备级），
  //   这个判据会把健康种子误判为"登录态已变化"，导致无限刷新。
  //
  //   正确的登录态判据：账号 Cookie 的 PASS_ID 变化时间 vs 种子保存时间。
  //   但 Cookie 记录里没有签发时间，所以退化为「比较 MMS-LOGIN-FP 是否仍在」+
  //   「种子是否过期」两档，配合签名失败次数动态触发。

  // ① MMS-LOGIN-FP 丢失（登录指纹没了，说明种子不完整）
  if (!seed.localStorage['MMS-LOGIN-FP']) {
    return { need: true, reason: 'MMS-LOGIN-FP 缺失', urgent: true }
  }

  // ② ISLOGIN 丢失
  if (String(seed.localStorage['ISLOGIN'] || '') !== '1') {
    return { need: true, reason: 'ISLOGIN 缺失', urgent: true }
  }

  // ③ 过期
  const age = Date.now() - (seed.savedAt || 0)
  if (age > SEED_TTL_MS) {
    return { need: true, reason: `种子已过期（${Math.round(age / 86400000)} 天）`, urgent: false }
  }

  return { need: false, reason: '', urgent: false }
}

/**
 * 推广域环境画像（设备指纹）的健康检查。
 *
 * ★ 2026-11-09 新增：推广域也纳入自动维护。
 *   环境画像 = seed.promoEnv，是「抓一次用很久」的资产；
 *   缺了它，纯 Node 签名的指纹就是空的（必被服务端判无效）。
 */
export function checkPromoEnvHealth(shopKey, opts = {}) {
  const p = seedPath(shopKey)
  if (!fs.existsSync(p)) return { need: true, reason: '种子不存在', urgent: false }
  let seed = null
  try { seed = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { /* 损坏 */ }
  if (!seed) return { need: true, reason: '种子损坏', urgent: false }
  if (!seed.promoEnv || !seed.promoEnv.nav || !seed.promoEnv.doc) {
    return { need: true, reason: '推广域环境画像缺失', urgent: false }
  }
  const maxAge = opts.maxAgeMs || 30 * 24 * 3600 * 1000
  const at = seed.promoEnv.capturedAt || 0
  if (at && Date.now() - at > maxAge) {
    return { need: true, reason: `推广域环境画像已过期（${Math.round((Date.now() - at) / 86400000)} 天）`, urgent: false }
  }
  return { need: false, reason: '', urgent: false }
}

/**
 * 刷新推广域环境画像。
 * 优先走**常驻签名服务**（它已经持有那个 Profile 的 Chrome），
 * 避免另开浏览器和守护进程抢 Profile 锁。
 */
export async function refreshPromoEnv(shopKey, opts = {}) {
  try {
    const dm = await import('./pdd-signer-daemon.mjs')
    let profile = await dm.daemonEnv(shopKey).catch(() => null)
    if (!profile) {
      // 守护进程没起 → 拉起再试
      const started = await dm.ensureDaemon().catch(() => null)
      if (started?.ok) profile = await dm.daemonEnv(shopKey).catch(() => null)
    }
    if (!profile) return { ok: false, reason: '常驻签名服务不可用（环境画像未刷新）' }
    const { readSeed, writeSeed } = await import('./pdd-seed-store.mjs')
    const seed = readSeed(shopKey) || { localStorage: {}, sessionStorage: {} }
    seed.promoEnv = profile
    seed.promoEnv.version = profile.version || 3
    seed.promoEnv.capturedAt = Date.now()
    writeSeed(shopKey, seed)
    return { ok: true, reason: '推广域环境画像已刷新' }
  } catch (e) {
    return { ok: false, reason: '环境画像刷新失败：' + String(e?.message || e).slice(0, 80) }
  }
}

/**
 * 防抖检查：是否允许现在刷新
 */
function canRefreshNow(shopKey) {
  const st = readState()
  const last = st[shopKey]?.lastRefreshAt || 0
  return Date.now() - last > MIN_REFRESH_GAP_MS
}

function markRefreshed(shopKey, result) {
  const st = readState()
  st[shopKey] = {
    lastRefreshAt: Date.now(),
    lastResult: result,
  }
  writeState(st)
}

/**
 * 自动确保种子可用
 *
 * @param {object} opts
 * @param {string} opts.shopKey
 * @param {object} opts.cookies        账号 Cookie
 * @param {string} opts.profileDir     浏览器 profile 目录
 * @param {boolean} [opts.blocking]    true=阻塞等待刷新（种子缺失时必须）
 * @param {string} [opts.pluginRoot]
 * @returns {Promise<{ok:boolean, refreshed:boolean, reason:string, seed:object|null}>}
 */
export async function ensureSeed(opts) {
  const { shopKey, cookies = {}, profileDir, blocking = false, pluginRoot = process.cwd() } = opts

  const health = checkSeedHealth(shopKey, cookies)

  // ★ 已健康 → 直接返回；但**推广域环境画像**可能还缺（两者是独立的）
  if (!health.need) {
    const envH = checkPromoEnvHealth(shopKey)
    if (envH.need) {
      // 环境画像缺失不阻塞主流程（后台补），但要记一笔
      if (canRefreshNow(shopKey + ':env')) {
        markRefreshed(shopKey + ':env', 'triggered')
        refreshPromoEnv(shopKey).catch(() => { })
      }
    }
    return { ok: true, refreshed: false, reason: envH.need ? envH.reason : '', seed: readSeedSafe(shopKey) }
  }

  // 防抖：刚刷过就跳过
  // ★ 例外：urgent（种子不存在/损坏/关键字段缺失）必须无视防抖，否则永远修不好
  if (!health.urgent && !canRefreshNow(shopKey)) {
    return { ok: false, refreshed: false, reason: `${health.reason}（10 分钟内已尝试刷新，跳过）`, seed: readSeedSafe(shopKey) }
  }

  // 决定是否阻塞
  const mustBlock = blocking || health.urgent === false ? false : !readSeedSafe(shopKey)
  // 种子完全不存在 → 阻塞（否则纯 Node 用不了）
  // 种子存在但过期/不一致 → 后台刷新，不阻塞当前任务
  const shouldBlock = blocking || !readSeedSafe(shopKey)

  const doRefresh = async () => {
    try {
      const { exportSeedFromBrowser } = await import('./pdd-seed-store.mjs')
      const r = await exportSeedFromBrowser({ shopKey, profileDir, pluginRoot })
      markRefreshed(shopKey, r.ok ? 'ok' : 'fail')
      // ★ 推广域环境画像一并维护（登录后自动补齐，纯 Node 签名的前提）
      const envHealth = checkPromoEnvHealth(shopKey)
      if (envHealth.need) {
        const er = await refreshPromoEnv(shopKey).catch(() => ({ ok: false, reason: 'skip' }))
        if (!er.ok) console.warn('[seed-auto] ' + er.reason)
      }
      return { ok: true, refreshed: true, reason: health.reason, seed: readSeedSafe(shopKey) }
    } catch (e) {
      markRefreshed(shopKey, 'error:' + String(e.message).slice(0, 60))
      return { ok: false, refreshed: false, reason: `${health.reason} → 刷新失败：${String(e.message).slice(0, 60)}`, seed: readSeedSafe(shopKey) }
    }
  }

  if (shouldBlock) {
    return await doRefresh()
  }

  // 后台异步刷新（不阻塞）
  doRefresh().catch(() => { })
  return { ok: false, refreshed: false, reason: `${health.reason} → 已触发后台刷新`, seed: readSeedSafe(shopKey) }
}

function readSeedSafe(shopKey) {
  try {
    return JSON.parse(fs.readFileSync(seedPath(shopKey), 'utf8'))
  } catch { return null }
}

/**
 * 记录一次签名失败（连续失败会触发刷新）
 */
export function noteSignFailure(shopKey) {
  const st = readState()
  const cur = st[shopKey] || {}
  cur.signFailures = (cur.signFailures || 0) + 1
  cur.lastFailureAt = Date.now()
  st[shopKey] = cur
  writeState(st)
  // 连续 2 次 → 强制刷新（清掉防抖）
  if (cur.signFailures >= 2) {
    cur.lastRefreshAt = 0
    writeState(st)
  }
}

/** 记录一次签名成功（清零失败计数） */
export function noteSignSuccess(shopKey) {
  const st = readState()
  if (st[shopKey]) {
    st[shopKey].signFailures = 0
    writeState(st)
  }
}

/** 种子状态汇总 */
export function seedStatus(shopKey, cookies = {}) {
  const h = checkSeedHealth(shopKey, cookies)
  const seed = readSeedSafe(shopKey)
  const st = readState()[shopKey] || {}
  return {
    shopKey,
    needRefresh: h.need,
    reason: h.reason,
    savedAt: seed?.savedAt || 0,
    ageDays: seed?.savedAt ? Math.round((Date.now() - seed.savedAt) / 86400000) : null,
    lastRefreshAt: st.lastRefreshAt || 0,
    signFailures: st.signFailures || 0,
    lastResult: st.lastResult || '',
  }
}

export const SEED_AUTO_INFO = {
  module: 'pdd-seed-auto.mjs',
  triggers: [
    '种子不存在 → 阻塞导出',
    '超过 7 天 → 后台异步刷新',
    '连续 2 次签名失败 → 立即刷新',
    '_nano_fp 与 Cookie 不一致 → 立即刷新',
  ],
  debounce: '10 分钟/账号',
  nonBlocking: true,
  stateFile: STATE_FILE,
}
