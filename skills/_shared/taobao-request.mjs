/**
 * taobao-request.mjs —— 淘宝统一请求入口（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 这是淘宝基座的唯一出口。skill 侧禁止自己 fetch mtop。
 * ══════════════════════════════════════════════════════════════════
 *
 *   import { request } from '<PLUGIN>/skills/_shared/taobao-request.mjs'
 *   const r = await request('item.detail', { id: '652576134064' })
 *   if (r.ok) r.data
 *
 * ══════════════════════════════════════════════════════════════════
 * 请求形态（★ 实测结论，2026-11-18）
 * ══════════════════════════════════════════════════════════════════
 * 【默认 POST + form body + originaljson】
 *   实测同一账号、同一接口、同一时刻对比：
 *     GET  + query + jsonp        → FAIL_SYS_USER_VALIDATE / denycdc_forbidden（风控）
 *     POST + body  + originaljson → SUCCESS，778ms
 *
 *   为什么官方网关用 GET 而基座用 POST：
 *     官方跑在 Electron 里，请求带着完整的浏览器上下文（Cookie 域、UA、
 *     真实 Referer 页面、TLS 指纹），GET+jsonp 就是那个环境下的原生态。
 *     基座是**纯 Node 无浏览器**，缺这些上下文；此时 GET+query 的
 *     「数据全在 URL 里」反而更像爬虫特征，容易被判 denycdc_forbidden。
 *     POST+form 更像正常 H5 表单提交，实测稳定通过。
 *
 *   → 需要 GET 形态时传 opts.get = true（排障 / 对齐官方对照实验用）。
 *
 * ══════════════════════════════════════════════════════════════════
 * 基座替 skill 处理
 * ══════════════════════════════════════════════════════════════════
 *   ① 读凭证库 Cookie（_m_h5_tk 自带，可自签）
 *   ② 签名：md5(token & t & appKey & data)
 *   ③ **token 引导**：token 缺失/过期时服务端 Set-Cookie 下发新 token，
 *      吸收后自动重试（官方 xianyu-crawl fetch_m_h5_tk 同一模式）
 *   ④ **错误归因二分**：FAIL_SYS_TOKEN_* + 下发了新 _m_h5_tk → rate_limit（重试）
 *      没下发 → token_expired（重登）
 *   ⑤ **账号级跨进程节流**（taobao-throttle.mjs，官方 4s+0~2s）
 *   ⑥ **域名级路由冷却**（连续失败 ≥2 次 → 60s）
 *   ⑦ 风控子类型识别（ban / captcha / waf-block / bixi-punish）+ 指数退避
 *   ⑧ **verifyUrl 透出**（给用户去浏览器过滑块）
 *   ⑨ 收到 x5sec 等验证凭证 → 自动解除冷却
 *
 * ══════════════════════════════════════════════════════════════════
 * 实测基线（2026-11-18，账号 taobao_2218891961201）
 * ══════════════════════════════════════════════════════════════════
 *   详情接口 792ms/次 SUCCESS（tmall 域）；同接口走 Host 网关必超时（响应 ~300KB）
 */
import { resolveApi } from './taobao-api.mjs'
import {
  tokenOf, signMtop, absorbMtopCookies, cookieHeader, MTOP_APP_KEY,
} from './taobao-sign.mjs'
import { desktopUserAgent, clientHintsHeaders } from './taobao-ua.mjs'
import { withAccountQueue } from './taobao-queue.mjs'
import { pickTaobaoAccount } from './taobao-account.mjs'
import {
  riskState, markRisk, clearRisk, isRiskPayload, riskKind, extractVerifyUrl,
  isRouteCoolingDown, reportRouteSuccess, reportRouteFailure,
} from './taobao-risk.mjs'
import { acquireSlot, DEFAULT_INTERVAL_MS, DEFAULT_JITTER_MS } from './taobao-throttle.mjs'

const DEFAULT_TIMEOUT_MS = 25_000
const MAX_TOKEN_RETRY = 2

/** 风控自动重试：命中风控且拿到 verifyUrl 时，轮询等用户过滑块（官方 120s / 2s 轮询） */
const RISK_AUTO_RETRY_MAX_WAIT_MS = 120_000
const RISK_AUTO_RETRY_POLL_INTERVAL_MS = 2_000

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 统一出站头（UA 与本机 Chrome 同源 + client hints） */
function outboundHeaders(jar, referer, origin, accept) {
  return {
    'cookie': cookieHeader(jar),
    'user-agent': desktopUserAgent(),
    ...clientHintsHeaders(),
    'referer': referer,
    'origin': origin,
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'accept': accept,
  }
}

/** 剥 jsonp 壳：`mtopjsonp123({...})` → `{...}` */
function stripJsonp(text) {
  const m = String(text).match(/^\s*[\w$.]+\s*\(([\s\S]*)\)\s*;?\s*$/)
  return m ? m[1] : text
}

/**
 * 错误归因（官方口径二分）
 *   FAIL_SYS_TOKEN_* 且下发了新 _m_h5_tk → rate_limit（token 引导响应，重试即可）
 *   FAIL_SYS_TOKEN_* 且没下发新 token    → token_expired（需重新登录）
 */
function classify(payload, tokenRefreshed) {
  const ret = Array.isArray(payload?.ret) ? payload.ret.join(',') : ''
  if (/SUCCESS/i.test(ret)) return { ok: true }
  // ★ 平台真实返回是 `FAIL_SYS_TOKEN_EXOIRED`（官方拼写错误，少了个 P），
  //   不是 `EXPIRED`。只匹配正确拼写会漏判，导致 token 引导分支永不触发。
  //   官方 REQUIREMENTS.md §4.2 也是按 `FAIL_SYS_TOKEN_EXOIRED` 写的。
  if (/FAIL_SYS_TOKEN|令牌为空|令牌过期|TOKEN_EMPTY|TOKEN_EXOIRED|TOKEN_EXPIRED|ILLEGAL_ACCESS/i.test(ret)) {
    return tokenRefreshed
      ? { ok: false, kind: 'rate_limit', hint: `${ret}（已下发新 token，可重试）` }
      : { ok: false, kind: 'token_expired', hint: `${ret}（未下发新 token，需重登）` }
  }
  if (isRiskPayload(payload)) return { ok: false, kind: 'risk_control', hint: ret || 'RGV587' }
  if (/FAIL_SYS_TRAFFIC_LIMIT|限流|频繁|被挤爆/i.test(ret)) return { ok: false, kind: 'rate_limit', hint: ret }
  return { ok: false, kind: 'api_error', hint: ret || 'unknown' }
}

/**
 * @param {string} apiName  注册表逻辑名，如 'item.detail'
 * @param {object} params   业务参数（作为 mtop data 发送；也用于渲染 referer）
 * @param {object} [opts]
 * @param {string}  [opts.account]            shopKey
 * @param {string}  [opts.dataJson]           自定义 data
 * @param {boolean} [opts.get]                true=GET+query+jsonp（官方形态）；默认 POST+form
 * @param {number}  [opts.intervalMs]         节流间隔（默认官方 4000）
 * @param {number}  [opts.jitterMs]           抖动（默认官方 2000）
 * @param {number}  [opts.timeoutMs]
 * @param {boolean} [opts.ignoreRiskCooldown] 无视账号冷却（仅排障）
 * @param {boolean} [opts.ignoreThrottle]     跳过节流（仅自检）
 * @param {boolean} [opts.noRetry]
 */
export async function request(apiName, params = {}, opts = {}) {
  const pick = await pickTaobaoAccount({ want: opts.account || '' })
  if (!pick.ok) {
    return {
      ok: false, failureKind: pick.failureKind || 'config_error',
      hint: pick.text, accounts: pick.accounts || [],
    }
  }
  // ★ 同账号串行队列：同一时刻只有一个请求在飞，防并发踩踏（官方 withAccountQueue）
  return withAccountQueue(pick.shopKey, () => requestInner(apiName, params, opts, pick))
}

async function requestInner(apiName, params, opts, pick) {
  const {
    dataJson = '', get = false,
    intervalMs = DEFAULT_INTERVAL_MS, jitterMs = DEFAULT_JITTER_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ignoreRiskCooldown = false, ignoreThrottle = false, noRetry = false,
    autoRetryOnRisk = true,
  } = opts

  const shopKey = pick.shopKey
  const jar = { ...(pick.cookies || {}) }

  // ① 账号冷却闸门（带 verifyUrl，便于用户去过滑块）
  if (!ignoreRiskCooldown) {
    const st = riskState(shopKey)
    if (st.cooling) {
      return {
        ok: false, failureKind: 'risk_control', cooling: true,
        remainMs: st.remainMs, strike: st.strike, shopKey,
        riskKind: st.riskKind, verifyUrl: st.verifyUrl,
        hint: `账号 ${shopKey} 处于风控冷却，还需 ${Math.ceil(st.remainMs / 1000)}s（第 ${st.strike} 次）。`
          + `原因：${st.reason || 'RGV587'}`
          + (st.verifyUrl ? ` 验证地址：${st.verifyUrl}` : ''),
      }
    }
  }

  const spec = resolveApi(apiName, params)
  // ★ mergeData：接口级默认 data 字段（如 publish.pc.manage 的 tab 必须放 data 体）
  const mergedParams = spec.defaultData
    ? { ...spec.defaultData, ...(params || {}) }
    : params
  const data = dataJson || JSON.stringify(mergedParams)
  const host = spec.host

  // ② 域名级路由冷却
  if (isRouteCoolingDown(host)) {
    return {
      ok: false, failureKind: 'route_cooldown', shopKey, api: apiName,
      hint: `域名 ${host} 连续失败进入冷却，请稍后重试（或换域）。`,
    }
  }

  // ③ 跨进程节流（官方 4s + 0~2s）
  if (!ignoreThrottle) {
    const slot = acquireSlot(shopKey, { intervalMs, jitterMs })
    if (slot.waitMs > 0) await sleep(slot.waitMs)
  }

  const referer = spec.referer || `${spec.origin}/`
  const origin = spec.origin
  // ★ appKey 是接口级（闲鱼 34839810 / 淘宝 12574478），不能全局写死
  const appKey = spec.appKey || MTOP_APP_KEY

  let tokenRetry = 0
  const maxAttempts = noRetry ? 1 : MAX_TOKEN_RETRY + 1

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const t = String(Date.now())
    const sign = signMtop({ token: tokenOf(jar), t, data, appKey })
    const callback = `mtopjsonp${Date.now()}`

    const common = {
      jsv: '2.5.1',
      appKey,
      t,
      sign,
      api: spec.api,
      v: spec.version,
      ...(spec.extraParams || {}),
    }

    let url = `https://${host}/h5/${spec.api}/${spec.version}/`
    let fetchOpts
    if (get) {
      const qs = new URLSearchParams({
        ...common,
        type: 'jsonp', dataType: 'jsonp', callback,
        timeout: String(timeoutMs), data,
      })
      url += `?${qs}`
      fetchOpts = {
        method: 'GET',
        headers: outboundHeaders(jar, referer, origin, '*/*'),
      }
    } else {
      const body = new URLSearchParams({
        ...common,
        type: 'originaljson', dataType: 'originaljson',
        timeout: String(timeoutMs), data,
      })
      fetchOpts = {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          ...outboundHeaders(jar, referer, origin, 'application/json'),
        },
        body,
      }
    }

    const t0 = Date.now()
    let res, text = ''
    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), timeoutMs)
      res = await fetch(url, { ...fetchOpts, signal: ctl.signal })
      clearTimeout(timer)
      text = await res.text()
    } catch (e) {
      reportRouteFailure(host)
      if (attempt >= maxAttempts) {
        return { ok: false, failureKind: 'exception', hint: String(e?.message || e), shopKey, api: apiName }
      }
      await sleep(800 * attempt)
      continue
    }

    const ms = Date.now() - t0

    // 解析（兼容 jsonp 壳 / 纯 JSON / HTML）
    const stripped = get ? stripJsonp(text) : text
    let json = null
    try { json = JSON.parse(stripped) } catch { /* HTML 或异形 */ }

    const bodyStr = String(text || '')
    const retStr = Array.isArray(json?.ret) ? json.ret.join(',') : ''
    const isErrorResp = !json || !/SUCCESS/i.test(retStr)
    const isTokenResp = /FAIL_SYS_TOKEN|令牌为空|令牌过期|TOKEN_EMPTY|TOKEN_EXOIRED|TOKEN_EXPIRED/i.test(retStr)

    // ④ 合并 Set-Cookie（官方规则：错误响应不合并，token 引导 / 验证凭证例外）
    const hdrs = {}
    try { res.headers.forEach((v, k) => { hdrs[k] = v }) } catch { /* ignore */ }
    const absorbed = absorbMtopCookies(res, jar, isErrorResp, isTokenResp)

    // ⑤ 收到 x5sec 等验证凭证 → 立即解除冷却（官方 clearRiskCooldown 同逻辑）
    if (absorbed.riskPassReceived) {
      clearRisk(shopKey)
    }

    // ⑥ 非 JSON：HTML 风控页 / WAF
    if (!json) {
      const rk = riskKind({ html: bodyStr, headers: hdrs })
      if (rk.kind) {
        reportRouteFailure(host)
        const st = markRisk(shopKey, { reason: rk.detail || rk.kind, riskKind: rk.kind })
        return {
          ok: false, failureKind: 'risk_control', riskKind: rk.kind,
          canSolve: rk.canSolve, enforceChangeIp: rk.enforceChangeIp,
          hint: rk.enforceChangeIp
            ? 'IP 级封锁（bxpunish 头）：过滑块无效，需换网络出口。'
            : (rk.canSolve ? '返回风控页，需要人工过滑块。' : '返回 WAF 拦截页，建议稍后重试。'),
          ms, shopKey, api: apiName, remainMs: st.remainMs, strike: st.strike, verifyUrl: st.verifyUrl,
        }
      }
      reportRouteSuccess(host)
      return {
        ok: false, failureKind: 'api_error',
        hint: `非 JSON 响应（status=${res.status}）：${bodyStr.slice(0, 160)}`, ms, shopKey, api: apiName,
      }
    }

    reportRouteSuccess(host)
    const c = classify(json, absorbed.tokenRefreshed)

    if (c.ok) {
      return { ok: true, data: json.data, json, ret: (json.ret || []).join(','), ms, shopKey, api: apiName }
    }

    if (c.kind === 'rate_limit') {
      if (attempt < maxAttempts) { await sleep(600 * attempt); continue }
      return { ok: false, failureKind: 'rate_limit', hint: c.hint, ms, shopKey, api: apiName }
    }

    if (c.kind === 'token_expired') {
      tokenRetry += 1
      // ★ token 引导（官方 fetch_m_h5_tk 模式）：
      //   本地 token 可能已失效。清掉后用**空 token 签名**再发一次 ——
      //   服务端会在 Set-Cookie 里下发新 `_m_h5_tk`，下一轮即可签对。
      if (tokenRetry <= MAX_TOKEN_RETRY && attempt < maxAttempts) {
        delete jar._m_h5_tk
        await sleep(300)
        continue
      }
      return { ok: false, failureKind: 'token_expired', hint: c.hint, ms, shopKey, api: apiName }
    }

    if (c.kind === 'risk_control') {
      const rk = riskKind({ payload: json })
      const verifyUrl = extractVerifyUrl(json)
      const st = markRisk(shopKey, { reason: c.hint, riskKind: rk.kind, verifyUrl })

      // ★ 自动重试：有 verifyUrl（可人工过滑块）时，轮询等冷却被解除再重发
      //   冷却被解除 = 用户已在浏览器过完滑块（x5sec 落库会触发 clearRisk）
      //   对流调用方来说仍是一次 request()，无需自己重调（官方 RISK_AUTO_RETRY 同逻辑）
      if (autoRetryOnRisk && rk.canSolve && verifyUrl) {
        const deadline = Date.now() + RISK_AUTO_RETRY_MAX_WAIT_MS
        let cleared = false
        while (Date.now() < deadline) {
          await sleep(RISK_AUTO_RETRY_POLL_INTERVAL_MS)
          if (!riskState(shopKey).cooling) { cleared = true; break }
        }
        if (cleared) {
          // 重新取一次 Cookie（用户过滑块后凭证已写回凭证库）
          const rePick = await pickTaobaoAccount({ want: shopKey })
          if (rePick.ok) {
            const retryPick = rePick
            return requestInner(apiName, params, { ...opts, autoRetryOnRisk: false }, retryPick)
          }
        }
      }

      return {
        ok: false, failureKind: 'risk_control', riskKind: rk.kind, canSolve: rk.canSolve,
        enforceChangeIp: rk.enforceChangeIp,
        hint: rk.canSolve
          ? `需要人工过滑块。验证地址：${verifyUrl || '(未返回)'}`
          : '接口级封禁（denycdc_forbidden，无滑块可过），基座已记冷却，需等待。',
        ret: c.hint, ms, shopKey, api: apiName,
        remainMs: st.remainMs, strike: st.strike, verifyUrl,
      }
    }

    return { ok: false, failureKind: 'api_error', hint: c.hint, ms, shopKey, api: apiName }
  }

  return { ok: false, failureKind: 'exception', hint: '重试耗尽', shopKey, api: apiName }
}

export async function itemDetail(itemId, opts = {}) {
  return request('item.detail', { id: String(itemId) }, opts)
}

/** 批量：串行 + 逐条容错；命中风控/失效立即停（不打穿账号） */
export async function itemDetailBatch(itemIds, opts = {}) {
  const rows = [], errors = []
  const list = [...itemIds]
  for (let i = 0; i < list.length; i++) {
    const id = list[i]
    if (opts.onProgress) opts.onProgress(i + 1, list.length, id)
    const r = await itemDetail(id, opts)
    if (r.ok) rows.push({ itemId: String(id), data: r.data, json: r.json })
    else {
      errors.push({ itemId: String(id), failureKind: r.failureKind, hint: r.hint, remainMs: r.remainMs })
      if (['risk_control', 'token_expired', 'route_cooldown'].includes(r.failureKind)) break
    }
  }
  return { rows, errors }
}

export default { request, itemDetail, itemDetailBatch }
