/**
 * 工作流多场景真实测试脚本。
 *
 * 与 workflow-real-run.mjs 互补——那个跑标准 batch 流程，
 * 这个覆盖各种边界和不同配置：
 *   1. single 模式（1:1，不走轮次循环）
 *   2. on_failure=abort（首轮失败即终止整个任务）
 *   3. 环境级失败（token_expired → 整任务 abort）
 *   4. select 枚举校验（非法值拒绝）
 *   5. 步骤输出链式取值（{{step.fields.count}}）
 *   6. 并发上限（MAX_CONCURRENT_TASKS=3，4 个任务排队）
 *   7. 任务列表过滤（按状态/日期）
 *   8. 删除任务（终态可删 / 运行中不可删）
 *   9. 模板重命名（saveTemplate + originalName）
 */
import { pathToFileURL } from 'node:url'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'

const LIB = path.resolve(import.meta.dirname, '..', 'lib')

const serviceMod = await import(pathToFileURL(path.join(LIB, 'workflow', 'service.js')).href)
const { createWorkflowService } = serviceMod

// ── 环境 ──────────────────────────────────────────────

const tmpDir = path.join(os.tmpdir(), `wf-multi-${Date.now()}`)
const workflowDir = path.join(tmpDir, 'workflows')
const tasksPath = path.join(tmpDir, 'workflow-tasks.json')
fs.mkdirSync(workflowDir, { recursive: true })

// ── mock 技能目录 ──────────────────────────────────────

function createSkillDir(id, platform = 'common', capability = 'test') {
  const skillDir = path.join(tmpDir, 'skills', id)
  const scriptsDir = path.join(skillDir, 'scripts')
  fs.mkdirSync(scriptsDir, { recursive: true })
  fs.writeFileSync(path.join(scriptsDir, 'main.py'), '# fake\n', 'utf8')
  const body = `# ${id}\n\n{baseDir}scripts/main.py --keyword test\n`
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), body, 'utf8')
  return {
    id, name: id.replace(/-/g, ' '), description: `技能 ${id}`,
    version: '1.0.0', platform, capability,
    risk: 'L0', enabled: true, dir: skillDir, body,
    frontmatter: '', quality: 0.8, issues: [], hasPatch: false,
  }
}

const skillRows = [
  createSkillDir('collect', 'common', 'test'),
  createSkillDir('process', 'common', 'test'),
  createSkillDir('publish', 'common', 'test'),
  createSkillDir('crawl', 'taobao', 'browser'),  // 浏览器类
  createSkillDir('analyze', 'common', 'test'),
]

const skillApi = {
  list(opts) {
    let rows = [...skillRows]
    if (opts?.onlyEnabled) rows = rows.filter(r => r.enabled)
    return Promise.resolve(rows)
  },
  get(id) { return Promise.resolve(skillRows.find(r => r.id === id) ?? null) },
}

// ── executeSkill 模拟器 ────────────────────────────────

let execCount = 0
const failMap = new Map() // skillId → [轮次, failureKind]

function executeSkill(opts) {
  execCount++
  const n = execCount
  return new Promise(resolve => {
    setTimeout(() => {
      // 检查是否需要模拟失败
      const fail = failMap.get(opts.skillId)
      if (fail && fail[0] === n) {
        resolve({ ok: false, message: `${opts.skillId} 模拟失败 #${n}`, failureKind: fail[1] })
        failMap.delete(opts.skillId)
        return
      }
      resolve({
        ok: true,
        text: `${opts.skillId} 成功 #${n}`,
        payload: { mode: 'script', result: 'ok', count: n * 10, items: [`a-${n}`, `b-${n}`] },
      })
    }, 50)
  })
}

// ── 辅助 ───────────────────────────────────────────────

function safeFileName(name) { return name.replace(/[\\/:*?"<>|\s]+/g, '_').trim() || '_' }

function header(title) {
  console.log('\n' + '═'.repeat(60))
  console.log(`  ${title}`)
  console.log('═'.repeat(60))
}

let passCount = 0, failCount = 0

function assert(cond, msg) {
  if (cond) { passCount++; console.log(`  ✓ ${msg}`) }
  else { failCount++; console.log(`  ✗ ${msg}`) }
}

async function waitTask(taskId, maxWait = 8000, svc = service) {
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    const task = await svc.getTaskDetail(taskId)
    if (task && ['completed', 'failed', 'stopped'].includes(task.status)) return task
    await new Promise(r => setTimeout(r, 80))
  }
  throw new Error(`等待任务 ${taskId} 超时`)
}

async function waitAllTasks(ids, svc, maxWait = 20000) {
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    const results = await Promise.all(ids.map(id => svc.getTaskDetail(id)))
    if (results.every(t => t && ['completed', 'failed', 'stopped'].includes(t.status))) return results
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('等待全部任务超时')
}

function printRounds(task) {
  for (const r of task.rounds) {
    const icon = r.status === 'ok' ? '✓' : '✗'
    console.log(`    ${icon} 第${r.index}轮 ${r.status} ${r.durationMs}ms${r.error ? ' | ' + r.error : ''}`)
  }
}

const service = createWorkflowService({ skill: skillApi, executeSkill, workflowDir, tasksPath })

// ────────────────────────────────────────────────────────
// 场景 1：single 模式
// ────────────────────────────────────────────────────────
header('场景 1：single 模式（target=1，不走轮次循环）')

const yamlSingle = `
name: 单次分析
mode: single
description: 单次执行，不循环
inputs:
  - key: url
    label: 网址
    type: text
    required: true
    default: https://example.com
steps:
  - name: 采集
    skill: collect
    args:
      url: "{{url}}"
    output: col
  - name: 分析
    skill: analyze
    args:
      data: "{{col.raw}}"
    output: ana
`
const sv1 = await service.saveTemplate(yamlSingle)
assert(sv1.ok, '保存 single 模板成功')

execCount = 0
const t1 = await service.createTask({ workflowName: '单次分析', inputs: { url: 'https://test.com' } })
const r1 = await waitTask(t1)
assert(r1.status === 'completed', `single 任务完成（status=${r1.status}）`)
assert(r1.target === 1, `target=1（实际 ${r1.target}）`)
assert(r1.success === 1, `success=1（实际 ${r1.success}）`)
assert(r1.rounds.length === 1, `1 个轮次（实际 ${r1.rounds.length}）`)
printRounds(r1)

// ────────────────────────────────────────────────────────
// 场景 2：on_failure=abort（首轮失败即终止）
// ────────────────────────────────────────────────────────
header('场景 2：on_failure=abort（首轮失败终止整个任务）')

const yamlAbort = `
name: abort测试
mode: batch
count_input: count
inputs:
  - key: keyword
    label: 关键词
    type: text
    required: true
    default: 测试
  - key: count
    label: 轮数
    type: number
    required: true
    default: 3
    min: 1
    max: 10
steps:
  - name: 采集
    skill: collect
    args:
      keyword: "{{keyword}}"
    output: col
  - name: 处理
    skill: process
    args:
      data: "{{col.raw}}"
    on_failure: abort
`
const sv2 = await service.saveTemplate(yamlAbort)
assert(sv2.ok, '保存 abort 模板成功')

// 让 process 第 1 次调用失败
execCount = 0
failMap.set('process', [2, 'skill_error']) // execCount 到 2 时（第1轮第2步）
const t2 = await service.createTask({ workflowName: 'abort测试', inputs: { keyword: '测试abort', count: 3 } })
const r2 = await waitTask(t2)
assert(r2.status === 'failed', `abort 任务失败（status=${r2.status}）`)
assert(r2.failed === 1, `failed=1（实际 ${r2.failed}）`)
assert(r2.success === 0, `success=0（实际 ${r2.success}）`)
assert(r2.rounds.length === 1, `只跑了1轮就 abort（实际 ${r2.rounds.length}）`)
printRounds(r2)

// ────────────────────────────────────────────────────────
// 场景 3：环境级失败（token_expired → 整任务 abort）
// ────────────────────────────────────────────────────────
header('场景 3：环境级失败（token_expired → 整任务 abort）')

const yamlEnv = `
name: 环境失败测试
mode: batch
count_input: count
inputs:
  - key: keyword
    label: 关键词
    type: text
    required: true
    default: 测试
  - key: count
    label: 轮数
    type: number
    required: true
    default: 3
steps:
  - name: 采集
    skill: crawl
    args:
      keyword: "{{keyword}}"
    output: cr
  - name: 发布
    skill: publish
    args:
      data: "{{cr.raw}}"
`
const sv3 = await service.saveTemplate(yamlEnv)
assert(sv3.ok, '保存环境失败模板成功')

// crawl 第 1 次调用返回 token_expired
execCount = 0
failMap.set('crawl', [1, 'token_expired'])
const t3 = await service.createTask({ workflowName: '环境失败测试', inputs: { keyword: 'token测试', count: 3 } })
const r3 = await waitTask(t3)
assert(r3.status === 'failed', `环境失败任务 failed（status=${r3.status}）`)
assert(r3.rounds.length === 1, `只跑了1轮（实际 ${r3.rounds.length}）`)
assert(r3.error && r3.error.includes('token_expired'), `错误含 token_expired（${r3.error}）`)
printRounds(r3)

// ────────────────────────────────────────────────────────
// 场景 4：select 枚举校验
// ────────────────────────────────────────────────────────
header('场景 4：select 枚举校验（非法值拒绝）')

const yamlSelect = `
name: 枚举校验测试
mode: single
inputs:
  - key: platform
    label: 平台
    type: select
    options:
      - 淘宝
      - 天猫
      - 京东
    required: true
    default: 淘宝
  - key: keyword
    label: 关键词
    type: text
    required: true
steps:
  - name: 采集
    skill: collect
    args:
      platform: "{{platform}}"
      keyword: "{{keyword}}"
`
const sv4 = await service.saveTemplate(yamlSelect)
assert(sv4.ok, '保存 select 模板成功')

// 合法值
execCount = 0
const t4a = await service.createTask({ workflowName: '枚举校验测试', inputs: { platform: '京东', keyword: '手机' } })
const r4a = await waitTask(t4a)
assert(r4a.status === 'completed', `合法枚举值通过（status=${r4a.status}）`)

// 非法值
try {
  await service.createTask({ workflowName: '枚举校验测试', inputs: { platform: '拼多多', keyword: '手机' } })
  assert(false, '非法枚举值应被拒绝')
} catch (e) {
  assert(e.message.includes('取值非法'), `非法枚举值被拒绝：${e.message}`)
}

// ────────────────────────────────────────────────────────
// 场景 5：步骤输出链式取值（{{step.fields.count}}）
// ────────────────────────────────────────────────────────
header('场景 5：步骤输出链式取值（{{col.count}}）')

const yamlChain = `
name: 链式取值测试
mode: single
inputs:
  - key: keyword
    label: 关键词
    type: text
    required: true
    default: 链式
steps:
  - name: 采集
    skill: collect
    args:
      keyword: "{{keyword}}"
    output: col
  - name: 分析
    skill: analyze
    args:
      count: "{{col.count}}"
      raw: "{{col.raw}}"
      first: "{{col.items.0}}"
`
const sv5 = await service.saveTemplate(yamlChain)
assert(sv5.ok, '保存链式取值模板成功')

execCount = 0
const t5 = await service.createTask({ workflowName: '链式取值测试', inputs: { keyword: '链式测试' } })
const r5 = await waitTask(t5)
assert(r5.status === 'completed', `链式取值任务完成（status=${r5.status}）`)
printRounds(r5)
// 第2步（analyze）的 args 应正确渲染了 col.count 和 col.items.0
assert(r5.rounds[0].logs.length === 2, `2 条日志（实际 ${r5.rounds[0].logs.length}）`)
assert(r5.rounds[0].logs[1].includes('✓成功'), `第2步成功`)

// ────────────────────────────────────────────────────────
// 场景 6：并发上限（4 个任务，只有 3 个同时跑）
// ────────────────────────────────────────────────────────
header('场景 6：并发上限（MAX_CONCURRENT_TASKS=3，4个任务排队）')

// 用一个不带 abort 的 batch 模板
const yamlConc = `
name: 并发测试
mode: batch
count_input: count
inputs:
  - key: keyword
    label: 关键词
    type: text
    required: true
    default: 测试
  - key: count
    label: 轮数
    type: number
    required: true
    default: 3
    min: 1
    max: 5
steps:
  - name: 采集
    skill: collect
    args:
      keyword: "{{keyword}}"
    output: col
  - name: 分析
    skill: analyze
    args:
      data: "{{col.raw}}"
`
const tmpDir2 = path.join(os.tmpdir(), `wf-conc-${Date.now()}`)
const wfDir2 = path.join(tmpDir2, 'workflows')
const tsPath2 = path.join(tmpDir2, 'tasks.json')
fs.mkdirSync(wfDir2, { recursive: true })
const svConc = await service.saveTemplate(yamlConc)
fs.copyFileSync(path.join(workflowDir, safeFileName('并发测试') + '.yaml'), path.join(wfDir2, '并发测试.yaml'))

execCount = 0
failMap.clear()
const service2 = createWorkflowService({ skill: skillApi, executeSkill, workflowDir: wfDir2, tasksPath: tsPath2 })

const ids = []
for (let i = 0; i < 4; i++) {
  const id = await service2.createTask({ workflowName: '并发测试', inputs: { keyword: `并发${i}`, count: 3 } })
  ids.push(id)
}
console.log(`  创建 4 个任务: ${ids.length}`)

// 并行等待全部完成
const results = await waitAllTasks(ids, service2, 20000)
const running = results.filter(r => r.status === 'completed')
assert(results.length === 4, `4 个任务全部终态`)
assert(results.every(r => r.status === 'completed'), `全部 completed`)
console.log(`  executeSkill 总调用: ${execCount}`)

// ────────────────────────────────────────────────────────
// 场景 7：任务列表过滤
// ────────────────────────────────────────────────────────
header('场景 7：任务列表过滤（按状态）')

const allTasks = await service.listTasks()
const completedOnly = await service.listTasks({ status: 'completed' })
const failedOnly = await service.listTasks({ status: 'failed' })
console.log(`  全部任务: ${allTasks.length}`)
console.log(`  completed: ${completedOnly.length}`)
console.log(`  failed: ${failedOnly.length}`)
assert(completedOnly.every(t => t.status === 'completed'), 'completed 过滤正确')
assert(failedOnly.every(t => t.status === 'failed'), 'failed 过滤正确')
assert(completedOnly.length + failedOnly.length <= allTasks.length, '过滤数量合理')

// ────────────────────────────────────────────────────────
// 场景 8：删除任务
// ────────────────────────────────────────────────────────
header('场景 8：删除任务（终态可删 / 运行中不可删）')

// 先创建一个任务并等它完成
execCount = 0
const t8 = await service.createTask({ workflowName: '单次分析', inputs: { url: 'delete-test' } })
const r8 = await waitTask(t8)
assert(r8.status === 'completed', '待删除任务已完成')

// 删除已完成任务
const delOk = await service.deleteTask(t8)
assert(delOk.ok, '删除已完成任务成功')

// 确认已删除
const after = await service.getTaskDetail(t8)
assert(after === null, '删除后查询返回 null')

// 尝试删除不存在的任务
const del404 = await service.deleteTask('nonexistent')
assert(!del404.ok, '删除不存在任务返回失败')

// ────────────────────────────────────────────────────────
// 场景 9：模板重命名（originalName）
// ────────────────────────────────────────────────────────
header('场景 9：模板重命名（saveTemplate + originalName）')

const yamlRename = `
name: 重命名后
mode: single
inputs:
  - key: k
    label: K
    type: text
    required: true
    default: v
steps:
  - name: 采集
    skill: collect
    args:
      k: "{{k}}"
`
// 先用旧名保存
const yamlOld = yamlRename.replace('name: 重命名后', 'name: 重命名前')
const svOld = await service.saveTemplate(yamlOld)
assert(svOld.ok, '保存旧模板成功')

// 用新名保存 + originalName
const svNew = await service.saveTemplate(yamlRename, '重命名前')
assert(svNew.ok, '重命名保存成功')
assert(svNew.name === '重命名后', `新名正确（${svNew.name}）`)

// 旧模板应不存在
const oldT = await service.getTemplate('重命名前')
assert(oldT === null, '旧名模板已删除')

// 新模板应存在
const newT = await service.getTemplate('重命名后')
assert(newT !== null, '新名模板存在')

// ────────────────────────────────────────────────────────
// 总结
// ────────────────────────────────────────────────────────
header('总结')
console.log(`  通过: ${passCount}`)
console.log(`  失败: ${failCount}`)
console.log(`  executeSkill 总调用: ${execCount}`)

// 清理
try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
try { fs.rmSync(tmpDir2, { recursive: true, force: true }) } catch { /* ignore */ }

if (failCount > 0) {
  console.log('\n  ✗ 有失败用例')
  process.exit(1)
} else {
  console.log('\n  ✓ 全部通过')
}
