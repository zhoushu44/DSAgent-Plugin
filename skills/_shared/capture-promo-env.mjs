/**
 * capture-promo-env.mjs —— 推广域环境画像抓取器
 *
 * 用法：
 *   node skills/_shared/capture-promo-env.mjs <shopKey>
 *   node skills/_shared/capture-promo-env.mjs --all
 *
 * 做什么：
 *   1. 用账号 Profile 开一次浏览器（固定视口，保证几何可复现）
 *   2. 打开 yingxiao.pinduoduo.com/mains/promotionOverview
 *   3. 抓 document.cookie / referrer / storage / window.name / navigator / screen /
 *      window 几何 / canvas 指纹 / webgl renderer / plugins
 *   4. 注入本地 promo-sdk.mjs 跑一遍，让 SDK 真正绘制 canvas（指纹才抓得到）
 *   5. 写回 ~/.dsh/pdd-risk-seeds/<shopKey>.json 的 promoEnv 字段
 *
 * 之后纯 Node 签名只需 applyEnvProfile(win, seed.promoEnv) 即可复现同样签名。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PLUGIN_ROOT = process.cwd()
const CHROME = process.env.PDD_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PROMO_URL = 'https://yingxiao.pinduoduo.com/mains/promotionOverview'
const VIEWPORT = { width: 1920, height: 1080 }

const imp = (rel) => import(pathToFileURL(path.join(PLUGIN_ROOT, rel)).href)

export async function capturePromoEnv(shopKey, opts = {}) {
  const { readSeed, writeSeed } = await imp('skills/_shared/pdd-seed-store.mjs')
  const { captureEnvProfile, PROFILE_VERSION } = await imp('skills/_shared/pdd-env-profile.mjs')
  const { clearProfileLocks } = await imp('skills/_shared/pdd-launch.mjs')
  const puppeteer = (await import(pathToFileURL(path.join(PLUGIN_ROOT,
    'node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js')).href)).default

  const profileDir = opts.profileDir || path.join(os.homedir(), '.dsh', 'browser-profiles', 'accounts', shopKey)
  const SDK_FILE = opts.sdkFile || path.join(os.homedir(), '.dsh', 'pdd-risk-sdk', 'promo-sdk.mjs')

  clearProfileLocks(profileDir)
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    userDataDir: profileDir,
    // ★ 必须 headed：headless 的 screen 是 800×600、navigator.webdriver 是 true，
    //   抓到这种画像等于自曝自动化，签名会被判无效
    headless: opts.headless === true,
    defaultViewport: VIEWPORT,
    args: ['--no-first-run', '--no-default-browser-check', '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080', '--window-position=0,0'],
    ignoreDefaultArgs: ['--enable-automation'],
    protocolTimeout: 120000,
  })
  try {
    const page = (await browser.pages())[0] || await browser.newPage()
    await page.setViewport(VIEWPORT)
    await page.goto(PROMO_URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await new Promise(r => setTimeout(r, 12000))

    // ① 环境画像（同时挂上 canvas 捕获钩子）
    const profile = await captureEnvProfile(page, { url: page.url() })

    // ② 跑一遍本地 SDK，让它真正绘制 canvas（指纹此时才产生）
    let sdkRan = false
    try {
      const raw = fs.readFileSync(SDK_FILE, 'utf8')
      const code = raw.replace(/^export default .*$/m, '').replace(/^export const .*$/m, '')
        + '\nwindow.__PROMO_SDK__ = module_.exports.default || module_.exports;'
      const out = await page.evaluate(async (c) => {
        try {
          delete window.__PROMO_SDK__
          const s = document.createElement('script'); s.textContent = c
          document.documentElement.appendChild(s)
          await new Promise(r => setTimeout(r, 1200))
          const SDK = window.__PROMO_SDK__
          if (typeof SDK !== 'function') return { err: 'SDK 加载失败' }
          const sig = String(await new SDK({ serverTime: Date.now() }).messagePack())
          return { len: sig.length }
        } catch (e) { return { err: String(e && e.message || e).slice(0, 200) } }
      }, code)
      sdkRan = !out.err
      profile.sdkSigLen = out.len || null
      profile.sdkErr = out.err || null
    } catch (e) { profile.sdkErr = String(e.message).slice(0, 150) }

    // ③ 读取 SDK 运行期间抓到的 canvas 指纹
    try {
      const list = await page.evaluate(() => (window.__PDD_CANVAS_LIST__ || []).slice(0, 12))
      if (Array.isArray(list) && list.length) profile.canvas = list
    } catch (e) { }

    // ③b 读取 SDK 实际探测的 canPlayType 类型（关键：类型名是混淆串，预置列表覆盖不全）
    try {
      const probes = await page.evaluate(() => (window.__PDD_MEDIA_PROBES__ || []).slice(0, 40))
      if (Array.isArray(probes) && probes.length) {
        profile.media = profile.media || {}
        for (const p of probes) {
          if (p && p.type && profile.media[p.type] === undefined) profile.media[p.type] = p.result
        }
        profile.mediaProbes = probes
      }
    } catch (e) { }

    // ④ 合并写回种子
    const seed = readSeed(shopKey) || { localStorage: {}, sessionStorage: {} }
    seed.promoEnv = profile
    seed.promoEnv.version = PROFILE_VERSION
    seed.promoEnv.sdkRan = sdkRan
    const p = writeSeed(shopKey, seed)

    return {
      ok: true, path: p, shopKey,
      cookie: String(profile.doc?.cookie || '').slice(0, 60),
      referrer: profile.doc?.referrer,
      localStorage: Object.keys(profile.storage?.localStorage || {}).length,
      sessionStorage: Object.keys(profile.storage?.sessionStorage || {}).length,
      windowName: String(profile.win?.name || '').slice(0, 40),
      plugins: profile.nav?.plugins?.length || 0,
      canvas: (profile.canvas || []).length,
      webgl: profile.webgl?.renderer?.slice(0, 60) || null,
      sdkRan, sdkSigLen: profile.sdkSigLen,
    }
  } finally {
    try { await browser.close() } catch { }
  }
}

/* ── CLI ── */
if (process.argv[1] && process.argv[1].endsWith('capture-promo-env.mjs')) {
  const { CredentialStore } = await imp('lib/services/credential-store.js')
  const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
  const accounts = store.listAccounts().filter(a => a.platform === 'pdd_mms')
  let targets = []
  const arg = process.argv[2]
  if (!arg || arg === '--all') targets = accounts.map(a => a.shop_key)
  else if (arg === '--list') {
    console.log('可用 pdd_mms 账号：')
    accounts.forEach(a => console.log(`  ${a.shop_key}  ${a.display_label || ''}`))
    process.exit(0)
  } else targets = [arg]

  for (const shopKey of targets) {
    console.log(`\n═══ 抓取 ${shopKey} ═══`)
    try {
      const r = await capturePromoEnv(shopKey)
      console.log(JSON.stringify(r, null, 1))
    } catch (e) {
      console.log(`  ❌ ${String(e && e.message || e).slice(0, 200)}`)
    }
  }
  process.exit(0)
}

export default capturePromoEnv
