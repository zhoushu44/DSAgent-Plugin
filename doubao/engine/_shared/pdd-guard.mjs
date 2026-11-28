/**
 * pdd-guard.mjs —— 拼多多技能统一风控闸门（所有 pdd-* 技能的唯一出口）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要这个文件（2026-11-04 审计结论）
 * ══════════════════════════════════════════════════════════════════
 * 审计 7 个 pdd 技能、32 个脚本后，实际风控能力分布是「各自为政」：
 *
 *   skill            账号锁  冷却检查  账号级节流  进程内节流  记冷却  签名判定  54001自愈
 *   pdd-activity      ✅      ✅        ✅          ❌         ✅      ❌       ✅
 *   pdd-chance        ✅      ✅        ❌          ✅(2s)     ✅      ❌       ✅
 *   pdd-promo         ✅      ✅        ✅          ❌         ✅      ❌       ✅
 *   pdd-video         ✅      ✅        ❌          ❌         ✅      ❌       ❌
 *   pdd-works         ✅      ✅        ✅          ❌         ✅      ❌       ✅
 *   pdd-shop          ✅      ✅        ✅          ❌         ✅      ❌       ❌
 *   pdd-publish  ❌      ❌        ❌          ❌         ❌      ❌       ❌   ← 最严的商品发布域，零风控
 *   pdd-link-matrix   ✅      ❌        ❌          ❌         ✅      ❌       ❌
 *
 * 四个真实问题：
 *   ① **pdd-publish 完全裸奔**：它打的是 /glide/ /vodka/（最严的商品发布域），
 *      却是唯一没有账号锁、没有冷却检查、没有节流的技能。而它恰恰是最容易被封的动作。
 *   ② **pdd-chance 用进程内 2s 节流**（`lastHit` Map）：每次 execute_skill 都是新进程，
 *      等于零节流。这正是 pdd-http 在 2026-10-27 修过的同一个 bug，另一个技能里还在。
 *   ③ **签名判定完全没接**：9 个技能没有一处用 pdd-sign-scope，各自 hook 页面拿签名。
 *      拿不到就静默跳过（`if (sig)`），于是请求变成"裸奔签名"，平台侧看就是异常会话。
 *   ④ **收尾记账不统一**：有的记 recordResult，有的只 markCooldown，有的都不记。
 *      同一个 54001 在不同技能里留下不同状态 → 冷却时长不可预测。
 *
 * 本模块把上述 8 个维度收敛成**一次调用**：
 *
 *   const g = await openTask('pdd-publish', shopKey)   // 开任务（锁 + 冷却 + 健康分）
 *   await g.beforeCall(url)                                  // 每次请求前：节流 + 签名决策
 *   await g.afterCall(url, json)                             // 每次响应后：错误归因 + 记账
 *   await g.close()                                          // 收尾（放锁 + 汇总）
 *
 * 或者最省事的写法：
 *
 *   await withPddGuard('pdd-works', shopKey, async (g) => {
 *     const r = await g.call(url, body)      // 自带节流 + 签名 + 自愈 + 记账
 *   })
 *
 * ══════════════════════════════════════════════════════════════════
 * 设计原则
 * ══════════════════════════════════════════════════════════════════
 *   1. **不改变任何技能的既有行为**，只做「准入 + 记账」两件事。
 *      技能原来怎么发请求还怎么发，闸门只管"能不能发""发完记什么账"。
 *   2. **失败开放（fail-open）但留痕**：闸门自身异常绝不阻断业务，
 *      只在 stderr 打一行 `[pdd-guard] degraded: ...`。
 *      理由：风控是「降低概率」不是「保证安全」，闸门挂了让业务全停是更差的结果。
 *   3. **单一数据源**：冷却/健康分/节流全部复用 pdd-antiban 与 pdd-risk，
 *      本模块不自己落盘任何状态，避免出现第 N 套并行状态。
 *   4. **可观测**：每次开任务/被拦/降级都有结构化日志，便于事后归因。
 */

import { pathToFileURL } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 插件根（skills/_shared 上两级）。不要用 process.cwd() —— 技能脚本的 cwd 是 skills/<skill> */
const PLUGIN_ROOT_DIR = path.resolve(HERE, '..', '..')
const load = (f) => import(pathToFileURL(path.join(HERE, f)).href)

let _risk = null
let _antiban = null
let _sign = null
let _err = null

async function mods() {
  if (!_risk) _risk = await load('pdd-risk.mjs').catch(() => null)
  if (!_antiban) _antiban = await load('pdd-antiban.mjs').catch(() => null)
  if (!_sign) _sign = await load('pdd-sign-scope.mjs').catch(() => null)
  if (!_err) _err = await load('pdd-error.mjs').catch(() => null)
  return { risk: _risk, antiban: _antiban, sign: _sign, err: _err }
}

const log = (...a) => {
  try { console.error('[pdd-guard]', ...a) } catch { /* ignore */ }
}

/** 闸门是否可用（任一依赖缺失 → degraded） */
export async function guardHealth() {
  const m = await mods()
  const missing = []
  if (!m.risk) missing.push('pdd-risk')
  if (!m.antiban) missing.push('pdd-antiban')
  if (!m.sign) missing.push('pdd-sign-scope')
  if (!m.err) missing.push('pdd-error')
  return { ok: missing.length === 0, missing }
}


/**
 * ══════════════════════════════════════════════════════════════════
 * VerifyAuthToken 统一获取（2026-11-05）
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要这个：
 *   `credentials:'include'` 只带 Cookie。而 VerifyAuthToken 是**请求头**，不是 Cookie。
 *   页面自己的请求由 msfe 的 bt 插件在 beforeSend 里读 cookie → 塞进头；
 *   但技能的 `page.evaluate(fetch(...))` **绕过了整个插件链**——
 *   结果 cookie 里明明有票，请求头里却没有。服务端看到的是
 *   「一个刚过完验证、却不知道要带票的客户端」，票等于白拿。
 *
 * 两条来源，按优先级：
 *   ① 页面 cookie `msfe-pc-cookie-captcha-token`（最真实，平台自己写的）
 *   ② pdd-risk 的通行证存储（pdd-risk 在 54001 时从响应里提取的）
 */

/**
 * 在页面上下文里读 cookie 票（需在 page.evaluate 内使用，函数会被序列化）
 * 用法：const vtk = await page.evaluate(READ_CAPTCHA_COOKIE_FN)
 */
export const READ_CAPTCHA_COOKIE_FN = () => {
  try {
    const m = document.cookie.match(/(?:^|;\s*)msfe-pc-cookie-captcha-token=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : ''
  } catch { return '' }
}

/**
 * 取 VerifyAuthToken：优先页面 cookie，其次 pdd-risk 存储。
 * @param {object} page  puppeteer page（可空；为空则只用存储）
 * @param {string} shopKey
 * @returns {Promise<string>}  空串表示没有可用票
 */
export async function getVerifyAuthToken(page, shopKey) {
  // ① 页面 cookie（最真实）
  if (page) {
    try {
      const v = await page.evaluate(READ_CAPTCHA_COOKIE_FN)
      if (v) return v
    } catch { /* 页面可能已关闭 */ }
  }
  // ② pdd-risk 存储（54001 响应里提取的）
  try {
    const m = await mods()
    const t = m.risk?.getCaptchaToken?.(shopKey)
    if (t?.token) return t.token
  } catch { /* ignore */ }
  return ''
}

/**
 * ══════════════════════════════════════════════════════════════════
 * 登录态红线（代码级强制，2026-11-05）
 * ══════════════════════════════════════════════════════════════════
 * 四条红线决定的是「会不会把用户登出」——代价高于触发风控：
 * 风控还能过滑块恢复，掉登录要重扫码，54003 甚至扫码也没用。
 *
 *   ① 禁止 --cookie-clean  （会删掉唯一持久 cookie，等于主动登出）
 *   ② 一个账号只用一个 profile（多 profile = 多会话互顶）
 *   ③ 同 profile 不并发、不背靠背（关闭后至少留 30s）
 *   ④ 54003 出现即停号 24h（已在 RISK_CODES 落地）
 */

/** 最后关闭时间落盘文件（用于「不背靠背」检查） */
const LAST_CLOSE_FILE = path.join(os.homedir(), '.dsh', 'pdd-profile-last-close.json')

/** 背靠背最小间隔（毫秒）。低于此值启动同一 profile = 多会话互顶风险 */
export const MIN_RESTART_GAP_MS = 30_000

function readLastClose() {
  try { return JSON.parse(fs.readFileSync(LAST_CLOSE_FILE, 'utf8')) || {} } catch { return {} }
}
function writeLastClose(o) {
  try {
    fs.mkdirSync(path.dirname(LAST_CLOSE_FILE), { recursive: true })
    fs.writeFileSync(LAST_CLOSE_FILE, JSON.stringify(o, null, 1))
  } catch { /* ignore */ }
}

/** 记录某 profile 刚刚关闭（供下一次 openTask 做间隔检查） */
export function markProfileClosed(shopKey) {
  if (!shopKey) return
  const d = readLastClose()
  d[shopKey] = Date.now()
  writeLastClose(d)
}

/**
 * 红线②：一个账号只用一个 profile
 * @param {string} shopKey
 * @returns {{ ok: boolean, count: number, dirs: string[], hint?: string }}
 */
export function checkProfileUniqueness(shopKey) {
  const base = path.join(os.homedir(), '.dsh', 'browser-profiles', 'accounts')
  let dirs = []
  try {
    dirs = fs.readdirSync(base).filter(d => d.startsWith(shopKey) && !/\.bak|-shared|_shared/.test(d))
  } catch { return { ok: true, count: 0, dirs: [] } }
  return {
    ok: dirs.length <= 1,
    count: dirs.length,
    dirs,
    hint: dirs.length > 1
      ? `账号 ${shopKey} 存在 ${dirs.length} 个 profile 目录（${dirs.join(', ')}），多 profile 会导致会话互顶。请确认只用其中一个。`
      : undefined,
  }
}

/**
 * 红线③：不背靠背启动
 * @param {string} shopKey
 * @param {number} [gapMs]
 * @returns {{ ok: boolean, waitMs: number, lastAt: number }}
 */
export function checkRestartGap(shopKey, gapMs = MIN_RESTART_GAP_MS) {
  const d = readLastClose()
  const lastAt = d[shopKey] || 0
  const elapsed = Date.now() - lastAt
  const waitMs = lastAt && elapsed < gapMs ? gapMs - elapsed : 0
  return { ok: waitMs === 0, waitMs, lastAt }
}

/**
 * 红线①：检测命令行是否带了 --cookie-clean
 * ⚠️ 它不是「修复登录」，是**主动登出**：删掉子域持久 cookie，只留父域会话 cookie。
 * @returns {{ dirty: boolean, argv: string[] }}
 */
export function detectCookieClean() {
  const argv = process.argv.slice(2)
  return { dirty: argv.includes('--cookie-clean'), argv }
}

/**
 * 开一个受控任务
 *
 * @param {string} skill    技能名（写进锁 label，便于排查「谁占着号」）
 * @param {string} shopKey  账号
 * @param {object} [opts]
 * @param {number} [opts.lockWaitMs=0]      等锁时长；0 = 拿不到立即返回
 * @param {boolean} [opts.skipLock=false]   已知外层已持锁时跳过（pdd-link-matrix 嵌套调用场景）
 * @param {boolean} [opts.requireHealthy=false] 健康分过低时直接拒绝（默认只告警）
 * @returns {Promise<Guard>}
 */
export async function openTask(skill, shopKey, opts = {}) {
  const { lockWaitMs = 0, skipLock = false, requireHealthy = false } = opts
  const m = await mods()
  const t0 = Date.now()

  if (!shopKey) {
    log('degraded: 无 shopKey，闸门不生效')
    return makeGuard({ skill, shopKey, degraded: 'no-shopKey' })
  }

  const health = await guardHealth()
  if (!health.ok) {
    log(`degraded: 缺少 ${health.missing.join(', ')}，闸门降级为「只记录不拦截」`)
    return makeGuard({ skill, shopKey, degraded: `missing:${health.missing.join(',')}` })
  }

  // ══ 登录态红线（代码级强制，2026-11-05）══════════════════════
  //   四条红线决定「会不会把用户登出」，代价高于触发风控：
  //   风控还能过滑块恢复，掉登录要重扫码，54003 扫码也没用。

  // ── 红线①：--cookie-clean = 主动登出，直接拒绝启动 ──
  const cc = detectCookieClean()
  if (cc.dirty) {
    return makeGuard({
      skill, shopKey, blocked: true,
      reason: '命令行带了 --cookie-clean。它会删掉子域持久 cookie（唯一能长期保持登录的那份），'
        + '等于主动把账号登出。请移除该参数后重试。',
    })
  }

  // ── 红线②：一个账号只用一个 profile（多 profile = 会话互顶）──
  const pu = checkProfileUniqueness(shopKey)
  if (!pu.ok) log(`警告: ${pu.hint}`)

  // ── 红线③：不背靠背（上次关闭后至少留 30s）──
  if (!opts.skipRestartGap) {
    const rg = checkRestartGap(shopKey, opts.restartGapMs ?? MIN_RESTART_GAP_MS)
    if (!rg.ok) {
      const waitS = Math.ceil(rg.waitMs / 1000)
      log(`等待 ${waitS}s（上一个任务刚关闭，避免多会话互顶）…`)
      await new Promise(r => setTimeout(r, rg.waitMs))
    }
  }

  // ── ① 冷却检查（账号级，落盘跨进程）──
  const cd = m.risk.checkCooldown(shopKey)
  if (cd.cooling) {
    return makeGuard({
      skill, shopKey, blocked: true,
      reason: `账号冷却中（${cd.reason}），剩余约 ${Math.ceil(cd.remainMs / 1000)}s`,
    })
  }

  // ── ② 健康分检查 ──
  if (m.antiban?.canUse) {
    const av = m.antiban.canUse(shopKey)
    if (!av.ok) {
      return makeGuard({ skill, shopKey, blocked: true, reason: av.reason || '账号不可用' })
    }
    if (requireHealthy && (av.health ?? 100) < 40) {
      return makeGuard({
        skill, shopKey, blocked: true,
        reason: `健康分过低（${av.health}），建议换号或休整`,
      })
    }
    if ((av.health ?? 100) < 50) log(`警告: 账号健康分 ${av.health}，建议降低频率`)
  }

  // ── ③ 账号级互斥锁 ──
  let locked = false
  /** 进程级兜底释放：SIGTERM / SIGINT / 未捕获异常 / 正常退出时放锁（SIGKILL 拦不到，靠 pid 存活判定兜） */
  let exitRelease = null
  if (!skipLock && m.risk.tryAcquireAccountLock) {
    // ★ 2026-11-19：等锁期间必须持续往 stderr 打心跳。
    //   外层技能看门狗是「60 秒无任何输出即 SIGKILL」（skill-service.ts IDLE_TIMEOUT）。
    //   以前这里 lockWaitMs=300_000，等锁时一句话都不打 → 60 秒必被杀，
    //   而 SIGKILL 不触发 exit 钩子 → 锁不释放 → 下一次又等 300 秒 → 永远失败。
    //   现在：每 15 秒打一行进度，让看门狗看到「我还活着」。
    //   （pdd-risk 内部也只在首次进入等待时打一行，这里补周期性心跳。）
    let lockTimer = null
    if (lockWaitMs > 0) {
      const every = Math.min(15_000, Math.max(5_000, Math.floor(lockWaitMs / 4)))
      lockTimer = setInterval(() => {
        log(`仍在等待账号锁（最多 ${Math.round(lockWaitMs / 1000)}s）…`)
      }, every)
      if (lockTimer.unref) lockTimer.unref()
    }
    let r
    try {
      r = await m.risk.tryAcquireAccountLock(shopKey, skill, lockWaitMs)
    } finally {
      if (lockTimer) clearInterval(lockTimer)
    }
    if (!r.ok) {
      return makeGuard({
        skill, shopKey, blocked: true,
        reason: `账号被「${r.holder || '其他任务'}」占用`,
      })
    }
    locked = true

  // ★ 2026-11-19：注册进程级兜底释放。
  //   事故背景：技能被看门狗 SIGKILL 后 exit 钩子不执行 → 锁留在盘上 →
  //   下一次调用等 300s 且零输出 → 又被 60s idle 看门狗杀 → 新锁再留下 → 死循环。
  //   SIGKILL 拦不住（由 pdd-risk 的 pid 存活判定兜），但其余退出路径都应该立刻放锁。
  exitRelease = () => {
    try { _risk?.releaseAccountLock?.(shopKey) } catch { /* ignore */ }
  }
  process.once('exit', exitRelease)
  process.once('SIGINT', () => { try { exitRelease?.() } finally { process.exit(130) } })
  process.once('SIGTERM', () => { try { exitRelease?.() } finally { process.exit(143) } })
  process.once('uncaughtException', (e) => {
    try { exitRelease?.() } catch { /* ignore */ }
    log(`未捕获异常，已释放账号锁：${String(e?.message || e).slice(0, 120)}`)
    process.exit(1)
  })

  // ★ 2026-11-19 关键补充：Windows 上信号根本投递不到（kill('SIGTERM') = TerminateProcess），
  //   所以必须走协议式退出 —— 父进程往 stdin 写 __DSAGENT_TERMINATE__，这里读到就放锁。
  //   这才是「被看门狗终止时也能释放锁」真正生效的那条路径。
  try {
    const { installTerminateGuard, onTerminate } = await import(new URL('./terminate-guard.mjs', import.meta.url).href)
    installTerminateGuard()
    onTerminate(exitRelease)
  } catch { /* 钩子装不上不影响主流程，pid 存活判定仍能兜 */ }
}

  // ══ ④ 种子自动维护（2026-11-07，2026-11-19 重写）════════════
  //   纯 Node 签名依赖 localStorage 种子（_nano_fp / MMS-LOGIN-FP / ISLOGIN）。
  //
  //   ★★ 2026-11-19 复盘：这里曾经是「一天之内能用变不能用」的真凶 ★★
  //
  //   事故链：
  //     ① 我为验证「种子自愈」删了一次种子文件；
  //     ② 从此每次 openTask 都判定「种子缺失」，触发 ensureSeed；
  //     ③ ensureSeed 会起一个 Chrome，用**和取数会话同一个 user-data-dir**；
  //     ④ 两个 Chrome 抢一个 Profile → 后起的取数页面加载不完整
  //        （实测模块数 687，正常 1186）→ eDaA 不存在 → 签名失败。
  //
  //   这就是「以前一直能用、今天突然不行」的原因 —— 不是平台改版，
  //   是我删种子引入的副作用。
  //
  //   最终处置：**在 openTask 里彻底不碰浏览器**。
  //     种子只影响「纯 Node 快通道」的可用性，不影响浏览器真签名取数。
  //     种子由登录流程（browser-login）和手动工具维护，不在每次任务启动时抢 Profile。
  //     代价：纯 Node 通道可能在种子缺失时降级为浏览器，慢一点，但**永远能用**。
  //     收益：不会再出现「为了省 2 秒反而把整条链路搞死」。
  try {
    const sa = await import(new URL('./pdd-seed-auto.mjs', import.meta.url).href)
    const health = sa.checkSeedHealth(shopKey, m.risk?.getAccountCookies?.(shopKey) || {})
    if (health.need) {
      log(`种子${health.reason}（不影响本次取数；种子仅用于纯 Node 快通道，跳过自动刷新以免抢占 Profile）`)
    }
  } catch (e) {
    log(`种子检查跳过：${String(e.message).slice(0, 60)}`)
  }

  return makeGuard({ skill, shopKey, locked, t0, exitRelease, autoProgress: true })
}

/** 便捷包装：自动 open/close */
export async function withPddGuard(skill, shopKey, fn, opts = {}) {
  const g = await openTask(skill, shopKey, opts)
  if (g.blocked) return { ok: false, blocked: true, failureKind: 'rate_limit', reason: g.reason }
  try {
    return await fn(g)
  } finally {
    await g.close()
  }
}

function makeGuard({ skill, shopKey, locked = false, blocked = false, reason = '', degraded = '', t0 = Date.now(), exitRelease = null, autoProgress = false }) {
  const stats = { calls: 0, ok: 0, captcha: 0, rateLimit: 0, session: 0, other: 0, signed: 0, unsigned: 0, securityBlocked: 0 }
  let hb = null
  let progress = null

  /**
   * ★ 2026-11-19：通用进度心跳。
   *
   * 事故根因（比账号锁更底层）：skill-service 的看门狗是「60 秒内 stdout/stderr
   * 一个字节都没有 → SIGKILL」（IDLE_TIMEOUT = 60_000，见 skill-service.ts:434）。
   * 而 pdd-promo overview 正常就要 75~80 秒，中间 Node 通道采集是一大段静默，
   * 于是「脚本本身没毛病，但一定被看门狗杀掉」——表现正是「技能 60 秒无输出」。
   *
   * 所以心跳不能只加在等锁那一处，必须是所有 pdd 技能、所有长阶段的公共保险：
   * 只要守卫还活着，就每 20 秒打一行，告诉看门狗「我还在跑」。
   */
  const startProgress = () => {
    if (progress || blocked) return
    progress = setInterval(() => {
      const s = Math.round((Date.now() - t0) / 1000)
      try {
        console.error(`[pdd-guard] ${skill} 运行中 ${s}s（已调用 ${stats.calls} 次，等待平台返回…）`)
      } catch { /* ignore */ }
    }, 20_000)
    if (progress.unref) progress.unref()
  }

  const guard = {
    skill,
    shopKey,
    blocked,
    reason,
    degraded,
    stats,

    /** 是否可用（未拦截） */
    get ready() { return !blocked },

    /** 启动通用进度心跳（所有技能在进入长流程前调用一次，幂等） */
    startProgress,

    /**
     * 每次请求前调用：账号级节流 + 签名决策
     * @param {string} url
     * @returns {Promise<{ allow: boolean, reason?: string, waitMs: number, plan?: object }>}
     */
    async beforeCall(url) {
      if (blocked) return { allow: false, reason, waitMs: 0 }
      const m = await mods()

      // 节流（账号级落盘；缺失则跳过）
      let waitMs = 0
      if (m.antiban?.reserveSlot && shopKey) {
        try {
          const slot = await m.antiban.reserveSlot(shopKey, url)
          if (slot.cooling) {
            return { allow: false, reason: slot.reason || '账号冷却中', waitMs: slot.waitMs }
          }
          waitMs = slot.waitMs || 0
          if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs))
        } catch (e) {
          log('degraded: reserveSlot 失败', String(e.message).slice(0, 80))
        }
      }

      // 签名决策（只算，不发）
      let plan = null
      if (m.sign?.signPlan) {
        try { plan = m.sign.signPlan(url) } catch { /* ignore */ }
      }

      stats.calls++
      if (plan) { if (plan.headerAnti) stats.signed++; else stats.unsigned++ }
      return { allow: true, waitMs, plan }
    },

    /**
     * 每次响应后调用：错误归因 + 记账
     * @param {string} url
     * @param {object} json  平台返回体
     * @returns {Promise<{ failureKind: string, ec: number|null, retryable: boolean }>}
     */
    async afterCall(url, json, httpStatus) {
      const m = await mods()
      const ec = Number(json?.error_code ?? json?.errorCode ?? 0)
      const success = json?.success === true || ec === 1000000
      const errText = String(json?.error_msg ?? json?.errorMsg ?? json?.msg ?? '').trim()

      if (success) {
        stats.ok++
        try { m.antiban?.recordResult?.(shopKey, 'ok') } catch { /* ignore */ }
        return { failureKind: '', ec: null, retryable: false }
      }

      let failureKind = 'api_error'
      try {
        if (m.err?.normalize) failureKind = m.err.normalize({ ec, json }, '').failureKind || 'api_error'
      } catch { /* ignore */ }

      let retryable = false
      // ★ 2026-11-09：**网关限流优先判定**
      //   实测：连续打推广域接口会得到 HTTP 429 + body {"error_code":40001,"error_msg":""}。
      //   那是 edge 层限流，**不是权限问题** —— 但因为 ec=40001，旧逻辑会记成
      //   session 失效 → needRelogin=true → 账号被误判掉登录，闸门直接拦死。
      //   判据：HTTP 429/430，或 40001 但**错误文案为空**（真权限错误一定带文案）。
      const gatewayThrottle = httpStatus === 429 || httpStatus === 430
        || (ec === 40001 && errText === '')
      if (gatewayThrottle) {
        stats.rateLimit++
        try { m.antiban?.recordResult?.(shopKey, 'rateLimit') } catch { /* ignore */ }
        return { failureKind: 'rate_limit', ec, retryable: true }
      }

      // ★ 2026-11-05 新增：54003 = 安全验证未通过、暂时无法登录。
      //   与 43001/40001 的本质区别：**重扫码无效**，只能等。
      //   这里必须最先拦，且 retryable=false —— 任何自动重试都会延长封禁。
      //   ⚠️ 该码语义来自需求方描述，本项目日志尚未出现真实样本（全项目 grep 0 次）。
      if (ec === 54003) {
        stats.securityBlocked = (stats.securityBlocked || 0) + 1
        try { m.antiban?.recordResult?.(shopKey, 'session') } catch { /* ignore */ }
        // 直接写长冷却（默认 24h）：宁可停号一天，也不要反复撞
        try { m.risk?.markCooldown?.(shopKey, 54003, '54003 安全验证未通过（重扫无效，需等待）') } catch { /* ignore */ }
        return { failureKind: 'security_blocked', ec, retryable: false, mustStopAccount: true }
      }
      if (ec === 54001) {
        stats.captcha++
        // 54001 可自愈：清 token → 重放（由调用方决定，闸门只记账 + 允许重试一次）
        retryable = true
        try { m.antiban?.recordResult?.(shopKey, 'captcha') } catch { /* ignore */ }
        try { m.risk?.markCooldown?.(shopKey, 54001, '54001 风控') } catch { /* ignore */ }
      } else if (ec === 40002 || ec === 100001) {
        stats.rateLimit++
        try { m.antiban?.recordResult?.(shopKey, 'rateLimit') } catch { /* ignore */ }
        try { m.risk?.markCooldown?.(shopKey, ec, `${ec} 频控`) } catch { /* ignore */ }
      } else if (ec === 43001 || ec === 40001) {
        stats.session++
        try { m.antiban?.recordResult?.(shopKey, 'session') } catch { /* ignore */ }
      } else {
        stats.other++
      }

      return { failureKind, ec, retryable }
    },

    /** 心跳（长任务，防止锁被判僵尸） */
    startHeartbeat(ms = 180_000) {
      if (!locked || hb) return
      hb = setInterval(() => {
        try { _risk?.heartbeatAccountLock?.(shopKey, skill) } catch { /* ignore */ }
      }, ms)
      if (hb.unref) hb.unref()
    },

    /** 收尾：停心跳 + 放锁 + 打印汇总 */
    async close() {
      if (hb) { clearInterval(hb); hb = null }
      if (progress) { clearInterval(progress); progress = null }
      if (locked) { try { _risk?.releaseAccountLock?.(shopKey) } catch { /* ignore */ } }
      // ★ 2026-11-19：正常收尾也要摘掉进程级兜底释放钩子，避免误删后来者的锁
      if (exitRelease) { try { process.removeListener('exit', exitRelease); } catch { /* ignore */ } }
      // ★ 2026-11-05：记录关闭时刻，供下一次 openTask 做「不背靠背」检查（红线③闭环）
      if (shopKey && !blocked) { try { markProfileClosed(shopKey) } catch { /* ignore */ } }
      const ms = Date.now() - t0
      if (stats.calls > 0 || blocked) {
        log(`${skill} 结束: ${stats.calls} 次调用 / ok ${stats.ok} / 54001 ${stats.captcha} / 限流 ${stats.rateLimit} / 会话 ${stats.session}${stats.securityBlocked ? ' / 54003 ' + stats.securityBlocked : ''} / 耗时 ${(ms / 1000).toFixed(1)}s${blocked ? ` [被拦: ${reason}]` : ''}`)
      }
    },
  }
  // ★ 2026-11-19：守卫一建好就自动挂进度心跳（未拦截时）。
  //   所有 pdd-* 技能都走 openTask，因此这里挂一次即可覆盖全部技能的长流程，
  //   无需逐个改脚本。技能里若再显式调用 guard.startProgress() 也不会重复（幂等）。
  if (autoProgress) startProgress()

  return guard
}

/**
 * 给「已有自己请求层」的技能用的轻量版：只做准入 + 记账，不管请求
 * 适合 pdd-activity / pdd-chance / pdd-promo / pdd-video 这类在页面里 hook 的
 */
export async function guardOnly(skill, shopKey, opts = {}) {
  return openTask(skill, shopKey, opts)
}


/**
 * ══════════════════════════════════════════════════════════════════
 * 验证码闭环（2026-11-05 接入）
 * ══════════════════════════════════════════════════════════════════
 * pdd-captcha-gate.mjs 是一个完整闭环（检测→诊断→求解→拿票→重放），
 * 但在此之前**没有任何调用方** —— 595 行代码一直闲置。
 *
 * 这里把它接进闸门：遇到 54001 时可以调 guard.solveCaptcha(page)。
 * 注意：能自动过的题型有限（实测 type=22 可靠），过不了就返回 needHuman。
 */
export async function solveCaptcha(page, shopKey, opts = {}) {
  try {
    const gate = await load('pdd-captcha-gate.mjs')
    if (!gate?.ensurePassed) return { ok: false, reason: 'captcha-gate 不可用' }
    return await gate.ensurePassed(page, shopKey, opts)
  } catch (e) {
    return { ok: false, reason: String(e?.message || e).slice(0, 120) }
  }
}

export default { openTask, withPddGuard, guardOnly, guardHealth, solveCaptcha }
