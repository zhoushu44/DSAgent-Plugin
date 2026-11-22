/**
 * terminate-guard.mjs —— Node 侧「优雅终止」钩子（2026-11-19）
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么需要
 * ═══════════════════════════════════════════════════════════════════════
 * 事故：拼多多推广技能连续失败 30+ 次，全部报「技能 60 秒无输出，按 idle 超时终止」。
 *
 * 表面看是超时，实际是**清理链断了**：
 *   看门狗用 SIGKILL 杀进程 → SIGKILL 捕获不到 → 脚本的 finally /
 *   process.on('exit') 全部不执行 → 账号锁文件留在磁盘上 →
 *   下一次调用读到残留锁，等 300s 且期间无输出 → 又被杀 → 死循环。
 *
 * 修复的基座一侧（skill-service.ts）已改为：软阈值只告警、硬阈值优雅终止。
 * 但**优雅终止在 Windows 上不能靠信号**：
 *   实测 Node 在 Windows 里 child.kill('SIGTERM') 走 TerminateProcess，
 *   子进程的 process.on('SIGTERM') 处理器根本不会执行。
 *
 * 所以改成**协议式退出**：父进程往子进程 stdin 写一行
 *   __DSAGENT_TERMINATE__
 * 子进程（本模块）读到 → 执行已注册清理 → 正常退出 143。
 * stdin 管道在 Windows / POSIX 上都可靠，这是唯一真正跨平台的方案。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 用法（技能脚本顶部一行即可）
 * ═══════════════════════════════════════════════════════════════════════
 *   import { installTerminateGuard, onTerminate } from './_shared/terminate-guard.mjs'
 *   installTerminateGuard()                       // 幂等
 *   onTerminate(() => releaseLock())              // 可选：注册清理动作
 *
 * 不注册也能用：进程退出时 process.on('exit') 会兜住同步清理。
 */

import process from 'node:process'

export const TERMINATE_SENTINEL = '__DSAGENT_TERMINATE__'

const handlers = []
let installed = false

/** 注册清理函数（同步执行；要异步清理请在函数内自行处理） */
export function onTerminate(fn) {
  if (typeof fn === 'function') handlers.push(fn)
}

function runHandlers() {
  for (const fn of handlers) {
    try { fn() } catch { /* 清理失败不能掩盖真实退出原因 */ }
  }
}

/**
 * 安装钩子（幂等）。返回本次是否真的装上。
 * @param {{ watchStdin?: boolean }} [opts]
 */
export function installTerminateGuard(opts = {}) {
  if (installed) return false
  installed = true

  // 正常退出路径的兜底（对 SIGKILL 无效，但能覆盖正常结束与异常退出）
  process.on('exit', runHandlers)

  // POSIX 下 SIGTERM/SIGINT 是真信号，能收到；Windows 下装上也无害
  for (const sig of ['SIGTERM', 'SIGINT']) {
    try {
      process.on(sig, () => {
        runHandlers()
        process.exit(sig === 'SIGINT' ? 130 : 143)
      })
    } catch { /* 平台不支持该信号 */ }
  }

  const watchStdin = opts.watchStdin !== false
  if (!watchStdin || !process.stdin) return true

  // 终端交互场景不抢输入
  try {
    if (process.stdin.isTTY) return true
  } catch { /* isTTY 读取失败按非 TTY 处理 */ }

  try {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      buf += chunk
      // 逐行检查，允许一次读到多行
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (line === TERMINATE_SENTINEL) {
          runHandlers()
          try { process.stderr.write('[terminate-guard] 收到终止指令，已清理并退出\n') } catch { /* ignore */ }
          process.exit(143)
        }
      }
    })
    // 没有数据时不要阻止进程退出
    process.stdin.on('error', () => { /* ignore */ })
    if (typeof process.stdin.unref === 'function') process.stdin.unref()
    process.stdin.resume()
  } catch { /* stdin 不可用（比如被重定向成文件）—— 忽略 */ }

  return true
}

export default { installTerminateGuard, onTerminate, TERMINATE_SENTINEL }
