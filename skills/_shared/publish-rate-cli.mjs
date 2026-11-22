/**
 * publish-rate-cli.mjs —— 发布频率控制命令行（基座工具）
 *
 * 用法：
 *   node skills/_shared/publish-rate-cli.mjs status  [--account <shopKey>]
 *   node skills/_shared/publish-rate-cli.mjs check   [--account <shopKey>]
 *   node skills/_shared/publish-rate-cli.mjs reset   [--account <shopKey>] [--daily]
 *   node skills/_shared/publish-rate-cli.mjs limits  [--account <shopKey>] \
 *        [--min-interval 90] [--window-max 5] [--window-min 60] [--daily-max 20]
 *
 * 典型用法：
 *   批量发布前先 status 看还剩多少配额
 *   被平台提示「发布频繁」后 reset 手动解除（确认已过风控）
 */
import { rateState, setLimits, resetPublishRate, checkPublish, quotaSummary, DEFAULT_LIMITS } from './taobao-publish-rate.mjs'
import { listTaobaoAccounts } from './taobao-account.mjs'

function argOf(name, def = '') {
  const i = process.argv.indexOf('--' + name)
  if (i === -1) return def
  const v = process.argv[i + 1]
  return v === undefined || v.startsWith('--') ? def : v
}
const flag = n => process.argv.includes('--' + n)

const cmd = process.argv[2] || 'status'
let account = argOf('account', '')

if (!account) {
  const accs = await listTaobaoAccounts()
  const valid = accs.find(a => a.status === 'valid') || accs[0]
  account = valid?.shopKey || ''
}
if (!account) {
  console.error('找不到淘宝账号，请用 --account 指定')
  process.exit(2)
}

const out = (o) => { console.log(JSON.stringify(o, null, 1)) }

switch (cmd) {
  case 'status': {
    const st = rateState(account)
    out({
      account,
      ...quotaSummary(account),
      lastPublishAt: st.lastAt ? new Date(st.lastAt).toISOString() : null,
      windowHistory: st.history.map(t => new Date(t).toISOString()),
      limits: st.limits,
      cooling: st.cooling,
      cooldownRemainSec: Math.ceil(st.cooldownRemainMs / 1000),
      lastError: st.lastError || '',
    })
    break
  }
  case 'check': {
    const c = checkPublish(account)
    out({
      account, allowed: c.allowed,
      waitMs: c.waitMs,
      waitSec: Math.ceil(c.waitMs / 1000),
      reason: c.reason || '可发布',
      ...quotaSummary(account),
    })
    break
  }
  case 'reset': {
    const r = resetPublishRate(account, { cooldown: true, daily: flag('daily') })
    out({ account, reset: true, dailyReset: flag('daily'), ...quotaSummary(account) })
    break
  }
  case 'limits': {
    const patch = {}
    const mi = argOf('min-interval', '')
    const wm = argOf('window-max', '')
    const wmin = argOf('window-min', '')
    const dm = argOf('daily-max', '')
    if (mi) patch.minIntervalMs = Number(mi) * 1000
    if (wm) patch.windowMax = Number(wm)
    if (wmin) patch.windowMs = Number(wmin) * 60_000
    if (dm) patch.dailyMax = Number(dm)
    if (!Object.keys(patch).length) {
      out({ account, limits: rateState(account).limits, defaults: DEFAULT_LIMITS })
      break
    }
    const lim = setLimits(account, patch)
    out({ account, updated: patch, limits: lim })
    break
  }
  default:
    console.error(`未知命令: ${cmd}（status|check|reset|limits）`)
    process.exit(2)
}
