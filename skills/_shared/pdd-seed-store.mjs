/**
 * pdd-seed-store.mjs —— localStorage 种子存储（基座）
 *
 * 背景：
 *   纯 Node 生成 PDD 真签名需要 localStorage 种子
 *   （ISLOGIN / MMS-LOGIN-FP / _nano_fp / new_userinfo ...）
 *   账号库 dsagent-accounts.json 是加密的，不能直接塞种子。
 *
 * 所以单独存：~/.dsh/pdd-risk-seeds/<shopKey>.json
 *
 * 种子会过期（_nano_fp 等设备指纹随登录态变化）→ 需要定期刷新
 * 刷新方式：exportSeedFromBrowser() 开一次浏览器导出
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..')

// 凭证库是 CJS —— 同步 require，因为 readSeed() 必须是同步的
let CredentialStore = null
try {
  const require = createRequire(import.meta.url)
  CredentialStore = require(path.join(PLUGIN_ROOT, 'lib', 'services', 'credential-store.js')).CredentialStore
} catch { /* 读不到就退化成「不兜底」 */ }

const SEED_DIR = path.join(os.homedir(), '.dsh', 'pdd-risk-seeds')
/** 插件根（供其它模块兜底解析依赖用，不受 cwd 影响） */
const ROOT_FOR_SEED = PLUGIN_ROOT

function seedPath(shopKey) {
  return path.join(SEED_DIR, `${String(shopKey).replace(/[^\w.-]/g, '_')}.json`)
}

/**
 * 读取种子。
 *
 * ★ 2026-11-10：**账号 key 漂移兜底**。
 *   pdd_mms 的 shop_key 是从 PASS_ID 派生的，而 PASS_ID 会随登录轮换
 *   （实测同一店铺漂过：975543… → 3fa2ee60… → 25f216ca…）。
 *   种子文件按 shop_key 命名 → key 一漂，旧种子就「不存在」了，
 *   表现为「种子过期 / 纯 Node 签名全废」，但其实数据都还在。
 *
 * ⚠️ 兜底**绝不能只按前缀找最新**：同一平台下有多个店铺（空空商行 / 爱绿森 / …），
 *    拿错种子 = 用别的店铺的身份签名，比没有种子更糟。
 *    所以只认「同一店铺」——用种子里的 mallId / 店铺名与凭证库里的账号比对。
 */
export function readSeed(shopKey) {
  try {
    const p = seedPath(shopKey)
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (j && j.localStorage) return j
    }
    // 漂移兜底：只接受「确认是同一店铺」的种子
    const want = ownerOf(shopKey)
    if (!want) return null
    let best = null
    for (const name of fs.readdirSync(SEED_DIR)) {
      if (!name.endsWith('.json')) continue
      if (!name.startsWith(String(shopKey).replace(/_[0-9a-f]{16,}$/i, '_'))) continue
      const f = path.join(SEED_DIR, name)
      try {
        const j = JSON.parse(fs.readFileSync(f, 'utf8'))
        if (!j?.localStorage) continue
        const got = ownerOfSeed(j)
        if (!got || got !== want) continue        // ← 店铺不同 → 绝不借用
        const st = fs.statSync(f)
        if (!best || st.mtimeMs > best.mtime) best = { mtime: st.mtimeMs, seed: j }
      } catch { /* 跳过坏文件 */ }
    }
    return best ? best.seed : null
  } catch { return null }
}

/** 从凭证库取店铺标识（mallId 优先，其次店铺名） */
function ownerOf(shopKey) {
  try {
    const store = new CredentialStore(CRED_FILE)
    const a = store.listAccounts().find(x => x.shop_key === shopKey)
    if (!a) return null
    return String(a.account_meta?.mall_id || a.mall_id || a.display_label || '').trim() || null
  } catch { return null }
}

/** 从种子内容取店铺标识 */
function ownerOfSeed(seed) {
  try {
    const ui = seed.localStorage?.['new_userinfo']
    if (ui) {
      const o = JSON.parse(ui)
      const id = o?.mall_id || o?.mallId || o?.store_id
      if (id) return String(id).trim()
    }
    const fp = seed.localStorage?.['MMS-LOGIN-FP']
    if (fp) {
      const o = JSON.parse(fp)
      const id = o?.mall_id || o?.mallId
      if (id) return String(id).trim()
    }
  } catch { /* ignore */ }
  return null
}

const CRED_FILE = path.join(os.homedir(), '.dsh', 'dsagent-accounts.json')

/**
 * 写种子。
 *
 * ★ 2026-11-09：保留**扩展字段**（promoEnv 等）。
 *   环境画像是「抓一次、用很久」的资产（设备指纹），而 localStorage 种子是
 *   「登录态」产物，会过期要重刷。之前刷新种子直接整体覆盖 → 环境画像被冲掉，
 *   纯 Node 签名立刻退化成无效指纹。
 *   → 刷新时只更新 localStorage/sessionStorage/savedAt，promoEnv 原样留着。
 */
export function writeSeed(shopKey, seed, opts = {}) {
  fs.mkdirSync(SEED_DIR, { recursive: true })
  const p = seedPath(shopKey)
  const prev = (opts.preserve === false) ? null : readSeed(shopKey)
  const keep = {}
  if (prev) {
    for (const k of ['promoEnv', 'promoCookies', 'promoEnvAt']) {
      if (prev[k] !== undefined && seed[k] === undefined) keep[k] = prev[k]
    }
  }
  fs.writeFileSync(p, JSON.stringify({
    savedAt: Date.now(),
    ...seed,
    ...keep,
  }, null, 1), 'utf8')
  return p
}

/** 种子是否存在且未过期（默认 7 天） */
export function isSeedFresh(shopKey, maxAgeMs = 7 * 24 * 3600 * 1000) {
  const s = readSeed(shopKey)
  if (!s) return false
  return Date.now() - (s.savedAt || 0) < maxAgeMs
}

/** 删除种子 */
export function clearSeed(shopKey) {
  try { fs.unlinkSync(seedPath(shopKey)); return true } catch { return false }
}

/** 列出所有种子 */
export function listSeeds() {
  try {
    if (!fs.existsSync(SEED_DIR)) return []
    return fs.readdirSync(SEED_DIR).filter(f => f.endsWith('.json')).map(f => {
      const p = path.join(SEED_DIR, f)
      const st = fs.statSync(p)
      let savedAt = 0
      try { savedAt = JSON.parse(fs.readFileSync(p, 'utf8')).savedAt || 0 } catch { }
      return { shopKey: f.replace(/\.json$/, ''), size: st.size, savedAt }
    })
  } catch { return [] }
}

/**
 * 从浏览器导出种子（需要 puppeteer）
 * @param {object} opts { shopKey, profileDir, chromePath, pageUrl }
 */
export async function exportSeedFromBrowser(opts) {
  const {
    shopKey,
    profileDir,
    chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    pageUrl = 'https://mms.pinduoduo.com/goods/goods_list',
  } = opts
  // ★ 2026-11-19：默认值必须用模块自身定位出的 PLUGIN_ROOT，不能用 process.cwd()。
  //   技能脚本由 skill-service 以 cwd=技能目录 启动（如 skills/pdd-promo），
  //   此时 cwd 下既没有 node_modules/puppeteer-core 也没有 skills/_shared，
  //   于是动态 import 直接抛 "Cannot find module" → 种子永远刷不出来 →
  //   纯 Node 通道降级、只能开浏览器，慢一大截。
  const PLUGIN_ROOT = opts.pluginRoot || ROOT_FOR_SEED

  const { pathToFileURL } = await import('node:url')
  const puppeteer = (await import(pathToFileURL(path.join(PLUGIN_ROOT, 'node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js')).href)).default
  const { clearProfileLocks } = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'skills/_shared/pdd-launch.mjs')).href)

  /**
   * ★★ 2026-11-19 关键修复：种子导出**绝不能复用取数会话的 Profile** ★★
   *
   *   事故链（pdd-shop goods 从 17:23 能跑变成 17:40 后全失败）：
   *     ① 种子被删 → 每次 openTask 都判定「种子缺失」→ 触发 ensureSeed
   *     ② ensureSeed → exportSeedFromBrowser 用**同一个 user-data-dir** 起 headless Chrome
   *     ③ 紧接着 createSession 也用同一个 Profile 起浏览器
   *     ④ 两个 Chrome 抢一个 Profile：后起的页面加载不完整
   *        （实测模块数 687 vs 正常 1186）→ eDaA 不存在 → 签名失败
   *     改成本后台异步后，仍然出现 detached Frame —— 说明后台也一样在抢。
   *
   *   正确做法：种子导出用**独立的临时 Profile 副本**，与取数会话物理隔离。
   *   代价：多一次 Profile 拷贝（几百 MB，几秒），但只在种子缺失时发生一次。
   *   收益：取数会话永远拿到干净、完整的 Profile。
   */
  const srcProfile = profileDir
  if (!srcProfile) {
    return { ok: false, reason: 'seed-export: 缺少 profileDir，跳过（不冒险污染主会话）', localStorage: 0, sessionStorage: 0 }
  }

  let workProfile = srcProfile
  let tempDir = null
  try {
    const fs = await import('node:fs')
    const os = await import('node:os')
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdd-seed-'))
    workProfile = path.join(tempDir, 'profile')
    // 只拷贝登录必需的文件，避免整目录几 GB 的 Cache 拖慢
    fs.mkdirSync(workProfile, { recursive: true })
    const keep = ['Local State', 'Preferences', 'Cookies', 'Login Data', 'Web Data', 'Network']
    for (const name of keep) {
      const src = path.join(srcProfile, name)
      if (!fs.existsSync(src)) continue
      try {
        const dst = path.join(workProfile, name)
        const st = fs.statSync(src)
        if (st.isDirectory()) fs.cpSync(src, dst, { recursive: true })
        else fs.copyFileSync(src, dst)
      } catch { /* 单个文件失败不影响其它 */ }
    }
    // Default/ 子目录里的 Cookies / Local Storage 也要
    const defSrc = path.join(srcProfile, 'Default')
    if (fs.existsSync(defSrc)) {
      const defDst = path.join(workProfile, 'Default')
      fs.mkdirSync(defDst, { recursive: true })
      for (const name of ['Cookies', 'Login Data', 'Web Data', 'Local Storage', 'Session Storage', 'Network']) {
        const src = path.join(defSrc, name)
        if (!fs.existsSync(src)) continue
        try {
          const dst = path.join(defDst, name)
          const st = fs.statSync(src)
          if (st.isDirectory()) fs.cpSync(src, dst, { recursive: true })
          else fs.copyFileSync(src, dst)
        } catch { /* ignore */ }
      }
    }
  } catch (e) {
    return { ok: false, reason: `seed-export: 复制 Profile 失败（${String(e.message).slice(0, 60)}），已跳过以免污染主会话`, localStorage: 0, sessionStorage: 0 }
  }

  clearProfileLocks(workProfile)
  let browser = null
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      userDataDir: workProfile,
      headless: true,
      defaultViewport: null,
      args: ['--no-first-run', '--no-default-browser-check'],
    })
    const page = (await browser.pages())[0] || await browser.newPage()
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await new Promise(s => setTimeout(s, 8000))
    const dump = await page.evaluate(() => {
      const ls = {}, ss = {}
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k) } } catch { }
      try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); ss[k] = sessionStorage.getItem(k) } } catch { }
      return { localStorage: ls, sessionStorage: ss }
    })
    writeSeed(shopKey, dump)
    return { ok: true, localStorage: Object.keys(dump.localStorage).length, sessionStorage: Object.keys(dump.sessionStorage).length }
  } finally {
    try { await browser?.close() } catch { }
    // 清理临时 Profile 副本（失败不影响结果）
    try {
      if (tempDir) {
        const fs = await import('node:fs')
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
      }
    } catch { /* ignore */ }
  }
}

export const SEED_INFO = {
  dir: '~/.dsh/pdd-risk-seeds',
  required: ['ISLOGIN', 'MMS-LOGIN-FP', '_nano_fp', 'new_userinfo', 'mms.pmm.did.2'],
  freshness: '7 天',
  note: '种子过期会导致纯 Node 签名失效，需重新 exportSeedFromBrowser',
}
