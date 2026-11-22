/**
 * xhs-browser.mjs —— 小红书浏览器会话（基座·跨技能共用）
 * ══════════════════════════════════════════════════════════════════
 * 为什么要有这个（2026-11 小红书 Node 化）
 * ══════════════════════════════════════════════════════════════════
 * 旧形态：每个小红书技能各带一份 571 行的 `sign_service.cjs`，起一个常驻
 * HTTP 守护进程（默认 8787），技能脚本通过 /eval、/request、/upload 调它。
 *
 * 这份设计有两个硬伤：
 *   ① 两个技能各有一份副本、各带自己的 .secrets/login.json，却共用同一个端口。
 *      后启动的那个探到 /health 有 ready 就直接复用 —— 实际用的是**另一个技能**
 *      的浏览器进程和登录态，跨技能串号。
 *   ② 登录态靠手工文件传递（login.json），不读凭证库。多账号场景永远发错号，
 *      `--account` 形同虚设。
 *
 * 现在改成 in-process：谁用谁 open，用完 close。浏览器 Profile 走
 * `lib/browser-login.js` 的 profileDir（账号级目录，与登录/风控验证共用同一套
 * 互斥锁），Cookie 走 `lib/credential-store.js`（本身就是加密落盘的凭证库）。
 * 没有端口、没有守护进程、没有第二份 cookie 文件。
 *
 * ══════════════════════════════════════════════════════════════════
 * 用法
 * ══════════════════════════════════════════════════════════════════
 *   import { openXhsSession, pickXhsAccount, openStore, emit, fail, log } from
 *     '<PLUGIN_ROOT>/skills/_shared/xhs-browser.mjs'
 *
 *   const store = openStore()
 *   const pick = await pickXhsAccount(store, { want: ARGS.account })
 *   if (!pick.ok) { emit(fail(pick)); process.exit(2) }
 *
 *   const s = await openXhsSession({ store, shopKey: pick.shopKey, log })
 *   try {
 *     await s.ev(`...`)            // 页面内 eval（等价旧 sign_service 的 /eval）
 *   } finally {
 *     await s.close()
 *   }
 *
 * ══════════════════════════════════════════════════════════════════
 * 关键约束（改之前先读）
 * ══════════════════════════════════════════════════════════════════
 *   · headless 会招风控：小红书必须 headless:false + 去掉 automation 标志。
 *   · Cookie 域只注入 `.xiaohongshu.com` 一条 —— 同时注入 www/creator 会让同名
 *     Cookie 共存冲突，登录态反而丢。
 *   · 页面内 fetch 自带 x-s / x-t / x-s-common（小红书把签名包在请求层外），
 *     所以**不要**在 Node 侧自己算签名：让页面发，签名自然对。
 */

import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PLUGIN_ROOT = process.env.DSAGENT_PLUGIN_ROOT || join(HERE, '..', '..')
const PURL = (p) => pathToFileURL(p).href

export const CREATOR_HOME = 'https://creator.xiaohongshu.com/new/home'
export const PUBLISH_PAGE = 'https://creator.xiaohongshu.com/publish/publish?source=official'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 单行 JSON 结果（宿主按行读 __DSAGENT_RESULT__） */
export function emit(payload) {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n')
}

/** 进度日志一律走 stderr：宿主把它算作心跳，stdout 只留最终结果 */
export function log(tag, msg) {
  process.stderr.write(`[${tag}] ${msg}\n`)
}

/** 兼容旧脚本的 failureKind / failure_kind 双写，并统一 ok:false */
export function fail(payload) {
  const kind = payload.failureKind || payload.failure_kind || 'api_error'
  return { ...payload, ok: false, failureKind: kind, failure_kind: kind }
}

/* ------------------------------------------------------------------ *
 * 插件库装载
 * ------------------------------------------------------------------ */

let _libs = null
/** 装载 CredentialStore + 浏览器工具（失败时抛可读错误） */
export async function loadXhsLibs() {
  if (_libs)
    return _libs
  const [cred, browser] = await Promise.all([
    import(PURL(join(PLUGIN_ROOT, 'lib', 'services', 'credential-store.js'))),
    import(PURL(join(PLUGIN_ROOT, 'lib', 'browser-login.js'))),
  ])
  _libs = { ...cred, ...browser }
  return _libs
}

/** 打开凭证库（~/.dsh/dsagent-accounts.json） */
export function openStore(libs) {
  const L = libs || _libs
  return new L.CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
}

/**
 * 选小红书账号。
 *
 * 走 _shared/account-picker 的统一规则：0 个 → not_bound；1 个 → 直接用；
 * 多个 → need_account_choice（绝不静默挑一个，发错号是不可逆事故）。
 *
 * ★ 必须先按 accountsForPlatform 取候选，**再**把 platform 归一成 'xhs'：
 *   凭证库里小红书行的 platform 字段存的是 'xiaohongshu'（历史写入未归一），
 *   而 account-picker 是 `a.platform === platform` 精确匹配 —— 直接传 'xhs'
 *   会 0 命中，误报「未绑定账号」。
 */
export async function pickXhsAccount(store, { want = '', wantName = '', skill = '', allowExpired = false } = {}) {
  const L = await loadXhsLibs()
  const { pickAccount } = await import(PURL(join(HERE, 'account-picker.mjs')))
  const matched = L.accountsForPlatform(store.listAccounts(), 'xhs')
    .map((a) => ({ ...a, platform: 'xhs' }))
  return pickAccount({ listAccounts: () => matched }, {
    platform: 'xhs', want, wantName, skill, allowExpired,
  })
}

/* ------------------------------------------------------------------ *
 * 页面内注入：hook 请求层 + __xhsReq 统一通道
 * （与旧 sign_service.cjs 的 PAGE_HOOK 逐字一致，勿改）
 * ------------------------------------------------------------------ */
export const PAGE_HOOK = () => {
  const S = (window.__XHS_SVC = window.__XHS_SVC || {})
  S.log = S.log || []
  S.permits = S.permits || []
  S.uploads = S.uploads || []

  const sniff = (headers) => {
    const h = {}
    for (const k of Object.keys(headers || {})) h[k.toLowerCase()] = String(headers[k])
    return {
      hasXs: !!h['x-s'], hasXt: !!h['x-t'],
      hasXsCommon: !!h['x-s-common'], hasTrace: !!h['x-b3-traceid'],
      xs: h['x-s'] || '', xt: h['x-t'] || '', xsCommon: h['x-s-common'] || '',
      trace: h['x-b3-traceid'] || '', h,
    }
  }

  const record = (url, method, headers, body) => {
    if (!/\/api\//.test(url)) return
    S.log.push({ t: Date.now(), url, method, ...sniff(headers), body: body ? String(body).slice(0, 4000) : '' })
    if (S.log.length > 200) S.log.shift()
  }

  if (!S.hooked) {
    S.hooked = true
    const of = window.fetch
    window.fetch = async function (...a) {
      const url = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || ''
      const init = a[1] || {}
      record(url, init.method || 'GET', init.headers, init.body)
      try {
        if (/\/permit/i.test(url)) {
          const res = await of.apply(this, a)
          try {
            const c = res.clone()
            const t = await c.text()
            S.permits.push({ url, method: init.method || 'GET', resp: t.slice(0, 6000), at: Date.now() })
            if (S.permits.length > 20) S.permits.shift()
          } catch (e) {}
          return res
        }
        if (/^https?:\/\/[^/]*(ros-upload|xhscdn\.com\/spectrum|ros-preview)/i.test(url) && !/apm-fe/.test(url)) {
          S.uploads.push({ url: url.slice(0, 300), method: init.method || 'PUT', at: Date.now() })
          if (S.uploads.length > 50) S.uploads.shift()
        }
      } catch (e) {}
      return of.apply(this, a)
    }
    const oo = XMLHttpRequest.prototype.open
    const os_ = XMLHttpRequest.prototype.send
    const osr = XMLHttpRequest.prototype.setRequestHeader
    XMLHttpRequest.prototype.open = function (m, u, ...r) { this.__xhsU = u; this.__xhsM = m; this.__xhsH = []; return oo.call(this, m, u, ...r) }
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) { this.__xhsH.push([k, v]); return osr.call(this, k, v) }
    XMLHttpRequest.prototype.send = function (b) {
      try {
        const h = {}
        for (const [k, v] of this.__xhsH || []) h[k] = v
        const u = String(this.__xhsU)
        record(u, this.__xhsM, h, b)
        if (/\/permit/i.test(u)) {
          this.addEventListener('load', () => {
            try {
              S.permits.push({ url: u, method: this.__xhsM, resp: (this.responseText || '').slice(0, 6000), at: Date.now() })
              if (S.permits.length > 20) S.permits.shift()
            } catch (e) {}
          })
        } else if (/ros-upload|spectrum/i.test(u) && !/apm-fe/.test(u)) {
          S.uploads.push({ url: u.slice(0, 300), method: this.__xhsM, at: Date.now() })
          if (S.uploads.length > 50) S.uploads.shift()
        }
      } catch (e) {}
      return os_.call(this, b)
    }
  }

  window.__xhsReq = async function (opts) {
    const { method = 'GET', url, body = null, form = null, timeout = 45000 } = opts || {}
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    try {
      // 风控关联头：x-xray-traceid 与 x-b3-traceid 同源（实测 permit 406 的根因）
      let pair = null
      for (let i = S.log.length - 1; i >= 0; i--) {
        const h = S.log[i].h || {}
        if (h['x-xray-traceid'] && h['x-b3-traceid']) { pair = h; break }
      }
      const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
      const b3 = (pair && pair['x-b3-traceid']) || rnd()
      const xray = (pair && pair['x-xray-traceid']) || ('d0ad1f2ec89c2f6' + b3.replace(/-/g, '').slice(0, 24))
      const baseHeaders = {
        'accept': 'application/json, text/plain, */*',
        'x-b3-traceid': b3,
        'x-xray-traceid': xray,
      }
      let req
      if (form) {
        const fd = new FormData()
        for (const [k, v] of Object.entries(form)) {
          if (v && typeof v === 'object' && v.data !== undefined) {
            const bytes = Uint8Array.from(atob(v.data), (c) => c.charCodeAt(0))
            fd.append(k, new Blob([bytes], { type: v.type || 'application/octet-stream' }), v.name || 'file')
          } else fd.append(k, v)
        }
        req = { method, body: fd, signal: ctrl.signal, headers: baseHeaders }
      } else if (body !== null && body !== undefined) {
        req = {
          method, signal: ctrl.signal,
          headers: Object.assign({}, baseHeaders, { 'Content-Type': 'application/json;charset=UTF-8' }),
          body: typeof body === 'string' ? body : JSON.stringify(body),
        }
      } else {
        req = { method, signal: ctrl.signal, headers: baseHeaders }
      }
      const r = await fetch(url, Object.assign({ credentials: 'include' }, req))
      const text = await r.text()
      return { status: r.status, text }
    } finally { clearTimeout(timer) }
  }

  window.__xhsSignOf = function (urlRe) {
    const re = new RegExp(urlRe)
    for (let i = S.log.length - 1; i >= 0; i--) {
      if (re.test(S.log[i].url) && S.log[i].hasXs) return S.log[i]
    }
    return null
  }

  return true
}

/* ------------------------------------------------------------------ *
 * 浏览器会话
 * ------------------------------------------------------------------ */

/**
 * 读页面内登录判据。
 *
 * ★ DOM 比打接口准：creator 的 /user/me 在未登录时会返回 HTML 兜底页（200），
 *   不能靠状态码判断。
 * ★ 但文案判据必须收紧：登录页正文含「解锁**创作者**专属功能」「创作者云课堂」，
 *   用泛词 /创作者/ 会把登录页判成已登录。这里只认「已登录才可能出现」的词，
 *   并显式排除验证码 / 短信登录这类反向信号。
 */
async function pageLoginState(page) {
  return page.evaluate(() => {
    const t = (document.body && document.body.innerText) || ''
    const side = document.querySelector('.side-container .user-name, .user-name, [class*="userName"]')
    const positive = /退出登录|我的主页|发布笔记|数据看板|笔记管理|创作中心|创作者中心|粉丝数据/.test(t)
    const negative = /扫码登录|手机号登录|短信登录|发送验证码|请登录|登录即同意/.test(t)
    return {
      url: location.href,
      hasUser: positive && !negative,
      sideUser: side ? (side.textContent || '').trim().slice(0, 40) : '',
      snippet: t.replace(/\s+/g, ' ').slice(0, 160),
    }
  }).catch(() => null)
}

/**
 * 开一个小红书浏览器会话。
 *
 * @param {object} o
 * @param {object} o.store     CredentialStore
 * @param {string} o.shopKey   账号 shopKey（必填；由 pickXhsAccount 得出）
 * @param {boolean} [o.headless=false]  小红书必须可见窗口，默认 false
 * @param {(m:string)=>void} [o.log]    日志回调（默认打到 stderr）
 * @param {number} [o.loginTimeoutMs=45000] 等创作中心渲染的上限
 * @returns {Promise<{page:any, browser:any, shopKey:string, dir:string,
 *                    ev:(code:string)=>Promise<any>, request:Function,
 *                    close:()=>Promise<void>, state:any}>}
 */
export async function openXhsSession(o) {
  const { store, shopKey, headless = false, loginTimeoutMs = 45000 } = o || {}
  const say = o?.log || ((m) => log('xhs-browser', m))
  if (!shopKey)
    throw Object.assign(new Error('缺少 shopKey'), { failureKind: 'need_account_choice' })

  const L = await loadXhsLibs()
  const dir = L.profileDir('xhs', shopKey)
  if (!L.tryAcquireProfile(dir, 'xhs-browser')) {
    const holder = L.profileOwner(dir) || '其他任务'
    throw Object.assign(new Error(`小红书浏览器环境正被「${holder}」占用，请稍后重试或关闭已弹出的浏览器窗口。`), {
      failureKind: 'api_error',
    })
  }
  L.clearProfileLocks(dir)

  const account = store.get(shopKey)
  if (!account) {
    L.releaseProfile(dir)
    throw Object.assign(new Error(`账号不存在：${shopKey}`), { failureKind: 'not_bound' })
  }

  let browser = null
  try {
    const puppeteerMod = await import(PURL(join(PLUGIN_ROOT, 'node_modules', 'puppeteer-core',
      'lib', 'esm', 'puppeteer', 'puppeteer-core.js')))
    const chromePath = L.findChromePath()
    if (!chromePath)
      throw Object.assign(new Error('未找到 Chrome 或 Edge 浏览器'), { failureKind: 'skill_error' })

    const launchOpts = {
      // 小红书必须可见窗口：headless 与 --enable-automation 都会招风控
      headless: headless ? 'new' : false,
      executablePath: chromePath,
      userDataDir: dir,
      ignoreDefaultArgs: ['--enable-automation', '--disable-blink-features=AutomationControlled'],
      args: ['--no-first-run', '--no-default-browser-check', '--lang=zh-CN,zh',
        '--window-position=0,0', '--window-size=1440,900'],
      defaultViewport: { width: 1440, height: 900 },
    }

    const launch = puppeteerMod.default?.launch
      ? puppeteerMod.default.launch.bind(puppeteerMod.default)
      : puppeteerMod.launch
    try {
      browser = await launch(launchOpts)
    } catch (e) {
      say('首次启动失败，清理 Profile 锁后重试：' + (e?.message || e))
      L.clearProfileLocks(dir)
      browser = await launch(launchOpts)
    }

    const page = (await browser.pages())[0] || await browser.newPage()
    await page.evaluateOnNewDocument(PAGE_HOOK)

    // 1) 先落基础 cookie（a1 / webId 等），再注入登录态
    await page.goto('https://www.xiaohongshu.com/explore', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    await sleep(1200)

    const jar = account.cookies || {}
    const cookieList = Object.entries(jar)
      .filter(([, v]) => v !== '' && v != null)
      .map(([name, value]) => ({ name, value: String(value), domain: '.xiaohongshu.com', path: '/' }))
    if (cookieList.length)
      await page.setCookie(...cookieList)
    say(`已注入 ${cookieList.length} 个 .xiaohongshu.com Cookie（${shopKey}）`)

    // 2) 打开创作中心，判定登录态
    //
    // ★ 标记 expired 的条件必须收紧：只有**被重定向到 /login（redirectReason=401）**
    //   才是平台明确否定会话，这时才写 status=expired。
    //   「页面没渲染出来」可能是网络慢 / 前端白屏，不能拿它判死一个账号 ——
    //   写错状态会让技能列表变「未授权」，把用户挡在所有小红书技能之外。
    say('打开创作中心…')
    await page.goto(CREATOR_HOME, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})

    let state = null
    const t0 = Date.now()
    while (Date.now() - t0 < loginTimeoutMs) {
      state = await pageLoginState(page)
      if (state && /\/login|passport/i.test(state.url)) {
        await store.setStatus(shopKey, 'expired').catch(() => {})
        throw Object.assign(new Error('小红书创作中心登录态已失效，请到「账号连接」对该账号重新登录后重试。'), {
          failureKind: 'token_expired',
        })
      }
      if (state && (state.hasUser || state.sideUser))
        break
      await sleep(1500)
    }
    const loggedIn = !!(state && (state.hasUser || state.sideUser))
    if (!loggedIn) {
      throw Object.assign(
        new Error(`创作中心未渲染（当前 ${page.url()}）。可能是网络慢或前端白屏，请重试；`
          + '若反复如此再到「账号连接」重新登录。'),
        { failureKind: 'api_error' },
      )
    }
    say(`已登录${state.sideUser ? '：' + state.sideUser : ''}`)

    /**
     * 页面内执行 JS。
     *
     * 主路径是 `eval(code)`（与旧 sign_service 的 /eval 一致，已在真机发布链路验证过）。
     * 但 creator 域如果下发不含 'unsafe-eval' 的 CSP，`eval` 会抛 EvalError；
     * 此时降级成 puppeteer 的字符串求值（走 DevTools Runtime.evaluate，不受页面 CSP 约束）。
     */
    const ev = async (code) => {
      try {
        return await page.evaluate((c) => eval(c), code)
      } catch (e) {
        const msg = String(e?.message || e)
        if (/unsafe-eval|Content Security Policy|EvalError/i.test(msg))
          return page.evaluate(code)
        throw e
      }
    }
    const request = (opts) => page.evaluate((o) => window.__xhsReq(o), opts)

    let closed = false
    const close = async () => {
      if (closed)
        return
      closed = true
      try {
        // 回写 Cookie：小红书 web_session 只有 1~3 天寿命，每次用完把最新 jar 存回凭证库
        const cdp = await page.createCDPSession()
        const { cookies } = await cdp.send('Network.getAllCookies')
        const next = {}
        for (const c of cookies) {
          if (!/xiaohongshu/.test(c.domain)) continue
          if (!next[c.name] || c.domain.startsWith('.xiaohongshu')) next[c.name] = c.value
        }
        if (Object.keys(next).length)
          await store.setCookies(shopKey, next).catch(() => {})
      } catch { /* 关闭阶段的回写失败不影响主流程 */ }
      try { await browser.close() } catch { /* 已断开 */ }
      L.releaseProfile(dir)
    }

    return { page, browser, shopKey, dir, ev, request, close, state }
  } catch (e) {
    // 任何失败路径都要还回 Profile 占用，否则后续所有小红书操作都会被自己锁死
    if (browser)
      try { await browser.close() } catch { /* 忽略 */ }
    L.releaseProfile(dir)
    throw e
  }
}

/** 查询会话状态（替代旧 /health） */
export async function sessionHealth(session) {
  const state = await pageLoginState(session.page)
  return {
    ok: true,
    ready: true,
    login: !!(state && (state.hasUser || state.sideUser)),
    url: state?.url || session.page.url(),
    shopKey: session.shopKey,
  }
}

/* ------------------------------------------------------------------ *
 * permit 借用（视频发布的唯一硬限制）
 * ------------------------------------------------------------------ */
/**
 * 借页面拿上传 permit。
 *
 * 为什么必须借浏览器：permit 走「上传 SDK 私有实例通道」，不是普通 axios/fetch 层。
 * 逆向报告 §3.3 实测：拿旧的 x-s 打新的 permit → **406**，
 * 即使补上 x-xray-traceid 关联头也无效。所以纯 Node 复现不出来。
 *
 * 做法：打开发布页 → 挂一个极小的视频到 input[type=file] 触发 SDK 自己发 permit
 *       → 从 PAGE_HOOK 的 `window.__XHS_SVC.permits` 里读响应体。
 * 拿到 permit 后，COS PUT 与提交笔记都可以回纯 HTTP 做。
 *
 * @returns {Promise<{ok:boolean, payload?:object, permits?:Array, failureKind?:string, message?:string}>}
 */
export async function grabPermitViaPage(session, { timeoutMs = 60000 } = {}) {
  const { page, ev } = session
  try {
    // 1) 打开发布页（视频 tab 是默认）
    await ev(`location.href='https://creator.xiaohongshu.com/publish/publish?source=official'`)
    await sleep(7000)

    // 2) 清空已抓记录，便于只认本次触发的 permit
    await ev(`(function(){
      var S = window.__XHS_SVC;
      if (S) { S.permits.length = 0; }
      return 'cleared';
    })()`).catch(() => {})

    // 3) 挂一个极小视频触发 SDK 自己发 permit
    //    用一个 1 帧的合法 mp4（base64）—— 只为让 SDK 走到 permit 那一步
    const probe = await ev(`(function(){
      // 优先用页面里已有的 video input
      var ins = [...document.querySelectorAll('input[type=file]')];
      var t = ins.find(function(i){ return /mp4|mov|mkv|video/i.test(i.accept||''); });
      if (!t) return JSON.stringify({ ok:false, reason:'no video input' });
      // 1x1 黑色 mp4（约 500 字节），仅用于触发 permit
      var b64 = 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAu1tZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCByMzEwOCAzMWUxOWY5IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAA';
      var bin = atob(b64); var bytes = new Uint8Array(bin.length);
      for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
      var dt = new DataTransfer();
      dt.items.add(new File([bytes], 'probe.mp4', { type: 'video/mp4' }));
      t.files = dt.files;
      t.dispatchEvent(new Event('change', { bubbles: true }));
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return JSON.stringify({ ok:true, attached: bytes.length });
    })()`).catch(() => null)

    // 4) 等 permit 出现
    const deadline = Date.now() + timeoutMs
    let payload = null
    while (Date.now() < deadline) {
      await sleep(2000)
      const raw = await ev(`(function(){
        var S = window.__XHS_SVC;
        if (!S || !S.permits || !S.permits.length) return null;
        // 取最后一条 /permit 的响应体
        for (var i = S.permits.length - 1; i >= 0; i--) {
          if (/\\/permit/i.test(S.permits[i].url)) return S.permits[i].resp;
        }
        return null;
      })()`).catch(() => null)
      if (!raw)
        continue
      try {
        const j = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (j && (j.data || j.code === 0)) { payload = j; break }
      } catch { /* 继续等 */ }
    }

    if (!payload) {
      return {
        ok: false, failureKind: 'api_error',
        message: `未能从页面抓到 permit（等了 ${Math.round(timeoutMs / 1000)}s）。probe=${probe}`,
      }
    }

    const permits = payload.data?.uploadTempPermits || payload.data?.upload_temp_permits || []
    if (!permits.length)
      return { ok: false, failureKind: 'api_error', message: 'permit 响应里没有 uploadTempPermits', payload }

    return { ok: true, payload, permits }
  } catch (e) {
    return { ok: false, failureKind: e?.failureKind || 'api_error', message: String(e?.message || e) }
  }
}
