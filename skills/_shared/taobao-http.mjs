/**
 * taobao-http.mjs —— 淘宝非 mtop 域的 HTTP 通道（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么基座不能只做 mtop
 * ══════════════════════════════════════════════════════════════════
 *   淘宝体系里有三种完全不同的接口形态，认证方式各不相同：
 *
 *   ┌─────────────────┬──────────────────────┬──────────────────────────┐
 *   │ 形态            │ 例子                 │ 认证                     │
 *   ├─────────────────┼──────────────────────┼──────────────────────────┤
 *   │ mtop（签名）    │ h5api.m.taobao.com   │ md5(token&t&appKey&data) │
 *   │ JSON GET（无签）│ sycm.taobao.com      │ 仅 Cookie（_tb_token_ 等）│
 *   │ 万相台/达摩盘   │ one.alimama.com      │ Cookie + 部分需 csrf     │
 *   └─────────────────┴──────────────────────┴──────────────────────────┘
 *
 *   mtop 通道见 taobao-request.mjs；本模块补的是后两种——
 *   **一条纯 Cookie 的 HTTP 通道**，同样享受基座的节流与风控冷却。
 *
 * ══════════════════════════════════════════════════════════════════
 * sycm（生意参谋）
 * ══════════════════════════════════════════════════════════════════
 *   GET https://sycm.taobao.com/mc/mq/mkt/keyword/relate/analysis.json?...
 *   GET https://sycm.taobao.com/mc/mq/mkt/keyword/rank/pro.json?...
 *   返回普通 JSON，不是 mtop 结构，没有 ret 字段。
 *   判失败看 HTTP 状态 + 业务字段（如 success:false / code!=0）。
 */
import { pickTaobaoAccount } from './taobao-account.mjs'
import { cookieHeader } from './taobao-sign.mjs'
import { desktopUserAgent, clientHintsHeaders } from './taobao-ua.mjs'
import { acquireSlot, DEFAULT_INTERVAL_MS, DEFAULT_JITTER_MS } from './taobao-throttle.mjs'
import { riskState, markRisk } from './taobao-risk.mjs'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const DEFAULT_TIMEOUT_MS = 25_000

/** 非 mtop 域默认凭证域：都用 taobao 账号 Cookie */
const DEFAULT_PLATFORM = 'taobao'

/**
 * 发一个普通 HTTP 请求（GET/POST），自动带淘宝 Cookie
 *
 * @param {string} url  完整 URL
 * @param {object} [opts]
 * @param {'GET'|'POST'} [opts.method]
 * @param {object} [opts.params]       query 参数（GET）
 * @param {object|string} [opts.body]  JSON body（POST）
 * @param {object} [opts.headers]
 * @param {string} [opts.referer]
 * @param {string} [opts.account]
 * @param {string} [opts.platform]     凭证平台（默认 taobao；sycm 用 sycm）
 * @param {number} [opts.intervalMs]
 * @param {number} [opts.jitterMs]
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.ignoreRiskCooldown]
 * @param {boolean} [opts.ignoreThrottle]
 * @param {boolean} [opts.expectJson]  默认 true
 * @returns {Promise<{ok:boolean, status?:number, json?:any, text?:string, ms?:number, failureKind?:string, hint?:string}>}
 */
export async function httpRequest(url, opts = {}) {
  const {
    method = 'GET', params = null, body = null, headers = {},
    referer = '', account = '', platform = DEFAULT_PLATFORM,
    intervalMs = DEFAULT_INTERVAL_MS, jitterMs = DEFAULT_JITTER_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ignoreRiskCooldown = false, ignoreThrottle = false, expectJson = true,
  } = opts

  const pick = await pickTaobaoAccount({ want: account })
  if (!pick.ok) {
    return { ok: false, failureKind: pick.failureKind || 'config_error', hint: pick.text }
  }
  const shopKey = pick.shopKey

  if (!ignoreRiskCooldown) {
    const st = riskState(shopKey)
    if (st.cooling) {
      return {
        ok: false, failureKind: 'risk_control', cooling: true, remainMs: st.remainMs,
        strike: st.strike, shopKey,
        hint: `账号 ${shopKey} 处于风控冷却，还需 ${Math.ceil(st.remainMs / 1000)}s`,
      }
    }
  }

  if (!ignoreThrottle) {
    const slot = acquireSlot(shopKey, { intervalMs, jitterMs })
    if (slot.waitMs > 0) await sleep(slot.waitMs)
  }

  let finalUrl = url
  if (params && Object.keys(params).length) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v))
    }
    finalUrl += (url.includes('?') ? '&' : '?') + qs.toString()
  }

  const reqHeaders = {
    'cookie': cookieHeader(pick.cookies || {}),
    'user-agent': desktopUserAgent(),
    ...clientHintsHeaders(),
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'accept': expectJson ? 'application/json, text/plain, */*' : '*/*',
    ...(referer ? { 'referer': referer } : {}),
    ...headers,
  }

  const init = { method, headers: reqHeaders }
  if (method === 'POST' && body !== null && body !== undefined) {
    if (typeof body === 'string') {
      init.body = body
      if (!reqHeaders['content-type']) reqHeaders['content-type'] = 'application/x-www-form-urlencoded'
    } else {
      init.body = JSON.stringify(body)
      if (!reqHeaders['content-type']) reqHeaders['content-type'] = 'application/json;charset=UTF-8'
    }
  }

  const t0 = Date.now()
  let res, text = ''
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    res = await fetch(finalUrl, { ...init, signal: ctl.signal })
    clearTimeout(timer)
    text = await res.text()
  } catch (e) {
    return { ok: false, failureKind: 'exception', hint: String(e?.message || e), ms: Date.now() - t0 }
  }

  const ms = Date.now() - t0
  const status = res.status

  // 风控页（HTML + punish）
  if (/_____tmd_____|\/punish|bixi-intl\.alicdn\.com\/punish/i.test(text)) {
    const st = markRisk(shopKey, { reason: '非 mtop 域返回风控页', riskKind: 'bixi-punish' })
    return {
      ok: false, failureKind: 'risk_control', riskKind: 'bixi-punish', canSolve: true,
      hint: '返回风控页，需要人工过滑块', ms, status, remainMs: st.remainMs,
    }
  }

  // 登录失效（sycm 常见：跳登录页 / 返回 code 401）
  if (status === 401 || status === 419 || /请登录|login\.taobao|未登录/i.test(text)) {
    return {
      ok: false, failureKind: 'token_expired', status, ms,
      hint: '登录态失效，需重新登录淘宝/sycm 账号',
    }
  }

  if (expectJson) {
    let json = null
    try { json = JSON.parse(text) } catch { /* 非 JSON */ }
    if (!json) {
      return {
        ok: false, failureKind: 'api_error', status, ms,
        hint: `非 JSON 响应：${text.slice(0, 160)}`,
      }
    }
    // sycm 业务失败常见形态
    const msg = String(json.message || json.msg || '')
    if (json.success === false || (json.code !== undefined && json.code !== 0 && json.code !== '0' && json.code !== 200)) {
      // ★ 权限类错误必须单独归因：这不是「接口坏了」，是账号没开通该功能，
      //   重试无用、换接口无用，只能换号或去买权限。归成 api_error 会误导排查方向。
      if (/No Buy Func Permission|no permission|无权限|未开通|not authorized|forbidden/i.test(msg)) {
        return {
          ok: false, failureKind: 'no_permission', status, ms, json,
          hint: `${msg}（账号未开通该功能，需换号或在平台购买该功能权限）`,
        }
      }
      return {
        ok: false, failureKind: 'api_error', status, ms, json,
        hint: msg || `业务失败 code=${json.code}`,
      }
    }
    return { ok: true, status, ms, json, text }
  }

  return { ok: status >= 200 && status < 400, status, ms, text }
}

/** sycm 便捷：GET JSON */
export async function sycmGet(endpoint, params = {}, opts = {}) {
  return httpRequest(`https://sycm.taobao.com${endpoint}`, {
    method: 'GET',
    params,
    referer: 'https://sycm.taobao.com/',
    ...opts,
  })
}

/**
 * ★ 万相台（alimama）真实域名表 —— 不是 one.alimama.com
 *
 * 实测（2026-11-18）：`one.alimama.com` 是 React 前端外壳，
 * 它的 `/xxx.json` 路径**不是接口**（返回 HTML 或 fetch 失败）。
 * 真实接口分散在这几个域名下，且**多数不需要 csrfId**（原先文档说要，实测不要）：
 *
 *   stlacct.alimama.com  账户余额 / 结算
 *   club.alimama.com     广告组配置 / 策略诊断
 *   dmp-gateway.alimama.com  达摩盘（competitor / insight）
 *
 * 来源：skills/taobao-promo/knowledge/接口清单.md（逆向抓包沉淀）
 */
export const ALIMAMA_HOSTS = {
  settle: 'stlacct.alimama.com',
  club: 'club.alimama.com',
  dmp: 'dmp-gateway.alimama.com',
}

/** 万相台接口注册表（只登记已验证可用的） */
export const ALIMAMA_APIS = {
  'balance.real': {
    host: 'settle',
    path: '/settleAccount/account/getRealBalance.json',
    method: 'GET',
    params: { bizCode: 'universalBP' },
    desc: '账户余额：cash / totalGeneralBalance / totalCouponBalance / freezeCash',
  },
  'adgroup.byChannel': {
    host: 'club',
    path: '/operationGroup/channel/getAdGroupByChannelKey.json',
    method: 'GET',
    params: { bizCode: 'universalBP', channelKey: 'wxtwj-dbtl' },
    desc: '广告组配置',
  },
}

/**
 * 万相台/达摩盘便捷调用
 * @param {string} apiName  ALIMAMA_APIS 的逻辑名
 * @param {object} [extraParams] 覆盖/追加参数
 * @param {object} [opts]
 */
export async function alimamaCall(apiName, extraParams = {}, opts = {}) {
  const spec = ALIMAMA_APIS[apiName]
  if (!spec) throw new Error(`未登记的万相台接口: ${apiName}`)
  const host = ALIMAMA_HOSTS[spec.host]
  return httpRequest(`https://${host}${spec.path}`, {
    method: spec.method,
    params: { ...(spec.params || {}), ...(extraParams || {}) },
    referer: 'https://one.alimama.com/',
    ...opts,
  })
}

/** 万相台便捷：GET JSON（任意 url） */
export async function alimamaGet(url, params = {}, opts = {}) {
  return httpRequest(url, {
    method: 'GET',
    params,
    referer: 'https://one.alimama.com/',
    ...opts,
  })
}

/**
 * ★ 万相台 one.alimama.com 必须走**页面内 fetch**
 *
 * 实测（2026-11-18）：纯 Node 直连 one.alimama.com 的所有 .json 接口
 * 都返回 HTML（React 应用外壳），不是「接口 404」，而是：
 *   · 该域要求 `_tb_token_` / csrf 由页面 JS 运行时注入
 *   · 且依赖 XHR 上下文（`X-Requested-With` + 同源 + 页面会话票据）
 * 现有实现（taobao-promo/scripts/batch_write.mjs）也是用 page.evaluate 发的。
 *
 * → 所以这台接口归**浏览器通道**（taobao-browser.mjs 的 pageFetch），
 *   不进纯 HTTP 通道。本函数是给技能侧的入口封装。
 *
 * @param {object} session  openSession() 返回的会话
 * @param {string} url      完整 URL（含 query）
 * @param {object} [o]
 * @param {'GET'|'POST'} [o.method]
 * @param {any} [o.body]
 * @returns {Promise<{ok:boolean, status:number, json:any}>}
 */
export async function alimamaPageFetch(session, url, o = {}) {
  const { method = 'GET', body = null } = o
  const page = session?.page
  if (!page) return { ok: false, status: 0, json: null, hint: '需要浏览器会话（openSession）' }
  const r = await page.evaluate(async (u, m, b) => {
    try {
      const res = await fetch(u, {
        method: m,
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          ...(b ? { 'Content-Type': 'application/json' } : {}),
        },
        credentials: 'include',
        body: b ? JSON.stringify(b) : undefined,
      })
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* ignore */ }
      return { status: res.status, json, raw: text.slice(0, 600) }
    } catch (e) {
      // 路径不存在 / 被 baxia 拦截 / 网络失败都落这里，不能让它冒泡炸掉调用方
      return { status: -1, json: null, raw: '', err: String(e?.message || e) }
    }
  }, url, method, body)
  if (r.err) {
    return {
      ok: false, status: r.status, json: null,
      hint: `页面内 fetch 失败：${r.err}（多为路径不存在或被 baxia 拦截）`,
    }
  }
  return { ok: r.status >= 200 && r.status < 400 && !!r.json, ...r }
}

export default { httpRequest, sycmGet, alimamaGet }
