/**
 * yingxiao（推广域）RiskSDK 签名器
 *
 * ══════════════════════════════════════════════════════════════════
 * 与 mms 的差异
 * ══════════════════════════════════════════════════════════════════
 *
 *   mms（主站）      webpackJsonp 数组 + 字符串模块 ID（eDaA）
 *   yingxiao（推广） Next.js webpack + 数字模块 ID（23727）
 *                   且 window 上无 webpackJsonp / mmsCMT
 *
 * 签名长度也不同：
 *   mms       407~418 字符
 *   yingxiao  427~538 字符（实测抓到 427，样本分布 451~538）
 *
 * ══════════════════════════════════════════════════════════════════
 * 关键源码（static.pddpic.com/ad-static/mains/_next/.../_app.js @467272）
 * ══════════════════════════════════════════════════════════════════
 *
 *   var _ = () => h(m).then(e => e.messagePackSync().then(e => e).catch(() => "")).catch(() => "")
 *
 *   // msfe-*.js @401619 —— 官方 10 域打包
 *   O = function (e, t) {
 *     return r.messagePackSync({
 *       touchEventData: !0, clickEventData: !0, focusblurEventData: !1,
 *       changeEventData: !0, locationInfo: !0, referrer: !0,
 *       browserSize: !0, browserInfo: !0, token: !0, fingerprint: !0
 *     })
 *   }
 *
 * ⚠️ 注意推广域的 focusblurEventData 官方是 false（与 mms 不同）
 *
 * ══════════════════════════════════════════════════════════════════
 * 模块定位策略
 * ══════════════════════════════════════════════════════════════════
 *
 * 推广域不用 webpackJsonp，改用 Next.js 的 `__NEXT_DATA__` +
 * 内联 webpack runtime。模块只能从**已加载 script 的源码**里找。
 *
 * 实测可行路径：
 *   ① CDP Debugger.getScriptSource 拿 msfe-*.js 源码
 *   ② 在页面里 new Function(源码) 执行，拿到模块工厂
 *   ③ 但更简单：页面已加载完，模块工厂在闭包里
 *
 * 所以采用：**hook webpack require**。
 *   Next.js 的 webpack runtime 会暴露 __webpack_require__ 到
 *   chunks 内部，但不在 window 上。
 *   破解办法：在 msfe-*.js 源码末尾追加导出代码，重新注入执行。
 */

/** 推广域签名的 10 域配置（官方原文，focusblur 是 false） */
export const YINGXIAO_DOMAINS = {
  touchEventData: true,
  clickEventData: true,
  focusblurEventData: false,     // ★ 推广域与 mms 不同
  changeEventData: true,
  locationInfo: true,
  referrer: true,
  browserSize: true,
  browserInfo: true,
  token: true,
  fingerprint: true,
}

/** mms 域的 10 域配置（focusblur 是 true） */
export const MMS_DOMAINS = {
  touchEventData: true,
  clickEventData: true,
  focusblurEventData: true,
  changeEventData: true,
  locationInfo: true,
  referrer: true,
  browserSize: true,
  browserInfo: true,
  token: true,
  fingerprint: true,
}

/**
 * 推广域签名注入器
 *
 * 做法：hook `fetch` 与 `XMLHttpRequest`，在请求发出前
 * 从「页面自己生成的签名」里偷一份复用。
 *
 * 这不是生成，而是**复用页面即将使用的签名**——官方每次请求
 * 都会新建一个（clearCache），所以复用窗口极短。
 * 更可靠的做法见 genYingxiaoSig：现场加载 msfe 模块。
 */
export const YINGXIAO_HIJACK = () => {
  // ① 缓存页面最近一次使用的 anti-content（有极短复用价值）
  window.__yxSigCache = null

  const grab = (v) => {
    if (typeof v === 'string' && v.length > 300) {
      window.__yxSigCache = { sig: v, at: Date.now() }
    }
  }

  // hook setRequestHeader
  const OS = XMLHttpRequest.prototype.setRequestHeader
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (/^anti-?content$/i.test(k)) grab(v)
    return OS.apply(this, arguments)
  }
  // hook fetch
  const OF = window.fetch
  window.fetch = function (input, init) {
    try {
      const h = init && init.headers
      if (h) {
        const get = (n) => (typeof h.get === 'function' ? h.get(n) : (h[n] ?? h[n.toLowerCase()]))
        grab(get('anti-content') || get('Anti-Content'))
      }
    } catch { /* ignore */ }
    return OF.apply(this, arguments)
  }
}

/**
 * ★ 推广域签名生成（现场加载 msfe 模块）
 *
 * 思路：
 *   ① CDP 拿 msfe-*.js 源码
 *   ② 在页面里用 new Function 包一层，末尾追加 `return {Ctor: <构造函数>}`
 *   ③ 但模块内部构造函数名是混淆的，不可直接引用
 *
 * 所以改用**黑盒探测**：源码里搜 `messagePackSync` 定义处，
 * 取其所在的模块工厂，执行后遍历 exports 找有 messagePackSync 的类。
 */
export const YINGXIAO_GEN_SRC = `async () => {
  // 页面加载完后，Next.js 的 webpack runtime 存在于模块闭包内。
  // 但我们能通过「已加载 chunks 的全局引用」找到它：
  //   __NEXT_DATA__.buildId + performance.getEntriesByType('resource')
  // 拿到 msfe chunk URL 后，用动态 import() 加载它 —— 它是 ESM/CJS 混合
  try {
    var entries = performance.getEntriesByType('resource') || []
    var msfeUrl = null
    for (var i = 0; i < entries.length; i++) {
      var u = entries[i].name || ''
      if (/msfe-[0-9a-f]+\\.js/.test(u)) { msfeUrl = u; break }
    }
    if (!msfeUrl) {
      // 兜底：从 __NEXT_DATA__ 推
      var nd = window.__NEXT_DATA__
      if (nd && nd.buildId) {
        msfeUrl = 'https://static.pddpic.com/ad-static/mains/_next/static/chunks/msfe-9d32834f5061ec2a.js'
      }
    }
    if (!msfeUrl) return { err: 'msfe chunk not found' }

    var mod = await import(/* @vite-ignore */ msfeUrl)
    var keys = Object.keys(mod || {})
    // 遍历导出，找有 messagePackSync 的构造函数
    for (var k in mod) {
      var C = mod[k]
      if (typeof C === 'function' && C.prototype && typeof C.prototype.messagePackSync === 'function') {
        var sdk = new C({ serverTime: Date.now() })
        if (typeof sdk.init === 'function') sdk.init(null)
        var sig = await sdk.messagePackSync()
        if (typeof sdk.clearCache === 'function') sdk.clearCache()
        return { ok: true, sig: String(sig), len: String(sig).length, via: 'import:' + k }
      }
    }
    return { err: 'no messagePackSync ctor in exports', exports: keys.slice(0, 15) }
  } catch (e) {
    return { err: String(e).slice(0, 180) }
  }
}`
