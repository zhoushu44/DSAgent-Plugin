/**
 * PDD 真签名通道（risk-sdk）
 *
 * 从页面加载 RiskSDK 模块，生成真签名（407~418 字符），
 * 然后纯 Node 发请求。覆盖所有严格接口。
 *
 * 三道门（缺一不可）：
 *   1. 真签名   RiskSDK.messagePack()  -> 407~418 字符，以 "0as" 开头
 *   2. webSpiderRule  99 字符，只有 queryGoodsDetailVOListForMMS 和
 *      queryGoodsPageOverView 需要
 *   3. 完整 Cookie  必须含 httpOnly 的 PASS_ID -> 用 CDP Network.getCookies
 *
 * =====================================================================
 * PUA 数字混淆解码
 * =====================================================================
 *   2026-10-27 修：码点是**动态**的，不是全局固定！
 *
 *   旧版静态表（2026-10 早期，某账号某次响应）：
 *     [E510]->0  [ECB2]->1  [EA55]->2  [E690]->3  [E409]->4
 *     [E8C8]->5  [E515]->6  [EDC8]->7  [EFE8]->8  [E4CD]->9
 *
 *   2026-10-27 爱绿森账号实测：
 *     [E573]->0  [E5F2]->1  [E979]->2  [EE03]->3  [E4AD]->4
 *     [E7BB]->5  [E414]->6  [EB06]->7  [E6B1]->8  [E3F8]->9
 *
 *   -> 静态表会把 goodsUv/goodsVcr 解成空串或 0%，必须**动态推导**。
 *
 *   推导方法：同一响应里 <X>Ppr 字段是明文的「较上周期值」，
 *   与被混淆的 <X> 字段等长同构 -> 逐字符对齐投票，取众数。
 *   证据强度：E573 拿到 187 票（对立票仅 2+1），可信。
 *
 *   buildPuaMap() 即干这件事；decodePua(v) 无 map 时退回静态表。
 * =====================================================================
 */

/** 静态兜底映射（仅当动态推导失败时用；不同账号/时段可能失效） */
export const PUA_MAP_STATIC = {
  0xE510: '0', 0xECB2: '1', 0xEA55: '2', 0xE690: '3', 0xE409: '4',
  0xE8C8: '5', 0xE515: '6', 0xEDC8: '7', 0xEFE8: '8', 0xE4CD: '9',
}

/** 兼容旧导出名（指向静态兜底表） */
export const PUA_MAP = PUA_MAP_STATIC

/** 12 组核心字段对：<混淆字段> <-> <明文字段>（等长同构，用于推导映射） */
export const PUA_PAIRS = [
  ['goodsUv', 'goodsUvPpr'], ['goodsPv', 'goodsPvPpr'], ['payOrdrCnt', 'payOrdrCntPpr'],
  ['goodsFavCnt', 'goodsFavCntPpr'], ['payOrdrAmt', 'payOrdrAmtPpr'], ['cfmOrdrCnt', 'cfmOrdrCntPpr'],
  ['imprUsrCnt', 'imprUsrCntPpr'], ['ordrCrtUsrCnt', 'ordrCrtUsrCntPpr'], ['cnsltUsrQty', 'cnsltUsrQtyPpr'],
  ['payOrdrGoodsQty', 'payOrdrGoodsQtyPpr'], ['payOrdrUsrCnt', 'payOrdrUsrCntPpr'], ['cfmOrdrGoodsQty', 'cfmOrdrGoodsQtyPpr'],
]

const PUASET_RE = /[\uE000-\uF8FF]/
const isPuaCp = (p) => p >= 0xE000 && p <= 0xF8FF

/**
 * 从响应数据动态推导 PUA 映射（码点 -> 数字）
 *
 * @param {object[]} list goodsDetailList 或任意含 <X>/<X>Ppr 字段对的对象数组
 * @returns {{map: Object, coverage: {total:number, agreed:number}, conflicts: Array}}
 */
export function buildPuaMap(list) {
  const votes = {}   // codepoint -> {digit: count}
  if (!Array.isArray(list)) return { map: {}, coverage: { total: 0, agreed: 0 }, conflicts: [] }

  const addPair = (pua, plain) => {
    if (typeof pua !== 'string' || plain == null) return
    const ps = String(plain)
    if (ps.length !== pua.length) return
    for (let i = 0; i < pua.length; i++) {
      const pc = pua.codePointAt(i)
      if (!isPuaCp(pc)) continue
      const ch = ps[i]
      if (!/\d/.test(ch)) continue          // 只收数字位，挡小数点/百分号
      votes[pc] = votes[pc] || {}
      votes[pc][ch] = (votes[pc][ch] || 0) + 1
    }
  }

  // 1) 12 组核心 PAIRS（最可靠，先建）
  for (const g of list) {
    if (!g || typeof g !== 'object') continue
    for (const [f, pf] of PUA_PAIRS) addPair(g[f], g[pf])
  }
  // 2) 补漏：同名前缀 <X> <-> <X>Ppr 等长对齐（覆盖 goodsVcr/ordrVstrRto 等）
  for (const g of list) {
    if (!g || typeof g !== 'object') continue
    for (const k of Object.keys(g)) {
      if (!k.endsWith('Ppr')) continue
      const base = k.slice(0, -3)
      if (typeof g[base] === 'string' && PUASET_RE.test(g[base])) addPair(g[base], g[k])
    }
  }

  const map = {}
  const conflicts = []
  for (const pc of Object.keys(votes).map(Number).sort((a, b) => a - b)) {
    const v = votes[pc]
    const sorted = Object.entries(v).sort((a, b) => b[1] - a[1])
    map[pc] = sorted[0][0]
    if (sorted.length > 1) conflicts.push({ codepoint: pc, hex: '0x' + pc.toString(16).toUpperCase(), votes: v })
  }
  return { map, coverage: { total: Object.keys(votes).length, agreed: Object.keys(map).length }, conflicts }
}

/**
 * 解码 PUA 字符串
 * @param {string} v 含 PUA 字符的值
 * @param {Object} [map] 动态推导的映射；不传则用静态兜底表
 * @returns {string}
 */
export function decodePua(v, map) {
  if (typeof v !== 'string') return v == null ? '' : String(v)
  const m = map || PUA_MAP_STATIC
  let out = ''
  for (const c of v) {
    const p = c.codePointAt(0)
    if (isPuaCp(p)) out += (m[p] ?? PUA_MAP_STATIC[p] ?? '')
    else out += c
  }
  return out
}

/** 解码为数字，失败返回 null */
export function decodePuaNum(v, map) {
  const s = decodePua(v, map)
  const n = parseFloat(s.replace(/[^\d.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** 检测是否含 PUA 字符 */
export function hasPua(v) {
  if (typeof v !== 'string') return false
  return PUASET_RE.test(v)
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
