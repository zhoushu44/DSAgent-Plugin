/**
 * taobao-throttle.mjs —— 账号级跨进程节流 + 风控冷却（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么必须放基座、必须落盘（吸收自 Accio/官方口径 REQUIREMENTS §4.2）
 * ══════════════════════════════════════════════════════════════════
 *   技能侧的 `_last_request_at` 是**实例级**变量。
 *   每次 `dsagent_execute_skill` 都是新的子进程 → 计时器归零 → 首请求立即发出。
 *   并发 N 个技能各自按 4~6s 节流却互不知情，
 *   同一账号实际出口频率 ≈ N × 1/5s —— 这就是 RGV587 的成因。
 *
 *   基座是唯一能看见「同一账号全部请求」的地方，所以节流与冷却必须落盘：
 *     ~/.dsh/taobao-throttle.json   账号级最近调用时间（跨进程）
 *     ~/.dsh/taobao-risk.json       风控冷却（见 taobao-risk.mjs）
 *
 * 官方参数（REQUIREMENTS.md §4.2，与原项目 taobao_client.py 逐字一致）：
 *   节流   4.0s + 0~2.0s 抖动
 *   冷却   命中 risk_control 后该账号 60s 内不再发请求
 *
 * 基座在此基础上加了指数退避（60s→5min→15min→1h），因为实测
 * 淘宝对详情接口的封禁（denycdc_forbidden）恢复得比 60s 慢得多。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const THROTTLE_FILE = path.join(os.homedir(), '.dsh', 'taobao-throttle.json')

/** 官方口径：4.0s + 0~2.0s 抖动；可用 opts 覆盖 */
export const DEFAULT_INTERVAL_MS = 4000
export const DEFAULT_JITTER_MS = 2000

function readAll() {
  try { return JSON.parse(fs.readFileSync(THROTTLE_FILE, 'utf8')) } catch { return {} }
}

function writeAll(s) {
  try {
    fs.mkdirSync(path.dirname(THROTTLE_FILE), { recursive: true })
    fs.writeFileSync(THROTTLE_FILE, JSON.stringify(s, null, 1), 'utf8')
  } catch { /* 记账失败不阻塞 */ }
}

/**
 * 跨进程「拿节流配额」：返回需要等待的毫秒数，并把本次时间写回。
 * ★ 必须先写回再等待，否则并发进程会同时看到旧值、同时放行。
 */
export function acquireSlot(shopKey, { intervalMs = DEFAULT_INTERVAL_MS, jitterMs = DEFAULT_JITTER_MS } = {}) {
  const all = readAll()
  const now = Date.now()
  const prev = all[shopKey] || {}
  const last = prev.lastCallAt || 0
  const gap = now - last
  const need = intervalMs + Math.random() * jitterMs
  const waitMs = gap >= need ? 0 : Math.ceil(need - gap)
  all[shopKey] = { lastCallAt: now + waitMs, lastSeen: now }
  writeAll(all)
  return { waitMs, allowedAt: now + waitMs }
}

/** 读当前账号的节流状态（排障用） */
export function throttleState(shopKey) {
  const rec = readAll()[shopKey] || {}
  const lastCallAt = rec.lastCallAt || 0
  return {
    lastCallAt,
    sinceLastMs: lastCallAt ? Date.now() - lastCallAt : null,
    scheduledAheadMs: Math.max(0, lastCallAt - Date.now()),
  }
}

/** 清掉某账号的节流记录（排障 / 换号后） */
export function resetThrottle(shopKey) {
  const all = readAll()
  delete all[shopKey]
  writeAll(all)
  return true
}

export default { acquireSlot, throttleState, resetThrottle, DEFAULT_INTERVAL_MS, DEFAULT_JITTER_MS }
