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
import { inflateSync } from 'node:zlib'

/**
 * 从 base64 PNG 解出 RGBA 像素（8bit，非交错）
 * @returns {{w,h,data:Uint8Array}|null}
 */
function decodePng(b64) {
  try {
    const buf = Buffer.from(b64, 'base64')
    if (buf.length < 33 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) return null
    let p = 8, w = 0, h = 0, bitDepth = 8, colorType = 6
    const idat = []
    while (p + 8 <= buf.length) {
      const len = buf.readUInt32BE(p)
      const type = buf.slice(p + 4, p + 8).toString('ascii')
      if (type === 'IHDR') { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); bitDepth = buf[p + 16]; colorType = buf[p + 17] }
      else if (type === 'IDAT') idat.push(buf.slice(p + 8, p + 8 + len))
      else if (type === 'IEND') break
      p += 12 + len
    }
    if (!w || !h || bitDepth !== 8) return null
    const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0
    if (!ch) return null
    let inf
    try { inf = inflateSync(Buffer.concat(idat)) } catch { return null }
    const stride = w * ch
    const out = new Uint8Array(w * h * 4)
    const prev = new Uint8Array(stride), cur = new Uint8Array(stride)
    let off = 0
    for (let y = 0; y < h; y++) {
      const filter = inf[off++]
      for (let i = 0; i < stride; i++) cur[i] = inf[off++]
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0
        let v = cur[i]
        if (filter === 1) v = (v + a) & 0xff
        else if (filter === 2) v = (v + b) & 0xff
        else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff
        else if (filter === 4) {
          const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
        }
        cur[i] = v
      }
      for (let x = 0; x < w; x++) {
        const si = x * ch, di = (y * w + x) * 4
        if (ch === 4) { out[di] = cur[si]; out[di + 1] = cur[si + 1]; out[di + 2] = cur[si + 2]; out[di + 3] = cur[si + 3] }
        else if (ch === 3) { out[di] = cur[si]; out[di + 1] = cur[si + 1]; out[di + 2] = cur[si + 2]; out[di + 3] = 255 }
        else { const g = cur[si]; out[di] = out[di + 1] = out[di + 2] = g; out[di + 3] = 255 }
      }
      prev.set(cur)
    }
    return { w, h, data: out }
  } catch { return null }
}

/**
 * 找拼图块图形在块 PNG 内的横向左偏移（alpha > 20 的最左列）
 * 实测 PDD 拼图块 PNG 60x160，图形只占 x[10,49]，偏移 = 10
 */
function findPieceOffset(png) {
  try {
    for (let x = 0; x < png.w; x++) {
      for (let y = 0; y < png.h; y++) {
        if (png.data[(y * png.w + x) * 4 + 3] > 20) return x
      }
    }
  } catch { /* ignore */ }
  return 0
}

/**
 * 调 yydsocr 识别缺口。
 *
 * ★★★ 双缺口真相（2026-10-23 dump 原始响应查明）★★★
 *   PDD 验证码背景图里有 **2 个缺口**：1 个真、1 个干扰。
 *   yydsocr 不同 type_id 会各自返回不同答案：
 *
 *     2002 / 2005 / 2006  → 三者返回**同一个值**（= 干扰缺口）
 *     2004                → 返回**不同的值** + 额外字段 `externel:1`
 *
 *   实测同一次验证码：2002/2005/2006 都给 255，只有 2004 给 169；
 *   而像素梯度最强峰 = 171，与 169 吻合 → **2004 才是真缺口**。
 *   另一次：2004=169，drag=169×0.85=144，与「梯度 171×0.85=145 通过」
 *   只差 1px，互证 2004 正确。
 *
 *   所以策略改为：
 *     ① 优先用 2004
 *     ② 2004 失败时，用「2002/2005/2006 的多数值」作为**干扰缺口**排除，
 *        若 2004 有值且与多数不同 → 坚定用 2004
 *     ③ 全失败才回退 2000 单图
 *
 * @returns {{ ok, x, via, all, consensus }} all = 各 type_id 的原始返回
 */
async function solveSlider(bgB64, slideB64) {
  const all = {}
  const call = async (tid, extra) => {
    try {
      const resp = await fetch(OCR_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret_key: OCR_KEY, type_id: tid, ...extra }),
      })
      const j = await resp.json().catch(() => null)
      if (String(j?.code) === '200') {
        const raw = String(j.data?.data ?? '')
        const nums = raw.match(/\d+/g) || []
        if (nums.length) {
          const x = parseInt(nums[0], 10)
          all[tid] = { x, externel: j.data?.externel, raw }
          return x
        }
      }
      all[tid] = { x: null, code: j?.code, msg: j?.err_msg }
      return null
    } catch (e) {
      all[tid] = { x: null, err: e.message?.slice(0, 60) }
      return null
    }
  }

  if (slideB64) {
    // ★ 2004 优先（唯一能给出真缺口的 type_id）
    await call('2004', { background_image: bgB64, slide_image: slideB64 })
    // 干扰缺口三方投票（2002/2005/2006 通常一致）
    await call('2002', { background_image: bgB64, slide_image: slideB64 })
    await call('2005', { background_image: bgB64, slide_image: slideB64 })
    await call('2006', { background_image: bgB64, slide_image: slideB64 })
  } else {
    await call('2000', { image: bgB64 })
  }

  // 统计干扰缺口的「多数值」
  const distractVotes = ['2002', '2005', '2006'].map(t => all[t]?.x).filter(v => Number.isFinite(v))
  const counts = {}
  for (const v of distractVotes) counts[v] = (counts[v] || 0) + 1
  const consensus = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  const consensusX = consensus ? parseInt(consensus[0], 10) : null

  const real = all['2004']?.x
  if (Number.isFinite(real)) {
    const differentFromDistract = consensusX == null || real !== consensusX
    console.error(`[solver] 2004=${real} | 干扰共识=${consensusX ?? '—'}（${distractVotes.join('/')}）| ${differentFromDistract ? '✅2004是真缺口' : '⚠️两者相同'}`)
    return { ok: true, x: real, via: '2004(真缺口)', all, consensus: consensusX }
  }
  // 2004 没有 → 用单图兜底
  const solo = all['2000']?.x
  if (Number.isFinite(solo)) return { ok: true, x: solo, via: '2000(单图兜底)', all, consensus: consensusX }
  return { ok: false, code: all['2004']?.code, msg: all['2004']?.msg || all['2000']?.msg, all, consensus: consensusX }
}

/**
 * 生成人类化鼠标轨迹（2026-10-23 三次重写）
 *
 * ★ 演进历程（全部基于实测失败反推）：
 *   旧版 easeOutQuad：起始 260px/s 瞬间全速 → 累计分一高就被毙
 *   一次重写：起步犹豫 + 四段式慢→快→慢 → 解决了「瞬间全速」
 *   二次重写：±1px 噪声 + Y 轴随机游走 + 二次微调回退 + 间隔收窄
 *
 * ★ 二次重写后仍失败，局部平滑度诊断定位到 3 处加速度突变：
 *     #1~#5  起步处：19px → 1px（比率 19）  ← 抛物线 t² 起步太猛
 *     #28~33 85% 处：1px → 9px（比率 9）    ← 加速段末尾
 *     #48~56 终点处：1px → 8px（比率 8）    ← 过冲点
 *   全都是四段式曲线分段交界处加速度不连续——真人速度变化是连续的。
 *
 * ★ 三次重写（本版）：改用全程 C² 连续的光滑曲线
 *   ① 主位移用 smootherstep（6t⁵-15t⁴+10t³）：
 *      一阶导（速度）和二阶导（加速度）在 0/1 处都为 0，
 *      全程无加速度突变，天然就是「慢→快→慢」
 *   ② 叠加一层低频正弦扰动（幅度随速度缩放，不破坏平滑性）
 *   ③ 起步犹豫 100-250ms（保留）
 *   ④ 过冲改为「先加速冲出，再平滑回摆」，不用跳变
 */
function humanTrajectory(startX, targetX, startY) {
  const dist = targetX - startX
  const absDist = Math.abs(dist)
  if (absDist < 1) return []
  const steps = []
  let yDrift = (Math.random() - 0.5) * 0.6

  // ① 起步犹豫：真人按下后不会立刻移动（100-250ms）
  steps.push({ x: startX, y: startY + yDrift, delay: 100 + Math.random() * 150 })

  // ② smootherstep（C² 连续）+ 末端最小步长补偿
  //    smootherstep 末端速度趋 0，会导致接近目标时每步只走 0.05px，
  //    然后过冲点突然来一下（实测：5.93px → -1.63px，比率突变）。
  //    真人到终点前是「减速但保持可感知步长」匀速逼近，
  //    所以给末端加一个最小步长下限（0.35px）。
  const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10)
  const MIN_STEP = 0.35                      // 末端最小步长（px）
  const n = Math.max(25, Math.min(90, Math.round(absDist / 3)))
  let prevX = startX
  for (let i = 1; i <= n; i++) {
    const p = i / n
    const eased = smoother(p)
    let x = startX + dist * eased
    // 末端最小步长补偿：若本步位移不足 MIN_STEP 且还没到终点，补足
    const step = x - prevX
    if (Math.abs(step) < MIN_STEP && i < n) {
      x = prevX + Math.sign(dist) * MIN_STEP * (0.6 + Math.random() * 0.8)
    }
    // ③ 低频正弦扰动：中段幅度最大（速度最快时手最不稳），两端趋 0
    const wobFreq = 0.12 + Math.random() * 0.08
    const wobAmp = Math.min(1.2, absDist * 0.012)
    const wobble = Math.sin(p * Math.PI * 2 * wobFreq + (i * 0.7)) * wobAmp * Math.sin(p * Math.PI)
    x += wobble
    prevX = x
    // ④ Y 轴随机游走（低频漂移）
    yDrift += (Math.random() - 0.5) * 0.35
    yDrift = Math.max(-1.5, Math.min(1.5, yDrift))
    steps.push({ x, y: startY + yDrift })
    // 中段犹豫：4% 概率
    if (p > 0.3 && p < 0.8 && Math.random() < 0.04) steps.push({ x, y: startY + yDrift, delay: 40 + Math.random() * 80 })
  }
  // 注意：不再单独 push 一个 targetX 点——末段由下面的 tailN 段统一生成
  // （它自然地从逼近过冲到回正落位，全程光滑）

  // ⑤ 过冲 + 光滑回摆：把「末步 → 过冲 → 回摆」整段用同一条光滑曲线生成，
  //    避免「末端微步长 0.11px 突然跳到过冲 9px」的突变（实测该处比率超界）。
  //    真人形态：匀速逼近 → 略微冲过 → 平滑回正，全程连续。
  const overshoot = (Math.random() * 5 + 5) * Math.sign(dist)   // 过冲 5~10px
  const tailN = 10
  for (let i = 1; i <= tailN; i++) {
    const t = i / tailN
    // 用一段带过冲的 smootherstep 变体：先冲到 1+overshootRatio，再回落到 1
    const oRatio = overshoot / Math.abs(dist)
    // 前 30% 冲到过冲点，后 70% 平滑回正
    let pos
    if (t < 0.3) pos = smoother(t / 0.3) * oRatio
    else pos = oRatio * (1 - smoother((t - 0.3) / 0.7))
    const x = targetX + pos * Math.abs(dist) * Math.sign(dist)
    yDrift += (Math.random() - 0.5) * 0.3
    yDrift = Math.max(-1.5, Math.min(1.5, yDrift))
    steps.push({ x, y: startY + yDrift })
  }
  // ⑥ 终点微抖动
  for (let i = 0; i < 3; i++) steps.push({ x: targetX + (Math.random() - 0.5) * 1.0, y: startY + yDrift + (Math.random() - 0.5) * 1.0 })
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
        .map(el => {
          const b = el.getBoundingClientRect()
          const src = el.src || ''
          // ★ 解析 PNG 原始尺寸（base64 头部 IHDR：offset 16 起 4B 宽 + 4B 高）
          //   必须拿到，否则 cannot 算 scale（DOM 272 / PNG 320 = 0.85）
          let pngW = 0, pngH = 0
          try {
            const b64 = src.replace(/^data:image\/\w+;base64,/, '')
            if (b64) {
              const head = atob(b64.slice(0, 40))
              if (head.slice(1, 4) === 'PNG') {
                pngW = (head.charCodeAt(16) << 24) | (head.charCodeAt(17) << 16) | (head.charCodeAt(18) << 8) | head.charCodeAt(19)
                pngH = (head.charCodeAt(20) << 24) | (head.charCodeAt(21) << 16) | (head.charCodeAt(22) << 8) | head.charCodeAt(23)
              }
            }
          } catch { /* ignore */ }
          return { src, w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y), pngW: Math.abs(pngW), pngH: Math.abs(pngH) }
        })
        .filter(o => /^data:image/.test(o.src) && o.w > 0)
      const handle = Array.from(m.querySelectorAll('.slide-button, [class*="slide-button"], [class*="slideButton"]'))
        .map(el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), w: Math.round(b.width), h: Math.round(b.height) } })
        .filter(o => o.w > 10)
      if (!imgs.length || !handle.length) continue
      // ★ 计算拼图块的「块内图形左偏移」（PNG 像素基准）
      //   PDD 块 PNG 60x160，图形实际只占 x[10,49]；不减去这 10px 会恒差 8.5px(DOM)
      let pieceOffsetPng = 0
      try {
        const blkImg = imgs.find(i => i.w > 30 && i.w < 100)
        if (blkImg?.src) {
          const png = decodePng(blkImg.src.replace(/^data:image\/\w+;base64,/, ''))
          if (png) { pieceOffsetPng = findPieceOffset(png); blkImg.pieceOffsetPng = pieceOffsetPng }
        }
      } catch { /* ignore */ }
      return { imgs, handle, pieceOffsetPng, text: (m.innerText || '').replace(/\n/g, ' ').slice(0, 80) }
    }
    return null
  })
  const sliderGone = async () => !(await findSlider())
  const handle0 = await findSlider().then(s => s?.handle?.[0] || { x: 0, y: 0, w: 0, h: 0 })
  if (!handle0.x) return { ok: false, text: '当前页面未找到滑块（可能遮罩已消失）' }

  /**
   * 主动刷新验证码（点滑块遮罩里的刷新按钮）。
   *
   * 为什么需要：实测发现失败后平台**不一定**自动换图——
   * 2026-10-23 日志里第 2、3 次识别返回同一个 262px，说明是同一张图，
   * 此时重拖必然再失败。必须主动刷新。
   *
   * ⚠️ 血的教训（2026-10-23 实测）：**绝不能点「关闭」按钮！**
   *    `MDL_headerCloseIcon` 这类 close 类名元素，点了 = 放弃验证，
   *    平台直接踢到登录页（URL 变 /login/sso），整条链路报废。
   *    所以：
   *     - 只认 refresh / reload / change / switch 语义
   *     - close / shut / cancel / dismiss / exit 一律排除
   *     - 兜底的小图标也要排除右上角（关闭按钮的固定位置）
   *     - 找不到刷新按钮就返回 false，让上层等平台自动换图（宁可慢，别点错）
   *
   * @returns {Promise<boolean>} 是否成功触发刷新
   */
  const refreshCaptcha = async () => {
    const clicked = await safeEval(() => {
      const NEG = /close|shut|cancel|dismiss|exit/i
      const ms = Array.from(document.querySelectorAll('[class*="Modal"], [class*="modal"], [class*="MDL"], [class*="Dialog"]'))
        .filter(m => { const r = m.getBoundingClientRect(); return r.width > 200 && r.height > 150 })
      for (const m of ms) {
        if (!/滑块|拼图|向右|验证/.test((m.innerText || '').slice(0, 60))) continue
        // ① 只认 refresh / reload / change / switch 语义
        const cands = Array.from(m.querySelectorAll('[class*="refresh" i], [class*="reload" i], [class*="change" i], [class*="switch" i]'))
          .filter(e => !NEG.test(String(e.className)))
          .filter(e => { const r = e.getBoundingClientRect(); return r.width > 8 && r.height > 8 && r.width < 80 && r.height < 80 })
        if (cands.length) {
          cands[0].click()
          return { via: 'refresh-btn', cls: String(cands[0].className).slice(0, 60) }
        }
        // ② 兜底：遮罩内的小图标，排除 close 语义 + 排除右上角
        const mr = m.getBoundingClientRect()
        const icons = Array.from(m.querySelectorAll('i, svg'))
          .filter(e => !NEG.test(String(e.className)))
          .filter(e => { const r = e.getBoundingClientRect(); return r.width > 8 && r.height > 8 && r.width < 40 && r.height < 40 })
          .filter(e => {
            const r = e.getBoundingClientRect()
            return !(r.x > mr.x + mr.width - 60 && r.y < mr.y + 60)   // 排除右上角
          })
        if (icons.length) { icons[0].click(); return { via: 'small-icon', cls: String(icons[0].className).slice(0, 60) } }
      }
      return null
    })
    if (clicked) console.error(`[slider] 已点刷新（${clicked.via} ${clicked.cls}）`)
    else console.error('[slider] 未找到刷新按钮（不点关闭！等平台自动换图）')
    return !!clicked
  }

  // ★ 跨轮次状态：记录上一轮的图指纹、缺口 X、起点、目标，用于判断
  //   「验证码是否刷新」以及失败后该「重新取码」还是「修正位移」。
  let prevBgHash = ''
  let prevGapX = -1
  let prevStartX = -1
  let prevTargetX = -1
  const ORIGIN_START_X = handle0.x   // 首次读取的滑块原点（平台复位后的标准位置）

  for (let attempt = 1; attempt <= MAX; attempt++) {
    const slider = await findSlider()
    if (!slider) return { ok: false, text: '当前页面未找到滑块（可能遮罩已消失）' }

    const bg = slider.imgs.find(i => i.w > 200) || slider.imgs[0]
    const blk = slider.imgs.find(i => i.w > 30 && i.w < 100)
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
      const dTarget = (handle.x + solved.x) - prevTargetX
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

    if (!plausible) {
      // 缺口贴边（<25% 或 >90%）→ OCR 大概率误判，必须重取
      // 注意：即使是最后一轮也不该用可疑值拖——拖了也是浪费，
      // 还会让平台记录一次失败。直接返回失败让上层决定。
      if (attempt < MAX) {
        console.error(`[slider] 缺口位置可疑（ratio=${(ratio * 100).toFixed(1)}%）→ 刷新验证码`)
        const refreshed = await refreshCaptcha()
        await new Promise(r => setTimeout(r, 2500))
        // ★ 刷新后遮罩可能消失（平台放过了/换验证方式）。
        //   这时不能当成「滑块已过」——先看页面还在不在 mms 域，
        //   被踢到 /login 就是失败了。
        const stillThere = await findSlider()
        const kicked = await page.evaluate(() => /\/login/i.test(location.href)).catch(() => true)
        if (kicked) {
          return { ok: false, gapX: solved.x, text: '刷新后被踢到登录页（验证失败）' }
        }
        if (!stillThere) {
          console.error('[slider] 刷新后遮罩消失，等 3s 再看')
          await new Promise(r => setTimeout(r, 3000))
          if (await findSlider()) { prevBgHash = ''; continue }
          // 真没了：可能是平台放过了（不弹了）或换成别的方式
          const gone2 = !(await findSlider())
          return { ok: gone2, gapX: solved.x, text: gone2 ? '遮罩已消失（平台未再弹滑块）' : '遮罩状态异常' }
        }
        prevBgHash = ''
        continue
      }
      return { ok: false, gapX: solved.x, targetX: Math.round(handle.x + solved.x), text: `缺口位置可疑（X=${solved.x}，${(ratio * 100).toFixed(1)}%），拒绝拖动` }
    }

    // ★ 滑块复位：失败后平台不一定把滑块弹回原点。
    //   若滑块还停在 prevTargetX，直接从这里发 mousePressed 会导致
    //   实际位移 = targetX - prevTargetX（远小于应有值），验证必失败。
    //   所以每轮先读当前滑块位置，若偏离原点则先拖回去（瞬时，无轨迹）。
    const curHandle = slider.handle[0]
    const needReset = Math.abs(curHandle.x - ORIGIN_START_X) > 2
    if (needReset) {
      console.error(`[slider] 滑块偏离原点 ${ORIGIN_START_X} → ${curHandle.x}，先复位`)
      try {
        const rc = await page.target().createCDPSession()
        await rc.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: curHandle.x, y: curHandle.y, button: 'left', clickCount: 1 })
        await rc.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ORIGIN_START_X, y: curHandle.y, button: 'left' })
        await rc.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ORIGIN_START_X, y: curHandle.y, button: 'left', clickCount: 1 })
        await new Promise(r => setTimeout(r, 800))
      } catch { /* 复位失败不阻塞，继续尝试 */ }
      // 复位后重新读一次（位置可能因动画未稳）
      const s2 = await findSlider()
      if (s2) { slider.handle = s2.handle; slider.imgs = s2.imgs }
    }
    const handle = slider.handle[0]

    // ══════════════════════════════════════════════════════════════════
    // ★★★ 位移公式（2026-10-23 最终版，含块内偏移）★★★
    //
    //   drag = (gapPngX − pieceOffsetPngX) × scale
    //   targetX = handle.x + drag
    //
    //   scale            = bg.domW / bg.pngW   （实测 272/320 = 0.85）
    //   gapPngX          = 真缺口左边缘（PNG 像素，yydsocr 2004 或梯度扫描）
    //   pieceOffsetPngX  = 拼图块图形在块 PNG 内的左偏移
    //
    // ★ 关键：拼图块 PNG 是 60x160 的整条，但里面的图形只占 x[10,49] 40x40。
    //   块元素与背景图左边缘对齐（都 x=657），所以图形静止时视觉位置是
    //   bg.x + 10×scale = 657 + 8.5 = 665.5。
    //   要让它对齐缺口左边缘 (657 + gapPngX×scale)，就得拖
    //   (gapPngX − 10) × scale。
    //
    //   旧公式漏了 −10，恒差 8.5px（DOM）——这就是一直「差一点」的根因。
    //
    // 历史错误链（全部踩过）：
    //   ① bg.x + gapX − blkW/2     绝对坐标 + 没缩放
    //   ② handle.x + gapX          没缩放（scale=0.85，差 15%）
    //   ③ handle.x + gapX×scale    缩放了但漏块内偏移（差 8.5px）
    //   ④ 本案：handle.x + (gapX − pieceOffset)×scale
    // ══════════════════════════════════════════════════════════════════
    const scale = bg.w && bg.pngW ? bg.w / bg.pngW : 1
    const pieceOffset = blk?.pieceOffsetPng ?? 0
    const drag = Math.round((solved.x - pieceOffset) * scale)
    const targetX = handle.x + drag
    const realDist = targetX - handle.x
    const dFromPrev = prevTargetX >= 0 ? targetX - prevTargetX : null
    console.error(`[slider] 位移：gap=${solved.x} − 块内偏移=${pieceOffset} = ${solved.x - pieceOffset}（PNG）× scale ${scale.toFixed(3)} = drag ${drag}px → 目标 ${Math.round(targetX)}`
      + (dFromPrev != null ? `（与上轮差 ${Math.round(dFromPrev)}px）` : ''))
    if (DRY) return { ok: true, gapX: solved.x, targetX: Math.round(targetX), text: `[dry-run] gap ${solved.x} − offset ${pieceOffset} → drag ${drag}px → targetX ${Math.round(targetX)}` }

    const cdp = await page.target().createCDPSession()
    const traj = humanTrajectory(handle.x, targetX, handle.y)
    console.error(`[slider-inpage] 拖动 ${handle.x} → ${Math.round(targetX)}（${traj.length} 步，位移 ${Math.round(realDist)}px，第 ${attempt} 轮）`)
    try {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', clickCount: 1 })
      for (const p of traj) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left' })
        // ★ per-step delay：起步犹豫（100-250ms）/ 中段停顿（40-120ms）；
        //   常规间隔收窄到 12+random*8（原 12+random*22 的 CV≈0.65，
        //   真人鼠标间隔 CV<0.3，太散会被判机器）
        await new Promise(r => setTimeout(r, p.delay != null ? p.delay : (12 + Math.random() * 8)))
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

    // ★ 记录本轮状态，供下一轮做图指纹 + 位移对比
    prevBgHash = bgHash
    prevGapX = solved.x
    prevStartX = handle.x
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
        .map(el => {
          const b = el.getBoundingClientRect()
          const src = el.src || ''
          // ★ 解析 PNG 原始尺寸（base64 头部 IHDR：offset 16 起 4B 宽 + 4B 高）
          //   必须拿到，否则 cannot 算 scale（DOM 272 / PNG 320 = 0.85）
          let pngW = 0, pngH = 0
          try {
            const b64 = src.replace(/^data:image\/\w+;base64,/, '')
            if (b64) {
              const head = atob(b64.slice(0, 40))
              if (head.slice(1, 4) === 'PNG') {
                pngW = (head.charCodeAt(16) << 24) | (head.charCodeAt(17) << 16) | (head.charCodeAt(18) << 8) | head.charCodeAt(19)
                pngH = (head.charCodeAt(20) << 24) | (head.charCodeAt(21) << 16) | (head.charCodeAt(22) << 8) | head.charCodeAt(23)
              }
            }
          } catch { /* ignore */ }
          return { src, w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y), pngW: Math.abs(pngW), pngH: Math.abs(pngH) }
        })
        .filter(o => /^data:image/.test(o.src) && o.w > 0)
      const handle = Array.from(m.querySelectorAll('.slide-button, [class*="slide-button"], [class*="slideButton"]'))
        .map(el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), w: Math.round(b.width), h: Math.round(b.height) } })
        .filter(o => o.w > 10)
      if (!imgs.length || !handle.length) continue
      // ★ 计算拼图块的「块内图形左偏移」（PNG 像素基准）
      //   PDD 块 PNG 60x160，图形实际只占 x[10,49]；不减去这 10px 会恒差 8.5px(DOM)
      let pieceOffsetPng = 0
      try {
        const blkImg = imgs.find(i => i.w > 30 && i.w < 100)
        if (blkImg?.src) {
          const png = decodePng(blkImg.src.replace(/^data:image\/\w+;base64,/, ''))
          if (png) { pieceOffsetPng = findPieceOffset(png); blkImg.pieceOffsetPng = pieceOffsetPng }
        }
      } catch { /* ignore */ }
      return { imgs, handle, pieceOffsetPng, text: (m.innerText || '').replace(/\n/g, ' ').slice(0, 80) }
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

  // 目标 X = 滑块把手起点 + 缺口 X（PDD 线性 1:1，2026-10-23 黑盒标定验证）
  const targetX = handle.x + solved.x
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
    // ★ 同上：常规间隔 12+random*8（CV 对齐真人 <0.3）
    await new Promise(r => setTimeout(r, p.delay != null ? p.delay : (12 + Math.random() * 8)))
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
