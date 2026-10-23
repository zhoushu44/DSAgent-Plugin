/**
 * 抖音/抖店风控绕过（preload 注入）
 *
 * 来源：抖上货 v1.9.9 逆向实证 + 本项目实测补充。
 * 核心思路：**不过滑块，直接让风控检测请求不发出去。**
 *
 * 抖店风控是「页面内异步发检测请求」——hook XHR/fetch 让它不发就行。
 * （淘宝 baxia 是服务端同步验签，hook 拦不掉，那是平台级差异。）
 *
 * 用法（在 page 上注入，每次导航自动生效）：
 *   await page.evaluateOnNewDocument(RISK_BYPASS_SCRIPT)
 *
 * 或先 evaluate 一次（已加载页面）：
 *   await page.evaluate(RISK_BYPASS_SCRIPT)
 *
 * 模块同时提供 window.__risk 工具（getToken/addRule/getRules），
 * 便于运行时动态追加规则与偷 __token。
 */

/** 要拦掉的 URL 特征（url.includes 匹配）。只拦风控相关，**别拦业务接口**。 */
export const BLOCK_RULES = [
  // ── 抖上货逆出的三个入口（原样保留）──
  '/session_check',                        // session 检查（触发就登出/弹验证）
  '/byteshop/questionnaire/checkPutIn',    // 问卷验证
  '49.79.224.248',                         // 风控服务 IP

  // ── 本项目实测补充（2026-10）──
  '/ecomauth/loginv1/common_login_check',  // 频繁轮询的登录态检查，会触发验证
  '/byteshop/menu/navigate',               // 菜单导航埋点（非业务）
  '/risk/', '/verify/', '/captcha/',       // 通用风控路径
  'rc-verify', 'verify.SM',                // 滑块验证 SDK
  '/log/sentry/v2/',                       // 错误埋点（可选）
]

/** 拦掉跳 App 验证的协议 */
export const BLOCK_PROTOCOLS = ['bytedance://', 'snssdk1128://', 'douyinopensdk://']

/**
 * 注入脚本本体（字符串形式，供 evaluateOnNewDocument / page.evaluate 使用）。
 * 必须是**纯函数字符串**——不引用外部作用域变量（注入后在页面上下文执行）。
 */
export const RISK_BYPASS_SCRIPT = String.raw`
(function () {
  'use strict';
  if (window.__riskInjected) return;
  window.__riskInjected = true;

  const BLOCK_RULES = ${JSON.stringify(BLOCK_RULES)};
  const BLOCK_PROTOCOLS = ${JSON.stringify(BLOCK_PROTOCOLS)};
  const FAKE_OK = '{"success":true,"data":{}}';

  let __token = '';
  const hitLog = [];

  const shouldBlock = (url) => {
    if (!url || typeof url !== 'string') return false
    for (const r of BLOCK_RULES) if (url.includes(r)) return true
    return false
  }
  const isBlockedProto = (url) =>
    typeof url === 'string' && BLOCK_PROTOCOLS.some(p => url.startsWith(p))

  const note = (url) => {
    hitLog.push(String(url).slice(0, 160))
    if (hitLog.length > 200) hitLog.shift()
    try { console.log('[风控绕过] 拦截:', String(url).slice(0, 120)) } catch (e) {}
  }

  // 偷 __token（抖店接口签名要用）
  const stealToken = (url) => {
    try {
      const m = String(url).match(/[?&]__token=([^&]+)/)
      if (m) __token = decodeURIComponent(m[1])
    } catch (e) {}
  }

  // ═══════════ 1. XHR hook —— 核心 ═══════════
  const _XHR = XMLHttpRequest.prototype
  const _open = _XHR.open
  const _send = _XHR.send

  _XHR.open = function (method, url, ...rest) {
    this._method = method
    this._url = url
    if (url && typeof url === 'string') {
      stealToken(url)
      if (shouldBlock(url)) {
        note(url)
        this.__blocked = true
        Object.defineProperty(this, 'readyState', { get: () => 4, configurable: true })
        Object.defineProperty(this, 'status', { get: () => 200, configurable: true })
        Object.defineProperty(this, 'statusText', { get: () => 'OK', configurable: true })
        Object.defineProperty(this, 'responseText', { get: () => FAKE_OK, configurable: true })
        Object.defineProperty(this, 'response', { get: () => FAKE_OK, configurable: true })
        Object.defineProperty(this, 'responseURL', { get: () => String(url), configurable: true })
        return
      }
    }
    return _open.call(this, method, url, ...rest)
  }

  _XHR.send = function (postData) {
    if (this.__blocked) {
      setTimeout(() => {
        try {
          if (typeof this.onload === 'function') this.onload({ target: this })
          if (typeof this.onreadystatechange === 'function') this.onreadystatechange({ target: this })
          this.dispatchEvent(new Event('load'))
          this.dispatchEvent(new Event('readystatechange'))
          this.dispatchEvent(new Event('loadend'))
        } catch (e) {}
      }, 0)
      return
    }
    return _send.call(this, postData)
  }

  // ═══════════ 2. fetch hook（同思路，现代页面多用 fetch）═══════════
  const _fetch = window.fetch
  if (_fetch) {
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || ''
        stealToken(url)
        if (shouldBlock(url)) {
          note(url)
          return Promise.resolve(new Response(FAKE_OK, {
            status: 200, statusText: 'OK',
            headers: { 'Content-Type': 'application/json' },
          }))
        }
      } catch (e) {}
      return _fetch.apply(this, arguments)
    }
  }

  // ═══════════ 3. 拦截跳 App 验证 ═══════════
  const _open2 = window.open
  window.open = function (url, name, features, replace) {
    if (isBlockedProto(url)) { note(url); return null }
    return _open2.call(this, url, name, features, replace)
  }

  try {
    const loc = Object.getOwnPropertyDescriptor(window.Location.prototype, 'href')
    Object.defineProperty(window.Location.prototype, 'href', {
      get() { return loc.get.call(this) },
      set(v) { if (isBlockedProto(v)) { note(v); return } loc.set.call(this, v) },
      configurable: true,
    })
  } catch (e) {}

  // ═══════════ 4. WebSocket 风控通道（默认关，确认风控走 WS 再开）═══════════
  // const _WS = window.WebSocket
  // window.WebSocket = function (url, protocols) {
  //   if (shouldBlock(String(url))) return { close(){}, send(){}, addEventListener(){}, readyState: 3 }
  //   return new _WS(url, protocols)
  // }

  // ═══════════ 5. 暴露接口 ═══════════
  window.__risk = {
    getToken: () => __token,
    addRule: (r) => { if (r && !BLOCK_RULES.includes(r)) BLOCK_RULES.push(r) },
    getRules: () => BLOCK_RULES.slice(),
    getHits: () => hitLog.slice(),
  }

  try { console.log('[风控绕过] 已注入，规则数:', BLOCK_RULES.length) } catch (e) {}
})()
`

/**
 * 在 page 上注入风控绕过（每次导航自动生效）。
 * 必须在 page.goto 之前调用。
 */
export async function injectRiskBypass(page) {
  await page.evaluateOnNewDocument(RISK_BYPASS_SCRIPT)
}

/**
 * 对已加载的页面立即注入一次（不等导航）。
 */
export async function injectRiskBypassNow(page) {
  await page.evaluate(RISK_BYPASS_SCRIPT)
}

/** 读取页面偷到的 __token */
export async function getStolenToken(page) {
  try {
    return await page.evaluate(() => (window.__risk ? window.__risk.getToken() : null))
  } catch {
    return null
  }
}

/** 读取拦截命中记录（排障用） */
export async function getBypassHits(page) {
  try {
    return await page.evaluate(() => (window.__risk ? window.__risk.getHits() : []))
  } catch {
    return []
  }
}
