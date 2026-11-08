/**
 * pdd-request.mjs —— 统一请求入口（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要它（2026-11-07）
 * ══════════════════════════════════════════════════════════════════
 *
 * 现状：每个 skill 自己写 api() 包装，各自 page.evaluate：
 *   pdd-video     → live.pinduoduo.com + VerifyAuthToken
 *   pdd-promo     → yingxiao.pinduoduo.com + crawlerInfo(body)
 *   pdd-shop      → mms.pinduoduo.com   + Anti-Content(header)
 *
 * 问题：
 *   1. 三条通道逻辑重复
 *   2. 纯 Node 能力加不进去（每个 skill 都要改）
 *   3. 降级逻辑无法统一
 *
 * 这个模块提供**一个入口**，内部自动决定：
 *   - 用哪个域
 *   - 签名放 header 还是 body
 *   - 先走 Node 还是直接浏览器
 *   - 失败是否降级
 *
 * ══════════════════════════════════════════════════════════════════
 * 用法（skill 只改一行）
 * ══════════════════════════════════════════════════════════════════
 *
 *   import { request } from '<...>/_shared/pdd-request.mjs'
 *
 *   const r = await request('/vodka/v2/mms/query/display/mall/goodsList', {page:1,size:10}, {
 *     page,                        // 可选：传了才有浏览器兜底
 *     account,                     // 可选：有才会先试 Node
 *     shopKey: SHOP,
 *     guard,                       // 可选：节流
 *   })
 *   // → { ok, ec, data, channel:'node'|'browser', ... }
 *
 * ══════════════════════════════════════════════════════════════════
 * 域自动识别
 * ══════════════════════════════════════════════════════════════════
 *   /vodka/ /glide/ /sydney/ ... → mms.pinduoduo.com     header Anti-Content
 *   /mms-gateway/                → yingxiao.pinduoduo.com body crawlerInfo
 *   /api/backbone/ /mms/amco/    → live.pinduoduo.com    浏览器（无 Node 方案）
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SELF_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const load = (f) => import(pathToFileURL(path.join(SELF_DIR, f)).href)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36'

/** 域配置 */
const DOMAINS = {
  mms: {
    origin: 'https://mms.pinduoduo.com',
    referer: 'https://mms.pinduoduo.com/goods/goods_list',
    signPos: 'header',         // Anti-Content
    nodeSupport: true,         // 纯 Node 已验证
  },
  yingxiao: {
    origin: 'https://yingxiao.pinduoduo.com',
    referer: 'https://yingxiao.pinduoduo.com/mains/promotionOverview',
    signPos: 'body',           // crawlerInfo
    nodeSupport: 'unstable',   // Node 不稳定，优先浏览器
  },
  live: {
    origin: 'https://live.pinduoduo.com',
    referer: 'https://live.pinduoduo.com/n-creator/video/home',
    signPos: 'none',           // 用 VerifyAuthToken
    nodeSupport: false,        // 无 Node 方案
  },
}

/** 按路径判断域 */
export function detectDomain(pathname) {
  const p = String(pathname || '')
  if (/^\/mms-gateway\//.test(p) || /^\/api\/reinhardt\//.test(p)) return 'yingxiao'
  if (/^\/api\/backbone\//.test(p) || /^\/mms\/amco\//.test(p) || /^\/kiwi\//.test(p) || /^\/api\/orpheus/.test(p) || /^\/carllive\//.test(p) || /^\/element\//.test(p)) return 'live'
  return 'mms'
}

/** 成功判据（三域不同） */
function isSuccess(json, domain) {
  if (!json || typeof json !== 'object') return false
  if (json.success === true) return true
  const ec = json.error_code ?? json.errorCode
  if (domain === 'yingxiao') return ec === 1000 || ec === 1000000
  return ec === 1000000
}

/** 取错误码 */
function errCode(json) {
  return Number(json?.error_code ?? json?.errorCode ?? 0)
}

/**
 * 统一请求
 * @param {string} pathname 接口路径（不含域名）
 * @param {object} body
 * @param {object} opts { page, account, shopKey, guard, method, extraHeaders, forceBrowser, referer }
 */
export async function request(pathname, body = {}, opts = {}) {
  const domain = opts.domain || detectDomain(pathname)
  const cfg = DOMAINS[domain] || DOMAINS.mms
  const url = pathname.startsWith('http') ? pathname : cfg.origin + pathname
  const method = (opts.method || 'POST').toUpperCase()

  // ① 节流
  if (opts.guard?.beforeCall) {
    const pre = await opts.guard.beforeCall(url)
    if (!pre.allow) {
      return { ok: false, ec: 'blocked', failureKind: 'rate_limit', data: null, raw: null,
        status: 0, channel: 'none', hint: pre.reason }
    }
  }

  const hasPage = !!opts.page
  const hasAccount = !!opts.account?.cookies
  const wantBrowser = opts.forceBrowser || !hasAccount || cfg.nodeSupport === false

  let channel = 'browser'
  let nodeReason = ''
  let res = null

  // ② 纯 Node 尝试
  if (!wantBrowser && hasAccount) {
    try {
      const sig = await signFor(domain, opts)
      if (sig || cfg.signPos === 'none') {
        res = await fetchNode(url, method, body, cfg, sig, opts)
        const okNow = isSuccess(res.json, domain)
        const ec = errCode(res.json)
        const risk = ec === 54001 || ec === 54003
        if (okNow) {
          channel = 'node'
        } else if (risk && hasPage) {
          nodeReason = `Node 被拒（ec=${ec}），降级浏览器`
          res = null      // 走浏览器
        } else {
          channel = 'node'   // 失败但不降级（无 page 或非风控错误）
        }
      } else {
        nodeReason = '签名生成失败'
      }
    } catch (e) {
      nodeReason = `Node 异常：${String(e.message).slice(0, 60)}`
    }
  }

  // ③ 浏览器兜底
  if (!res && hasPage) {
    channel = 'browser'
    res = await fetchBrowser(opts.page, url, method, body, cfg, domain, opts)
  }

  if (!res) {
    return { ok: false, ec: 'no_channel', failureKind: 'config_error', data: null, raw: null,
      status: 0, channel: 'none',
      hint: nodeReason || '既没有可用账号（account）也没有浏览器（page）' }
  }

  // ④ 归因
  const ok = isSuccess(res.json, domain)
  const ec = ok ? null : errCode(res.json)
  let failureKind = ''
  if (!ok) {
    if (ec === 54001 || ec === 54003) failureKind = 'risk_control'
    else if (ec === 40001 || ec === 43001) failureKind = 'auth'
    else if (ec === 40002 || ec === 100001) failureKind = 'rate_limit'
    else failureKind = 'api_error'
  }

  // ★ 2026-11-07：签名失败 → 上报种子健康（连续 2 次触发自动刷新）
  if (opts.shopKey && domain === 'mms') {
    try {
      const sa = await load('pdd-seed-auto.mjs')
      if (ok) sa.noteSignSuccess(opts.shopKey)
      else if (ec === 54001 || ec === 54003) sa.noteSignFailure(opts.shopKey)
    } catch { /* ignore */ }
  }

  if (opts.guard?.afterCall) {
    try { await opts.guard.afterCall(url, res.json) } catch { /* ignore */ }
  }

  const out = {
    ok,
    ec,
    channel,
    nodeFallback: nodeReason,
    status: res.status,
    failureKind,
    data: ok ? unwrap(res.json) : null,
    raw: res.json,
    hint: ok ? '' : String(res.json?.error_msg ?? res.json?.errorMsg ?? res.err ?? '').slice(0, 200),
  }
  return out
}

/** 按域生成签名 */
async function signFor(domain, opts) {
  if (domain === 'mms') {
    const vs = await load('pdd-vodka-signer.mjs')
    const seedStore = await load('pdd-seed-store.mjs')
    const seed = opts.account.localStorage || seedStore.readSeed(opts.shopKey || '')?.localStorage || {}
    return vs.sign({ cookies: opts.account.cookies, localStorage: seed })
  }
  if (domain === 'yingxiao') {
    const ps = await load('pdd-promo-signer.mjs')
    return ps.signPromo()
  }
  return ''   // live 无签名
}

/** 纯 Node 发请求 */
async function fetchNode(url, method, body, cfg, sig, opts) {
  const cookieStr = Object.entries(opts.account.cookies || {}).map(([k, v]) => `${k}=${v}`).join('; ')
  const headers = {
    'content-type': 'application/json',
    origin: cfg.origin,
    referer: opts.referer || cfg.referer,
    'user-agent': opts.account.userAgent || UA,
    cookie: cookieStr,
    accept: 'application/json, text/plain, */*',
    ...(opts.extraHeaders || {}),
  }
  if (cfg.signPos === 'header' && sig) headers['anti-content'] = sig

  let finalBody = body || {}
  if (cfg.signPos === 'body' && sig) finalBody = { ...finalBody, crawlerInfo: sig }

  try {
    const r = await fetch(url, {
      method,
      headers,
      ...(method === 'GET' ? {} : { body: JSON.stringify(finalBody) }),
    })
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* 非 JSON */ }
    return { status: r.status, json, text: text.slice(0, 300) }
  } catch (e) {
    return { status: 0, json: null, err: String(e).slice(0, 120) }
  }
}

/** 浏览器发请求 */
async function fetchBrowser(page, url, method, body, cfg, domain, opts) {
  // live 域需要 VerifyAuthToken
  let vtk = null
  if (domain === 'live' && opts.shopKey) {
    try {
      const g = await load('pdd-guard.mjs')
      vtk = await g.getVerifyAuthToken(page, opts.shopKey)
    } catch { /* ignore */ }
  }

  return page.evaluate(async (u, m, bd, extra, vt, signPos) => {
    try {
      const headers = { 'Content-Type': 'application/json', ...(extra || {}) }
      if (vt) headers['VerifyAuthToken'] = vt
      const resp = await fetch(u, {
        method: m,
        credentials: 'include',
        headers,
        ...(m === 'GET' ? {} : { body: JSON.stringify(bd || {}) }),
      })
      const text = await resp.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* 非 JSON */ }
      return { status: resp.status, json, text: text.slice(0, 300) }
    } catch (e) {
      return { status: 0, json: null, err: String(e).slice(0, 120) }
    }
  }, url, method, body || {}, opts.extraHeaders || {}, vtk, cfg.signPos)
}

/** 解包 */
function unwrap(json) {
  if (!json || typeof json !== 'object') return json
  if ('result' in json) return json.result
  if ('data' in json) return json.data
  return json
}

export const REQUEST_INFO = {
  module: 'pdd-request.mjs',
  domains: DOMAINS,
  note: '统一入口：自动选域 + 自动选通道 + 自动降级',
}
