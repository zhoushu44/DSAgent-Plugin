/**
 * pdd-vodka-signer.mjs —— 纯 Node 生成 PDD 真签名（0as），无需浏览器
 *
 * ══════════════════════════════════════════════════════════════════
 * 2026-11-07 突破
 * ══════════════════════════════════════════════════════════════════
 *
 * 背景：之前 /vodka/ /glide/ 必须开浏览器（pdd-client，28s/次）。
 * 现在改为：jsdom 加载 react_anti SDK，纯 Node 生成 0as 签名。
 *
 * 实测：沙箱初始化 75ms，单次调用 ~150ms（浏览器 28000ms，快 ~180 倍）
 *
 * ══════════════════════════════════════════════════════════════════
 * 三个必要条件（缺一不可）
 * ══════════════════════════════════════════════════════════════════
 *
 *   ① antiVersion: 'v1'
 *      messagePack({antiVersion:'v1'}) → 0as（真签名）
 *      messagePack('')                  → 0at（无效）
 *      机制：SDK 里 antiVersion==='v2' 走 0at 分支，否则走 0as
 *
 *   ② localStorage 种子
 *      ISLOGIN=1 / MMS-LOGIN-FP / _nano_fp / new_userinfo / mms.pmm.did.2
 *      缺了会生成 0asA（匿名）而非 0asW（已登录），部分接口会拒
 *
 *   ③ location.href 必须是真实页面 URL
 *      它参与签名（LocationInfo 段），用假的会不匹配
 *
 * ══════════════════════════════════════════════════════════════════
 * 不需要伪造事件
 * ══════════════════════════════════════════════════════════════════
 *   实测：采集器全空（ClickEvent/TouchStart/TouchMove/Scroll 全 0）
 *   也能生成 305 字节有效签名并通过 /vodka/ /glide/。
 *   之前以为要伪造鼠标轨迹，是误判。
 *
 * ══════════════════════════════════════════════════════════════════
 * 依赖
 * ══════════════════════════════════════════════════════════════════
 *   jsdom            （npm i jsdom）
 *   react_anti SDK   （从 mms.pinduoduo.com 抓一次，缓存到本地）
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** 默认 SDK 路径（可由环境变量覆盖） */
const DEFAULT_SDK = process.env.PDD_RISK_SDK ||
  path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh'),
    'pdd-risk-sdk', 'react_anti.decoded.js')

const DOM_URL = 'https://mms.pinduoduo.com/goods/goods_list'

/** 沙箱缓存（避免重复加载 SDK，75ms → 0ms） */
let _ctx = null
let _ctxKey = ''

/**
 * 初始化沙箱
 * @param {object} opts
 * @param {object} opts.cookies      Cookie 对象
 * @param {object} opts.localStorage localStorage 种子对象
 * @param {string} opts.sdkPath      SDK 文件路径
 * @returns {Promise<{factory:Function, window:object, ALL:object}>}
 */
export async function initSandbox(opts = {}) {
  const key = JSON.stringify({
    sdk: opts.sdkPath || DEFAULT_SDK,
    ls: Object.keys(opts.localStorage || {}).sort().join(','),
  })
  if (_ctx && _ctxKey === key) {
    // 复用沙箱时只需要更新 Cookie
    if (opts.cookies) applyCookies(_ctx.document, opts.cookies)
    return _ctx
  }

  const sdkPath = opts.sdkPath || DEFAULT_SDK
  if (!fs.existsSync(sdkPath)) {
    throw new Error(`[pdd-vodka-signer] SDK 不存在: ${sdkPath}\n` +
      `请设置 PDD_RISK_SDK 环境变量，或把 react_anti 解密后文件放到该路径。`)
  }
  const src = fs.readFileSync(sdkPath, 'utf8')

  let JSDOM
  try { ({ JSDOM } = require('jsdom')) }
  catch { throw new Error('[pdd-vodka-signer] 缺少 jsdom 依赖，请 npm i jsdom') }

  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div id="root"><button id="searchBtn">搜索</button></div>
    <canvas id="c"></canvas></body></html>`, {
    url: DOM_URL, referrer: DOM_URL, pretendToBeVisual: true, runScripts: 'outside-only',
  })
  const { window } = dom
  const { document } = window

  // ① localStorage 种子
  for (const [k, v] of Object.entries(opts.localStorage || {})) {
    if (v == null) continue
    try { window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)) } catch { }
  }

  // ② Cookie
  applyCookies(document, opts.cookies || {})

  // ③ 浏览器环境补全（SDK 会探测这些）
  Object.defineProperty(window.navigator, 'webdriver', { get: () => false })
  Object.defineProperty(window.navigator, 'hardwareConcurrency', { get: () => 8 })
  Object.defineProperty(window.navigator, 'deviceMemory', { get: () => 8 })
  Object.defineProperty(window.navigator, 'platform', { get: () => 'Win32' })
  Object.defineProperty(window.navigator, 'vendor', { get: () => 'Google Inc.' })
  window.console = { log() { }, warn() { }, error() { } }
  window.Buffer = Buffer
  window.globalThis = window
  window.MediaSource = { isTypeSupported: () => 2 }
  window.HTMLMediaElement.prototype.canPlayType = () => 'probably'
  window.HTMLCanvasElement.prototype.getContext = () => null
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:,'

  // ④ 加载 SDK（顺带暴露采集器，便于调试）
  const MARK = 'function gt(){O=0,[j,V,F,K].forEach'
  const patched = src.includes(MARK)
    ? src.replace(MARK,
      'globalThis.__PDD_ALL__={G,tt,et,rt,At,nt,at,it,ct,st,pt,dt,ft,Y,ht,F,lt,j,V,K,u};' + MARK)
    : src
  window.eval(patched)

  // ⑤ 取 webpack factory
  const chunks = window.__LOADABLE_LOADED_CHUNKS__
  if (!chunks || !chunks.length) throw new Error('[pdd-vodka-signer] SDK 未注册 chunk')

  const mods = chunks[0][1]
  const cache = {}
  const rq = (id) => {
    if (cache[id]) return cache[id].exports
    const m = cache[id] = { i: id, l: false, exports: {} }
    mods[id].call(m.exports, m, m.exports, rq)
    m.l = true
    return m.exports
  }
  rq.r = () => { }
  rq.o = (o, p) => Object.prototype.hasOwnProperty.call(o, p)

  let factory = null
  for (const id of Object.keys(mods)) {
    try {
      const x = rq(id)
      const y = typeof x === 'function' ? x : x?.default
      if (typeof y === 'function') { factory = y; break }
    } catch { /* 模块可能报错，跳过 */ }
  }
  if (!factory) throw new Error('[pdd-vodka-signer] 未找到 SDK factory')

  _ctx = { factory, window, document, ALL: window.__PDD_ALL__ }
  _ctxKey = key
  return _ctx
}

function applyCookies(document, cookies) {
  for (const [k, v] of Object.entries(cookies || {})) {
    try { document.cookie = `${k}=${v}; path=/` } catch { /* ignore */ }
  }
}

/**
 * 生成真签名
 * @param {object} opts { cookies, localStorage, antiVersion }
 * @returns {Promise<string>} 0as 开头的签名（411 字符左右）
 */
export async function sign(opts = {}) {
  const ctx = await initSandbox(opts)
  const inst = ctx.factory({ baseUrl: 'https://mms.pinduoduo.com' })
  const s = await inst.messagePack({ antiVersion: opts.antiVersion || 'v1' })
  return String(s)
}

/**
 * 从账号对象构造签名（便捷封装）
 * @param {object} account { cookies, localStorage? }
 */
export async function signForAccount(account) {
  return sign({
    cookies: account?.cookies || {},
    localStorage: account?.localStorage || {},
  })
}

/** 清理沙箱（一般不需要） */
export function resetSandbox() {
  _ctx = null
  _ctxKey = ''
}

/** SDK 是否就绪 */
export function sdkReady(sdkPath) {
  return fs.existsSync(sdkPath || DEFAULT_SDK)
}

export const VODKA_INFO = {
  module: 'pdd-vodka-signer.mjs',
  browser: false,
  signature: '0as (react_anti SDK in jsdom)',
  initMs: 75,
  callMs: '120~330',
  covers: ['/vodka/', '/glide/'],
  note: '纯 Node，比 pdd-client 浏览器通道快约 180 倍',
}
