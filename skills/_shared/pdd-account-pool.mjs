/**
 * 多账号池调度器
 *
 * 核心原则（来自上架助手逆向）：
 *   换号 > 解滑块 > 放弃
 *   换号成本 0，打码 0.01~0.05 元
 *
 * 账号评分：
 *   health 分（100 起，命中风控递减）
 *   + 最近成功次数
 *   - 冷却中
 *   - 需重新登录
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
import { canUse, getAccountState, HEALTH } from './pdd-antiban.mjs'

const STATE_FILE = path.join(homedir(), '.dsh', 'pdd-throttle-state.json')

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {} } catch { return {} }
}

/**
 * 账号池
 */
export class AccountPool {
  /**
   * @param {Array<{shopKey:string, label?:string, cookies?:object}>} accounts
   */
  constructor(accounts = []) {
    this.accounts = accounts.map(a => ({
      shopKey: a.shopKey,
      label: a.label || a.shopKey.slice(-12),
      cookies: a.cookies || null,
    }))
  }

  /** 从 CredentialStore 自动构建 */
  static async fromStore() {
    const { CredentialStore } = await import('file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/lib/services/credential-store.js')
    const { join } = await import('node:path')
    const { homedir } = await import('node:os')
    const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
    const accs = store.listAccounts().filter(a => a.platform === 'pdd_mms')
    return new AccountPool(accs.map(a => ({
      shopKey: a.shop_key,
      label: (a.account_meta?.display_nick || a.shop_key).slice(-16),
      cookies: a.cookies,
    })))
  }

  /**
   * ★ 选最优账号
   * 排序：可用 > 健康分高 > 冷却时间短
   * @returns {{shopKey, score, reason} | null}
   */
  pick(exclude = []) {
    const state = readState()
    const now = Date.now()
    const candidates = []

    for (const a of this.accounts) {
      if (exclude.includes(a.shopKey)) continue
      const st = state[a.shopKey] || {}
      const avail = canUse(a.shopKey)

      let score = st.health ?? HEALTH.init
      // 冷却中大幅降分
      if (!avail.ok && avail.remainMs) {
        score -= Math.min(80, avail.remainMs / 60000)   // 每分钟 −1
      } else if (!avail.ok) {
        score -= 100   // 需重登录等
      }
      // 成功次数加成
      const okCount = st.stats?.ok || 0
      score += Math.min(20, okCount * 0.5)
      // 有 Cookie 的优先
      const hasCookie = a.cookies?.['PASS_ID'] ? 10 : 0
      score += hasCookie

      candidates.push({
        shopKey: a.shopKey,
        label: a.label,
        score: Math.round(score),
        health: st.health ?? HEALTH.init,
        cooling: !avail.ok,
        remainMs: avail.remainMs || 0,
        reason: avail.reason || null,
        hasCookie: !!a.cookies?.['PASS_ID'],
      })
    }

    candidates.sort((a, b) => b.score - a.score)
    if (!candidates.length) return null
    const best = candidates[0]
    return best.cooling ? null : best   // 全部冷却中 → null
  }

  /** 列出所有账号状态 */
  list() {
    const state = readState()
    return this.accounts.map(a => {
      const st = state[a.shopKey] || {}
      const avail = canUse(a.shopKey)
      return {
        shopKey: a.shopKey,
        label: a.label,
        health: st.health ?? HEALTH.init,
        todayCaptcha: st.captchaCount || 0,
        stats: st.stats || { ok: 0, captcha: 0, session: 0, rateLimit: 0, other: 0 },
        available: avail.ok,
        reason: avail.reason || null,
        remainMs: avail.remainMs || 0,
        hasCookie: !!a.cookies?.['PASS_ID'],
      }
    }).sort((a, b) => b.health - a.health)
  }

  /**
   * 带换号重试的执行
   *
   * @param {Function} fn (shopKey) => Promise<result>
   * @param {object} opts
   * @param {number} [opts.maxAttempts] 最多换几个号，默认 3
   * @param {string[]} [opts.exclude]   排除的账号
   * @returns {Promise<{ok, result, shopKey, attempts}>}
   */
  async runWithFailover(fn, opts = {}) {
    const maxAttempts = opts.maxAttempts ?? 3
    const tried = [...(opts.exclude || [])]
    const attempts = []

    for (let i = 0; i < maxAttempts; i++) {
      const acct = this.pick(tried)
      if (!acct) {
        return {
          ok: false, kind: 'no_available_account',
          attempts,
          hint: tried.length ? `已试 ${tried.length} 个账号全部失败` : '没有可用账号',
        }
      }
      tried.push(acct.shopKey)

      let result
      try {
        result = await fn(acct.shopKey, acct)
      } catch (e) {
        result = { ok: false, kind: 'exception', hint: e.message }
      }

      attempts.push({ shopKey: acct.label, score: acct.score, ok: result?.ok, kind: result?.kind })

      if (result?.ok) {
        return { ok: true, result, shopKey: acct.shopKey, label: acct.label, attempts }
      }

      // 判断是否值得换号
      const retriable = ['session_expired', 'captcha', 'rate_limit', 'blocked', 'login_needed', 'no_permission']
      if (!retriable.includes(result?.kind)) {
        // 参数错误等，换号也没用
        return { ok: false, result, shopKey: acct.shopKey, attempts, hint: '非账号问题，换号无效' }
      }
    }

    return { ok: false, kind: 'all_failed', attempts, hint: `试了 ${attempts.length} 个账号全部失败` }
  }
}
