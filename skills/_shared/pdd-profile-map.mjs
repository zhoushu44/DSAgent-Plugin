/**
 * pdd-profile-map.mjs —— 拼多多**浏览器 Profile 目录解析**（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要（2026-11-10 实测踩坑）
 * ══════════════════════════════════════════════════════════════════
 *
 * 拼多多商家后台的凭证库 key（shop_key）是从 `PASS_ID` 派生的：
 *   credential-store.js → ACCOUNT_ID_FROM.pdd_mms = 'PASS_ID'
 *   PASS_ID 会随登录轮换 → store 的 migrateDriftedKeys 会按新 PASS_ID
 *   **重新派生 shop_key**（实测：975543fcd3e… → 3fa2ee60c6b9…）。
 *
 * 但浏览器 Profile 目录是按 shop_key 命名的：
 *   ~/.dsh/browser-profiles/accounts/<shop_key>
 *
 * → key 一漂，**登录态（旧 Profile）和账号（新 key）对不上**：
 *   - 用新 key 找 Profile → 找到空目录 → 像是没登录
 *   - 用旧 key 找 Profile → 登录态在，但账号列表里已经没有这个 key
 *
 * 本模块解决这个：
 *   · 维护一张 **shop_key → 实际 Profile 目录** 的映射表（落盘）
 *   · 解析时：映射表 → 默认目录 → **自动发现**（同账号的其他 key 目录）
 *   · 解析成功就记住映射，下次直接命中
 *
 * 用法：
 *   const { resolveProfileDir } = await import('.../pdd-profile-map.mjs')
 *   const dir = await resolveProfileDir(shopKey)
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.join(os.homedir(), '.dsh', 'browser-profiles', 'accounts')
const MAP_FILE = path.join(os.homedir(), '.dsh', 'pdd-profile-map.json')

function readMap() {
  try { return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')) || {} } catch { return {} }
}
function writeMap(m) {
  try {
    fs.mkdirSync(path.dirname(MAP_FILE), { recursive: true })
    fs.writeFileSync(MAP_FILE, JSON.stringify(m, null, 1), 'utf8')
  } catch { /* ignore */ }
}

/** 记住某个 shop_key 实际用的 Profile 目录 */
export function rememberProfile(shopKey, dir) {
  if (!shopKey || !dir) return
  const m = readMap()
  if (m[shopKey] === dir) return
  m[shopKey] = dir
  writeMap(m)
}

/** 目录是不是一个「像样的」Profile（有 Chrome 的 Default 配置） */
function looksLikeProfile(dir) {
  try {
    if (!dir || !fs.existsSync(dir)) return false
    const d = path.join(dir, 'Default')
    if (!fs.existsSync(d)) return false
    return fs.existsSync(path.join(d, 'Preferences')) || hasSession(dir) > 0
  } catch { return false }
}

/**
 * 目录里有没有登录态（Cookie 库体积）。
 * ★ 路径要兼容两种：
 *   旧版 Chrome：Default/Cookies
 *   新版 Chrome（≥ 96）：Default/Network/Cookies
 *   只查旧路径会永远得到 0 → 把有登录态的 Profile 误判成空壳。
 */
function hasSession(dir) {
  try {
    const paths = [
      path.join(dir, 'Default', 'Network', 'Cookies'),
      path.join(dir, 'Default', 'Cookies'),
    ]
    let best = 0
    for (const f of paths) {
      if (!fs.existsSync(f)) continue
      const sz = fs.statSync(f).size
      if (sz > best) best = sz
    }
    return best
  } catch { return 0 }
}

/**
 * 建目录联接（Windows junction）：<link> → <target>
 * 目的：账号 key 漂移后，**所有**按 shop_key 拼 Profile 路径的代码
 *   （分散在十几个 skill 里）都能自动落到真正有登录态的那个目录，不用逐个改。
 * 非 Windows / 无权限时静默跳过（alias 映射表仍然生效）。
 */
function ensureJunction(link, target) {
  try {
    if (!fs.existsSync(target)) return false
    if (fs.existsSync(link)) {
      try {
        const st = fs.lstatSync(link)
        // 已经是联接/软链就复用
        if (st.isSymbolicLink()) return true
      } catch { /* ignore */ }
      return false   // 是真实目录 → 不动（可能是有用的独立 Profile）
    }
    fs.mkdirSync(path.dirname(link), { recursive: true })
    const { execFileSync } = require('node:child_process')
    execFileSync('cmd', ['/c', 'mklink', '/J', link, target], { stdio: 'ignore', windowsHide: true })
    return true
  } catch { return false }
}

/**
 * 解析某个账号实际该用的 Profile 目录。
 *
 * 顺序：
 *   ① 映射表里记住的（且目录还在）
 *   ② 默认目录 <shop_key>（存在且像样）
 *   ③ **自动发现**：同前缀的其他 key 目录里，找 Cookies 最大（登录态最全）的那个
 *      → 记住映射 → 返回
 *   ④ 都没有 → 默认目录（调用方会新建）
 *
 * @param {string} shopKey
 * @param {object} opts
 * @param {boolean} [opts.create] 找不到时是否创建默认目录（默认 true）
 * @param {boolean} [opts.junction] 自动发现后是否建联接（默认 true）
 * @returns {Promise<{dir:string, source:string, sessionBytes:number}>}
 */
export async function resolveProfileDir(shopKey, opts = {}) {
  const create = opts.create !== false
  const defaultDir = path.join(ROOT, String(shopKey))

  // ① 映射表
  const m = readMap()
  if (m[shopKey] && fs.existsSync(m[shopKey])) {
    return { dir: m[shopKey], source: 'alias', sessionBytes: hasSession(m[shopKey]) }
  }

  // ② 默认目录（有登录态才认）
  if (looksLikeProfile(defaultDir) && hasSession(defaultDir) > 0) {
    return { dir: defaultDir, source: 'default', sessionBytes: hasSession(defaultDir) }
  }
  // ②' 默认目录存在但**没有会话** → 多半是账号 key 漂移后留下的空壳
  //    （新 key → 新建目录 → 从没登录过）。这种情况不能直接用，
  //    否则表现为「账号在、登录态没了」。
  const staleShell = looksLikeProfile(defaultDir) && hasSession(defaultDir) === 0

  // ③ 自动发现：同前缀（pdd_mms_）的其他 key 目录
  try {
    const prefix = String(shopKey).startsWith('pdd_mms_') ? 'pdd_mms_' : String(shopKey).slice(0, 12)
    const cands = fs.readdirSync(ROOT)
      .filter(n => n.startsWith(prefix) && n !== String(shopKey))
      .map(n => path.join(ROOT, n))
      .filter(d => looksLikeProfile(d))
      .map(d => ({ d, size: hasSession(d), mtime: safeMtime(d) }))
      .filter(x => x.size > 0)
      .sort((a, b) => (b.size - a.size) || (b.mtime - a.mtime))
    if (cands.length) {
      rememberProfile(shopKey, cands[0].d)
      // 建联接 → 分散在各 skill 里按 shop_key 拼路径的代码也能命中
      if (opts.junction !== false) {
        if (staleShell) {
          // 空壳目录挡着联接 → 删掉它（没有会话数据，删了不丢登录态）
          try {
            fs.rmSync(defaultDir, { recursive: true, force: true })
          } catch { /* 删不掉就跳过联接 */ }
        }
        ensureJunction(defaultDir, cands[0].d)
      }
      return { dir: cands[0].d, source: 'discovered', sessionBytes: cands[0].size }
    }
  } catch { /* ignore */ }

  // ④ 新建
  if (create) {
    try { fs.mkdirSync(defaultDir, { recursive: true }) } catch { /* ignore */ }
  }
  return { dir: defaultDir, source: 'new', sessionBytes: 0 }
}

function safeMtime(p) {
  try { return fs.statSync(p).mtimeMs } catch { return 0 }
}

/** 当前映射（诊断用） */
export function profileMap() {
  const m = readMap()
  const out = {}
  for (const [k, v] of Object.entries(m)) out[k] = { dir: v, exists: fs.existsSync(v), sessionBytes: hasSession(v) }
  return out
}

export default { resolveProfileDir, rememberProfile, profileMap, PROFILE_ROOT: ROOT }
