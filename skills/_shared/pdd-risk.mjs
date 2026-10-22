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
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const COOL_FILE = path.join(homedir(), '.dsh', 'pdd-risk-cooldown.json')
const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 频控错误码 → 冷却时长（ms） */
const RISK_CODES = {
  54001: 60 * 60 * 1000,        // 操作太过频繁 → 1 小时
  100001: 2 * 60 * 60 * 1000,   // 当前请求频繁，请2小时后重试 → 2 小时
  2000000: 30 * 60 * 1000,      // 网络繁忙，请不要频繁操作 → 30 分钟
  600001: 5 * 60 * 1000,        // 编辑不存在 → 短冷却（可能是参数问题）
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
  return { cooling: true, remainMs: rec.until - now, reason: rec.reason || '' }
}

/** 记录冷却（按错误码决定时长） */
export function markCooldown(shopKey, code, extraReason) {
  const ms = RISK_CODES[code]
  if (!ms) return
  const cd = readCooldown()
  cd[shopKey] = { until: Date.now() + ms, code, reason: extraReason || `命中频控 code=${code}` }
  writeCooldown(cd)
  console.warn(`[pdd-risk] ${shopKey} 进入冷却 ${Math.round(ms / 60000)} 分钟（code=${code}）`)
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
        return await mod.solveSliderInPage(page, shopKey, opts)
      }
      console.error('[pdd-risk] solver 无 solveSliderInPage 导出，落到子进程')
    } catch (e) { console.error('[pdd-risk] 内联求解异常:', e.message) }
  }
  // ② 子进程
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
  // ① 调用前检测滑块
  if (autoSlider && page && await detectSlider(page)) {
    console.warn('[pdd-risk] 检测到滑块遮罩，尝试自动过滑块...')
    const solved = await autoSolveSlider(shopKey)
    if (!solved.ok) {
      const err = new Error(`RISK_SLIDER_UNSOLVED`)
      err.riskCode = 54001
      err.riskMsg = `滑块自动过失败：${solved.text}`
      throw err
    }
    console.warn(`[pdd-risk] 滑块已过：${solved.text}`)
    await new Promise(r => setTimeout(r, 2000))
  }
  // ② 实际调用
  const r = await fn()
  // ③ 调用后识别频控码
  const code = detectRiskCode(r)
  if (code) {
    markCooldown(shopKey, code)
    const err = new Error(`RISK_${code}`)
    err.riskCode = code
    err.riskMsg = r?.error_msg || r?.errorMsg || ''
    err.riskData = r
    throw err
  }
  return r
}
