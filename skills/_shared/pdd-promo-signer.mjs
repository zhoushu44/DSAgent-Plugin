/**
 * promo-signer.mjs —— 推广域纯 Node 签名器
 *
 * 突破点：
 *   推广域 SDK = rspack 模块 22768（100KB，独立 UMD 打包）
 *   不是 JVM2，是另一套实现
 *   接口：new SDK({serverTime}).messagePack() → 424 字符 0as*q 签名
 *
 * 依赖：jsdom（提供 window）
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const SDK_FILE = process.env.PDD_PROMO_SDK ||
  path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh'),
    'pdd-risk-sdk', 'promo-sdk.mjs')
let _ctx = null

/**
 * 初始化推广域沙箱
 */
export async function initPromo(domUrl = 'https://yingxiao.pinduoduo.com/mains/promotionOverview') {
  if (_ctx) return _ctx

  let JSDOM
  try { ({ JSDOM } = require('jsdom')) }
  catch { throw new Error('需要 jsdom: npm i jsdom') }

  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="root"></div><canvas id="c"></canvas></body></html>`, {
    url: domUrl,
    referrer: domUrl,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  })
  const { window } = dom

  // 补全浏览器环境
  Object.defineProperty(window.navigator, 'webdriver', { get: () => false })
  Object.defineProperty(window.navigator, 'hardwareConcurrency', { get: () => 8 })
  Object.defineProperty(window.navigator, 'deviceMemory', { get: () => 8 })
  Object.defineProperty(window.navigator, 'platform', { get: () => 'Win32' })
  Object.defineProperty(window.navigator, 'vendor', { get: () => 'Google Inc.' })
  window.console = { log() { }, warn() { }, error() { } }
  window.Buffer = Buffer
  window.globalThis = window
  window.self = window

  // canvas / media
  window.HTMLCanvasElement.prototype.getContext = function (k) {
    if (k === '2d') {
      return {
        fillRect() { }, clearRect() { }, fillText() { }, strokeText() { },
        beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, arc() { },
        fill() { }, stroke() { }, save() { }, restore() { },
        measureText: (t) => ({ width: String(t || '').length * 7 }),
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray((w || 1) * (h || 1) * 4), width: w || 1, height: h || 1 }),
        fillStyle: '#000', font: '10px sans-serif',
      }
    }
    if (k === 'webgl' || k === 'experimental-webgl') {
      return {
        getParameter: () => 'WebKit',
        getExtension: () => null,
        getSupportedExtensions: () => [],
        getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
      }
    }
    return null
  }
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgo='
  window.MediaSource = { isTypeSupported: () => 2 }
  window.HTMLMediaElement.prototype.canPlayType = () => 'probably'

  // 加载 SDK 源码（用 window.eval，让它拿到 window 作用域）
  const src = fs.readFileSync(SDK_FILE, 'utf8')
  // 去掉 export 语句，改成挂到 window
  const code = src
    .replace(/^export default .*$/m, '')
    .replace(/^export const .*$/m, '')
    + '\nwindow.__PROMO_SDK__ = module_.exports.default || module_.exports;'

  window.eval(code)
  const SDK = window.__PROMO_SDK__
  if (typeof SDK !== 'function') throw new Error('SDK 加载失败，未拿到构造函数')

  _ctx = { window, SDK }
  return _ctx
}

/**
 * 生成推广域签名
 * @returns {Promise<string>} 424 字符，0as*q 开头
 */
export async function signPromo() {
  const { SDK } = await initPromo()
  const inst = new SDK({ serverTime: Date.now() })
  const sig = await inst.messagePack()
  return String(sig)
}

/**
 * 调用推广域接口
 * @param {string} pathname /mms-gateway/...
 * @param {object} body
 * @param {object} opts { cookie, userAgent }
 */
export async function callPromo(pathname, body = {}, opts = {}) {
  const sig = await signPromo()
  const cookie = opts.cookie || ''
  const ua = opts.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'
  const url = pathname.startsWith('http') ? pathname : 'https://yingxiao.pinduoduo.com' + pathname

  const finalBody = { ...body, crawlerInfo: sig }   // ★ 关键：放 body

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://yingxiao.pinduoduo.com',
      referer: 'https://yingxiao.pinduoduo.com/mains/promotionOverview',
      'user-agent': ua,
      cookie,
      accept: 'application/json, text/plain, */*',
    },
    body: JSON.stringify(finalBody),
  })
  const j = await r.json().catch(() => null)
  const ec = j?.errorCode ?? j?.error_code
  const ok = j?.success === true || ec === 1000 || ec === 1000000
  return { ok, ec, result: j?.result, raw: j }
}

export function resetPromo() { _ctx = null }

export const PROMO_INFO = {
  module: 'promo-signer.mjs',
  sdkFile: '~/.dsh/pdd-risk-sdk/promo-sdk.mjs',
  sdkType: 'rspack module 22768 (UMD, 100KB)',
  notJVM2: true,
  signature: '0as*q ~424 chars',
  position: 'body.crawlerInfo',
  domain: 'yingxiao.pinduoduo.com',
  successCode: 1000,
}
