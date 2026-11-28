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

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

// ★ 2026-10-27：createRequire 的 base 从 import.meta.url 推导，不再硬编码绝对路径。
//   本文件在 skills/_shared/ 下，上推两层到插件根（那里有 package.json 与 lib/）。
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(HERE, '..', '..')
const PKG_BASE = [
  path.join(PLUGIN_ROOT, 'package.json'),
  path.join(HERE, 'package.json'),
].find(p => fs.existsSync(p)) || path.join(tmpdir(), 'pdd-client-base.json')
const require = createRequire(PKG_BASE)
import { getAntiString } from './pdd-antistring.mjs'
import { signPlan } from './pdd-sign-scope.mjs'
import { decodePua, hasPua, buildPuaMap, RISK_SDK_INJECT } from './pdd-risksdk.mjs'
import {
  reserveSlot, recordResult, canUse, getAccountState,
  ERR, THROTTLE, fmtRemain, backoffWait, clearCooldown,
} from './pdd-antiban.mjs'


/**
 * ★ 2026-10-27：UA 与 sec-ch-ua 的主版本号从**实际 chrome.exe** 推导。
 *
 *   原来两处都硬编码 `Chrome/155.0.0.0`，而 `pdd-http.mjs` 的 sec-ch-ua 更是
 *   写着 `v="128"` —— 同一次请求的两个头自相矛盾，本身即是风控信号。
 *   硬编码还会在 Chrome 自动升级后立刻失效。
 *
 *   推导失败时退到 '155'（保证 UA 与 sec-ch-ua 至少彼此一致）。
 */
function detectChromeMajor() {
  const { execFileSync } = require('node:child_process')
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.CHROME_PATH,
  ].filter(Boolean)
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue
      const out = execFileSync('powershell', ['-NoProfile', '-Command',
        `(Get-Item -LiteralPath '${p}').VersionInfo.ProductVersion`], { encoding: 'utf8', timeout: 8000 })
      const major = String(out).trim().split('.')[0]
      if (/^\d+$/.test(major)) return major
    } catch { /* 试下一个 */ }
  }
  return '155'
}

const CHROME_MAJOR = detectChromeMajor()
const DEFAULT_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`
const SEC_CH_UA = `"Google Chrome";v="${CHROME_MAJOR}", "Chromium";v="${CHROME_MAJOR}", "Not(A:Brand";v="24"`

/* ── 54001 token 持久化 ──
 *
 * ★ 2026-10-27：改为复用 pdd-risk 的存储实现（原子写），不再自带一套裸 writeFileSync。
 *   三个模块原本各自「读整个→改→写整个」同一个文件，并发时互相覆盖 token → 又弹滑块。
 *   数据结构与 TTL 三者本就一致（{token, savedAt, expiresAt}，10 分钟），收敛无行为变化。
 */
import { readCaptchaStore, writeCaptchaStore } from './pdd-risk.mjs'

function readTokens() { return readCaptchaStore() }
function writeTokens(d) { writeCaptchaStore(d) }
export function saveVerifyToken(shopKey, token) { if (!token) return; const d = readTokens(); d[shopKey] = { token, savedAt: Date.now(), expiresAt: Date.now() + 6e5 }; writeTokens(d) }
export function getVerifyToken(shopKey) { const d = readTokens(); const r = d[shopKey]; if (!r?.token) return null; if (Date.now() > r.expiresAt) { delete d[shopKey]; writeTokens(d); return null } return r.token }
export function clearVerifyToken(shopKey) { const d = readTokens(); if (d[shopKey]) { delete d[shopKey]; writeTokens(d) } }

/** wait */
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * ★ 页面内执行的签名生成函数（源码字符串形式）
 *
 * 为什么用字符串：
 *   · 箭头函数经 puppeteer 序列化后，某些 Node 版本会因闭包/this 丢失
 *     报 `detached Frame`
 *   · 字符串形式 `page.evaluate(\`(${GEN_SIG_SRC})()\`)` 最稳
 *
 * 现场扫 window.__pddWpAll（注入器收集的 webpack 模块）拿 eDaA。
 */
const GEN_SIG_SRC = `async () => {
  var all = window.__pddWpAll || {}
  var mods = {}
  for (var k in all) { var m2 = all[k].modules || {}; for (var k2 in m2) mods[k2] = m2[k2] }
  var count = 0; for (var x in mods) count++
  if (!mods['eDaA']) {
    return { err: 'eDaA module not found', moduleCount: count, wpInstances: Object.keys(all).length }
  }
  var cache = {}
  function R(id) {
    if (cache[id]) return cache[id].exports
    var m = cache[id] = { i: id, l: false, exports: {} }
    mods[id].call(m.exports, m, m.exports, R)
    m.l = true
    return m.exports
  }
  R.m = mods; R.c = cache
  R.d = function (e, n, g) { if (!R.o(e, n)) Object.defineProperty(e, n, { enumerable: true, get: g }) }
  R.r = function (e) { Object.defineProperty(e, '__esModule', { value: true }) }
  R.n = function (m) { var g = m && m.__esModule ? function () { return m['default'] } : function () { return m }; R.d(g, 'a', g); return g }
  R.o = function (o, p) { return Object.prototype.hasOwnProperty.call(o, p) }
  R.p = ''; R.s = undefined
  try {
    var exp = R('eDaA')
    var Ctor = exp.default || exp
    if (typeof Ctor !== 'function') return { err: 'eDaA default is not a constructor' }
    var tb = window.mmsCMT && window.mmsCMT.timeBaseline
    var serverTime = tb ? (tb.serverTime + (Date.now() - tb.localTime)) : Date.now()
    var sdk = new Ctor({ serverTime: serverTime, _2827c887a48a351a: false })
    sdk.init(null)
    var sig = await sdk.messagePack({
      touchEventData: true, clickEventData: true, focusblurEventData: true,
      changeEventData: true, locationInfo: true, referrer: true,
      browserSize: true, browserInfo: true, token: true, fingerprint: true,
    })
    try { sdk.clearCache() } catch (e2) {}
    return { ok: true, sig: String(sig), len: String(sig).length, serverTime: serverTime, hasTimeBaseline: !!tb }
  } catch (e) {
    return { err: String(e).slice(0, 200) }
  }
}`


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
  // ★ 2026-10-27 修：启动前清「孤儿进程 + Profile 锁」，失败后再清一次重试。
  //
  //   实测坑：`browser.close()` 只关 puppeteer 连接的主进程，Chrome 的渲染/GPU/
  //   工具子进程**偶发残留**（实测一次 close 后仍有 10 个 chrome 进程指向同一
  //   Profile，另一次 0 个 —— 与 Chrome 内部时序有关，不可预测）。
  //   残留进程继续持有 SingletonLock → 下次 launch 报
  //   `Failed to launch the browser process!`，而该报错**指不到真正原因**
  //   （既不说 Profile 被占用，也不说哪个进程）。
  //
  //   只删锁文件不够：锁能删，但占用它的进程还在，删了立刻被重建。
  //   必须先杀孤儿进程（pdd-proc-clean，只杀命令行含 --user-data-dir
  //   且指向本 Profile 的，绝不碰用户日常浏览器），再删锁。
  //
  //   `pdd-crawl.ts` 侧同样只有 clearProfileLocks，一并补上。
  const lo = launchOptions(shopKey, launchExtra)
  const cleanBeforeLaunch = async () => {
    try {
      const mod = await import('./pdd-proc-clean.mjs')
      if (typeof mod.cleanProfileForLaunch === 'function') {
        mod.cleanProfileForLaunch(lo.userDataDir, { quiet: true })
        return
      }
    } catch { /* 模块缺失时退化为只删锁 */ }
    try {
      const { clearProfileLocks } = await import('./pdd-launch.mjs')
      clearProfileLocks(lo.userDataDir)
    } catch { /* ignore */ }
  }
  await cleanBeforeLaunch()
  let browser
  try {
    browser = await puppeteer.launch(lo)
  } catch (e) {
    console.warn('[pdd-client] 首次启动失败，清理孤儿进程与 Profile 锁后重试:', e instanceof Error ? e.message : String(e))
    await cleanBeforeLaunch()
    browser = await puppeteer.launch(lo)
  }
  const page = (await browser.pages())[0] || await browser.newPage()

  // ★★★ 必须在第一次 goto 前注入 ★★★
  //   RISK_SDK_INJECT 靠 hook webpackJsonp.push 收集模块，
  //   页面加载完再注入就什么都抓不到了。
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

  // 新开页时也要注入（revive 用）
  const setupInject = async (pg) => {
    await pg.evaluateOnNewDocument(STEALTH_SCRIPT)
    await pg.evaluateOnNewDocument(RISK_SDK_INJECT)
  }

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
    /**
     * ★ 生成真签名（自带完整实现，不依赖注入）
     *
     * 直接在当前页面里：
     *   ① 从 webpackJsonp 全局数组的已加载模块里找 eDaA
     *   ② 手工实现 webpack require
     *   ③ new Ctor({serverTime, _2827c887a48a351a:false}).init(null)
     *   ④ messagePack(10 域) + clearCache()
     *
     * 为什么自带：RISK_SDK_INJECT 的 push 拦截器在页面已加载完成后
     * 才注入会漏掉模块，所以这里改成「现场扫 window.webpackJsonp*」。
     */
    /**
     * ★ 取真签名（每次现场生成，**绝不缓存**）
     *
     * ★ 2026-10-27 修：原来会先读页面缓存 `window.__pddSigCache`（TTL 5 分钟），
     *   命中就直接复用同一个签名。这是**反向优化**：
     *
     *   · `pdd-http.mjs:130` 的注释自己写着「官方：绝不可缓存」；
     *   · `messagePack(10 域)` 的入参里含 `touchEventData / clickEventData /
     *     focusblurEventData / locationInfo / referrer / browserSize / token /
     *     fingerprint` —— 全是**每次请求都应该不同**的行为数据；
     *   · 复用同一签名 5 分钟，等于告诉平台「这个会话 5 分钟内没有产生任何交互」，
     *     是典型的机器特征。
     *
     *   代价：每次多一次 evaluate。但 evaluate 失败可以靠下面的重试兜底，
     *   而签名复用是**主动向平台暴露机器身份**，不可接受。
     *
     *   保留的重试策略：短等待（长等待会让风控把页面关掉）；
     *   只试 1 次缓存探测已删除，避免反复 evaluate 正在关闭的页面。
     */
    async genSig() {
      /**
       * ★★ 2026-11-19 重写：主路径不用 eDaA，改用 CDP 逆向 ★★
       *
       *   教训：原先硬编码从页面 webpack 模块 `eDaA` new 出签名器。
       *   平台一旦改模块名/移除，整条链路直接死，而且报错极具误导性
       *   （"eDaA module not found" 看起来像平台改版，实际常常只是页面没加载完
       *    或干脆被踢到登录页）。
       *
       *   现在按顺序：
       *     ① 先检查是不是被踢到登录页 —— 是就直接返回 login_required，
       *        别再去试签名、也别报「eDaA not found」误导排查方向；
       *     ② 试旧路径（eDaA 还在就最快，0 秒）；
       *     ③ 旧路径不通 → CDP 从真实流量抓 anti-content（见 pdd-cdp-harvest.mjs）。
       */
      if (page.isClosed()) return { err: 'page closed' }

      // ① 登录态检查（最容易被误判成"平台改版"的根因）
      try {
        const { isLoginPage } = await import(new URL('./pdd-cdp-harvest.mjs', import.meta.url).href)
        if (await isLoginPage(page)) {
          return {
            err: 'login_required',
            loginRequired: true,
            hint: '当前 Profile 已掉登录（页面被重定向到 /login）。请到「账号连接」重新扫码登录后再试。',
          }
        }
      } catch { /* 检查失败不阻断 */ }

      let lastErr = null

      // ② 旧路径：eDaA 还在的话最快
      try {
        const r = await page.evaluate(() => window.__pddGenRiskSig())
        if (r?.ok) return r
        lastErr = r?.err || 'unknown'
        if (lastErr !== 'eDaA module not found') return r
      } catch (e) {
        lastErr = String(e).slice(0, 120)
      }

      // ③ CDP 兜底：不依赖任何模块名
      try {
        const { createSignHarvester } = await import(new URL('./pdd-cdp-harvest.mjs', import.meta.url).href)
        const h = await createSignHarvester(page)
        try {
          const sig = await h.grab(12_000)
          if (sig) {
            return {
              ok: true, sig, len: sig.length,
              serverTime: Date.now(), hasTimeBaseline: true, via: 'cdp-harvest',
            }
          }
        } finally {
          h.dispose()
        }
        lastErr = `eDaA missing; cdp: no signature captured`
      } catch (e) {
        lastErr = `eDaA missing; cdp: ${String(e).slice(0, 80)}`
      }

      return { err: lastErr }
    },
    async goto(url, waitMs = 12000) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
      } catch { /* ignore */ }
      await sleep(waitMs)
    },
    /**
     * ★ 等页面真正稳定：
     *   ① URL 不再变（连续 3 次相同）
     *   ② 能连续 3 次 evaluate 成功（frame 未分离）
     *   ③ eDaA 模块已就绪
     */
    async waitStable(maxWaitMs = 60000) {
      const t0 = Date.now()
      let lastUrl = ''
      let sameCount = 0
      let evalOk = 0
      while (Date.now() - t0 < maxWaitMs) {
        if (page.isClosed()) return false
        let url = null
        try { url = await page.evaluate(() => location.href) } catch { /* frame 分离 */ }
        if (url) {
          evalOk++
          if (url === lastUrl) sameCount++
          else { sameCount = 0; lastUrl = url }
        } else {
          evalOk = 0
        }
        if (sameCount >= 2 && evalOk >= 3) {
          // 再看 eDaA
          try {
            const ready = await page.evaluate(() => {
              const all = window.__pddWpAll || {}
              for (const s of Object.values(all)) {
                if (s.modules && s.modules['eDaA']) return true
              }
              return false
            })
            if (ready) return true
          } catch { /* ignore */ }
        }
        await sleep(1500)
      }
      return false
    },
    /**
     * 关闭会话：先 browser.close()，再兜底杀孤儿 chrome + 删锁。
     *
     * ★ 2026-10-27：browser.close() 只关主进程，Chrome 子进程偶发残留并持有
     *   SingletonLock，导致下一次 launch 失败（报错还指不到原因）。
     *   这里在 close 后补一次清理，让「关会话」这件事真正干净。
     *   注意：只有确认是自己的 Profile 才会杀（pdd-proc-clean 的安全边界）。
     */
    async close() {
      try { await browser.close() } catch { /* ignore */ }
      try {
        const mod = await import('./pdd-proc-clean.mjs')
        mod.cleanProfileForLaunch(lo.userDataDir, { quiet: true })
      } catch { /* ignore */ }
    },
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
 * 通过 CDP 抓取页面真实请求头里的 anti-content。
 *
 * ★ 2026-11-19 新增，是本轮签名失效的**真正解法**。
 *
 * 背景：
 *   拼多多已把 webpack 模块名从语义 ID（eDaA）改成 4 位哈希 ——
 *   实测 goods_effect 页 1186 个模块全是 uR7H / +sIe / ARXd 这类随机串，
 *   **没有 eDaA**。所以「手工重建 webpack require → new 签名器」彻底失效，
 *   「多加几次重试」也没意义（模块永远不会再叫 eDaA）。
 *
 * 两条被证伪的思路（别再走）：
 *   ① 页面内 hook XHR/fetch 抓 anti-content —— 抓不到。
 *      因为签名头是在更底层注入的，不经过 JS 层的 setRequestHeader。
 *   ② 手工 require 疑似模块（uR7H 等）—— 报
 *      "Cannot read properties of undefined (reading 'call')"，
 *      跨 chunk 依赖不在 __pddWpAll 里，模块图不完整。
 *
 * 有效解法：
 *   CDP 的 Network.requestWillBeSent 拿到的是**浏览器实际发出的完整请求头**，
 *   里面带着平台注入的合法 anti-content（实测 415~418 字符，与原签名长度一致）。
 *   触发一次页面自身请求，抓下来直接用即可。
 *
 * @param {object} session createSession 返回的会话
 * @returns {Promise<{ok:true,sig:string}|{ok:false,err:string}>}
 */
async function harvestAntiContentViaCdp(session) {
  const page = session?.page
  if (!page || page.isClosed()) return { ok: false, err: 'page closed' }
  let cdp = null
  try {
    cdp = await page.target().createCDPSession()
    await cdp.send('Network.enable')

    /**
     * ★ 关键：**先挂监听再触发请求**，且监听窗口要盖住「触发前后」。
     *   反例（踩过）：先 await 触发请求、再去等事件 —— 页面请求很快就发完了，
     *   等我们开始监听时它已经在路上或已结束，自然抓不到。
     */
    let resolved = false
    const captured = await new Promise((resolve) => {
      const timer = setTimeout(() => { if (!resolved) { resolved = true; resolve(null) } }, 18_000)
      cdp.on('Network.requestWillBeSent', (e) => {
        if (resolved) return
        const h = e?.request?.headers || {}
        for (const k of Object.keys(h)) {
          if (/^anti-content$/i.test(k)) {
            const v = String(h[k])
            if (v.length > 200) {
              resolved = true
              clearTimeout(timer)
              resolve(v)
              return
            }
          }
        }
      })

      /**
       * 触发页面自身请求。★ 必须复用页面已有的请求路径，不要凭空造 URL：
       *   实测凭空造的 /mms-gateway/mall/query/mall_info 可能被页面路由拦掉，
       *   根本不发出去，于是 CDP 什么也看不到。
       *   改用「页面自己也在用的那些接口」+ 稍微多打几个，命中率高得多。
       */
      page.evaluate(() => {
        const urls = [
          '/newjersy/api/mms/popup',
          '/newjersy/api/mms/overlayCard/list',
          '/cambridge/api/duoduoChicken/queryFagList',
          '/mms-gateway/mall/query/mall_info',
        ]
        for (const u of urls) {
          try {
            fetch(u, {
              method: 'POST', credentials: 'include',
              headers: { 'content-type': 'application/json' }, body: '{}',
            }).catch(() => {})
          } catch { /* ignore */ }
        }
      }).catch(() => {})

      // 8 秒后若仍未命中，再补一轮页面自身请求（不 reload，避免丢失页面上下文）
      setTimeout(() => {
        if (resolved) return
        page.evaluate(() => {
          const urls = [
            '/newjersy/api/mms/popup',
            '/cambridge/api/duoduoChicken/queryFagList',
          ]
          for (const u of urls) {
            try {
              fetch(u, {
                method: 'POST', credentials: 'include',
                headers: { 'content-type': 'application/json' }, body: '{}',
              }).catch(() => {})
            } catch { /* ignore */ }
          }
        }).catch(() => {})
      }, 8_000)
    })

    if (captured) return { ok: true, sig: captured }
    return { ok: false, err: 'no anti-content captured via CDP' }
  } catch (e) {
    return { ok: false, err: String(e).slice(0, 100) }
  } finally {
    try { await cdp?.detach() } catch { /* ignore */ }
  }
}

/**
 * 让页面自己发一条同域请求，捕获平台自动注入的 anti-content（JS 层 hook，备用）。
 *
 * ⚠️ 实践结论：**基本抓不到**（签名头在更底层注入，不经过 JS setRequestHeader）。
 * 保留仅作极少数环境下的兜底，主路径请用 harvestAntiContentViaCdp。
 *
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<{ok:true,sig:string}|{ok:false,err:string}>}
 */
async function harvestPageAntiContent(page) {
  try {
    const r = await page.evaluate(async () => {
      let captured = null
      const OX = XMLHttpRequest.prototype.open
      const OH = XMLHttpRequest.prototype.setRequestHeader
      XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return OX.apply(this, arguments) }
      XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
        if (/^anti-content$/i.test(k)) captured = String(v)
        return OH.apply(this, arguments)
      }
      const OF = window.fetch
      window.fetch = function (input, init) {
        try {
          const h = init && init.headers
          if (h) {
            const get = (n) => (typeof h.get === 'function' ? h.get(n) : (h[n] ?? h[n.toLowerCase()]))
            const v = get('anti-content') || get('Anti-Content')
            if (v) captured = String(v)
          }
        } catch { /* ignore */ }
        return OF.apply(this, arguments)
      }

      try {
        await fetch('https://mms.pinduoduo.com/mms-gateway/mall/query/mall_info', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      } catch { /* 业务结果不重要 */ }

      for (let i = 0; i < 25 && !captured; i++) {
        await new Promise(r2 => setTimeout(r2, 150))
      }

      XMLHttpRequest.prototype.open = OX
      XMLHttpRequest.prototype.setRequestHeader = OH
      window.fetch = OF

      return captured ? { ok: true, sig: captured } : { ok: false, err: 'no anti-content captured' }
    })
    if (r?.ok && r.sig) return { ok: true, sig: r.sig }
    return { ok: false, err: r?.err || 'harvest failed' }
  } catch (e) {
    return { ok: false, err: String(e).slice(0, 100) }
  }
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
export async function call(o) {  const {
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
    // ★ 2026-11-05：通道判断收归基座 pdd-transport.pickTier（唯一真源）
    //   原来这里有一套内联正则，与 pickTier 重复；两处口径一旦分叉，
    //   同一接口在不同调用路径上会走不同通道 → 风控表现不可预测。
    //   已把原特例（ReadyDate 系列、ForMMS 别名）并入 pickTier，行为等价。
    const { pickTier } = await import('./pdd-transport.mjs')
    tier = pickTier(I)
  }

  // t2/t3 必须有 session
  // ★ 2026-11-04 说明：这里**故意不做「白名单外自动降级 t1」**。
  //   降级虽然能省一次浏览器，但 pdd-works 等技能长期把 /glide/ /vodka/ 走 t2，
  //   一旦白名单匹配口径与平台有偏差（路径归一、大小写、版本前缀），就会把
  //   「本来能跑」的调用降成 cookie-only 而稳定失败 —— 省时间不值这个风险。
  //   签名是否注入由 pdd-sign-scope.mjs 单独控制（不影响通道选择）。
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
    // ★★ 2026-11-04 二次修正：两个独立条件——
    //   ① 162 条路径白名单 → body.crawlerInfo
    //   ② 域名正则（mms|ims|...）→ header Anti-Content
    //   只要域名是 mms.pinduoduo.com 就必须签名；「不在名单」只代表 body 不用塞 crawlerInfo。
    //   详见 pdd-sign-scope.mjs 顶部注释（含真机反例 goodsList → 54001）。
    const plan = signPlan(I)
    const shouldSign = plan.headerAnti
    const shouldSendCrawlerInfo = plan.bodyCrawlerInfo
    const whitelistHit = plan.whitelistRule
    let anti = null
    let sigMeta = null
    if (!shouldSign) {
      sigMeta = { type: 'none', reason: 'host-not-in-anti-content-scope' }
    } else if (tier === 't1') {
      anti = getAntiString()
      sigMeta = { type: 'simple', len: anti.length }
    } else {
      const r = await session.genSig()
      if (!r?.ok) {
        // ★ 2026-11-19：登录态失效不要伪装成签名错误 —— 两者处置完全不同。
        if (r?.loginRequired) {
          return {
            ok: false,
            kind: 'login_required',
            hint: r.hint || '当前 Profile 已掉登录，请重新扫码登录',
            tier,
          }
        }
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
      'sec-ch-ua': SEC_CH_UA,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'cookie': cookies,
      'user-agent': DEFAULT_UA,
      'referer': referer || 'https://mms.pinduoduo.com/',
    }
    // ★ 2026-11-04：仅在签名范围内注入（见 pdd-sign-scope.mjs）
    if (shouldSign && anti) headers['anti-content'] = anti
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
      reqOpts.body = JSON.stringify(shouldSendCrawlerInfo && anti ? { ...body, crawlerInfo: anti } : body)
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
 *
 * ★ 2026-10-27 修：先动态推导映射再解码。
 *   拼多多的 PUA 码点是动态的（本次实测 E573->0，而静态表里 E515->6），
 *   用静态表会把 goodsUv/goodsVcr 解成空串或 0%。
 *   推导依据：同一响应里 <X>Ppr 是明文的较上周期值，与 <X> 等长同构。
 *
 * @param {object|Array} obj 接口返回的 json
 * @param {Object} [opts] { listPath: 'result.goodsDetailList' } 指定承载 <X>/<X>Ppr 对的数组路径
 */
export function decodeAllPua(obj, opts = {}) {
  // 1) 先找列表，动态推导映射
  let map = null
  try {
    const listPath = opts.listPath || 'result.goodsDetailList'
    const list = listPath.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
    if (Array.isArray(list) && list.length) {
      map = buildPuaMap(list).map
    }
  } catch { /* 推导失败就用静态兜底 */ }
  return _decodeAllPua(obj, map)
}

function _decodeAllPua(obj, map) {
  if (Array.isArray(obj)) return obj.map(x => _decodeAllPua(x, map))
  if (!obj || typeof obj !== 'object') return obj
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && hasPua(v)) {
      const dec = decodePua(v, map)
      // 保留原值
      out[k] = dec
      out[k + '_raw'] = v
    } else if (v && typeof v === 'object') {
      out[k] = _decodeAllPua(v, map)
    } else {
      out[k] = v
    }
  }
  return out
}

export { ERR, THROTTLE, getAccountState, canUse, clearCooldown, fmtRemain }
