/**
 * 工作流真实端到端运行脚本。
 *
 * 不用 mock——用真实的 service 代码链路（模板校验→任务创建→异步引擎→轮次日志→持久化），
 * executeSkill 用一个模拟真实返回的 handler（否则没有真实平台账号无法跑真实技能）。
 *
 * 场景覆盖：
 *   1. 保存一个 batch 模板（含输入校验、变量引用、多步骤）
 *   2. 创建任务（走完整校验链路）
 *   3. 等待异步执行完成
 *   4. 展示任务详情：状态、进度、轮次明细、日志
 *   5. 再跑一个含失败轮次的 batch 任务（on_failure=continue）
 *   6. 展示失败轮次明细
 *   7. 测试停止机制
 */
import { pathToFileURL } from 'node:url'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'

const LIB = path.resolve(import.meta.dirname, '..', 'lib')

const serviceMod = await import(pathToFileURL(path.join(LIB, 'workflow', 'service.js')).href)
const apiMod = await import(pathToFileURL(path.join(LIB, 'workflow', 'api.js')).href)
const { createWorkflowService } = serviceMod
const { registerWorkflowApi, buildWorkflowTool } = apiMod

// ── 环境 ──────────────────────────────────────────────

const tmpDir = path.join(os.tmpdir(), `wf-real-${Date.now()}`)
const workflowDir = path.join(tmpDir, 'workflows')
const tasksPath = path.join(tmpDir, 'workflow-tasks.json')
fs.mkdirSync(workflowDir, { recursive: true })

// ── mock 技能目录（让 detectEntry 返回 script 型） ──────

function createSkillDir(id) {
  const skillDir = path.join(tmpDir, 'skills', id)
  const scriptsDir = path.join(skillDir, 'scripts')
  fs.mkdirSync(scriptsDir, { recursive: true })
  fs.writeFileSync(path.join(scriptsDir, 'main.py'), '# fake\n', 'utf8')
  const body = `# ${id}\n\n{baseDir}scripts/main.py --keyword test\n`
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), body, 'utf8')
  return { skillDir, body }
}

const skillIds = ['data-collect', 'data-process', 'data-publish']
const skillRows = skillIds.map(id => {
  const { skillDir, body } = createSkillDir(id)
  return {
    id,
    name: id.replace(/-/g, ' '),
    description: `技能 ${id}`,
    version: '1.0.0',
    platform: 'common',
    capability: 'test',
    risk: 'L0',
    enabled: true,
    dir: skillDir,
    body,
    frontmatter: '',
    quality: 0.8,
    issues: [],
    hasPatch: false,
  }
})

const skillApi = {
  list(opts) {
    let rows = [...skillRows]
    if (opts?.onlyEnabled) rows = rows.filter(r => r.enabled)
    return Promise.resolve(rows)
  },
  get(id) {
    return Promise.resolve(skillRows.find(r => r.id === id) ?? null)
  },
}

// ── executeSkill 模拟器 ────────────────────────────────

let execCount = 0
function executeSkill(opts) {
  execCount++
  const n = execCount
  // 模拟耗时
  return new Promise(resolve => {
    setTimeout(() => {
      if (opts.skillId === 'data-process' && n === 4) {
        // 第 4 次调用（= 第 2 轮的第 2 步）模拟失败
        resolve({ ok: false, message: '数据处理异常：连接超时', failureKind: 'skill_error' })
        return
      }
      resolve({
        ok: true,
        text: `${opts.skillId} 执行成功 #${n}`,
        payload: {
          result: 'ok',
          items: [`item-${n}-1`, `item-${n}-2`],
          count: n,
        },
      })
    }, 100)
  })
}

// ── 创建 service ───────────────────────────────────────

const service = createWorkflowService({
  skill: skillApi,
  executeSkill,
  workflowDir,
  tasksPath,
})

const api = registerWorkflowApi({ service })

const tool = buildWorkflowTool({
  service,
  render: () => 'rendered',
})

// ── 辅助 ───────────────────────────────────────────────

function header(title) {
  console.log('\n' + '═'.repeat(60))
  console.log(`  ${title}`)
  console.log('═'.repeat(60))
}

async function waitTaskDone(taskId, maxWait = 10000) {
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    const task = await service.getTaskDetail(taskId)
    if (task && ['completed', 'failed', 'stopped'].includes(task.status)) return task
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('等待任务超时')
}

function printTaskDetail(task) {
  console.log(`  任务 ID:    ${task.id}`)
  console.log(`  工作流:     ${task.workflowName}`)
  console.log(`  输入摘要:   ${task.inputSummary}`)
  console.log(`  状态:       ${task.status}`)
  console.log(`  进度:       ${task.current}/${task.target}（成功 ${task.success}｜失败 ${task.failed}）`)
  console.log(`  开始时间:   ${task.startedAt}`)
  console.log(`  结束时间:   ${task.finishedAt ?? '（未结束）'}`)
  if (task.error) console.log(`  任务级错误: ${task.error}`)
  if (task.rounds.length) {
    console.log(`  轮次明细:`)
    for (const r of task.rounds) {
      const icon = r.status === 'ok' ? '✓' : '✗'
      console.log(`    ${icon} 第${r.index}轮 ${r.status} ${r.durationMs}ms${r.error ? ' | ' + r.error : ''}`)
      if (r.logs?.length) {
        for (const l of r.logs) console.log(`      ${l}`)
      }
    }
  }
}

// ── 场景 1：保存模板 + 创建 batch 任务 + 等待完成 ───────

header('场景 1：保存模板并运行 batch 任务（3 轮 × 2 步骤）')

const yaml1 = `
name: 真实测试-数据采集处理
category: 数据采集
mode: batch
count_input: count
description: 采集数据后处理，3轮串行
inputs:
  - key: keyword
    label: 搜索关键词
    type: text
    required: true
    default: 连衣裙
  - key: count
    label: 采集轮数
    type: number
    required: true
    default: 3
    min: 1
    max: 10
steps:
  - name: 采集数据
    skill: data-collect
    args:
      keyword: "{{keyword}}"
      index: "{{loop.index}}"
      total: "{{loop.total}}"
    output: collect
  - name: 处理数据
    skill: data-process
    args:
      data: "{{collect.raw}}"
    output: process
`

const saveResult = await service.saveTemplate(yaml1)
console.log(`  保存模板: ok=${saveResult.ok}, name=${saveResult.name}`)
if (!saveResult.ok) {
  console.log(`  校验问题: ${JSON.stringify(saveResult.issues)}`)
  process.exit(1)
}

// 列模板确认
const templates = await service.listTemplates()
console.log(`  模板列表: ${templates.length} 个`)
for (const t of templates) {
  console.log(`    - ${t.name} | ${t.category} | ${t.mode} | 输入${t.inputCount} 步骤${t.stepCount}`)
}

// 创建任务
execCount = 0
const taskId1 = await service.createTask({
  workflowName: '真实测试-数据采集处理',
  inputs: { keyword: '夏季连衣裙', count: 3 },
})
console.log(`  创建任务: ${taskId1}`)

// 等待完成
const task1 = await waitTaskDone(taskId1)
console.log('\n  ── 任务详情 ──')
printTaskDetail(task1)

// ── 场景 2：通过 API 层创建任务 ─────────────────────────

header('场景 2：通过 API 层 (handleAction) 创建并运行任务')

const apiResult = await api.handleAction('workflow_create_task', {
  workflowName: '真实测试-数据采集处理',
  inputs: { keyword: '冬季外套', count: 2 },
})
console.log(`  API 创建任务: ok=${apiResult.ok}, taskId=${apiResult.taskId}`)
if (apiResult.taskId) {
  const task2 = await waitTaskDone(apiResult.taskId)
  console.log('\n  ── 任务详情 ──')
  printTaskDetail(task2)
}

// ── 场景 3：通过工具层创建任务 ──────────────────────────

header('场景 3：通过工具层 (buildWorkflowTool) 创建并运行任务')

const toolResult = await tool.execute({
  action: 'run',
  name: '真实测试-数据采集处理',
  inputs: '{"keyword":"春装新品","count":2}',
})
console.log(`  工具创建任务: ok=${toolResult.ok}`)
console.log(`  ${toolResult.text}`)

if (toolResult.taskId) {
  const task3 = await waitTaskDone(toolResult.taskId)
  console.log('\n  ── 任务详情 ──')
  printTaskDetail(task3)
}

// ── 场景 4：工具层查询任务列表 + 详情 ──────────────────

header('场景 4：工具层查询任务列表')

const listResult = await tool.execute({ action: 'tasks' })
console.log(`  查询任务列表: ok=${listResult.ok}, count=${listResult.count}`)
console.log(`  ${listResult.text}`)

// ── 场景 5：停止机制 ──────────────────────────────────

header('场景 5：停止机制（创建后立即停止）')

// 创建一个 batch=5 的任务，立即停止
const stopTaskId = await service.createTask({
  workflowName: '真实测试-数据采集处理',
  inputs: { keyword: '测试停止', count: 5 },
})
console.log(`  创建任务（5轮）: ${stopTaskId}`)

const stopped = await service.stopTask(stopTaskId)
console.log(`  停止请求: ${stopped ? '已受理' : '未受理'}`)

await new Promise(r => setTimeout(r, 300))
const stopTask = await service.getTaskDetail(stopTaskId)
console.log('\n  ── 任务详情 ──')
printTaskDetail(stopTask)

// ── 场景 6：持久化验证 ─────────────────────────────────

header('场景 6：持久化验证（磁盘文件内容）')

const raw = fs.readFileSync(tasksPath, 'utf8')
const diskTasks = JSON.parse(raw)
console.log(`  磁盘任务数: ${diskTasks.length}`)
for (const t of diskTasks) {
  console.log(`    - ${t.id} | ${t.workflowName} | ${t.status} | ${t.success}/${t.target}`)
}

// ── 场景 7：重启对账 ──────────────────────────────────

header('场景 7：重启对账（模拟孤儿任务）')

// 手动构造一个 running 孤儿任务
const orphanTask = {
  id: `wf_orphan_${Date.now()}`,
  workflowName: '真实测试-数据采集处理',
  shop: null,
  inputs: { keyword: '孤儿', count: 1 },
  inputSummary: '搜索关键词：孤儿',
  status: 'running',
  success: 0,
  failed: 0,
  target: 1,
  current: 0,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  error: null,
  rounds: [],
}
diskTasks.push(orphanTask)
fs.writeFileSync(tasksPath, JSON.stringify(diskTasks, null, 2), 'utf8')

// 创建新 service 模拟重启
const service2 = createWorkflowService({
  skill: skillApi,
  executeSkill,
  workflowDir,
  tasksPath,
})
await service2.reconcile()

const afterReconcile = await service2.getTaskDetail(orphanTask.id)
console.log(`  孤儿任务状态: ${afterReconcile.status}`)
console.log(`  孤儿任务错误: ${afterReconcile.error}`)

// ── 总结 ───────────────────────────────────────────────

header('总结')

console.log(`  executeSkill 总调用次数: ${execCount}`)
console.log(`  磁盘任务总数: ${JSON.parse(fs.readFileSync(tasksPath, 'utf8')).length}`)

// 清理
try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
console.log('\n  全部场景完成。')
