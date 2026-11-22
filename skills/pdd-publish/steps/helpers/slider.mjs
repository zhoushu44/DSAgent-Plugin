/**
 * slider.mjs — 滑块检测 + 自动破解（基座未就绪期间的兜底）
 *
 * 依赖：
 *   skills/_shared/pdd-shadow-hook.mjs    installShadowHook(page) —— 必须在 goto 之前
 *   skills/_shared/pdd-slider-solver.mjs  solveSliderInPage(page, shopKey)
 *
 * 用法：
 *   import { installSliderSupport, detectSlider, solveIfPresent, handleSlider } from './slider.mjs'
 *
 *   // ① 开页前（必须先做，才能穿透 closed shadow root）
 *   await installSliderSupport(page)
 *
 *   // ② 任意操作后
 *   const r = await solveIfPresent(page, shopKey)
 *   // r = { had:true/false, ok:true/false, text }
 */
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHARED = path.join(__dirname, '..', '..', '..', '_shared')

const sleep = ms => new Promise(r => setTimeout(r, ms))

let _hook = null
let _solver = null
async function deps() {
  if (!_hook) {
    _hook = await import(pathToFileURL(path.join(SHARED, '_unused', 'pdd-shadow-hook.mjs')).href).catch(e => {
      console.error('[slider] 加载 pdd-shadow-hook 失败:', e.message)
      return null
    })
  }
  if (!_solver) {
    _solver = await import(pathToFileURL(path.join(SHARED, 'pdd-slider-solver.mjs')).href).catch(e => {
      console.error('[slider] 加载 pdd-slider-solver 失败:', e.message)
      return null
    })
  }
  return { hook: _hook, solver: _solver }
}

/**
 * ★ 必须在 page.goto 之前调用
 * 安装 closed shadow root 穿透 hook
 */
export async function installSliderSupport(page) {
  const { hook } = await deps()
  if (!hook?.installShadowHook) return { ok: false, error: 'pdd-shadow-hook 不可用' }
  try {
    await hook.installShadowHook(page)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 120) }
  }
}

/** 滑块文案 */
const SLIDER_TEXTS = [
  '请向右滑块完成拼图', '向右滑动完成拼图', '拖动滑块', '请拖动下方滑块',
  '完成拼图', '点击与', '滑动验证',
]

/**
 * 检测是否有滑块
 * @returns {Promise<{has:boolean, text:string, source:string}>}
 */
export async function detectSlider(page) {
  try {
    return await page.evaluate((args) => {
      const { texts, doms } = args

      // ① 真实锚点（SDK 写死的）
      const ANCHORS = [
        '#slide-captcha-dialog',
        '.captcha-wrapper__slider',
        '.captcha-wrapper',
        '.slide-handlebar',
      ]
      // 优先用注入的深查询（穿透 closed shadow）
      const dq = typeof window.__pddDeepQueryAll === 'function'
        ? window.__pddDeepQueryAll
        : (sel) => Array.from(document.querySelectorAll(sel))

      for (const sel of ANCHORS) {
        const els = dq(sel)
        for (const el of els) {
          const r = el.getBoundingClientRect()
          if (r.width > 150 && r.height > 80) {
            const txt = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120)
            const kind = /点击与|形状相同|几何体/.test(txt) ? 'click-shape' : 'slide'
            return { has: true, kind, text: txt, source: 'anchor:' + sel }
          }
        }
      }

      // ② 通用容器
      for (const sel of doms) {
        const els = dq(sel)
        for (const el of els) {
          const r = el.getBoundingClientRect()
          if (r.width < 80 || r.height < 40) continue
          const t = (el.innerText || '').replace(/\s+/g, ' ').trim()
          if (/滑块|拼图|向右|验证/.test(t)) {
            return { has: true, text: t.slice(0, 100), source: 'dom:' + sel }
          }
        }
      }

      // ③ 文案兜底 + 判定类型
      const bodyText = document.body.innerText || ''
      const CLICK_TEXTS = ['点击与蓝色', '形状相同的另外一个', '点击与', '相同的另外一个几何体']
      const SLIDE_TEXTS = ['请向右滑块', '向右滑动', '拖动滑块', '请拖动下方滑块']

      for (const t of CLICK_TEXTS) {
        if (bodyText.includes(t)) {
          return { has: true, kind: 'click-shape', text: t, source: 'text:' + t }
        }
      }
      for (const t of SLIDE_TEXTS) {
        if (bodyText.includes(t)) {
          return { has: true, kind: 'slide', text: t, source: 'text:' + t }
        }
      }

      return { has: false, kind: '', text: '', source: '' }
    }, {
      texts: SLIDER_TEXTS,
      doms: ['[class*="captcha"]', '[class*="Captcha"]', '[class*="slider"]', '[class*="Slider"]', '[class*="Modal"]', '[role="dialog"]'],
    })
  } catch {
    return { has: false, text: '', source: '' }
  }
}

/**
 * 有滑块就解，没有就跳过
 *
 * @param {object} page
 * @param {string} shopKey
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=3]
 * @param {function} [opts.onSlider]  基座钩子（优先于内置求解器）
 * @param {string} [opts.step]        当前步骤名，透传
 * @returns {Promise<{had:boolean, ok:boolean, text:string, via:string, attempts:number}>}
 */
export async function solveIfPresent(page, shopKey, opts = {}) {
  const st = await detectSlider(page)
  if (!st.has) return { had: false, ok: true, text: '', via: 'none', attempts: 0 }

  // ① 基座钩子优先
  if (typeof opts.onSlider === 'function') {
    try {
      const r = await opts.onSlider(page, { step: opts.step || '', url: page.url(), text: st.text, source: st.source })
      if (r?.ok) {
        const cleared = await waitClear(page, 15000)
        return { had: true, ok: cleared, text: st.text, via: 'hook', attempts: 1 }
      }
      return { had: true, ok: false, text: st.text, via: 'hook', attempts: 1 }
    } catch (e) {
      return { had: true, ok: false, text: String(e.message).slice(0, 120), via: 'hook', attempts: 1 }
    }
  }

  // ①.5 点选图形题 → 内置求解器解不了，直接返回需人工
  if (st.kind === 'click-shape') {
    return {
      had: true, ok: false, text: st.text, via: 'unsupported',
      attempts: 0, needManual: true,
      reason: '点选几何体验证码（非滑块），需要人工或基座处理',
    }
  }

  // ② 内置求解器
  const { solver } = await deps()
  if (!solver?.solveSliderInPage) {
    return { had: true, ok: false, text: 'pdd-slider-solver 不可用', via: 'none', attempts: 0 }
  }

  const MAX = opts.maxAttempts ?? 3
  let last = ''
  for (let i = 0; i < MAX; i++) {
    try {
      const r = await solver.solveSliderInPage(page, shopKey, { maxAttempts: 1 })
      last = r?.text || ''
      if (r?.ok) {
        const cleared = await waitClear(page, 10000)
        if (cleared) return { had: true, ok: true, text: last, via: 'solver', attempts: i + 1 }
      }
    } catch (e) {
      last = String(e.message).slice(0, 120)
    }
    await sleep(1500)
    // 可能已经过了
    const again = await detectSlider(page)
    if (!again.has) return { had: true, ok: true, text: last, via: 'solver', attempts: i + 1 }
  }
  return { had: true, ok: false, text: last || '求解失败', via: 'solver', attempts: MAX }
}

/** 等滑块消失 */
export async function waitClear(page, timeoutMs = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const st = await detectSlider(page)
    if (!st.has) return true
    await sleep(1200)
  }
  return false
}

/**
 * 兼容旧名：handleSlider
 */
export async function handleSlider(page, opts = {}) {
  const r = await solveIfPresent(page, opts.shopKey, opts)
  if (!r.had) return { ok: true, had: false }
  if (r.ok) return { ok: true, had: true }
  return { ok: false, had: true, blocked: true, error: 'SLIDER_FAILED: ' + (r.text || '未知') }
}



