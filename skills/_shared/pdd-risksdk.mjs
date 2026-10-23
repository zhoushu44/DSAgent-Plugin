/**
 * PDD 真签名通道（risk-sdk）
 *
 * 从页面加载 RiskSDK 模块，生成真签名（407~418 字符），
 * 然后纯 Node 发请求。覆盖所有严格接口。
 *
 * ══════════════════════════════════════════════════════════════════
 * 三道门（缺一不可）
 * ══════════════════════════════════════════════════════════════════
 *   ① 真签名   RiskSDK.messagePack()  → 407~418 字符，以 "0as" 开头
 *   ② webSpiderRule  99 字符，只有 queryGoodsDetailVOListForMMS 和
 *      queryGoodsPageOverView 需要
 *   ③ 完整 Cookie  必须含 httpOnly 的 PASS_ID → 用 CDP Network.getCookies
 *
 * ══════════════════════════════════════════════════════════════════
 * PUA 数字混淆解码（全局统一映射，10 码点，0 冲突）
 * ══════════════════════════════════════════════════════════════════
 *   [E510]→0  [ECB2]→1  [EA55]→2  [E690]→3  [E409]→4
 *   [E8C8]→5  [E515]→6  [EDC8]→7  [EFE8]→8  [E4CD]→9
 *
 *   验证方法：用 *Ppr（明文上期值）与 PUA 字段逐位对齐
 *   93 对证据，0 冲突 → 全局统一映射
 */

/** PUA → 数字映射（全局统一，实测 0 冲突） */
export const PUA_MAP = {
  0xE510: '0', 0xECB2: '1', 0xEA55: '2', 0xE690: '3', 0xE409: '4',
  0xE8C8: '5', 0xE515: '6', 0xEDC8: '7', 0xEFE8: '8', 0xE4CD: '9',
}

/**
 * 解码 PUA 字符串为数字字符串
 * @param {string} v 含 PUA 字符的值
 * @returns {string}
 */
export function decodePua(v) {
  if (typeof v !== 'string') return v == null ? '' : String(v)
  let out = ''
  for (const c of v) {
    const p = c.codePointAt(0)
    if (p >= 0xE000 && p <= 0xF8FF) out += (PUA_MAP[p] ?? '')
    else out += c
  }
  return out
}

/** 解码为数字，失败返回 null */
export function decodePuaNum(v) {
  const s = decodePua(v)
  const n = parseFloat(s.replace(/[^\d.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** 检测是否含 PUA 字符 */
export function hasPua(v) {
  if (typeof v !== 'string') return false
  for (const c of v) {
    const p = c.codePointAt(0)
    if (p >= 0xE000 && p <= 0xF8FF) return true
  }
  return false
}

/**
 * 在页面上下文里注入「加载 eDaA 模块 + 生成签名」的能力
 * 必须在 page.goto 之前调用（evaluateOnNewDocument）
 */
export const RISK_SDK_INJECT = () => {
  // ① 拦截所有 webpackJsonp 实例，收集模块
  window.__pddWpAll = {}
  const hooked = new Set()
  function hookArray(arr, name) {
    if (!arr || !Array.isArray(arr) || hooked.has(name)) return
    hooked.add(name)
    if (!window.__pddWpAll[name]) window.__pddWpAll[name] = { modules: {} }
    const store = window.__pddWpAll[name]
    const op = arr.push.bind(arr)
    arr.push = function (...items) {
      for (const item of items) {
        try {
          if (Array.isArray(item) && item[1] && typeof item[1] === 'object') {
            for (const [id, fn] of Object.entries(item[1])) {
              if (typeof fn === 'function') store.modules[id] = fn
            }
          }
        } catch { /* ignore */ }
      }
      return op(...items)
    }
  }
  function scan() {
    for (const k of Object.getOwnPropertyNames(window)) {
      if (/^webpackJsonp/.test(k) && window[k]) hookArray(window[k], k)
    }
  }
  scan(); setInterval(scan, 30)

  // ② 捕获 webSpiderRule
  window.__pddSpiderRule = null
  try {
    const OX = XMLHttpRequest.prototype.setRequestHeader
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
      if (/^webspiderrule$/i.test(k) && !window.__pddSpiderRule) window.__pddSpiderRule = String(v)
      return OX.apply(this, arguments)
    }
  } catch { /* ignore */ }
  // fetch 侧
  try {
    const OF = window.fetch
    window.fetch = function (input, init) {
      try {
        const h = init && init.headers
        if (h) {
          const get = (n) => (typeof h.get === 'function' ? h.get(n) : (h[n] ?? h[n.toLowerCase()]))
          const v = get('webSpiderRule') || get('webspiderrule')
          if (v && !window.__pddSpiderRule) window.__pddSpiderRule = String(v)
        }
      } catch { /* ignore */ }
      return OF.apply(this, arguments)
    }
  } catch { /* ignore */ }

  // ③ 生成真签名（暴露给 Node 调）
  window.__pddGenRiskSig = async function () {
    try {
      const all = window.__pddWpAll || {}
      const mods = {}
      for (const s of Object.values(all)) Object.assign(mods, s.modules)
      if (!mods['eDaA']) return { err: 'eDaA module not found', moduleCount: Object.keys(mods).length }

      const cache = {}
      function R(id) {
        if (cache[id]) return cache[id].exports
        const m = cache[id] = { i: id, l: false, exports: {} }
        mods[id].call(m.exports, m, m.exports, R)
        m.l = true
        return m.exports
      }
      R.m = mods; R.c = cache
      R.d = (e, n, g) => { if (!R.o(e, n)) Object.defineProperty(e, n, { enumerable: true, get: g }) }
      R.r = (e) => { Object.defineProperty(e, '__esModule', { value: true }) }
      R.n = (m) => { const g = m && m.__esModule ? () => m['default'] : () => m; R.d(g, 'a', g); return g }
      R.o = (o, p) => Object.prototype.hasOwnProperty.call(o, p)
      R.p = ''; R.s = undefined

      const exp = R('eDaA')
      const Ctor = exp.default || exp
      if (typeof Ctor !== 'function') return { err: 'eDaA default is not a constructor' }

      const tb = window.mmsCMT?.timeBaseline
      const serverTime = tb ? (tb.serverTime + (Date.now() - tb.localTime)) : Date.now()

      const sdk = new Ctor({ serverTime, _2827c887a48a351a: false })
      sdk.init(null)
      const sig = await sdk.messagePack({
        touchEventData: true, clickEventData: true, focusblurEventData: true,
        changeEventData: true, locationInfo: true, referrer: true,
        browserSize: true, browserInfo: true, token: true, fingerprint: true,
      })
      try { sdk.clearCache() } catch { /* ignore */ }
      return { ok: true, sig: String(sig), len: String(sig).length, serverTime, hasTimeBaseline: !!tb }
    } catch (e) {
      return { err: String(e).slice(0, 200) }
    }
  }

  // ④ ★ 后台预热：页面加载完就自动生成一份签名缓存
  //    这样 Node 侧调用时不需要再 evaluate（避开 detached Frame）
  setTimeout(async () => {
    for (let i = 0; i < 30; i++) {
      const all = window.__pddWpAll || {}
      let ready = false
      for (const s of Object.values(all)) {
        if (s.modules && s.modules['eDaA']) { ready = true; break }
      }
      if (!ready) { await new Promise(r => setTimeout(r, 2000)); continue }
      try {
        const r = await window.__pddGenRiskSig()
        if (r && r.ok) { window.__pddSigCache = { sig: r.sig, len: r.len, at: Date.now() } }
      } catch { /* ignore */ }
      return
    }
  }, 3000)

  // ⑤ ★ 自动保持签名新鲜（每 3 分钟刷新一次，token 有效期 10 分钟）
  setInterval(async () => {
    try {
      const r = await window.__pddGenRiskSig()
      if (r && r.ok) window.__pddSigCache = { sig: r.sig, len: r.len, at: Date.now() }
    } catch { /* ignore */ }
  }, 180000)
}
