/**
 * douyin-request.mjs —— 抖音（抖店）统一请求入口（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 设计原则（来自 2026-11-11 实测，见 _douyin_node_probe/REPORT.md）
 * ══════════════════════════════════════════════════════════════════
 *
 * ① **抖店只读接口不发签名**
 *    实测：带 a_bogus/verifyFp/fp/msToken → 10001010A「环境风险」
 *          剥掉全部 → st=0 正常返回。3 轮稳定。
 *    → 本模块默认 + 强制不带签名字段；调用方传了也会被剥离并记 warning。
 *
 * ② **cookie 只补缺失，绝不覆盖**
 *    凭证库的 sessionid 是占位值（= account_id 前 32 位）。
 *    旧代码 page.setCookie(全量) 会把它写进 Profile，覆盖真实会话。
 *    → 本模块合并顺序：账号 cookie 为主，Profile 只补**缺失的键**。
 *
 * ③ **失败要分级，不能都当"没数据"**
 *    st===0 但有 success===false / data===null → 可能失败
 *    10001010A → 环境风险（不要重试，越试越糟）
 *    40002 / 20000+ → 频控
 *    43001 / 未登录 → 会话失效
 *
 * ══════════════════════════════════════════════════════════════════
 * 用法
 * ══════════════════════════════════════════════════════════════════
 *   import { request } from '<...>/_shared/douyin-request.mjs'
 *
 *   const r = await request('goods.list', { pageSize: 50 }, {
 *     account,            // 凭证库账号对象（必填）
 *     shopKey: acc.shop_key,
 *   })
 *   // → { ok, st, data, errorKind, ms, channel:'node' }
 *
 *   // 临时调未验证接口（会打 warning）
 *   await request('shop.expScore', {}, { account, allowUnverified: true })
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const load = (f) => import(pathToFileURL(path.join(HERE, f)).href)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'

/** 已知的签名字段 —— 抖店一律不发，传了会被剥掉 */
const SIG_KEYS = ['a_bogus', 'verifyFp', 'fp', 'msToken', '__token', '_bid', '_lid', 'aid']

/** 已知的上下文头 —— 抖店只读不需要，带上反而可能被判环境异常 */
const SIG_HEADERS = ['anti-content', 'x-secsdk-csrf-token', 'x-bogus', 'x-tt-token']

let _registry = null
async function reg() {
  if (!_registry) _registry = await load('douyin-registry.mjs')
  return _registry
}

/* ══════════════════════════════════════════════════════════════════
 * cookie 合并（★ 只补缺失，绝不覆盖）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 合并 cookie。
 * @param {object} primary    凭证库账号的 cookies（权威）
 * @param {object} fallback   Profile 实时 cookie（只补 primary 没有的键）
 * @returns {object} 新对象，不修改入参
 */
export function mergeCookies(primary, fallback = {}) {
  const out = {}
  for (const [k, v] of Object.entries(primary || {})) {
    if (k === '' || v === '' || v == null) continue
    out[k] = v
  }
  let filled = 0
  for (const [k, v] of Object.entries(fallback || {})) {
    if (k === '' || v === '' || v == null) continue
    if (out[k] !== undefined) continue   // ★ 已有值一律不动
    out[k] = v
    filled++
  }
  return { cookies: out, filled, primaryCount: Object.keys(primary || {}).length }
}

export function cookieHeader(cookies) {
  return Object.entries(cookies || {})
    .filter(([k, v]) => k !== '' && v !== '' && v != null)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

/* ══════════════════════════════════════════════════════════════════
 * 错误分级
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 把平台返回码翻译成可执行的错误类别。
 * 不猜：只有实测见过的码才归类，其余归 'unknown' 并原样带回。
 *
 * ★★ 四个域的成功判据各不相同（实测 2026-11-11）：
 *   抖店 fxg       { st: 0, code: 0, msg: "" }
 *   千川 qianchuan { code: 0, msg: "success" }                    ← 没有 st
 *   千川报表       { status_code: 0, message: "success", data }    ← 只有 status_code，没有 code/st！
 *   营销 activity  { st: 0, msg: "success" }
 *   所以 st / code / status_code 三个必须全认，缺一个就会把成功判成失败。
 */
export function classify(payload, httpStatus) {
  const st = payload?.st
  const code = payload?.code ?? payload?.errno
  const statusCode = payload?.status_code
  const msg = String(payload?.msg || payload?.message || '')

  if (httpStatus === 401 || httpStatus === 403) return { kind: 'session', retry: false }

  // ★ 成功判据：任一为 0 即成功
  if (st === 0 || code === 0 || code === '0' || statusCode === 0 || payload?.success === true) {
    if (payload?.success === false) return { kind: 'fake_success', retry: false }
    return { kind: 'ok', retry: false }
  }

  // 抖店实测码
  if (code === '10001010A' || /当前环境存在风险/.test(msg)) {
    return { kind: 'risk_control', retry: false, hint: '环境风险：不要重试，检查是否误带了签名字段' }
  }
  if (/未登录|登录态|请先登录|session/i.test(msg)) return { kind: 'session', retry: false }
  if (/频繁|稍后重试|限流|too many/i.test(msg)) return { kind: 'rate_limit', retry: true }
  if (/参数|param|invalid/i.test(msg)) return { kind: 'bad_input', retry: false }

  // ★ 千川特有
  if (code === 40002 || statusCode === 40002) return { kind: 'bad_input', retry: false, hint: '路径权限校验失败：多为 body 缺业务参数（不是签名问题）' }
  if (code === 2 || code === '2' || statusCode === 2) return { kind: 'bad_input', retry: false, hint: '业务参数缺失或格式错（千川常见：POST body 空）' }
  if (code === -1 || statusCode === -1 || /请求未成功/.test(msg)) {
    return { kind: 'bad_input', retry: false, hint: 'body 字段不全（如 statQuery 缺 Filters.Conditions）' }
  }

  if (httpStatus >= 500) return { kind: 'server', retry: true }

  return { kind: 'unknown', retry: false, raw: { st, code, statusCode, msg, httpStatus } }
}

/* ══════════════════════════════════════════════════════════════════
 * 主请求
 * ══════════════════════════════════════════════════════════════════ */

/**
 * @param {string} name            注册表接口名，如 'goods.list'
 * @param {object} params          覆盖默认 query（传 null 值表示删除该参数）
 * @param {object} opts
 * @param {object} opts.account    凭证库账号对象（必填）
 * @param {object} opts.cookies    Profile 实时 cookie（仅补缺失）
 * @param {string} opts.body       POST body 字符串
 * @param {number} opts.timeoutMs  默认 20000
 * @param {boolean} opts.allowUnverified  允许调未验证接口
 * @param {boolean} opts.noRetry   禁重试
 * @returns {Promise<object>}
 */
export async function request(name, params = {}, opts = {}) {
  const R = await reg()
  const spec = R.resolve(name, { allowUnverified: opts.allowUnverified })
  const account = opts.account
  if (!account) throw new Error('request() 缺少 opts.account（凭证库账号对象）')

  const t0 = Date.now()

  /* ── 参数净化：剥离签名字段（★ 抖店带了反而挂）──────────── */
  const cleanParams = {}
  const strippedParams = []
  for (const [k, v] of Object.entries(params || {})) {
    if (SIG_KEYS.includes(k)) { strippedParams.push(k); continue }
    if (v === null) continue              // null = 删除该参数
    cleanParams[k] = v
  }
  if (strippedParams.length) {
    log(`⚠ ${name}: 已剥离签名字段 [${strippedParams.join(',')}] —— 抖店带签名会被判环境风险`)
  }

  const url = R.buildUrl(spec, cleanParams)

  /* ── cookie ──────────────────────────────────────────────── */
  const { cookies, filled } = mergeCookies(account.cookies, opts.cookies)

  /* ── headers ─────────────────────────────────────────────── */
  const headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'origin': spec.origin,
    'referer': spec.origin + (spec.referer || '/'),
    'user-agent': UA,
    'cookie': cookieHeader(cookies),
  }
  if (opts.body) headers['content-type'] = opts.contentType || 'application/json'
  // 调用方若硬塞了签名头，也剥掉
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      if (SIG_HEADERS.includes(k.toLowerCase())) continue
      headers[k] = v
    }
  }

  /* ── 发请求 ──────────────────────────────────────────────── */
  const timeoutMs = opts.timeoutMs ?? 20000
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)

  let httpStatus = 0
  let text = ''
  let fetchErr = null
  try {
    const r = await fetch(url, {
      method: spec.method,
      headers,
      // POST body 优先级：显式 opts.body > 注册表默认 body > query 参数序列化
      body: spec.method === 'POST'
        ? (opts.body || spec.body || JSON.stringify(cleanParams))
        : undefined,
      redirect: 'manual',
      signal: ctl.signal,
    })
    httpStatus = r.status
    text = await r.text()
  } catch (e) {
    fetchErr = e
  } finally {
    clearTimeout(timer)
  }

  const ms = Date.now() - t0

  if (fetchErr) {
    const aborted = fetchErr.name === 'AbortError'
    return {
      ok: false, name, url, ms, channel: 'node',
      errorKind: aborted ? 'timeout' : 'network',
      message: aborted ? `请求超时（${timeoutMs}ms）` : String(fetchErr.message || fetchErr).slice(0, 200),
      cookiesFilledFromProfile: filled,
    }
  }

  let payload = null
  try { payload = JSON.parse(text) } catch { /* 非 JSON */ }

  if (!payload) {
    return {
      ok: false, name, url, ms, channel: 'node', httpStatus,
      errorKind: 'not_json',
      message: `响应不是 JSON（${text.length}B）：${text.slice(0, 120)}`,
      cookiesFilledFromProfile: filled,
    }
  }

  const cls = classify(payload, httpStatus)
  const data = payload.data

  // ★ 假成功检测：st=0 但 success 明确 false → 不算成功
  const fakeSuccess = cls.kind === 'ok' && payload.success === false
  const finalKind = fakeSuccess ? 'fake_success' : cls.kind

  return {
    ok: finalKind === 'ok',
    name,
    url,
    ms,
    channel: 'node',
    httpStatus,
    st: payload.st,
    code: payload.code ?? payload.errno,
    msg: payload.msg || payload.message || '',
    errorKind: finalKind === 'ok' ? null : finalKind,
    hint: cls.hint || null,
    data,
    bytes: text.length,
    cookiesFilledFromProfile: filled,
    strippedParams,
    raw: finalKind === 'ok' ? undefined : payload,
  }
}

/* ══════════════════════════════════════════════════════════════════
 * 便捷封装
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 一次取多页（自动去重 + 节流）。抖店列表用 page/pageSize。
 * @param {string} name
 * @param {object} params
 * @param {object} opts { account, pages, pageSize, gapMs, ... }
 */
export async function paginate(name, params = {}, opts = {}) {
  const R = await reg()
  const spec = R.resolve(name, { allowUnverified: opts.allowUnverified })
  const pages = Math.min(opts.pages ?? 1, 50)
  const pageSize = opts.pageSize ?? 20
  const gapMs = opts.gapMs ?? 400
  const pageKey = opts.pageKey || (spec.query?.page !== undefined ? 'page' : 'pageNum')
  const sizeKey = opts.sizeKey || (spec.query?.pageSize !== undefined ? 'pageSize' : 'size')

  const all = []
  const rounds = []
  for (let i = 0; i < pages; i++) {
    const r = await request(name, { ...params, [pageKey]: i, [sizeKey]: pageSize }, opts)
    rounds.push({ page: i, ok: r.ok, ms: r.ms, kind: r.errorKind, bytes: r.bytes })
    if (!r.ok) break
    const list = Array.isArray(r.data) ? r.data
      : Array.isArray(r.data?.items) ? r.data.items
      : Array.isArray(r.data?.list) ? r.data.list
      : []
    all.push(...list)
    if (list.length < pageSize) break          // 最后一页
    if (i < pages - 1) await sleep(gapMs)
  }
  return { ok: rounds.every((x) => x.ok), items: all, total: all.length, rounds }
}

/** 从响应里安全取列表：绝不把「取不到」伪装成「0 条」 */
export function pickList(result, picker, label = '列表') {
  if (!result || !result.ok) {
    throw new Error(`${label}：接口未成功（${result?.errorKind || 'unknown'} ${result?.msg || ''}）`)
  }
  const d = result.data
  const arr = typeof picker === 'function' ? picker(d)
    : Array.isArray(d) ? d
    : Array.isArray(d?.[picker]) ? d[picker]
    : null
  if (!Array.isArray(arr)) {
    throw new Error(`${label}：响应里没有列表字段（payload keys: ${Object.keys(d || {}).slice(0, 10).join(',')}）`)
  }
  return arr
}

/* ══════════════════════════════════════════════════════════════════
 * 账号加载
 * ══════════════════════════════════════════════════════════════════ */

const PLUGIN_ROOT = process.env.DSAGENT_PLUGIN_ROOT || path.resolve(HERE, '..', '..')

/** 从凭证库取账号（多账号必须显式指定，绝不静默取第一个） */
export async function loadAccount(platform, shopKey = '') {
  const { CredentialStore } = await import(
    pathToFileURL(path.join(PLUGIN_ROOT, 'lib', 'services', 'credential-store.js')).href
  )
  const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
  const accounts = (store.listAccounts() || []).filter(
    (a) => a.platform === platform && a.status !== 'invalid',
  )
  if (!accounts.length) {
    return { ok: false, errorKind: 'not_bound', accounts: [], message: `未找到 ${platform} 账号` }
  }
  if (shopKey) {
    const hit = accounts.find((a) => a.shop_key === shopKey)
    if (!hit) {
      return {
        ok: false, errorKind: 'bad_account', accounts,
        message: `shopKey 不存在：${shopKey}。可用：${accounts.map((a) => a.shop_key).join(' / ')}`,
      }
    }
    return { ok: true, account: hit, accounts }
  }
  if (accounts.length > 1) {
    return {
      ok: false, errorKind: 'need_account_choice', accounts,
      message: `有 ${accounts.length} 个账号，请指定 --account：\n` +
        accounts.map((a, i) => `${i + 1}. ${a.nickname || '(未命名)'}（${a.shop_key}）`).join('\n'),
    }
  }
  return { ok: true, account: accounts[0], accounts }
}

/** 从浏览器 Profile 读实时 cookie（CDP Storage.getCookies），仅用于补缺失 */
export async function readProfileCookies(cdp, domainRe = /(^|\.)(jinritemai|douyin)\.com$/) {
  const { cookies: all } = await cdp.send('Storage.getCookies')
  const out = {}
  for (const c of all) {
    if (!domainRe.test(c.domain)) continue
    if (out[c.name] && !/jinritemai/.test(c.domain)) continue  // 同域优先
    out[c.name] = c.value
  }
  return out
}

/* ══════════════════════════════════════════════════════════════════
 * 工具
 * ══════════════════════════════════════════════════════════════════ */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const log = (msg) => console.error('[douyin-request] ' + msg)

/** 进程退出兜底（防止 undici keep-alive 挂住进程） */
export function shutdown() {
  try {
    // Node 18+ 没有公开 API 关全局 dispatcher，用短超时 + 显式 exit 兜底
    setTimeout(() => process.exit(0), 50).unref?.()
  } catch { /* ignore */ }
}

export default { request, paginate, pickList, loadAccount, mergeCookies, cookieHeader, classify, readProfileCookies }
