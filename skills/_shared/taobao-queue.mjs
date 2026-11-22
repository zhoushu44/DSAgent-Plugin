/**
 * taobao-queue.mjs —— 同账号串行队列（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要（吸收自 gateway-proxy `withAccountQueue`，官方注释原文）
 * ══════════════════════════════════════════════════════════════════
 *   「同一账号的自动化任务进串行队列（并发 = 1），跨账号并行。
 *     防止同一账号两个并发任务一个在登录窗、一个在用旧 cookie 请求，
 *     互相踩踏导致会话作废。」
 *
 * 实现：每个 shopKey 维护一条 Promise 链（FIFO），
 * 新请求接到链尾，前一个请求 settle（无论成功/失败）后下一个才开始。
 *
 * ★ 与节流的区别（两者不能互相替代）：
 *   节流（taobao-throttle）解决的是「出口频率」，保证两次请求间隔 ≥4~6s；
 *   队列解决的是「并发踩踏」，保证同一账号同一时刻只有 1 个请求在飞。
 *   只有节流没有队列时：两个进程同时拿到时间槽 → 同时发 → 并发踩踏。
 *   只有队列没有节流时：串行但可能连续快发 → 频率过高。
 *   两者都要。
 *
 * ══════════════════════════════════════════════════════════════════
 * 跨进程限制（必须知道）
 * ══════════════════════════════════════════════════════════════════
 *   Promise 链只在**单进程内**有效。基座是 Node 脚本，
 *   每个 `dsagent_execute_skill` 可能起新进程，跨进程的并发只能靠
 *   taobao-throttle 的文件锁近似实现（它保证时间槽不重叠）。
 *   所以：进程内用队列，跨进程靠节流，两者叠加才是完整的。
 */

const accountQueues = new Map()

/**
 * 把异步操作排进指定账号的串行队列
 * @param {string} shopKey
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
export function withAccountQueue(shopKey, fn) {
  const prev = accountQueues.get(shopKey) ?? Promise.resolve()
  // 前驱失败不应阻断后续排队
  const chained = prev.catch(() => {}).then(fn)
  // 链尾回到 settled 后清理，避免 Map 无限增长
  const cleanup = chained.finally(() => {
    if (accountQueues.get(shopKey) === cleanup) accountQueues.delete(shopKey)
  })
  accountQueues.set(shopKey, cleanup)
  return cleanup
}

/** 当前排队情况（排障用） */
export function queueDepth(shopKey) {
  return accountQueues.has(shopKey) ? 1 : 0
}

/** 清空队列记录（进程退出前 / 测试用） */
export function resetQueue() {
  accountQueues.clear()
}

export default { withAccountQueue, queueDepth, resetQueue }
