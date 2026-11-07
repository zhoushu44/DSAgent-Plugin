/**
 * pdd-captcha-gate.mjs —— 验证码总闸（底座层）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么要有这个文件
 * ══════════════════════════════════════════════════════════════════
 * 在它之前，验证码能力是「散装」的：
 *   · pdd-slider-solver.mjs  只管拖（不知道 54001 从哪来、拖完 token 在哪）
 *   · pdd-risk.mjs           只管存 token / 冷却记账
 *   · lib/pdd-captcha.js     只管页面内自愈（不清窗口，也不判断题型）
 *   · 各技能脚本             各自写「检测到验证码 → sleep 900 秒 → 人工」
 *
 * 结果就是：54001 一旦发生，只能干等。这个文件把「检测 → 诊断 → 求解 →
 * 拿票 → 重放」串成一条闭环，所有技能只调一个函数。
 *
 * ══════════════════════════════════════════════════════════════════
 * 关键机制（全部来自 msfe / _app 源码，不是猜的）
 * ══════════════════════════════════════════════════════════════════
 *
 * ① 为什么必须手动派发 FLOATING_CAPTCHA
 *
 *   弹窗不是「收到 54001 就自己弹」的，而是 msfe 的 fetch-plugin-captcha
 *     onResponse 里判断 errorCode===54001 后 dispatchEvent。
 *   而技能脚本用 page.evaluate(fetch(...)) 发请求 —— **绕过了整个插件链**
 *   （已在 commons 302KB / app 2.1MB 里确认 window.fetch 零处改写，
 *     mms 是模块内自建请求层），所以：
 *
 *       我们自己的 54001 → 插件根本没看见 → 弹窗永远不会出现
 *
 *   唯一能让弹窗出现的方式，是复刻插件那 4 行（_app.decoded.js @1881029）：
 *
 *       i = { verifyAuthToken: o, captchaRetry: e, captchaCallback: gt }
 *       var a = yt("FLOATING_CAPTCHA")      // new Event(...)
 *       Object.assign(a, i)
 *       window.dispatchEvent(a)
 *
 *   本文件 triggerDialog() 做的就是这件事。
 *
 * ② 票（VerifyAuthToken）在哪取
 *
 *   SDK 通过验证后走 `gt = function(t){ document.cookie = "msfe-pc-cookie-captcha-token=" + ... }`
 *   TTL 600000ms。所以**唯一权威判据是 cookie**，不是弹窗消失、也不是返回码。
 *   弹窗消失也可能是「被踢到登录页」或「平台换题型」。
 *
 * ③ 为什么重放要手动加头
 *
 *   插件的 beforeSend 会读 cookie 塞进 `VerifyAuthToken` 头；
 *   我们裸 fetch 拿不到这层，必须自己读 cookie 再写头。
 *   漏这一行 = 票白拿（详见 2026-11-05 纪要）。
 *
 * ══════════════════════════════════════════════════════════════════
 * 用法（技能侧只需要这两行）
 * ══════════════════════════════════════════════════════════════════
 *
 *   import { withCaptchaGate } from '../_shared/pdd-captcha-gate.mjs'
 *
 *   const g = await withCaptchaGate(page, shopKey, {
 *     captchaOptions: { maxAttempts: 2 },
 *   })
 *   const r = await g.post(url, body)      // 54001 自动过验证码 + 重放
 *   // r.data / r.solved / r.gaveUp
 *
 * 或只要一次性能力：
 *
 *   await ensurePassed(page, shopKey, { verifyAuthToken })   // 弹窗→诊断→求解→拿票
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

const COOKIE_KEY = 'msfe-pc-cookie-captcha-token'
const STATS_FILE = path.join(homedir(), '.dsh', 'pdd-captcha-gate-stats.json')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ── 统计落盘（跨进程，用于判断「这个号今天已经过几次」）── */
function readStats() {
  try { return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) || {} } catch { return {} }
}
function bumpStat(shopKey, field, payload = {}) {
  try {
    const all = readStats()
    const day = new Date().toISOString().slice(0, 10)
    const rec = (all[shopKey] && all[shopKey].date === day) ? all[shopKey] : { date: day, solved: 0, failed: 0, diagnoseFatal: 0 }
    rec[field] = (rec[field] || 0) + 1
    rec.lastAt = Date.now()
    if (payload.reason) rec.lastReason = String(payload.reason).slice(0, 200)
    all[shopKey] = rec
    fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true })
    fs.writeFileSync(STATS_FILE, JSON.stringify(all, null, 1), 'utf8')
  } catch { /* 统计失败不影响业务 */ }
}

/** 读今日统计 */
export function getGateStats(shopKey) {
  const all = readStats()
  const day = new Date().toISOString().slice(0, 10)
  return (all[shopKey] && all[shopKey].date === day) ? all[shopKey] : { date: day, solved: 0, failed: 0, diagnoseFatal: 0 }
}

/* ══════════════════════════════════════════════════════════════════
 * Cookie 票
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 从页面 cookie 读验证票。
 * @returns {Promise<{token:string, len:number}|null>}
 */
export async function readToken(page) {
  try {
    const v = await page.evaluate((k) => {
      const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'))
      return m ? decodeURIComponent(m[1]) : ''
    }, COOKIE_KEY)
    return v ? { token: v, len: v.length } : null
  } catch { return null }
}

/** 清票（官方：命中 54001 且带过票时先清，避免拿废票空转） */
export async function clearToken(page) {
  try {
    await page.evaluate((k) => {
      document.cookie = k + '=;path=/;expires=' + new Date(Date.now() - 1000).toUTCString()
    }, COOKIE_KEY)
    return true
  } catch { return false }
}

/**
 * 轮询等票出现（SDK 在 user_verify 成功后才写，有几百 ms 延迟）。
 */
async function waitToken(page, timeoutMs = 8000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const t = await readToken(page)
    if (t) return t
    await sleep(400)
  }
  return null
}

/* ══════════════════════════════════════════════════════════════════
 * 弹窗控制
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 手动派发 FLOATING_CAPTCHA，让页面挂载验证码弹窗。
 *
 * 复刻 msfe fetch-plugin-captcha.onResponse 的那 4 行（见文件头 §①）。
 * 没有这一步，用裸 fetch 打出的 54001 **永远不会弹窗**。
 *
 * ══════════════════════════════════════════════════════════════════
 * ⚠️ 重要限制（2026-11-05 实测证明）
 * ══════════════════════════════════════════════════════════════════
 * **verifyAuthToken 必须是服务端真实签发的，伪造的必然失败。**
 *
 * 证据链：
 *   ① 弹窗挂载后立刻调 preCheck()：
 *        getPreCheck() → POST /api/phantom/vc_pre_ck_b { anti_content, verify_auth_token, sdk_type:3 }
 *   ② 源码分支（_app.decoded.js@1823938）：
 *        c = salt
 *        c ? (init(密钥), refreshCaptcha())     // 有 salt → 渲染图片
 *          : (quit(), toast(errMsg))            // 无 salt → **立刻关闭弹窗**
 *   ③ 实测两种 token 的结果（账号 4bd51472，crawlerInfo 有效 len=460）：
 *        空 token   → {"error_code":50000, "server_time":...}   无 salt
 *        假 token   → {"error_code":50000, "server_time":...}   无 salt
 *
 *   → **所以「手动派发模拟 54001」这条路走不通**。
 *     服务端不认识这个 token，preCheck 直接拒，弹窗一闪就关，
 *     看起来像"组件没挂载"，其实是"token 无效被 quit 了"。
 *
 * 结论：只能等真实 54001（它带回服务端签发的 verifyAuthToken）再派发。
 *       本函数的 verifyAuthToken 参数**不要传假值**，否则只会浪费一次
 *       preCheck 调用并留下 error_code:50000 的记录。
 *
 * @param {string} verifyAuthToken 54001 响应 result.verifyAuthToken（必须真实）
 * @returns {Promise<boolean>} 是否派发成功（不代表弹窗已出）
 */
export async function triggerDialog(page, verifyAuthToken = '') {
  try {
    return await page.evaluate((vt) => {
      try {
        const make = (name) => (typeof Event === 'function'
          ? new Event(name)
          : (() => { const e = document.createEvent('Event'); e.initEvent(name, true, true); return e })())
        const ev = make('FLOATING_CAPTCHA')
        Object.assign(ev, {
          verifyAuthToken: vt,
          captchaRetry: function () {},
          captchaCallback: function () {},
        })
        window.dispatchEvent(ev)
        return true
      } catch { return false }
    }, verifyAuthToken)
  } catch { return false }
}

/** 弹窗是否挂载（用真实锚点，与 solver 一致） */
export async function hasDialog(page) {
  try {
    return await page.evaluate(() => !!document.querySelector(
      '#slide-captcha-dialog, .captcha-wrapper__slider, .captcha-wrapper'
    ))
  } catch { return false }
}

/**
 * 等弹窗出现。会周期性补派发事件（有些页面挂载有延迟）。
 */
export async function waitDialog(page, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 15000
  const retriggerEveryMs = opts.retriggerEveryMs ?? 3000
  const vt = opts.verifyAuthToken || ''
  const t0 = Date.now()
  let lastTrigger = 0
  while (Date.now() - t0 < timeoutMs) {
    if (await hasDialog(page)) return true
    if (Date.now() - lastTrigger > retriggerEveryMs) {
      lastTrigger = Date.now()
      await triggerDialog(page, vt)
    }
    await sleep(600)
  }
  return await hasDialog(page)
}

/** 弹窗是否已消失 */
export async function dialogGone(page) {
  return !(await hasDialog(page))
}

/* ══════════════════════════════════════════════════════════════════
 * preCheck 预检：这个 token 能不能拿到 salt？
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 直接调 `/api/phantom/vc_pre_ck_b`，判断 verifyAuthToken 是否被服务端认可。
 *
 * 为什么要在派发弹窗**之前**做这件事：
 *   弹窗挂载后第一件事就是 preCheck，拿不到 salt 会 `quit()` 立刻自关。
 *   先预检就能：
 *     · 拿到 server_time（后面 SDK 的 ts 要用）
 *     · 拿到 salt（AES 密钥协商要用，但弹窗内部也会自己调一次）
 *     · **提前判断 token 是真是假**，假的就别派发了，省一次无效 preCheck
 *
 * ⚠️ 本函数自身会消耗一次 vc_pre_ck_b 调用。真实 54001 之后调一次是安全的
 *    （官方弹窗自己也会调），但**不要拿假 token 反复试**。
 *
 * @param {object} page
 * @param {string} verifyAuthToken
 * @param {string} [antiContent] 可选：带 crawlerInfo 会提高成功率
 * @returns {Promise<{ok:boolean, salt?:string, server_time?:number, code?:number, reason?:string}>}
 */
export async function precheck(page, verifyAuthToken, antiContent = '') {
  try {
    const r = await page.evaluate(async (vt, anti) => {
      try {
        const resp = await fetch('https://mms.pinduoduo.com/api/phantom/vc_pre_ck_b', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            anti_content: anti,
            verify_auth_token: vt,
            sdk_type: 3,
            client_time: Date.now(),
          }),
          credentials: 'include',
        })
        const txt = await resp.text()
        let j = null
        try { j = JSON.parse(txt) } catch { /* ignore */ }
        return {
          status: resp.status,
          code: Number(j?.error_code ?? j?.errorCode ?? j?.code ?? 0),
          salt: j?.salt || '',
          server_time: j?.server_time || 0,
          raw: txt.slice(0, 160),
        }
      } catch (e) { return { err: String(e.message).slice(0, 120) } }
    }, verifyAuthToken, antiContent).catch((e) => ({ err: 'eval:' + String(e.message).slice(0, 100) }))

    if (r.err) return { ok: false, reason: r.err }
    if (r.salt) {
      return { ok: true, salt: r.salt, server_time: r.server_time, code: r.code }
    }
    return {
      ok: false,
      code: r.code,
      server_time: r.server_time,
      reason: r.code === 50000
        ? '50000 = token 不被服务端认可（伪造或已过期）'
        : `无 salt（code=${r.code}）raw=${r.raw}`,
    }
  } catch (e) {
    return { ok: false, reason: String(e.message).slice(0, 120) }
  }
}

/* ══════════════════════════════════════════════════════════════════
 * 主流程：诊断 → 求解 → 拿票
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 一次完整的「过验证码」。
 *
 * @param {object} page puppeteer page（已打开，当前页有 mms 域）
 * @param {string} shopKey
 * @param {object} opts
 * @param {string} [opts.verifyAuthToken] 54001 响应里的挑战票（用于派发弹窗）
 * @param {number} [opts.maxAttempts=2]   滑块最多试几轮（>2 风险高）
 * @param {boolean}[opts.dryRun=false]    只诊断不拖
 * @param {boolean}[opts.skipDiagnose=false]
 * @param {Function}[opts.log]            日志回调
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   via: 'cookie'|'solved'|'dry-run'|'diagnose-fatal'|'no-dialog'|'solve-failed',
 *   token?: string,
 *   findings?: Array, solve?: object, stages: string[], error?: string
 * }>}
 */
export async function ensurePassed(page, shopKey, opts = {}) {
  const log = opts.log || ((...a) => console.log('[captcha-gate]', ...a))
  const stages = []
  const t0 = Date.now()

  // ── ① 已有票直接返回（10 分钟内免验）──
  const existing = await readToken(page)
  if (existing && existing.len > 8) {
    stages.push(`已有有效票（len=${existing.len}）`)
    log(`已有票 len=${existing.len}，跳过`)
    return { ok: true, via: 'cookie', token: existing.token, stages }
  }

  // ── ② 预检 token（决定能不能派发弹窗）──
  //
  // ★ 2026-11-05 实测：假 token 会让 vc_pre_ck_b 返回 error_code 50000（无 salt），
  //   弹窗挂载后 preCheck 拿不到 salt 就 quit()，一闪就关。
  //   所以**先预检，再决定要不要派发**，而不是盲目派发等 20 秒。
  let precheckResult = null
  if (opts.verifyAuthToken) {
    precheckResult = await precheck(page, opts.verifyAuthToken, opts.antiContent || '')
    if (precheckResult.ok) {
      stages.push(`预检通过（salt ${precheckResult.salt.length} 位）`)
      log(`预检通过：salt=${precheckResult.salt.length} 位，server_time=${precheckResult.server_time}`)
    } else {
      stages.push(`预检失败：${precheckResult.reason}`)
      log(`⚠️ 预检失败：${precheckResult.reason}`)
      if (opts.strictPrecheck !== false) {
        // token 不被认可 → 派发弹窗也没用（会被 quit），直接返回
        return {
          ok: false, via: 'token-rejected', findings: [], stages,
          error: `verifyAuthToken 不被服务端认可：${precheckResult.reason}`,
          precheck: precheckResult,
        }
      }
      log('   （strictPrecheck=false，仍尝试派发）')
    }
  } else {
    stages.push('无 challenge token（可能是已有弹窗）')
  }

  // ── ③ 等弹窗（必要时手动派发）──
  const appeared = await waitDialog(page, {
    timeoutMs: opts.dialogTimeoutMs ?? 15000,
    verifyAuthToken: opts.verifyAuthToken,
  })
  if (!appeared) {
    stages.push('弹窗未出现')
    log('❌ 弹窗未出现（54001 可能没带回 verifyAuthToken，或页面已被踢）')
    return { ok: false, via: 'no-dialog', stages, error: '弹窗未出现' }
  }
  stages.push('弹窗已出现')

  // ── ③ 诊断（零风险，先确认结构对不对）──
  let findings = []
  if (!opts.skipDiagnose) {
    try {
      const { diagnoseSlider } = await import('./pdd-slider-solver.mjs')
      const d = await diagnoseSlider(page)
      findings = d.findings || []
      const fatals = findings.filter((f) => f.level === 'fatal')
      for (const f of findings) log(`  [${f.level}] ${f.msg}`)
      stages.push(`诊断：${fatals.length} fatal`)
      if (fatals.length) {
        bumpStat(shopKey, 'diagnoseFatal', { reason: fatals[0].msg })
        return {
          ok: false, via: 'diagnose-fatal', findings, stages,
          error: fatals.map((f) => f.msg).join(' | ').slice(0, 300),
        }
      }
    } catch (e) {
      log('诊断异常（继续求解）：', String(e.message).slice(0, 100))
    }
  }

  if (opts.dryRun) {
    stages.push('dry-run 到此为止')
    return { ok: true, via: 'dry-run', findings, stages }
  }

  // ── ④ 求解（内部已含：等图 load / 刷新复位门闩 / 位移断言）──
  let solve = null
  try {
    const { solveSliderInPage } = await import('./pdd-slider-solver.mjs')
    solve = await solveSliderInPage(page, shopKey, {
      maxAttempts: opts.maxAttempts ?? 2,
      dryRun: false,
      log,
    })
    stages.push(`求解：${solve?.ok ? '成功' : '失败'}`)
    log(`求解结果：${solve?.ok ? '✅' : '❌'} ${solve?.text || ''}`)
  } catch (e) {
    stages.push('求解异常')
    return { ok: false, via: 'solve-failed', findings, stages, error: String(e.message).slice(0, 200) }
  }

  // ── ⑤ 拿票（权威判据：cookie）──
  const token = await waitToken(page, opts.tokenTimeoutMs ?? 8000)
  if (token) {
    try {
      const risk = await import('./pdd-risk.mjs')
      risk.recordCaptchaPass?.(shopKey, 'auto')
      risk.saveCaptchaToken?.(shopKey, token.token)
    } catch { /* ignore */ }
    bumpStat(shopKey, 'solved', { reason: solve?.text })
    stages.push(`拿到票 len=${token.len}`)
    log(`✅ 通过并拿到票（len=${token.len}，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`)
    return { ok: true, via: 'solved', token: token.token, findings, solve, stages }
  }

  // 弹窗消失但没票 → 多半是被踢到登录页 / 平台换题型
  const gone = await dialogGone(page)
  bumpStat(shopKey, 'failed', { reason: solve?.text })
  stages.push(`无票（弹窗${gone ? '已消失' : '仍在'}）`)
  return {
    ok: false, via: 'solve-failed', findings, solve, stages,
    error: gone ? '弹窗消失但无票（可能被踢到登录页或换题型）' : '弹窗仍在且无票',
  }
}

/* ══════════════════════════════════════════════════════════════════
 * 带闸的请求器
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 创建一个「54001 自动过验证码并重放」的请求器。
 *
 * 典型用法：
 *   const g = await withCaptchaGate(page, shopKey)
 *   const r = await g.post(url, body)     // 内部处理 54001
 *
 * 语义（对齐官方 SDK 的 fetch-plugin-captcha）：
 *   · 54001 + 已有票 → 直接重放（票可能刚被别人写进来）
 *   · 54001 + 无票   → 派发弹窗 → 诊断 → 求解 → 拿票 → 带头发重放
 *   · 54003          → 立刻放弃（重扫无效，必须停号）
 *   · 43001/40001    → 立即返回，不重试（会话问题，重试只会更难登录）
 *
 * @param {object} page
 * @param {string} shopKey
 * @param {object} opts  { baseUrl, maxRetry=1, maxAttempts=2, log, onRisk }
 */
export async function withCaptchaGate(page, shopKey, opts = {}) {
  const log = opts.log || ((...a) => console.log('[captcha-gate]', ...a))
  const maxRetry = opts.maxRetry ?? 1
  const baseUrl = opts.baseUrl || 'https://mms.pinduoduo.com'
  const events = []

  /** 底层一次请求（页面身份，带 cookie + 可选票头） */
  async function rawPost(url, body, headers = {}) {
    const full = /^https?:/i.test(url) ? url : baseUrl + url
    return await page.evaluate(async (u, b, h) => {
      try {
        const resp = await fetch(u, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...h },
          body: JSON.stringify(b),
          credentials: 'include',
        })
        let data = null
        try { data = await resp.json() } catch { data = null }
        return { status: resp.status, data }
      } catch (e) {
        return { err: String((e && e.message) || e).slice(0, 200) }
      }
    }, full, body, headers).catch((e) => ({ err: 'eval:' + String(e.message).slice(0, 150) }))
  }

  /**
   * POST + 54001 自动过闸。
   * @returns {{ data:any, status:number, solved?:boolean, gaveUp?:boolean, error?:string, gateStages?:string[] }}
   */
  async function post(url, body, label = '') {
    let attempt = 0
    let solvedThisCall = false

    for (;;) {
      // 每次请求前：有票就带头（关键！裸 fetch 不会自动加）
      const tok = await readToken(page)
      const headers = tok ? { VerifyAuthToken: tok.token } : {}

      const r = await rawPost(url, body, headers)
      const ec = Number(r?.data?.error_code ?? r?.data?.errorCode ?? 0)

      if (label) {
        log(`  ${label} → status=${r.status} success=${r.data?.success} ${r.data?.error_msg || r.err || ''}`)
      }

      // ── 54003：立刻停，绝不重试 ──
      if (ec === 54003) {
        events.push({ url, ec, kind: 'security_blocked' })
        try {
          const risk = await import('./pdd-risk.mjs')
          risk.markCooldown?.(shopKey, 54003, '54003 安全验证未通过（重扫无效）')
        } catch { /* ignore */ }
        log('🛑 54003 = 安全验证未通过，停止（重扫无效，需等待）')
        return { ...r, gaveUp: true, error: '54003 security_blocked' }
      }

      // ── 43001 / 40001：会话问题，不重试 ──
      if (ec === 43001 || ec === 40001) {
        events.push({ url, ec, kind: 'session' })
        log(`🛑 ${ec} = 会话/登录失效，不重试（请重扫登录）`)
        return { ...r, gaveUp: true, error: `${ec} session` }
      }

      // ── 54001：过闸 ──
      if (ec === 54001) {
        events.push({ url, ec, kind: 'captcha' })
        const challenge = r?.data?.result?.verifyAuthToken || ''

        if (attempt >= maxRetry) {
          log(`❌ 54001 已达最大重试 ${maxRetry} 次，放弃`)
          return { ...r, solved: solvedThisCall, gaveUp: true, error: '54001 max retry' }
        }
        attempt++

        log(`⚠️ 54001 命中风控 → 自动过验证码（第 ${attempt} 次）`)

        // 有票还 54001 → 先清废票（官方语义：清完再读）
        if (headers.VerifyAuthToken) await clearToken(page)

        const res = await ensurePassed(page, shopKey, {
          verifyAuthToken: challenge,
          maxAttempts: opts.maxAttempts ?? 2,
          log,
        })

        if (!res.ok) {
          log(`❌ 过验证码失败：${res.via} ${res.error || ''}`)
          return { ...r, solved: false, gaveUp: true, error: `captcha ${res.via}`, gateStages: res.stages }
        }
        solvedThisCall = true
        log(`✅ 验证码已过（${res.via}），重放原请求…`)
        continue   // 重放
      }

      // ── 其它：原样返回 ──
      return { ...r, solved: solvedThisCall }
    }
  }

  return {
    post,
    readToken: () => readToken(page),
    ensurePassed: (o = {}) => ensurePassed(page, shopKey, { ...opts, ...o, log }),
    stats: () => getGateStats(shopKey),
    events,
  }
}

/* ══════════════════════════════════════════════════════════════════
 * 自检（import 时不执行）
 * ══════════════════════════════════════════════════════════════════ */
const __isMain = (() => {
  try {
    if (!process.argv[1]) return false
    // Windows 下 import.meta.url 是 file:///E:/... （三斜杠），
    // 直接拼 file:// 会少一杠 → 永远不相等。用 pathToFileURL 才是对的。
    return import.meta.url === pathToFileURL(process.argv[1]).href
  } catch { return false }
})()

if (__isMain) {
  console.log('pdd-captcha-gate 自检')
  console.log('  导出：ensurePassed / withCaptchaGate / triggerDialog / waitDialog / hasDialog')
  console.log('        readToken / clearToken / getGateStats')
  console.log('  统计文件：', STATS_FILE)
  const s = getGateStats(process.argv[2] || '__selfcheck__')
  console.log('  今日统计：', JSON.stringify(s))
}
