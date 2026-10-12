/**
 * 工作流 API 层（host 半区）。
 *
 * 需求文档：docs/workflow-requirements.md（5.5 / 7.3 / 第八章）。
 * 职责：
 *   1. registerWorkflowApi → handleAction：统一处理 workflow_ 前缀的 HTTP action
 *      （index.ts handler 只加一行前缀分发，全部委托到这里）
 *   2. buildWorkflowTool：生成 dsagent_workflow 工具定义（模型/智能体的对话入口）
 * 两者共用同一个 service，不重复实现业务逻辑。
 *
 * 物理隔离：本文件不 import index.ts；工具定义的 defineTool 包装与 render
 * 渲染函数由 index.ts 接线时传入/套上（保持单一出口的序列化清洗）。
 */
import type { ToolDefinition, ToolOutput } from '@deepseek-ai/dsh-tools'
import type { WorkflowService } from './service.ts'
import type { WorkflowTask, WorkflowTaskFilter, WorkflowTaskStatus } from './types.ts'

/* ─────────────── 常量 ─────────────── */

/** 合法任务状态（list_workflow_tasks 的 status 筛选白名单，非法值忽略不过滤） */
const TASK_STATUSES = new Set<string>(['queued', 'running', 'completed', 'failed', 'stopped'])

/** 工具 tasks action 默认返回的最近任务条数（防回传文本过长） */
const TOOL_TASKS_LIMIT = 20

/** 工具任务详情里最多列出的失败轮条数 */
const TOOL_FAILED_ROUNDS_LIMIT = 20

/* ─────────────── HTTP action 处理（需求 7.3） ─────────────── */

export interface WorkflowApi {
  /** 统一入口：action 为 workflow_ 前缀的完整 action 名，payload 为 body 除 action 外的字段 */
  handleAction: (action: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>
}

export function registerWorkflowApi(deps: { service: WorkflowService }): WorkflowApi {
  const { service } = deps

  async function handleAction(
    action: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const str = (k: string): string => String(payload[k] ?? '').trim()

    switch (action) {
      case 'workflow_list_templates': {
        const templates = await service.listTemplates()
        return { ok: true, templates }
      }

      case 'workflow_get_template': {
        const name = str('name')
        if (!name) return { ok: false, error: '缺少 name' }
        const yaml = await service.getTemplateYaml(name)
        if (yaml === null) return { ok: false, error: `模板不存在：${name}` }
        return { ok: true, yaml }
      }

      case 'workflow_save_template': {
        const yaml = String(payload.yaml ?? '')
        if (!yaml.trim()) return { ok: false, error: '缺少 yaml' }
        const originalName = payload.originalName ? String(payload.originalName) : undefined
        return await service.saveTemplate(yaml, originalName)
      }

      case 'workflow_delete_template': {
        const name = str('name')
        if (!name) return { ok: false, error: '缺少 name' }
        return await service.deleteTemplate(name)
      }

      case 'workflow_list_tasks': {
        const filter: WorkflowTaskFilter = {}
        const status = str('status')
        if (status && TASK_STATUSES.has(status)) filter.status = status as WorkflowTaskStatus
        if (str('shop')) filter.shop = str('shop')
        if (str('fromDate')) filter.fromDate = str('fromDate')
        if (str('toDate')) filter.toDate = str('toDate')
        const tasks = await service.listTasks(filter)
        return { ok: true, tasks }
      }

      case 'workflow_create_task': {
        const workflowName = str('workflowName')
        if (!workflowName) return { ok: false, error: '缺少 workflowName' }
        const inputs = normalizeInputs(payload.inputs)
        if (inputs === null) return { ok: false, error: 'inputs 必须是对象（键=模板输入变量）' }
        try {
          const taskId = await service.createTask({
            workflowName,
            shop: str('shop') || undefined,
            inputs,
          })
          return { ok: true, taskId }
        } catch (e) {
          // createTask 校验失败（缺必填/min-max/枚举越界/模板不存在）走这里，转 HTTP 错误载荷
          return { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      }

      case 'workflow_stop_task': {
        const taskId = str('taskId')
        if (!taskId) return { ok: false, error: '缺少 taskId' }
        const stopped = await service.stopTask(taskId)
        return stopped
          ? { ok: true }
          : { ok: false, error: `任务不存在或当前状态不可停止：${taskId}` }
      }

      case 'workflow_get_task_detail': {
        const taskId = str('taskId')
        if (!taskId) return { ok: false, error: '缺少 taskId' }
        const task = await service.getTaskDetail(taskId)
        if (!task) return { ok: false, error: `任务不存在：${taskId}` }
        return { ok: true, task }
      }

      case 'workflow_delete_task': {
        const taskId = str('taskId')
        if (!taskId) return { ok: false, error: '缺少 taskId' }
        return await service.deleteTask(taskId)
      }

      // 编排页辅助 action（不在 7.3 八表内）：技能下拉数据源。
      // 浏览器半区拿不到技能 body，无法自行过滤 instructions 型，由 host 侧下发。
      case 'workflow_list_step_skills': {
        const skills = await service.listStepSkills()
        return { ok: true, skills }
      }

      default:
        return { ok: false, error: `Unknown workflow action: ${action}` }
    }
  }

  return { handleAction }
}

/* ─────────────── inputs 载荷归一化 ─────────────── */

/**
 * inputs 归一化：对象先转 JSON 字符串再解析（统一路径）；字符串按 JSON 解析。
 * HTTP 路径前端可能直接传对象；工具路径模型传 JSON 对象字符串。
 * 无法解析返回 null（调用方转错误文案）。
 */
function normalizeInputs(v: unknown): Record<string, string | number> | null {
  if (v == null) return {}
  // 对象直接收（HTTP 路径前端传对象）
  if (typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, string | number>
  }
  // 字符串按 JSON 解析（工具路径，参数是 JSON 对象字符串）
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v.trim())
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, string | number>
      }
    } catch { /* 落到 return null */ }
  }
  return null
}

/* ─────────────── dsagent_workflow 工具（需求 5.5） ─────────────── */

export function buildWorkflowTool(deps: {
  service: WorkflowService
  /** 渲染函数（index.ts 接线时传 renderToolOutput，模型只看 render 后的文本） */
  render: ToolOutput['render']
}): ToolDefinition {
  const { service, render } = deps

  return {
    name: 'dsagent_workflow',
    description: '查看和管理 DSAgent 工作流（数据驱动的多步骤批量任务，如「找款式→上架 50 个商品」「批量生成视频→发布」）。'
      + '★ 用户要求查看/修改/新建工作流，或按工作流批量执行时调用本工具。'
      + 'action 取值：list（列模板）/ get（看单个模板 YAML）/ create|update（传 yaml 保存，走六项校验，重名覆盖）/ delete（删模板）/ run（按模板创建任务并开始执行，返回 taskId）/ stop（停止任务，当前步骤跑完后停）/ tasks（查任务列表与进度；传 taskId 查单任务详情含轮次明细）/ delete_task（删除终态任务记录）。',
    parameters: {
      action: { type: 'string', required: true, description: 'list / get / create / update / delete / run / stop / tasks / delete_task' },
      // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
      name: { type: 'string', description: '模板名（get/update/delete/run 用）' },
      yaml: { type: 'string', description: '模板 YAML 全文（create/update 用；格式先 action=get 看一个现有模板作参考）' },
      inputs: { type: 'string', description: '运行输入（run 用）：JSON 对象字符串，键=模板声明的输入变量，如 {"keyword":"连衣裙","count":50}。也接受直接传 JSON 对象' },
      shopKey: { type: 'string', description: '目标账号 shopKey（run 用，可选）。该平台有多个可用账号且未绑定时，先向用户确认再填；不传则按会话绑定自动选号' },
      taskId: { type: 'string', description: '任务 ID（stop 用；tasks 传它则返回单任务详情）' },
    },
    output: { schema: { type: 'json' }, render },
    async execute(args) {
      const action = String(args?.action ?? '').trim()
      try {
        switch (action) {
          case 'list': {
            const templates = await service.listTemplates()
            if (!templates.length) {
              return {
                ok: true,
                text: '当前没有工作流模板。可用 action=create 新建（yaml 参数），或在「工作流编排」页面创建。',
                count: 0,
              }
            }
            return {
              ok: true,
              text: [
                `共 ${templates.length} 个工作流模板（action=get name=模板名 可查看 YAML 原文）：`,
                ...templates.map(t =>
                  `- ${t.name} | ${t.category} | ${t.mode === 'batch' ? '批量循环' : '单次执行'} | 输入 ${t.inputCount} 个 | 步骤 ${t.stepCount} 个${t.description ? ` | ${t.description}` : ''}`),
              ].join('\n'),
              count: templates.length,
            }
          }

          case 'get': {
            const name = String(args?.name ?? '').trim()
            if (!name) return { ok: false, text: 'get 需要 name 参数（模板名，先 action=list 查看）。' }
            const yaml = await service.getTemplateYaml(name)
            if (yaml === null) return { ok: false, text: `未找到工作流模板：${name}` }
            return { ok: true, text: `工作流「${name}」的 YAML 原文：\n\n${yaml}`, yaml }
          }

          case 'create':
          case 'update': {
            const yaml = String(args?.yaml ?? '')
            if (!yaml.trim()) {
              return { ok: false, text: `${action} 需要 yaml 参数（模板 YAML 全文）。建议先 action=get 看一个现有模板作参考。` }
            }
            const saved = await service.saveTemplate(yaml)
            if (!saved.ok) {
              return {
                ok: false,
                text: `保存未通过校验，共 ${saved.issues?.length ?? 0} 个问题：\n` + (saved.issues ?? []).map(i => `- ${i}`).join('\n'),
                issues: saved.issues ?? [],
              }
            }
            return { ok: true, text: `工作流模板「${saved.name}」已保存。`, name: saved.name }
          }

          case 'delete': {
            const name = String(args?.name ?? '').trim()
            if (!name) return { ok: false, text: 'delete 需要 name 参数。' }
            const result = await service.deleteTemplate(name)
            if (!result.ok) return { ok: false, text: `删除失败：${result.error}` }
            return { ok: true, text: `工作流模板「${name}」已删除。` }
          }

          case 'run': {
            const name = String(args?.name ?? '').trim()
            if (!name) return { ok: false, text: 'run 需要 name 参数（模板名，先 action=list 查看）。' }
            const inputs = normalizeInputs(args?.inputs)
            if (inputs === null) {
              return { ok: false, text: 'inputs 必须是 JSON 对象字符串，如 {"keyword":"连衣裙","count":50}。' }
            }
            const shopKey = String(args?.shopKey ?? '').trim() || undefined
            // 复用「开始批量运行」同一条 createTask 链路（含输入校验、账号绑定检查）
            try {
              const taskId = await service.createTask({ workflowName: name, shop: shopKey, inputs })
              return {
                ok: true,
                text: [
                  `任务已创建并开始执行：${taskId}`,
                  `模板：${name}；账号：${shopKey ?? '（按会话绑定自动选号）'}`,
                  '任务异步执行中：同一任务内部串行（逐轮逐步骤），不同任务之间并发。',
                  `查询进度：再调用本工具 action=tasks taskId=${taskId}（返回进度与失败轮明细）。`,
                ].join('\n'),
                taskId,
              }
            } catch (e) {
              return { ok: false, text: `创建任务失败：${e instanceof Error ? e.message : String(e)}` }
            }
          }

          case 'stop': {
            const taskId = String(args?.taskId ?? '').trim()
            if (!taskId) return { ok: false, text: 'stop 需要 taskId 参数。' }
            const stopped = await service.stopTask(taskId)
            return stopped
              ? { ok: true, text: `停止请求已受理：${taskId}（当前步骤跑完后停止，不强杀子进程）。` }
              : { ok: false, text: `任务不存在或当前状态不可停止：${taskId}` }
          }

          case 'tasks': {
            const taskId = String(args?.taskId ?? '').trim()
            if (taskId) {
              const task = await service.getTaskDetail(taskId)
              if (!task) return { ok: false, text: `任务不存在：${taskId}` }
              return { ok: true, text: renderTaskDetail(task), task }
            }
            const tasks = await service.listTasks()
            if (!tasks.length) return { ok: true, text: '当前没有工作流任务。', count: 0 }
            const recent = tasks.slice(0, TOOL_TASKS_LIMIT)
            const lines = recent.map(renderTaskLine)
            if (tasks.length > recent.length) lines.push(`…（共 ${tasks.length} 条，仅显示最近 ${TOOL_TASKS_LIMIT} 条）`)
            return {
              ok: true,
              text: ['最近工作流任务（传 taskId 可查单任务详情）：', ...lines].join('\n'),
              count: tasks.length,
            }
          }

          case 'delete_task': {
            const taskId = String(args?.taskId ?? '').trim()
            if (!taskId) return { ok: false, text: 'delete_task 需要 taskId 参数。' }
            const result = await service.deleteTask(taskId)
            if (!result.ok) return { ok: false, text: `删除失败：${result.error}` }
            return { ok: true, text: `任务记录「${taskId}」已删除。` }
          }

          default:
            return { ok: false, text: `未知 action：${action}。可用：list / get / create / update / delete / run / stop / tasks / delete_task。` }
        }
      } catch (e) {
        return { ok: false, text: `工作流操作失败：${e instanceof Error ? e.message : String(e)}` }
      }
    },
  }
}

/* ─────────────── 面向 LLM 的任务渲染 ─────────────── */

/** 任务单行摘要（列表用）：ID / 工作流 / 状态 / 进度 / 输入 / 最近错误 */
function renderTaskLine(t: WorkflowTask): string {
  const progress = `${t.current}/${t.target}（成功 ${t.success}｜失败 ${t.failed}）`
  const err = t.error || lastFailedError(t)
  return `- ${t.id} | ${t.workflowName} | ${t.status} | 进度 ${progress} | ${t.inputSummary}${err ? ` | 最近错误：${err}` : ''}`
}

/** 倒序找最近一个失败轮的错误摘要 */
function lastFailedError(t: WorkflowTask): string | null {
  for (let i = t.rounds.length - 1; i >= 0; i--) {
    if (t.rounds[i].status === 'failed') return t.rounds[i].error ?? null
  }
  return null
}

/** 任务全量详情（含轮次明细；成功轮只汇总，失败轮逐条列出） */
function renderTaskDetail(t: WorkflowTask): string {
  const lines = [
    `任务：${t.id}`,
    `工作流：${t.workflowName}｜账号：${t.shop ?? '（未指定）'}`,
    `输入：${t.inputSummary}`,
    `状态：${t.status}｜进度：${t.current}/${t.target}（成功 ${t.success}｜失败 ${t.failed}）`,
    `开始：${t.startedAt}${t.finishedAt ? `｜结束：${t.finishedAt}` : ''}`,
  ]
  if (t.error) lines.push(`任务级错误：${t.error}`)
  if (t.rounds.length) {
    const failed = t.rounds.filter(r => r.status === 'failed')
    lines.push(`轮次：共 ${t.rounds.length} 轮，成功 ${t.rounds.length - failed.length}，失败 ${failed.length}`)
    // 逐步骤日志（标准化格式）
    const loggedRounds = t.rounds.filter(r => r.logs?.length)
    if (loggedRounds.length) {
      lines.push('── 执行日志 ──')
      for (const r of loggedRounds) {
        lines.push(`[第${r.index}轮 ${r.status === 'ok' ? '✓成功' : '✗失败'} ${r.durationMs}ms]`)
        for (const l of r.logs!) lines.push(`  ${l}`)
      }
    }
    for (const r of failed.slice(0, TOOL_FAILED_ROUNDS_LIMIT)) {
      lines.push(`  #${r.index} ✗ ${r.error ?? ''}`)
    }
    if (failed.length > TOOL_FAILED_ROUNDS_LIMIT) {
      lines.push(`  …（失败轮共 ${failed.length} 条，仅列前 ${TOOL_FAILED_ROUNDS_LIMIT} 条）`)
    }
  }
  return lines.join('\n')
}
