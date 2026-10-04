/**
 * 授权流程的状态机（operation）—— 把「登录 / 风控验证」这类**需要用户参与、
 * 可能中途停顿、可能超时后继续**的长流程，从「一次调用走到底」改造成
 * 「可查询进度、可续推、可取消」的 operation。
 *
 * ## 为什么需要
 *
 * 改造前：`dsagent_browser_login` 是一个阻塞调用，最长等 15 分钟。中途发生的事
 * （用户还没扫码 / 正在拖滑块 / 扫码完成但无权限 / 超时后窗口仍开着）对模型是**黑盒**：
 *
 *   - 模型无法区分「用户还在操作，请等待」与「卡住了，需要换办法」；
 *   - 超时后虽然窗口不关（FIX-LOG #66 已实现），但「可以继续推」这件事
 *     没有正式表达，只能靠重新调一次登录工具来隐式触发；
 *   - 中途需要的额外动作（补验证码、确认子店铺）没有容身之处。
 *
 * 改造后：每次登录/验证都是一个带 id 的 operation，有明确阶段与状态，
 * 模型可以 poll 看进度、advance 续推、cancel 放弃。
 *
 * ## 与 Accio 的对应关系（本模块的移植来源）
 *
 * Accio 的 managed shop 授权是四段式 REST：
 *
 *   POST /connectors/:id/managed-auth/start
 *   POST /connectors/:id/managed-auth/:operationId/advance
 *   GET  /connectors/:id/managed-auth/:operationId
 *   POST /connectors/:id/managed-auth/:operationId/cancel
 *
 * 本模块把同一套状态机搬到本地（无 HTTP，进程内注册表），语义逐条对齐：
 *
 *   | Accio 的 advance 用途        | 本模块对应                     |
 *   |------------------------------|--------------------------------|
 *   | 提交 Amazon 验证码           | `needs_input` 阶段 + 提交输入  |
 *   | 选 TikTok 子店               | `needs_choice` 阶段 + 提交选择 |
 *   | 重试 Temu 失败区域           | `advance({ action: 'retry' })` |
 *   | 确认绑定                     | `advance({ action: 'confirm' })` |
 *
 * ★ 设计约束（重要）：本模块**不重写** `browser-login.ts` 的登录内核。
 * 那 1200 行里每一条分支都对应一次实测事故（见其 FIX-LOG 注释），
 * 重写的风险远大于收益。因此这里只做「旁挂」：内核通过 `report()` 上报阶段，
 * operation 只负责记录与对外表达。内核逻辑一行未改，回归风险趋近于零。
 */

import * as crypto from 'node:crypto'

// ── 类型 ────────────────────────────────────────────────────

/** operation 类型 */
export type AuthOperationKind = 'login' | 'risk_verify'

/**
 * 流程阶段。
 *
 * 命名刻意对齐「用户视角发生了什么」，而不是内部函数名 ——
 * 模型读到的应当是「正在等你扫码」，而不是「进入 poll 循环第 3 轮」。
 */
export type AuthPhase =
  /** 准备中：起浏览器、准备 Profile */
  | 'launching'
  /** 等待用户操作：扫码 / 拖滑块 / 手机上确认 */
  | 'waiting_user'
  /** 用户已完成操作，正在抓取与校验凭证 */
  | 'capturing'
  /** 需要用户补充输入（验证码等）—— 对应 Accio 的 advance 输入型 */
  | 'needs_input'
  /** 需要用户在多个选项中选一个（如子店铺）—— 对应 Accio 的 advance 选择型 */
  | 'needs_choice'
  /** 成功 */
  | 'succeeded'
  /** 失败（含原因） */
  | 'failed'
  /** 超时（**窗口保持打开，可用 advance 续推**）—— 对应 Accio 的可续推语义 */
  | 'timed_out'
  /** 用户主动取消 */
  | 'cancelled'

/** 终态：不可能再变化 */
const TERMINAL_PHASES: ReadonlySet<AuthPhase> = new Set<AuthPhase>([
  'succeeded', 'failed', 'cancelled',
])

export function isTerminalPhase(p: AuthPhase): boolean {
  return TERMINAL_PHASES.has(p)
}

/** 需要用户介入的阶段（模型应把控制权交还用户，而不是继续等待） */
export function needsUserAction(p: AuthPhase): boolean {
  return p === 'waiting_user' || p === 'needs_input' || p === 'needs_choice'
}

export interface AuthOperation {
  /** operation 主键，模型据此 poll / advance / cancel */
  operationId: string
  kind: AuthOperationKind
  platform: string
  phase: AuthPhase
  /** 面向模型/用户的一句话说明（当前在等什么、为什么失败） */
  message: string
  /** 创建时间（epoch ms） */
  createdAt: number
  /** 最后更新时间（epoch ms） */
  updatedAt: number
  /** 已耗时（秒），便于模型判断是否该放弃 */
  elapsedSec: number
  /** 是否需要用户介入（= needsUserAction(phase) 的冗余字段，方便模型直接读） */
  awaitingUser: boolean
  /** 是否已结束（终态） */
  done: boolean
  /** 是否需要用户补充输入；有值时模型应把 input 通过 advance 传回 */
  inputPrompt?: string
  /** 需要选择时的候选项（对应 Accio 的「选子店」） */
  choices?: Array<{ id: string; label: string }>
  /** 成功时的产物（如 shopKey） */
  result?: Record<string, unknown>
  /** 失败/超时的原因与下一步建议 */
  error?: string
  /** 附带的结构化细节（阶段耗时、探测到的证据等） */
  detail?: Record<string, unknown>
}

/** 内部存储：比对外多记录 cancelled 标记与 advance 回调 */
interface Record_ extends AuthOperation {
  cancelled: boolean
  /** advance 时调用的续推回调（由发起方注册） */
  onAdvance?: (input: { action: string; value?: string }) => Promise<void>
  /** cancel 时调用的清理回调 */
  onCancel?: () => Promise<void>
}

/** 对外快照（剥掉内部回调，避免把函数暴露给调用方） */
function snapshot(r: Record_): AuthOperation {
  return {
    operationId: r.operationId,
    kind: r.kind,
    platform: r.platform,
    phase: r.phase,
    message: r.message,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    elapsedSec: Math.round((Date.now() - r.createdAt) / 1000),
    awaitingUser: needsUserAction(r.phase),
    done: isTerminalPhase(r.phase),
    ...(r.inputPrompt ? { inputPrompt: r.inputPrompt } : {}),
    ...(r.choices ? { choices: r.choices } : {}),
    ...(r.result ? { result: r.result } : {}),
    ...(r.error ? { error: r.error } : {}),
    ...(r.detail ? { detail: r.detail } : {}),
  }
}

// ── 注册表 ──────────────────────────────────────────────────

/** 已完成 operation 的保留时长：便于模型「回过头再查一次」，之后清理防内存泄漏 */
const KEEP_DONE_MS = 30 * 60 * 1000
/** 单类型并发上限：防止模型反复 start 堆积出多个浏览器实例 */
const MAX_LIVE_PER_PLATFORM = 1

const records = new Map<string, Record_>()

function sweep(): void {
  const now = Date.now()
  for (const [id, r] of records) {
    if (isTerminalPhase(r.phase) && now - r.updatedAt > KEEP_DONE_MS) {
      records.delete(id)
    }
  }
}

export interface StartOptions {
  kind: AuthOperationKind
  platform: string
  /** 续推回调：advance 时调用 */
  onAdvance?: (input: { action: string; value?: string }) => Promise<void>
  /** 取消回调：cancel 时调用（应关闭浏览器窗口、释放 Profile 锁） */
  onCancel?: () => Promise<void>
}

/**
 * 创建 operation。
 *
 * 同一平台**复用**未结束的 operation 而不是新建：重复 start（模型重试、用户连点）
 * 会拉起第二个浏览器进程并撞上 Chrome 的 userDataDir 独占锁，
 * 表现为「莫名其妙启动失败」。复用后重复 start 变成幂等的「查看当前进度」。
 */
export function startOperation(opts: StartOptions): AuthOperation {
  sweep()

  const platformKey = `${opts.kind}:${opts.platform}`
  for (const r of records.values()) {
    if (`${r.kind}:${r.platform}` === platformKey && !isTerminalPhase(r.phase)) {
      // 复用：把最初注册的回调补上（若这次调用才提供）
      if (opts.onAdvance) r.onAdvance = opts.onAdvance
      if (opts.onCancel) r.onCancel = opts.onCancel
      r.detail = { ...r.detail, reused: true }
      return snapshot(r)
    }
  }

  // 同平台活跃 operation 数上限（上面已保证同平台最多 1 个，这里防御其他 kind）
  let live = 0
  for (const r of records.values()) {
    if (r.platform === opts.platform && !isTerminalPhase(r.phase)) live++
  }
  if (live >= MAX_LIVE_PER_PLATFORM * 2) {
    throw new Error(`平台 ${opts.platform} 已有 ${live} 个进行中的授权流程，请先 poll 或 cancel 后再开始新的`)
  }

  const now = Date.now()
  const rec: Record_ = {
    operationId: `${opts.kind === 'login' ? 'auth' : 'risk'}_${crypto.randomBytes(8).toString('hex')}`,
    kind: opts.kind,
    platform: opts.platform,
    phase: 'launching',
    message: '正在准备浏览器环境',
    createdAt: now,
    updatedAt: now,
    elapsedSec: 0,
    awaitingUser: false,
    done: false,
    cancelled: false,
    onAdvance: opts.onAdvance,
    onCancel: opts.onCancel,
  }
  records.set(rec.operationId, rec)
  return snapshot(rec)
}

export function getOperation(operationId: string): AuthOperation | null {
  const r = records.get(operationId)
  return r ? snapshot(r) : null
}

/** 列出进行中（或近期结束）的 operation，便于「我上次那个登录到哪了」 */
export function listOperations(filter?: { platform?: string; liveOnly?: boolean }): AuthOperation[] {
  sweep()
  let list = [...records.values()]
  if (filter?.platform) list = list.filter(r => r.platform === filter.platform)
  if (filter?.liveOnly) list = list.filter(r => !isTerminalPhase(r.phase))
  return list.sort((a, b) => b.updatedAt - a.updatedAt).map(snapshot)
}

/**
 * 上报阶段变化（供登录/验证内核调用）。
 *
 * 找不到 operationId 时静默忽略 —— 上报是**旁路**，绝不能让「没登记就上报」
 * 把正在进行的登录流程搞崩。
 */
export function report(
  operationId: string | null | undefined,
  phase: AuthPhase,
  message: string,
  extra?: Partial<Pick<AuthOperation, 'inputPrompt' | 'choices' | 'result' | 'error' | 'detail'>>,
): void {
  if (!operationId) return
  const r = records.get(operationId)
  if (!r) return
  // 已取消或者已到终态：不再接受后续上报（避免「取消后又被内核改成 succeeded」）
  if (r.cancelled && phase !== 'cancelled') return
  if (isTerminalPhase(r.phase) && phase !== r.phase) return

  r.phase = phase
  r.message = message
  r.updatedAt = Date.now()
  if (extra?.inputPrompt !== undefined) r.inputPrompt = extra.inputPrompt
  if (extra?.choices !== undefined) r.choices = extra.choices
  if (extra?.result !== undefined) r.result = extra.result
  if (extra?.error !== undefined) r.error = extra.error
  if (extra?.detail !== undefined) r.detail = { ...r.detail, ...extra.detail }
}

/**
 * 续推一个 operation —— 对应 Accio 的 `advance`。
 *
 * 主要用途：
 *   - `timed_out` 后继续等待（窗口仍开着，用户可能刚扫完）→ `{ action: 'resume' }`
 *   - 提交需要的输入（验证码等）→ `{ action: 'submit', value: '123456' }`
 *   - 在候选中选择（子店铺）→ `{ action: 'choose', value: '<id>' }`
 *   - 确认 → `{ action: 'confirm' }`
 *   - 重试 → `{ action: 'retry' }`
 */
export async function advanceOperation(
  operationId: string,
  input: { action: string; value?: string },
): Promise<{ ok: boolean; operation?: AuthOperation; error?: string }> {
  const r = records.get(operationId)
  if (!r) return { ok: false, error: `未找到授权流程 ${operationId}（可能已过期，请重新发起）` }
  if (r.cancelled) return { ok: false, error: '该授权流程已被取消' }
  if (isTerminalPhase(r.phase)) {
    return { ok: false, error: `该授权流程已结束（${r.phase}），无法继续推进`, operation: snapshot(r) }
  }
  if (!r.onAdvance) {
    return { ok: false, error: '该授权流程不支持续推（缺少续推回调）', operation: snapshot(r) }
  }

  // 需要输入的阶段必须先拿到值，避免内核空等
  if (r.phase === 'needs_input' && !String(input.value ?? '').trim() && input.action !== 'resume') {
    return { ok: false, error: `该流程需要补充输入：${r.inputPrompt || '（未说明）'}`, operation: snapshot(r) }
  }
  if (r.phase === 'needs_choice' && !String(input.value ?? '').trim() && input.action !== 'resume') {
    return {
      ok: false,
      error: `该流程需要选择一个选项：${(r.choices || []).map(c => c.label).join(' / ') || '（未说明）'}`,
      operation: snapshot(r),
    }
  }

  r.updatedAt = Date.now()
  try {
    await r.onAdvance(input)
    return { ok: true, operation: snapshot(r) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    report(operationId, 'failed', `续推失败：${msg}`, { error: msg })
    return { ok: false, error: msg, operation: snapshot(r) }
  }
}

/** 取消 operation，并触发清理回调（关窗、放锁） */
export async function cancelOperation(
  operationId: string,
): Promise<{ ok: boolean; operation?: AuthOperation; error?: string }> {
  const r = records.get(operationId)
  if (!r) return { ok: false, error: `未找到授权流程 ${operationId}` }
  if (isTerminalPhase(r.phase) && !r.cancelled) {
    return { ok: false, error: `该授权流程已结束（${r.phase}）`, operation: snapshot(r) }
  }

  r.cancelled = true
  r.phase = 'cancelled'
  r.message = '已取消'
  r.updatedAt = Date.now()
  r.inputPrompt = undefined
  r.choices = undefined

  if (r.onCancel) {
    try {
      await r.onCancel()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // 取消失败不改变「已取消」语义，但要留痕
      r.detail = { ...r.detail, cancelError: msg }
    }
  }
  return { ok: true, operation: snapshot(r) }
}

/** operation 是否已被取消（内核在长循环里周期性查询，以便及时退出） */
export function isCancelled(operationId: string | null | undefined): boolean {
  if (!operationId) return false
  const r = records.get(operationId)
  return !r || r.cancelled
}

/** 仅供测试：清空注册表 */
export function __resetOperations(): void {
  records.clear()
}

/**
 * 把 operation 快照渲染成给模型看的简短文本。
 *
 * 让模型不必自己去拼字段 —— 尤其是「现在该做什么」。
 */
export function describeOperation(op: AuthOperation): string {
  const head = `[${op.operationId}] ${op.platform} ${op.kind === 'login' ? '登录' : '风控验证'}：${op.message}（阶段=${op.phase}，已耗时 ${op.elapsedSec}s）`
  if (op.done) {
    if (op.phase === 'succeeded') return `${head}\n已完成。`
    return `${head}\n已结束，未成功${op.error ? `：${op.error}` : ''}`
  }
  if (op.phase === 'waiting_user') {
    return `${head}\n请让用户在浏览器窗口中完成操作（扫码 / 滑块验证），随后用 advance action=resume 或重新 poll 查看结果。`
  }
  if (op.phase === 'needs_input') {
    return `${head}\n需要用户提供：${op.inputPrompt || '输入'}。拿到后用 advance action=submit value=<值> 提交。`
  }
  if (op.phase === 'needs_choice') {
    const opts = (op.choices || []).map(c => `${c.id}=${c.label}`).join('，')
    return `${head}\n需要用户在候选中选择：${opts || '（无候选）'}。用 advance action=choose value=<id> 提交。`
  }
  if (op.phase === 'timed_out') {
    return `${head}\n等待超时，但浏览器窗口仍保持打开、登录进度未丢失。若用户现在完成了扫码，用 advance action=resume 继续；否则可 cancel 后重试。`
  }
  return head
}
