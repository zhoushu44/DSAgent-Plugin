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
 *   - ★ 2026-11-18：推广域 token 失效（54001/43001/40001）时**自动换 token** ——
 *     阶梯（重签→换签名器→提新票→全换→滑块）+ 单飞 + 冷却 + 时间预算，
 *     详见 pdd-token-refresh.mjs；诊断信息随返回值的 tokenRefresh 字段透出
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
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ★ 2026-11-18：基座「自动换 token」模块（纯策略 + 内存状态，无副作用）。
//   静态引入而不是 lazy load：这样每次加载本模块都会顺带解析它，
//   任何 pdd 技能跑一次就能发现它的语法错误，不会等到真出 54001 才暴露。
import { refreshToken as refreshPddToken } from './pdd-token-refresh.mjs'

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
    // ★★ 2026-11-10 实测纠正：**live 域要的是 `anti-content` 头，不是 VerifyAuthToken**
    //
    //   之前这里写的是 signPos:'none' + 从 cookie 取 `msfe-pc-cookie-captcha-token`
    //   当 VerifyAuthToken 用 —— 全错。抓真实页面请求（12 秒，5 个接口）得到：
    //     POST /api/backbone/anchor/query            anti-content ✅  VerifyAuthToken —
    //     POST /api/backbone/video/publish_qualification  anti-content ✅  VerifyAuthToken —
    //     POST /api/orpheus-obs/topic/list           anti-content ✅  VerifyAuthToken —
     //     POST /calpis/mms/user/verify_login         anti-content ✅  VerifyAuthToken —
     //     POST /mms/amco/prePublish/query            anti-content ✅  VerifyAuthToken —
    //   而且 live 域的 25 个 cookie 里**根本没有** msfe-pc-cookie-captcha-token。
    //   → live 与 mms 同一套签名体系（header 里的 anti-content），走同一个签名器。
    signPos: 'header',
    // ★ 2026-11-10：纯 Node **已打通**（实测 4 个读接口全通，见 PDD-KNOWLEDGE.md）。
    //   条件：签名走 pdd-vodka-signer（anti-content）+ Cookie 必须用 live 域专属票据
    //   （L_PASS_ID 那套，从常驻签名服务取；不能用 mms 的 PASS_ID）。
    nodeSupport: true,
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

  // ★ 2026-11-09：**基座级 body 默认值**
  //   拼多多的接口 body 字段名是它自己定的（scenesMode / clientType / blockType …），
  //   缺一个就报「参数为空 / http 500」，而这些名字只能从真实页面请求里抄。
  //   → 默认值表放在基座，**每个 skill 调 request() 都自动带上**，不用逐个 skill 改。
  //   显式传入的字段优先；opt-out 用 opts.noBodyDefaults。
  let finalBody = body
  if (!opts.noBodyDefaults) {
    const defs = await bodyDefaults(pathname)
    if (defs) {
      const merged = { ...defs, ...(body || {}) }
      // 含 {{mallId}} 时基座自动解析店铺 id（缓存，不用每次都问）
      let ctx = opts.ctx
      if (JSON.stringify(merged).includes('{{mallId}}') && !(ctx && ctx.mallId)) {
        ctx = { ...(ctx || {}), mallId: await resolveMallId(opts.shopKey) }
      }
      finalBody = substitute(merged, ctx)
    }
  }

  // ① 节流
  if (opts.guard?.beforeCall) {
    const pre = await opts.guard.beforeCall(url)
    if (!pre.allow) {
      return { ok: false, ec: 'blocked', failureKind: 'rate_limit', data: null, raw: null,
        status: 0, channel: 'none', hint: pre.reason }
    }
  }

  const hasPage = !!opts.page
  // ★ 推广域的 Cookie 由混合签名器（浏览器）现场提供，凭证库里本来就没有，
  //   所以只要有 shopKey 就算「有账号」，否则会被误判成只能走浏览器。
  const hasAccount = !!opts.account?.cookies || (domain === 'yingxiao' && !!opts.shopKey)
  const wantBrowser = opts.forceBrowser || !hasAccount || cfg.nodeSupport === false
  // ★ 2026-11-09：**写操作禁止自动降级重发**
  //   读接口「Node 被拒 → 浏览器重试」是安全的；写接口重发可能**重复执行**
  //   （超时/网关错误时无法确定服务端是否已落库）。要重试由调用方显式决定。
  const noFallback = !!opts.noBrowserFallback

  let channel = 'browser'
  let nodeReason = ''
  let res = null
  // ★ 2026-11-18：基座「自动换 token」的诊断信息（阶梯走了哪几级 / 为什么没成功）
  let tokenRefreshInfo = null

  // ② 纯 Node 尝试
  if (!wantBrowser && hasAccount) {
    try {
      let signed = await signFor(domain, opts)
      if (signed.sig || cfg.signPos === 'none') {
        res = await fetchNode(url, method, finalBody, cfg, signed.sig, { ...opts, signCookies: signed.cookies, signUa: signed.ua })
        let okNow = isSuccess(res.json, domain)
        let ec = errCode(res.json)
        const risk = ec === 54001 || ec === 54003

        // ★ 2026-11-18：**基座级「自动换 token」**（新链路，见 pdd-token-refresh.mjs）
        //
        //   旧逻辑（2026-11-09）只做了一件事：54001/54003 时切签名器（jsdom↔hybrid）。三个缺口：
        //     ① 不覆盖 54001 的「清旧 token → 提新票 → 重放」自愈语义
        //     ② 没有**单飞锁** → 同账号并发失败时各开一次浏览器抢 Profile 锁，反而更容易超时
        //     ③ 没有**冷却** → 刷新失败后下次立刻再试，累计行为分数上升、越打越久
        //
        //   新逻辑把「换 token」收敛成一条阶梯，由基座统一做**单飞 + 冷却 + 时间预算**，
        //   每一级都用**真实请求**验证（不靠「签名生成成功」当成功）：
        //     L1 重签 → L2 换签名器 → L3 提新票 → L4 全换 → L5 滑块闭环
        //
        //   ★ 只对**读**操作生效（写操作 noBrowserFallback 时整条阶梯跳过，避免重复执行）。
        //   ★ 54003 **不再自动重试** —— 它是 security_blocked（重扫无效，只能等），
        //     pdd-guard 明确要求 retryable=false；旧代码在这里重试是与闸门相矛盾的。
        const forcedSigner = !!(opts.promoSigner || process.env.PDD_PROMO_SIGNER)
        const TOKEN_EC = new Set([54001, 43001, 40001])
        const tokenEc = errCode(res.json)
        if (!okNow && domain === 'yingxiao' && TOKEN_EC.has(tokenEc) && !opts.__tokenRetried && !noFallback && opts.shopKey) {
          let ft = null
          try {
            ft = await refreshPddToken(opts.shopKey, {
              ec: tokenEc,
              deadlineMs: opts.tokenBudgetMs ?? 35_000,
              currentMode: signed.mode || 'jsdom',
              modes: forcedSigner ? [signed.mode || 'jsdom'] : ['jsdom', 'hybrid'],
              page: opts.page,
              force: !!opts.tokenForceRefresh,
              capabilities: {
                // 用指定签名器重新签名；persist=true 时记住该账号用哪个签名器
                sign: async (mode, o) => {
                  const s = await signFor(domain, { ...opts, promoSigner: mode, __forceFresh: !!o?.force })
                  if (s?.sig && o?.persist) {
                    _signerChoice.set(opts.shopKey || opts.account?.shopKey, mode)
                    persistSignerChoice()
                  }
                  return s
                },
                // 提新票：从 Profile / 常驻签名服务取活的 Cookie 并写回凭证库
                renewCookies: async () => {
                  const h = await healCookies(opts.shopKey)
                  if (!h?.cookies) return null
                  invalidateStoreCookieCache(opts.shopKey)
                  if (opts.account && typeof opts.account === 'object') {
                    opts.account.cookies = h.cookies
                    if (h.ua) opts.account.userAgent = h.ua
                  }
                  return { cookies: h.cookies, ua: h.ua }
                },
                // 重置签名环境（jsdom 的 _ctx 是模块级单例）
                resetEnv: async () => {
                  const ps2 = await load('pdd-promo-signer-v2.mjs').catch(() => null)
                  ps2?.resetPromoV2?.()
                },
                // 滑块闭环（只在 54001 且有 page 时才会被阶梯调用）
                solveCaptcha: async () => {
                  if (!opts.page) return null
                  const cg = await load('pdd-captcha-gate.mjs').catch(() => null)
                  return cg?.solve?.(opts.page, opts.shopKey) ?? null
                },
              },
              // 用这枚新 token 实打一次 —— 只有真通了才算这一级成功
              probe: async (token) => {
                if (opts.guard?.beforeCall) {
                  const pre = await opts.guard.beforeCall(url)
                  if (!pre.allow) {
                    return { ok: false, ec: 'blocked', blocked: true, hint: pre.reason || '闸门拦截（账号冷却/限流）' }
                  }
                }
                const r2 = await fetchNode(url, method, finalBody, cfg, token.sig, { ...opts, signCookies: token.cookies, signUa: token.ua })
                const ok2 = isSuccess(r2.json, domain)
                return { ok: ok2, ec: errCode(r2.json), status: r2.status, res: r2 }
              },
            })
          } catch (e2) {
            ft = { ok: false, skipped: 'exception', hint: '换 token 内部异常：' + String(e2?.message || e2).slice(0, 100) }
          }
          tokenRefreshInfo = ft
          const trail = (ft?.steps || []).map((s) => s.name).join('→')
          if (ft?.ok && ft?.probe?.ok) {
            res = ft.probe.res
            okNow = true
            nodeReason = `已自动换 token（${trail}）后重放成功`
          } else if (ft?.ok) {
            nodeReason = `已自动换 token（${trail}）但重放仍被拒`
          } else {
            nodeReason = `自动换 token 未成功：${ft?.hint || ft?.skipped || 'unknown'}`
          }
        } else if (!okNow && risk && domain === 'yingxiao' && ec === 54003) {
          // ★ 54003：与 pdd-guard 对齐 —— 不自动重试，等风控自然解除
          nodeReason = `54003 安全验证未通过（重扫无效，只能等），按闸门规则不自动重试`
        }

        if (okNow) {
          channel = 'node'
        } else if (risk && hasPage && !noFallback) {
          nodeReason = nodeReason || `Node 被拒（ec=${ec}），降级浏览器`
          res = null      // 走浏览器
        } else {
          channel = 'node'   // 失败但不降级（无 page / 非风控错误 / 写操作显式禁止）
          if (noFallback && risk && hasPage) nodeReason = nodeReason || `写操作禁止自动降级重发（ec=${ec}）`
        }
      } else {
        nodeReason = '签名生成失败'
      }
    } catch (e) {
      nodeReason = `Node 异常：${String(e.message).slice(0, 60)}`
    }
  }

  // ③ 浏览器兜底（写操作在 noBrowserFallback 下跳过；除非调用方显式 forceBrowser）
  if (!res && hasPage && (!noFallback || opts.forceBrowser)) {
    channel = 'browser'
    res = await fetchBrowser(opts.page, url, method, finalBody, cfg, domain, opts)
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
    // ★ 2026-11-09 修：HTTP 429/430 是**网关级限流**（edge 层），不是权限也不是风控
    //   典型表现：HTTP 429 + body {"error_code":40001,"error_msg":""}（文案为空）
    //   实测推广域连打 11 个接口后即进入此状态，此前被误判为「账号无权限」
    const http = res.status
    if (http === 429 || http === 430) failureKind = 'rate_limit'
    else if (ec === 54001 || ec === 54003) failureKind = 'risk_control'
    else if (ec === 40001 || ec === 43001) failureKind = 'auth'
    else if (ec === 40002 || ec === 100001) failureKind = 'rate_limit'
    else failureKind = 'api_error'
  }

  // ★ 2026-11-09：**Cookie 自愈 + 重试一次**
  //
  //   背景：凭证库里的 mms Cookie 会过期（43001 会话失效），但同一个 Profile 里的
  //   浏览器会话还是活的（推广域混合签名器用的就是这个 Profile，实测同一时刻
  //   凭证库 43001、Profile 里打开推广页正常）。
  //   → 从 CDP 取实时 Cookie 覆盖回凭证库，再重放一次。修好后**落盘**，后续跑都快。
  //
  //   只在「会话失效」这一种情况下触发，绝不用于限流/风控（那两种越试越糟）。
  //   ★ 2026-11-09：40001 也纳入自愈 —— 推广域纯 Node 通道拿到的 Cookie 可能是
  //     登录时的旧票（HttpOnly 的 PASS_ID/SUB_PASS_ID 过期），服务端先判鉴权失败。
  //     自愈 = 从 Profile 取实时 Cookie 写回凭证库 → 后续纯 Node 请求直接可用。
  const needHeal = !ok && (
    ec === 43001 ||
    (ec === 40001 && domain === 'yingxiao' && opts.shopKey)
  )
  if (needHeal && opts.shopKey && !opts.__healed) {
    const healed = await healCookies(opts.shopKey)
    if (healed?.cookies) {
      invalidateStoreCookieCache(opts.shopKey)
      // ★ 同步写回调用方的 account 对象 —— 否则同一进程里下一次请求还拿着旧 Cookie，
      //   又去开一次浏览器自愈（每次 ~10s）。写回后同进程后续请求直接用新 Cookie。
      if (opts.account && typeof opts.account === 'object') {
        opts.account.cookies = healed.cookies
        if (healed.ua) opts.account.userAgent = healed.ua
      }
      const acc2 = { ...(opts.account || {}), cookies: healed.cookies, userAgent: healed.ua || opts.account?.userAgent }
      // ★ 2026-11-18：自愈重放不再走「自动换 token」阶梯（上面已跑过一遍），
      //   避免同一次失败里阶梯被重复触发。
      return request(pathname, body, { ...opts, account: acc2, __healed: true, __tokenRetried: true })
    }
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
    // ★ 2026-11-09：把 HTTP 状态码一并给闸门 —— 否则「429 + 40001 + 空文案」这种
    //   **网关限流**会被闸门当成会话失效（needRelogin），把好账号误判成掉登录。
    try { await opts.guard.afterCall(url, res.json, res.status) } catch { /* ignore */ }
  }

  const out = {
    ok,
    ec,
    channel,
    nodeFallback: nodeReason,
    // ★ 2026-11-18：基座「自动换 token」的诊断信息（阶梯/冷却/原因），
    //   读接口失败时 skill 可直接把它透给用户看，不用再猜。
    tokenRefresh: tokenRefreshInfo,
    status: res.status,
    failureKind,
    data: ok ? unwrap(res.json) : null,
    raw: res.json,
    hint: ok ? '' : String(res.json?.error_msg ?? res.json?.errorMsg ?? res.err ?? '').slice(0, 200),
  }

  // ★ live 域 40001（空文案）= 没拿到 VerifyAuthToken
  //   票在 Profile 浏览器的 cookie msfe-pc-cookie-captcha-token 里，
  //   没有它说明**该 Profile 没登录过 live.pinduoduo.com**（不是代码问题）。
  if (!ok && domain === 'live' && (ec === 40001 || ec === 43001)) {
    out.hint = 'live 域鉴权失败（40001/43001）。'
      + 'live 域用的是**它自己的登录票据** `L_PASS_ID` / `HEARTBEAT_PASS_ID`（不是 mms 的 PASS_ID，'
      + '也不是 VerifyAuthToken）。'
      + '常见原因：① 该账号从没登录过 live.pinduoduo.com（多多视频创作者后台）→ 去登录一次；'
      + '② 常驻签名服务里没有这个账号的浏览器 → 运行 '
      + '`node skills/_shared/pdd-signer-daemon.mjs start` 后先预热该账号；'
      + '③ 凭证库里没有 L_PASS_ID 且守护进程不可用。'
    out.failureKind = out.failureKind === 'auth' ? 'token_expired' : out.failureKind
  }
  // ★ 2026-11-10：请求结束就释放底层句柄（undici 连接池 + jsdom 沙箱），
  //   否则纯 Node 通道的 skill 会「结果打完了但进程不退出」。
  await releaseDispatcherIfIdle().catch(() => { })
  return out
}

/**
 * 读凭证库里该账号的 Cookie（推广域的 PASS_ID / SUB_PASS_ID 等 HttpOnly Cookie
 * 只在凭证库里有 —— document.cookie 读不到，因为 JS 看不见 HttpOnly）。
 *
 * ★ 这些 Cookie 是混合签名器的「Cookie 自愈」写进去的（healCookiesFromProfile），
 *   所以纯 Node 通道可以直接复用，不用再开浏览器。
 */
const _storeCookieCache = new Map()
async function readStoreCookies(shopKey) {
  if (!shopKey) return {}
  if (_storeCookieCache.has(shopKey)) return _storeCookieCache.get(shopKey)
  let out = {}
  try {
    const { CredentialStore } = await import(pathToFileURL(path.join(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
      'lib', 'services', 'credential-store.js')).href)
    const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
    const acc = await store.get(shopKey)
    out = acc?.cookies || {}
  } catch { /* ignore */ }
  _storeCookieCache.set(shopKey, out)
  return out
}

/**
 * 强制下次重新读凭证库 Cookie（Cookie 自愈后调用）。
 *
 * ★ 2026-11-10：**必须同时清 live 域票据缓存**。
 *   用户重新扫码登录后，PASS_ID / L_PASS_ID 全换新；
 *   但 live 域票据是单独缓存 10 分钟的（_liveCookieCache），
 *   不一起清就会拿旧票去打 → 报「需要重新登录」，
 *   看起来像「重登没生效」，实际是缓存没刷。
 */
export function invalidateStoreCookieCache(shopKey) {
  if (shopKey) {
    _storeCookieCache.delete(shopKey)
    _liveCookieCache.delete(shopKey)
  } else {
    _storeCookieCache.clear()
    _liveCookieCache.clear()
  }
}

/**
 * 把 Cookie 字符串解析成 map（供 fetchNode 拼 Cookie 头）
 * 容忍：分号/逗号分隔、空值、带 = 的值
 */
function parseCookieString(str) {
  const out = {}
  for (const part of String(str || '').split(/;\s*/)) {
    if (!part) continue
    const i = part.indexOf('=')
    if (i <= 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k) out[k] = v
  }
  return out
}

/**
 * 每个账号「哪个签名器能用」的记忆。
 * 纯 Node（jsdom）是默认路径；一旦实测某个签名器被服务端接受，就记住它，
 * 后续请求直接用 —— 不用每次都先失败一次再兜底。
 *
 * ★ 持久化到磁盘：否则每个 skill 进程都要重新探一次 jsdom（白扔一个请求 + 一次 54001 风控计数）。
 */
const _signerChoice = new Map()
/** live 域票据缓存（shopKey → {at, jar}），见 signFor('live') 的注释 */
const _liveCookieCache = new Map()
const _SIGNER_STATE_FILE = path.join(os.homedir(), '.dsh', 'pdd-signer-choice.json')

function loadSignerChoice() {
  try {
    const j = JSON.parse(fs.readFileSync(_SIGNER_STATE_FILE, 'utf8')) || {}
    for (const [k, v] of Object.entries(j)) if (v === 'jsdom' || v === 'hybrid') _signerChoice.set(k, v)
  } catch { /* ignore */ }
}
function persistSignerChoice() {
  try {
    fs.mkdirSync(path.dirname(_SIGNER_STATE_FILE), { recursive: true })
    fs.writeFileSync(_SIGNER_STATE_FILE, JSON.stringify(Object.fromEntries(_signerChoice), null, 1), 'utf8')
  } catch { /* ignore */ }
}
loadSignerChoice()

/** 读账号当前该用哪个签名器 */
export function getSignerChoice(shopKey) {
  return _signerChoice.get(shopKey) || null
}

/** 强制指定账号用哪个签名器（'jsdom' | 'hybrid' | null=自动） */
export function setSignerChoice(shopKey, mode) {
  if (mode) _signerChoice.set(shopKey, mode)
  else _signerChoice.delete(shopKey)
  persistSignerChoice()
}

/**
 * 按域生成签名。
 * 返回 {sig, cookies, ua}：
 *   sig     —— 签名串（推广域同时用作 body.crawlerInfo 和 header.anti-content）
 *   cookies —— 该域真正该用的 Cookie（推广域与 mms 是两套，凭证库里只有 mms 的）
 *   ua      —— 与签名环境一致的 UA
 */
async function signFor(domain, opts) {
  // ★ 2026-11-09：默认**纯 Node**（jsdom 签名），浏览器只当兜底。
  //   纯 Node 能不能用，取决于两件之前一直缺的事：
  //     ① **回放环境画像** —— seed.promoEnv 里存着真实设备的
  //        cookie / window.name / canvas / webgl renderer / plugins / 几何。
  //        设备指纹是签名的**输入**，不回放 = 签名内容对不上 = 服务端判无效。
  //        （之前只取了 seed.localStorage，把 promoEnv 整个丢了）
  //     ② **带上推广域 Cookie** —— 之前 jsdom 分支返回 cookies:null，
  //        请求裸奔 → 服务端 40001（认不出会话）。
  //   两者齐了才是真·纯 Node（一次都不用开浏览器）。
  if (domain === 'yingxiao') {
    const shopKey = opts.shopKey || opts.account?.shopKey
    // ★ 默认**纯 Node**（jsdom）；失败会自动换混合签名器并记住结果。
    //   显式指定（opts.promoSigner / 环境变量）则不再自动切换。
    const forced = opts.promoSigner || process.env.PDD_PROMO_SIGNER || null
    const mode = forced || _signerChoice.get(shopKey) || 'jsdom'
    if (mode === 'hybrid') {
      // ★ 常驻签名服务优先：Chrome 由守护进程长期持有，skill 进程完全不碰浏览器
      //   （也不占 Profile 锁 → 不会再和 skill 自己的 puppeteer 打架）。
      //   ★ 2026-11-18：__forceFresh 时跳过守护进程 —— 守护进程的 /sign 可能缓存旧签名，
      //     「换 token」必须拿到**新**签名，所以强制走进程内 signHybrid（每次现生成）。
      const dm = await load('pdd-signer-daemon.mjs').catch(() => null)
      if (dm && !opts.noDaemon && !opts.__forceFresh) {
        let r = await dm.daemonSign(shopKey).catch(() => null)
        if (!r?.sig) {
          // 守护进程没起 → 拉起它（幂等），顺便预热该账号的浏览器
          const started = await dm.ensureDaemon().catch(() => null)
          if (started?.ok) {
            await dm.daemonWarm?.(shopKey).catch(() => null)
            r = await dm.daemonSign(shopKey).catch(() => null)
          }
        }
        if (r?.sig) return { sig: r.sig, cookies: r.cookies || {}, ua: r.ua || null, mode: 'hybrid', channel: 'daemon' }
      }
      const hb = await load('pdd-promo-signer-hybrid.mjs')
      const sig = await hb.signHybrid(shopKey)
      const cookies = await hb.getHybridCookies(shopKey)
      let ua = null
      try {
        const s = await hb.initHybridSigner(shopKey)
        ua = await s.page.evaluate(() => navigator.userAgent)
      } catch { /* ignore */ }
      return { sig, cookies, ua, mode, channel: 'inproc' }
    }
    // ── 纯 Node（jsdom）──
    const seedStore = await load('pdd-seed-store.mjs')
    const full = seedStore.readSeed(shopKey || '') || {}
    const seed = opts.account?.localStorage || full.localStorage || {}
    const envProfile = opts.envProfile || full.promoEnv || null
    const ps2 = await load('pdd-promo-signer-v2.mjs')
    // ★ 2026-11-18：基座「自动换 token」要求**强制换新签名**时无条件重置单例。
    //   initPromoV2 的 _ctx 是模块级单例 —— 不 reset 的话里面还是**旧环境画像**，
    //   签出来还是同一份，「换了 token 等于没换」。
    if (opts.__forceFresh && typeof ps2.resetPromoV2 === 'function') ps2.resetPromoV2()
    // ★ 画像变了要重置缓存：initPromoV2 的 _ctx 是模块级单例，
    //   第一次初始化时没画像，后面再传也补不进去
    if (envProfile && typeof ps2.resetPromoV2 === 'function') {
      const cur = ps2.getAppliedProfileVersion?.()
      if (cur !== (envProfile.version || null)) ps2.resetPromoV2()
    }
    await ps2.initPromoV2({ localStorage: seed, envProfile })
    const sig = await ps2.signPromoV2()
    // ★ Cookie 三处合并（优先级从低到高）：
    //   ① 环境画像的 document.cookie —— 只有非 HttpOnly 的（api_uid/_nano_fp）
    //   ② 凭证库 —— **HttpOnly 的 PASS_ID / SUB_PASS_ID / SUB_SYSTEM_ID 只在这**
    //      （混合签名器的 Cookie 自愈写进去的，纯 Node 直接复用，不用开浏览器）
    //   ③ 调用方显式传的 account.cookies —— 最高优先级
    const storeCk = await readStoreCookies(shopKey)
    const cookies = {
      ...parseCookieString(envProfile?.doc?.cookie || ''),
      ...storeCk,
      ...(opts.account?.cookies && Object.keys(opts.account.cookies).length ? opts.account.cookies : {}),
    }
    const ua = envProfile?.nav?.userAgent || null
    return { sig, cookies, ua, mode }
  }
  if (domain === 'mms' || domain === 'live') {
    // ★ mms 与 live 同一套**签名**体系（header 的 anti-content，JVM2 虚拟机）。
    //   2026-11-10 抓包证实 live 域接口只带 anti-content、不带 VerifyAuthToken。
    //
    // ★★ 但**登录票据是分开的**（实测同一账号）：
    //     mms.pinduoduo.com  → PASS_ID
    //     live.pinduoduo.com → L_PASS_ID + HEARTBEAT_PASS_ID + L_PASS_TYPE
    //   拿 mms 的 PASS_ID 去打 live 域 → HTTP 403 + {error_code:40001,error_msg:""}，
    //   看起来像「未登录」，其实是**票据不对域**。
    //
    //   → live 域优先用 live 域专属票据（L_PASS_ID）；没有才退回 PASS_ID。
    let cookies = opts.account?.cookies || {}
    if (domain === 'live') {
      // ① 先问守护进程要 live 域的专属票据（L_PASS_ID 那套）
      //    ★ 票据缓存 10 分钟：每次现取要走一次 CDP Storage.getCookies，
      //      实测要 12~15 秒（守护进程要先确保浏览器在跑）—— 缓存后 ~100ms。
      const ck = opts.shopKey || ''
      const cached = _liveCookieCache.get(ck)
      let liveCk = (cached && Date.now() - cached.at < 10 * 60 * 1000) ? cached.jar : null
      if (!liveCk) {
        try {
          const dm = await load('pdd-signer-daemon.mjs').catch(() => null)
          if (dm) {
            let d = await dm.daemonDomainCookies(ck, ['live.pinduoduo.com']).catch(() => null)
            // 守护进程里没这个账号的浏览器 → 先预热再取（否则永远拿不到 live 票据）
            if (!d?.['live.pinduoduo.com']?.L_PASS_ID) {
              const w = await dm.daemonWarm?.(ck).catch(() => null)
              if (w?.ok) d = await dm.daemonDomainCookies(ck, ['live.pinduoduo.com']).catch(() => null)
            }
            if (d?.['live.pinduoduo.com']) liveCk = d['live.pinduoduo.com']
          }
        } catch { /* 落回凭证库 */ }
        if (liveCk?.L_PASS_ID) _liveCookieCache.set(ck, { at: Date.now(), jar: liveCk })
      }
      // ② 守护进程要不到 → 用凭证库（可能没有 L_PASS_ID）
      if (!liveCk || !liveCk.L_PASS_ID) {
        const storeCk = await readStoreCookies(ck)
        liveCk = { ...storeCk, ...cookies }
      }
      if (liveCk.L_PASS_ID) {
        // live 域认 L_ 那套；把 mms 的 PASS_ID 去掉，免得服务端拿错票
        delete liveCk.PASS_ID
        cookies = liveCk
      }
    }
    const vs = await load('pdd-vodka-signer.mjs')
    const seedStore = await load('pdd-seed-store.mjs')
    const seed = opts.account?.localStorage || seedStore.readSeed(opts.shopKey || '')?.localStorage || {}
    const sig = await vs.sign({ cookies, localStorage: seed })
    return { sig, cookies, ua: null }
  }
  return { sig: '', cookies: null, ua: null }   // 无签名域
}

/**
 * 高层调用：按接口**逻辑名**调，自动合并推广域默认 body。
 * skill 侧只认接口名，不关心路径/域名/签名位置 —— 这就是「新 skill 自动接入基座」的落点。
 *
 * @param {string} name   API 注册表里的 key（如 'promo.accountAll'）
 * @param {object} body   业务参数（会覆盖默认 body）
 * @param {object} opts   { page, account, shopKey, guard, forceBrowser, ... }
 */
export async function callApi(name, body = {}, opts = {}) {
  const reg = await load('pdd-api.mjs')
  const meta = reg.API?.[name]
  if (!meta) throw new Error(`接口注册表缺少: ${name}`)
  let finalBody = body || {}
  // 推广域：合并真实请求体默认值（scenesMode / clientType 等拼多多自有字段名）
  //   默认表用「去掉 /mms-gateway/ 前缀」的短路径作键，注册表用全路径 → 两个都试
  //
  // ★ 2026-11-10 修：还要**去掉前导 `/`** 再试一次。
  //   注册表 path 是 `/api/backbone/video/query`，默认表键是 `backbone/video/query`，
  //   只剥 /mms-gateway/ 永远对不上 → 默认值静默失效 → 接口报 40002「系统异常」。
  const shortKey = meta.path.replace(/^\/mms-gateway\//, '')
  const bareKey = meta.path.replace(/^\//, '')
  const defaults = reg.PROMO_BODY_DEFAULTS?.[shortKey]
    || reg.PROMO_BODY_DEFAULTS?.[bareKey]
    || reg.PROMO_BODY_DEFAULTS?.[meta.path]
  if (defaults) finalBody = { ...defaults, ...finalBody }
  // ★ 占位符替换：默认 body 里有 {{mallId}} / {{today}} 这类动态值
  //   （mall_id 是**店铺级**的，不同账号不同，不能写死在默认表里）
  finalBody = substitute(finalBody, opts.ctx)

  const method = (opts.method || meta.method || 'POST').toUpperCase()
  let path = meta.path

  // ★ 2026-11-10：**GET 接口的查询参数**
  //   注册表里写 `query: ['catId']`，调用方 callApi('mms.mallTemplate', { catId })
  //   → 基座自动拼成 `/draco-ms/mms/template/mall?catId=8463`。
  //   这样 skill 不用自己拼 URL，也不用自己做 URL 编码。
  if (method === 'GET') {
    const qs = new URLSearchParams()
    // ① 路径占位符 {catId}
    path = path.replace(/\{(\w+)\}/g, (m, k) => {
      const v = finalBody?.[k]
      if (v === undefined) return m
      delete finalBody[k]
      return encodeURIComponent(String(v))
    })
    // ② 注册表声明的 query 键
    const keys = Array.isArray(meta.query) && meta.query.length
      ? meta.query
      : Object.keys(finalBody || {})
    for (const k of keys) {
      const v = finalBody?.[k]
      if (v === undefined || v === null) continue
      qs.append(k, String(v))
      delete finalBody[k]
    }
    const q = qs.toString()
    if (q) path += (path.includes('?') ? '&' : '?') + q
  }

  const r = await request(path, finalBody, { ...opts, method })
  return { ...r, name, meta, path }
}

/** 纯 Node 发请求 */
async function fetchNode(url, method, body, cfg, sig, opts) {
  // ★ 推广域必须用**推广域自己的 Cookie**（_nano_fp / SUB_SYSTEM_ID / SUB_PASS_ID），
  //   凭证库里只有 mms 域的，用错会被判参数异常
  const cookieMap = opts.signCookies || opts.account.cookies || {}
  const cookieStr = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ')
  const headers = {
    'content-type': 'application/json',
    origin: cfg.origin,
    referer: opts.referer || cfg.referer,
    'user-agent': opts.signUa || opts.account.userAgent || UA,
    cookie: cookieStr,
    accept: 'application/json, text/plain, */*',
    ...(opts.extraHeaders || {}),
  }
  if (cfg.signPos === 'header' && sig) headers['anti-content'] = sig

  // ★ 2026-11-10：live 域**不要** VerifyAuthToken。
  //   实测它和 mms 同一套：凭证是 header 里的 anti-content（上面 552 行已注入）。
  //   之前这里塞 VerifyAuthToken 是错的，反而让服务端觉得客户端行为异常。

  let finalBody = body || {}
  if (cfg.signPos === 'body' && sig) finalBody = { ...finalBody, crawlerInfo: sig }

  // ★ 2026-11-09 修：推广域签名**必须同时出现在两处**（同一个字符串）
  //   body  → crawlerInfo
  //   header→ anti-content
  //   只注入 body 会返回 40001（此前 11 个推广接口全部 40001 的根因）
  if (cfg.signPos === 'body' && sig) headers['anti-content'] = sig

  // ★ 2026-11-10：**禁止 keep-alive**。
  //   Node 24 的 undici 会把 socket 留在连接池里，事件循环不空 →
  //   走纯 Node 通道的 skill「结果早就打印完了，进程却一直不退出」，
  //   调用方 WaitForExit 超时，误判成卡死。实测 pdd-works / pdd-shop /
  //   pdd-activity / pdd-promo 全中招。
  //   这里让服务端在响应后关连接，socket 不进池 → 进程能正常退出。
  //   代价：每次请求多一次 TCP/TLS 握手（PDD 都是同域 HTTP/2，影响很小）。
  headers['connection'] = 'close'

  try {
    // ★ body 为 null/undefined 时**不发 body**（部分接口就是无参调用，
    //   发 "{}" 反而 500 —— 如 chance-goods/total_info）
    const hasBody = method !== 'GET' && finalBody !== null && finalBody !== undefined

    // ★★ 2026-11-10：**每次请求用独立 Agent，用完立刻销毁**。
    //
    //   为什么不能直接 fetch()：Node 24 的全局 undici 连接池会把 socket 留成
    //   keep-alive 句柄，事件循环不空 → 走纯 Node 通道的 skill「结果打完了但不退出」，
    //   调用方 WaitForExit 超时就误判成卡死。
    //   实测 `connection: close` 没用（PDD 走 HTTP/2，h2 忽略该头）。
    //   实测最小复现：一次 callApi 后 process._getActiveHandles() 还剩 1 个 Socket。
    //
    //   独立 Agent + close() 后没有残留句柄，进程能正常退出。
    //   代价：没了跨请求连接复用（每次一次握手），但 PDD 请求本身就要节流 1~6 秒，
    //   握手开销可以忽略。
    const undici = await import('undici').catch(() => null)
    let res
    if (undici?.request) {
      const agent = new undici.Agent({ connections: 1, pipelining: 0 })
      try {
        const r = await undici.request(url, {
          method,
          headers,
          ...(hasBody ? { body: JSON.stringify(finalBody) } : {}),
          dispatcher: agent,
        })
        const bodyText = await r.body.text()
        return { status: r.statusCode, json: safeJson(bodyText), text: String(bodyText).slice(0, 300) }
      } finally {
        try { await agent.close() } catch { /* ignore */ }
        try { await agent.destroy() } catch { /* ignore */ }
      }
    }

    // 没有 undici 模块时退回全局 fetch（可能留句柄，但不影响功能）
    const r = await fetch(url, {
      method,
      headers,
      ...(hasBody ? { body: JSON.stringify(finalBody) } : {}),
    })
    const text = await r.text()
    return { status: r.status, json: safeJson(text), text: text.slice(0, 300) }
  } catch (e) {
    return { status: 0, json: null, err: String(e).slice(0, 120) }
  }
}

/** 安全 JSON 解析（非 JSON 返回 null） */
function safeJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

/** 浏览器发请求 */
async function fetchBrowser(page, url, method, body, cfg, domain, opts) {
  // ★ 2026-11-08：无 page 时不能走浏览器通道，直接报错
  //   （Node 通道已失败才会调到这里；没有 page 说明调用方没提供降级能力）
  if (!page) {
    return { status: 0, json: null, err: 'no_page_for_browser_fallback' }
  }

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

/**
 * 查接口的默认 body（基座级）。
 * 表在 pdd-api.mjs 的 API_BODY_DEFAULTS；键是「去掉 /mms-gateway/ 前缀」的短路径。
 */
async function bodyDefaults(pathname) {
  try {
    const reg = await load('pdd-api.mjs')
    const table = reg.API_BODY_DEFAULTS || reg.PROMO_BODY_DEFAULTS || {}
    // ★ 键统一「去掉 /mms-gateway/ 前缀 + 去掉前导 /」——
    //   之前只剥了 /mms-gateway/，导致 /sydney/... 这类 mms 域路径带前导 / 查不到，
    //   店铺类接口全部没带上默认 body（报「开始结束时间不能为空」）。
    const short = String(pathname).split('?')[0]
      .replace(/^\/mms-gateway\//, '').replace(/^\//, '')
    return table[short] || table[pathname] || null
  } catch { return null }
}

/* ── mall_id 自动解析 ──────────────────────────────────────────────
 * 报表类接口的 entityId 是**店铺级**的（不同账号不同），写死在代码里必错。
 * 基座按 shopKey 缓存：第一次用到时去推广域问一次 userInfo，之后复用。
 * ──────────────────────────────────────────────────────────────── */
const _mallIdCache = new Map()
const _mallIdResolving = new Set()

async function resolveMallId(shopKey) {
  if (!shopKey) return ''
  if (_mallIdCache.has(shopKey)) return _mallIdCache.get(shopKey)
  if (_mallIdResolving.has(shopKey)) return ''    // 递归保护
  _mallIdResolving.add(shopKey)
  try {
    const r = await request('/mms-gateway/venus/api/user/userInfo', { clientType: 1 }, {
      shopKey, domain: 'yingxiao', noBodyDefaults: true,
    })
    const mallId = r?.data?.mall?.mallId ?? r?.data?.mallId ?? ''
    _mallIdCache.set(shopKey, mallId)
    return mallId
  } catch {
    return ''
  } finally {
    _mallIdResolving.delete(shopKey)
  }
}

/**
 * 递归替换 body 里的 {{占位符}}。
 * ctx = { mallId, today, yesterday, ... }
 *   未知占位符 → 留空（让平台报参数错，而不是把 "{{mallId}}" 字符串发过去）。
 */
function substitute(obj, ctx = {}) {
  const now = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  const d90 = new Date(now.getTime() - 90 * 86400000)
  const base = {
    today: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`,
    yesterday: `${y.getFullYear()}-${p(y.getMonth() + 1)}-${p(y.getDate())}`,
    // ★ 2026-11-10：毫秒时间戳占位符（video/query 这类接口要 startTime/endTime 数字）
    now: now.getTime(),
    ninetyDaysAgo: d90.getTime(),
    ...ctx,
  }
  // ★ 统一走一条路径：旧代码分了「无 ctx」快路径，只替换 today/yesterday，
  //   新加的 {{now}} / {{ninetyDaysAgo}} 在快路径里会被漏掉 → 参数变成空串 → 40002。
  //   合并成一条，所有占位符都在 base 里查。
  const walk = (v) => {
    if (typeof v === 'string') {
      const m = v.match(/^\{\{(\w+)\}\}$/)
      if (m) return base[m[1]] ?? ''
      return v.replace(/\{\{(\w+)\}\}/g, (_, k) => (base[k] != null ? String(base[k]) : ''))
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const o = {}
      for (const k of Object.keys(v)) o[k] = walk(v[k])
      return o
    }
    return v
  }
  return walk(obj)
}

/**
 * 供 pdd-api.mjs 调用的 Cookie 自愈入口。
 *
 * ★ 2026-11-11：pdd-api 的纯 Node 路径用的是**自己的 fetch**，绕过了 request()，
 *   所以拿不到这里的内置自愈。结果同一接口 request() 通、pddApi() 报 43001。
 *   把 healCookies 暴露出去，让两条路行为一致。
 */
export async function healCookiesForApi(shopKey) {
  if (!shopKey) return null
  return await healCookies(shopKey)
}

export const REQUEST_INFO = {
  module: 'pdd-request.mjs',
  domains: DOMAINS,
  note: '统一入口：自动选域 + 自动选通道 + 自动降级',
}

/**
 * 从接口响应里安全地取列表 —— **区分「失败」和「真的空」**。
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要（2026-11-11 全量审计发现的系统性缺陷）
 * ══════════════════════════════════════════════════════════════════
 * 各 skill 里普遍这样写：
 *     const list = r?.result?.list || []
 *     emit({ ok: true, items: list })
 *
 * 问题：接口**失败**时 `r.result` 是 undefined → `list = []` → 报 `ok:true`
 * 「0 条数据」。**把「没取到」伪装成「本来就没有」**，用户完全看不出问题。
 * 实测受害者：pdd-shop --mode goods（goodsDetailList 恒空）、pdd-video list。
 *
 * 正确做法：先判 `ok`，失败就明确报错，不要返回空数组。
 *
 * @param {object} r        基座 request()/callApi() 的返回
 * @param {(d:any)=>any[]} pick  从 r.data 里挑数组，默认挑常见的 list 字段
 * @param {string} label    报错时的人话名称（如「商品明细」）
 * @returns {any[]} 只有确实成功才返回数组（可能是空数组）
 * @throws {Error} 接口失败时抛错（带 ec / failureKind / hint）
 */
export function pickList(r, pick, label = '数据') {
  const get = pick || ((d) => d?.list ?? d?.result?.list ?? d?.items ?? d)
  if (!r || r.ok !== true) {
    const e = new Error(
      `${label}取数失败：${r?.ec ?? r?.failureKind ?? 'unknown'}`
      + (r?.hint ? `（${String(r.hint).slice(0, 80)}）` : '')
    )
    e.__apiFail = true
    e.ec = r?.ec
    e.failureKind = r?.failureKind
    throw e
  }
  const arr = get(r.data)
  if (Array.isArray(arr)) return arr
  // 成功但结构对不上 —— 这也是问题（接口改版），不能静默当空
  const e = new Error(
    `${label}返回结构异常：期望数组，实际 ${arr === null ? 'null' : typeof arr}。`
    + `原始：${JSON.stringify(r.data).slice(0, 160)}`
  )
  e.__apiFail = true
  e.failureKind = 'schema_mismatch'
  throw e
}

/**
 * 基座级「进程不退出」兜底。
 *
 * ══════════════════════════════════════════════════════════════════
 * 症状（2026-11-10 全量排查）
 * ══════════════════════════════════════════════════════════════════
 * 走纯 Node 通道的 skill，**结果早就打印完了，进程却一直不退出**：
 *   · 调用方 WaitForExit 超时 → 误判「卡死」
 *   · 实测 pdd-works / pdd-shop / pdd-activity / pdd-promo 全部中招
 *
 * 根因：Node 24 的 undici（内置 fetch）会保留 keep-alive socket 在连接池里，
 *   事件循环因此不空。浏览器类 skill 不受影响（Chrome 关掉后自然退出），
 *   纯 Node 通道才会碰到。
 *
 * 为什么不用 beforeExit：**有未清句柄时 beforeExit 根本不会触发**，钩子形同虚设
 *   （实测无效）。改成「请求结束后主动释放连接池」——基座每次请求都是独立调用，
 *   释放后下次会自动重建，代价可忽略。
 */
let _lastDispatcherClose = 0
async function releaseDispatcherIfIdle() {
  const now = Date.now()
  if (now - _lastDispatcherClose < 1000) return   // 1s 内只做一次，别影响并发
  _lastDispatcherClose = now
  try {
    // ① 关 undici 连接池（HTTP keep-alive socket）
    const m = await import('undici').catch(() => null)
    await m?.getGlobalDispatcher?.()?.close?.()
  } catch { /* ignore */ }
  try {
    // ② 关 jsdom 沙箱（★ 这才是「进程不退出」的真凶）
    //    pdd-vodka-signer 里 `new JSDOM(...)` 的 window 自带 setInterval /
    //    MessageChannel 等活句柄，不 close 事件循环永远不空。
    const vs = await load('pdd-vodka-signer.mjs').catch(() => null)
    vs?.resetSandbox?.()
  } catch { /* ignore */ }
}

/**
 * 关闭基座打开的所有常驻资源（目前是推广域的混合签名浏览器）。
 * ★ 必须在 skill 跑完时调用 —— 浏览器连接是活跃句柄，不关 node 进程不退出。
 */
export async function closeChannels() {
  try {
    const hb = await load('pdd-promo-signer-hybrid.mjs')
    await hb.closeAllHybridSigners()
  } catch { /* ignore */ }
}

/**
 * 从 Profile 浏览器取实时 Cookie（并写回凭证库）。
 * 凭证库会话过期但 Profile 会话还活着时用。
 */
async function healCookies(shopKey) {
  // ★ 优先问常驻签名服务 —— 它已经持有那个 Profile 的 Chrome。
  //   自建浏览器会和守护进程抢同一个 Profile 锁 → 两者都可能被踢掉。
  try {
    const dm = await load('pdd-signer-daemon.mjs').catch(() => null)
    if (dm) {
      const h = await dm.daemonHealth().catch(() => null)
      if (h) {
        const r = await dm.daemonSign(shopKey).catch(() => null)
        if (r?.cookies && Object.keys(r.cookies).length >= 5) {
          // 写回凭证库（纯 Node 通道下次就能直接用）
          // ★ 只补缺、不覆盖：pdd_mms 的 account_id 从 PASS_ID 派生，
          //   覆盖 PASS_ID 会让 store 的 migrateDriftedKeys 重新派生 shop_key
          //   → 账号被改名（实测连续漂了 3 次：975543→3fa2ee60→25f216ca），
          //   Profile 目录也跟着换 key → 登录态对不上。
          try {
            const { CredentialStore } = await import(pathToFileURL(path.join(
              path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
              'lib', 'services', 'credential-store.js')).href)
            const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
            const prev = await store.get(shopKey)
            const prevCk = prev?.cookies || {}
            const missing = {}
            for (const [k, v] of Object.entries(r.cookies)) if (prevCk[k] === undefined) missing[k] = v
            if (Object.keys(missing).length) await store.setCookies(shopKey, { ...prevCk, ...missing })
          } catch { /* ignore */ }
          invalidateStoreCookieCache(shopKey)
          console.warn(`[pdd-request] ✅ Cookie 已自愈（${Object.keys(r.cookies).length} 条，来源：常驻签名服务）`)
          return { cookies: r.cookies, count: Object.keys(r.cookies).length, ua: r.ua }
        }
      }
    }
  } catch { /* 落回进程内 */ }
  try {
    const hb = await load('pdd-promo-signer-hybrid.mjs')
    const r = await hb.healCookiesFromProfile(shopKey)
    if (!r) return null
    console.warn(`[pdd-request] ✅ Cookie 已自愈（${r.count} 条，来源：Profile 浏览器）`)
    return r
  } catch (e) {
    console.warn('[pdd-request] Cookie 自愈失败：' + String(e?.message || e).slice(0, 90))
    return null
  }
}
