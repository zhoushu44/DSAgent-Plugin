/**
 * DSAgent 工作流页面 —— 浏览器半区组件。
 *
 * 两个子标签：
 *   - 工作流任务：模板选择 + 账号 + 动态输入 + 批量运行 + 筛选 + 任务列表 + 详情弹窗 + 轮询
 *   - 工作流编排：影刀式三栏（模板列表 / 流程画布 / 属性面板），点击画布步骤卡片在右侧编辑属性
 *
 * 不直接 import service.ts 或 api.ts，所有数据通过 api() fetch 调用 host 半区。
 */

import type { Config } from '../index.ts'
import type {
  WorkflowTemplateSummary,
  WorkflowTask,
  WorkflowTaskStatus,
  StepSkillInfo,
  WorkflowInputDef,
  WorkflowInputType,
  WorkflowMode,
  RoundRecord,
} from './types.ts'

/* ─────────────── 编辑器内部状态类型 ─────────────── */

interface EdInput {
  key: string
  label: string
  type: WorkflowInputType
  required: boolean
  default: string
  min: string
  max: string
  options: string
}

interface EdStep {
  name: string
  skill: string
  args: Array<{ key: string; val: string }>
  output: string
  on_failure: 'continue' | 'abort'
}

interface EditorState {
  name: string
  category: string
  mode: WorkflowMode
  count_input: string
  description: string
  inputs: EdInput[]
  steps: EdStep[]
  selectedTemplate: string | null
  selectedStepIndex: number
  varEditIndex: number
  /** ★ 定期执行配置 */
  schedule: EdSchedule
}

/** ★ 定期执行（编辑态，只需分钟数） */
interface EdSchedule {
  enabled: boolean
  /** 间隔分钟数 */
  intervalMinutes: string
  /** 只读展示 */
  lastRunAt: string
  nextRunAt: string
}

interface AccountRow {
  shopKey: string
  platform: string
  accountId: string
  displayLabel: string
  status: string
}

/* ─────────────── 辅助函数 ─────────────── */

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function statusBadgeClass(status: WorkflowTaskStatus): string {
  switch (status) {
    case 'completed': return 'dsa-ok'
    case 'running': return 'dsa-warn'
    case 'failed': return 'dsa-bad'
    case 'queued': return 'dsa-idle'
    case 'stopped': return 'dsa-idle'
    default: return 'dsa-idle'
  }
}

function statusLabel(status: WorkflowTaskStatus): string {
  switch (status) {
    case 'completed': return '已完成'
    case 'running': return '运行中'
    case 'failed': return '失败'
    case 'queued': return '排队'
    case 'stopped': return '已停止'
    default: return status
  }
}

const CATEGORIES = ['内容发布', '视频生成', '数据采集', '店铺经营', '自定义']

/* ─────────────── CSS（全量自带） ─────────────── */

const WORKFLOW_CSS = `
/* ── 基础（与账号页/技能页同源） ── */
.dsa-page{font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2430}
.dsa-hd{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px}
.dsa-hd h2{margin:0 0 4px;font-size:17px}
.dsa-dim{color:#8b93a7;margin:0}
.dsa-btn{border:1px solid #d8dde8;background:#fff;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px;font-family:inherit;color:#1f2430;transition:border-color .12s,background .12s}
.dsa-btn:hover{border-color:#2b6cff;color:#2b6cff}
.dsa-btn-primary{background:#2b6cff;border-color:#2b6cff;color:#fff}
.dsa-btn-primary:hover{background:#1f5ae0;color:#fff}
.dsa-btn-primary:disabled{opacity:.45;cursor:not-allowed}
.dsa-btn-danger{background:#fff;border-color:#f0c9c9;color:#d93b3b}
.dsa-btn-danger:hover{background:#d93b3b;border-color:#d93b3b;color:#fff}

/* ── 统一表单控件：所有 input/select/textarea 同一形态 ── */
.dsa-ctl{border:1px solid #d8dde8;border-radius:6px;padding:5px 10px;font-size:13px;font-family:inherit;outline:none;background:#fff;color:#1f2430;min-height:32px;box-sizing:border-box}
textarea.dsa-ctl{min-height:60px;resize:vertical}
.dsa-ctl:focus{border-color:#2b6cff;box-shadow:0 0 0 2px rgba(43,108,255,.08)}
.dsa-ctl::placeholder{color:#b6bdcc}
select.dsa-ctl{cursor:pointer}

/* ── 表单行：label + 控件，纵向栅格对齐 ── */
.dsa-form-row{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.dsa-form-row>label{color:#67708a;font-size:12px;flex:none;width:72px;text-align:right}
.dsa-form-row>.dsa-ctl{flex:1;min-width:0}

/* ── 表格 / 徽标 / 弹窗 / Toast（复用账号页） ── */
.dsa-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #eceff5;border-radius:8px;overflow:hidden}
.dsa-table th{text-align:left;font-weight:600;color:#67708a;background:#f7f9fc;padding:10px 14px;border-bottom:1px solid #eceff5;font-size:12px}
.dsa-table td{padding:11px 14px;border-bottom:1px solid #f2f4f9;vertical-align:middle;font-size:12.5px}
.dsa-table tr:last-child td{border-bottom:none}
.dsa-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;white-space:nowrap}
.dsa-ok{background:#e8f7ee;color:#1a9f4d}
.dsa-warn{background:#fff6e5;color:#c47f00}
.dsa-bad{background:#fdecec;color:#d93b3b}
.dsa-idle{background:#eef1f7;color:#67708a}
.dsa-ops a{color:#2b6cff;margin-right:10px;cursor:pointer;font-size:12px}
.dsa-ops a:hover{text-decoration:underline}
.dsa-danger{color:#d93b3b !important}
.dsa-empty{text-align:center;padding:60px 20px;border:1px dashed #dfe4ee;border-radius:8px;background:#fff}
.dsa-empty-ico{font-size:30px;margin-bottom:8px}
.dsa-empty-title{font-size:15px;font-weight:600;margin-bottom:6px}
.dsa-empty-sub{color:#8b93a7;margin-bottom:16px}
.dsa-mask{position:fixed;inset:0;background:rgba(16,20,32,.42);display:flex;align-items:center;justify-content:center;z-index:99}
.dsa-mask[hidden]{display:none}
.dsa-modal{width:560px;max-width:92vw;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 18px 48px rgba(16,20,32,.24)}
.dsa-modal-hd{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #eef1f7}
.dsa-modal-bd{padding:18px;min-height:210px;max-height:60vh;overflow:auto}
.dsa-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:12px 18px;border-top:1px solid #eef1f7;background:#fafbfd}
.dsa-x{border:none;background:none;font-size:14px;color:#8b93a7;cursor:pointer}
.dsa-toast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%);background:rgba(24,28,40,.9);color:#fff;padding:8px 18px;border-radius:20px;font-size:13px;z-index:120;max-width:80vw;white-space:pre-wrap;line-height:1.5}
.dsa-toast[hidden]{display:none}

/* ── 子标签栏 ── */
.dsa-subtabs{display:flex;gap:4px;border-bottom:1px solid #eceff5;margin-bottom:16px}
.dsa-subtab{border:none;background:none;padding:9px 16px;cursor:pointer;color:#67708a;font-size:13px;border-bottom:2px solid transparent;font-family:inherit;margin-bottom:-1px}
.dsa-subtab:hover{color:#1f2430}
.dsa-subtab.on{color:#2b6cff;border-bottom-color:#2b6cff;font-weight:600}

/* ── 筛选栏 ── */
.dsa-filter-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 14px;background:#fff;border:1px solid #eceff5;border-radius:8px}
.dsa-filter-bar .dsa-ctl{min-height:30px;padding:4px 8px;font-size:12.5px;width:auto}
.dsa-filter-label{color:#8b93a7;font-size:12px;flex:none}

/* ── 任务标签：顶部配置卡片 ── */
.dsa-wf-config{background:#fff;border:1px solid #eceff5;border-radius:8px;padding:16px;margin-bottom:16px}
.dsa-wf-config h3{margin:0 0 14px;font-size:14px}
.dsa-wf-req{color:#d93b3b;margin-left:2px}

/* ── 通用图标按钮 ── */
.dsa-icon-btn{border:none;background:none;color:#8b93a7;cursor:pointer;font-size:13px;width:26px;height:26px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;flex:none}
.dsa-icon-btn:hover:not(:disabled){background:#e8ecf4;color:#1f2430}
.dsa-icon-btn:disabled{opacity:.3;cursor:not-allowed}
.dsa-icon-btn.danger:hover{background:#fdecec;color:#d93b3b}

/* ── 三栏（影刀式：模板列表 / 流程画布 / 属性面板） ── */
.dsa-editor{display:flex;gap:14px;align-items:stretch}
.dsa-editor-col{background:#fff;border:1px solid #eceff5;border-radius:8px;overflow:hidden;display:flex;flex-direction:column}
.dsa-editor-list{width:210px;flex:none}
.dsa-editor-list-hd{padding:10px 12px;border-bottom:1px solid #f2f4f9;background:#fafbfd;font-size:12px;font-weight:600;color:#67708a;display:flex;justify-content:space-between;align-items:center}
.dsa-editor-list-hd .dsa-icon-btn{color:#2b6cff}
.dsa-editor-list-bd{flex:1;max-height:640px;overflow:auto;padding:6px}
.dsa-ed-item{padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:2px}
.dsa-ed-item:hover{background:#f4f7fd}
.dsa-ed-item.on{background:#eaf1ff;color:#1f5ae0}
.dsa-ed-item-name{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsa-ed-item-meta{font-size:11px;color:#8b93a7;margin-top:2px}
.dsa-ed-item.on .dsa-ed-item-meta{color:#5b86e8}

/* ── 流程画布（中间栏） ── */
.dsa-flow{flex:1;min-width:0;display:flex;flex-direction:column}
.dsa-flow-bd{flex:1;max-height:640px;overflow:auto;padding:18px 20px;background:#fafbfd;display:flex;flex-direction:column;align-items:center}
.dsa-flow-start,.dsa-flow-end{display:flex;flex-direction:column;align-items:center}
.dsa-flow-cap{width:88px;text-align:center;padding:5px 0;border-radius:14px;font-size:12px;font-weight:600;letter-spacing:2px}
.dsa-flow-cap.dsa-flow-start-cap{background:#eaf1ff;color:#2b6cff}
.dsa-flow-cap.dsa-flow-end-cap{background:#eef1f7;color:#67708a;letter-spacing:1px}
.dsa-flow-node{width:340px;max-width:100%;background:#fff;border:1px solid #e3e8f2;border-radius:8px;cursor:pointer;position:relative;transition:border-color .12s,box-shadow .12s}
.dsa-flow-node:hover{border-color:#b9c8f5}
.dsa-flow-node.on{border-color:#2b6cff;box-shadow:0 0 0 3px rgba(43,108,255,.12)}
.dsa-flow-node-hd{display:flex;align-items:center;gap:8px;padding:9px 12px}
.dsa-flow-node.on .dsa-flow-node-hd{border-bottom:1px solid #f2f4f9}
.dsa-flow-node-num{width:22px;height:22px;border-radius:50%;background:#eaf1ff;color:#2b6cff;font-size:12px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;flex:none}
.dsa-flow-node.on .dsa-flow-node-num{background:#2b6cff;color:#fff}
.dsa-flow-node-name{flex:1;min-width:0;font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;border:none;background:none;font-family:inherit;color:#1f2430;outline:none;padding:2px 4px;border-radius:4px}
.dsa-flow-node-name:focus{background:#f4f7fd}
/* 收起态：标题行内联技能摘要（影刀式，点开才展开详情） */
.dsa-flow-node-skill{flex:none;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8b93a7;font-size:12px;font-weight:400;padding:2px 8px;background:#f4f6fb;border-radius:10px}
.dsa-flow-node:not(.on) .dsa-flow-node-skill{display:inline-flex}
.dsa-flow-node.on .dsa-flow-node-skill{display:none}
.dsa-flow-node-bd{display:none;padding:8px 12px;font-size:12px;color:#67708a;flex-direction:column;gap:3px}
.dsa-flow-node.on .dsa-flow-node-bd{display:flex}
.dsa-flow-node-ops{display:flex;gap:2px;opacity:0;transition:opacity .12s}
.dsa-flow-node:hover .dsa-flow-node-ops,.dsa-flow-node.on .dsa-flow-node-ops{opacity:1}
.dsa-flow-node-bd .row{display:flex;gap:6px;align-items:baseline}
.dsa-flow-node-bd .k{flex:none;width:44px;color:#8b93a7;font-size:11px}
.dsa-flow-node-bd .v{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Consolas,monospace;color:#4b5466}
.dsa-flow-node-bd .v.empty{color:#c3c9d8}
.dsa-flow-conn{display:flex;flex-direction:column;align-items:center;padding:2px 0}
.dsa-flow-conn-line{width:2px;height:12px;background:#d3d9e8}
.dsa-flow-insert{border:1px dashed #c6cede;background:#fff;color:#8b93a7;border-radius:50%;width:24px;height:24px;font-size:14px;line-height:1;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;transition:all .12s;margin:2px 0}
.dsa-flow-insert:hover{color:#2b6cff;border-color:#2b6cff;background:#f0f5ff}

/* ── 属性面板（右栏） ── */
.dsa-prop{width:320px;flex:none;display:flex;flex-direction:column}
.dsa-prop-hd{padding:10px 14px;border-bottom:1px solid #f2f4f9;background:#fafbfd;font-size:12px;font-weight:600;color:#67708a;display:flex;justify-content:space-between;align-items:center}
.dsa-prop-bd{flex:1;max-height:640px;overflow:auto;padding:14px}
.dsa-prop-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 16px;color:#8b93a7;font-size:12.5px;text-align:center;gap:6px}
.dsa-prop-empty .ico{font-size:26px;opacity:.6}
/* ── 任务标签的定时面板 ── */
.dsa-sched-panel{border:1px solid #e3e8f0;border-radius:8px;margin-top:14px;overflow:hidden}
.dsa-sched-panel.on{border-color:#2f6fdd;background:#f7faff}
.dsa-sched-panel-hd{padding:9px 12px;font-size:13px;font-weight:600;color:#1f2330;background:#fafbfd;border-bottom:1px solid #eef1f6;display:flex;align-items:center;gap:8px}
.dsa-sched-panel.on .dsa-sched-panel-hd{background:#eef4ff}
.dsa-sched-panel-bd{padding:12px}
.dsa-sched-badge{font-size:10.5px;padding:2px 7px;border-radius:10px;font-weight:500}
.dsa-sched-badge.on{background:#dcfce7;color:#15803d}
.dsa-sched-badge.off{background:#f1f3f7;color:#8b93a7}
.dsa-sched-next{font-size:12.5px;color:#2f6fdd;font-weight:500;margin-bottom:10px}
.dsa-sched-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}

/* ── 定期执行 ── */
.dsa-sched{border:1px solid #e3e8f0;border-radius:8px;padding:10px 12px;margin:8px 0 12px;background:#fafbfd}
.dsa-sched-toggle{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px}
.dsa-sched-status{font-size:12.5px;margin:6px 0 2px;color:#2f6fdd;font-weight:500}
.dsa-sched-sub{font-size:11.5px;color:#8b93a7;margin-bottom:4px}
.dsa-sched-body{margin-top:10px;padding-top:10px;border-top:1px dashed #e3e8f0}
.dsa-sched-hint{font-size:11px;color:#8b93a7;margin:-4px 0 8px 118px;line-height:1.4}
.dsa-sched-warn{font-size:11.5px;color:#c2410c;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:6px 8px;margin:6px 0}
.dsa-sched-presets{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.dsa-sched-presets .dsa-btn{font-size:11.5px;padding:4px 8px}

/* 分区标题（属性面板内） */
.dsa-sec{font-size:12px;font-weight:600;color:#8b93a7;margin:14px 0 8px;padding-bottom:5px;border-bottom:1px solid #f2f4f9}
/* 返回模板设置 */
.dsa-prop-back{border:none;background:none;color:#2b6cff;font-size:12px;cursor:pointer;font-family:inherit;padding:0;margin-bottom:10px}
.dsa-prop-back:hover{text-decoration:underline}
.dsa-args{display:grid;grid-template-columns:110px 1fr;gap:8px 10px;align-items:center}
.dsa-arg-name{color:#67708a;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── 高级折叠（失败策略） ── */
.dsa-advanced{margin-top:10px;border-top:1px dashed #eef1f7;padding-top:8px}
.dsa-advanced summary{cursor:pointer;color:#8b93a7;font-size:12px;user-select:none;list-style:none;display:flex;align-items:center;gap:4px}
.dsa-advanced summary::before{content:"▸";transition:transform .12s}
.dsa-advanced[open] summary::before{transform:rotate(90deg)}
.dsa-advanced[open] summary{margin-bottom:8px}

/* ── 变量面板 ── */
.dsa-var-group{margin-bottom:14px}
.dsa-var-group-title{font-size:12px;color:#8b93a7;font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:6px}
.dsa-var-count{background:#eef1f7;color:#67708a;font-size:11px;border-radius:8px;padding:0 7px;font-weight:500}
.dsa-var-item{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:5px 8px;border-radius:6px;font-size:12.5px}
.dsa-var-item:hover{background:#f4f7fd}
.dsa-var-name{color:#1f2430;font-family:ui-monospace,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsa-var-name b{color:#2b6cff;font-weight:500}
.dsa-var-type{color:#8b93a7;font-size:11px;background:#eef1f7;border-radius:3px;padding:0 5px;flex:none}
.dsa-var-item .dsa-icon-btn{width:20px;height:20px;font-size:11px;opacity:.35}
.dsa-var-item:hover .dsa-icon-btn{opacity:1}
.dsa-vars-edit{background:#f7f9fc;border:1px solid #e6eaf2;border-radius:8px;padding:12px;margin-top:8px}
.dsa-vars-edit .dsa-form-row{margin-bottom:8px}
.dsa-vars-edit .dsa-form-row>label{width:56px}
.dsa-vars-edit .dsa-ctl{min-height:30px;padding:4px 8px;font-size:12.5px}

/* ── YAML 预览 ── */
.dsa-yaml-preview{background:#f7f9fc;border:1px solid #eceff5;border-radius:6px;padding:12px;font-size:12px;color:#4b5466;overflow:auto;font-family:ui-monospace,Consolas,monospace;white-space:pre-wrap;margin-top:14px;max-height:280px}

/* ── 编辑器底部操作栏 ── */
.dsa-editor-ft{display:flex;gap:8px;margin-top:14px;align-items:center}
.dsa-toast-long{white-space:pre-wrap;line-height:1.6;cursor:pointer}

/* ── 日志悬浮弹层 ── */
.dsa-wf-log-cell{position:relative;cursor:pointer}
.dsa-wf-log-link{color:#2b6cff;font-size:12px;cursor:pointer}
.dsa-wf-log-link:hover{text-decoration:underline}
.dsa-wf-pop{position:absolute;z-index:50;right:0;top:100%;margin-top:4px;width:520px;max-width:80vw;max-height:360px;overflow:auto;background:#fff;border:1px solid #d8dde8;border-radius:8px;box-shadow:0 8px 28px rgba(16,20,32,.18);font-size:12px;line-height:1.6}
.dsa-wf-pop-hd{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #eef1f7;background:#fafbfd;position:sticky;top:0;z-index:1}
.dsa-wf-pop-hd b{font-size:12px;color:#4b5466}
.dsa-wf-pop-copy{border:1px solid #d8dde8;background:#fff;border-radius:4px;padding:2px 10px;cursor:pointer;font-size:11px;font-family:inherit;color:#4b5466}
.dsa-wf-pop-copy:hover{border-color:#2b6cff;color:#2b6cff}
.dsa-wf-pop-bd{padding:8px 12px}
.dsa-wf-pop-empty{color:#8b93a7;text-align:center;padding:20px 0}
.dsa-wf-log-line{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;white-space:pre-wrap;word-break:break-all;padding:2px 0}
.dsa-wf-log-line.ok{color:#1a9f4d}
.dsa-wf-log-line.fail{color:#d93b3b}
.dsa-wf-log-round{font-weight:600;color:#67708a;font-size:11px;margin:6px 0 2px;padding-top:4px;border-top:1px dashed #eef1f7}
.dsa-wf-log-round:first-child{border-top:none;padding-top:0}
`

/* ─────────────── 页面主体 ─────────────── */

export function workflowPage(deps: { config: Config }) {
  void deps

  /* 闭包状态 */
  let subtab: 'tasks' | 'editor' = 'tasks'
  let templates: WorkflowTemplateSummary[] = []
  let tasks: WorkflowTask[] = []
  let accounts: AccountRow[] = []
  let stepSkills: StepSkillInfo[] = []
  let selectedTemplateName = ''
  /** ★ 任务标签里的定时间隔（分钟） */
  let taskScheduleInterval = '120'
  let currentInputs: WorkflowInputDef[] = []
  let filterStatus = ''
  let filterShop = ''
  let filterFrom = ''
  let filterTo = ''
  let pollTimer = 0
  let currentTaskDetailId = ''  // 当前打开的任务详情弹窗 ID（轮询时自动刷新）
  let editorState: EditorState = newTemplateState()
  let rootEl: HTMLElement | null = null

  function newTemplateState(): EditorState {
    return {
      name: '',
      category: '自定义',
      mode: 'batch',
      count_input: '',
      description: '',
      inputs: [{ key: 'keyword', label: '关键词', type: 'text', required: true, default: '', min: '', max: '', options: '' }],
      steps: [{ name: 'step1', skill: '', args: [], output: 'step1', on_failure: 'continue' }],
      selectedTemplate: null,
      selectedStepIndex: -1,
      varEditIndex: -1,
      schedule: {
        enabled: false,
        intervalMinutes: '120',
        lastRunAt: '',
        nextRunAt: '',
      },
    }
  }

  /* api() 薄封装 */
  async function api(action: string, payload: Record<string, unknown> = {}): Promise<any> {
    const resp = await fetch('/dsagent/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    })
    const data = await resp.json()
    return data
  }

  async function loadAccounts(): Promise<void> {
    try {
      const data = await api('list_accounts')
      if (data && data.ok && Array.isArray(data.rows)) {
        accounts = data.rows.map((r: Record<string, unknown>) => ({
          shopKey: String(r.shopKey ?? ''),
          platform: String(r.platform ?? ''),
          accountId: String(r.accountId ?? ''),
          displayLabel: String(r.displayLabel ?? r.nickname ?? r.accountId ?? ''),
          status: String(r.status ?? ''),
        }))
      }
    } catch { /* 网络错误时保持空列表 */ }
  }

  async function loadTemplates(): Promise<void> {
    try {
      const data = await api('workflow_list_templates')
      if (data && data.ok && Array.isArray(data.templates)) {
        templates = data.templates as WorkflowTemplateSummary[]
        // ★ 首次加载且没选中过 → 默认选第一个，避免定时面板一直是空状态
        if (!selectedTemplateName && templates.length) {
          selectedTemplateName = templates[0].name
          const tp0 = templates[0]
          taskScheduleInterval = String(tp0?.scheduleInterval ?? 120)
        }
      }
    } catch { /* 静默 */ }
  }

  async function loadStepSkills(): Promise<void> {
    try {
      const data = await api('workflow_list_step_skills')
      if (data && data.ok && Array.isArray(data.skills)) {
        stepSkills = data.skills as StepSkillInfo[]
      }
    } catch { /* 静默 */ }
  }

  async function loadTasks(): Promise<void> {
    try {
      const payload: Record<string, unknown> = {}
      if (filterStatus) payload.status = filterStatus
      if (filterShop) payload.shop = filterShop
      if (filterFrom) payload.fromDate = filterFrom
      if (filterTo) payload.toDate = filterTo
      const data = await api('workflow_list_tasks', payload)
      if (data && data.ok && Array.isArray(data.tasks)) {
        tasks = data.tasks as WorkflowTask[]
      }
    } catch { /* 静默 */ }
  }

  /* ── YAML 解析（轻量逐行，不依赖 yaml 库——浏览器半区无 node 依赖） ── */

  /** 从 YAML 文本解析 inputs 数组（宽松解析，字段对齐 types.ts） */
  /** ★ 从 YAML 解析 schedule（只认 enabled / intervalMinutes / 时间戳） */
  function parseScheduleFromYaml(yamlText: string): void {
    const lines = yamlText.split('\n')
    const sch = editorState.schedule
    let inSchedule = false
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '')
      if (/^schedule:\s*$/.test(line)) { inSchedule = true; continue }
      if (inSchedule && /^[a-zA-Z_]/.test(line)) break
      if (!inSchedule) continue
      const kv = line.match(/^\s{2}(\w+):\s*(.*)$/)
      if (!kv) continue
      const [, k, vRaw] = kv
      const v = vRaw.trim().replace(/^["']|["']$/g, '')
      if (k === 'enabled') sch.enabled = v === 'true'
      else if (k === 'intervalMinutes') sch.intervalMinutes = v
      else if (k === 'lastRunAt') sch.lastRunAt = v
      else if (k === 'nextRunAt') sch.nextRunAt = v
    }
  }

  function parseInputsFromYaml(yamlText: string): WorkflowInputDef[] {
    const lines = yamlText.split('\n')
    const result: WorkflowInputDef[] = []
    let inInputs = false
    let current: Partial<WorkflowInputDef> | null = null

    for (const line of lines) {
      const trimmed = line.replace(/\r$/, '')
      // 进入 inputs 段
      if (/^inputs\s*:/.test(trimmed)) { inInputs = true; continue }
      // 离开 inputs 段（遇到非缩进且非空行）
      if (inInputs && trimmed.length > 0 && !/^\s/.test(trimmed)) {
        if (current && current.key) result.push(normalizeParsedInput(current))
        current = null
        inInputs = false
        // 不 continue，此行可能是后续段
      }
      if (!inInputs) continue
      // 列表项起始：`  - key: xxx`
      const itemMatch = trimmed.match(/^\s+-\s+(.*)$/)
      if (itemMatch) {
        if (current && current.key) result.push(normalizeParsedInput(current))
        current = {}
        const rest = itemMatch[1]
        const kv = rest.match(/^(\w+)\s*:\s*(.*)$/)
        if (kv) {
          const [, k, v] = kv
          if (k === 'key') current.key = v.trim()
          else (current as Record<string, unknown>)[k] = v.trim()
        }
      } else if (current) {
        // 子属性行：`    label: xxx`
        const kv = trimmed.match(/^\s+(\w+)\s*:\s*(.*)$/)
        if (kv) {
          const [, k, v] = kv
          const val = v.trim()
          if (k === 'options') {
            (current as Record<string, unknown>)[k] = val ? val.split(',').map(s => s.trim()) : []
          } else if (k === 'required') {
            (current as Record<string, unknown>)[k] = val === 'true'
          } else if (k === 'min' || k === 'max') {
            (current as Record<string, unknown>)[k] = val ? Number(val) : undefined
          } else if (k === 'default') {
            (current as Record<string, unknown>)[k] = val
          } else {
            (current as Record<string, unknown>)[k] = val
          }
        }
      }
    }
    if (current && current.key) result.push(normalizeParsedInput(current))
    return result
  }

  function normalizeParsedInput(raw: Partial<WorkflowInputDef>): WorkflowInputDef {
    const type = raw.type === 'number' || raw.type === 'textarea' || raw.type === 'select' || raw.type === 'date'
      ? raw.type : 'text'
    const def: WorkflowInputDef = {
      key: String(raw.key ?? ''),
      label: String(raw.label ?? raw.key ?? ''),
      type,
    }
    if (raw.required !== undefined) def.required = raw.required
    if (raw.default !== undefined) def.default = raw.default
    if (raw.min !== undefined) def.min = raw.min
    if (raw.max !== undefined) def.max = raw.max
    if (raw.options !== undefined && Array.isArray(raw.options)) def.options = raw.options
    return def
  }

  /* ─────────────── 渲染函数（任务标签） ─────────────── */

  function renderTemplateSelect(): string {
    const opts = templates.map(t =>
      `<option value="${esc(t.name)}"${selectedTemplateName === t.name ? ' selected' : ''}>${esc(t.name)}（${esc(t.category)} · ${t.mode === 'batch' ? '批量' : '单次'} · ${t.stepCount}步）</option>`)
    return `<select class="dsa-ctl" data-wf-template><option value="">— 选择工作流模板 —</option>${opts.join('')}</select>`
  }

  function renderShopSelect(): string {
    const opts = accounts.map(a =>
      `<option value="${esc(a.shopKey)}">${esc(a.displayLabel)}（${esc(a.platform)}）</option>`)
    return `<select class="dsa-ctl" data-wf-shop><option value="">— 自动选号 —</option>${opts.join('')}</select>`
  }

  function renderInputs(): string {
    if (!currentInputs.length) return '<p class="dsa-dim">该模板无输入变量。</p>'
    return currentInputs.map(def => {
      const req = def.required ? '<span class="dsa-wf-req">*</span>' : ''
      const dflt = def.default !== undefined && def.default !== null ? String(def.default) : ''
      let control = ''
      switch (def.type) {
        case 'textarea':
          control = `<textarea class="dsa-ctl" data-wf-input="${esc(def.key)}" placeholder="${esc(def.label)}">${esc(dflt)}</textarea>`
          break
        case 'select':
          control = `<select class="dsa-ctl" data-wf-input="${esc(def.key)}"><option value="">请选择</option>${(def.options ?? []).map(o => `<option value="${esc(o)}"${o === dflt ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`
          break
        case 'number':
          control = `<input type="number" class="dsa-ctl" data-wf-input="${esc(def.key)}" placeholder="${esc(def.label)}" value="${esc(dflt)}"${def.min !== undefined ? ` min="${def.min}"` : ''}${def.max !== undefined ? ` max="${def.max}"` : ''}>`
          break
        case 'date':
          control = `<input type="date" class="dsa-ctl" data-wf-input="${esc(def.key)}" value="${esc(dflt)}">`
          break
        default:
          control = `<input type="text" class="dsa-ctl" data-wf-input="${esc(def.key)}" placeholder="${esc(def.label)}" value="${esc(dflt)}">`
      }
      return `<div class="dsa-form-row"><label>${esc(def.label)}${req}</label>${control}</div>`
    }).join('')
  }

  function renderFilterBar(): string {
    const statusOpts = ['', 'queued', 'running', 'completed', 'failed', 'stopped']
      .map(s => `<option value="${s}"${filterStatus === s ? ' selected' : ''}>${s ? statusLabel(s as WorkflowTaskStatus) : '全部状态'}</option>`)
    const shopOpts = ['', ...new Set(accounts.map(a => a.shopKey))]
      .map(s => {
        if (!s) return '<option value="">全部店铺</option>'
        const acc = accounts.find(a => a.shopKey === s)
        return `<option value="${esc(s)}"${filterShop === s ? ' selected' : ''}>${esc(acc?.displayLabel ?? s)}</option>`
      })
    return `<div class="dsa-filter-bar">
      <span class="dsa-filter-label">状态</span><select class="dsa-ctl" data-filter="status">${statusOpts.join('')}</select>
      <span class="dsa-filter-label">店铺</span><select class="dsa-ctl" data-filter="shop">${shopOpts.join('')}</select>
      <span class="dsa-filter-label">从</span><input type="date" class="dsa-ctl" data-filter="from" value="${esc(filterFrom)}">
      <span class="dsa-filter-label">到</span><input type="date" class="dsa-ctl" data-filter="to" value="${esc(filterTo)}">
    </div>`
  }

  /** 拼接任务全部轮次日志为纯文本（复制用） */
  function taskLogsText(t: WorkflowTask): string {
    if (!t.rounds.length) return '（无轮次记录）'
    return t.rounds.map(r => {
      const head = `── 第${r.index}轮 ${r.status === 'ok' ? '✓成功' : '✗失败'} ${r.durationMs}ms ──`
      const body = (r.logs ?? []).join('\n')
      return `${head}\n${body}`
    }).join('\n\n')
  }

  /** 渲染日志悬浮弹层 HTML */
  function renderLogPopover(t: WorkflowTask): string {
    const hasLogs = t.rounds.some(r => r.logs?.length)
    if (!hasLogs) {
      return `<div class="dsa-wf-pop"><div class="dsa-wf-pop-empty">${t.rounds.length ? '该任务无逐步骤日志' : '尚未开始执行'}</div></div>`
    }
    const roundsHtml = t.rounds.map(r => {
      const lines = (r.logs ?? []).map(l => {
        const ok = !l.includes('✗失败')
        return `<div class="dsa-wf-log-line ${ok ? 'ok' : 'fail'}">${esc(l)}</div>`
      }).join('')
      return `<div class="dsa-wf-log-round">第${r.index}轮 · ${r.status === 'ok' ? '成功' : '失败'} · ${r.durationMs}ms</div>${lines}`
    }).join('')
    return `<div class="dsa-wf-pop" data-wf-pop>
      <div class="dsa-wf-pop-hd"><b>日志（${t.rounds.length}轮）</b><button class="dsa-wf-pop-copy" data-log-copy="${esc(t.id)}">复制</button></div>
      <div class="dsa-wf-pop-bd">${roundsHtml}</div>
    </div>`
  }

  /** 操作列：按状态渲染 停止/重跑/删除记录/详情 */
  function renderTaskOps(t: { id: string; status: string }): string {
    const isActive = t.status === 'running' || t.status === 'queued'
    const isTerminal = t.status === 'completed' || t.status === 'failed' || t.status === 'stopped'
    const parts: string[] = []
    if (isActive) {
      parts.push(`<a class="dsa-danger" data-task-stop="${esc(t.id)}">停止</a>`)
    }
    if (isTerminal) {
      parts.push(`<a data-task-rerun="${esc(t.id)}">重跑</a>`)
      parts.push(`<a class="dsa-danger" data-task-delete="${esc(t.id)}">删除</a>`)
    }
    parts.push(`<a data-task-detail="${esc(t.id)}">详情</a>`)
    return parts.join(' ')
  }

  function renderTaskTable(): string {
    if (!tasks.length) {
      return `<div class="dsa-empty"><div class="dsa-empty-ico">📋</div><div class="dsa-empty-title">暂无工作流任务</div><div class="dsa-empty-sub">在上方选择模板并填写输入后，点击「开始批量运行」</div></div>`
    }
    const rows = tasks.map(t => {
      // 进度列显示「成功数/目标数」：有失败时失败数用红色标出
      const progress = t.failed > 0
        ? `<span style="color:#d93b3b">${t.success}</span>/${t.target}`
        : `${t.success}/${t.target}`
      const cls = statusBadgeClass(t.status)
      // 日志列：有轮次记录时显示「查看」链接，悬浮弹层
      const hasLogs = t.rounds.some(r => r.logs?.length)
      const logCell = hasLogs
        ? `<td class="dsa-wf-log-cell"><a class="dsa-wf-log-link" data-task-log="${esc(t.id)}">查看</a></td>`
        : `<td class="dsa-wf-log-cell"><span style="color:#8b93a7">—</span></td>`
      return `<tr>
        <td><a data-task-detail="${esc(t.id)}">${esc(t.id)}</a></td>
        <td>${esc(t.workflowName)}</td>
        <td>${esc(t.shop ?? '—')}</td>
        <td>${esc(t.inputSummary)}</td>
        <td><span class="dsa-badge ${cls}">${statusLabel(t.status)}</span></td>
        <td>${progress}</td>
        <td>${esc(t.startedAt.replace('T', ' ').slice(0, 19))}</td>
        <td>${t.finishedAt ? esc(t.finishedAt.replace('T', ' ').slice(0, 19)) : '—'}</td>
        ${logCell}
        <td class="dsa-ops">${renderTaskOps(t)}</td>
      </tr>`
    }).join('')
    return `<table class="dsa-table"><thead><tr>
      <th>任务 ID</th><th>工作流</th><th>店铺</th><th>输入</th><th>状态</th><th>进度</th><th>开始时间</th><th>结束时间</th><th>日志</th><th>操作</th>
    </tr></thead><tbody>${rows}</tbody></table>`
  }

  function renderTasksTab(): string {
    return `<div class="dsa-wf-config">
      <h3>创建任务</h3>
      <div class="dsa-form-row"><label>模板</label>${renderTemplateSelect()}</div>
      <div class="dsa-form-row"><label>目标账号</label>${renderShopSelect()}</div>
      <div data-wf-inputs>${renderInputs()}</div>
      <div class="dsa-form-row" style="margin-top:12px"><label></label><button class="dsa-btn dsa-btn-primary" data-act="run-task">开始批量运行</button></div>
      ${renderSchedulePanel()}
    </div>
    ${renderFilterBar()}
    <div data-wf-task-list>${renderTaskTable()}</div>`
  }

  /** 读取模板 YAML 原文 */
  async function getTemplateYamlText(name: string): Promise<string | null> {
    try {
      const data = await api('workflow_get_template', { name })
      if (data && data.ok && typeof data.yaml === 'string') return data.yaml
      return null
    } catch { return null }
  }

  /** 在 YAML 文本里设置/更新/移除 schedule 段（保留其余内容） */
  function setScheduleInYaml(yaml: string, opts: { enabled: boolean; intervalMinutes?: number }): string {
    const lines = yaml.split('\n')
    // 先删掉已有的 schedule 段（从 schedule: 到下一个顶层 key）
    const out: string[] = []
    let skipping = false
    for (const line of lines) {
      if (/^schedule:\s*$/.test(line)) { skipping = true; continue }
      if (skipping) {
        if (/^[a-zA-Z_]/.test(line)) skipping = false
        else continue
      }
      out.push(line)
    }
    if (!opts.enabled) return out.join('\n')
    // 找到插入点：inputs: 之前，或 steps: 之前，或文件末尾
    const iv = opts.intervalMinutes && opts.intervalMinutes >= 5 ? Math.floor(opts.intervalMinutes) : 120
    const schedLines = ['schedule:', '  enabled: true', `  intervalMinutes: ${iv}`]
    const idxInputs = out.findIndex(l => /^inputs:/.test(l))
    const idxSteps = out.findIndex(l => /^steps:/.test(l))
    const insertAt = idxInputs >= 0 ? idxInputs : (idxSteps >= 0 ? idxSteps : out.length)
    out.splice(insertAt, 0, ...schedLines)
    return out.join('\n')
  }

  /** ★ 任务标签里的「定时执行」面板（针对当前选中的模板） */
  function renderSchedulePanel(): string {
    const name = (selectedTemplateName || '').trim()
    if (!name) {
      return `<div class="dsa-sched-panel">
        <div class="dsa-sched-panel-hd">⏰ 定时执行</div>
        <div class="dsa-sched-panel-bd dsa-dim">先选择模板，即可设置定时</div>
      </div>`
    }
    const tpl = templates.find(x => x.name === name)
    const enabled = Boolean(tpl?.scheduleEnabled)
    const nextAt = tpl?.nextRunAt ?? ''

    return `<div class="dsa-sched-panel${enabled ? ' on' : ''}">
      <div class="dsa-sched-panel-hd">⏰ 定时执行 <span class="dsa-sched-badge ${enabled ? 'on' : 'off'}">${enabled ? '已启用' : '未启用'}</span></div>
      <div class="dsa-sched-panel-bd">
        <div class="dsa-form-row" style="margin-bottom:8px"><label>间隔(分钟)</label>
          <input type="number" class="dsa-ctl" data-tasks-sch-interval value="${esc(taskScheduleInterval)}" min="5" step="5" placeholder="120">
        </div>
        ${enabled && nextAt ? `<div class="dsa-sched-next">下次触发：${esc(fmtLocal(nextAt))}</div>` : ''}
        ${enabled ? `<div class="dsa-dim" style="font-size:11.5px;margin-bottom:8px">填写分钟数后点右侧按钮即可修改</div>` : ''}
        <div class="dsa-sched-actions">
          <button class="dsa-btn dsa-btn-primary" data-act="sched-save">${enabled ? '保存间隔' : '开启定时'}</button>
          ${enabled ? `<button class="dsa-btn" data-act="sched-run-now">立即跑一次</button>
          <button class="dsa-btn" data-act="sched-quick-off">关闭定时</button>` : ''}
        </div>
      </div>
    </div>`
  }

  /* ─────────────── 渲染函数（编排标签） ─────────────── */

  function renderEditorList(): string {
    const items = templates.map(t =>
      `<div class="dsa-ed-item${editorState.selectedTemplate === t.name ? ' on' : ''}" data-ed-sel="${esc(t.name)}">
        <div class="dsa-ed-item-name">${esc(t.name)}</div>
        <div class="dsa-ed-item-meta">${esc(t.category)} · ${t.stepCount}步 · ${t.mode === 'batch' ? '批量' : '单次'}</div>
      </div>`)
    return items.join('') || '<div style="padding:20px;text-align:center;color:#8b93a7;font-size:12px">暂无模板</div>'
  }

  /* ── 流程画布：步骤卡片（影刀式，点击选中 → 右侧属性面板编辑） ── */

  function renderFlowCanvas(): string {
    const s = editorState
    const nodes = s.steps.map((step, i) => {
      const skill = stepSkills.find(sk => sk.id === step.skill)
      const skillName = skill ? skill.name : (step.skill ? step.skill : '未选择技能')
      const argSummary = skill?.contractArgs
        ? skill.contractArgs.map(ca => {
            const v = step.args.find(a => a.key === ca.name)?.val ?? ''
            return v ? `${ca.name}=${v}` : `${ca.name}=…`
          }).join('  ')
        : step.args.filter(a => a.key || a.val).map(a => `${a.key}=${a.val}`).join('  ')
      return `<div class="dsa-flow-node${i === s.selectedStepIndex ? ' on' : ''}" data-step="${i}">
        <div class="dsa-flow-node-hd">
          <span class="dsa-flow-node-num">${i + 1}</span>
          <input type="text" class="dsa-flow-node-name" data-ed-stepname="${i}" value="${esc(step.name)}" title="步骤名称">
          <span class="dsa-flow-node-skill" title="${esc(skillName)}">${esc(skillName)}</span>
          <div class="dsa-flow-node-ops">
            <button class="dsa-icon-btn" data-ed-moveup="${i}"${i === 0 ? ' disabled' : ''} title="上移">↑</button>
            <button class="dsa-icon-btn" data-ed-movedown="${i}"${i === s.steps.length - 1 ? ' disabled' : ''} title="下移">↓</button>
            <button class="dsa-icon-btn danger" data-ed-delstep="${i}" title="删除步骤">✕</button>
          </div>
        </div>
        <div class="dsa-flow-node-bd">
          <div class="row"><span class="k">技能</span><span class="v${skill ? '' : ' empty'}">${esc(skillName)}</span></div>
          <div class="row"><span class="k">参数</span><span class="v${argSummary ? '' : ' empty'}">${esc(argSummary || '未配置')}</span></div>
          <div class="row"><span class="k">输出</span><span class="v${step.output ? '' : ' empty'}">${esc(step.output ? `{{${step.output}.raw}}` : '未命名')}</span></div>
        </div>
      </div>`
    })
    // 卡片之间的连接线 + ＋ 插入按钮；末尾追加
    const conn = (insertAfter: number) =>
      `<div class="dsa-flow-conn"><div class="dsa-flow-conn-line"></div><button class="dsa-flow-insert" data-ed-insert="${insertAfter}" title="在此插入步骤">＋</button><div class="dsa-flow-conn-line"></div></div>`
    return `<div class="dsa-flow-start"><div class="dsa-flow-cap dsa-flow-start-cap">开始</div></div>
      ${nodes.length ? nodes.map((n, i) => n + conn(i)).join('') : conn(-1)}
      <div class="dsa-flow-end"><div class="dsa-flow-cap dsa-flow-end-cap">流程结束</div></div>`
  }

  /* ── 属性面板：当前选中步骤的编辑表单 ── */

  function renderStepPropForm(): string {
    const s = editorState
    const i = s.selectedStepIndex
    const step = s.steps[i]
    if (i < 0 || !step) {
      return `<div class="dsa-prop-empty"><div class="ico">⚙️</div><div>点击画布中的步骤卡片<br>在此配置技能、参数与输出</div></div>`
    }
    const skillOpts = stepSkills.map(sk =>
      `<option value="${esc(sk.id)}"${step.skill === sk.id ? ' selected' : ''}>${esc(sk.name)}（${esc(sk.platform === 'common' ? '通用' : sk.platform)}）</option>`)
    const skillSelect = `<select class="dsa-ctl" data-ed-skill><option value="">— 选择技能 —</option>${skillOpts.join('')}</select>`

    // 参数绑定行（契约技能按契约表展平，其余自由 key=val）
    let paramRows = ''
    const selSkill = stepSkills.find(sk => sk.id === step.skill)
    if (selSkill?.contractArgs) {
      paramRows = selSkill.contractArgs.map(ca => {
        const existing = step.args.find(a => a.key === ca.name)
        const dflt = ca.default !== undefined ? String(ca.default) : ''
        const val = existing ? existing.val : dflt
        return `<div class="dsa-form-row"><label title="${esc(ca.description || ca.type)}">${esc(ca.name)}${ca.required ? '<span class="dsa-wf-req">*</span>' : ''}</label>
          <input type="text" class="dsa-ctl" data-ed-arg="${esc(ca.name)}" value="${esc(val)}" placeholder="${esc(ca.description || ca.type)}"${dflt ? ` data-prefill="${esc(dflt)}"` : ''}></div>`
      }).join('')
    } else if (selSkill) {
      paramRows = step.args.map((a, ai) =>
        `<div class="dsa-args">
          <input type="text" class="dsa-ctl" data-ed-argkey="${ai}" value="${esc(a.key)}" placeholder="参数名">
          <input type="text" class="dsa-ctl" data-ed-argval="${ai}" value="${esc(a.val)}" placeholder="参数值或 {{var}}">
        </div>`).join('')
      paramRows += `<button class="dsa-btn" data-ed-addarg style="font-size:12px;padding:3px 10px">+ 参数</button>`
    } else {
      paramRows = '<div class="dsa-dim" style="font-size:12px;padding:4px 0">请先选择技能</div>'
    }

    return `<button class="dsa-prop-back" data-ed-back title="取消选中，返回模板设置">← 返回模板设置</button>
      <div class="dsa-form-row"><label>技能</label>${skillSelect}</div>
      <div class="dsa-sec">参数绑定</div>
      ${paramRows}
      <div class="dsa-sec">输出与失败策略</div>
      <div class="dsa-form-row"><label>输出变量</label><input type="text" class="dsa-ctl" data-ed-output value="${esc(step.output)}" placeholder="步骤输出变量名"></div>
      <details class="dsa-advanced"><summary>高级</summary>
        <div class="dsa-form-row"><label>失败策略</label><select class="dsa-ctl" data-ed-failure>
          <option value="continue"${step.on_failure === 'continue' ? ' selected' : ''}>继续下一轮</option>
          <option value="abort"${step.on_failure === 'abort' ? ' selected' : ''}>停止整个任务</option>
        </select></div>
      </details>`
  }

  /* ── 属性面板：模板基本信息 + 变量管理（无选中步骤时展示） ── */

  function renderTplPropForm(): string {
    const s = editorState
    return `<div class="dsa-form-row"><label>模板名</label><input type="text" class="dsa-ctl" data-ed-name value="${esc(s.name)}" placeholder="如：批量上架商品"></div>
      <div class="dsa-form-row"><label>分类</label><select class="dsa-ctl" data-ed-category>${CATEGORIES.map(c => `<option value="${esc(c)}"${s.category === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="dsa-form-row"><label>执行模式</label><select class="dsa-ctl" data-ed-mode>
        <option value="batch"${s.mode === 'batch' ? ' selected' : ''}>批量循环（batch）</option>
        <option value="single"${s.mode === 'single' ? ' selected' : ''}>单次执行（single）</option>
      </select></div>
      <div class="dsa-form-row"${s.mode === 'single' ? ' style="display:none"' : ''}><label>数量字段</label><select class="dsa-ctl" data-ed-countinput>${s.inputs.map(i => `<option value="${esc(i.key)}"${s.count_input === i.key ? ' selected' : ''}>${esc(i.key)}（${esc(i.label)}）</option>`).join('')}</select></div>
      <div class="dsa-form-row"><label>描述</label><input type="text" class="dsa-ctl" data-ed-desc value="${esc(s.description)}" placeholder="模板说明"></div>
      <div class="dsa-sec">定期执行</div>
      ${renderScheduleForm()}
      <div class="dsa-sec">输入变量</div>
      ${renderEditorVars()}`
  }

  /** ★ 定期执行配置表单（只需填分钟数） */
  function renderScheduleForm(): string {
    const sc = editorState.schedule
    const iv = Number(sc.intervalMinutes) || 0
    // 全天 24h 的触发次数（供参考）
    const perDay = iv > 0 ? (24 * 60) / iv : 0
    const perDayText = perDay >= 1
      ? `全天 ${perDay % 1 === 0 ? perDay : perDay.toFixed(1)} 次`
      : ''

    const statusLine = sc.enabled
      ? (sc.nextRunAt
          ? `<div class="dsa-sched-status">⏰ 每 ${esc(sc.intervalMinutes)} 分钟${perDayText ? '｜' + perDayText : ''}｜下次 ${esc(fmtLocal(sc.nextRunAt))}</div>`
          : `<div class="dsa-sched-status">⏰ 每 ${esc(sc.intervalMinutes)} 分钟${perDayText ? '｜' + perDayText : ''}</div>`)
      : `<div class="dsa-sched-status dsa-dim">⏸ 未启用（仅手动运行）</div>`
    const lastLine = sc.lastRunAt
      ? `<div class="dsa-sched-sub">上次：${esc(fmtLocal(sc.lastRunAt))}</div>`
      : ''

    return `<div class="dsa-sched">
      <div class="dsa-form-row"><label>启用</label>
        <label class="dsa-sched-toggle"><input type="checkbox" data-sch-enabled${sc.enabled ? ' checked' : ''}> <span>${sc.enabled ? '已开启定期执行' : '关闭'}</span></label>
      </div>
      ${statusLine}${lastLine}
      <div class="dsa-sched-body"${sc.enabled ? '' : ' style="display:none"'}>
        <div class="dsa-form-row"><label>间隔(分钟)</label>
          <input type="number" class="dsa-ctl" data-sch-interval value="${esc(sc.intervalMinutes)}" min="5" step="5" placeholder="120">
        </div>
        <div class="dsa-sched-presets">
          <button class="dsa-btn" data-sch-preset="60">60</button>
          <button class="dsa-btn" data-sch-preset="120">120</button>
          <button class="dsa-btn" data-sch-preset="144">144</button>
          <button class="dsa-btn" data-sch-preset="240">240</button>
          <button class="dsa-btn" data-sch-preset="1440">1440</button>
        </div>
      </div>
    </div>`
  }

  /** 时间戳 → 本地可读 */
  function fmtLocal(iso: string): string {
    if (!iso) return ''
    try {
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return iso
      const p = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    } catch { return iso }
  }

  function renderVarEditForm(idx: number): string {
    const inp = editorState.inputs[idx]
    if (!inp) return ''
    const typeOpts = (['text', 'number', 'textarea', 'select', 'date'] as const).map(t =>
      `<option value="${t}"${inp.type === t ? ' selected' : ''}>${t}</option>`)
    const advanced = inp.type === 'select'
      ? `<div class="dsa-advanced"><summary>高级设置</summary>
          <div class="dsa-form-row"><label>选项</label><input type="text" class="dsa-ctl" data-var-options value="${esc(inp.options)}" placeholder="逗号分隔，如：a, b, c"></div>
        </div>`
      : inp.type === 'number'
        ? `<div class="dsa-advanced"><summary>高级设置</summary>
            <div class="dsa-form-row"><label>最小值</label><input type="number" class="dsa-ctl" data-var-min value="${esc(inp.min)}"></div>
            <div class="dsa-form-row"><label>最大值</label><input type="number" class="dsa-ctl" data-var-max value="${esc(inp.max)}"></div>
          </div>`
        : ''
    return `<div class="dsa-vars-edit">
      <div class="dsa-form-row"><label>标识</label><input type="text" class="dsa-ctl" data-var-key value="${esc(inp.key)}"></div>
      <div class="dsa-form-row"><label>显示名</label><input type="text" class="dsa-ctl" data-var-label value="${esc(inp.label)}"></div>
      <div class="dsa-form-row"><label>类型</label><select class="dsa-ctl" data-var-type>${typeOpts.join('')}</select></div>
      <div class="dsa-form-row"><label>必填</label><input type="checkbox" data-var-required${inp.required ? ' checked' : ''} style="margin:0"></div>
      <div class="dsa-form-row"><label>默认值</label><input type="text" class="dsa-ctl" data-var-default value="${esc(inp.default)}"></div>
      ${advanced}
      <div style="display:flex;gap:8px;margin-top:8px"><button class="dsa-btn dsa-btn-primary" data-var-save="${idx}">保存</button><button class="dsa-btn" data-var-cancel>取消</button></div>
    </div>`
  }

  function renderEditorVars(): string {
    const inputItems = editorState.inputs.map((inp, i) =>
      `<div class="dsa-var-item" data-var-edit="${i}">
        <span class="dsa-var-name">${esc(inp.key)}</span>
        <span class="dsa-var-type">${esc(inp.type)}</span>
      </div>`).join('')
    const stepOutputs = editorState.steps.filter(s => s.output).map(s =>
      `<div class="dsa-var-item"><span class="dsa-var-name">${esc(s.output)}</span><span class="dsa-var-type">output</span></div>`).join('')
    const loopVars = ['loop.index', 'loop.total', 'loop.round_ok'].map(v =>
      `<div class="dsa-var-item"><span class="dsa-var-name">${esc(v)}</span><span class="dsa-var-type">loop</span></div>`).join('')

    const editingForm = editorState.varEditIndex >= 0 ? renderVarEditForm(editorState.varEditIndex) : ''

    return `<div class="dsa-var-group">
      <div class="dsa-var-group-title">输入变量<span class="dsa-var-count">${editorState.inputs.length}</span><button class="dsa-icon-btn" data-var-add title="添加输入变量" style="margin-left:auto">＋</button></div>
      ${inputItems || '<div style="color:#8b93a7;font-size:12px;padding:4px 8px">暂无输入变量</div>'}
    </div>
    <div class="dsa-var-group">
      <div class="dsa-var-group-title">步骤输出<span class="dsa-var-count">${stepOutputs ? editorState.steps.filter(s => s.output).length : 0}</span></div>
      ${stepOutputs || '<div style="color:#8b93a7;font-size:12px;padding:4px 8px">暂无</div>'}
    </div>
    <div class="dsa-var-group">
      <div class="dsa-var-group-title">循环变量</div>
      ${loopVars}
    </div>
    ${editingForm}`
  }

  function renderEditorTab(): string {
    const selIdx = editorState.selectedStepIndex
    const propTitle = selIdx >= 0 && editorState.steps[selIdx]
      ? `步骤属性 · ${esc(editorState.steps[selIdx].name || `#${selIdx + 1}`)}`
      : '模板设置'
    return `<div class="dsa-editor">
      <div class="dsa-editor-col dsa-editor-list">
        <div class="dsa-editor-list-hd">模板列表<button class="dsa-icon-btn" data-ed-new title="新建模板">＋</button></div>
        <div class="dsa-editor-list-bd" data-ed-list>${renderEditorList()}</div>
      </div>
      <div class="dsa-editor-col dsa-flow">
        <div class="dsa-flow-bd" data-ed-main>${renderFlowCanvas()}</div>
      </div>
      <div class="dsa-editor-col dsa-prop">
        <div class="dsa-prop-hd"><span data-prop-title>${propTitle}</span><span class="dsa-var-count" data-step-pos>${selIdx >= 0 && editorState.steps[selIdx] ? `${selIdx + 1} / ${editorState.steps.length}` : ''}</span></div>
        <div class="dsa-prop-bd" data-ed-prop>${selIdx >= 0 && editorState.steps[selIdx] ? renderStepPropForm() : renderTplPropForm()}</div>
      </div>
    </div>
    <div class="dsa-editor-ft">
      <button class="dsa-btn dsa-btn-primary" data-ed-save>保存模板</button>
      <button class="dsa-btn" data-ed-yaml>预览 YAML</button>
      <button class="dsa-btn" data-ed-import>导入 YAML</button>
      <button class="dsa-btn dsa-btn-danger" data-ed-delete>删除模板</button>
    </div>`
  }

  /* ─────────────── YAML 生成 / 导入 ─────────────── */

  /** YAML 值引号包裹：含特殊字符时用双引号包裹并转义内部引号 */
  function yamlQuote(v: string): string {
    if (v === '') return '""'
    // 需要引号包裹的特殊字符：冒号、井号、花括号、方括号、引号、逗号、&、*、?、|、>、%、@、`、空格、换行
    if (/[:#{}"',&*?|>%@`\s\n]/.test(v) || v === 'true' || v === 'false' || v === 'null' || /^\d/.test(v)) {
      return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    }
    return v
  }

  function generateYaml(): string {
    const s = editorState
    const lines: string[] = []
    lines.push(`name: ${yamlQuote(s.name)}`)
    if (s.category) lines.push(`category: ${yamlQuote(s.category)}`)
    lines.push(`mode: ${s.mode}`)
    if (s.mode === 'batch' && s.count_input) lines.push(`count_input: ${yamlQuote(s.count_input)}`)
    if (s.description) lines.push(`description: ${yamlQuote(s.description)}`)
    // ★ 定期执行（按间隔）
    const sch = s.schedule
    if (sch.enabled) {
      const iv = Number(sch.intervalMinutes)
      const safeIv = Number.isFinite(iv) && iv >= 5 ? Math.floor(iv) : 60
      lines.push('schedule:')
      lines.push('  enabled: true')
      lines.push(`  intervalMinutes: ${safeIv}`)
    }
    if (s.inputs.length) {
      lines.push('inputs:')
      for (const inp of s.inputs) {
        lines.push(`  - key: ${yamlQuote(inp.key)}`)
        lines.push(`    label: ${yamlQuote(inp.label)}`)
        lines.push(`    type: ${inp.type}`)
        if (inp.required) lines.push(`    required: true`)
        if (inp.default) lines.push(`    default: ${yamlQuote(inp.default)}`)
        if (inp.type === 'number') {
          if (inp.min) lines.push(`    min: ${inp.min}`)
          if (inp.max) lines.push(`    max: ${inp.max}`)
        }
        if (inp.type === 'select' && inp.options) lines.push(`    options: [${inp.options.split(',').map(o => o.trim()).join(', ')}]`)
      }
    }
    lines.push('steps:')
    for (const step of s.steps) {
      lines.push(`  - name: ${yamlQuote(step.name)}`)
      lines.push(`    skill: ${yamlQuote(step.skill)}`)
      if (step.args.length) {
        lines.push(`    args:`)
        for (const a of step.args) {
          lines.push(`      ${yamlQuote(a.key)}: ${yamlQuote(a.val)}`)
        }
      }
      if (step.output) lines.push(`    output: ${yamlQuote(step.output)}`)
      lines.push(`    on_failure: ${step.on_failure}`)
    }
    return lines.join('\n')
  }

  async function loadYamlToEditor(name: string): Promise<boolean> {
    try {
      const data = await api('workflow_get_template', { name })
      if (!data || !data.ok || !data.yaml) { return false }
      const yamlText: string = data.yaml
      // 轻量逐行解析
      const lines = yamlText.split('\n')
      // ★ 重置 schedule（每次加载模板都从文件重建）
      editorState.schedule = {
        enabled: false, intervalMinutes: '120',
        lastRunAt: '', nextRunAt: '',
      }
      parseScheduleFromYaml(yamlText)
      const s = newTemplateState()
      // newTemplateState 自带 1 个默认输入和 1 个默认空步骤，解析前清空，避免残留成“幽灵步骤”
      s.inputs = []
      s.steps = []
      s.selectedTemplate = name
      let currentSection = ''
      let currentStep: EdStep | null = null
      let currentInput: Partial<EdInput> | null = null
      let inArgsBlock = false

      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '')
        if (!line.trim() || line.trim().startsWith('#')) continue
        // 顶层 key
        const topKv = line.match(/^(\w+)\s*:\s*(.*)$/)
        if (topKv && !line.startsWith(' ')) {
          if (currentStep) { s.steps.push(currentStep); currentStep = null }
          if (currentInput) { s.inputs.push(normalizeEdInput(currentInput)); currentInput = null }
          inArgsBlock = false
          const [, k, v] = topKv
          currentSection = k
          if (k === 'name') s.name = v.trim()
          else if (k === 'category') s.category = v.trim()
          else if (k === 'mode') s.mode = v.trim() === 'single' ? 'single' : 'batch'
          else if (k === 'count_input') s.count_input = v.trim()
          else if (k === 'description') s.description = v.trim()
          continue
        }
        // 列表项起始（inputs / steps 的 `- `）
        const itemMatch = line.match(/^\s+-\s+(.*)$/)
        if (itemMatch) {
          if (currentSection === 'inputs') {
            if (currentInput) s.inputs.push(normalizeEdInput(currentInput))
            currentInput = {}
            const rest = itemMatch[1]
            const kv = rest.match(/^(\w+)\s*:\s*(.*)$/)
            if (kv) { const [, k, v] = kv; (currentInput as Record<string, unknown>)[k] = v.trim() }
          } else if (currentSection === 'steps') {
            if (currentStep) s.steps.push(currentStep)
            currentStep = { name: '', skill: '', args: [], output: '', on_failure: 'continue' }
            inArgsBlock = false
            const rest = itemMatch[1]
            const kv = rest.match(/^(\w+)\s*:\s*(.*)$/)
            if (kv) { const [, k, v] = kv; if (k === 'name') currentStep.name = v.trim(); else if (k === 'skill') currentStep.skill = v.trim() }
          }
          continue
        }
        // 子属性
        const subKv = line.match(/^\s+(\w+)\s*:\s*(.*)$/)
        if (subKv) {
          const [, k, v] = subKv
          const val = v.trim()
          if (currentInput) {
            if (k === 'options') (currentInput as Record<string, unknown>)[k] = val
            else if (k === 'required') (currentInput as Record<string, unknown>)[k] = val === 'true'
            else (currentInput as Record<string, unknown>)[k] = val
          } else if (currentStep) {
            if (k === 'args') {
              // args 段开始，后续 key: val 行作为 args 子项
              inArgsBlock = true
            } else if (k === 'output') { currentStep.output = val; inArgsBlock = false }
            else if (k === 'on_failure') { currentStep.on_failure = val === 'abort' ? 'abort' : 'continue'; inArgsBlock = false }
            else if (k === 'name') { currentStep.name = val; inArgsBlock = false }
            else if (k === 'skill') { currentStep.skill = val; inArgsBlock = false }
            else {
              // 未知 key: val 视为 args 子项
              currentStep.args.push({ key: k, val })
            }
          }
          continue
        }
      }
      if (currentStep) s.steps.push(currentStep)
      if (currentInput) s.inputs.push(normalizeEdInput(currentInput))
      editorState = s
      return true
    } catch { return false }
  }

  function normalizeEdInput(raw: Partial<EdInput>): EdInput {
    const type = raw.type === 'number' || raw.type === 'textarea' || raw.type === 'select' || raw.type === 'date'
      ? raw.type : 'text'
    return {
      key: String(raw.key ?? ''),
      label: String(raw.label ?? raw.key ?? ''),
      type,
      required: Boolean(raw.required),
      default: String(raw.default ?? ''),
      min: String(raw.min ?? ''),
      max: String(raw.max ?? ''),
      options: String(raw.options ?? ''),
    }
  }

  /* ─────────────── 任务详情弹窗 ─────────────── */

  /** 详情弹窗中的日志区域（含复制按钮） */
  function renderDetailLogs(task: WorkflowTask): string {
    const loggedRounds = task.rounds.filter(r => r.logs?.length)
    if (!loggedRounds.length) return ''
    const roundsHtml = loggedRounds.map(r => {
      const lines = (r.logs ?? []).map(l => {
        const ok = !l.includes('✗失败')
        return `<div class="dsa-wf-log-line ${ok ? 'ok' : 'fail'}">${esc(l)}</div>`
      }).join('')
      return `<div class="dsa-wf-log-round">第${r.index}轮 · ${r.status === 'ok' ? '成功' : '失败'} · ${r.durationMs}ms</div>${lines}`
    }).join('')
    return `<div style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <b style="font-size:13px">执行日志</b>
        <button class="dsa-wf-pop-copy" data-log-copy="${esc(task.id)}">复制</button>
      </div>
      <div style="background:#f7f9fc;border:1px solid #eceff5;border-radius:6px;padding:10px;max-height:280px;overflow:auto">${roundsHtml}</div>
    </div>`
  }

  function renderTaskDetail(task: WorkflowTask): string {
    const rounds = task.rounds
    const failedRounds = rounds.filter(r => r.status === 'failed')
    const roundRows = failedRounds.length
      ? `<div style="margin-top:12px"><div style="font-weight:600;margin-bottom:6px">失败轮次明细</div>
          <table class="dsa-table"><thead><tr><th>轮次</th><th>耗时</th><th>错误</th></tr></thead><tbody>
          ${failedRounds.map(r => `<tr><td>#${r.index}</td><td>${r.durationMs}ms</td><td style="color:#d93b3b">${esc(r.error ?? '')}</td></tr>`).join('')}
          </tbody></table></div>`
      : '<div style="margin-top:12px;color:#1a9f4d">无失败轮次</div>'
    return `<div class="dsa-modal-hd"><b>任务详情：${esc(task.id)}</b><button class="dsa-x" data-act="close-modal">✕</button></div>
    <div class="dsa-modal-bd">
      <div style="display:grid;grid-template-columns:100px 1fr;gap:6px 12px;font-size:13px">
        <span style="color:#8b93a7">工作流</span><span>${esc(task.workflowName)}</span>
        <span style="color:#8b93a7">店铺</span><span>${esc(task.shop ?? '（未指定）')}</span>
        <span style="color:#8b93a7">输入</span><span>${esc(task.inputSummary)}</span>
        <span style="color:#8b93a7">状态</span><span><span class="dsa-badge ${statusBadgeClass(task.status)}">${statusLabel(task.status)}</span></span>
        <span style="color:#8b93a7">进度</span><span>${task.current}/${task.target}（成功 ${task.success} / 失败 ${task.failed}）</span>
        <span style="color:#8b93a7">开始时间</span><span>${esc(task.startedAt.replace('T', ' ').slice(0, 19))}</span>
        ${task.finishedAt ? `<span style="color:#8b93a7">结束时间</span><span>${esc(task.finishedAt.replace('T', ' ').slice(0, 19))}</span>` : ''}
      </div>
      ${task.error ? `<div style="margin-top:12px;padding:10px;background:#fdecec;border-radius:6px;color:#d93b3b;font-size:12px">${esc(task.error)}</div>` : ''}
      ${roundRows}
      ${renderDetailLogs(task)}
    </div>
    <div class="dsa-modal-ft"><button class="dsa-btn" data-act="close-modal">关闭</button></div>`
  }

  /* ─────────────── 页面主体渲染 ─────────────── */

  function renderBody(): string {
    if (subtab === 'tasks') return renderTasksTab()
    return renderEditorTab()
  }

  /* ─────────────── 轮询 ─────────────── */

  function startPolling(): void {
    stopPolling()
    pollTimer = window.setInterval(async () => {
      // 仅当存在 running/queued 任务时才实际刷新
      const hasActive = tasks.some(t => t.status === 'running' || t.status === 'queued')
      if (!hasActive) { stopPolling(); return }
      await loadTasks()
      if (rootEl) {
        const list = rootEl.querySelector('[data-wf-task-list]')
        if (list) list.innerHTML = renderTaskTable()
        // 如果任务详情弹窗打开，同步刷新弹窗内容
        if (currentTaskDetailId) {
          const task = tasks.find(t => t.id === currentTaskDetailId)
          const modal = rootEl.querySelector('[data-modal]') as HTMLElement | null
          if (task && modal && !modal.hidden) {
            modal.innerHTML = renderTaskDetail(task)
          }
        }
      }
    }, 5000)
  }

  function stopPolling(): void {
    if (pollTimer) { window.clearInterval(pollTimer); pollTimer = 0 }
  }

  async function refreshTaskList(): Promise<void> {
    await loadTasks()
    if (rootEl) {
      const list = rootEl.querySelector('[data-wf-task-list]')
      if (list) list.innerHTML = renderTaskTable()
    }
    // 有运行/排队任务时启动轮询
    const hasActive = tasks.some(t => t.status === 'running' || t.status === 'queued')
    if (hasActive) startPolling()
  }

  function refreshYamlPreview(): void {
    if (rootEl) {
      const el = rootEl.querySelector('[data-yaml-preview]')
      if (el) el.textContent = generateYaml()
    }
  }

  /* ─────────────── 返回对象 ─────────────── */

  return {
    api,
    async html(): Promise<string> {
      await Promise.all([loadTemplates(), loadAccounts(), loadStepSkills(), loadTasks()])
      return `
        <div class="dsa-page">
          <header class="dsa-hd">
            <div>
              <h2>工作流</h2>
              <p class="dsa-dim">数据驱动的多步骤批量任务：选模板 → 填输入 → 批量执行 → 轮询进度。</p>
            </div>
          </header>
          <div class="dsa-subtabs">
            <button class="dsa-subtab${subtab === 'tasks' ? ' on' : ''}" data-subtab="tasks">工作流任务</button>
            <button class="dsa-subtab${subtab === 'editor' ? ' on' : ''}" data-subtab="editor">工作流编排</button>
          </div>
          <div data-wf-body>${renderBody()}</div>
          <div class="dsa-mask" hidden data-modal></div>
          <div class="dsa-toast" hidden></div>
        </div>
        <style>${WORKFLOW_CSS}</style>`
    },

    mount(root: HTMLElement) {
      rootEl = root
      const q = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector(sel) as T
      const toast = q('.dsa-toast')
      const modal = q('[data-modal]')

      function say(msg: string) {
        toast.textContent = msg
        toast.hidden = false
        window.setTimeout(() => { toast.hidden = true }, 2000)
      }

      let longTimer = 0
      function sayLong(msg: string) {
        toast.textContent = msg
        toast.hidden = false
        toast.classList.add('dsa-toast-long')
        if (longTimer) window.clearTimeout(longTimer)
        const dismiss = () => {
          toast.hidden = true
          toast.classList.remove('dsa-toast-long')
          toast.removeEventListener('click', dismiss)
          if (longTimer) { window.clearTimeout(longTimer); longTimer = 0 }
        }
        toast.addEventListener('click', dismiss)
        longTimer = window.setTimeout(dismiss, 12_000)
      }

      function repaintBody(): void {
        // ★ 渲染前先从现有 DOM 同步模板选择（避免首次渲染时变量为空）
        try {
          const sel = q<HTMLSelectElement>('[data-wf-template]')
          if (sel && sel.value) selectedTemplateName = sel.value
        } catch { /* 首次渲染时下拉框还不存在 */ }
        q('[data-wf-body]').innerHTML = renderBody()
        // 更新子标签高亮
        root.querySelectorAll('.dsa-subtab').forEach(el => {
          const k = (el as HTMLElement).dataset.subtab
          el.classList.toggle('on', k === subtab)
        })
      }

      /** 从 DOM 同步编辑器状态（input/change 事件触发） */
      function syncEditorFromDom(): void {
    // ★ 定期执行
    {
      const sc = editorState.schedule
      const en = q<HTMLInputElement>('[data-sch-enabled]')
      if (en) sc.enabled = en.checked
      const iv = q<HTMLInputElement>('[data-sch-interval]')
      if (iv) sc.intervalMinutes = iv.value
    }

        const s = editorState
        // 模板基本信息（属性面板 - 模板设置态）
        const nameEl = q<HTMLInputElement>('[data-ed-name]')
        if (nameEl) s.name = nameEl.value
        const catEl = q<HTMLSelectElement>('[data-ed-category]')
        if (catEl) s.category = catEl.value
        const modeEl = q<HTMLSelectElement>('[data-ed-mode]')
        if (modeEl) s.mode = modeEl.value as WorkflowMode
        const ciEl = q<HTMLSelectElement>('[data-ed-countinput]')
        if (ciEl) s.count_input = ciEl.value
        const descEl = q<HTMLInputElement>('[data-ed-desc]')
        if (descEl) s.description = descEl.value

        // 画布节点内联改名
        root.querySelectorAll('[data-ed-stepname]').forEach(el => {
          const inputEl = el as HTMLInputElement
          const idx = Number(inputEl.dataset.edStepname)
          const step = s.steps[idx]
          if (step) step.name = inputEl.value
        })

        // 属性面板控件（选中步骤态）：同步到 steps[selectedStepIndex]
        const si = s.selectedStepIndex
        const step = si >= 0 ? s.steps[si] : undefined
        if (step) {
          const skillSel = q<HTMLSelectElement>('[data-ed-skill]')
          if (skillSel) step.skill = skillSel.value
          const outputInput = q<HTMLInputElement>('[data-ed-output]')
          if (outputInput) step.output = outputInput.value
          const failureSel = q<HTMLSelectElement>('[data-ed-failure]')
          if (failureSel) step.on_failure = failureSel.value as 'continue' | 'abort'
          // 参数绑定（契约技能：固定参数名；非契约：自由 key/val）
          const selSkill = stepSkills.find(sk => sk.id === step.skill)
          if (selSkill?.contractArgs) {
            for (const ca of selSkill.contractArgs) {
              const argEl = root.querySelector<HTMLInputElement>(`[data-ed-arg="${CSS.escape(ca.name)}"]`)
              if (!argEl) continue
              const existing = step.args.find(a => a.key === ca.name)
              if (existing) existing.val = argEl.value
              else step.args.push({ key: ca.name, val: argEl.value })
            }
          } else {
            step.args = []
            root.querySelectorAll<HTMLInputElement>('[data-ed-argkey]').forEach(keyEl => {
              const ai = Number(keyEl.dataset.edArgkey)
              const valEl = root.querySelector<HTMLInputElement>(`[data-ed-argval="${ai}"]`)
              step.args.push({ key: keyEl.value, val: valEl ? valEl.value : '' })
            })
          }
        }

        // 变量编辑表单（若打开）：持续同步，避免局部重绘丢失已填字段
        const ve = s.varEditIndex >= 0 ? s.inputs[s.varEditIndex] : undefined
        if (ve) {
          const keyEl = q<HTMLInputElement>('[data-var-key]')
          if (keyEl) ve.key = keyEl.value
          const labelEl = q<HTMLInputElement>('[data-var-label]')
          if (labelEl) ve.label = labelEl.value
          const typeEl = q<HTMLSelectElement>('[data-var-type]')
          if (typeEl) ve.type = typeEl.value as WorkflowInputType
          const reqEl = q<HTMLInputElement>('[data-var-required]')
          if (reqEl) ve.required = reqEl.checked
          const defaultEl = q<HTMLInputElement>('[data-var-default]')
          if (defaultEl) ve.default = defaultEl.value
          const optionsEl = q<HTMLInputElement>('[data-var-options]')
          if (optionsEl) ve.options = optionsEl.value
          const minEl = q<HTMLInputElement>('[data-var-min]')
          if (minEl) ve.min = minEl.value
          const maxEl = q<HTMLInputElement>('[data-var-max]')
          if (maxEl) ve.max = maxEl.value
        }
      }

      const onClick = async (e: Event) => {
        const t = e.target as HTMLElement

        // 子标签切换
        const subEl = t.closest('[data-subtab]') as HTMLElement | null
        if (subEl) {
          const newTab = subEl.dataset.subtab as 'tasks' | 'editor'
          if (newTab === subtab) return
          stopPolling()
          subtab = newTab
          repaintBody()
          return
        }

        // 关闭弹窗
        const closeEl = t.closest('[data-act="close-modal"]') as HTMLElement | null
        if (closeEl) { modal.hidden = true; currentTaskDetailId = ''; return }

        // 筛选器
        const filterEl = t.closest('[data-filter]') as HTMLElement | null
        if (filterEl) {
          const key = filterEl.dataset.filter as string
          const val = (filterEl as HTMLSelectElement | HTMLInputElement).value
          if (key === 'status') filterStatus = val
          else if (key === 'shop') filterShop = val
          else if (key === 'from') filterFrom = val
          else if (key === 'to') filterTo = val
          await refreshTaskList()
          return
        }

        // 开始运行任务
        // ★ 定时：保存间隔（同时开启）
        const schedSaveEl = t.closest('[data-act="sched-save"]') as HTMLElement | null
        if (schedSaveEl) {
          const tplName = (selectedTemplateName || '').trim()
          if (!tplName) { say('请先选择模板'); return }
          const ivEl = q<HTMLInputElement>('[data-tasks-sch-interval]')
          const iv = Number(ivEl?.value ?? taskScheduleInterval)
          if (!Number.isFinite(iv) || iv < 5) { say('间隔必须 ≥ 5 分钟'); return }
          taskScheduleInterval = String(Math.floor(iv))
          try {
            const yaml = await getTemplateYamlText(tplName)
            if (!yaml) { say('读取模板失败'); return }
            const updated = setScheduleInYaml(yaml, { enabled: true, intervalMinutes: Math.floor(iv) })
            const r = await api('workflow_save_template', { yaml: updated, originalName: tplName })
            if (r && r.ok) {
              say(`已设置定时：每 ${Math.floor(iv)} 分钟`)
              await loadTemplates()
              repaintBody()
            } else { say('保存失败：' + (r?.error ?? (Array.isArray(r?.issues) ? r.issues.join('; ') : ''))) }
          } catch (err) { say('出错：' + (err as Error).message) }
          return
        }
        // ★ 定时：关闭
        const schedOffEl = t.closest('[data-act="sched-quick-off"]') as HTMLElement | null
        if (schedOffEl) {
          const tplName3 = (selectedTemplateName || '').trim()
          if (!tplName3) return
          try {
            const yaml = await getTemplateYamlText(tplName3)
            if (!yaml) { say('读取模板失败'); return }
            const updated = setScheduleInYaml(yaml, { enabled: false })
            const r = await api('workflow_save_template', { yaml: updated, originalName: tplName3 })
            if (r && r.ok) {
              say('已关闭定时')
              await loadTemplates()
              repaintBody()
            } else { say('保存失败：' + (r?.error ?? (Array.isArray(r?.issues) ? r.issues.join('; ') : ''))) }
          } catch (err) { say('出错：' + (err as Error).message) }
          return
        }
        // ★ 定时：立即跑一次
        const schedRunEl = t.closest('[data-act="sched-run-now"]') as HTMLElement | null
        if (schedRunEl) {
          const tplName4 = (selectedTemplateName || '').trim()
          if (!tplName4) return
          try {
            const inputs: Record<string, string> = {}
            for (const inp of currentInputs) {
              const el = q<HTMLInputElement>(`[data-input="${inp.key}"]`)
              if (el) inputs[inp.key] = el.value
            }
            const r = await api('workflow_run_schedule_now', { name: tplName4, inputs })
            if (r && r.ok) {
              say(`已提交运行（任务 ${r.taskId ?? ''}）`)
              await loadTasks()
              repaintBody()
            } else { say('提交失败：' + (r?.error ?? '未知')) }
          } catch (e) { say('出错：' + (e as Error).message) }
          return
        }

        const runEl = t.closest('[data-act="run-task"]') as HTMLElement | null
        if (runEl) {
          if (!selectedTemplateName) { say('请先选择工作流模板'); return }
          const shopSel = q<HTMLSelectElement>('[data-wf-shop]')
          const shop = shopSel?.value || ''
          const inputs: Record<string, string | number> = {}
          root.querySelectorAll('[data-wf-input]').forEach(el => {
            const inputEl = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
            const key = inputEl.dataset.wfInput as string
            const val = inputEl.value
            const def = currentInputs.find(d => d.key === key)
            if (def?.type === 'number' && val) {
              inputs[key] = Number(val)
            } else {
              inputs[key] = val
            }
          })
          try {
            const data = await api('workflow_create_task', { workflowName: selectedTemplateName, shop, inputs })
            if (data && data.ok) {
              say(`任务已创建：${data.taskId}`)
              await refreshTaskList()
            } else {
              sayLong(`创建失败：${data?.error ?? '未知错误'}`)
            }
          } catch (err) {
            sayLong(`创建任务出错：${(err as Error).message}`)
          }
          return
        }

        // 停止任务
        const stopEl = t.closest('[data-task-stop]') as HTMLElement | null
        if (stopEl) {
          const taskId = stopEl.dataset.taskStop as string
          try {
            const data = await api('workflow_stop_task', { taskId })
            if (data && data.ok) { say('停止请求已受理') }
            else { say(`停止失败：${data?.error ?? '未知'}`) }
            await refreshTaskList()
          } catch { say('停止任务出错') }
          return
        }

        // 重跑任务（用原模板+原店铺+原输入创建新任务）
        const rerunEl = t.closest('[data-task-rerun]') as HTMLElement | null
        if (rerunEl) {
          const taskId = rerunEl.dataset.taskRerun as string
          try {
            const detail = await api('workflow_get_task_detail', { taskId })
            if (!detail || !detail.ok || !detail.task) { say(`查询失败：${detail?.error ?? '未知'}`); return }
            const task = detail.task as WorkflowTask
            const data = await api('workflow_create_task', {
              workflowName: task.workflowName,
              shop: task.shop ?? '',
              inputs: task.inputs,
            })
            if (data && data.ok) { say(`重跑任务已创建：${data.taskId}`) }
            else { sayLong(`重跑失败：${data?.error ?? '未知错误'}`) }
            await refreshTaskList()
          } catch { say('重跑任务出错') }
          return
        }

        // 删除任务记录
        const delEl = t.closest('[data-task-delete]') as HTMLElement | null
        if (delEl) {
          const taskId = delEl.dataset.taskDelete as string
          try {
            const data = await api('workflow_delete_task', { taskId })
            if (data && data.ok) { say('任务记录已删除') }
            else { say(`删除失败：${data?.error ?? '未知'}`) }
            await refreshTaskList()
          } catch { say('删除任务出错') }
          return
        }

        // 日志列：点击「查看」显示弹层（移动端友好；桌面端 hover 也能触发）
        const logLinkEl = t.closest('[data-task-log]') as HTMLElement | null
        if (logLinkEl) {
          const taskId = logLinkEl.dataset.taskLog as string
          const task = tasks.find(x => x.id === taskId)
          if (task) {
            // 清除已有弹层
            root.querySelectorAll('[data-wf-pop]').forEach(el => el.remove())
            const cell = logLinkEl.closest('.dsa-wf-log-cell')
            if (cell) {
              cell.insertAdjacentHTML('beforeend', renderLogPopover(task))
            }
          }
          return
        }

        // 日志弹层复制按钮
        const logCopyEl = t.closest('[data-log-copy]') as HTMLElement | null
        if (logCopyEl) {
          const taskId = logCopyEl.dataset.logCopy as string
          const task = tasks.find(x => x.id === taskId)
          if (task) {
            const text = taskLogsText(task)
            try { await navigator.clipboard.writeText(text) } catch { /* 静默 */ }
            say('日志已复制')
          }
          return
        }

        // 任务详情
        const detailEl = t.closest('[data-task-detail]') as HTMLElement | null
        if (detailEl) {
          const taskId = detailEl.dataset.taskDetail as string
          try {
            const data = await api('workflow_get_task_detail', { taskId })
            if (data && data.ok && data.task) {
              currentTaskDetailId = taskId
              modal.innerHTML = renderTaskDetail(data.task as WorkflowTask)
              modal.hidden = false
            } else { say(`查询失败：${data?.error ?? '未知'}`) }
          } catch { say('查询详情出错') }
          return
        }

        /* ── 编排标签事件 ── */

        // 新建模板
        const edNewEl = t.closest('[data-ed-new]') as HTMLElement | null
        if (edNewEl) {
          editorState = newTemplateState()
          repaintBody()
          return
        }

        // 模板选择切换
        const edSelEl = t.closest('[data-ed-sel]') as HTMLElement | null
        if (edSelEl) {
          const name = edSelEl.dataset.edSel as string
          editorState.selectedTemplate = name
          const ok = await loadYamlToEditor(name)
          if (ok) repaintBody()
          return
        }

        // ★ 定期执行：开关
        const schEnabledEl = t.closest('[data-sch-enabled]') as HTMLElement | null
        if (schEnabledEl) {
          const cb = schEnabledEl as HTMLInputElement
          editorState.schedule.enabled = cb.checked
          repaintBody()
          return
        }
        // ★ 定期执行：间隔预设
        const schPresetEl = t.closest('[data-sch-preset]') as HTMLElement | null
        if (schPresetEl) {
          syncEditorFromDom()
          const iv = schPresetEl.dataset.schPreset as string
          editorState.schedule.intervalMinutes = iv
          if (!editorState.schedule.enabled) editorState.schedule.enabled = true
          repaintBody()
          return
        }

        const edSaveEl = t.closest('[data-ed-save]') as HTMLElement | null
        if (edSaveEl) {
          syncEditorFromDom()
          if (!editorState.name) { say('请填写模板名'); return }
          const yaml = generateYaml()
          try {
            const data = await api('workflow_save_template', { yaml, originalName: editorState.selectedTemplate ?? undefined })
            if (data && data.ok) {
              say(`模板「${data.name}」已保存`)
              editorState.selectedTemplate = data.name as string
              await loadTemplates()
              repaintBody()
            } else if (data && data.issues) {
              sayLong(`保存未通过校验（${data.issues.length} 个问题）：\n${(data.issues as string[]).map(i => `- ${i}`).join('\n')}`)
            } else {
              say(`保存失败：${data?.error ?? '未知'}`)
            }
          } catch (err) { sayLong(`保存出错：${(err as Error).message}`) }
          return
        }

        const edYamlEl = t.closest('[data-ed-yaml]') as HTMLElement | null
        if (edYamlEl) {
          syncEditorFromDom()
          const yaml = generateYaml()
          modal.innerHTML = `<div class="dsa-modal-hd"><b>YAML 预览</b><button class="dsa-x" data-act="close-modal">✕</button></div>
            <div class="dsa-modal-bd"><div class="dsa-yaml-preview" data-yaml-preview>${esc(yaml)}</div></div>
            <div class="dsa-modal-ft"><button class="dsa-btn" data-act="close-modal">关闭</button></div>`
          modal.hidden = false
          return
        }

        const edImportEl = t.closest('[data-ed-import]') as HTMLElement | null
        if (edImportEl) {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = '.yaml,.yml'
          input.onchange = async () => {
            const f = input.files?.[0]
            if (!f) return
            try {
              const yamlText = await f.text()
              // 尝试直接保存（走 host 校验）
              const data = await api('workflow_save_template', { yaml: yamlText })
              if (data && data.ok) {
                say(`导入成功：${data.name}`)
                await loadTemplates()
                await loadYamlToEditor(data.name)
                repaintBody()
              } else if (data && data.issues) {
                sayLong(`导入未通过校验：\n${(data.issues as string[]).map(i => `- ${i}`).join('\n')}`)
              } else {
                say(`导入失败：${data?.error ?? '未知'}`)
              }
            } catch (err) { sayLong(`导入出错：${(err as Error).message}`) }
          }
          input.click()
          return
        }

        const edDeleteEl = t.closest('[data-ed-delete]') as HTMLElement | null
        if (edDeleteEl) {
          if (!editorState.selectedTemplate) { say('请先在左侧选择模板'); return }
          const name = editorState.selectedTemplate
          if (!confirm(`确认删除模板「${name}」？`)) return
          try {
            const data = await api('workflow_delete_template', { name })
            if (data && data.ok) {
              say('模板已删除')
              editorState = newTemplateState()
              await loadTemplates()
              repaintBody()
            } else { say(`删除失败：${data?.error ?? '未知'}`) }
          } catch { say('删除出错') }
          return
        }

        // 点击步骤卡片：选中并展开（影刀式，点开才展开）
        const stepNodeEl = t.closest('[data-step]') as HTMLElement | null
        if (stepNodeEl && !t.closest('button') && !t.closest('input')) {
          syncEditorFromDom()
          const idx = Number(stepNodeEl.dataset.step)
          editorState.selectedStepIndex = editorState.selectedStepIndex === idx ? -1 : idx
          repaintBody()
          return
        }

        // 返回模板设置（取消选中）
        const edBackEl = t.closest('[data-ed-back]') as HTMLElement | null
        if (edBackEl) {
          syncEditorFromDom()
          editorState.selectedStepIndex = -1
          repaintBody()
          return
        }

        // 连接线 ＋ 插入步骤（-1 = 插在最前）
        const edInsertEl = t.closest('[data-ed-insert]') as HTMLElement | null
        if (edInsertEl) {
          syncEditorFromDom()
          const at = Number(edInsertEl.dataset.edInsert)
          const pos = at + 1
          editorState.steps.splice(pos, 0, { name: `step${editorState.steps.length + 1}`, skill: '', args: [], output: '', on_failure: 'continue' })
          editorState.selectedStepIndex = pos
          repaintBody()
          return
        }

        const edDelStepEl = t.closest('[data-ed-delstep]') as HTMLElement | null
        if (edDelStepEl) {
          syncEditorFromDom()
          const idx = Number(edDelStepEl.dataset.edDelstep)
          editorState.steps.splice(idx, 1)
          // 修正选中索引
          if (editorState.selectedStepIndex === idx) editorState.selectedStepIndex = -1
          else if (editorState.selectedStepIndex > idx) editorState.selectedStepIndex--
          repaintBody()
          return
        }

        const edMoveUpEl = t.closest('[data-ed-moveup]') as HTMLElement | null
        if (edMoveUpEl) {
          syncEditorFromDom()
          const idx = Number(edMoveUpEl.dataset.edMoveup)
          if (idx > 0) {
            ;[editorState.steps[idx - 1], editorState.steps[idx]] = [editorState.steps[idx], editorState.steps[idx - 1]]
            if (editorState.selectedStepIndex === idx) editorState.selectedStepIndex = idx - 1
            else if (editorState.selectedStepIndex === idx - 1) editorState.selectedStepIndex = idx
            repaintBody()
          }
          return
        }

        const edMoveDownEl = t.closest('[data-ed-movedown]') as HTMLElement | null
        if (edMoveDownEl) {
          syncEditorFromDom()
          const idx = Number(edMoveDownEl.dataset.edMovedown)
          if (idx < editorState.steps.length - 1) {
            ;[editorState.steps[idx], editorState.steps[idx + 1]] = [editorState.steps[idx + 1], editorState.steps[idx]]
            if (editorState.selectedStepIndex === idx) editorState.selectedStepIndex = idx + 1
            else if (editorState.selectedStepIndex === idx + 1) editorState.selectedStepIndex = idx
            repaintBody()
          }
          return
        }

        // 添加参数（作用于当前选中步骤）
        const edAddArgEl = t.closest('[data-ed-addarg]') as HTMLElement | null
        if (edAddArgEl) {
          syncEditorFromDom()
          const si = editorState.selectedStepIndex
          const step = si >= 0 ? editorState.steps[si] : null
          if (step) {
            step.args.push({ key: '', val: '' })
            repaintBody()
          }
          return
        }

        // 变量面板：添加
        const varAddEl = t.closest('[data-var-add]') as HTMLElement | null
        if (varAddEl) {
          syncEditorFromDom()
          editorState.inputs.push({ key: `var${editorState.inputs.length + 1}`, label: '新变量', type: 'text', required: false, default: '', min: '', max: '', options: '' })
          repaintBody()
          return
        }

        // 变量面板：编辑（仅在模板设置态可用）
        const varEditEl = t.closest('[data-var-edit]') as HTMLElement | null
        if (varEditEl) {
          syncEditorFromDom()
          editorState.varEditIndex = Number(varEditEl.dataset.varEdit)
          const propEl = q('[data-ed-prop]')
          if (propEl) propEl.innerHTML = renderTplPropForm()
          return
        }

        // 变量面板：保存
        const varSaveEl = t.closest('[data-var-save]') as HTMLElement | null
        if (varSaveEl) {
          const idx = Number(varSaveEl.dataset.varSave)
          const inp = editorState.inputs[idx]
          if (inp) {
            const keyEl = q<HTMLInputElement>('[data-var-key]')
            const labelEl = q<HTMLInputElement>('[data-var-label]')
            const typeEl = q<HTMLSelectElement>('[data-var-type]')
            const reqEl = q<HTMLInputElement>('[data-var-required]')
            const defaultEl = q<HTMLInputElement>('[data-var-default]')
            const optionsEl = q<HTMLInputElement>('[data-var-options]')
            const minEl = q<HTMLInputElement>('[data-var-min]')
            const maxEl = q<HTMLInputElement>('[data-var-max]')
            if (keyEl) inp.key = keyEl.value
            if (labelEl) inp.label = labelEl.value
            if (typeEl) inp.type = typeEl.value as WorkflowInputType
            if (reqEl) inp.required = reqEl.checked
            if (defaultEl) inp.default = defaultEl.value
            if (optionsEl) inp.options = optionsEl.value
            if (minEl) inp.min = minEl.value
            if (maxEl) inp.max = maxEl.value
          }
          editorState.varEditIndex = -1
          repaintBody()
          return
        }

        // 变量面板：取消
        const varCancelEl = t.closest('[data-var-cancel]') as HTMLElement | null
        if (varCancelEl) {
          editorState.varEditIndex = -1
          const propEl = q('[data-ed-prop]')
          if (propEl) propEl.innerHTML = renderTplPropForm()
          return
        }
      }

      root.addEventListener('click', onClick)

      // 日志列 hover 显示/隐藏弹层（桌面端）
      const onMouseOver = (e: Event) => {
        if (subtab !== 'tasks') return
        const t = e.target as HTMLElement
        // 进入日志单元格区域（含弹层本身）时确保弹层存在
        const logLink = t.closest('[data-task-log]') as HTMLElement | null
        if (logLink) {
          const taskId = logLink.dataset.taskLog as string
          const task = tasks.find(x => x.id === taskId)
          if (task) {
            const cell = logLink.closest('.dsa-wf-log-cell')
            // 已有弹层则不重复创建
            if (cell && !cell.querySelector('[data-wf-pop]')) {
              cell.insertAdjacentHTML('beforeend', renderLogPopover(task))
            }
          }
          return
        }
      }
      const onMouseOut = (e: Event) => {
        if (subtab !== 'tasks') return
        const related = (e as MouseEvent).relatedTarget as HTMLElement | null
        const cell = (e.target as HTMLElement).closest('.dsa-wf-log-cell') as HTMLElement | null
        if (cell) {
          // 鼠标移出日志单元格且未进入弹层时移除弹层
          const stillInside = related && cell.contains(related)
          if (!stillInside) {
            const pop = cell.querySelector('[data-wf-pop]')
            if (pop) pop.remove()
          }
        }
      }
      root.addEventListener('mouseover', onMouseOver)
      root.addEventListener('mouseout', onMouseOut)

      // 编辑器 input/change 同步
      const onInput = async (e: Event) => {
        const t = e.target as HTMLElement
        // 模板选择切换（任务标签）—— <select> 触发 change 而非 click
        const tplSelEl = t.closest('[data-wf-template]') as HTMLSelectElement | null
        if (tplSelEl) {
          selectedTemplateName = tplSelEl.value
        // ★ 回填该模板的定时间隔
        {
          const tp = templates.find(x => x.name === selectedTemplateName)
          taskScheduleInterval = String(tp?.scheduleInterval ?? 120)
        }
          if (selectedTemplateName) {
            try {
              const data = await api('workflow_get_template', { name: selectedTemplateName })
              if (data && data.ok && data.yaml) {
                currentInputs = parseInputsFromYaml(data.yaml as string)
              }
            } catch { /* 静默 */ }
          } else {
            currentInputs = []
          }
          const inputsEl = q('[data-wf-inputs]')
          if (inputsEl) inputsEl.innerHTML = renderInputs()
          return
        }
        if (subtab !== 'editor') return
        // 技能切换：旧参数失效，重绘参数表与画布摘要
        const skillSelEl = t.closest('[data-ed-skill]') as HTMLSelectElement | null
        if (skillSelEl) {
          const si = editorState.selectedStepIndex
          const step = si >= 0 ? editorState.steps[si] : null
          if (step && step.skill !== skillSelEl.value) {
            step.skill = skillSelEl.value
            step.args = []
            repaintBody()
          }
          return
        }
        syncEditorFromDom()
        // 模式切换：显示/隐藏数量字段行
        if (t.closest('[data-ed-mode]')) repaintBody()
      }
      root.addEventListener('input', onInput)
      root.addEventListener('change', onInput)

      // 预填参数：点击（聚焦）时清空预填值，方便用户重新输入
      const onFocusIn = (e: Event) => {
        const t = e.target as HTMLElement
        const el = t.closest<HTMLInputElement>('[data-prefill]')
        if (el && el.value === el.dataset.prefill) el.value = ''
      }
      root.addEventListener('focusin', onFocusIn)

      // 启动轮询（若有活跃任务）
      const hasActive = tasks.some(t => t.status === 'running' || t.status === 'queued')
      if (hasActive) startPolling()

      return () => {
        root.removeEventListener('click', onClick)
        root.removeEventListener('mouseover', onMouseOver)
        root.removeEventListener('mouseout', onMouseOut)
        root.removeEventListener('input', onInput)
        root.removeEventListener('change', onInput)
        root.removeEventListener('focusin', onFocusIn)
        stopPolling()
        if (longTimer) window.clearTimeout(longTimer)
        rootEl = null
      }
    },
  }
}
