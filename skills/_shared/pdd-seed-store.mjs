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
  const PLUGIN_ROOT = opts.pluginRoot || process.cwd()

  const { pathToFileURL } = await import('node:url')
  const puppeteer = (await import(pathToFileURL(path.join(PLUGIN_ROOT, 'node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js')).href)).default
  const { clearProfileLocks } = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'skills/_shared/pdd-launch.mjs')).href)

  clearProfileLocks(profileDir)
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    userDataDir: profileDir,
    headless: true,
    defaultViewport: null,
    args: ['--no-first-run', '--no-default-browser-check'],
  })
  try {
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
    try { await browser.close() } catch { }
  }
}

export const SEED_INFO = {
  dir: '~/.dsh/pdd-risk-seeds',
  required: ['ISLOGIN', 'MMS-LOGIN-FP', '_nano_fp', 'new_userinfo', 'mms.pmm.did.2'],
  freshness: '7 天',
  note: '种子过期会导致纯 Node 签名失效，需重新 exportSeedFromBrowser',
}
