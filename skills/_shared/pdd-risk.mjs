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

/** 频控错误码 → 基础冷却时长（ms） */
const RISK_CODES = {
  54001: 60 * 60 * 1000,        // 操作太过频繁 → 1 小时
  100001: 2 * 60 * 60 * 1000,   // 当前请求频繁，请2小时后重试 → 2 小时
  2000000: 30 * 60 * 1000,      // 网络繁忙，请不要频繁操作 → 30 分钟
  600001: 5 * 60 * 1000,        // 编辑不存在 → 短冷却（可能是参数问题）
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
  // 统计 24h 内累计命中次数（hitCount + 历史 hits）
  const hits = (prev?.hits || []).filter(t => now - t < 24 * 3600 * 1000)
  hits.push(now)
  const mult = backoffMultiplier(hits.length)
  const ms = Math.min(base * mult, 24 * 3600 * 1000)   // 封顶 24 小时
  cd[shopKey] = {
    until: now + ms,
    code,
    reason: extraReason || `命中频控 code=${code}`,
    hits,
    baseMs: base,
    multiplier: mult,
  }
  writeCooldown(cd)
  console.warn(`[pdd-risk] ${shopKey} 进入冷却 ${Math.round(ms / 60000)} 分钟`
    + `（code=${code}，基础 ${Math.round(base / 60000)} 分钟 × ${mult} 倍，24h 内第 ${hits.length} 次命中）`)
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
function writeCaptchaStore(d) {
  try {
    fs.mkdirSync(path.dirname(CAPTCHA_FILE), { recursive: true })
    fs.writeFileSync(CAPTCHA_FILE, JSON.stringify(d, null, 1), 'utf8')
  } catch { /* ignore */ }
}

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
  if (rec.statDate !== today) { rec.statDate = today; rec.passCount = 0 }
  rec.passCount = (rec.passCount || 0) + 1
  rec.lastPassAt = Date.now()
  rec.lastPassVia = via
  store[shopKey] = rec
  writeCaptchaStore(store)
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
    const ms = Array.from(document.querySelectorAll('[class*="Modal"], [class*="modal"], [class*="MDL"], [class*="Dialog"], [class*="captcha"], [class*="Captcha"], [class*="verify"], [class*="Verify"]'))
      .filter(m => { const r = m.getBoundingClientRect(); return r.width > 200 && r.height > 150 })
    return ms.some(m => /滑块|拼图|安全验证|向右/.test((m.innerText || '').slice(0, 60)))
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
  const { execSync } = await import('node:child_process')
  const solver = path.join(HERE, 'pdd-slider-solver.mjs')
  if (!fs.existsSync(solver)) return { ok: false, text: '滑块求解器不存在（pdd-slider-solver.mjs）' }
  const args = ['--shop', shopKey]
  if (opts.dryRun) args.push('--dry-run')
  try {
    const out = execSync(`node "${solver}" ${args.join(' ')}`, {
      encoding: 'utf8', timeout: opts.timeoutMs ?? 180000, maxBuffer: 8 * 1024 * 1024,
    })
    const line = String(out).split('\n').find(l => l.startsWith('__DSAGENT_RESULT__')) || ''
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
        console.warn('[pdd-risk] 检测到滑块遮罩且无通行证，尝试自动过滑块...')
        const solved = await autoSolveSlider(shopKey, page)
        if (!solved.ok) {
          const err = new Error(`RISK_SLIDER_UNSOLVED`)
          err.riskCode = 54001
          err.riskMsg = `滑块自动过失败：${solved.text}`
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
      } else {
        // 没拿到 token → 真的需要过滑块
        console.warn('[pdd-risk] 54001 但响应无 verifyAuthToken')
      }
    }

    markCooldown(shopKey, code)
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
