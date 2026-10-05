/**
 * DSAgent 本地代理网关 — 复刻 qiworkconnect.exe 的 /api/v1/proxy 行为
 *
 * 技能脚本的 runtime_http.py 会读 DSCONNECT_URL 环境变量，
 * 打 POST /api/v1/proxy 到网关。本模块起一个本地 HTTP 服务器，
 * 接管这个端点，从 CredentialStore 取 Cookie 注入后转发到平台。
 *
 * 与 qiworkconnect.exe 的区别：
 *   - 不需要 RS256/JWKS 令牌验签，DSCONNECT_TOKEN 只做占位
 *   - Cookie 从本地 CredentialStore 取，不从网关侧注入
 *   - 请求由 Node.js http/https 直接发出
 */

import * as nodeHttp from 'node:http'
import * as nodeHttps from 'node:https'
import * as crypto from 'node:crypto'
import { URL } from 'node:url'
import { readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { findChromePath } from './browser-login.js'
import { CredentialStore, credentialPlatform, isRiskPassCookie, normalizePlatform, resolveAccountForRequest, accountsForPlatform } from './services/credential-store.js'
import {
  cacheEnabled,
  cacheStats,
  clearCache,
  invalidateCache,
  buildCacheKey,
  credentialFingerprint,
  getCached,
  setCached,
  isCacheableRequest,
  isCacheableResponse,
  attachCacheMeta,
} from './services/gateway-cache.js'
import { smartTruncateJsonAware } from './services/smart-truncate.js'
import type { AccountChoice } from './services/types.js'

export type { AccountChoice }

export interface GatewayProxy {
  /** 网关地址（技能注入到 DSCONNECT_URL） */
  url: string
  /** 关闭网关 */
  close(): void
}

// ─────────────── 账号级节流 / 风控冷却 ───────────────

/**
 * 账号级节流参数（与原项目 taobao_client.py 逐字一致）：请求间隔 4.0s + 0~2.0s 抖动。
 *
 * 为什么必须放在网关侧：技能里的 MtopCaller._last_request_at 是「实例级」变量，
 * 每次 dsagent_execute_skill 都是新的 Python 子进程，计时器归零 → 首个请求立即发出。
 * 并发跑 N 个技能时各自按 4~6s 节流、互不知情，同一账号的实际出口频率 ≈ N × 1/5s，
 * 必然触发风控。网关是唯一能看见「同一账号全部请求」的地方，节流只有放这里才有效。
 */
const ACCOUNT_INTERVAL_SECONDS = 4.0
const ACCOUNT_INTERVAL_JITTER_SECONDS = 2.0

/** 命中风控后该账号的冷却时长：冷却期内不再向平台发请求，避免继续加刷风险分 */
const ACCOUNT_RISK_COOLDOWN_MS = 60_000

/**
 * 风控验证通过后自动重试：命中 risk_control 后，handleProxy 不立即返回，
 * 而是轮询等待冷却被解除（dsagent_risk_verify 完成验证后会调 clearRiskCooldown），
 * 冷却解除即自动重发原请求，对模型来说是一次 dsagent_proxy 调用。
 */
const RISK_AUTO_RETRY_MAX_WAIT_MS = 120_000
const RISK_AUTO_RETRY_POLL_INTERVAL_MS = 2_000

/** shop_key → 下一个允许发请求的时间戳（毫秒） */
const nextAllowedAt = new Map<string, number>()
/** shop_key → 风控冷却截止时间戳（毫秒） */
const riskCooldownUntil = new Map<string, number>()

/**
 * 风控「验证通过」凭证的 Cookie 名由 `.services/credential-store.ts` 定义（单一真源），
 * 这里只做引用，避免两处漂移。
 */

/** shop_key → 最近一次风控给出的验证入口（供 dsagent_risk_verify 自动取用） */
const lastVerifyUrl = new Map<string, { url: string; at: number }>()

/** 验证入口有效期：30 分钟 */
const VERIFY_URL_TTL_MS = 30 * 60 * 1000

// ─────────────── 出站 UA（与浏览器路径同源） ───────────────

/**
 * HTTP 直连路径的出站 UA。
 *
 * 浏览器路径（puppeteer 启本机 Chrome）已不再覆盖 UA，发的是本机 Chrome 的真实版本；
 * 若这里继续写死老的 Chrome/120，同一账号在平台侧就会呈现「浏览器自称 Chrome 1xx、
 * 接口自称 Chrome 120」的双重人格，且 Node 请求本就不带 sec-ch-ua，反而更可疑。
 * 故此处直接读本机安装目录里的版本号，让两条路径的 UA 同源。
 *
 * 探测失败时回退 CHROME_MAJOR_FALLBACK（等于改造前的取值），不会比原来更差。
 */
const CHROME_MAJOR_FALLBACK = 120
let cachedDesktopUA: string | undefined

function desktopUserAgent(): string {
  if (!cachedDesktopUA) {
    cachedDesktopUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${detectChromeMajor()}.0.0.0 Safari/537.36`
  }
  return cachedDesktopUA
}

/** 从安装目录的子目录名读 Chrome 主版本（形如 `…/Application/134.0.6998.89/`） */
function detectChromeMajor(): number {
  const exe = findChromePath()
  if (!exe) return CHROME_MAJOR_FALLBACK
  try {
    const majors = readdirSync(dirname(exe))
      .filter(d => /^\d+\.\d+\.\d+\.\d+$/.test(d))
      .map(d => Number(d.split('.')[0]))
    return majors.length ? Math.max(...majors) : CHROME_MAJOR_FALLBACK
  } catch {
    return CHROME_MAJOR_FALLBACK
  }
}

/** 取该账号最近一次风控给出的验证入口（已过期或不存在时返回空串） */
export function getLastVerifyUrl(shopKey: string): string {
  const entry = lastVerifyUrl.get(shopKey)
  if (!entry) return ''
  if (Date.now() - entry.at > VERIFY_URL_TTL_MS) {
    lastVerifyUrl.delete(shopKey)
    return ''
  }
  return entry.url
}

/** 清除风控冷却（验证通过后立即放行，不必再等满 60s） */
export function clearRiskCooldown(shopKey: string): void {
  riskCooldownUntil.delete(shopKey)
  // ★ 风控验证通过 → 凭证（x5sec 等）已变化，此前缓存的响应可能是在
  //   「未通过验证」的上下文里拿到的，应一并失效，避免读到陈旧数据。
  //   同时这也让「验证后重试」一定打到平台而非命中旧缓存。
  invalidateCache({ shopKey })
}

/* ─────────────── 网关响应缓存（对外接口）─────────────── */

/** 缓存运行状态（供排障工具展示命中率等） */
export function gatewayCacheStats() {
  return cacheStats()
}

/**
 * 失效缓存。
 *
 * 主要调用时机：账号重新登录后（凭证已变，旧数据不该再被读到）。
 * 不传参数则清空全部。
 */
export function invalidateGatewayCache(filter?: { shopKey?: string; platform?: string }): number {
  return invalidateCache(filter)
}

/** 清空全部网关缓存 */
export function clearGatewayCache(): number {
  return clearCache()
}

/**
 * 按平台取最近一次风控给出的验证入口。
 *
 * 模型只会传 platform（不该逼它自己拼 URL），所以这里扫该平台及其凭证平台下的账号：
 * 精确平台优先（闲鱼的验证入口不能拿淘宝账号的）。
 */
export function getLastVerifyUrlByPlatform(store: CredentialStore, platform: string): string {
  const cred = credentialPlatform(platform)
  const candidates = store.listAccounts().filter(
    a => a.platform === platform || credentialPlatform(a.platform) === cred,
  )
  const ordered = [
    ...candidates.filter(a => a.platform === platform),
    ...candidates.filter(a => a.platform !== platform),
  ]
  for (const a of ordered) {
    const url = getLastVerifyUrl(a.shop_key)
    if (url) return url
  }
  return ''
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * 账号级节流：保证同一账号两次请求间隔 ≥ 4~6s。
 * 先同步「占位」下一个时间槽再 await，保证并发调用各自拿到互不重叠的槽位。
 */
async function throttleAccount(shopKey: string): Promise<number> {
  const interval = ACCOUNT_INTERVAL_SECONDS * 1000
  const jitter = Math.random() * ACCOUNT_INTERVAL_JITTER_SECONDS * 1000
  const now = Date.now()
  const startAt = Math.max(now, nextAllowedAt.get(shopKey) ?? 0)
  nextAllowedAt.set(shopKey, startAt + interval + jitter)
  const waitMs = startAt - now
  if (waitMs > 0) await sleep(waitMs)
  return waitMs
}

/** 风控冷却剩余毫秒数（0 = 无冷却） */
function riskCooldownRemaining(shopKey: string): number {
  return Math.max(0, (riskCooldownUntil.get(shopKey) ?? 0) - Date.now())
}

// ─────────────── 四级账号选择链 ───────────────
//
// 选择链的纯逻辑（resolveAccountForRequest / sortAccountsByPreference / toAccountChoice）
// 定义在 `.services/credential-store.ts`，host 与 browser 半区共用同一份实现。

/** 多账号待选时的统一返回体（不静默选择） */
export function needAccountChoiceResult(platform: string, choices: AccountChoice[], level: number): any {
  const names = choices.map(c => `${c.nickname}（shopKey=${c.shopKey}）`).join('、')
  return {
    status: 'error',
    status_code: 409,
    payload: null,
    set_cookies: [],
    failure_kind: 'need_account_choice',
    error_message:
      `平台 ${platform} 有 ${choices.length} 个可用账号，且当前会话未绑定具体账号，` +
      `为避免选错账号影响所有技能，请让用户选择要使用哪一个：${names}`,
    accounts: choices,
    level,
  }
}

/**
 * 启动本地代理网关。
 *
 * 端口策略：先试 0（系统分配），不固定端口避免冲突。
 * 技能侧通过 DSCONNECT_URL 环境变量拿到地址。
 */
export function startGatewayProxy(store: CredentialStore): Promise<GatewayProxy> {
  return new Promise((resolve, reject) => {
    const server = nodeHttp.createServer(async (req, res) => {
      // CORS / 预检
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Agent-Id')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      const parsed = new URL(req.url || '/', `http://127.0.0.1`)
      const path = parsed.pathname

      // ─────────────── /api/v1/health ───────────────
      if (path === '/api/v1/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, service: 'dsagent-local-proxy', version: '1.0.0' }))
        return
      }

      // ─────────────── /api/v1/proxy ───────────────
      if (path === '/api/v1/proxy' && req.method === 'POST') {
        let bodyStr = ''
        for await (const chunk of req) bodyStr += chunk
        let body: any
        try {
          body = JSON.parse(bodyStr)
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'error', error_message: '请求体不是合法 JSON', failure_kind: 'parse_error' }))
          return
        }

        try {
          const result = await handleProxy(body, store)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (err: any) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            status: 'error',
            error_message: err?.message || String(err),
            failure_kind: 'api_error',
          }))
        }
        return
      }

      // ─────────────── /api/v1/accounts ───────────────
      // 技能 bootstrap 的 fetch_binding_context 会调这个端点
      if (path === '/api/v1/accounts' && req.method === 'GET') {
        const platform = parsed.searchParams.get('platform') || ''
        const agentId = parsed.searchParams.get('agent_id') || ''
        const shopKey = parsed.searchParams.get('shop_key') || ''
        const accounts = store.listAccounts()
        // 候选集与 /api/v1/proxy、host 预检共用 accountsForPlatform()：
        // 精确平台优先 → 凭证所有者平台（如 sycm 请求取 taobao 账号）→ 凭证层派生账号。
        // 旧写法 `a.credential_platform === platform` 在生意参谋系凭证层归并到 taobao 后恒为空，
        // 技能侧 fetch_binding_context(platform='sycm') 会直接拿到 400「未绑定账号」。
        const matched = platform
          ? accountsForPlatform(accounts, normalizePlatform(platform))
          : accounts

        if (!matched.length) {
          // 网关在未绑定时返回 400
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ detail: '未绑定账号' }))
          return
        }

        // 账号选择链：① 显式 shopKey → ② 会话绑定 → ③ 平台默认 → ④ 派生闲鱼优先 → ⑤ 自动兜底
        // 第 ④ 级需要全库行（同号淘宝行）作派生证据，故把 accounts 一并传入。
        const resolved = resolveAccountForRequest(matched, { shopKey, agentId, allAccounts: accounts })
        if (!resolved.account) {
          // 多个可用账号且当前会话未绑定：交给模型问用户（不静默选择）
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            failure_kind: 'need_account_choice',
            detail: `平台 ${platform} 有多个可用账号，请让用户选择`,
            accounts: resolved.choices,
          }))
          return
        }

        // 返回选中账号的上下文（不含 cookie）
        const a = resolved.account
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          shop_key: a.shop_key,
          platform: a.platform,
          // sessionHint 必须与 account-service.ts 的映射保持**逐字一致**，
          // 否则 host 预检与网关会对同一账号给出不同的失败类型（引导文案随之错位）。
          session_hint: a.status === 'valid' ? 'ok'
            : a.status === 'pending' ? 'none'
            : a.status === 'reauth_required' ? 'reauth_required'
            : 'expired',
          display_label: a.display_label,
          tb_token: a.tb_token || null,
          alimama_csrf_id: a.csrf_id || null,
          alimama_login_point_id: a.login_point_id || null,
        }))
        return
      }

      // ─────────────── 其他端点 ───────────────
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ detail: 'not found' }))
    })

    server.on('error', (err) => {
      console.error('[dsagent-gateway] 服务器错误:', err.message)
      reject(err)
    })

    // 端口 0 = 系统分配
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      const url = `http://127.0.0.1:${port}`
      console.log(`[dsagent-gateway] 本地代理网关已启动: ${url}`)
      resolve({
        url,
        close() {
          server.close()
          console.log('[dsagent-gateway] 已关闭')
        },
      })
    })
  })
}

// ─────────────── 代理逻辑 ───────────────

export async function handleProxy(body: any, store: CredentialStore): Promise<any> {
  const kind = String(body.kind || '')
  const platform = String(body.platform || '')
  const agentId = String(body.agent_id || '')
  const explicitShopKey = String(body.shop_key || body.shopKey || '')
  const timeout = Number(body.timeout) || 30
  const targetUrl = String(body.url || '')
  const injectToken = body.inject_token !== false

  if (!kind || !platform || !targetUrl) {
    return {
      status: 'error',
      error_message: '缺少 kind/platform/url',
      failure_kind: 'api_error',
    }
  }

  // 从凭证库取 Cookie
  // 候选集与 host 预检共用 credential-store.ts::accountsForPlatform()：
  // ① 精确平台账号 → ② 凭证所有者平台账号（如 sycm 请求取 taobao 账号 —— 淘宝登录后生意参谋即可用）
  // → ③ 凭证层派生账号；闲鱼/天猫请求不允许降级（域名不同、Cookie 域不同）。
  const bizPlatform = normalizePlatform(platform)
  const skipDegrade = bizPlatform === 'xianyu' || bizPlatform === 'tmall'
  const usableRows = store.listAccounts().filter(a => a.status !== 'invalid')
  const allAccounts = accountsForPlatform(usableRows, bizPlatform, { allowDegrade: !skipDegrade })
  if (!allAccounts.length) {
    return {
      status: 'error',
      error_message: `平台 ${platform} 尚未绑定账号`,
      failure_kind: 'not_bound',
      status_code: 401,
    }
  }

  // 账号选择链：① 显式 shopKey → ② 会话绑定 → ③ 平台默认 → ④ 派生闲鱼优先 → ⑤ 自动兜底
  // `allAccounts` 传全库可用行：第 ④ 级要靠同号淘宝行证明闲鱼行是派生号，
  // 而闲鱼请求的候选集不允许降级（只含闲鱼行），传候选集本级会静默失效。
  const resolved = resolveAccountForRequest(allAccounts, { shopKey: explicitShopKey, agentId, allAccounts: usableRows })
  if (!resolved.account) {
    console.log(`[dsagent-gateway] 需要用户选择账号: platform=${platform}, agentId=${agentId || '(空)'}, level=${resolved.level}, 候选=${resolved.choices.length}`)
    return needAccountChoiceResult(platform, resolved.choices, resolved.level)
  }
  const account = resolved.account
  console.log(`[dsagent-gateway] 选中账号: ${account.shop_key} (platform=${account.platform}, status=${account.status}, level=${resolved.level}, agentId=${agentId || '(空)'}, tb_token=${account.tb_token ? 'YES' : 'NO'})`)
  const cookieStr = account.cookie_str
  if (!cookieStr) {
    return {
      status: 'error',
      error_message: `账号 ${account.shop_key} 无 Cookie`,
      failure_kind: 'token_expired',
      status_code: 401,
    }
  }

  // 风控冷却：命中过风控的账号在冷却期内直接短路，不再向平台发请求
  const coolingMs = riskCooldownRemaining(account.shop_key)
  if (coolingMs > 0) {
    return {
      status: 'error',
      status_code: 429,
      payload: null,
      set_cookies: [],
      failure_kind: 'risk_control',
      error_message: `账号 ${account.shop_key} 刚刚触发平台安全风控，冷却中，请 ${Math.ceil(coolingMs / 1000)} 秒后重试。`,
    }
  }

  // 构建请求头
  const headers: Record<string, string> = {
    'Cookie': cookieStr,
    'User-Agent': desktopUserAgent(),
    'Referer': targetUrl,
    'Accept': 'application/json, text/plain, */*',
  }

  // 合并额外 headers
  if (body.headers && typeof body.headers === 'object') {
    for (const [k, v] of Object.entries(body.headers)) {
      headers[k] = String(v)
    }
  }

  // _tb_token_ 注入（阿里系）
  // MTOP H5 API 需要 _tb_token_ 作为 URL query 参数
  if (injectToken && account.tb_token) {
    // mtop_jsonp 和 http_get/http_post 都把 _tb_token_ 放在 query 参数里
    // 后续在 params 里统一处理
  }

  // 构建最终 URL
  let finalUrl = targetUrl
  const params: Record<string, string> = {}

  // mtop_jsonp 的 extra_params
  if (body.extra_params && typeof body.extra_params === 'object') {
    for (const [k, v] of Object.entries(body.extra_params)) {
      params[k] = String(v)
    }
  }

  // 普通参数
  if (body.params && typeof body.params === 'object') {
    for (const [k, v] of Object.entries(body.params)) {
      if (v !== null && v !== undefined) params[k] = String(v)
    }
  }

  // mtop_jsonp 固定参数
  if (kind === 'mtop_jsonp') {
    if (!params['type']) params['type'] = 'jsonp'
    if (!params['timeout']) params['timeout'] = String(Math.floor(timeout * 1000))
    // 淘宝 MTOP H5 API 必需参数
    const appKey = body.app_key ? String(body.app_key) : '12574478'
    if (!params['appKey']) params['appKey'] = appKey
    if (!params['t']) params['t'] = String(Date.now())
    if (!params['jsv']) params['jsv'] = '2.7.4'
    if (!params['dataType']) params['dataType'] = 'jsonp'
    if (!params['callback']) params['callback'] = 'mtopjsonp' + Date.now()
  }

  // _tb_token_ 作为查询参数（所有 kind 都用）
  if (injectToken && account.tb_token) {
    if (!params['_tb_token_']) params['_tb_token_'] = account.tb_token
  }

  // mtop_jsonp 的 data 作为 query 参数发送（GET 请求）
  // 阿里系 MTOP H5 API 的 data 参数放在 URL query 里，不是 POST body
  let dataStr = ''
  if (kind === 'mtop_jsonp' && body.data) {
    dataStr = typeof body.data === 'string' ? body.data : JSON.stringify(body.data)
    params['data'] = dataStr
  }

  // MTOP sign 签名计算: md5(token & t & appKey & data)
  // token 从 Cookie 中的 _m_h5_tk 提取（下划线前半段）
  // 当 inject_token=false 时，脚本自行计算签名，网关不计算 sign
  if (kind === 'mtop_jsonp' && dataStr && injectToken) {
    const mH5Tk = account.cookies?.['_m_h5_tk'] || ''
    const token = mH5Tk ? mH5Tk.split('_')[0] : ''
    const t = params['t'] || String(Date.now())
    const appKey = params['appKey'] || '12574478'
    const signRaw = `${token}&${t}&${appKey}&${dataStr}`
    const sign = crypto.createHash('md5').update(signRaw, 'utf8').digest('hex')
    params['sign'] = sign
    console.log(`[dsagent-gateway] sign 计算: token=${token ? token.substring(0, 8) + '...' : '(empty)'}, t=${t}, appKey=${appKey}, sign=${sign.substring(0, 8)}...`)
  }

  // 拼接查询参数
  const queryParts = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
  if (queryParts.length) {
    finalUrl += (targetUrl.includes('?') ? '&' : '?') + queryParts.join('&')
  }

  // 发请求
  const method = kind === 'http_post' ? 'POST' : 'GET'
  let postBody: string | undefined
  if (kind === 'http_post' && body.json_body !== undefined && body.json_body !== null) {
    // json_body 可能是字符串（form-urlencoded 等）或对象
    if (typeof body.json_body === 'string') {
      postBody = body.json_body
    } else {
      postBody = JSON.stringify(body.json_body)
    }
    // 如果调用方未指定 Content-Type，默认 JSON
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json; charset=utf-8'
    }
    if (headers['Content-Type'] || headers['content-type']) {
      const ct = headers['Content-Type'] || headers['content-type']
      headers['Content-Type'] = ct
    }
    headers['Content-Length'] = String(Buffer.byteLength(postBody as string))
  }

  // 账号级节流：同一账号两次请求间隔 ≥ 4~6s（并发技能共享同一账号配额）
  //
  // ★ 缓存查找刻意放在节流**之前**：命中缓存就不必等节流、也不必发请求 ——
  //   这正是缓存的主要收益（省掉 4~6s 等待 + 一次平台请求的风控风险）。
  const cacheLookup = (() => {
    if (!cacheEnabled()) return { key: '', hit: false as const }
    const reqOk = isCacheableRequest(kind, targetUrl)
    if (!reqOk.ok) {
      return { key: '', hit: false as const, skip: reqOk.reason }
    }
    const key = buildCacheKey({
      kind,
      platform,
      shopKey: account.shop_key,
      url: targetUrl,
      params,
      postBody,
      credentialFingerprint: credentialFingerprint(cookieStr, account.tb_token),
    })
    const cached = getCached(key)
    if (cached) return { key, hit: true as const, cached }
    return { key, hit: false as const }
  })()

  if (cacheLookup.hit && cacheLookup.cached) {
    console.log(`[dsagent-gateway] 缓存命中（跳过节流与请求）: ${kind} ${targetUrl.substring(0, 120)} shopKey=${account.shop_key}`)
    return cacheLookup.cached
  }

  const waitedMs = await throttleAccount(account.shop_key)
  if (waitedMs > 0) {
    console.log(`[dsagent-gateway] 账号节流等待 ${waitedMs}ms: ${account.shop_key}`)
  }

  try {
    const result = await httpRequest(method, finalUrl, headers, postBody, timeout)

    // 调试日志：查看淘宝返回的原始内容
    console.log(`[dsagent-gateway] ${method} ${finalUrl.substring(0, 200)}... → HTTP ${result.status}, body[0:300]=${result.body.substring(0, 300)}`)

    // 尝试解析 JSON（处理 JSONP 包裹）
    let payload: any = result.body
    try {
      let bodyToParse = result.body
      // mtop_jsonp 的 JSONP 包裹：callback({...}) → 提取 {...}
      if (kind === 'mtop_jsonp') {
        const cbMatch = bodyToParse.match(/^\s*[a-zA-Z_$][\w$]*\(([\s\S]*)\)\s*;?\s*$/)
        if (cbMatch) bodyToParse = cbMatch[1]
      }
      payload = JSON.parse(bodyToParse)
    } catch { /* 非 JSON，原样返回字符串 */ }

    // 对非 JSON 的字符串 payload 做清洗（移除控制字符 + 智能截断）
    if (typeof payload === 'string') {
      payload = payload.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      // 智能头尾保留：日志/HTML 类响应的尾部常有错误信息或结论
      if (payload.length > 5000) payload = smartTruncateJsonAware(payload, 5000)
    }

    // ★ 风控检测增强（吸收 Accio 的风控分类链路）：
    //
    //   原来只扫响应体关键词（rgv587_error / fail_sys_user_validate），会漏判两类风控：
    //   1. bxpunish 响应头 —— 阿里 Baxia WAF 的**权威信号**，比 body 关键词更早、更准
    //   2. HTML/punish 拦截页 —— 风控返回的不是 JSON 而是 HTML 拦截页，
    //      JSON.parse 失败后当字符串截断，body 关键词扫不到 → 漏判风控
    //
    //   Accio 的分类链路（br 函数 + Crt 函数 + iRe 函数）：
    //     · bxpunish 头存在 → WAF_BLOCK（IP 级封锁，过滑块也没用，要换 IP）
    //     · HTML 页含 punish URL → bixi-punish（滑块验证页，过滑块即可解）
    //     · HTML 页但不含 punish → waf-html（WAF 拦截，可能是 IP 或请求特征）
    //
    //   三种风控的引导**完全不同**，混在一起会让用户白费力气。

    /** 是否被 Baxia WAF 封锁（IP 级，bxpunish 头） */
    const bxpunishHeader = result.responseHeaders?.['bxpunish'] || result.responseHeaders?.['Bxpunish'] || ''
    const isWafBlocked = !!bxpunishHeader

    /** 响应体是否是 HTML（风控拦截页的典型特征） */
    const bodyStr0 = typeof result.body === 'string' ? result.body : ''
    const isHtmlResponse = /^\s*<!doctype|^\s*<html/i.test(bodyStr0)
      || bodyStr0.includes('bixi-intl.alicdn.com/punish')

    /** 风控子类型：bixi-punish（滑块）/ waf-html（WAF）/ waf-block（IP 封锁）/ 空（非风控） */
    let riskSubtype: '' | 'bixi-punish' | 'waf-html' | 'waf-block' = ''
    if (isWafBlocked) {
      riskSubtype = 'waf-block'
    } else if (isHtmlResponse) {
      riskSubtype = bodyStr0.includes('punish') ? 'bixi-punish' : 'waf-html'
    }

    // 提取 Set-Cookie 头（用于闲鱼 _m_h5_tk 等 token 获取）
    const setCookies: string[] = []
    if (result.setCookieHeaders && result.setCookieHeaders.length) {
      setCookies.push(...result.setCookieHeaders)
    }

    // 如果有新 Cookie，合并回凭证库（网关侧自动刷新）
    // 但风控/错误响应的 Set-Cookie 不应覆盖有效 Cookie（淘宝风控会返回空 _m_h5_tk）
    // 注意：FAIL_SYS_ILLEGAL_ACCESS 是 MTOP token 初始化的正常响应，需要合并 Set-Cookie
    const bodyLower0 = bodyStr0.toLowerCase()
    // ★ MTOP 响应只认 `ret` 数组（平台的权威结果位），禁止对整包 body 做关键词子串匹配：
    //   商品/内容类接口会把用户 UGC（商品标题、描述、留言）原样带回，里面可能恰好含
    //   `FAIL_SYS_TOKEN_EMPTY::令牌为空` / `fail_...` 这类字样。实测闲鱼搜 "token" 的结果里
    //   就有卖家把原始 API 报错文本贴进了商品描述 —— 全文匹配会把**成功的**搜索
    //   （ret=SUCCESS::调用成功、20 条商品）判成 token_expired，让用户白去重新登录。
    //   非 MTOP 响应（HTML / 纯文本 / 无 ret 的 JSON）仍按整包文本扫描。
    const mtopRet = payload && typeof payload === 'object' && Array.isArray((payload as any).ret)
      ? (payload as any).ret.map((x: unknown) => String(x)).join(' | ').toLowerCase()
      : null
    /** 错误判定用文本：MTOP 取 ret，其余取整包 */
    const scan = mtopRet ?? bodyLower0
    const hasIllegalAccess = scan.includes('fail_sys_illegal_access')
    // FAIL_SYS_TOKEN_EMPTY::令牌为空 = 账号库里还没有 _m_h5_tk（首次调 MTOP 的必经响应），
    // 该响应必带 Set-Cookie: _m_h5_tk=... ，属于 token「引导响应」，与 ILLEGAL_ACCESS 同类。
    // 若把它当错误响应处理 → 新下发的 _m_h5_tk 被丢弃 → 后续每次请求 token 都为空 →
    // 反复无效请求最终被平台判风控（FIX-LOG #52）。
    const hasTokenEmpty = scan.includes('fail_sys_token_empty')
    // MTOP API 实际返回 FAIL_SYS_TOKEN_EXOIRED（拼写错误：EXO**I**RED），同时检查两种拼写
    const hasTokenExpired = scan.includes('fail_sys_token_expired') || scan.includes('fail_sys_token_exoired')
    // FAIL_SYS_TOKEN_ILLEGAL：请求携带的 _m_h5_tk 与 sign 用的 token 不一致（常见于 token 被刷新过），
    // 响应同样会下发新的 _m_h5_tk，必须合并回凭证库，否则后续请求永远对不上签名
    const hasTokenIllegal = scan.includes('fail_sys_token_illegal')
    const hasBizLogin = scan.includes('fail_biz_login') || scan.includes('登录站点非法') || scan.includes('login_expired')
    // FAIL_SYS_ILLEGAL_ACCESS / FAIL_SYS_TOKEN_EMPTY / FAIL_SYS_TOKEN_EXPIRED / FAIL_SYS_TOKEN_ILLEGAL
    // 都会下发新 _m_h5_tk，不算错误响应（Set-Cookie 必须合并回凭证库）
    const hasOtherFail = scan.includes('fail_') && !hasIllegalAccess && !hasTokenEmpty && !hasBizLogin && !hasTokenExpired && !hasTokenIllegal
    const isErrorResp = scan.includes('rgv587_error') || scan.includes('被挤爆') || hasBizLogin || hasOtherFail || result.status >= 400
    /** 本次响应是否下发了新的 _m_h5_tk（token 是否被自动刷新） */
    let tokenRefreshed = false
    /** 本次响应是否下发了风控验证凭证（x5sec 等 → 用户已通过安全验证） */
    let riskPassReceived = false
    if (setCookies.length) {
      const newJar: Record<string, string> = {}
      for (const sc of setCookies) {
        const part = sc.split(';')[0]
        if (part.includes('=')) {
          const [k, ...vParts] = part.split('=')
          newJar[k.trim()] = vParts.join('=').trim()
        }
      }
      // 错误响应默认不合并（风控会下发空 _m_h5_tk，覆盖会冲掉登录态）。
      // 例外：风控验证凭证必须落库 —— 用户过完滑块平台把它下发在 RGV587 响应里，
      // 不落库则后续请求永远带不上，「完成验证」这半个动作白做（FIX-LOG #48）。
      const merged: Record<string, string> = {}
      for (const [k, v] of Object.entries(newJar)) {
        if (!v) continue
        const isRiskPass = isRiskPassCookie(k)
        if (!isErrorResp || isRiskPass) merged[k] = v
        if (isRiskPass) riskPassReceived = true
      }
      if (Object.keys(merged).length) {
        await store.setCookies(account.shop_key, merged)
        // 平台下发了新的 _m_h5_tk → 签名用 token 已刷新并落库，脚本重试即可成功
        if (merged['_m_h5_tk']) tokenRefreshed = true
        if (riskPassReceived) {
          // 验证凭证已落库 → 立即解除冷却，下次请求即可带上
          clearRiskCooldown(account.shop_key)
          console.log(`[dsagent-gateway] 收到风控验证凭证（x5sec 等），账号冷却已解除: ${account.shop_key}`)
        }
      }
    }

    // 检测风控/登录失效（判定依据见上方 `scan`：MTOP 只认 ret，避免被 UGC 文本误伤）
    let failureKind = ''

    // ★ 优先判定 bxpunish 头 / HTML 风控页（比 body 关键词更早、更准）。
    //   Accio 的 br 函数在最前面就查 bxpunish 头，我们同理。
    if (riskSubtype === 'waf-block') {
      // IP 级封锁：bxpunish 头存在，过滑块也没用，必须换网络出口
      failureKind = 'risk_control'
      // 不标 expired（账号本身没失效，只是 IP 被封）
      const bxuuid = result.responseHeaders?.['bxuuid'] || result.responseHeaders?.['Bxuuid'] || ''
      console.warn(`[dsagent-gateway] Baxia WAF 拦截（IP 级）：bxpunish=${bxpunishHeader}, bxuuid=${bxuuid}, shopKey=${account.shop_key}`)
    } else if (riskSubtype === 'bixi-punish') {
      // 滑块验证页：过滑块即可解，走 risk_verify 流程
      failureKind = 'risk_control'
      console.warn(`[dsagent-gateway] bixi-punish 滑块验证页拦截：shopKey=${account.shop_key}`)
    } else if (riskSubtype === 'waf-html') {
      // WAF HTML 拦截（非 punish）：可能是 IP 或请求特征，引导换 IP + 重试
      failureKind = 'risk_control'
      console.warn(`[dsagent-gateway] WAF HTML 拦截（非 punish 页）：shopKey=${account.shop_key}`)
    }

    if (!failureKind && (result.status === 403 || scan.includes('未登录') || scan.includes('请登录'))) {
      failureKind = 'risk_control'
      store.setStatus(account.shop_key, 'expired')
    } else if (hasBizLogin) {
      // 明确的登录态过期
      failureKind = 'token_expired'
    } else if (hasTokenExpired && !hasIllegalAccess) {
      // FAIL_SYS_TOKEN_EXPIRED::令牌过期 = MTOP 的 _m_h5_tk 失效。必须分两种情况：
      //   a) 平台同时下发了新的 _m_h5_tk → token 已自动刷新并落库，标记 rate_limit 让脚本重试，重试即成功
      //   b) 平台没有下发新 token（例如账号库里根本没有 _m_h5_tk）→ 无法自愈，
      //      必须报 token_expired 引导用户重新登录；报成「接口限流」会让用户白等、模型误判
      failureKind = tokenRefreshed ? 'rate_limit' : 'token_expired'
    } else if (hasTokenEmpty) {
      // FAIL_SYS_TOKEN_EMPTY：本次请求必然拿不到数据（data 为空），但平台已下发新的 _m_h5_tk。
      // 报 rate_limit 让脚本按既有退避策略重试一次 —— 重试时 token 已落库，签名即正确、即成功。
      // 不能报空 failureKind：那会让脚本把空 data 当成「成功但无数据」静默返回（false PASS）。
      failureKind = tokenRefreshed ? 'rate_limit' : 'token_expired'
    } else if (
      scan.includes('rgv587_error') || scan.includes('被挤爆') || scan.includes('稍后重试')
      // FAIL_SYS_USER_VALIDATE：平台要求先完成人机验证，同样属风控（其实体常与 RGV587 同在，但需单独兜底）
      || scan.includes('fail_sys_user_validate')
    ) {
      // 风控拦截但不标记账号为 expired（稍后可重试）
      failureKind = 'risk_control'
    } else if (result.status >= 400 && !hasIllegalAccess && !hasTokenIllegal && !hasTokenExpired) {
      // HTTP 4xx/5xx 兜底判定。
      // MTOP 的 FAIL_SYS_ILLEGAL_ACCESS / FAIL_SYS_TOKEN_* 都是 HTTP 200 的正常响应，
      // 不会走到这里；走到这里说明是真实失败（路径不存在 404、服务端 5xx、网关拦截等）。
      // 若不判失败，脚本会把 "404 page not found" 当成成功响应、静默返回空数据（false PASS）。
      if (result.status === 401 || result.status === 419) failureKind = 'token_expired'
      else if (result.status === 429) failureKind = 'rate_limit'
      else failureKind = 'api_error'
    }
    // 注意：FAIL_SYS_ILLEGAL_ACCESS 是 MTOP token 初始化的正常响应，不标记为任何错误

    // ── 通用业务码错误判定（非阿里系平台）──
    // 小红书 / 抖音 等平台的接口即便返回 HTTP 200，也会在响应体里用业务码表达失败，
    // 形如 {"code":-104,"success":false,"msg":"您当前登录的账号没有权限访问"}。
    // 此前归因只认 MTOP/阿里系关键词 → 这类响应被判为 success，调用方误判成功（false PASS）。
    if (!failureKind && result.status < 400 && payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const p = payload as Record<string, unknown>
      // MTOP 响应带 ret 数组，已由上方关键词分支处理，此处不再重复判定
      const isMtop = Array.isArray(p.ret)
      if (!isMtop) {
        const rawCode = p.code
        const codeNum = typeof rawCode === 'number'
          ? rawCode
          : (typeof rawCode === 'string' && /^-?\d+$/.test(rawCode.trim()) ? Number(rawCode.trim()) : null)
        const codeBad = codeNum !== null && codeNum !== 0 && codeNum !== 200
        const successFalse = p.success === false
        const okFalse = p.ok === false
        const statusErr = typeof p.status === 'string' && p.status.toLowerCase() === 'error'
        if (codeBad || successFalse || okFalse || statusErr) {
          const msg = String(p.msg ?? p.message ?? p.error ?? p.error_message ?? '')
          const msgLower = msg.toLowerCase()
          const looksRisk = /风控|安全验证|滑块|captcha|risk_control|verify/.test(msgLower)
          // 登录态类业务码：文案含登录/权限/未授权，或命中登录失效族码值
          const looksToken = /登录|权限|未授权|unauthor|login|session|guest/.test(msgLower)
            || (codeNum !== null && [-100, -101, -104].includes(codeNum))
          if (looksRisk) {
            failureKind = 'risk_control'
          } else if (looksToken) {
            failureKind = 'token_expired'
            // 业务码表明登录态已失效 → 回写账号状态，避免账号页继续显示「有效」
            store.setStatus(account.shop_key, 'expired')
          } else {
            failureKind = 'api_error'
          }
          console.log(`[dsagent-gateway] 业务码失败判定: code=${codeNum} success=${String(p.success)} → ${failureKind}（${msg.slice(0, 80)}）`)
        }
      }
    }

    // 命中风控 → 该账号进入冷却期，冷却期内后续请求直接短路（见 riskCooldownRemaining）
    if (failureKind === 'risk_control') {
      riskCooldownUntil.set(account.shop_key, Date.now() + ACCOUNT_RISK_COOLDOWN_MS)
      console.log(`[dsagent-gateway] 命中风控，账号进入 ${ACCOUNT_RISK_COOLDOWN_MS / 1000}s 冷却: ${account.shop_key}`)
    }

    // 失败时带上响应体摘要，便于模型区分「路径写错」和「服务端错误」。
    // MTOP 的响应体解析后是对象（{ret:[...],data:{...}}），只处理字符串会让
    // error_message 退化成光秃秃的「平台返回 HTTP 200」，模型拿不到任何线索。
    const bodySnippet = failureKind
      ? `: ${typeof payload === 'string' ? payload.slice(0, 200) : JSON.stringify(payload).slice(0, 200)}`
      : ''

    // 风控拦截时把「平台要求完成的验证入口」透出给用户。
    // 淘宝 MTOP 命中 RGV587_ERROR / FAIL_SYS_USER_VALIDATE 时响应体形如
    //   { ret: [...], data: { url: "https://h5api.m.taobao.com/.../punish?x5secdata=..." } }
    // 该链接就是平台给出的安全验证入口：用户在自己的浏览器（已登录淘宝）打开并完成
    // 滑块验证即可解封。不透出的话模型只能笼统地让用户「去重新登录」，用户无从下手。
    let verifyUrl = ''
    if (failureKind === 'risk_control' && payload && typeof payload === 'object') {
      const u = (payload as any)?.data?.url
      if (typeof u === 'string' && /^https?:\/\//.test(u)) verifyUrl = u
    }
    // 记下验证入口，供 dsagent_risk_verify 免参数取用（模型只需给 platform）
    if (verifyUrl) {
      lastVerifyUrl.set(account.shop_key, { url: verifyUrl, at: Date.now() })
    }

    // ── 风控验证通过后自动重试（REQUIREMENTS §4.2）──
    // 命中 risk_control 且有 verifyUrl 时，不立即返回错误，而是轮询等待冷却被解除
    // （dsagent_risk_verify 完成验证后 clearRiskCooldown 会清掉 riskCooldownUntil）。
    // 冷却解除即说明验证已通过，自动用原参数重发一次请求。
    // 对模型来说这是同一次 dsagent_proxy 调用，无需模型再调一次。
    if (failureKind === 'risk_control' && verifyUrl) {
      console.log(`[dsagent-gateway] 风控命中，等待验证通过后自动重试（最多 ${RISK_AUTO_RETRY_MAX_WAIT_MS / 1000}s）: ${account.shop_key}`)
      const retryDeadline = Date.now() + RISK_AUTO_RETRY_MAX_WAIT_MS
      let cooldownCleared = false
      while (Date.now() < retryDeadline) {
        await sleep(RISK_AUTO_RETRY_POLL_INTERVAL_MS)
        if (riskCooldownRemaining(account.shop_key) === 0) {
          cooldownCleared = true
          break
        }
      }
      if (cooldownCleared) {
        console.log(`[dsagent-gateway] 风控冷却已解除，自动重发原请求: ${account.shop_key}`)
        // 重发时重新取 Cookie（验证通过后 x5sec 等凭证已落库）
        const freshAccount = store.get(account.shop_key)
        const freshCookieStr = freshAccount?.cookie_str
        if (freshCookieStr) {
          // 用更新后的 Cookie 重发，不二次节流（已等过验证时间）
          const retryHeaders = { ...headers, 'Cookie': freshCookieStr }
          const retryResult = await httpRequest(method, finalUrl, retryHeaders, postBody, timeout)
          console.log(`[dsagent-gateway] 重试响应: HTTP ${retryResult.status}, body[0:300]=${retryResult.body.substring(0, 300)}`)
          // 重试结果若再次命中风控，不再等待，直接返回
          let retryPayload: any = retryResult.body
          try {
            let retryBody = retryResult.body
            if (kind === 'mtop_jsonp') {
              const cbMatch = retryBody.match(/^\s*[a-zA-Z_$][\w$]*\(([\s\S]*)\)\s*;?\s*$/)
              if (cbMatch) retryBody = cbMatch[1]
            }
            retryPayload = JSON.parse(retryBody)
          } catch { /* 非 JSON，保持原始字符串 */ }

          // 合并重试响应的 Set-Cookie
          const retrySetCookies = retryResult.setCookieHeaders
          if (retrySetCookies && retrySetCookies.length) {
            const retryJar: Record<string, string> = {}
            for (const sc of retrySetCookies) {
              const part = sc.split(';')[0]
              if (part.includes('=')) {
                const [k, ...vParts] = part.split('=')
                retryJar[k.trim()] = vParts.join('=').trim()
              }
            }
            if (Object.keys(retryJar).length) await store.setCookies(account.shop_key, retryJar)
          }

          // 判定重试结果是否成功
          const retryScan = (typeof retryPayload === 'string' ? retryPayload : JSON.stringify(retryPayload)).toLowerCase()
          const retryHasRisk = retryScan.includes('rgv587_error') || retryScan.includes('fail_sys_user_validate')
          if (!retryHasRisk && retryResult.status < 400) {
            console.log(`[dsagent-gateway] 自动重试成功: ${account.shop_key}`)
            const retryOk = {
              status: 'success',
              status_code: retryResult.status,
              payload: retryPayload,
              set_cookies: retrySetCookies || [],
              failure_kind: '',
              risk_pass_received: false,
              error_message: '',
              auto_retried: true,
            }
            // 重试成功的结果同样入缓存：这是「用户过完验证后的正常数据」，
            // 缓存它可让随后几分钟的重复请求免于再次触发风控。
            if (cacheEnabled() && cacheLookup.key) {
              const respOk = isCacheableResponse(retryOk)
              if (respOk.ok) {
                setCached(
                  cacheLookup.key,
                  attachCacheMeta(retryOk as unknown as Record<string, unknown>, account.shop_key, account.platform),
                  retryPayload,
                )
              }
            }
            return retryOk
          }
          // 重试仍失败 → 返回重试结果
          return {
            status: 'error',
            status_code: retryResult.status,
            payload: retryPayload,
            set_cookies: retrySetCookies || [],
            failure_kind: retryHasRisk ? 'risk_control' : 'api_error',
            risk_pass_received: false,
            error_message: `验证通过后自动重试仍失败: HTTP ${retryResult.status}`,
            auto_retried: true,
          }
        }
      }
      // 等待超时未通过验证 → 走正常风控返回路径
      console.log(`[dsagent-gateway] 自动重试等待超时，返回风控错误: ${account.shop_key}`)
    }

    // ★ HTTP 429/503 自动退避重试（吸收 Accio 的 retry policy）：
    //
    //   Accio 的退避策略：initialBackoff × backoffMultiplier^(n-1)，带上限 maxBackoff + 抖动。
    //   这里简化为固定退避序列 [2s, 4s, 8s]（3 次），因为网关层不宜长时间阻塞。
    //
    //   仅对**可重试状态码**生效（429=限流、503=服务不可用），其他 4xx/5xx 直接返回。
    //   重试不二次节流（已经等过退避时间），且不进缓存（重试中间态不缓存）。
    if (!failureKind && (result.status === 429 || result.status === 503)) {
      const backoffSeq = [2_000, 4_000, 8_000]
      for (let attempt = 0; attempt < backoffSeq.length; attempt++) {
        const waitMs = backoffSeq[attempt]
        console.log(`[dsagent-gateway] HTTP ${result.status} 退避重试 ${attempt + 1}/${backoffSeq.length}（等待 ${waitMs / 1000}s）: ${account.shop_key}`)
        await sleep(waitMs)
        const retryHeaders = { ...headers, 'Cookie': store.get(account.shop_key)?.cookie_str || cookieStr }
        const retryResult = await httpRequest(method, finalUrl, retryHeaders, postBody, timeout)
        if (retryResult.status < 400 && retryResult.status !== 429 && retryResult.status !== 503) {
          // 重试成功
          let retryPayload: any = retryResult.body
          try {
            let retryBody = retryResult.body
            if (kind === 'mtop_jsonp') {
              const cbMatch = retryBody.match(/^\s*[a-zA-Z_$][\w$]*\(([\s\S]*)\)\s*;?\s*$/)
              if (cbMatch) retryBody = cbMatch[1]
            }
            retryPayload = JSON.parse(retryBody)
          } catch { /* 非 JSON，保持原始字符串 */ }
          console.log(`[dsagent-gateway] HTTP ${result.status} 退避重试成功（第 ${attempt + 1} 次）: ${account.shop_key}`)
          return {
            status: 'success',
            status_code: retryResult.status,
            payload: retryPayload,
            set_cookies: retryResult.setCookieHeaders || [],
            failure_kind: '',
            risk_pass_received: false,
            error_message: '',
            auto_retried: true,
          }
        }
      }
      // 退避重试全部失败 → 返回 rate_limit
      console.warn(`[dsagent-gateway] HTTP ${result.status} 退避重试 3 次后仍失败: ${account.shop_key}`)
      failureKind = 'rate_limit'
    }

    const finalResponse = {
      status: failureKind ? 'error' : 'success',
      status_code: result.status,
      payload,
      set_cookies: setCookies,
      failure_kind: failureKind,
      risk_pass_received: riskPassReceived,
      error_message: failureKind
        ? (riskSubtype === 'waf-block'
            ? `触发平台 WAF 拦截（IP 级封锁，bxpunish 头）。过滑块无法解决 —— 请更换网络出口（切换 WiFi / 热点 / 代理）后重试。`
            : riskSubtype === 'bixi-punish'
              ? (verifyUrl
                  ? `触发平台安全风控（滑块验证页）。请调用 dsagent_risk_verify（platform=${account.platform}）由插件自动打开验证页，完成滑块后验证凭证会自动写回账号并解除风控，随后重试本技能即可。也可手动打开：${verifyUrl}`
                  : `触发平台安全风控（滑块验证页）。请调用 dsagent_risk_verify（platform=${account.platform}）完成滑块验证后重试。`)
              : riskSubtype === 'waf-html'
                ? `触发平台 WAF 拦截（HTML 页，非滑块）。建议：① 更换网络出口；② 等待几分钟后重试；③ 若持续被拦，检查请求频率是否过高。`
                : verifyUrl
                  ? `触发平台安全风控。请调用 dsagent_risk_verify（platform=${account.platform}）由插件自动打开验证页，完成滑块后验证凭证会自动写回账号并解除风控，随后重试本技能即可。也可手动打开：${verifyUrl}`
                  : `平台返回 HTTP ${result.status}${bodySnippet}`)
        : '',
    }

    // ★ 写入缓存（仅当请求可缓存 + 响应可缓存）。
    //   两道闸门缺一不可：
    //     · isCacheableRequest  —— 排除写操作（http_post / 写语义 URL）
    //     · isCacheableResponse —— 排除失败响应（尤其风控/登录失效，缓存住会让故障持续整个 TTL）
    if (cacheEnabled() && cacheLookup.key && !cacheLookup.hit) {
      const respOk = isCacheableResponse(finalResponse)
      if (respOk.ok) {
        setCached(
          cacheLookup.key,
          attachCacheMeta(finalResponse as unknown as Record<string, unknown>, account.shop_key, account.platform),
          payload,
        )
      }
    }

    return finalResponse
  } catch (err: any) {
    return {
      status: 'error',
      error_message: `代理请求失败: ${err?.message || String(err)}`,
      failure_kind: 'api_error',
    }
  }
}

// ─────────────── 阿里妈妈 csrfId / loginPointId 探测 ───────────────

const CHECK_ACCESS_URL = 'https://one.alimama.com/member/checkAccess.json'

/** checkAccess 探测结果。`csrfId` 为空即表示未取得生意参谋系权限（`status=0` 代表请求本身失败）。
 *  `ok`/`errorCode` 取自响应体 `info` 字段：`errorCode=5008004` 表示「未登录」，其余业务码（如 5008005 权限类）
 *  代表已登录但无权限 —— 二者绝不能混为一谈，否则巡检会把无权限账号误标为登录失效。
 */
interface AlimamaAccess {
  status: number
  csrfId: string
  loginPointId: string
  ok: boolean
  errorCode: number | null
}

/**
 * 用给定 Cookie 调一次阿里妈妈 checkAccess，取 csrfId / loginPointId / 错误语义。
 * 不抛错：网络异常返回 `status: 0`，由调用方决定文案。
 */
async function fetchAlimamaAccess(cookieStr: string): Promise<AlimamaAccess> {
  const headers: Record<string, string> = {
    'Cookie': cookieStr,
    'User-Agent': desktopUserAgent(),
    'Content-Type': 'application/json; charset=utf-8',
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://one.alimama.com',
    'Referer': 'https://one.alimama.com/index.html',
  }
  const body = JSON.stringify({ bizCode: 'universalBP' })
  headers['Content-Length'] = String(Buffer.byteLength(body))

  try {
    const result = await httpRequest('POST', CHECK_ACCESS_URL, headers, body, 30)
    let payload: any = result.body
    try { payload = JSON.parse(result.body) } catch { /* 非 JSON */ }
    const access = payload?.data?.accessInfo
    const info = payload?.info
    const rawCode = info?.errorCode
    return {
      status: result.status,
      csrfId: String(access?.csrfId || ''),
      loginPointId: String(payload?.data?.loginPointId || ''),
      ok: info?.ok !== false,
      errorCode: (typeof rawCode === 'number' ? rawCode : null) as number | null,
    }
  } catch (e: any) {
    console.warn('[dsagent-gateway] checkAccess 探测失败:', e?.message || String(e))
    return { status: 0, csrfId: '', loginPointId: '', ok: false, errorCode: null }
  }
}

/**
 * 补齐生意参谋系账号（万相台/达摩盘技能用）的 `csrf_id` / `login_point_id`。
 *
 * 这两个值不是 Cookie，Cookie 里拿不到（实测 sycm / one.alimama.com / dmp 三个域
 * 都不下发 `_csrf`）。权威来源是阿里妈妈接口：
 *   POST https://one.alimama.com/member/checkAccess.json
 *   Body: {"bizCode": "universalBP"}
 *   → data.accessInfo.csrfId + data.loginPointId
 * 万相台（keyword-traffic）、达摩盘（competitor-indicator）等技能都依赖它。
 *
 * ★ 取号必须按「万相台请求实际会选中的账号」来，不能硬编码 `credential_platform === 'sycm'`：
 * 生意参谋系的凭证层已归并到 taobao（登录淘宝后生意参谋即可用，账号页不再有独立登录入口），
 * 硬编码 'sycm' 一个账号都匹配不到 → csrfId 永远补不上 → 万相台/达摩盘技能静默拿不到数据。
 *
 * 已有值时直接返回，避免每次启动都打请求。
 */
export async function ensureAlimamaTokens(store: CredentialStore): Promise<boolean> {
  const accounts = accountsForPlatform(store.listAccounts(), 'alimama')
    .filter(a => a.status !== 'invalid')
  const account = accounts.find(a => !a.csrf_id || !a.login_point_id)
  if (!account) return false
  if (!account.cookie_str) return false

  const { status, csrfId, loginPointId } = await fetchAlimamaAccess(account.cookie_str)
  if (!csrfId) {
    console.warn(`[dsagent-gateway] checkAccess 未返回 csrfId (HTTP ${status})`)
    return false
  }
  await store.setAlimamaTokens(account.shop_key, csrfId, loginPointId)
  console.log(`[dsagent-gateway] 已补齐 ${account.shop_key} 的 csrfId/loginPointId`)
  return true
}

/**
 * 需要做阿里妈妈权限预检（csrfId）的业务平台。
 *
 * ★ 必须按**平台名**判断，不能写成 `credentialPlatform(platform) !== 'sycm'`：
 * 生意参谋系的凭证层已归并到 taobao，`credentialPlatform('sycm')` 现在返回 'taobao'，
 * 用凭证层判断会让生意参谋/万相台/达摩盘登录后**跳过**权限预检，用户又回到
 * 「技能报 code=-1 才知道没权限」的老问题（FIX-LOG #66）。
 */
const SYCM_PERMISSION_PLATFORMS = new Set(['sycm', 'alimama', 'dmp', 'sycm_insight'])

/**
 * 登录后平台权限预检（生意参谋系）：当场告知「是哪个店 / 有没有权限」，
 * 而不是等用户跑技能时才报 code=-1（FIX-LOG #66）。
 *
 * 返回一段可直接拼到登录成功文案后的提示；非生意参谋系平台返回空串。
 * 不抛错 —— 预检失败只提示，不影响「登录本身已成功」这个事实。
 */
export async function probePlatformPermission(
  store: CredentialStore,
  platform: string,
  shopKey: string,
): Promise<string> {
  if (!SYCM_PERMISSION_PLATFORMS.has(normalizePlatform(platform))) return ''

  const account = store.get(shopKey)
  if (!account?.cookie_str) return '\n⚠️ 生意参谋权限预检未执行：本地缺少该账号的 Cookie。'

  // 与技能请求共用账号级节流，避免预检打乱同一账号的出口频率
  await throttleAccount(shopKey)

  const { status, csrfId, loginPointId } = await fetchAlimamaAccess(account.cookie_str)
  if (!csrfId) {
    const reason = status === 0
      ? '请求失败（网络异常或超时）'
      : `checkAccess 返回 HTTP ${status} 且未带 csrfId`
    console.warn(`[dsagent-login] 权限预检未通过: ${shopKey}（${reason}）`)
    return `\n⚠️ 生意参谋权限预检未通过：${reason}。`
      + '该账号可能未开通生意参谋/万相台权限，或登录的店铺与预期不一致。'
      + '跑生意参谋系技能（万相台、达摩盘、巡店管家等）前，请先用该账号在浏览器里确认能打开 sycm.taobao.com。'
  }

  await store.setAlimamaTokens(shopKey, csrfId, loginPointId)
  console.log(`[dsagent-login] 权限预检通过: ${shopKey}（csrfId 已就绪）`)
  return `\n✅ 生意参谋权限预检通过（店铺 ${account.display_label}）：万相台/达摩盘所需凭证（csrfId）已就绪。`
}

// ─────────────── 远程登录态探测（健康巡检用） ───────────────

/** 探测结果：valid=远端确认已登录 / expired=远端确认为游客 / unknown=无法判定（网络异常或平台未支持） */
export type SessionProbeResult = 'valid' | 'expired' | 'unknown'

const XHS_HOME_URL = 'https://www.xiaohongshu.com/explore'
const XHS_MAX_REDIRECTS = 3

/**
 * 远程轻量探测账号登录态。
 *
 * 为什么不能只看本地 Cookie：关键 Cookie 齐全 ≠ 登录态有效。
 * 服务端可以让 `web_session` 失效（风控、异地登录、过期），
 * 此时本地 Cookie 结构完好，账号页仍显示「有效」，用户被误导。
 *
 * 小红书探测点选型（实测）：`/api/sns/**` 全部要求 `x-s` / `x-t` / `x-s-common`
 * 签名（jsvmp 加密），无签名恒返回 HTTP 406，无区分度；
 * 而**首页 HTML 是 SSR 渲染**，内嵌 `"user":{"loggedIn":..,"userInfo":{...}}`，
 * 无需签名即可判定：
 *   - 登录态有效 → `loggedIn:true`
 *   - Cookie 已失效（服务端视为游客）→ `loggedIn:false` + `guest:true` + 真实 userId
 *   - 无 Cookie / 垃圾 Cookie → `userId:undefined` 且无 `guest` 字段
 *
 * 目前只覆盖小红书；其他平台返回 `unknown`，保持原状态不做误判。
 */
export async function probeRemoteSession(account: {
  platform: string
  shop_key: string
  cookie_str: string
}): Promise<{ result: SessionProbeResult; reason?: string }> {
  const cred = credentialPlatform(account.platform)
  if (!account.cookie_str) return { result: 'unknown', reason: '缺少 Cookie' }
  // 与技能请求共用账号级节流，避免巡检打乱同一账号的出口频率
  await throttleAccount(account.shop_key)

  if (cred === 'taobao' && normalizePlatform(account.platform) !== 'xianyu') {
    // ★ 闲鱼必须排除：xianyu 凭证层虽归一到 taobao，但其 Cookie 是 goofish 域，
    //   用 alimama 探测必然未登录 → 会误标 expanded。
    return probeTaobaoSession(account.cookie_str)
  }
  if (cred !== 'xhs') return { result: 'unknown' }

  const headers: Record<string, string> = {
    'Cookie': account.cookie_str,
    'User-Agent': desktopUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  }

  try {
    // httpRequest 不跟随重定向（首页 `/` 会 302 → /explore，直接取到的是 47 字节跳转页），
    // 这里手动跟随，最多 3 跳。
    let url = XHS_HOME_URL
    let res = await httpRequest('GET', url, headers, undefined, 20)
    for (let i = 0; i < XHS_MAX_REDIRECTS && res.status >= 300 && res.status < 400 && res.location; i++) {
      url = new URL(res.location, url).toString()
      res = await httpRequest('GET', url, headers, undefined, 20)
    }
    if (res.status >= 400) return { result: 'unknown', reason: `HTTP ${res.status}` }

    // 首页 HTML 里的 SSR 数据是「JSON 字符串再转义」形式：`\"user\":{\"loggedIn\":false...`。
    // 必须先反转义再匹配，否则正则在 `\"user\"` 上永远失配（曾误报「响应缺少 user 字段」）。
    // 只认紧邻 `"loggedIn"` 的 user 对象，避免匹配到其它同名配置项。
    const normalized = res.body.replace(/\\"/g, '"')
    const seg = normalized.match(/"user"\s*:\s*\{\s*"loggedIn"\s*:\s*(?:true|false)[\s\S]{0,600}/)
    if (!seg) return { result: 'unknown', reason: '响应缺少 user 字段' }

    const loggedIn = /"loggedIn"\s*:\s*true/.test(seg[0])
    const guest = /"guest"\s*:\s*true/.test(seg[0])
    const hasUserId = /"userId"\s*:\s*"[^"]{6,}"/.test(seg[0])

    if (loggedIn && !guest) return { result: 'valid' }
    if (guest || (!loggedIn && hasUserId)) {
      return { result: 'expired', reason: '远端判定为游客态，登录态已失效' }
    }
    return { result: 'unknown', reason: '远端未返回明确登录态' }
  } catch (e: any) {
    return { result: 'unknown', reason: e?.message || String(e) }
  }
}

/**
 * 淘宝系（taobao 凭证层，含生意参谋/万相台/达摩盘）远程登录态探测。
 *
 * 为什么用阿里妈妈 checkAccess 而不是淘宝域名：生意参谋系账号的凭证层已归并到 taobao，
 * 而 checkAccess 是阿里系通用的登录态判定点（实测未登录时返回
 * `{"data":{},"info":{"errorCode":5008004,"ok":false,"message":"未登录，请重新登录"}}`）。
 * 判定规则：
 *   - HTTP 200 且拿到 csrfId → 已登录（session 有效）
 *   - HTTP 200 且 info.ok=false 且 errorCode=5008004 → 明确未登录 → expired
 *   - 其余（网络异常 status=0 / 非 200 / 权限类错误码如 5008005）→ unknown，不误判
 */
async function probeTaobaoSession(cookieStr: string): Promise<{ result: SessionProbeResult; reason?: string }> {
  const { status, csrfId, ok, errorCode } = await fetchAlimamaAccess(cookieStr)
  if (status === 200 && csrfId) return { result: 'valid' }
  if (status === 200 && !ok && errorCode === 5008004) {
    return { result: 'expired', reason: '阿里 SSO 登录态已失效（未登录）' }
  }
  if (status === 0) return { result: 'unknown', reason: '探测请求失败（网络异常或超时）' }
  return { result: 'unknown', reason: `HTTP ${status} 且无明确登录态（errorCode=${errorCode ?? '无'}）` }
}

function httpRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutSec: number,
): Promise<{ status: number; body: string; setCookieHeaders: string[]; location?: string; responseHeaders?: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const lib = parsed.protocol === 'https:' ? nodeHttps : nodeHttp

    const options: nodeHttp.RequestOptions = {
      method,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      headers,
    }

    const req = lib.request(options, (res: any) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('error', (err: any) => {
        reject(new Error(`响应流错误: ${err.message}`))
      })
      res.on('end', () => {
        // 收集 Set-Cookie 头（可能是数组也可能是单个值）
        const setCookieHeaders: string[] = []
        const raw = res.headers['set-cookie']
        if (raw) {
          if (Array.isArray(raw)) setCookieHeaders.push(...raw)
          else setCookieHeaders.push(String(raw))
        }
        resolve({
          status: res.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf-8'),
          setCookieHeaders,
          location: res.headers['location'] ? String(res.headers['location']) : undefined,
          // ★ 返回全部响应头（小写键），供风控检测读取 bxpunish / bxuuid 等
          responseHeaders: res.headers as Record<string, string | string[] | undefined>,
        })
      })
    })

    req.on('error', reject)
    req.setTimeout(timeoutSec * 1000, () => {
      req.destroy()
      reject(new Error(`请求超时(${timeoutSec}s)`))
    })
    if (body) req.write(body)
    req.end()
  })
}
