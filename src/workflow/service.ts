/**
 * 工作流核心服务（host 半区）。
 *
 * 需求文档：docs/workflow-requirements.md（第五~八章）。
 * 职责：模板扫描/校验/CRUD、任务 CRUD/持久化、执行引擎（经 executeSkill 引用调
 * executeSkillCore 完整链路：账号注入/网关三件套/Cookie 注入）、浏览器互斥锁、重启对账。
 *
 * 物理隔离：全部逻辑收在本文件，index.ts 只传引用进来。
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { detectEntry, parseArgString, type SkillRow } from '../services/skill-service.js'
import { loadContract, buildContractArgv, type SkillContract } from '../services/arguments.js'
import type {
  WorkflowSchedule,
  WorkflowInputDef,
  WorkflowStep,
  WorkflowTemplate,
  WorkflowTemplateSummary,
  WorkflowTask,
  WorkflowTaskFilter,
  RoundRecord,
  CreateWorkflowTaskPayload,
  StepSkillInfo,
} from './types.ts'

/* ─────────────── 常量 ─────────────── */

/** 轮次错误摘要截断长度（需求 7.2）—— 提升到 2000 以减少根因丢失 */
const ERROR_MAX = 2000
/** 环境级失败：重试无意义，该轮记失败并直接 abort 整个任务（需求 5.4） */
const ENV_FAILURE_KINDS = new Set(['token_expired', 'risk_control', 'not_bound'])
/** 标准化日志单条最大字符数（超长截断）—— 提升到 1000 以保留完整 traceback */
const LOG_LINE_MAX = 1000
/** 每轮最多保留的日志条数（超出尾部截断）—— 提升到 200 以减少前序日志丢弃 */
const LOGS_PER_ROUND = 200

/* ─────────────── 依赖注入接口 ─────────────── */

/** 技能服务子集（index.ts 传入 skill 实例，本文件不自行创建） */
export interface WorkflowSkillApi {
  list(opts?: { onlyEnabled?: boolean }): Promise<SkillRow[]>
  get(id: string): Promise<SkillRow | null>
}

/**
 * 技能执行引用 = index.ts 的 executeSkillCore（完整链路：平台解析→账号绑定拦截→
 * 网关三件套→Cookie 注入→skill.run）。引擎绝不直接调 skill.run —— 那不带账号注入。
 */
export type ExecuteSkillFn = (opts: {
  skillId: string
  requestStr: string
  explicitArgs?: string[]
  chosenShopKey: string
  agentId: string
  fromContract: boolean
  invokedTool: string
  contractArgs?: Record<string, unknown>
}) => Promise<any>

export interface WorkflowServiceDeps {
  /** 技能服务（skill.get / skill.list） */
  skill: WorkflowSkillApi
  /** executeSkillCore 引用（index.ts 定义后传入） */
  executeSkill: ExecuteSkillFn
  /** 模板目录：skills/workflows/ */
  workflowDir: string
  /** 任务存储：{storePath}/workflow-tasks.json */
  tasksPath: string
}

/* ─────────────── 小工具 ─────────────── */

function nowIso(): string {
  return new Date().toISOString()
}

/** 截断错误摘要到 500 字符（需求 7.2） */
function clipError(msg: string): string {
  const s = (msg || '').trim()
  return s.length > ERROR_MAX ? s.slice(0, ERROR_MAX) + '…' : s
}

/** 截断日志行到指定长度 */
function clipLog(msg: string): string {
  const s = (msg || '').trim()
  return s.length > LOG_LINE_MAX ? s.slice(0, LOG_LINE_MAX) + '…' : s
}

/** 格式化时间为 HH:mm:ss */
function timeStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 生成标准化日志行。
 * 格式：[HH:mm:ss] 第N轮 步骤「名」(skill) ✓成功 4200ms | 摘要
 *       [HH:mm:ss] 第N轮 步骤「名」(skill) ✗失败 [failureKind] 摘要
 */
function buildLogLine(
  round: number,
  stepName: string,
  skillId: string,
  ok: boolean,
  durationMs: number,
  message: string,
  failureKind?: string,
): string {
  const status = ok ? '✓成功' : '✗失败'
  const kind = ok ? '' : `[${failureKind || 'skill_error'}] `
  const msg = ok ? ` ${clipLog(message)}` : ` ${kind}${clipLog(message)}`
  return `[${timeStr()}] 第${round}轮 步骤「${stepName}」(${skillId}) ${status} ${durationMs}ms${msg}`
}

/** 模板名 → 文件名（过滤非法字符，需求 7.4「名称」校验） */
function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').trim() || '_'
}

/** YAML → 模板对象（宽松解析，字段级校验在 validateTemplate） */
function parseTemplateYaml(text: string): WorkflowTemplate {
  const raw = parse(text)
  if (raw == null || typeof raw !== 'object') throw new Error('YAML 内容为空或不是对象')
  const obj = raw as Record<string, unknown>
  const t: WorkflowTemplate = {
    name: String(obj.name ?? '').trim(),
    mode: obj.mode === 'single' ? 'single' : 'batch',
    steps: [],
  }
  if (obj.category != null) t.category = String(obj.category)
  if (obj.count_input != null) t.count_input = String(obj.count_input)
  if (obj.description != null) t.description = String(obj.description)
  // ★ 定期执行配置（只需间隔分钟数）
  if (obj.schedule && typeof obj.schedule === 'object' && !Array.isArray(obj.schedule)) {
    const sc = obj.schedule as Record<string, unknown>
    const out: WorkflowSchedule = { enabled: Boolean(sc.enabled) }
    if (sc.intervalMinutes !== undefined) out.intervalMinutes = Number(sc.intervalMinutes)
    if (sc.lastRunAt != null) out.lastRunAt = String(sc.lastRunAt)
    if (sc.nextRunAt != null) out.nextRunAt = String(sc.nextRunAt)
    t.schedule = out
  }
  if (Array.isArray(obj.inputs)) {
    t.inputs = (obj.inputs as Record<string, unknown>[]).map((it) => {
      const d = { key: String(it.key ?? ''), label: String(it.label ?? ''), type: 'text' as const }
      const def: WorkflowInputDef = {
        key: d.key,
        label: d.label,
        type: normalizeInputType(it.type),
      }
      if (it.default !== undefined) def.default = it.default as string | number
      if (it.required !== undefined) def.required = Boolean(it.required)
      if (it.min !== undefined) def.min = Number(it.min)
      if (it.max !== undefined) def.max = Number(it.max)
      if (Array.isArray(it.options)) def.options = it.options.map((o) => String(o))
      return def
    })
  }
  if (Array.isArray(obj.steps)) {
    t.steps = (obj.steps as Record<string, unknown>[]).map((it) => {
      const s: WorkflowStep = {
        name: String(it.name ?? '').trim(),
        skill: String(it.skill ?? '').trim(),
      }
      if (it.args && typeof it.args === 'object' && !Array.isArray(it.args)) {
        s.args = Object.fromEntries(
          Object.entries(it.args as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
        )
      }
      if (it.output != null) s.output = String(it.output)
      if (it.on_failure === 'abort') s.on_failure = 'abort'
      return s
    })
  }
  return t
}

function normalizeInputType(v: unknown): WorkflowInputDef['type'] {
  const s = String(v ?? 'text')
  return s === 'number' || s === 'textarea' || s === 'select' || s === 'date' ? s : 'text'
}

/** `{{}}` 变量引用提取：返回所有被引用的变量名（不含大括号） */
function extractRefs(value: string): string[] {
  const out: string[] = []
  const re = /\{\{\s*([^}]+?)\s*\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(value)) !== null) out.push(m[1])
  return out
}

/* ─────────────── 模板校验（需求 7.4，六项） ─────────────── */

/**
 * 六项校验：名称非空 / 步骤技能存在且 enabled / 排除 instructions 入口 /
 * batch 时 count_input 指向 number 输入 / 输出变量唯一且不与输入冲突 / args 引用有效。
 * 返回 issues 列表（空数组 = 通过）。
 */
export async function validateTemplate(
  t: WorkflowTemplate,
  ctx: { skillRows: Map<string, SkillRow>; existingNames?: Set<string>; isRenameOf?: string },
): Promise<string[]> {
  const issues: string[] = []

  // 1. 名称非空且合法（作为文件名）；唯一性由 saveTemplate 结合「重名覆盖」语义处理
  if (!t.name) issues.push('模板名称不能为空')
  if (t.name && /[\\/:*?"<>|]/.test(t.name)) issues.push(`模板名称含非法字符：${t.name}`)

  // 2 & 3. 步骤技能存在、enabled、非 instructions 入口型
  for (let i = 0; i < t.steps.length; i++) {
    const s = t.steps[i]
    const no = i + 1
    if (!s.name) issues.push(`第 ${no} 个步骤缺少名称`)
    if (!s.skill) {
      issues.push(`第 ${no} 个步骤（${s.name || '未命名'}）未选择技能`)
      continue
    }
    const row = ctx.skillRows.get(s.skill)
    if (!row) {
      issues.push(`第 ${no} 个步骤的技能「${s.skill}」不存在`)
      continue
    }
    if (!row.enabled) issues.push(`第 ${no} 个步骤的技能「${s.skill}」已停用`)
    const entry = detectEntry(row.dir, row.id, row.body)
    if (entry.form === 'instructions') {
      issues.push(`第 ${no} 个步骤的技能「${s.skill}」是纯指令型（无可执行入口），不能作为步骤`)
    }
  }

  // 4. batch 完整性
  const inputs = t.inputs ?? []
  if (t.mode === 'batch') {
    if (!t.count_input) {
      issues.push('执行模式为 batch 时必须指定数量字段（count_input）')
    } else {
      const def = inputs.find((x) => x.key === t.count_input)
      if (!def) issues.push(`数量字段「${t.count_input}」不在输入变量中`)
      else if (def.type !== 'number') issues.push(`数量字段「${t.count_input}」必须是 number 类型`)
    }
  }

  // 5. 输出变量唯一、不与输入 key 冲突
  const inputKeys = new Set(inputs.map((x) => x.key))
  const outputSeen = new Set<string>()
  for (const s of t.steps) {
    if (!s.output) continue
    if (inputKeys.has(s.output)) issues.push(`输出变量「${s.output}」与输入变量同名`)
    if (outputSeen.has(s.output)) issues.push(`输出变量「${s.output}」重复`)
    outputSeen.add(s.output)
  }

  // 6. args 引用有效：输入 / loop.* / 上游步骤输出（.raw 任意字段）
  const stepOutputs = new Set<string>()
  for (let i = 0; i < t.steps.length; i++) {
    const s = t.steps[i]
    for (const [k, v] of Object.entries(s.args ?? {})) {
      for (const ref of extractRefs(v)) {
        const reason = describeRef(ref, inputKeys, stepOutputs)
        if (reason) issues.push(`第 ${i + 1} 个步骤参数「${k}」引用了不存在的变量 {{${ref}}}（${reason}）`)
      }
    }
    if (s.output) stepOutputs.add(s.output)
  }

  return issues
}

/** 校验单个引用是否有效；有效返回 null，无效返回原因 */
function describeRef(ref: string, inputKeys: Set<string>, stepOutputs: Set<string>): string | null {
  if (ref === 'loop.index' || ref === 'loop.total' || ref === 'loop.round_ok') return null
  if (inputKeys.has(ref)) return null
  // step.output_field / step.raw —— 只校验步骤输出名部分
  const dot = ref.indexOf('.')
  if (dot > 0) {
    const base = ref.slice(0, dot)
    if (stepOutputs.has(base)) return null
  }
  if (stepOutputs.has(ref)) return null
  return '可用：输入变量 / loop.index / loop.total / loop.round_ok / 上游步骤输出'
}

/* ─────────────── 浏览器互斥锁（全局单例队列） ─────────────── */

/**
 * 全局浏览器锁：不同任务可并发，但浏览器自动化类技能共享单例浏览器，必须排队。
 * promise 队列实现（与技能执行同进程，无需跨进程锁）。
 */
function createBrowserLock() {
  let queue: Promise<unknown> = Promise.resolve()
  return {
    /** 排队并执行 fn；同一时刻只有一个浏览器步骤在跑 */
    async run<T>(fn: () => Promise<T>): Promise<T> {
      // 上一个 job 完成后才执行 fn；错误不传染给后续 job
      const job = queue.then(fn)
      queue = job.catch(() => undefined)
      return job as Promise<T>
    },
  }
}

/* ─────────────── 服务实现 ─────────────── */

export function createWorkflowService(deps: WorkflowServiceDeps) {
  const { skill, executeSkill, workflowDir, tasksPath } = deps
  const browserLock = createBrowserLock()

  /** 并发任务上限：超出数量的任务排队等待 */
  const MAX_CONCURRENT_TASKS = 3
  const runningTasks = new Set<string>()

  /** 尝试启动排队的任务（在 MAX_CONCURRENT_TASKS 限制内） */
  async function tryStartQueuedTasks(): Promise<void> {
    if (runningTasks.size >= MAX_CONCURRENT_TASKS) return
    await loadTasks()
    const queued = (tasks ?? []).filter(t => t.status === 'queued' && !stopFlags.has(t.id))
    for (const t of queued) {
      if (runningTasks.size >= MAX_CONCURRENT_TASKS) break
      if (runningTasks.has(t.id)) continue
      runningTasks.add(t.id)
      void runTask(t.id)
    }
  }

  /* ── 模板 CRUD ── */

  /** 扫描 skills/workflows/*.yaml → 模板摘要列表 */
  async function listTemplates(): Promise<WorkflowTemplateSummary[]> {
    if (!existsSync(workflowDir)) return []
    const files = (await readdir(workflowDir)).filter((f) => f.toLowerCase().endsWith('.yaml') || f.toLowerCase().endsWith('.yml'))
    const out: WorkflowTemplateSummary[] = []
    for (const f of files) {
      try {
        const t = parseTemplateYaml(await readFile(join(workflowDir, f), 'utf8'))
        out.push({
          name: t.name || f.replace(/\.ya?ml$/i, ''),
          category: t.category || '自定义',
          mode: t.mode,
          description: t.description || '',
          inputCount: (t.inputs ?? []).length,
          stepCount: t.steps.length,
          scheduleEnabled: Boolean(t.schedule?.enabled),
          scheduleInterval: t.schedule?.intervalMinutes ?? null,
          nextRunAt: t.schedule?.nextRunAt,
        })
      } catch (e) {
        // 单个坏文件不拖垮整个列表；编排页仍能看到文件名并修复
        out.push({ name: f.replace(/\.ya?ml$/i, ''), category: '解析失败', mode: 'batch', description: e instanceof Error ? e.message : String(e), inputCount: 0, stepCount: 0 })
      }
    }
    return out
  }

  /**
   * 按名称定位模板文件：优先 safeFileName(name).yaml（saveTemplate 写入的命名），
   * 否则扫描目录匹配文件内 name: 字段（历史模板文件名与模板名不一致时仍可打开/删除/执行）。
   */
  async function findTemplateFile(name: string): Promise<string | null> {
    const direct = join(workflowDir, safeFileName(name) + '.yaml')
    if (existsSync(direct)) return direct
    if (!existsSync(workflowDir)) return null
    const files = (await readdir(workflowDir)).filter((f) => /\.ya?ml$/i.test(f))
    for (const f of files) {
      try {
        const t = parseTemplateYaml(await readFile(join(workflowDir, f), 'utf8'))
        if (t.name === name) return join(workflowDir, f)
      } catch { /* 坏文件跳过 */ }
    }
    return null
  }

  /** 读取单个模板（解析后对象；找不到返回 null） */
  async function getTemplate(name: string): Promise<WorkflowTemplate | null> {
    const file = await findTemplateFile(name)
    if (!file) return null
    return parseTemplateYaml(await readFile(file, 'utf8'))
  }

  /** 读取模板 YAML 原文（导入/导出与编辑器加载用） */
  async function getTemplateYaml(name: string): Promise<string | null> {
    const file = await findTemplateFile(name)
    if (!file) return null
    return readFile(file, 'utf8')
  }

  /**
   * 保存模板：YAML 解析 → 六项校验 → 写入 skills/workflows/{name}.yaml。
   * 重名覆盖（需求 7.3 save_workflow_template 语义）。返回 issues（空 = 成功）。
   * originalName 用于重命名场景：若与新名不同，删除旧名对应文件。
   */
  async function saveTemplate(yamlText: string, originalName?: string): Promise<{ ok: boolean; name?: string; issues?: string[] }> {
    let t: WorkflowTemplate
    try {
      t = parseTemplateYaml(yamlText)
    } catch (e) {
      return { ok: false, issues: [`YAML 解析失败：${e instanceof Error ? e.message : String(e)}`] }
    }
    const rows = await skill.list()
    const skillRows = new Map(rows.map((r) => [r.id, r]))
    const issues = await validateTemplate(t, { skillRows })
    if (issues.length) return { ok: false, issues }
    if (!existsSync(workflowDir)) await mkdir(workflowDir, { recursive: true })
    const newFile = join(workflowDir, safeFileName(t.name) + '.yaml')
    // 校验通过的模板按规范顺序重排 YAML（inputs → steps 字段顺序稳定，编辑器预览一致）
    const ordered = {
      name: t.name,
      category: t.category,
      mode: t.mode,
      count_input: t.count_input,
      description: t.description,
      schedule: t.schedule,
      inputs: t.inputs,
      steps: t.steps,
    }
    await writeFile(newFile, stringify(ordered), 'utf8')
    // 重命名场景：删除旧名对应文件
    if (originalName && originalName !== t.name) {
      const oldFile = await findTemplateFile(originalName)
      if (oldFile && oldFile !== newFile) {
        try { unlinkSync(oldFile) } catch { /* 静默 */ }
      }
    }
    return { ok: true, name: t.name }
  }

  /** 删除模板文件 */
  async function deleteTemplate(name: string): Promise<{ ok: boolean; error?: string }> {
    const file = await findTemplateFile(name)
    if (!file) return { ok: false, error: `模板不存在：${name}` }
    try {
      unlinkSync(file)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /* ── 任务 CRUD ── */

  let tasks: WorkflowTask[] | null = null
  let loadPromise: Promise<void> | null = null

  /** 读盘（懒加载 + 并发去重）。已加载后用内存副本，不重读磁盘（避免并发写盘竞态）。文件坏损时重置为空数组，不让插件起不来 */
  async function loadTasks(): Promise<void> {
    if (tasks !== null) return
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      if (!existsSync(tasksPath)) {
        tasks = []
        return
      }
      try {
        const raw = parse(await readFile(tasksPath, 'utf8'))
        tasks = Array.isArray(raw) ? (raw as WorkflowTask[]) : []
      } catch {
        tasks = []
      }
    })()
    try {
      await loadPromise
    } finally {
      // 完成后清空，使下次调用重新从磁盘读取
      loadPromise = null
    }
  }

  /** 落盘（每轮/状态变化后即时持久化，重启不丢进度）。并发写串行化防文件撕裂 */
  let writeChain: Promise<void> = Promise.resolve()
  async function persistTasks(): Promise<void> {
    if (!tasks) return
    const snapshot = JSON.stringify(tasks, null, 2)
    writeChain = writeChain
      .then(async () => {
        const dir = join(tasksPath, '..')
        if (!existsSync(dir)) await mkdir(dir, { recursive: true })
        await writeFile(tasksPath, snapshot, 'utf8')
      })
      .catch((e) => {
        // 单次写盘失败不阻断后续 persistTasks（避免链断裂后永久失效）
        console.warn(`[dsagent] 工作流任务落盘失败：${e instanceof Error ? e.message : String(e)}`)
      })
    return writeChain
  }

  /** 任务列表（服务端过滤，需求 7.3） */
  async function listTasks(filter?: WorkflowTaskFilter): Promise<WorkflowTask[]> {
    await loadTasks()
    let rows = [...(tasks ?? [])].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    const f = filter ?? {}
    if (f.status) rows = rows.filter((t) => t.status === f.status)
    if (f.shop) rows = rows.filter((t) => t.shop === f.shop)
    if (f.fromDate) {
      const from = new Date(f.fromDate).getTime()
      if (!Number.isNaN(from)) rows = rows.filter((t) => new Date(t.startedAt).getTime() >= from)
    }
    if (f.toDate) {
      const to = new Date(f.toDate).getTime()
      if (!Number.isNaN(to)) rows = rows.filter((t) => new Date(t.startedAt).getTime() <= to + 86_399_999)
    }
    return rows
  }

  async function getTaskDetail(taskId: string): Promise<WorkflowTask | null> {
    await loadTasks()
    return (tasks ?? []).find((t) => t.id === taskId) ?? null
  }

  /** 删除任务记录（仅允许终态任务） */
  async function deleteTask(taskId: string): Promise<{ ok: boolean; error?: string }> {
    await loadTasks()
    const task = (tasks ?? []).find((t) => t.id === taskId)
    if (!task) return { ok: false, error: `任务不存在：${taskId}` }
    if (task.status === 'running' || task.status === 'queued') {
      return { ok: false, error: '运行中的任务不可删除，请先停止' }
    }
    tasks = (tasks ?? []).filter((t) => t.id !== taskId)
    await persistTasks()
    return { ok: true }
  }

  /** 输入摘要：`关键词：连衣裙；数量：50`（列表展示用，需求 7.2） */
  function buildInputSummary(t: WorkflowTemplate, inputs: Record<string, string | number>): string {
    const parts: string[] = []
    for (const def of t.inputs ?? []) {
      const v = inputs[def.key]
      if (v === undefined || v === null || String(v) === '') continue
      parts.push(`${def.label || def.key}：${v}`)
    }
    return parts.join('；') || '（无输入）'
  }

  /**
   * 创建任务：校验必填/min/max/枚举 → 生成 queued 记录 → 异步启动引擎。
   * 返回 taskId（校验失败抛 Error，由 api 层转 HTTP 错误）。
   */
  async function createTask(payload: CreateWorkflowTaskPayload): Promise<string> {
    const t = await getTemplate(payload.workflowName)
    if (!t) throw new Error(`工作流不存在：${payload.workflowName}`)
    const inputs: Record<string, string | number> = { ...(payload.inputs ?? {}) }

    // 输入校验：required / number min-max / select 枚举；缺省值补齐
    for (const def of t.inputs ?? []) {
      let v = inputs[def.key]
      if ((v === undefined || v === null || String(v).trim() === '') && def.default !== undefined) {
        v = def.default
        inputs[def.key] = v
      }
      const sv = v === undefined ? '' : String(v).trim()
      if (def.required && sv === '') throw new Error(`缺少必填输入「${def.label || def.key}」`)
      if (sv === '') continue
      if (def.type === 'number') {
        const n = Number(sv)
        if (Number.isNaN(n)) throw new Error(`输入「${def.label || def.key}」必须是数字`)
        if (def.min !== undefined && n < def.min) throw new Error(`输入「${def.label || def.key}」不能小于 ${def.min}`)
        if (def.max !== undefined && n > def.max) throw new Error(`输入「${def.label || def.key}」不能大于 ${def.max}`)
        inputs[def.key] = n
      }
      if (def.type === 'select' && def.options?.length && !def.options.includes(sv)) {
        throw new Error(`输入「${def.label || def.key}」取值非法：${sv}（可选：${def.options.join(' / ')}）`)
      }
    }

    const target = t.mode === 'batch'
      ? (() => {
          const def = (t.inputs ?? []).find((x) => x.key === t.count_input)
          const n = Number(inputs[t.count_input ?? ''])
          if (!def || !Number.isFinite(n) || n < 1) throw new Error(`数量字段「${t.count_input}」必须是 ≥1 的整数`)
          return Math.floor(n)
        })()
      : 1

    await loadTasks()
    const task: WorkflowTask = {
      id: `wf_task_${Date.now()}_${Math.floor(Math.random() * 1e4)}`,
      workflowName: t.name,
      shop: payload.shop ?? null,
      inputs,
      inputSummary: buildInputSummary(t, inputs),
      status: 'queued',
      success: 0,
      failed: 0,
      target,
      current: 0,
      startedAt: nowIso(),
      finishedAt: null,
      error: null,
      rounds: [],
    }
    tasks!.unshift(task)
    await persistTasks()

    // 异步启动（HTTP 响应不等待执行；受 MAX_CONCURRENT_TASKS 限制）
    tryStartQueuedTasks()
    return task.id
  }

  /** 置停止标志：当前步骤跑完后停止，不强杀子进程（需求 5.3） */
  const stopFlags = new Set<string>()
  async function stopTask(taskId: string): Promise<boolean> {
    const task = await getTaskDetail(taskId)
    if (!task) return false
    if (task.status === 'running' || task.status === 'queued') {
      stopFlags.add(taskId)
      // queued 任务尚未被引擎拾取 → 直接落 stopped
      if (task.status === 'queued') {
        task.status = 'stopped'
        task.finishedAt = nowIso()
        await persistTasks()
      }
      return true
    }
    return false
  }

  /* ── 执行引擎 ── */

  /**
   * 变量渲染：`{{input}}` / `{{loop.index}}` / `{{loop.total}}` / `{{step.field}}` / `{{step.raw}}`。
   * 未命中引用原样保留（模板校验已挡住无效引用；运行期宽松，避免整轮因拼写全废）。
   */
  function renderValue(value: string, ctx: RunCtx): string {
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, ref: string) => {
      const v = resolveRef(ref, ctx)
      return v === undefined ? `{{${ref}}}` : v
    })
  }

  /** 解析单引用 → 字符串值；找不到返回 undefined（renderValue 原样保留） */
  function resolveRef(ref: string, ctx: RunCtx): string | undefined {
    if (ref === 'loop.index') return String(ctx.loopIndex)
    if (ref === 'loop.total') return String(ctx.loopTotal)
    if (ref === 'loop.round_ok') return String(ctx.roundOk)
    if (Object.prototype.hasOwnProperty.call(ctx.inputs, ref)) return String(ctx.inputs[ref])
    const dot = ref.indexOf('.')
    if (dot > 0) {
      const base = ref.slice(0, dot)
      const field = ref.slice(dot + 1)
      const out = ctx.stepOutputs.get(base)
      if (out === undefined) return undefined
      if (field === 'raw') return out.raw
      if (out.fields && Object.prototype.hasOwnProperty.call(out.fields, field)) return out.fields[field]
      // 未声明字段的步骤输出：允许链式取值（如 obj.list.0），取不到回退 raw
      const deep = deepGet(out.data, field.split('.'))
      return deep === undefined || deep === null ? out.raw : String(deep)
    }
    const out = ctx.stepOutputs.get(ref)
    return out ? out.raw : undefined
  }

  interface StepOutput {
    /** 步骤是否成功（executeSkillCore result.ok） */
    ok: boolean
    /** 失败摘要，格式 `[failureKind] 文案`（需求 5.4：类型透传进轮次 error） */
    error: string
    /** 环境级失败（token_expired/risk_control/not_bound）：该轮记失败并 abort 整个任务 */
    envFailure: boolean
    /** `{{step.raw}}` 的值：executeSkillCore 返回的 text（成功）或失败摘要 */
    raw: string
    /** 结构化字段：payload（成功时）→ JSON 字符串值 */
    fields: Record<string, string> | null
    /** 原始 payload 对象（供链式取值） */
    data: unknown
  }

  interface RunCtx {
    inputs: Record<string, string | number>
    loopIndex: number
    loopTotal: number
    /** 本轮是否成功（随步骤执行动态更新，供后置步骤引用） */
    roundOk: boolean
    /** 步骤输出变量 → 结果（每轮重置） */
    stepOutputs: Map<string, StepOutput>
  }

  /** 深取值：obj.a.b.0（数字段名转数组下标） */
  function deepGet(obj: unknown, path: string[]): unknown {
    let cur: unknown = obj
    for (const seg of path) {
      if (cur == null) return undefined
      if (Array.isArray(cur)) {
        const i = Number(seg)
        if (Number.isNaN(i)) return undefined
        cur = cur[i]
      } else if (typeof cur === 'object') {
        cur = (cur as Record<string, unknown>)[seg]
      } else {
        return undefined
      }
    }
    return cur
  }

  /**
   * 浏览器类技能判定：platform 非 common 或 capability 含浏览器相关分类。
   * crawl/publish/login/browser 字样与平台绑定均视为占用浏览器。
   */
  function isBrowserSkill(row: SkillRow): boolean {
    if (row.platform && row.platform !== 'common') return true
    if (row.capability === 'connector' || row.capability === 'browser') return true
    return /crawl|publish|login|browser/i.test(row.id)
  }

  /** 步骤执行 → executeSkillCore。契约技能走 buildContractArgv，非契约拼 args 字符串 */
  async function runStep(step: WorkflowStep, ctx: RunCtx, task: WorkflowTask): Promise<StepOutput> {
    const row = await skill.get(step.skill)
    const renderedArgs: Record<string, string> = {}
    for (const [k, v] of Object.entries(step.args ?? {})) renderedArgs[k] = renderValue(v, ctx)

    const contract = row?.dir ? loadContract(row.dir) : null
    let explicitArgs: string[] | undefined
    let fromContract = false
    let contractArgs: Record<string, unknown> | undefined
    let requestStr: string

    if (contract) {
      // 契约路径（与 buildContractTool 同构）：argv + fromContract=true
      const argv = buildContractArgv(contract, renderedArgs)
      explicitArgs = argv
      fromContract = true
      contractArgs = renderedArgs
      requestStr = Object.entries(renderedArgs)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
    } else {
      // 非契约路径（与 dsagent_execute_skill 同构）：拼 argv 字符串 → parseArgString
      // 含空格、引号、冒号等特殊字符的值需双引号包裹，内部双引号转义
      const needsQuote = (v: string) => /[\s"'`:;#{}$&|<>]/.test(v)
      const argvText = Object.entries(renderedArgs)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => (needsQuote(v) ? `--${k} "${v.replace(/"/g, '\\"')}"` : `--${k} ${v}`))
        .join(' ')
      explicitArgs = argvText ? parseArgString(argvText) : undefined
      requestStr = `${step.name}：${argvText || task.workflowName}`
    }

    const invoke = () => executeSkill({
      skillId: step.skill,
      requestStr: requestStr || step.name,
      explicitArgs,
      chosenShopKey: task.shop ?? '',
      agentId: 'default',
      fromContract,
      invokedTool: 'dsagent_workflow',
      contractArgs,
    })

    // 浏览器类技能全局互斥；纯计算类不受限
    const result: any = row && isBrowserSkill(row) ? await browserLock.run(invoke) : await invoke()

    const ok = Boolean(result?.ok)
    // 失败类型透传（需求 5.4）：脚本自报 failureKind 优先；看门狗超时（消息含「超时」）归类 time_out
    let failureKind = ok ? '' : String(result?.failureKind || '')
    if (!ok && !failureKind) {
      failureKind = isWatchdogTimeout(result) ? 'time_out' : 'skill_error'
    }
    const payload = result?.payload

    const fields: Record<string, string> | null =
      payload != null && typeof payload === 'object' && !Array.isArray(payload) && (payload as Record<string, unknown>).mode !== 'instructions'
        ? Object.fromEntries(Object.entries(payload as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)]))
        : null
    const failText = clipError(String(result?.message || result?.text || result?.stderr || (failureKind ? `[${failureKind}]` : '未知错误')))
    return {
      ok,
      error: ok ? '' : `[${failureKind}] ${failText}`,
      envFailure: !ok && ENV_FAILURE_KINDS.has(failureKind),
      // ★ 日志优先用「人类可读结论」而不是整包 JSON
      //   技能返回的 payload 里通常有 text 字段（一屏结论/表格）
      //   没有 text 时回退到 result.text（可能是整包 JSON 字符串）
      raw: ok ? pickReadableText(payload, result?.text) : failText,
      fields,
      data: payload ?? null,
    }
  }

  /**
   * ★ 从 payload 里取「人类可读结论」用于日志展示
   *
   *   技能脚本的 payload 形状不统一：
   *     · 有的直接 { ok, mode, text: '一屏结论...' }
   *     · 有的是整包 JSON 序列化进 result.text
   *   这里按优先级取：payload.text → payload.message → 解析 result.text 里的 .text → 原始文本
   */
  function pickReadableText(payload: unknown, fallback: unknown): string {
    const p = payload as Record<string, unknown> | null | undefined
    if (p && typeof p === 'object') {
      const t = p.text ?? p.message ?? p.summaryText
      if (typeof t === 'string' && t.trim()) return t
    }
    // fallback 可能是整包 JSON 字符串，尝试解析出 .text
    const raw = String(fallback ?? '')
    if (raw.startsWith('{')) {
      try {
        const j = JSON.parse(raw) as Record<string, unknown>
        const t = j.text ?? j.message
        if (typeof t === 'string' && t.trim()) return t
      } catch { /* 不是 JSON，原样返回 */ }
    }
    return raw
  }

  /** 引擎级超时判定：executeSkillCore 底层 skill.run 看门狗消息含「超时」/「idle 超时」/英文 timeout */
  function isWatchdogTimeout(result: any): boolean {
    const msg = `${result?.message ?? ''} ${result?.text ?? ''}`.toLowerCase()
    return msg.includes('超时') || msg.includes('timeout') || msg.includes('timed out')
  }

  /**
   * 执行任务（异步，createTask 触发，不 await 引擎全程）。
   * 串行轮次 → 每轮串行步骤；stopRequested 每步后检查；环境级失败直接 abort。
   */
  async function runTask(taskId: string): Promise<void> {
    const task = await getTaskDetail(taskId)
    if (!task || task.status !== 'queued') {
      stopFlags.delete(taskId)
      return
    }
    if (stopFlags.has(taskId)) {
      task.status = 'stopped'
      task.finishedAt = nowIso()
      await persistTasks()
      stopFlags.delete(taskId)
      return
    }
    const t = await getTemplate(task.workflowName)
    if (!t) {
      task.status = 'failed'
      task.error = `工作流模板已不存在：${task.workflowName}`
      task.finishedAt = nowIso()
      await persistTasks()
      stopFlags.delete(taskId)
      return
    }

    task.status = 'running'
    await persistTasks()

    try {
      for (let round = 1; round <= task.target; round++) {
        if (stopFlags.has(taskId)) {
          task.status = 'stopped'
          task.finishedAt = nowIso()
          await persistTasks()
          return
        }
        task.current = round
        await persistTasks()

        const startedMs = Date.now()
        const ctx: RunCtx = {
          inputs: task.inputs,
          loopIndex: round,
          loopTotal: task.target,
          roundOk: true,
          stepOutputs: new Map(),
        }
        let roundError: string | null = null
        let envAbort = false
        let roundOk = true
        const roundLogs: string[] = []

        for (let i = 0; i < t.steps.length; i++) {
          const step = t.steps[i]
          // 停止请求：当前步骤跑完即停，本轮不记成绩（需求 5.3：不强杀子进程）
          if (stopFlags.has(taskId)) {
            task.status = 'stopped'
            task.finishedAt = nowIso()
            await persistTasks()
            return
          }
          const stepStartMs = Date.now()
          const stepResult = await executeStepSafe(step, ctx, task)
          const stepDuration = Date.now() - stepStartMs
          // 记录标准化日志行（成功与失败均记）
          roundLogs.push(buildLogLine(
            round, step.name, step.skill,
            stepResult.ok, stepDuration,
            stepResult.ok ? stepResult.raw : stepResult.error,
            stepResult.ok ? undefined : (stepResult.error.match(/^\[([\w-]+)\]/)?.[1]),
          ))
          if (step.output) ctx.stepOutputs.set(step.output, stepResult)
          if (!stepResult.ok) {
            roundOk = false
            ctx.roundOk = false
            roundError = stepResult.error
            // 环境级失败 / on_failure=abort：终止整个任务；continue=跳到下一轮（需求 5.3）
            if (stepResult.envFailure || (step.on_failure ?? 'continue') === 'abort') {
              envAbort = true
              break
            }
            break // continue 策略：本轮作废，进入下一轮
          }
        }
        ctx.roundOk = roundOk

        const durationMs = Date.now() - startedMs
        const rec: RoundRecord = {
          index: round,
          status: roundOk ? 'ok' : 'failed',
          durationMs,
          error: roundOk ? null : roundError,
          logs: roundLogs.slice(-LOGS_PER_ROUND),
        }
        if (roundOk) task.success++
        else task.failed++
        task.rounds.push(rec)
        await persistTasks()

        if (envAbort) {
          task.status = 'failed'
          task.error = roundError
          task.finishedAt = nowIso()
          await persistTasks()
          return
        }
      }
      task.status = 'completed'
      task.finishedAt = nowIso()
      await persistTasks()
    } catch (e) {
      // 引擎级异常 → failed（需求六章：failed = 任务异常终止）
      task.status = 'failed'
      task.error = clipError(e instanceof Error ? e.message : String(e))
      task.finishedAt = nowIso()
      await persistTasks()
    } finally {
      stopFlags.delete(taskId)
      runningTasks.delete(taskId)
      // 任务结束后尝试启动排队的任务
      tryStartQueuedTasks()
    }
  }

  /** 单步执行的安全包装：异常/失败统一收敛为 {ok, error, envFailure} */
  async function executeStepSafe(
    step: WorkflowStep,
    ctx: RunCtx,
    task: WorkflowTask,
  ): Promise<{ ok: boolean; error: string; envFailure: boolean; raw: string; fields: Record<string, string> | null; data: unknown }> {
    try {
      const output = await runStep(step, ctx, task)
      return {
        ok: output.ok,
        error: output.error,
        envFailure: output.envFailure,
        raw: output.raw,
        fields: output.fields,
        data: output.data,
      }
    } catch (e) {
      const isErr = e instanceof Error
      const msg = clipError(isErr ? e.message : String(e))
      const stack = isErr && e.stack ? clipError(e.stack) : ''
      const error = stack ? `${msg}\n--- stack ---\n${stack}` : msg
      return { ok: false, error, envFailure: false, raw: msg, fields: null, data: null }
    }
  }

  /* ── 重启对账（需求 5.3：孤儿 running/queued → failed） ── */
  async function reconcile(): Promise<void> {
    await loadTasks()
    let dirty = false
    for (const task of tasks ?? []) {
      if (task.status === 'running' || task.status === 'queued') {
        task.status = 'failed'
        task.error = '插件重启，任务中断'
        task.finishedAt = nowIso()
        dirty = true
      }
    }
    if (dirty) await persistTasks()
  }

  /* ── 编排页技能清单（host 侧过滤 instructions 型后下发） ── */

  /**
   * 汇总契约参数表：顶层 args + 各子命令 args（编排页下拉展示全部可填参数，
   * 与执行引擎 buildContractArgv 的可见范围一致；hidden 参数不下发）。
   */
  function collectContractArgs(input: NonNullable<SkillContract['input']>): StepSkillInfo['contractArgs'] {
    const out: NonNullable<StepSkillInfo['contractArgs']> = []
    const push = (list: Array<{ name: string; type?: string; required?: boolean; description?: string; choices?: string[]; hidden?: boolean; default?: string | number | boolean }>) => {
      for (const a of list) {
        if (a.hidden) continue
        const item = {
          name: a.name,
          type: a.type ?? 'string',
          required: Boolean(a.required),
          description: a.description ?? '',
          ...(a.choices ? { choices: a.choices } : {}),
          ...(a.default !== undefined ? { default: a.default } : {}),
        }
        out.push(item)
      }
    }
    push(input.args ?? [])
    for (const sub of input.subcommands ?? []) push(sub.args ?? [])
    return out.length ? out : null
  }

  async function listStepSkills(): Promise<StepSkillInfo[]> {
    const rows = await skill.list({ onlyEnabled: true })
    const out: StepSkillInfo[] = []
    for (const row of rows) {
      const entry = detectEntry(row.dir, row.id, row.body)
      if (entry.form === 'instructions') continue
      const contract = loadContract(row.dir)
      out.push({
        id: row.id,
        name: row.name,
        description: row.description || '',
        platform: row.platform || 'common',
        browser: isBrowserSkill(row),
        contractArgs: contract?.input
          ? collectContractArgs(contract.input)
          : null,
        outputFields: contract?.output?.fields ?? null,
      })
    }
    return out
  }

  /**
   * ★ 按模板名直接创建并启动一个任务（供调度器/自动化调用）
   */
  async function runTemplate(
    name: string,
    inputs: Record<string, string> = {},
    opts: { shop?: string } = {},
  ): Promise<{ taskId: string }> {
    const task = await createTask({ workflowName: name, inputs, ...(opts.shop ? { shop: opts.shop } : {}) })
    const taskId = (task as { id?: string; taskId?: string })?.id ?? (task as { taskId?: string })?.taskId
    if (!taskId) throw new Error('创建任务失败：未返回 taskId')
    void runTask(taskId).catch(() => {})
    return { taskId }
  }
  return {
    listTemplates,
    getTemplate,
    getTemplateYaml,
    saveTemplate,
    deleteTemplate,
    listTasks,
    getTaskDetail,
    deleteTask,
    createTask,
    stopTask,
    runTask,
    runTemplate,
    reconcile,
    listStepSkills,
  }
}

export type WorkflowService = ReturnType<typeof createWorkflowService>
