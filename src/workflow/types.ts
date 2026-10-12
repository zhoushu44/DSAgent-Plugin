/**
 * 工作流功能组件 —— 共享类型定义（host 半区 + 浏览器半区共用）。
 *
 * 需求文档：docs/workflow-requirements.md（第八章文件结构）。
 * 全部代码集中在 src/workflow/ 独立文件夹，现有文件只加接线代码。
 */

/* ─────────────── 模板（skills/workflows/*.yaml） ─────────────── */

/** 输入变量类型（对应顶部配置区的动态表单控件） */
export type WorkflowInputType = 'text' | 'number' | 'textarea' | 'select' | 'date'

/** 输入变量定义（影刀式变量面板的「输入变量」分组） */
export interface WorkflowInputDef {
  /** 英文标识符，如 keyword */
  key: string
  /** 显示名称，如 关键词 */
  label: string
  type: WorkflowInputType
  required?: boolean
  default?: string | number
  /** 仅 number：最小/最大值 */
  min?: number
  max?: number
  /** 仅 select：可选项 */
  options?: string[]
}

/** 步骤失败策略：continue=继续下一轮 / abort=停止整个任务 */
export type WorkflowFailureStrategy = 'continue' | 'abort'

/** 执行步骤定义 */
export interface WorkflowStep {
  /** 步骤名称，如「找款式」 */
  name: string
  /** 技能 id（skill-service 的技能标识） */
  skill: string
  /** 参数绑定：值为 `{{var}}` 引用或固定常量 */
  args?: Record<string, string>
  /** 输出变量名（自动注册到变量面板的「步骤输出」分组） */
  output?: string
  /** 失败策略，默认 continue */
  on_failure?: WorkflowFailureStrategy
}

/** 执行模式：batch=按数量循环 / single=单次执行 */
export type WorkflowMode = 'batch' | 'single'

/** 工作流模板（一个 YAML 文件 ↔ 一条记录） */
export interface WorkflowTemplate {
  name: string
  /** 内容发布 / 视频生成 / 数据采集 / 店铺经营 / 自定义 */
  category?: string
  mode: WorkflowMode
  /** batch 模式下引用哪个输入变量作为循环次数 */
  count_input?: string
  description?: string
  inputs?: WorkflowInputDef[]
  steps: WorkflowStep[]
}

/** 模板摘要（listWorkflowTemplates 返回，供下拉/列表用） */
export interface WorkflowTemplateSummary {
  name: string
  category: string
  mode: WorkflowMode
  description: string
  /** 输入变量个数（编排页列表的辅助信息） */
  inputCount: number
  /** 步骤数 */
  stepCount: number
}

/* ─────────────── 任务（workflow-tasks.json） ─────────────── */

/** 任务状态机：queued → running → completed | failed | stopped */
export type WorkflowTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'stopped'

/** 轮次记录（成功记耗时、失败额外记错误摘要，超长截断 500 字符） */
export interface RoundRecord {
  /** 轮次号（从 1 开始；single 模式恒为 1） */
  index: number
  status: 'ok' | 'failed'
  durationMs: number
  /** 失败原因摘要（失败轮才有；前缀 [failureKind]） */
  error?: string | null
  /** 标准化日志行（逐步骤记录，成功与失败均含；单条截断 300 字符，单轮上限 50 条） */
  logs?: string[]
}

/** 任务记录（持久化到 workflow-tasks.json 的一条） */
export interface WorkflowTask {
  /** 形如 wf_task_1734038425000 */
  id: string
  workflowName: string
  /** 任务绑定的目标店铺 shopKey（账号下拉选定；可空=未指定） */
  shop?: string | null
  /** 本次任务的输入（键=模板 inputs[].key） */
  inputs: Record<string, string | number>
  /** 输入摘要，如「关键词：连衣裙；数量：50」 */
  inputSummary: string
  status: WorkflowTaskStatus
  /** 成功轮次数 */
  success: number
  /** 失败轮次数 */
  failed: number
  /** 目标轮次数（batch=count_input 值；single=1） */
  target: number
  /** 当前轮次 */
  current: number
  startedAt: string
  finishedAt?: string | null
  /** 任务级错误（引擎级异常 / 环境级失败 abort 时的引导文案） */
  error?: string | null
  /** 轮次明细（成功与失败均持久化） */
  rounds: RoundRecord[]
}

/** 任务列表筛选条件（listTasks / list_workflow_tasks） */
export interface WorkflowTaskFilter {
  status?: WorkflowTaskStatus
  shop?: string
  /** ISO 日期（含），按 startedAt 过滤 */
  fromDate?: string
  toDate?: string
}

/* ─────────────── 编排页（host → 浏览器半区） ─────────────── */

/**
 * 编排页「调用技能」下拉条目（service.listStepSkills 返回）。
 *
 * 浏览器半区拿不到技能 body（现有 list_skills action 刻意不回传，体积原因），
 * 无法自行判定入口形态 —— 由 host 侧过滤掉 instructions 型后下发。
 */
export interface StepSkillInfo {
  /** 技能 id（step.skill 填这个） */
  id: string
  /** 显示名 */
  name: string
  description: string
  /** 所属平台（common=通用，无需账号） */
  platform: string
  /** 是否浏览器自动化类（引擎执行时走全局浏览器互斥锁） */
  browser: boolean
  /**
   * 契约参数表（参数名/类型/必填），无契约技能为 null
   * —— 编排页有契约时按此渲染参数行，无契约时自由填 key
   */
  contractArgs: Array<{
    name: string
    type: string
    required: boolean
    description: string
    choices?: string[]
    default?: string | number | boolean
  }> | null
  /** 契约声明的输出字段（供变量下拉展示真实字段名）；未声明为 null（兜底 .results / .raw） */
  outputFields: Record<string, string> | null
}

/* ─────────────── HTTP / 工具层载荷 ─────────────── */

/** list_workflow_templates 返回的模板条目（7.3 表格） */
export interface WorkflowTemplateBrief {
  name: string
  category: string
  mode: string
  description: string
}

/** create_workflow_task 入参 */
export interface CreateWorkflowTaskPayload {
  workflowName: string
  shop?: string
  inputs: Record<string, string | number>
}
