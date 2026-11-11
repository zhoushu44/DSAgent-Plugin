/**
 * pdd-promo-signer-hybrid.mjs —— 推广域（yingxiao.pinduoduo.com）混合签名器
 *
 * 【为什么是混合】
 *   2026-11-09 追踪实证（promo-sdk.mjs 同一份代码）：
 *     · 真实浏览器内运行 → 签名有效（Node 重放 HTTP 200 / errorCode 1000）
 *     · jsdom 内运行     → 签名恒定无效（mikasaErrorCode:12 系统校验参数异常）
 *   已逐项排除：环境画像值（套进真浏览器不影响有效性）、时间源、时钟偏移、
 *   Cookie、请求头、SDK 代码本身。剩余差异是 **jsdom 运行时语义**层，
 *   靠对齐环境值无法消除。
 *
 *   所以推广域采用：**浏览器只负责签名，请求走 Node**。
 *   - 签名质量 = 真实浏览器级别
 *   - 请求在 Node 发出（可并发/可拦截/可复用基座的风控与限流）
 *   - 签名按需生成（~50~200ms），不需要每次跳页面
 *
 * 【与基座的边界】
 *   本模块**只负责签名**；限流/账号锁/错误分类全部在 pdd-request.mjs + pdd-antiban.mjs，
 *   skill 侧不感知渠道差异。
 *
 * 【签名位置】推广域同一字符串要出现在两处：body.crawlerInfo + header.anti-content
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ORIGIN = 'https://yingxiao.pinduoduo.com'
const PAGE_URL = ORIGIN + '/mains/promotionOverview'
const SDK_PATH = path.join(os.homedir(), '.dsh', 'pdd-risk-sdk', 'promo-sdk.mjs')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36'

function fileURLToPath(u) {
  if (typeof u === 'string' && u.startsWith('file:')) return decodeURIComponent(new URL(u).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  return u
}

/** 每个 shopKey 一个常驻浏览器实例 */
const _sessions = new Map()

/**
 * ★ 进程退出兜底：浏览器连接是活跃句柄，不关的话 node 进程**永不退出**
 *   （实测：promo skill 跑完 emit 了结果，但进程挂住不返回）。
 *   exit 事件里不能 await，所以同步杀进程。
 *   ⚠️ 只杀父进程不够 —— Chrome 的 renderer/gpu 子进程会活下来占着 Profile 锁，
 *      下次启动就 `Failed to launch the browser process!`。必须杀整棵树（taskkill /T）。
 */
process.once('exit', () => {
  for (const s of _sessions.values()) {
    const pid = s.browser?.process?.()?.pid
    if (!pid) continue
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }) }
    catch { try { s.browser?.process?.()?.kill?.() } catch { /* ignore */ } }
  }
})

/** 读取本地 promo SDK（剥掉 ESM 导出，改成挂到 window） */
function loadSdkCode() {
  if (!fs.existsSync(SDK_PATH)) return null
  const raw = fs.readFileSync(SDK_PATH, 'utf8')
  return raw
    .replace(/^export default .*$/m, '')
    .replace(/^export const .*$/m, '')
    + '\nwindow.__PROMO_SDK__ = module_.exports.default || module_.exports;'
}

/** 启动（或复用）推广域签名浏览器 */
async function launchBrowser(profileDir, opts) {
  const puppeteer = (await import(pathToFileURL(path.join(PLUGIN_ROOT, 'node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js')).href)).default
  const { clearProfileLocks } = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'skills/_shared/pdd-launch.mjs')).href)
  clearProfileLocks(profileDir)
  // ★ Chrome 被 kill 后不会立刻释放 Profile 目录（Windows 文件句柄延迟），
  //   紧接着再启动会 `Failed to launch the browser process!`。重试 3 次。
  let lastErr = null
  for (let i = 0; i < 3; i++) {
    if (i > 0) {
      await new Promise(r => setTimeout(r, 4000 * i))
      try { clearProfileLocks(profileDir) } catch { /* ignore */ }
    }
    try {
      return await puppeteer.launch({
        executablePath: CHROME,
        userDataDir: profileDir,
        // ★ headless:'new' 也要带反检测 flag：否则 navigator.webdriver=true，指纹自曝
        headless: opts.headless === false ? false : true,
        defaultViewport: { width: 1920, height: 1080 },
        args: [
          '--no-first-run', '--no-default-browser-check', '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--window-size=1920,1080', '--window-position=0,0',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        protocolTimeout: 120000,
      })
    } catch (e) {
      lastErr = e
      const msg = String(e?.message || e)
      if (!/launch|browser process|lock/i.test(msg)) throw e
    }
  }
  throw lastErr
}

export async function initHybridSigner(shopKey, opts = {}) {
  if (!shopKey) throw new Error('initHybridSigner 需要 shopKey')
  const exist = _sessions.get(shopKey)
  if (exist && !exist.dead) {
    // ★ 2026-11-10：**复用前先探活**。
    //   只靠 browser.on('disconnected') 不够 —— Chrome 被强杀（Stop-Process）
    //   或崩溃时这个事件不一定触发，session.dead 仍是 false。
    //   于是复用了一个**已经死掉的 browser 句柄**，后续 CDP 调用直接报
    //   "Protocol error: Connection closed"，表现为 no_channel / 500。
    //   探活失败就丢弃重建。
    try {
      await Promise.race([
        exist.page.evaluate(() => 1),
        new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout')), 3000)),
      ])
      return exist
    } catch {
      try { await exist.browser.close() } catch { /* ignore */ }
      _sessions.delete(shopKey)
      console.warn(`[promo-hybrid] 旧 session 已失效（${shopKey.slice(-12)}），重建浏览器`)
    }
  }

  // ★ Profile 目录按「账号实际用的目录」解析（账号 key 可能因 PASS_ID 轮换而漂移）
  const { resolveProfileDir } = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'skills/_shared/pdd-profile-map.mjs')).href)
  const { dir: profileDir } = await resolveProfileDir(shopKey)
  // ★ 2026-11-10：启动前**先清干净这个 Profile 的残留 Chrome**。
  //   故障现场：session 探活失败 → 重建浏览器 → 旧 Chrome 进程还没退干净
  //   （或上一次被强杀留了孤儿）→ 新实例撞 Profile 锁 →
  //   "Failed to launch the browser process" → no_channel。
  //   清理只针对这个 profile 目录的进程，不动用户自己的 Chrome。
  try {
    const { clearProfileLocks } = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'skills/_shared/pdd-launch.mjs')).href)
    clearProfileLocks(profileDir)
  } catch { /* ignore */ }
  try {
    const { execFileSync } = await import('node:child_process')
    const ps = `
      $want = '${String(profileDir).replace(/'/g, "''").toLowerCase().replace(/\//g, '\\\\')}'
      Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.CommandLine -and $_.CommandLine.ToLower().Replace('/','\\\\') -like "*$want*") {
          try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {}
        }
      }
    `
    execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore', windowsHide: true, timeout: 15000 })
    await new Promise(r => setTimeout(r, 1500))
  } catch { /* ignore */ }

  const browser = await launchBrowser(profileDir, opts)

  const page = (await browser.pages())[0] || await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080 })
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {})
  await new Promise(r => setTimeout(r, 6000))

  const session = { shopKey, browser, page, dead: false }
  _sessions.set(shopKey, session)
  browser.on('disconnected', () => { session.dead = true })
  return session
}

/** 取推广域 cookie（含 _nano_fp / SUB_SYSTEM_ID / SUB_PASS_ID），Node 请求要用 */
export async function getHybridCookies(shopKey, opts = {}) {
  const s = await initHybridSigner(shopKey)
  const cdp = await s.page.target().createCDPSession()
  const all = (await cdp.send('Storage.getCookies')).cookies || []
  const merged = {}
  for (const c of all) {
    // 只留拼多多域下的
    if (!/(^|\.)pinduoduo\.com$/.test(c.domain || '')) continue
    merged[c.name] = c.value
  }
  // ★ 写回凭证库 —— **只补缺的，不覆盖已有的**。
  //   为什么不覆盖：pdd_mms 的 account_id 是从 `PASS_ID` 派生的
  //   （lib/services/credential-store.js → ACCOUNT_ID_FROM.pdd_mms='PASS_ID'），
  //   而 PASS_ID 会轮换。一旦把浏览器的新 PASS_ID 写进凭证库，
  //   `migrateDriftedKeys` 会按新 PASS_ID 重新派生 shop_key → **账号被改名**，
  //   Profile 目录也跟着换 key（登录态还在旧目录里）→ 整套东西对不上。
  //   实测踩过：975543... → 3fa2ee60...。
  //   所以：已有的 Cookie 一律不动（保持账号身份稳定），只补新出现的。
  if (!opts.skipPersist && Object.keys(merged).length >= 5) {
    try {
      const { CredentialStore } = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'lib/services/credential-store.js')).href)
      const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
      const prev = await store.get(shopKey)
      const prevCk = prev?.cookies || {}
      const missing = {}
      for (const [k, v] of Object.entries(merged)) {
        if (prevCk[k] === undefined) missing[k] = v
      }
      if (Object.keys(missing).length) {
        await store.setCookies(shopKey, { ...prevCk, ...missing })
        console.warn(`[promo-hybrid] 凭证库补了 ${Object.keys(missing).length} 个新 Cookie（已存在的保持不变）`)
      }
    } catch (e) {
      console.warn('[promo-hybrid] Cookie 写回凭证库失败（不影响本次请求）：' + String(e?.message || e).slice(0, 80))
    }
  }
  return merged
}

/**
 * 生成推广域签名。
 * @returns {string} 同一个字符串同时用作 body.crawlerInfo 和 header.anti-content
 */
export async function signHybrid(shopKey, opts = {}) {
  const s = await initHybridSigner(shopKey, opts)
  const code = loadSdkCode()
  if (code) {
    const sig = await s.page.evaluate(async (c) => {
      try {
        delete window.__PROMO_SDK__
        const el = document.createElement('script')
        el.textContent = c
        document.documentElement.appendChild(el)
        await new Promise(r => setTimeout(r, 400))
        if (!window.__PROMO_SDK__) return null
        return String(await new window.__PROMO_SDK__({ serverTime: Date.now() }).messagePack())
      } catch (e) { return null }
    }, code).catch(() => null)
    if (sig && sig.length > 100) return sig
  }
  // 兜底：抓页面自己发出的请求上的签名（页面会持续打接口）
  const cdp = await s.page.target().createCDPSession()
  const hits = []
  const handler = (e) => {
    const h = e.request.headers || {}
    const sig = h['Anti-Content'] || h['anti-content']
    if (sig && String(sig).length > 100) hits.push(String(sig))
  }
  cdp.on('Network.requestWillBeSent', handler)
  await cdp.send('Network.enable', {}).catch(() => {})
  await s.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
  await new Promise(r => setTimeout(r, 7000))
  cdp.off?.('Network.requestWillBeSent', handler)
  return hits.length ? hits[hits.length - 1] : ''
}

/**
 * 从 Profile 浏览器**实时取全部拼多多域 Cookie**，并写回凭证库。
 *
 * 【为什么需要】
 *   凭证库里存的是登录时那一份 Cookie 快照，拼多多会话会过期（生:43001/40001），
 *   而 Profile 里的会话是活的（同一个浏览器还在用）。
 *   实测 2026-11-09：凭证库 mms Cookie 已 43001，但同一 Profile 打开推广页正常。
 *   → 从 CDP 取新 Cookie 覆盖回凭证库，mms / yingxiao 两个域同时修好。
 *
 * @returns {Promise<{cookies:object, count:number}|null>}
 */
export async function healCookiesFromProfile(shopKey) {
  const s = await initHybridSigner(shopKey)
  const cdp = await s.page.target().createCDPSession()
  await cdp.send('Network.enable', {}).catch(() => {})
  const all = (await cdp.send('Storage.getCookies')).cookies || []
  const jar = {}
  for (const c of all) {
    if (!/(^|\.)pinduoduo\.com$/.test(c.domain || '')) continue
    if (c.value == null || c.value === '') continue
    jar[c.name] = c.value
  }
  const count = Object.keys(jar).length
  if (count < 5) return null
  const ua = await s.page.evaluate(() => navigator.userAgent).catch(() => null)

  // 写回凭证库（供后续 mms / shop / works 等 skill 直接用）
  // ★ 只补缺、不覆盖 —— 覆盖 PASS_ID 会让账号被重新派生 shop_key（见 getHybridCookies 的注释）
  try {
    const { CredentialStore } = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'lib/services/credential-store.js')).href)
    const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
    const prev = await store.get(shopKey)
    const prevCk = prev?.cookies || {}
    const missing = {}
    for (const [k, v] of Object.entries(jar)) if (prevCk[k] === undefined) missing[k] = v
    if (Object.keys(missing).length) await store.setCookies(shopKey, { ...prevCk, ...missing })
  } catch (e) {
    console.warn('[promo-hybrid] Cookie 写回凭证库失败（不影响本次重试）：' + String(e?.message || e).slice(0, 80))
  }
  return { cookies: jar, count, ua }
}

/** 关闭某个 shopKey 的签名浏览器 */
export async function closeHybridSigner(shopKey) {
  const s = _sessions.get(shopKey)
  if (!s) return
  _sessions.delete(shopKey)
  s.dead = true
  try { await s.browser.close() } catch { /* ignore */ }
}

/**
 * 当前持有几个浏览器（诊断用）。
 * ★ key 可能和调用方以为的不一样：账号 shop_key 会因 PASS_ID 轮换而漂移，
 *   守护进程是按「当时那个 key」预热的。释放时要按**实际持有的 key** 释放，
 *   否则 /release 返回 200 但浏览器没关（Chrome 仍占着 Profile 锁）。
 */
export function listHybridSigners() {
  return Array.from(_sessions.keys()).map(k => ({
    shopKey: k,
    dead: !!_sessions.get(k)?.dead,
    profile: _sessions.get(k)?.profile || null,
  }))
}

/** 关闭全部（进程退出前调用） */
export async function closeAllHybridSigners() {
  for (const k of Array.from(_sessions.keys())) await closeHybridSigner(k)
}

export default { initHybridSigner, signHybrid, getHybridCookies, healCookiesFromProfile, closeHybridSigner, closeAllHybridSigners }
