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

const SEED_DIR = path.join(os.homedir(), '.dsh', 'pdd-risk-seeds')

function seedPath(shopKey) {
  return path.join(SEED_DIR, `${String(shopKey).replace(/[^\w.-]/g, '_')}.json`)
}

/**
 * 读取种子
 * @returns {{ localStorage: object, sessionStorage: object, savedAt: number } | null}
 */
export function readSeed(shopKey) {
  try {
    const p = seedPath(shopKey)
    if (!fs.existsSync(p)) return null
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (!j || !j.localStorage) return null
    return j
  } catch { return null }
}

/** 写种子 */
export function writeSeed(shopKey, seed) {
  fs.mkdirSync(SEED_DIR, { recursive: true })
  const p = seedPath(shopKey)
  fs.writeFileSync(p, JSON.stringify({
    savedAt: Date.now(),
    ...seed,
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
