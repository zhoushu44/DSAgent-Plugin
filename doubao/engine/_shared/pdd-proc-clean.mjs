/**
 * PDD 孤儿 Chrome 进程清理（所有 pdd 技能共用）
 *
 * ══════════════════════════════════════════════════════════════════
 * 背景（2026-10-27 实测）
 * ══════════════════════════════════════════════════════════════════
 * `browser.close()` 只关闭 puppeteer 连接的**主进程**，Chrome 的渲染/GPU/
 * 工具子进程常常不退。它们继续持有 userDataDir 的 SingletonLock，导致下一次
 * `puppeteer.launch(同一 Profile)` 直接报：
 *
 *     Failed to launch the browser process!
 *     TROUBLESHOOTING: https://pptr.dev/troubleshooting
 *
 * 而这个报错**完全指不到真正原因**（既不说"Profile 被占用"，也不说哪个进程），
 * 排查时极易误判成「Chrome 坏了」或「账号被封」。
 *
 * 实测样本：一次 createSession + goto 后，`browser.close()` 之前有 10 个
 * chrome 进程指向同一 Profile（1 主 + 9 子）。用 Get-CimInstance 可全部识别。
 *
 * ══════════════════════════════════════════════════════════════════
 * 安全边界（重要）
 * ══════════════════════════════════════════════════════════════════
 * **只杀同时满足以下两条的进程**：
 *   ① name === 'chrome.exe'
 *   ② 命令行含 `--user-data-dir=<...>` 且该路径指向**我们的** Profile
 *      （调用方传入的 profileFragment）
 *
 * 用户的日常浏览器**不带** `--user-data-dir` 指向我们的目录，因此绝不会被误杀。
 * 传入空 fragment 时直接放弃（宁可漏杀，不可错杀）。
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么用 Get-CimInstance 而不是 wmic
 * ══════════════════════════════════════════════════════════════════
 * `wmic` 在新版 Windows 已是弃用组件（部分版本直接不存在，实测返回
 * "No Instance(s) Available"）。`Get-CimInstance Win32_Process` 是现代替代，
 * 实测可取到 ProcessId + CommandLine。
 */

import { execFileSync, execSync } from 'node:child_process'
import { createRequire } from 'node:module'

// 供 cleanProfileForLaunch 同步删锁文件用
const require = createRequire(import.meta.url)

/**
 * 列出占用指定 Profile 的 chrome 进程 PID。
 *
 * @param {string} profileFragment Profile 路径中足以唯一定位的片段
 *   （如完整 shopKey，或 userDataDir 绝对路径）。传空则返回 []。
 * @returns {number[]} PID 数组（可能为空）
 */
export function findOrphanChromePids(profileFragment) {
  const frag = String(profileFragment || '').trim()
  if (!frag) return []

  // 归一化：把 fragment 与命令行都转成小写 + 统一分隔符，避免 \ vs / 失配
  const needle = frag.toLowerCase().replace(/\//g, '\\')

  let out = ''
  try {
    out = execFileSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 30 * 1024 * 1024 })
  } catch {
    return []
  }

  const pids = []
  for (const line of String(out).split('\n')) {
    const l = line.trim()
    if (!l) continue
    const i = l.indexOf('|')
    if (i < 0) continue
    const pid = Number(l.slice(0, i))
    const cmd = l.slice(i + 1)
    if (!Number.isFinite(pid) || pid <= 0) continue
    // 必须带 --user-data-dir 且指向我们的 Profile
    if (!/--user-data-dir=/i.test(cmd)) continue
    const hay = cmd.toLowerCase().replace(/\//g, '\\')
    if (!hay.includes(needle)) continue
    pids.push(pid)
  }
  return [...new Set(pids)]
}

/**
 * 杀掉占用指定 Profile 的孤儿 chrome 进程。
 *
 * @param {string} profileFragment 同 findOrphanChromePids
 * @param {object} [opts]
 * @param {boolean} [opts.quiet=true] 是否打印日志
 * @returns {{ killed: number[], failed: number[], found: number }}
 */
export function killOrphanChrome(profileFragment, opts = {}) {
  const quiet = opts.quiet !== false
  const pids = findOrphanChromePids(profileFragment)
  const killed = []
  const failed = []
  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { encoding: 'utf8', timeout: 15000, stdio: 'ignore' })
      killed.push(pid)
    } catch {
      // taskkill 对已退出的进程会报错，属正常
      failed.push(pid)
    }
  }
  if (!quiet && (killed.length || failed.length)) {
    console.warn(`[pdd-proc-clean] 清理占用 Profile 的孤儿 chrome：成功 ${killed.length}，失败 ${failed.length}`
      + (failed.length ? `（可能已自行退出：${failed.join(', ')}）` : ''))
  }
  return { killed, failed, found: pids.length }
}

/**
 * 清理 + 删 Profile 锁文件，一步到位。
 * 用于 `puppeteer.launch` 失败后的恢复，或启动前的预防性清理。
 *
 * @param {string} userDataDir Profile 绝对路径
 * @param {object} [opts]
 * @param {boolean} [opts.quiet=true]
 * @returns {{ killed: number[], locksRemoved: string[] }}
 */
export function cleanProfileForLaunch(userDataDir, opts = {}) {
  const quiet = opts.quiet !== false
  const dir = String(userDataDir || '')
  if (!dir) return { killed: [], locksRemoved: [] }

  const { killed } = killOrphanChrome(dir, { quiet })

  const locksRemoved = []
  try {
    const fs = require('node:fs')
    const path = require('node:path')
    for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
      const f = path.join(dir, name)
      try {
        if (fs.existsSync(f)) { fs.rmSync(f, { force: true }); locksRemoved.push(name) }
      } catch { /* 不存在或正被占用 */ }
    }
  } catch { /* ignore */ }

  if (!quiet && (killed.length || locksRemoved.length)) {
    console.warn(`[pdd-proc-clean] ${dir}：杀进程 ${killed.length} 个，删锁 ${locksRemoved.length} 个`)
  }
  return { killed, locksRemoved }
}
