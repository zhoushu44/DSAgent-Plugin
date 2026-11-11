/**
 * promo-signer-v2.mjs - 推广域签名器（完整环境版）
 *
 * 目标：把 jsdom 环境补到与真实浏览器一致，让签名长度接近 427 字符
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const SDK_FILE = process.env.PDD_PROMO_SDK ||
  path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh'),
    'pdd-risk-sdk', 'promo-sdk.mjs')

const DOM_URL = 'https://yingxiao.pinduoduo.com/mains/promotionOverview'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36'

let _ctx = null
/** 当前已应用的环境画像版本（用于判断是否需要重置重建） */
let _appliedProfileVersion = null

export async function initPromoV2(opts = {}) {
  if (_ctx) return _ctx

  let JSDOM
  try { ({ JSDOM } = require('jsdom')) }
  catch { throw new Error('需要 jsdom') }

  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div><canvas id="c"></canvas></body></html>', {
    url: DOM_URL, referrer: DOM_URL,
    pretendToBeVisual: true, runScripts: 'outside-only',
  })
  const { window: w } = dom

  /* ══ 完整环境伪装（对齐真实浏览器快照）══ */

  /**
   * ★ 把伪装属性挂到**原型**上（真实 Chrome 就是这样），并删掉实例自有属性。
   *   拼多多 SDK 用 `navigator.hasOwnProperty(...)` 做反篡改检测：
   *   实例自有属性 = 环境被改过 → 指纹走另一分支 → 服务端拒签（54001）。
   */
  const defProto = (obj, key, value) => {
    try {
      const proto = Object.getPrototypeOf(obj)
      if (!proto) { Object.defineProperty(obj, key, { get: () => value, configurable: true }); return }
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        try { delete obj[key] } catch { }
        try { Object.defineProperty(obj, key, { value, configurable: true, enumerable: true }) } catch { }
      }
      Object.defineProperty(proto, key, { get: () => value, configurable: true })
    } catch { }
  }

  // 1) navigator
  const nav = {
    userAgent: UA,
    appVersion: UA.replace('Mozilla/', ''),
    webdriver: false,
    hardwareConcurrency: 12,
    deviceMemory: 16,
    platform: 'Win32',
    vendor: 'Google Inc.',
    languages: ['zh-CN', 'zh'],
    language: 'zh-CN',
    maxTouchPoints: 0,
    cookieEnabled: true,
    onLine: true,
  }
  for (const [k, v] of Object.entries(nav)) {
    defProto(w.navigator, k, v)
  }

  // 2) plugins / mimeTypes
  const mkPlugin = (name, filename, desc) => ({
    name, filename, description: desc, length: 1,
    0: { type: 'application/pdf' }, item: () => null, namedItem: () => null,
  })
  const plugins = [
    mkPlugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
    mkPlugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
    mkPlugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
    mkPlugin('Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
    mkPlugin('WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format'),
  ]
  const mimes = [
    { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: plugins[0] },
    { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: plugins[0] },
  ]
  defProto(w.navigator, 'plugins', plugins)
  defProto(w.navigator, 'mimeTypes', mimes)

  // 3) screen
  const screenVals = { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24 }
  for (const [k, v] of Object.entries(screenVals)) {
    defProto(w.screen, k, v)
  }

  // 4) window 尺寸
  const winVals = { outerWidth: 1920, outerHeight: 1080, innerWidth: 1904, innerHeight: 969, devicePixelRatio: 1, screenX: 0, screenY: 0 }
  for (const [k, v] of Object.entries(winVals)) {
    try { Object.defineProperty(w, k, { get: () => v, configurable: true }) } catch { }
  }

  // 5) window.chrome
  w.chrome = {
    runtime: {},
    loadTimes: () => ({
      requestTime: performance.now() / 1000,
      startLoadTime: performance.now() / 1000,
      commitLoadTime: performance.now() / 1000,
      finishDocumentLoadTime: performance.now() / 1000,
      finishLoadTime: performance.now() / 1000,
      firstPaintTime: performance.now() / 1000,
      firstPaintAfterLoadTime: 0,
      navigationType: 'Other',
      wasFetchedViaSpdy: true,
      wasNpnNegotiated: true,
      npnNegotiatedProtocol: 'h2',
      wasAlternateProtocolAvailable: false,
      connectionInfo: 'h2',
    }),
    csi: () => ({ startE: Date.now(), onloadT: Date.now(), pageT: 1000, tran: 15 }),
    app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
  }

  // 6) canvas（关键：让 toDataURL 返回真实长度的 base64）
  const origGetContext = w.HTMLCanvasElement.prototype.getContext
  w.HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    if (type === '2d') {
      return {
        fillRect() { }, clearRect() { }, strokeRect() { },
        fillText() { }, strokeText() { }, measureText: (t) => ({ width: String(t || '').length * 7.2, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 }),
        beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, arc() { }, arcTo() { }, bezierCurveTo() { }, quadraticCurveTo() { },
        fill() { }, stroke() { }, clip() { },
        save() { }, restore() { }, translate() { }, rotate() { }, scale() { }, transform() { }, setTransform() { },
        createLinearGradient: () => ({ addColorStop() { } }),
        createRadialGradient: () => ({ addColorStop() { } }),
        createPattern: () => ({}),
        getImageData: (x, y, wd, ht) => ({ data: new Uint8ClampedArray((wd || 1) * (ht || 1) * 4).fill(128), width: wd || 1, height: ht || 1 }),
        putImageData() { }, drawImage() { },
        fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif',
        textAlign: 'start', textBaseline: 'alphabetic', globalAlpha: 1, globalCompositeOperation: 'source-over',
        shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)', lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
      }
    }
    if (type === 'webgl' || type === 'experimental-webgl') {
      const params = {
        7936: 'WebKit', 7937: 'WebKit WebGL', 7938: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
        35724: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
        37445: 'Google Inc. (NVIDIA)',
        37446: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)',
        3379: 16384, 34047: 16, 34921: 16, 35660: 16, 35661: 32, 36347: 1024, 36348: 30,
      }
      return {
        getParameter: (p) => params[p] ?? 0,
        getExtension: (n) => (n === 'WEBGL_debug_renderer_info' ? { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 } : null),
        getSupportedExtensions: () => ['WEBGL_debug_renderer_info', 'EXT_texture_filter_anisotropic', 'OES_texture_float'],
        getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
        getContextAttributes: () => ({ alpha: true, depth: true, stencil: false, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false }),
        createBuffer: () => ({}), bindBuffer() { }, bufferData() { },
        createShader: () => ({}), shaderSource() { }, compileShader() { }, getShaderParameter: () => true,
        createProgram: () => ({}), attachShader() { }, linkProgram() { }, getProgramParameter: () => true, useProgram() { },
        createTexture: () => ({}), bindTexture() { }, texImage2D() { }, texParameteri() { },
        viewport() { }, clearColor() { }, clear() { }, enable() { }, disable() { },
        drawArrays() { }, drawElements() { },
        VENDOR: 7936, RENDERER: 7937, VERSION: 7938, SHADING_LANGUAGE_VERSION: 35724,
      }
    }
    return null
  }

  // 关键：toDataURL 返回真实长度的 data URL（canvas 指纹）
  w.HTMLCanvasElement.prototype.toDataURL = function () {
    // 生成 794 字符的 base64（与真实浏览器一致）
    const payload = Buffer.alloc(560, 0).toString('base64')
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' + payload.slice(0, 500)
  }

  // 7) MediaSource
  w.MediaSource = function MediaSource() { }
  w.MediaSource.isTypeSupported = (t) => /audio|video/.test(String(t))
  w.MediaSource.prototype = {}
  w.HTMLMediaElement.prototype.canPlayType = function (t) {
    if (/audio\/mp3/.test(t)) return 'probably'
    if (/video\/mp4/.test(t)) return 'probably'
    return ''
  }

  // 8) DeviceOrientation / DeviceMotion
  if (!w.DeviceOrientationEvent) w.DeviceOrientationEvent = function DeviceOrientationEvent() { }
  if (!w.DeviceMotionEvent) w.DeviceMotionEvent = function DeviceMotionEvent() { }

  // 9) 其他
  w.console = { log() { }, warn() { }, error() { } }
  w.Buffer = Buffer
  w.globalThis = w
  w.self = w
  if (!w.requestAnimationFrame) w.requestAnimationFrame = (cb) => setTimeout(cb, 16)

  // 10) 种子（localStorage 需要 13 个 key）
  for (const [k, v] of Object.entries(opts.localStorage || {})) {
    try { w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)) } catch { }
  }
  // 补足到 13 个（真实浏览器是 13）
  const filler = ['_nano_fp', 'MMS-LOGIN-FP', 'ISLOGIN', 'mms.pmm.did.2', 'new_userinfo', 'web_finger', 'MALLSTATUS_', 'new_userinfoInvalid', '_bee', 'rckk', 'ru1k', 'ru2k', '_a42']
  for (const k of filler) {
    try { if (!w.localStorage.getItem(k)) w.localStorage.setItem(k, 'x'.repeat(32)) } catch { }
  }

  // 加载 SDK
  const src = fs.readFileSync(SDK_FILE, 'utf8')
  const code = src
    .replace(/^export default .*$/m, '')
    .replace(/^export const .*$/m, '')
    + '\nwindow.__PROMO_SDK__ = module_.exports.default || module_.exports;'

  // ★ 2026-11-09：注入的假 getter 必须伪装成原生函数，否则 SDK 用
  //   Function.prototype.toString 一测就露（jsdom 箭头函数源码不含 [native code]）
  //   必须在 SDK eval **之前**装补丁，否则 SDK 会持有原始 toString 引用
  try {
    const { nativeIze } = await import('./pdd-native-ize.mjs')
    nativeIze(w)
  } catch (e) { console.error('[promo-signer-v2] nativeIze 失败:', e.message) }

  // ★ 2026-11-09：套用推广域环境画像（cookie / referrer / storage / window.name /
  //   canvas / webgl / plugins / 几何 …）—— 这些是设备指纹，jsdom 无法自造，必须回放
  //   必须在 SDK eval **之前**完成：SDK 可能在加载期就缓存环境快照
  let applied = []
  if (opts.envProfile) {
    try {
      const { applyEnvProfile } = await import('./pdd-env-profile.mjs')
      applied = applyEnvProfile(w, opts.envProfile) || []
    } catch (e) { console.error('[promo-signer-v2] applyEnvProfile 失败:', e.message) }
  }

  // ★ 2026-11-09：补齐 jsdom 缺失的浏览器 API。
  //   缺 API → SDK 内部抛异常 → 走兜底分支（读 MediaSource 而不是 requestAnimationFrame）
  //   → 指纹/时间精度与主路径不同 → 服务端判 mikasaErrorCode:12
  try {
    const { fillMissingApis } = await import('./pdd-missing-apis.mjs')
    const added = fillMissingApis(w)
    if (added && added.length) applied.push('apis:' + added.length)
  } catch (e) { console.error('[promo-signer-v2] fillMissingApis 失败:', e.message) }

  // ★ 调试钩子：SDK eval 之前注入（用于环境读操作追踪）
  if (typeof opts.onBeforeEval === 'function') {
    try { opts.onBeforeEval(w) } catch (e) { console.error('[promo-signer-v2] onBeforeEval 失败:', e.message) }
  }

  w.eval(code)

  const SDK = w.__PROMO_SDK__
  if (typeof SDK !== 'function') throw new Error('SDK 加载失败')

  _ctx = { window: w, SDK, applied }
  _appliedProfileVersion = opts.envProfile?.version || null
  return _ctx
}

export async function signPromoV2(serverTime) {
  const { SDK } = await initPromoV2()
  const inst = new SDK({ serverTime: serverTime || Date.now() })
  return String(await inst.messagePack())
}

export function resetPromoV2() { _ctx = null; _appliedProfileVersion = null }

/** 当前已应用的环境画像版本（基座用它判断要不要重建） */
export function getAppliedProfileVersion() { return _appliedProfileVersion }

/** 当前 jsdom 的 UA（与签名环境一致） */
export function getUa() { return _ctx?.window?.navigator?.userAgent || null }

export const PROMO_V2_INFO = {
  module: 'promo-signer-v2.mjs',
  target: '签名长度 427 字符（对齐真实浏览器）',
  envFixes: ['navigator', 'plugins', 'mimeTypes', 'screen', 'window size', 'chrome', 'canvas', 'webgl', 'MediaSource', 'DeviceOrientation', 'seed'],
}
