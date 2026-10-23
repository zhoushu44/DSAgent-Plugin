/**
 * 拼多多滑块自动过 v3 —— 完整版
 *
 * 链路（2026-10-22 实测跑通）：
 *   ① 打开商品列表 → CDP 真实鼠标点「发布新商品」→ 触发滑块遮罩
 *   ② 从 DOM 拿完整滑块 dataURL（背景图 272x130 + 滑块图 49x130）
 *   ③ yydsocr type_id=2002（双图滑块）→ 缺口 X 坐标
 *   ④ CDP Input.dispatchMouseEvent 人类化轨迹拖动（加速→减速→过冲→回退→微抖）
 *   ⑤ 检测遮罩消失 = 验证通过
 *
 * 用法：
 *   node scripts/pdd-slider-solver.mjs --shop <shopKey> [--dry-run] [--type-id 2002]
 */
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'

const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')

/**
 * 是否作为「被 import 的模块」运行（而非直接 node 执行）。
 * pdd-risk.mjs 的 autoSolveSlider(shopKey, page) 会 import 本文件的 solveSliderInPage；
 * 若不做这个判断，import 时会把主 IIFE（自开浏览器）也跑一遍 → 子进程 + profile 锁冲突。
 */
const IS_IMPORTED = (() => {
  try {
    const url = import.meta.url
    const argv1 = process.argv[1] ? `file://${process.argv[1].replace(/\\/g, '/')}` : ''
    return argv1 !== url && !argv1.endsWith('pdd-slider-solver.mjs')
  } catch { return false }
})()

const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined }
const emit = (obj) => { process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n') }

const DRY = process.argv.includes('--dry-run')
const TYPE_ID = argOf('type-id') || '2002'
const OUT = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/pdd-re'

// yydsocr 配置
const OCR_ENDPOINT = 'https://www.yydsocr.com/api/verify_api'
const OCR_KEY = 'RyDEDUcO3VDBPOrCMiN4aas7CHdIGZAaBrvPFC0gByJrs5IV'

/** yydsocr 识别滑块缺口（多类型降级重试） */
async function solveSlider(bgB64, slideB64) {
  // 候选方案：按优先级试（拼多多滑块是双图型，但不同风控等级可能只给单图）
  const candidates = []
  if (slideB64) {
    candidates.push({ name: '2002双图', body: { secret_key: OCR_KEY, type_id: '2002', background_image: bgB64, slide_image: slideB64 } })
    candidates.push({ name: '2005双图', body: { secret_key: OCR_KEY, type_id: '2005', background_image: bgB64, slide_image: slideB64 } })
    candidates.push({ name: '2006双图', body: { secret_key: OCR_KEY, type_id: '2006', background_image: bgB64, slide_image: slideB64 } })
  }
  candidates.push({ name: '2000单图', body: { secret_key: OCR_KEY, type_id: '2000', image: bgB64 } })
  candidates.push({ name: '2000单图+meta', body: { secret_key: OCR_KEY, type_id: '2000', image: bgB64, meta: 'True' } })

  let lastErr = null
  for (const c of candidates) {
    try {
      const resp = await fetch(OCR_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c.body),
      })
      const j = await resp.json().catch(() => null)
      if (j?.code === 200) {
        const x = parseInt(String(j.data?.data ?? j.data).replace(/[^\d]/g, ''), 10)
        if (Number.isFinite(x)) return { ok: true, x, recId: j.rec_id, via: c.name }
      }
      lastErr = { code: j?.code, msg: j?.err_msg, via: c.name }
      console.error(`[solver] ${c.name} 失败: code=${j?.code} ${j?.err_msg || ''}`)
    } catch (e) { lastErr = { code: -1, msg: e.message, via: c.name } }
    await new Promise(r => setTimeout(r, 600))   // 避免频率限制
  }
  return { ok: false, code: lastErr?.code, msg: lastErr?.msg, via: lastErr?.via }
}

/**
 * 生成人类化鼠标轨迹（2026-10-23 重写）
 *
 * ★ 旧版问题（17 次实测数据反推）：
 *   旧版用 easeOutQuad（1-(1-t)²），速度曲线「快→慢」：
 *     - 起始速度 260px/s（mousedown 后瞬间全速）  ← 典型机器特征
 *     - 峰值出现在前 5%，没有起步犹豫
 *   账号累计分低时平台只查位置，能过；累计分高后开始查轨迹，
 *   「瞬间全速」直接毙——这就是今天「滑块失败→踢会话」升级的原因。
 *
 * ★ 新版特征（对齐真人行为学）：
 *   ① 起步犹豫：mousedown 后停 100-250ms（真人 100% 有，旧版完全没有）
 *   ② 速度曲线「慢→快→慢」四段式：慢启动(抛物线) → 加速 → 匀速主体 → 缓入终点
 *   ③ 过冲 5-10px + 回退（真人过冲比旧版 2-5px 更大）
 *   ④ 中段随机停顿（8% 概率，模拟犹豫）+ 终点微抖 + Y 轴微小波动
 *
 * 实测对比（602→714，112px）：
 *   旧版：起始 260px/s，峰值 260px/s（前 5%），总 943ms，单调递减
 *   新版：起始   0px/s，峰值 ~432px/s（~20% 处），总 ~1114ms，慢→快→慢
 *
 * @param delay 单位 ms，仅第一步（起步犹豫）和随机停顿点带该字段
 */
function humanTrajectory(startX, targetX, startY) {
  const dist = targetX - startX
  const absDist = Math.abs(dist)
  if (absDist < 1) return []
  const steps = []

  // ① 起步犹豫：真人按下后不会立刻移动（100-250ms）
  steps.push({ x: startX, y: startY + (Math.random() - 0.5) * 0.8, delay: 100 + Math.random() * 150 })

  // ② 四段式速度曲线
  const overshoot = (Math.random() * 5 + 5) * Math.sign(dist)   // 过冲 5~10px
  const n = Math.max(25, Math.min(90, Math.round(absDist / 3)))
  for (let i = 1; i <= n; i++) {
    const p = i / n
    let eased
    if (p < 0.15) {
      const q = p / 0.15
      eased = 0.5 * q * q                              // 慢启动：抛物线加速
    } else if (p < 0.6) {
      const q = (p - 0.15) / 0.45
      eased = 0.5 + 0.35 * q                           // 加速段：线性升到匀速
    } else if (p < 0.85) {
      const q = (p - 0.6) / 0.25
      eased = 0.85 + 0.10 * q                          // 匀速主体
    } else {
      const q = (p - 0.85) / 0.15
      eased = 0.95 + 0.05 * q * q                      // 缓入终点
    }
    const x = startX + dist * eased
    const y = startY + (Math.random() - 0.5) * 1.2
    steps.push({ x, y })
    // 中段犹豫：只在中后段出现，概率 4%（真人通常 1-3 次停顿）
    if (p > 0.3 && p < 0.8 && Math.random() < 0.04) steps.push({ x, y, delay: 40 + Math.random() * 80 })
  }

  // ③ 过冲段
  const overX = targetX + overshoot
  steps.push({ x: overX, y: startY })
  // ④ 回退精确到位（3 步）
  for (let i = 1; i <= 3; i++) steps.push({ x: overX + (targetX - overX) * (i / 3), y: startY })
  // ⑤ 终点微抖动
  for (let i = 0; i < 3; i++) steps.push({ x: targetX + (Math.random() - 0.5) * 1.5, y: startY + (Math.random() - 0.5) * 1.5 })
  return steps
}

/**
 * 在**已打开的 page** 上跑滑块求解（不新起浏览器，避免 profile 锁冲突）。
 * 由 pdd-risk.mjs 的 autoSolveSlider(page) 调用。
 *
 * ★ 2026-10-23 增强：单次识别不可靠（yydsocr 偶发把两张图搞反，
 *   导致缺口 X=20 这种离谱值）。改为「识别 → 合理性校验 → 拖动 → 检测」
 *   最多 maxAttempts 轮。合理性标准：
 *     - 缺口 X 应在背景图宽的 25%~90% 之间（太靠左=没缺口，太靠右=贴边）
 *     - 若可疑，重新取图再识别（平台可能已刷新验证码）
 *
 * @param page puppeteer page（父进程已开的浏览器，当前页面应含滑块遮罩）
 * @param shopKey 账号 shopKey（仅用于日志）
 * @param opts {{ dryRun?: boolean, maxAttempts?: number }}
 * @returns Promise<{ ok, text, gapX?, targetX? }>
 */
export async function solveSliderInPage(page, shopKey, opts = {}) {
  const DRY = opts.dryRun === true
  const MAX = opts.maxAttempts ?? 3
  const safeEval = async (fn, arg) => {
    for (let i = 0; i < 15; i++) {
      for (const f of page.frames()) { try { return await f.evaluate(fn, arg) } catch { /* 换 */ } }
      await new Promise(r => setTimeout(r, 1500))
    }
    return null
  }
  const findSlider = () => safeEval(() => {
    const ms = Array.from(document.querySelectorAll('[class*="Modal"], [class*="modal"], [class*="MDL"], [class*="Dialog"]'))
      .filter(m => { const r = m.getBoundingClientRect(); return r.width > 200 && r.height > 150 })
    for (const m of ms) {
      if (!/滑块|拼图|向右|验证/.test((m.innerText || '').slice(0, 60))) continue
      const imgs = Array.from(m.querySelectorAll('img'))
        .map(el => { const b = el.getBoundingClientRect(); return { src: el.src || '', w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) } })
        .filter(o => /^data:image/.test(o.src) && o.w > 0)
      const handle = Array.from(m.querySelectorAll('.slide-button, [class*="slide-button"], [class*="slideButton"]'))
        .map(el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), w: Math.round(b.width), h: Math.round(b.height) } })
        .filter(o => o.w > 10)
      if (!imgs.length || !handle.length) continue
      return { imgs, handle, text: (m.innerText || '').replace(/\n/g, ' ').slice(0, 80) }
    }
    return null
  })
  const sliderGone = async () => !(await findSlider())

  /**
   * 主动刷新验证码（点滑块遮罩里的刷新按钮）。
   *
   * 为什么需要：实测发现失败后平台**不一定**自动换图——
   * 2026-10-23 日志里第 2、3 次识别返回同一个 262px，说明是同一张图，
   * 此时重拖必然再失败。必须主动刷新。
   *
   * 常见刷新入口（按优先级）：
   *   ① 遮罩内 class 含 refresh/reload/refresh-icon 的可点元素
   *   ② 右上角小图标（svg / i 标签）
   *   ③ 兜底：关闭遮罩重开（点遮罩外部 / 重新触发原操作）——成本高，暂不实现
   *
   * @returns {Promise<boolean>} 是否成功触发刷新
   */
  const refreshCaptcha = async () => {
    const clicked = await safeEval(() => {
      const ms = Array.from(document.querySelectorAll('[class*="Modal"], [class*="modal"], [class*="MDL"], [class*="Dialog"]'))
        .filter(m => { const r = m.getBoundingClientRect(); return r.width > 200 && r.height > 150 })
      for (const m of ms) {
        if (!/滑块|拼图|向右|验证/.test((m.innerText || '').slice(0, 60))) continue
        // ① 明确的刷新按钮
        const cands = Array.from(m.querySelectorAll('[class*="refresh" i], [class*="reload" i], [class*="close" i], [class*="shut" i]'))
          .filter(e => { const r = e.getBoundingClientRect(); return r.width > 8 && r.height > 8 && r.width < 60 && r.height < 60 })
        if (cands.length) {
          cands[0].click()
          return { via: 'refresh-btn', cls: String(cands[0].className).slice(0, 50) }
        }
        // ② 兜底：遮罩右上角的可点元素
        const mr = m.getBoundingClientRect()
        const corner = Array.from(m.querySelectorAll('i, svg, span, div'))
          .filter(e => { const r = e.getBoundingClientRect(); return r.width > 8 && r.height > 8 })
          .filter(e => { const r = e.getBoundingClientRect(); return r.x > mr.x + mr.width - 60 && r.y < mr.y + 60 })
        if (corner.length) { corner[0].click(); return { via: 'corner-icon' } }
      }
      return null
    })
    if (clicked) console.error(`[slider] 已点刷新（${clicked.via}${clicked.cls ? ' ' + clicked.cls : ''}）`)
    else console.error('[slider] 未找到刷新按钮（等待平台自动换图）')
    return !!clicked
  }

  // ★ 跨轮次状态：记录上一轮的图指纹和缺口 X，用于判断「验证码是否刷新」
  //   以及失败后该「重新取码」还是「修正位移」。
  let prevBgHash = ''
  let prevGapX = -1
  let prevTargetX = -1

  for (let attempt = 1; attempt <= MAX; attempt++) {
    const slider = await findSlider()
    if (!slider) return { ok: false, text: '当前页面未找到滑块（可能遮罩已消失）' }

    const bg = slider.imgs.find(i => i.w > 200) || slider.imgs[0]
    const blk = slider.imgs.find(i => i.w > 30 && i.w < 100)
    const handle = slider.handle[0]
    const bgB64 = bg.src.replace(/^data:image\/\w+;base64,/, '')
    const blkB64 = blk ? blk.src.replace(/^data:image\/\w+;base64,/, '') : null

    // ★ 图指纹：用 base64 长度 + 头尾各 64 字符做轻量哈希（整串 MD5 太慢）
    const bgHash = `${bgB64.length}:${bgB64.slice(0, 64)}:${bgB64.slice(-64)}`
    const imgRefreshed = bgHash !== prevBgHash
    console.error(`[slider] 第 ${attempt} 轮：验证码${imgRefreshed ? '已刷新' : '未刷新（同一张图）'}`)

    const solved = await solveSlider(bgB64, blkB64)
    if (!solved.ok) {
      if (attempt < MAX) { await refreshCaptcha(); await new Promise(r => setTimeout(r, 2000)); continue }
      return { ok: false, text: `识别失败：${solved.msg || `code=${solved.code}`}`, ocr: solved }
    }

    // ★ 合理性校验：缺口 X 应在背景宽 25%~90%
    const ratio = solved.x / bg.w
    const plausible = ratio >= 0.25 && ratio <= 0.90
    console.error(`[slider] 第 ${attempt} 次识别：缺口 X=${solved.x}px（图宽 ${bg.w}，${(ratio * 100).toFixed(1)}%）${plausible ? '✅合理' : '⚠️可疑'}`)

    // ★ 位移修正计算：
    //   两个独立判据，任一命中都要刷新验证码，不能用旧图重拖。
    //   判据A（图指纹）：base64 长度+头尾 64 字符，最可靠
    //   判据B（位移差）：|ΔgapX| < 2 说明缺口位置没动
    //   实测教训（2026-10-23）：第 1 轮 gapX=221 失败，第 2、3 轮都返回 262 ——
    //   同一张图被 OCR 误判成 262（ΔgapX=41 看起来"像刷新了"），
    //   但指纹完全相同。只看 ΔgapX 会被骗，必须结合指纹。
    if (!imgRefreshed && prevGapX >= 0) {
      const dGap = solved.x - prevGapX
      const dTarget = (bg.x + solved.x - (blk?.w || 49) / 2) - prevTargetX
      console.error(`[slider] 位移计算：ΔgapX=${dGap}px  ΔtargetX=${dTarget}px（图未刷新 → 位置不该变）`)
      if (Math.abs(dGap) < 2 && attempt > 1) {
        console.error('[slider] 缺口位置未变但上次失败 → 主动刷新验证码')
        await refreshCaptcha()
        prevBgHash = ''     // 重置指纹，下一轮重新判定
        await new Promise(r => setTimeout(r, 2500))
        continue
      }
    }

    // 指纹变了但缺口位置几乎没动 → 平台换了图但缺口在同一位置
    // （正常情况，不该刷新，直接用新 targetX 拖）
    if (imgRefreshed && prevGapX >= 0) {
      const dGap = solved.x - prevGapX
      console.error(`[slider] 图已刷新，缺口位移 ΔgapX=${dGap}px`)
    }

    if (!plausible && attempt < MAX) {
      // 可疑（缺口贴边）→ 刷新重取
      console.error('[slider] 缺口位置可疑 → 刷新验证码')
      await refreshCaptcha()
      prevBgHash = ''
      await new Promise(r => setTimeout(r, 2500))
      continue
    }

    const targetX = bg.x + solved.x - (blk?.w || 49) / 2
    if (DRY) return { ok: true, gapX: solved.x, targetX: Math.round(targetX), text: `[dry-run] 缺口 X=${solved.x}px，应拖到 ${Math.round(targetX)}` }

    const cdp = await page.target().createCDPSession()
    const traj = humanTrajectory(handle.x, targetX, handle.y)
    console.error(`[slider-inpage] 拖动 ${handle.x} → ${Math.round(targetX)}（${traj.length} 步，第 ${attempt} 轮）`)
    try {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', clickCount: 1 })
      for (const p of traj) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left' })
        // ★ 支持 per-step delay：起步犹豫（100-250ms）和中段停顿（40-120ms）
        //   没有 delay 的点用常规 12-34ms（模拟连续移动）
        await new Promise(r => setTimeout(r, p.delay != null ? p.delay : (12 + Math.random() * 22)))
      }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetX, y: handle.y, button: 'left', clickCount: 1 })
    } catch (e) {
      return { ok: false, gapX: solved.x, targetX: Math.round(targetX), text: `拖动失败（CDP 会话失效）：${e.message?.slice(0, 80) || e}` }
    }

    // 等遮罩消失
    let passed = false
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000))
      if (await sliderGone()) { passed = true; break }
    }
    if (passed) {
      return { ok: true, gapX: solved.x, targetX: Math.round(targetX), text: `✅ 滑块已过（缺口 X=${solved.x}，${traj.length} 步，第 ${attempt} 轮尝试）` }
    }

    // ★ 记录本轮状态，供下一轮做位移对比
    prevBgHash = bgHash
    prevGapX = solved.x
    prevTargetX = Math.round(targetX)

    // 未通过 → 下一轮重试（平台可能已自动换图；没换的话下一轮会判定并主动刷新）
    console.error(`[slider] 第 ${attempt} 轮拖动未通过，准备重试...`)
    if (attempt === MAX) {
      return { ok: false, gapX: solved.x, targetX: Math.round(targetX), text: `⚠️ ${MAX} 轮尝试后仍未通过（缺口 X=${solved.x}）` }
    }
    await new Promise(r => setTimeout(r, 3000))
  }
  return { ok: false, text: '超过最大尝试次数' }
}

// 被 import 时跳过主流程（只导出 solveSliderInPage）
if (!IS_IMPORTED) (async () => {
  const puppeteer = require('puppeteer-core')
  const { CredentialStore } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/lib/services/credential-store.js`)
  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  const SHOP = argOf('shop') || argOf('account') || store.findByPlatform('pdd_mms')?.shop_key
  if (!SHOP) { emit({ ok: false, failureKind: 'not_bound', text: '未绑定拼多多商家后台账号' }); process.exit(2) }

  let profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', SHOP)
  if (!fs.existsSync(profile)) profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', 'pdd_mms_de55c3e159072dfb5297b234eaa487c3')

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: profile, headless: false,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-position=100,50'],
  })
  const page = (await browser.pages())[0] || await browser.newPage()
  const safeEval = async (fn, arg) => {
    for (let i = 0; i < 15; i++) {
      for (const f of page.frames()) { try { return await f.evaluate(fn, arg) } catch { /* 换 */ } }
      await new Promise(r => setTimeout(r, 1500))
    }
    return null
  }
  const cdp = await page.target().createCDPSession()

  // ── ① 打开列表 + 点「发布新商品」触发滑块 ──
  await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await new Promise(r => setTimeout(r, 9000))
  if (/\/login/i.test(page.url())) {
    await browser.close()
    emit({ ok: false, failureKind: 'token_expired', text: '拼多多商家后台登录态失效，请到「账号连接」重新登录。' })
    process.exit(2)
  }
  const entry = await safeEval(() => {
    const NAV = 'nav, aside, [class*="sidenav"], [class*="sideNav"], [class*="menu"]'
    const all = Array.from(document.querySelectorAll('button, a, div, span'))
      .filter(el => {
        const r = el.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return false
        if ((el.innerText || '').trim() !== '发布新商品') return false
        return !el.closest(NAV)
      })
    const el = all.find(e => e.tagName === 'BUTTON') || all[all.length - 1]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  if (entry) {
    await page.mouse.click(entry.x, entry.y).catch(() => { /* 忽略 */ })
    console.error('[solver] 已点「发布新商品」，等待滑块...')
  }
  await new Promise(r => setTimeout(r, 10000))

  // ── ② 拿滑块 DOM（完整 dataURL + 手柄坐标）──
  const findSlider = () => safeEval(() => {
    const ms = Array.from(document.querySelectorAll('[class*="Modal"], [class*="modal"], [class*="MDL"], [class*="Dialog"]'))
      .filter(m => { const r = m.getBoundingClientRect(); return r.width > 200 && r.height > 150 })
    for (const m of ms) {
      if (!/滑块|拼图|向右|验证/.test((m.innerText || '').slice(0, 60))) continue
      const imgs = Array.from(m.querySelectorAll('img'))
        .map(el => { const b = el.getBoundingClientRect(); return { src: el.src || '', w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) } })
        .filter(o => /^data:image/.test(o.src) && o.w > 0)
      const handle = Array.from(m.querySelectorAll('.slide-button, [class*="slide-button"], [class*="slideButton"]'))
        .map(el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), w: Math.round(b.width), h: Math.round(b.height) } })
        .filter(o => o.w > 10)
      if (!imgs.length || !handle.length) continue
      return { imgs, handle, text: (m.innerText || '').replace(/\n/g, ' ').slice(0, 80) }
    }
    return null
  })
  let slider = await findSlider()
  if (!slider) {
    // 重试几次（滑块可能还没弹出）
    for (let i = 0; i < 8 && !slider; i++) {
      await new Promise(r => setTimeout(r, 2500))
      slider = await findSlider()
    }
  }
  if (!slider) {
    await browser.close()
    emit({ ok: false, failureKind: 'risk_control', text: '未弹出滑块验证（可能当前无限流 / 验证方式变更）。' })
    process.exit(2)
  }

  const bg = slider.imgs.find(i => i.w > 200) || slider.imgs[0]
  const blk = slider.imgs.find(i => i.w > 30 && i.w < 100)
  const handle = slider.handle[0]
  const bgB64 = bg.src.replace(/^data:image\/\w+;base64,/, '')
  const blkB64 = blk ? blk.src.replace(/^data:image\/\w+;base64,/, '') : null
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'slider-bg.png'), Buffer.from(bgB64, 'base64'))
  if (blkB64) fs.writeFileSync(path.join(OUT, 'slider-block.png'), Buffer.from(blkB64, 'base64'))
  console.error(`[solver] 背景 ${bg.w}x${bg.h} | 滑块 ${blk?.w || 0}x${blk?.h || 0} | 手柄 (${handle.x},${handle.y})`)

  // ── ③ OCR 识别 ──
  const solved = await solveSlider(bgB64, blkB64)
  console.error('[solver] OCR:', JSON.stringify(solved))
  if (!solved.ok) {
    await browser.close()
    emit({ ok: false, failureKind: 'api_error', text: `滑块识别失败：${solved.msg || `code=${solved.code}`}`, ocr: solved })
    process.exit(2)
  }

  // 目标 X = 背景图左缘 + 缺口 X - 滑块宽/2（滑块中心对齐缺口中心）
  const targetX = bg.x + solved.x - (blk?.w || 49) / 2
  const result = {
    ok: true, mode: DRY ? 'dry-run' : 'solve', shopKey: SHOP,
    gapX: solved.x, targetX, handleX: handle.x,
    text: DRY
      ? `[dry-run] 识别成功：缺口 X=${solved.x}px，应从 ${handle.x} 拖到 ${Math.round(targetX)}\n背景图 ${bg.w}x${bg.h}，已存盘 slider-bg.png / slider-block.png\n去掉 --dry-run 即执行拖动。`
      : `识别成功：缺口 X=${solved.x}px`,
  }
  if (DRY) { emit(result); await browser.close(); process.exit(0) }

  // ── ④ 人类化拖动 ──
  const traj = humanTrajectory(handle.x, targetX, handle.y)
  console.error(`[solver] 拖动 ${handle.x} → ${Math.round(targetX)}（${traj.length} 步）`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', clickCount: 1 })
  for (const p of traj) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left' })
    // ★ 支持 per-step delay（起步犹豫 100-250ms / 中段停顿 40-120ms）
    await new Promise(r => setTimeout(r, p.delay != null ? p.delay : (12 + Math.random() * 22)))
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetX, y: handle.y, button: 'left', clickCount: 1 })
  console.error('[solver] 拖动完成，等待验证结果...')

  // ── ⑤ 检测遮罩是否消失 ──
  let passed = false
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const still = await findSlider()
    if (!still) { passed = true; break }
  }
  result.ok = passed
  result.text = passed
    ? `✅ 滑块验证已通过（缺口 X=${solved.x}，${traj.length} 步轨迹）`
    : `⚠️ 拖动后验证未通过（可能轨迹被判定非人类 / 缺口偏差）。\n已存盘 slider-bg.png / slider-block.png 可人工核对。`
  emit(result)
  await browser.close()
})().catch(e => {
  emit({ ok: false, failureKind: 'api_error', text: `执行异常：${e?.message || String(e)}` })
  process.exit(1)
})
