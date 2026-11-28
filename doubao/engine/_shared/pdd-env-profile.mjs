/**
 * pdd-env-profile.mjs - 推广域环境画像（抓取 → 种子 → jsdom 回放）
 *
 * 背景（2026-11-09 实测）：
 *   我们磁盘上的 promo-sdk.mjs 代码是**对的**（同一份代码放进真实浏览器 → 签名有效 HTTP 200）；
 *   失败原因是 **jsdom 环境与真实浏览器不一致**，签名内容对不上 → 54001 / mikasaErrorCode:12。
 *
 *   关键差异（真实浏览器 vs jsdom）：
 *     - document.cookie     SDK 直接读，值参与指纹
 *     - document.referrer   SDK 直接读
 *     - document.visibilityState
 *     - localStorage / sessionStorage  **按源隔离**，mms 的种子不能用于 yingxiao
 *     - window.name         SDK 把设备指纹状态编码在这里
 *     - canvas.toDataURL    设备级指纹，jsdom 无法光栅化，必须抓真值回放
 *     - webgl renderer      含设备 ID (0x000021C4)，必须抓真值
 *     - navigator.plugins / mimeTypes  真实 Chrome 5 个 PDF 插件，jsdom 只有 1 个
 *     - window 几何 / screen 几何
 *     - navigator.userAgentData
 *
 * 用法：
 *   const profile = await captureEnvProfile(page)      // 浏览器内执行
 *   applyEnvProfile(jsdomWindow, profile)               // 回放到 jsdom
 */

export const PROFILE_VERSION = 3

/* ─────────────────────────── 抓取（浏览器内） ─────────────────────────── */

export async function captureEnvProfile(page, opts = {}) {
  const profile = await page.evaluate(async () => {
    const sv = (v) => {
      try {
        if (v === null) return 'null'
        if (v === undefined) return 'undef'
        if (typeof v === 'function') return 'fn:' + (v.name || '')
        if (typeof v === 'object') return JSON.stringify(v)
        return String(v)
      } catch (e) { return '<err:' + String(e && e.message).slice(0, 40) + '>' }
    }
    const out = {}

    // ── document ──
    const doc = {}
    for (const k of ['cookie', 'referrer', 'domain', 'title', 'URL', 'documentURI',
      'visibilityState', 'readyState', 'characterSet', 'compatMode', 'contentType']) {
      try { doc[k] = sv(document[k]) } catch (e) { doc[k] = '<err>' }
    }
    out.doc = doc

    // ── navigator ──
    const nav = {}
    for (const k of ['userAgent', 'appVersion', 'appName', 'appCodeName', 'platform',
      'product', 'productSub', 'vendor', 'vendorSub', 'language', 'languages', 'onLine',
      'cookieEnabled', 'doNotTrack', 'pdfViewerEnabled', 'maxTouchPoints',
      'hardwareConcurrency', 'deviceMemory', 'webdriver', 'javaEnabled']) {
      try { nav[k] = sv(navigator[k]) } catch (e) { nav[k] = '<err>' }
    }
    try { nav.userAgentData = navigator.userAgentData ? {
      brands: Array.from(navigator.userAgentData.brands || []).map(b => ({ brand: b.brand, version: b.version })),
      mobile: navigator.userAgentData.mobile,
      platform: navigator.userAgentData.platform,
      getHighEntropyValues: null,
    } : null } catch (e) { nav.userAgentData = null }
    try {
      nav.plugins = Array.from(navigator.plugins || []).map(p => ({
        name: p.name, filename: p.filename, description: p.description, length: p.length,
        // 索引成员（该插件支持的 MIME 类型）—— 必须一起抓，JSON.stringify 形态要对齐
        items: Array.from(p).map(m => ({ type: m.type, suffixes: m.suffixes, description: m.description })),
      }))
      nav.mimeTypes = Array.from(navigator.mimeTypes || []).map(m => ({
        type: m.type, suffixes: m.suffixes, description: m.description,
        enabledPlugin: m.enabledPlugin ? m.enabledPlugin.name : null,
      }))
    } catch (e) { nav.plugins = []; nav.mimeTypes = [] }
    out.nav = nav

    // ── screen ──
    const scr = {}
    for (const k of ['width', 'height', 'availWidth', 'availHeight', 'availLeft', 'availTop',
      'colorDepth', 'pixelDepth']) {
      try { scr[k] = sv(screen[k]) } catch (e) { scr[k] = '<err>' }
    }
    try { scr.orientation = { type: screen.orientation && screen.orientation.type, angle: screen.orientation && screen.orientation.angle } } catch (e) { scr.orientation = null }
    out.scr = scr

    // ── window ──
    const win = {}
    for (const k of ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'screenX', 'screenY',
      'screenLeft', 'screenTop', 'devicePixelRatio', 'closed', 'isSecureContext', 'name', 'origin']) {
      try { win[k] = sv(window[k]) } catch (e) { win[k] = '<err>' }
    }
    try {
      win.location = { href: location.href, origin: location.origin, protocol: location.protocol,
        host: location.host, hostname: location.hostname, pathname: location.pathname,
        search: location.search, hash: location.hash }
    } catch (e) { win.location = {} }
    // chrome 对象：真实浏览器**没有** runtime（除非扩展环境），jsdom 伪造时容易多带
    try {
      win.chromeKeys = Object.keys(window.chrome || {})
      win.chromeHasRuntime = !!(window.chrome && window.chrome.runtime)
    } catch (e) { win.chromeKeys = []; win.chromeHasRuntime = false }
    out.win = win

    // ── storage ──
    const ls = {}, ss = {}
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k) } } catch (e) { }
    try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); ss[k] = sessionStorage.getItem(k) } } catch (e) { }
    out.storage = { localStorage: ls, sessionStorage: ss }

    // ── canvas：抓真实 dataURL + 记录绘制操作（回放时按操作签名匹配）──
    out.canvas = []
    try {
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL
      HTMLCanvasElement.prototype.toDataURL = function (...args) {
        const url = origToDataURL.apply(this, args)
        try {
          const rec = { w: this.width, h: this.height, type: args[0] || 'image/png', dataURL: url }
          out.canvas.push(rec)
          // SDK 跑完后由外部读取（此时列表才非空）
          try { (window.__PDD_CANVAS_LIST__ || (window.__PDD_CANVAS_LIST__ = [])).push(rec) } catch (e) { }
        } catch (e) { }
        return url
      }
      window.__PDD_CANVAS_LIST__ = out.canvas
      window.__PDD_CANVAS_CAPTURE__ = true
    } catch (e) { }

    // ── webgl ──
    out.webgl = null
    try {
      const c = document.createElement('canvas')
      const g = c.getContext('webgl') || c.getContext('experimental-webgl')
      if (g) {
        const dbg = g.getExtension('WEBGL_debug_renderer_info')
        const params = {}
        for (const p of [7936, 7937, 7938, 35724, 37445, 37446, 3379, 34047, 34921, 35660, 35661, 36347, 36348, 35657, 35658, 35661, 36349]) {
          try { params[p] = sv(g.getParameter(p)) } catch (e) { }
        }
        out.webgl = {
          renderer: dbg ? sv(g.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : sv(g.getParameter(g.RENDERER)),
          vendor: dbg ? sv(g.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : sv(g.getParameter(g.VENDOR)),
          version: sv(g.getParameter(g.VERSION)),
          shadingLang: sv(g.getParameter(g.SHADING_LANGUAGE_VERSION)),
          params,
          extensions: (() => { try { return g.getSupportedExtensions() || [] } catch (e) { return [] } })(),
        }
      }
    } catch (e) { }

    // ── media canPlayType ──
    out.media = {}
    try {
      const m = document.createElement('video')
      for (const t of ['audio/mpeg', 'audio/mp4', 'video/mp4', 'video/webm', 'application/vnd.apple.mpegurl']) {
        out.media[t] = m.canPlayType(t)
      }
    } catch (e) { }

    // ★ 钩住 canPlayType：SDK 探测的 MIME 类型是混淆串，预置列表必然覆盖不全。
    //   这里记录 SDK **实际问过**哪些类型及其真实答案，回放时精确命中，
    //   否则 jsdom 对未知类型返回 '' → SDK 走进 MediaSource.isTypeSupported 兜底分支
    //   → 指纹与浏览器主路径不同 → 服务端判参数异常。
    try {
      const origCPT = HTMLMediaElement.prototype.canPlayType
      const PROBES = []
      window.__PDD_MEDIA_PROBES__ = PROBES
      HTMLMediaElement.prototype.canPlayType = function (t) {
        const r = origCPT.call(this, t)
        try { PROBES.push({ type: String(t), result: String(r) }) } catch (e) { }
        return r
      }
    } catch (e) { }

    // ── matchMedia ──
    out.mediaQueries = {}
    try {
      for (const q of ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)',
        '(hover: hover)', '(pointer: fine)', '(any-pointer: coarse)', '(display-mode: browser)']) {
        out.mediaQueries[q] = matchMedia(q).matches
      }
    } catch (e) { }

    return out
  })

  profile.version = PROFILE_VERSION
  profile.capturedAt = new Date().toISOString()
  profile.url = opts.url || ''
  return profile
}

/* ─────────────────────────── 回放（jsdom） ─────────────────────────── */

function def(w, obj, key, value) {
  try { Object.defineProperty(obj, key, { get: () => value, configurable: true }) } catch (e) { }
}

/**
 * ★ 把属性挂到**原型**上，并删掉实例上的自有属性。
 *
 * 【为什么必须这样】
 *   真实 Chrome 里 navigator.screen / document 的这些属性都在**原型**上，
 *   实例本身没有自有属性 → `navigator.hasOwnProperty('webdriver')` 返回 **false**。
 *
 *   拼多多 SDK 正是用 `navigator.hasOwnProperty(...)` 做**反篡改检测**：
 *   如果发现 navigator 的属性全成了实例自有属性，就知道环境被改过 →
 *   指纹走另一条分支 → 签名与服务端算法对不上 → 54001 拒签。
 *
 *   实测（2026-11-09）：jsdom 伪装后 own=true，Chrome own=false，
 *   这是纯 Node 签名被拒的**根因**。
 */
function defProto(w, obj, key, value) {
  try {
    const proto = Object.getPrototypeOf(obj)
    if (!proto) { def(w, obj, key, value); return }
    // ① 删掉实例上的自有属性（如果有）
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      try { delete obj[key] } catch (e) { }
      // 删不掉（非 configurable）→ 至少把值改成对的
      try { Object.defineProperty(obj, key, { value, configurable: true, enumerable: true }) } catch (e) { }
    }
    // ② 定义到原型上（与 Chrome 一致：own=false）
    Object.defineProperty(proto, key, { get: () => value, configurable: true })
  } catch (e) { }
}

/**
 * 把环境画像应用到 jsdom window。
 * 注意：必须在 initPromoV2 之后调用（V2 已经建好基础环境），本函数做**覆盖**。
 */
export function applyEnvProfile(w, profile) {
  if (!profile || !profile.doc) return false
  const applied = []

  // ── document.cookie / referrer / visibilityState ──
  //   ★ 挂原型（Chrome 里这些也在 Document.prototype 上，实例无自有属性）
  const cookie = String(profile.doc.cookie ?? '')
  try {
    defProto(w, w.document, 'cookie', cookie)
    Object.defineProperty(w.document, 'cookie', { get: () => cookie, configurable: true, set: () => { } })
    applied.push('document.cookie')
  } catch (e) { }
  defProto(w, w.document, 'referrer', String(profile.doc.referrer ?? ''))
  defProto(w, w.document, 'visibilityState', String(profile.doc.visibilityState ?? 'visible'))

  // ── storage（先清后写，保证与浏览器一致）──
  const ls = profile.storage?.localStorage || {}
  const ss = profile.storage?.sessionStorage || {}
  try {
    w.localStorage.clear()
    for (const [k, v] of Object.entries(ls)) w.localStorage.setItem(k, String(v))
    applied.push(`localStorage(${Object.keys(ls).length})`)
  } catch (e) { }
  try {
    w.sessionStorage.clear()
    for (const [k, v] of Object.entries(ss)) w.sessionStorage.setItem(k, String(v))
    applied.push(`sessionStorage(${Object.keys(ss).length})`)
  } catch (e) { }

  // ── window.name + 几何 ──
  try { w.name = String(profile.win?.name ?? '') } catch (e) { }
  for (const k of ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'screenX', 'screenY',
    'screenLeft', 'screenTop', 'devicePixelRatio']) {
    const v = profile.win?.[k]
    if (v === undefined || v === '<err>') continue
    const num = Number(v)
    def(w, w, k, Number.isFinite(num) ? num : v)
  }
  def(w, w, 'closed', profile.win?.closed === 'false' ? false : profile.win?.closed)
  def(w, w, 'isSecureContext', profile.win?.isSecureContext === 'true' ? true : profile.win?.isSecureContext)

  // ── window.chrome：真实浏览器无 runtime，伪造时多带就是破绽 ──
  try {
    if (w.chrome && profile.win && profile.win.chromeHasRuntime === false && w.chrome.runtime) {
      delete w.chrome.runtime
      applied.push('chrome.runtime-')
    }
  } catch (e) { }

  // ── screen ──
  for (const k of ['width', 'height', 'availWidth', 'availHeight', 'availLeft', 'availTop', 'colorDepth', 'pixelDepth']) {
    const v = profile.scr?.[k]
    if (v === undefined || v === '<err>') continue
    const num = Number(v)
    defProto(w, w.screen, k, Number.isFinite(num) ? num : v)
  }
  if (profile.scr?.orientation) {
    defProto(w, w.screen, 'orientation', profile.scr.orientation)
  }

  // ── navigator ──
  const nav = profile.nav || {}
  for (const [k, v] of Object.entries(nav)) {
    if (v === undefined || v === '<err>') continue
    // ★ webdriver 永远为 false：真实浏览器不可能是 true，true 等于自曝自动化
    if (k === 'webdriver') { defProto(w, w.navigator, k, false); continue }
    if (v === 'undef') { defProto(w, w.navigator, k, undefined); continue }
    if (v === 'null') { defProto(w, w.navigator, k, null); continue }
    const num = Number(v)
    defProto(w, w.navigator, k, (k === 'hardwareConcurrency' || k === 'deviceMemory' || k === 'maxTouchPoints') && Number.isFinite(num) ? num : v)
  }
  if (nav.userAgentData) {
    const ud = nav.userAgentData
    defProto(w, w.navigator, 'userAgentData', {
      brands: ud.brands || [], mobile: !!ud.mobile, platform: ud.platform,
      getHighEntropyValues: async () => ({}),
      toJSON: () => ({ brands: ud.brands || [], mobile: !!ud.mobile, platform: ud.platform }),
    })
  }

  // ── plugins / mimeTypes ──
  // ★ 关键：浏览器的 PluginArray **不是数组**，JSON.stringify → {"0":{...},"1":{...}}
  //   而每个 Plugin 的 name/filename/description 在**原型 getter** 上（不可枚举），
  //   JSON.stringify(plugin) → {"0":{},"1":{}}（只剩索引成员）。
  //   若做成真数组 + 自身可枚举属性，SDK 内部 JSON.stringify(navigator.plugins) 就对不上 → 指纹变。
  if (Array.isArray(nav.plugins)) {
    const mkMime = (m, enabledPluginName) => Object.create({
      get type() { return m.type },
      get suffixes() { return m.suffixes },
      get description() { return m.description },
      get enabledPlugin() { return enabledPluginName || null },
    })
    const pluginObjects = nav.plugins.map((p) => {
      const proto = {
        get name() { return p.name },
        get filename() { return p.filename },
        get description() { return p.description },
      }
      const obj = Object.create(proto)
      const items = Array.isArray(p.items) ? p.items : []
      items.forEach((m, j) => { obj[j] = mkMime(m, p.name) })
      Object.defineProperty(obj, 'length', { value: items.length, configurable: true })
      return obj
    })
    const mkCollection = (items) => {
      const o = Object.create({
        item(i) { return this[i] !== undefined ? this[i] : null },
        namedItem(n) { return this[n] !== undefined ? this[n] : null },
        refresh() { },
      })
      items.forEach((x, i) => { o[i] = x })
      Object.defineProperty(o, 'length', { value: items.length, configurable: true })
      return o
    }
    const plugins = mkCollection(pluginObjects)
    const mimeObjects = (nav.mimeTypes || []).map((m) => {
      const owner = pluginObjects.find((p) => p.name === m.enabledPlugin) || pluginObjects[0]
      return mkMime(m, owner ? owner.name : null)
    })
    const mimes = mkCollection(mimeObjects)
    defProto(w, w.navigator, 'plugins', plugins)
    defProto(w, w.navigator, 'mimeTypes', mimes)
    applied.push(`plugins(${nav.plugins.length})`)
  }

  // ── webgl（真实 renderer 含设备 ID）──
  if (profile.webgl) {
    const gl = profile.webgl
    const params = { ...gl.params }
    params[37445] = gl.vendor
    params[37446] = gl.renderer
    params[7936] = 'WebKit'; params[7937] = 'WebKit WebGL'
    params[7938] = gl.version || 'WebGL 1.0 (OpenGL ES 2.0 Chromium)'
    params[35724] = gl.shadingLang || 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)'
    const origGetContext = w.HTMLCanvasElement.prototype.getContext
    w.HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl' || type === 'experimental-webgl') {
        return {
          getParameter: (p) => (params[p] !== undefined ? params[p] : 0),
          getExtension: (n) => (n === 'WEBGL_debug_renderer_info'
            ? { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 } : null),
          getSupportedExtensions: () => gl.extensions || [],
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
      return origGetContext.call(this, type, ...args)
    }
    applied.push('webgl')
  }

  // ── canvas：回放真实 dataURL（按 w×h 匹配，取不到则用第一条）──
  if (Array.isArray(profile.canvas) && profile.canvas.length) {
    const list = profile.canvas
    const origToDataURL = w.HTMLCanvasElement.prototype.toDataURL
    w.HTMLCanvasElement.prototype.toDataURL = function (type, ...rest) {
      const hit = list.find((c) => c.w === this.width && c.h === this.height)
      const pick = hit || list[0]
      if (pick && pick.dataURL) return pick.dataURL
      return origToDataURL.call(this, type, ...rest)
    }
    applied.push(`canvas(${list.length})`)
  }

  // ── media canPlayType ──
  if (profile.media && Object.keys(profile.media).length) {
    const table = profile.media
    w.HTMLMediaElement.prototype.canPlayType = function (t) {
      const key = String(t)
      if (table[key] !== undefined) return table[key]
      // 未知类型：Chrome 对常见音视频格式基本都支持，返回 'maybe' 才是真实行为。
      // ★ 返回 '' 会让 SDK 走 MediaSource.isTypeSupported 兜底分支（指纹不同）→ 必须避免
      const low = key.toLowerCase()
      if (/^(audio|video)\//.test(low)) return 'maybe'
      if (/^application\/(vnd\.apple\.mpegurl|x-mpegurl)/.test(low)) return 'maybe'
      return ''
    }
    applied.push(`media(${Object.keys(table).length})`)
  }

  // ── 补齐缺失的全局构造器 ──
  const stubs = {
    matchMedia: (q) => ({
      media: q, matches: !!profile.mediaQueries?.[q],
      onchange: null, addListener() { }, removeListener() { },
      addEventListener() { }, removeEventListener() { }, dispatchEvent: () => false,
    }),
    ResizeObserver: function () { this.observe = () => { }; this.unobserve = () => { }; this.disconnect = () => { } },
    IntersectionObserver: function () { this.observe = () => { }; this.unobserve = () => { }; this.disconnect = () => { }; this.takeRecords = () => [] },
    MutationObserver: w.MutationObserver || function () { this.observe = () => { }; this.disconnect = () => { }; this.takeRecords = () => [] },
    Worker: function () { this.postMessage = () => { }; this.terminate = () => { }; this.onmessage = null },
    SharedWorker: function () { this.port = { postMessage: () => { }, start: () => { }, close: () => { } } },
    RTCPeerConnection: function () { this.createDataChannel = () => ({}); this.close = () => { }; this.getStats = async () => [] },
    speechSynthesis: { speak() { }, cancel() { }, getVoices: () => [], addEventListener() { }, removeEventListener() { } },
    indexedDB: { open: () => ({ }) },
    caches: { open: async () => ({ }) },
  }
  for (const [k, v] of Object.entries(stubs)) {
    if (w[k] === undefined || w[k] === null) { try { w[k] = v } catch (e) { } }
  }

  return applied
}

export default { captureEnvProfile, applyEnvProfile, PROFILE_VERSION }
