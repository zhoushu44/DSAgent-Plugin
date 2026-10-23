/**
 * PDD 全通道客户端（pdd-client）
 *
 * 三种通道自动选择：
 *   t1  纯 Node + 简化签名（40 字符）         → 宽松接口，~200ms
 *   t2  纯 Node + 真签名（risk-sdk 407~418）  → 严格接口
 *   t3  纯 Node + 真签名 + webSpiderRule      → 商品明细等特严格接口
 *
 * 所有通道共享：
 *   · 账号级节流（落盘持久化，跨进程生效）
 *   · 时间槽预留（防并发穿透）
 *   · 54001 静默自愈（清 token → 提取新的 → 重放）
 *   · 43001 = 会话过期（不当风控）
 *   · 40002 = 240s 长冷却
 *   · 指数退避 + 抖动
 *   · PUA 自动解码
 *   · 账号健康分
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { getAntiString } from './pdd-antistring.mjs'
import { decodePua, hasPua, RISK_SDK_INJECT } from './pdd-risksdk.mjs'
import {
  reserveSlot, recordResult, canUse, getAccountState,
  ERR, THROTTLE, fmtRemain, backoffWait, clearCooldown,
} from './pdd-antiban.mjs'

const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const TOKEN_FILE = path.join(homedir(), '.dsh', 'pdd-captcha-tokens.json')

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'

/* ── 54001 token 持久化 ── */
function readTokens() { try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) || {} } catch { return {} } }
function writeTokens(d) { try { fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true }); fs.writeFileSync(TOKEN_FILE, JSON.stringify(d, null, 1), 'utf8') } catch { /* ignore */ } }
export function saveVerifyToken(shopKey, token) { if (!token) return; const d = readTokens(); d[shopKey] = { token, savedAt: Date.now(), expiresAt: Date.now() + 6e5 }; writeTokens(d) }
export function getVerifyToken(shopKey) { const d = readTokens(); const r = d[shopKey]; if (!r?.token) return null; if (Date.now() > r.expiresAt) { delete d[shopKey]; writeTokens(d); return null } return r.token }
export function clearVerifyToken(shopKey) { const d = readTokens(); if (d[shopKey]) { delete d[shopKey]; writeTokens(d) } }

/** wait */
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 创建浏览器会话（用于 t2/t3 通道）
 *
 * 关键：必须用 evaluateOnNewDocument 注入 RISK_SDK_INJECT，
 *      否则抓不到 webpack 模块。
 */
export async function createSession(shopKey, opts = {}) {
  const puppeteer = require('puppeteer-core')
  const { launchOptions, STEALTH_SCRIPT } = await import('./pdd-launch.mjs')

  const launchExtra = {
    args: [
      // ★ 后台防节流四件套（缺了会导致 CDP 超时）
      '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      ...(opts.extraArgs || []),
    ],
  }
  const browser = await puppeteer.launch(launchOptions(shopKey, launchExtra))
  const page = (await browser.pages())[0] || await browser.newPage()
  await page.evaluateOnNewDocument(STEALTH_SCRIPT)
  await page.evaluateOnNewDocument(RISK_SDK_INJECT)

  const cdp = await page.target().createCDPSession()
  await cdp.send('Network.enable')

  // 收集 webSpiderRule
  let spiderRule = null
  cdp.on('Network.requestWillBeSent', (e) => {
    const h = e.request?.headers || {}
    const r = h['webSpiderRule'] || h['webspiderrule']
    if (r && !spiderRule) spiderRule = String(r)
  })

  const session = {
    browser,
    page,
    cdp,
    get spiderRule() { return spiderRule },
    /** 页面是否还活着 */
    isAlive() {
      try { return !page.isClosed() } catch { return false }
    },
    async cookieStr() {
      // ★ 优先 CDP Network.getCookies（含 httpOnly PASS_ID）
      //   页面被风控关掉时 CDP session 会失效 → 回退 page.cookies()
      try {
        if (!page.isClosed()) {
          const r = await cdp.send('Network.getCookies', { urls: ['https://mms.pinduoduo.com/', 'https://yingxiao.pinduoduo.com/'] })
          const map = {}
          for (const c of r.cookies || []) map[c.name] = c.value
          if (Object.keys(map).length) {
            return { str: Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; '), map, count: Object.keys(map).length, via: 'cdp' }
          }
        }
      } catch { /* 落到下面 */ }
      try {
        const cs = await page.cookies()
        const map = {}
        for (const c of cs) map[c.name] = c.value
        return { str: Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; '), map, count: Object.keys(map).length, via: 'page' }
      } catch (e) {
        return { str: '', map: {}, count: 0, via: 'failed', err: e.message }
      }
    },
    async genSig() {
      try {
        if (page.isClosed()) return { err: 'page closed' }
        const r = await page.evaluate(() => window.__pddGenRiskSig())
        return r
      } catch (e) {
        return { err: String(e).slice(0, 120) }
      }
    },
    async goto(url, waitMs = 12000) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
      } catch { /* ignore */ }
      await sleep(waitMs)
    },
    async close() { try { await browser.close() } catch { /* ignore */ } },
    /**
     * ★ 页面自愈：页面被风控关掉后，自动开新页并重注签名能力
     * @returns {Promise<boolean>} 是否恢复成功
     */
    async revive() {
      try {
        if (!page.isClosed()) return true
        // 页面已关 → 新开一页
        const np = await browser.newPage()
        await np.evaluateOnNewDocument(STEALTH_SCRIPT)
        await np.evaluateOnNewDocument(RISK_SDK_INJECT)
        // 替换引用
        session.page = np
        const ncdp = await np.target().createCDPSession()
        await ncdp.send('Network.enable')
        ncdp.on('Network.requestWillBeSent', (e) => {
          const h = e.request?.headers || {}
          const r = h['webSpiderRule'] || h['webspiderrule']
          if (r && !spiderRule) spiderRule = String(r)
        })
        session.cdp = ncdp
        await session.goto('https://mms.pinduoduo.com/sycm/goods_effect', 15000)
        return !np.isClosed()
      } catch {
        return false
      }
    },
  }
  return session
}

/**
 * 统一请求
 *
 * @param {object} o
 * @param {string} o.shopKey
 * @param {string} o.url
 * @param {object} [o.body]
 * @param {string} [o.method]    默认 POST
 * @param {string} [o.referer]
 * @param {'t1'|'t2'|'t3'} [o.tier]  默认自动判断
 * @param {object} [o.session]   t2/t3 必需
 * @param {string} [o.cookies]   可选，覆盖 session
 * @param {boolean} [o.skipThrottle] 内部用
 * @param {number} [o.maxRetry]  默认 2
 */
export async function call(o) {
  const {
    shopKey, url, body = {}, method = 'POST', referer,
    session, cookies: cookiesOverride,
    maxRetry = 2,
  } = o

  // ── ① 账号可用性检查 ──
  const avail = canUse(shopKey)
  if (!avail.ok) {
    return {
      ok: false, kind: 'blocked',
      reason: avail.reason,
      remainMs: avail.remainMs,
      health: avail.health,
      hint: avail.remainMs ? `冷却剩余 ${fmtRemain(avail.remainMs)}` : avail.reason,
    }
  }

  // ── ② 选通道 ──
  const I = String(url)
  let tier = o.tier
  if (!tier) {
    if (/queryGoodsDetailVOListForMMS|queryGoodsPageOverView(\?|$)/.test(I)) tier = 't3'
    else if (/\/vodka\/|\/glide\/|queryGoodsPageOverViewReadyDate|queryGoodsReadyDate/.test(I)) tier = 't2'
    else tier = 't1'
  }

  // t2/t3 必须有 session
  if ((tier === 't2' || tier === 't3') && !session) {
    return { ok: false, kind: 'config_error', hint: `${tier} 通道需要 session（先 createSession）` }
  }

  let lastErr = null

  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    // ── ③ 时间槽预留（落盘，跨进程生效）──
    const slot = await reserveSlot(shopKey, I)
    if (slot.cooling) {
      return {
        ok: false, kind: 'blocked', reason: slot.reason,
        remainMs: slot.waitMs, hint: `冷却剩余 ${fmtRemain(slot.waitMs)}`,
      }
    }
    if (slot.waitMs > 0) await sleep(slot.waitMs)

    // ── ④ 生成签名 ──
    let anti = null
    let sigMeta = null
    if (tier === 't1') {
      anti = getAntiString()
      sigMeta = { type: 'simple', len: anti.length }
    } else {
      const r = await session.genSig()
      if (!r?.ok) {
        return { ok: false, kind: 'signature_error', hint: `真签名失败: ${r?.err}`, tier }
      }
      anti = r.sig
      sigMeta = { type: 'risksdk', len: r.len, serverTime: r.serverTime, hasTimeBaseline: r.hasTimeBaseline }
    }

    // ── ⑤ Cookie ──
    let cookies = cookiesOverride
    if (!cookies && session) {
      const c = await session.cookieStr()
      cookies = c.str
      if (!c.map['PASS_ID']) {
        recordResult(shopKey, 'session')
        return { ok: false, kind: 'session_expired', hint: 'Cookie 缺 PASS_ID，需重新登录' }
      }
    }
    if (!cookies) return { ok: false, kind: 'config_error', hint: '无 Cookie' }

    // ── ⑥ 组装请求头 ──
    const headers = {
      'accept': '*/*',
      'accept-language': 'zh-CN,zh;q=0.9',
      'cache-control': 'max-age=0',
      'content-type': 'application/json',
      'origin': 'https://mms.pinduoduo.com',
      'priority': 'u=1, i',
      'sec-ch-ua': '"Google Chrome";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'anti-content': anti,
      'cookie': cookies,
      'user-agent': DEFAULT_UA,
      'referer': referer || 'https://mms.pinduoduo.com/',
    }
    // t3 需要 webSpiderRule
    if (tier === 't3') {
      const sr = session?.spiderRule || o.webSpiderRule
      if (sr) headers['webSpiderRule'] = sr
    }
    // 54001 通行证
    const vtk = getVerifyToken(shopKey)
    if (vtk) headers['VerifyAuthToken'] = vtk

    // ── ⑦ 发请求 ──
    const reqOpts = { method, headers, signal: AbortSignal.timeout(25000) }
    if (method === 'POST') {
      reqOpts.body = JSON.stringify({ ...body, crawlerInfo: anti })
    }

    let resp, text, json
    try {
      resp = await fetch(url, reqOpts)
      text = await resp.text()
      try { json = JSON.parse(text) } catch { json = null }
    } catch (e) {
      recordResult(shopKey, 'other')
      lastErr = { ok: false, kind: 'network', hint: e.message, tier, attempt: attempt + 1 }
      if (attempt < maxRetry) { await backoffWait(attempt); continue }
      return lastErr
    }

    const ec = Number(json?.error_code ?? json?.errorCode ?? 0)
    const ok = json?.success === true || ec === 1000000

    // ── ⑧ 成功 ──
    if (ok) {
      recordResult(shopKey, 'ok')
      return {
        ok: true, json, text, http: resp.status,
        tier, signature: sigMeta, attempts: attempt + 1,
        usedToken: !!vtk,
      }
    }

    // ── ⑨ 54001 静默自愈 ──
    if (ec === ERR.CAPTCHA) {
      const newToken = json?.result?.verifyAuthToken
      clearVerifyToken(shopKey)
      if (newToken) saveVerifyToken(shopKey, newToken)
      recordResult(shopKey, 'captcha', { endpoint: I })
      if (newToken && attempt < maxRetry) {
        await backoffWait(attempt, 1800)
        continue
      }
      return {
        ok: false, kind: 'captcha', ec, http: resp.status, json,
        verifyAuthToken: newToken, tier, attempts: attempt + 1,
        hint: newToken ? '已提取 token 但重试后仍 54001' : '54001 无 verifyAuthToken，需人工过滑块',
      }
    }

    // ── ⑩ 43001 会话过期 ──
    if (ec === ERR.SESSION_EXPIRED || resp.status === 430) {
      recordResult(shopKey, 'session')
      return {
        ok: false, kind: 'session_expired', ec: ec || 43001, http: resp.status, json,
        tier, attempts: attempt + 1,
        hint: 'Cookie 已过期，请重新登录（注意：凭证库快照可能是旧的，应优先用浏览器当前 Cookie）',
      }
    }

    // ── ⑪ 40002 高频 ──
    if (ec === ERR.HIGH_FREQUENCY) {
      recordResult(shopKey, 'rate_limit')
      return {
        ok: false, kind: 'rate_limit', ec, http: resp.status, json,
        tier, attempts: attempt + 1,
        hint: '40002 高频限流，已进入 240s 冷却（官方实测此码无法本地修复，只能降级或等待）',
      }
    }

    // ── ⑫ 其他 ──
    if (ec === ERR.LOGIN_NEEDED || ec === ERR.NO_PERMISSION) {
      recordResult(shopKey, 'session')
      return {
        ok: false, kind: ec === ERR.LOGIN_NEEDED ? 'login_needed' : 'no_permission',
        ec, http: resp.status, json, tier, attempts: attempt + 1,
      }
    }

    recordResult(shopKey, 'other')
    return {
      ok: false, kind: 'api_error', ec, http: resp.status, json,
      msg: json?.error_msg ?? json?.errorMsg ?? '',
      tier, attempts: attempt + 1,
      hint: ec === 3000000 ? '参数错误（检查 startDate/queryType/pageNum 等）' : '',
    }
  }
  return lastErr || { ok: false, kind: 'unknown' }
}

/**
 * 解码接口返回里的所有 PUA 字段（原地替换）
 */
export function decodeAllPua(obj) {
  if (Array.isArray(obj)) return obj.map(decodeAllPua)
  if (!obj || typeof obj !== 'object') return obj
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && hasPua(v)) {
      const dec = decodePua(v)
      // 保留原值
      out[k] = dec
      out[k + '_raw'] = v
    } else if (v && typeof v === 'object') {
      out[k] = decodeAllPua(v)
    } else {
      out[k] = v
    }
  }
  return out
}

export { ERR, THROTTLE, getAccountState, canUse, clearCooldown, fmtRemain }
