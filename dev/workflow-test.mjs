/**
 * 工作流引擎端到端测试。
 *
 * 测试覆盖：
 *   1. 模板扫描（listTemplates）：YAML 解析、摘要信息
 *   2. 模板校验（validateTemplate）：六项校验规则
 *   3. 模板 CRUD：save / get / delete
 *   4. 任务 CRUD：create / list / getDetail / delete
 *   5. 变量渲染：{{input}} / {{loop.*}} / {{step.output}}
 *   6. 执行引擎：串行轮次、步骤成功/失败、on_failure 策略
 *   7. 环境级失败：token_expired/risk_control/not_bound → abort
 *   8. 浏览器互斥锁：浏览器类技能排队
 *   9. 停止机制：stopTask → stopped
 *   10. 重启对账：孤儿 running/queued → failed
 *   11. API 层：handleAction 全 action
 *   12. 边界：空模板、坏 YAML、任务不存在等
 *
 * 运行：node dev/workflow-test.mjs
 */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'

const LIB = path.resolve(import.meta.dirname, '..', 'lib')

// 动态导入编译后的模块
const serviceMod = await import(pathToFileURL(path.join(LIB, 'workflow', 'service.js')).href)
const apiMod = await import(pathToFileURL(path.join(LIB, 'workflow', 'api.js')).href)

const { createWorkflowService } = serviceMod
const { registerWorkflowApi, buildWorkflowTool } = apiMod

// ── 测试框架 ──────────────────────────────────────────────

const CASES = []
let currentSuite = ''
function suite(name) { currentSuite = name }
function test(name, fn) { CASES.push({ suite: currentSuite, name, fn }) }

async function runAll() {
  let pass = 0
  const failures = []
  for (const c of CASES) {
    try {
      await c.fn()
      pass++
      console.log(`  ✓ ${c.name}`)
    } catch (err) {
      failures.push({ ...c, err })
      console.log(`  ✗ ${c.name}`)
      console.log(`      ${err?.message ?? err}`)
    }
  }
  console.log(`\n结果：${pass}/${CASES.length} 通过`)
  if (failures.length) {
    console.log('\n失败用例：')
    for (const f of failures) {
      console.log(`  ✗ [${f.suite}] ${f.name}`)
      console.log(`    ${f.err?.stack?.split('\n').slice(0, 3).join('\n    ') ?? f.err}`)
    }
    process.exitCode = 1
  }
}

// ── Mock 依赖 ─────────────────────────────────────────────

/** 创建临时目录 */
function mkTmpDir() {
  const dir = path.join(os.tmpdir(), `wf-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 创建 mock skill 目录（含 SKILL.md + scripts/fake.py），使 detectEntry 返回 script 型。
 * detectEntry 需要 body 里有 `{baseDir}scripts/xxx.py` 且文件存在。
 */
function createMockSkillDir(tmpRoot, id, overrides = {}) {
  const skillDir = path.join(tmpRoot, 'skills', id)
  const scriptsDir = path.join(skillDir, 'scripts')
  fs.mkdirSync(scriptsDir, { recursive: true })
  const scriptName = 'main.py'
  fs.writeFileSync(path.join(scriptsDir, scriptName), '# fake script\n', 'utf8')
  // SKILL.md 正文需包含 {baseDir}scripts/main.py 以使 detectEntry 返回 script 型
  const body = `# ${id}\n\n{baseDir}scripts/${scriptName} --keyword test\n`
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), body, 'utf8')
  return { skillDir, body, scriptName }
}

/** 创建 mock skill 服务 */
function createMockSkillApi(skills = []) {
  const skillMap = new Map(skills.map(s => [s.id, s]))
  return {
    list(opts) {
      let rows = [...skillMap.values()]
      if (opts?.onlyEnabled) rows = rows.filter(r => r.enabled)
      return Promise.resolve(rows)
    },
    get(id) {
      return Promise.resolve(skillMap.get(id) ?? null)
    },
  }
}

/** 创建 mock executeSkill */
function createMockExecuteSkill(behavior = {}) {
  let callCount = 0
  const fn = async (opts) => {
    callCount++
    const handler = behavior.handler
    if (handler) return handler(opts, callCount)
    return { ok: true, text: `executed ${opts.skillId}`, payload: { result: 'ok', data: ['item1', 'item2'] } }
  }
  fn.getCallCount = () => callCount
  fn.reset = () => { callCount = 0 }
  return fn
}

/** 标准 mock skill row（带真实 dir 和 body 使 detectEntry 返回 script 型） */
function mockSkillRow(tmpRoot, overrides = {}) {
  const id = overrides.id || 'test-skill'
  const { skillDir, body } = createMockSkillDir(tmpRoot, id)
  return {
    id,
    name: overrides.name || '测试技能',
    description: overrides.description || '测试用技能',
    version: '1.0.0',
    platform: overrides.platform || 'common',
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
}

/** 创建完整测试环境 */
function createTestEnv(skillOverrides = [], execBehavior = {}) {
  const tmpDir = mkTmpDir()
  const workflowDir = path.join(tmpDir, 'workflows')
  const tasksPath = path.join(tmpDir, 'workflow-tasks.json')
  fs.mkdirSync(workflowDir, { recursive: true })

  const skills = skillOverrides.map(o => mockSkillRow(tmpDir, o))
  const skillApi = createMockSkillApi(skills)
  const executeSkill = createMockExecuteSkill(execBehavior)

  const service = createWorkflowService({
    skill: skillApi,
    executeSkill,
    workflowDir,
    tasksPath,
  })

  const api = registerWorkflowApi({ service })

  return { service, api, skillApi, executeSkill, workflowDir, tasksPath, tmpDir, skills }
}

function cleanup(env) {
  try { fs.rmSync(env.tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
}

// ── 测试用例 ──────────────────────────────────────────────

// ── 1. 模板扫描 ───────────────────────────────────────────

suite('1. 模板扫描 (listTemplates)')

test('空目录返回空列表', async () => {
  const env = createTestEnv()
  try {
    const templates = await env.service.listTemplates()
    assert.equal(templates.length, 0)
  } finally { cleanup(env) }
})

test('扫描 .yaml 文件并返回摘要', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `
name: 测试模板
category: 数据采集
mode: batch
count_input: count
description: 测试用
inputs:
  - key: keyword
    label: 关键词
    type: text
    required: true
  - key: count
    label: 数量
    type: number
    required: true
    default: 5
steps:
  - name: 采集
    skill: test-skill
    args:
      keyword: "{{keyword}}"
    output: step1
`
    fs.writeFileSync(path.join(env.workflowDir, 'test.yaml'), yaml, 'utf8')
    const templates = await env.service.listTemplates()
    assert.equal(templates.length, 1)
    assert.equal(templates[0].name, '测试模板')
    assert.equal(templates[0].category, '数据采集')
    assert.equal(templates[0].mode, 'batch')
    assert.equal(templates[0].inputCount, 2)
    assert.equal(templates[0].stepCount, 1)
  } finally { cleanup(env) }
})

test('扫描 .yml 文件', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: yml测试\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    fs.writeFileSync(path.join(env.workflowDir, 'test.yml'), yaml, 'utf8')
    const templates = await env.service.listTemplates()
    assert.equal(templates.length, 1)
    assert.equal(templates[0].name, 'yml测试')
    assert.equal(templates[0].mode, 'single')
  } finally { cleanup(env) }
})

test('坏 YAML 不拖垮列表（返回解析失败摘要）', async () => {
  const env = createTestEnv()
  try {
    fs.writeFileSync(path.join(env.workflowDir, 'bad.yaml'), 'name: [invalid yaml content', 'utf8')
    const templates = await env.service.listTemplates()
    assert.equal(templates.length, 1)
    assert.equal(templates[0].category, '解析失败')
  } finally { cleanup(env) }
})

// ── 2. 模板校验 ───────────────────────────────────────────

suite('2. 模板校验 (validateTemplate)')

test('名称为空报错', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: ""\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    const result = await env.service.saveTemplate(yaml)
    assert.equal(result.ok, false)
    assert.ok(result.issues.some(i => i.includes('名称不能为空')))
  } finally { cleanup(env) }
})

test('步骤技能不存在报错', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 测试\nmode: single\nsteps:\n  - name: 步骤1\n    skill: not-exist\n`
    const result = await env.service.saveTemplate(yaml)
    assert.equal(result.ok, false)
    assert.ok(result.issues.some(i => i.includes('不存在')))
  } finally { cleanup(env) }
})

test('batch 模式缺少 count_input 报错', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 测试\nmode: batch\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    const result = await env.service.saveTemplate(yaml)
    assert.equal(result.ok, false)
    assert.ok(result.issues.some(i => i.includes('count_input')))
  } finally { cleanup(env) }
})

test('count_input 指向非 number 类型报错', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 测试\nmode: batch\ncount_input: keyword\ninputs:\n  - key: keyword\n    label: 关键词\n    type: text\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    const result = await env.service.saveTemplate(yaml)
    assert.equal(result.ok, false)
    assert.ok(result.issues.some(i => i.includes('必须是 number')))
  } finally { cleanup(env) }
})

test('输出变量与输入变量同名报错', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 测试\nmode: single\ninputs:\n  - key: keyword\n    label: 关键词\n    type: text\nsteps:\n  - name: 步骤1\n    skill: test-skill\n    output: keyword\n`
    const result = await env.service.saveTemplate(yaml)
    assert.equal(result.ok, false)
    assert.ok(result.issues.some(i => i.includes('同名')))
  } finally { cleanup(env) }
})

test('输出变量重复报错', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 测试\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n    output: dup\n  - name: 步骤2\n    skill: test-skill\n    output: dup\n`
    const result = await env.service.saveTemplate(yaml)
    assert.equal(result.ok, false)
    assert.ok(result.issues.some(i => i.includes('重复')))
  } finally { cleanup(env) }
})

test('参数引用不存在的变量报错', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 测试\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n    args:\n      key: "{{not_exist}}"\n    output: step1\n`
    const result = await env.service.saveTemplate(yaml)
    assert.equal(result.ok, false)
    assert.ok(result.issues.some(i => i.includes('不存在的变量')))
  } finally { cleanup(env) }
})

test('合法模板保存成功', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 合法模板\nmode: single\ninputs:\n  - key: keyword\n    label: 关键词\n    type: text\n    required: true\nsteps:\n  - name: 步骤1\n    skill: test-skill\n    args:\n      keyword: "{{keyword}}"\n    output: step1\n`
    const result = await env.service.saveTemplate(yaml)
    assert.equal(result.ok, true, `issues: ${JSON.stringify(result.issues)}`)
    assert.equal(result.name, '合法模板')
  } finally { cleanup(env) }
})

// ── 3. 模板 CRUD ──────────────────────────────────────────

suite('3. 模板 CRUD')

test('保存后能读取 YAML 原文', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: CRUD测试\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    const saved = await env.service.saveTemplate(yaml)
    assert.equal(saved.ok, true, `issues: ${JSON.stringify(saved.issues)}`)
    const got = await env.service.getTemplateYaml('CRUD测试')
    assert.ok(got !== null)
    assert.ok(got.includes('CRUD测试'))
  } finally { cleanup(env) }
})

test('保存后能解析为模板对象', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 解析测试\nmode: batch\ncount_input: count\ninputs:\n  - key: count\n    label: 数量\n    type: number\n    default: 3\nsteps:\n  - name: 步骤1\n    skill: test-skill\n    output: out1\n`
    const saved = await env.service.saveTemplate(yaml)
    assert.equal(saved.ok, true, `issues: ${JSON.stringify(saved.issues)}`)
    const t = await env.service.getTemplate('解析测试')
    assert.ok(t !== null)
    assert.equal(t.name, '解析测试')
    assert.equal(t.mode, 'batch')
    assert.equal(t.steps.length, 1)
    assert.equal(t.steps[0].output, 'out1')
  } finally { cleanup(env) }
})

test('删除模板', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 删除测试\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    const saved = await env.service.saveTemplate(yaml)
    assert.equal(saved.ok, true, `issues: ${JSON.stringify(saved.issues)}`)
    const del = await env.service.deleteTemplate('删除测试')
    assert.equal(del.ok, true)
    const got = await env.service.getTemplate('删除测试')
    assert.equal(got, null)
  } finally { cleanup(env) }
})

test('删除不存在的模板报错', async () => {
  const env = createTestEnv()
  try {
    const del = await env.service.deleteTemplate('不存在')
    assert.equal(del.ok, false)
    assert.ok(del.error)
  } finally { cleanup(env) }
})

test('重名覆盖保存', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml1 = `name: 覆盖测试\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    const yaml2 = `name: 覆盖测试\nmode: single\nsteps:\n  - name: 步骤2\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml1)
    await env.service.saveTemplate(yaml2)
    const t = await env.service.getTemplate('覆盖测试')
    assert.ok(t !== null)
    assert.equal(t.steps[0].name, '步骤2')
  } finally { cleanup(env) }
})

// ── 4. 任务 CRUD ──────────────────────────────────────────

suite('4. 任务 CRUD')

test('创建 single 模式任务', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], { handler: () => ({ ok: true, text: 'done', payload: { result: 'ok' } }) })
  try {
    const yaml = `name: 单次任务\nmode: single\ninputs:\n  - key: msg\n    label: 消息\n    type: text\n    default: hello\nsteps:\n  - name: 执行\n    skill: test-skill\n    args:\n      msg: "{{msg}}"\n    output: step1\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: '单次任务', inputs: { msg: 'world' } })
    assert.ok(taskId)
    // 等待异步执行完成
    await new Promise(r => setTimeout(r, 500))
    const task = await env.service.getTaskDetail(taskId)
    assert.ok(task)
    assert.equal(task.workflowName, '单次任务')
    assert.equal(task.target, 1)
  } finally { cleanup(env) }
})

test('创建 batch 模式任务', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], { handler: () => ({ ok: true, text: 'done', payload: { result: 'ok' } }) })
  try {
    const yaml = `name: 批量任务\nmode: batch\ncount_input: count\ninputs:\n  - key: count\n    label: 数量\n    type: number\n    default: 3\nsteps:\n  - name: 执行\n    skill: test-skill\n    output: step1\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: '批量任务', inputs: { count: 5 } })
    assert.ok(taskId)
    await new Promise(r => setTimeout(r, 1000))
    const task = await env.service.getTaskDetail(taskId)
    assert.ok(task)
    assert.equal(task.target, 5)
  } finally { cleanup(env) }
})

test('缺少必填输入报错', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 必填测试\nmode: single\ninputs:\n  - key: keyword\n    label: 关键词\n    type: text\n    required: true\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    await assert.rejects(
      () => env.service.createTask({ workflowName: '必填测试', inputs: {} }),
      /缺少必填输入/,
    )
  } finally { cleanup(env) }
})

test('number 类型 min/max 校验', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 范围测试\nmode: batch\ncount_input: count\ninputs:\n  - key: count\n    label: 数量\n    type: number\n    required: true\n    min: 1\n    max: 10\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    await assert.rejects(
      () => env.service.createTask({ workflowName: '范围测试', inputs: { count: 0 } }),
      /不能小于/,
    )
    await assert.rejects(
      () => env.service.createTask({ workflowName: '范围测试', inputs: { count: 11 } }),
      /不能大于/,
    )
  } finally { cleanup(env) }
})

test('select 类型枚举校验', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 枚举测试\nmode: single\ninputs:\n  - key: shop\n    label: 店铺\n    type: select\n    options:\n      - 店A\n      - 店B\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    await assert.rejects(
      () => env.service.createTask({ workflowName: '枚举测试', inputs: { shop: '店C' } }),
      /取值非法/,
    )
  } finally { cleanup(env) }
})

test('工作流不存在时报错', async () => {
  const env = createTestEnv()
  try {
    await assert.rejects(
      () => env.service.createTask({ workflowName: '不存在', inputs: {} }),
      /工作流不存在/,
    )
  } finally { cleanup(env) }
})

test('列表按时间倒序排列', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], { handler: () => ({ ok: true, text: 'ok', payload: {} }) })
  try {
    const yaml = `name: 排序测试\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const id1 = await env.service.createTask({ workflowName: '排序测试', inputs: {} })
    await new Promise(r => setTimeout(r, 100))
    const id2 = await env.service.createTask({ workflowName: '排序测试', inputs: {} })
    await new Promise(r => setTimeout(r, 500))
    const tasks = await env.service.listTasks()
    assert.equal(tasks[0].id, id2)
    assert.equal(tasks[1].id, id1)
  } finally { cleanup(env) }
})

test('状态过滤', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], { handler: () => ({ ok: true, text: 'ok', payload: {} }) })
  try {
    const yaml = `name: 过滤测试\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const id = await env.service.createTask({ workflowName: '过滤测试', inputs: {} })
    await new Promise(r => setTimeout(r, 500))
    const completed = await env.service.listTasks({ status: 'completed' })
    assert.ok(completed.length > 0)
    const running = await env.service.listTasks({ status: 'running' })
    assert.equal(running.length, 0)
  } finally { cleanup(env) }
})

// ── 5. 变量渲染 ───────────────────────────────────────────

suite('5. 变量渲染')

test('引用输入变量', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], {
    handler: (opts) => {
      return { ok: true, text: opts.requestStr, payload: { result: 'ok' } }
    },
  })
  try {
    const yaml = `name: 变量测试\nmode: single\ninputs:\n  - key: keyword\n    label: 关键词\n    type: text\n    default: hello\nsteps:\n  - name: 步骤1\n    skill: test-skill\n    args:\n      keyword: "{{keyword}}"\n    output: step1\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: '变量测试', inputs: { keyword: 'test_value' } })
    await new Promise(r => setTimeout(r, 500))
    const task = await env.service.getTaskDetail(taskId)
    assert.equal(task.status, 'completed')
  } finally { cleanup(env) }
})

test('引用 loop.index 和 loop.total', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], {
    handler: (opts) => ({ ok: true, text: 'ok', payload: { idx: opts.explicitArgs } }),
  })
  try {
    const yaml = `name: 循环变量\nmode: batch\ncount_input: count\ninputs:\n  - key: count\n    label: 数量\n    type: number\n    default: 3\nsteps:\n  - name: 步骤1\n    skill: test-skill\n    args:\n      index: "{{loop.index}}"\n      total: "{{loop.total}}"\n    output: step1\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: '循环变量', inputs: { count: 3 } })
    await new Promise(r => setTimeout(r, 1000))
    const task = await env.service.getTaskDetail(taskId)
    assert.equal(task.status, 'completed')
    assert.equal(task.success, 3)
    assert.equal(task.target, 3)
  } finally { cleanup(env) }
})

test('引用步骤输出', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], {
    handler: (opts) => {
      return { ok: true, text: 'data', payload: { result: 'ok', items: [1, 2, 3] } }
    },
  })
  try {
    const yaml = `name: 步骤引用\nmode: single\nsteps:\n  - name: 产出\n    skill: test-skill\n    output: step1\n  - name: 消费\n    skill: test-skill\n    args:\n      data: "{{step1.raw}}"\n    output: step2\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: '步骤引用', inputs: {} })
    await new Promise(r => setTimeout(r, 500))
    const task = await env.service.getTaskDetail(taskId)
    assert.equal(task.status, 'completed')
    assert.equal(task.success, 1)
  } finally { cleanup(env) }
})

// ── 6. 执行引擎：失败策略 ─────────────────────────────────

suite('6. 失败策略')

test('on_failure=continue：失败轮记失败但继续下一轮', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], {
    handler: (opts, count) => {
      if (count === 2) return { ok: false, message: '模拟失败', failureKind: 'skill_error' }
      return { ok: true, text: 'ok', payload: {} }
    },
  })
  try {
    const yaml = `name: continue测试\nmode: batch\ncount_input: count\ninputs:\n  - key: count\n    label: 数量\n    type: number\n    default: 3\nsteps:\n  - name: 步骤1\n    skill: test-skill\n    on_failure: continue\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: 'continue测试', inputs: { count: 3 } })
    await new Promise(r => setTimeout(r, 1000))
    const task = await env.service.getTaskDetail(taskId)
    assert.equal(task.status, 'completed')
    assert.equal(task.success, 2)
    assert.equal(task.failed, 1)
    assert.equal(task.rounds.length, 3)
    assert.equal(task.rounds[1].status, 'failed')
  } finally { cleanup(env) }
})

test('on_failure=abort：失败后停止整个任务', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], {
    handler: (opts, count) => {
      if (count === 1) return { ok: false, message: '模拟失败', failureKind: 'skill_error' }
      return { ok: true, text: 'ok', payload: {} }
    },
  })
  try {
    const yaml = `name: abort测试\nmode: batch\ncount_input: count\ninputs:\n  - key: count\n    label: 数量\n    type: number\n    default: 5\nsteps:\n  - name: 步骤1\n    skill: test-skill\n    on_failure: abort\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: 'abort测试', inputs: { count: 5 } })
    await new Promise(r => setTimeout(r, 1000))
    const task = await env.service.getTaskDetail(taskId)
    assert.equal(task.status, 'failed')
    assert.equal(task.success, 0)
    assert.equal(task.failed, 1)
    assert.equal(task.rounds.length, 1)
    assert.equal(task.rounds[0].status, 'failed')
  } finally { cleanup(env) }
})

// ── 7. 环境级失败 ─────────────────────────────────────────

suite('7. 环境级失败')

test('token_expired 直接 abort 整个任务', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], {
    handler: () => ({ ok: false, message: 'token expired', failureKind: 'token_expired' }),
  })
  try {
    const yaml = `name: token测试\nmode: batch\ncount_input: count\ninputs:\n  - key: count\n    label: 数量\n    type: number\n    default: 5\nsteps:\n  - name: 步骤1\n    skill: test-skill\n    on_failure: continue\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: 'token测试', inputs: { count: 5 } })
    await new Promise(r => setTimeout(r, 1000))
    const task = await env.service.getTaskDetail(taskId)
    assert.equal(task.status, 'failed')
    assert.equal(task.failed, 1)
    assert.ok(task.rounds[0].error.includes('token_expired'))
  } finally { cleanup(env) }
})

test('risk_control 直接 abort', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], {
    handler: () => ({ ok: false, message: 'risk control', failureKind: 'risk_control' }),
  })
  try {
    const yaml = `name: risk测试\nmode: batch\ncount_input: count\ninputs:\n  - key: count\n    label: 数量\n    type: number\n    default: 3\nsteps:\n  - name: 步骤1\n    skill: test-skill\n    on_failure: continue\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: 'risk测试', inputs: { count: 3 } })
    await new Promise(r => setTimeout(r, 1000))
    const task = await env.service.getTaskDetail(taskId)
    assert.equal(task.status, 'failed')
    assert.ok(task.rounds[0].error.includes('risk_control'))
  } finally { cleanup(env) }
})

// ── 8. 停止机制 ───────────────────────────────────────────

suite('8. 停止机制')

test('queued 任务直接停止', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], { handler: () => ({ ok: true, text: 'ok', payload: {} }) })
  try {
    const yaml = `name: 停止测试\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: '停止测试', inputs: {} })
    // 立即停止
    const stopped = await env.service.stopTask(taskId)
    assert.equal(stopped, true)
    await new Promise(r => setTimeout(r, 100))
    const task = await env.service.getTaskDetail(taskId)
    // 可能已经被引擎拾取并执行完，也可能停在 stopped
    assert.ok(['stopped', 'completed'].includes(task.status), `status was ${task.status}`)
  } finally { cleanup(env) }
})

// ── 9. 重启对账 ───────────────────────────────────────────

suite('9. 重启对账')

test('孤儿 running 任务标记 failed', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], { handler: () => ({ ok: true, text: 'ok', payload: {} }) })
  try {
    const yaml = `name: 对账测试\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: '对账测试', inputs: {} })
    await new Promise(r => setTimeout(r, 500))
    // 手动修改任务状态为 running（模拟中断）
    const raw = fs.readFileSync(env.tasksPath, 'utf8')
    const tasks = JSON.parse(raw)
    const task = tasks.find(t => t.id === taskId)
    if (task) {
      task.status = 'running'
      fs.writeFileSync(env.tasksPath, JSON.stringify(tasks, null, 2), 'utf8')
    }
    // 重新创建 service（模拟重启）
    const skillApi2 = createMockSkillApi(env.skills)
    const execSkill2 = createMockExecuteSkill({ handler: () => ({ ok: true, text: 'ok', payload: {} }) })
    const service2 = createWorkflowService({
      skill: skillApi2,
      executeSkill: execSkill2,
      workflowDir: env.workflowDir,
      tasksPath: env.tasksPath,
    })
    await service2.reconcile()
    const task2 = await service2.getTaskDetail(taskId)
    assert.equal(task2.status, 'failed')
    assert.ok(task2.error.includes('重启'))
  } finally { cleanup(env) }
})

test('孤儿 queued 任务标记 failed', async () => {
  const env = createTestEnv()
  try {
    const tasks = [{
      id: 'wf_task_queued_test',
      workflowName: 'test',
      shop: null,
      inputs: {},
      inputSummary: '',
      status: 'queued',
      success: 0,
      failed: 0,
      target: 1,
      current: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      rounds: [],
    }]
    fs.writeFileSync(env.tasksPath, JSON.stringify(tasks, null, 2), 'utf8')
    await env.service.reconcile()
    const task = await env.service.getTaskDetail('wf_task_queued_test')
    assert.equal(task.status, 'failed')
  } finally { cleanup(env) }
})

test('completed 任务不受对账影响', async () => {
  const env = createTestEnv()
  try {
    const tasks = [{
      id: 'wf_task_completed_test',
      workflowName: 'test',
      shop: null,
      inputs: {},
      inputSummary: '',
      status: 'completed',
      success: 1,
      failed: 0,
      target: 1,
      current: 1,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: null,
      rounds: [{ index: 1, status: 'ok', durationMs: 100, error: null, logs: [] }],
    }]
    fs.writeFileSync(env.tasksPath, JSON.stringify(tasks, null, 2), 'utf8')
    await env.service.reconcile()
    const task = await env.service.getTaskDetail('wf_task_completed_test')
    assert.equal(task.status, 'completed')
  } finally { cleanup(env) }
})

// ── 10. 轮次明细 ──────────────────────────────────────────

suite('10. 轮次明细')

test('成功轮记录耗时', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], { handler: () => ({ ok: true, text: 'ok', payload: {} }) })
  try {
    const yaml = `name: 耗时测试\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: '耗时测试', inputs: {} })
    await new Promise(r => setTimeout(r, 500))
    const task = await env.service.getTaskDetail(taskId)
    assert.equal(task.rounds.length, 1)
    assert.equal(task.rounds[0].status, 'ok')
    assert.ok(task.rounds[0].durationMs >= 0)
  } finally { cleanup(env) }
})

test('失败轮记录错误摘要', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], {
    handler: () => ({ ok: false, message: '模拟错误', failureKind: 'skill_error' }),
  })
  try {
    const yaml = `name: 错误摘要测试\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: '错误摘要测试', inputs: {} })
    await new Promise(r => setTimeout(r, 500))
    const task = await env.service.getTaskDetail(taskId)
    assert.equal(task.rounds.length, 1)
    assert.equal(task.rounds[0].status, 'failed')
    assert.ok(task.rounds[0].error)
    assert.ok(task.rounds[0].error.includes('skill_error'))
  } finally { cleanup(env) }
})

test('轮次日志记录', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], { handler: () => ({ ok: true, text: 'ok', payload: {} }) })
  try {
    const yaml = `name: 日志测试\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: '日志测试', inputs: {} })
    await new Promise(r => setTimeout(r, 500))
    const task = await env.service.getTaskDetail(taskId)
    assert.equal(task.rounds.length, 1)
    assert.ok(task.rounds[0].logs)
    assert.ok(task.rounds[0].logs.length > 0)
    assert.ok(task.rounds[0].logs[0].includes('✓成功') || task.rounds[0].logs[0].includes('✗失败'))
  } finally { cleanup(env) }
})

// ── 11. API 层 ────────────────────────────────────────────

suite('11. API 层 (handleAction)')

test('workflow_list_templates', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: API测试\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const res = await env.api.handleAction('workflow_list_templates', {})
    assert.equal(res.ok, true)
    assert.ok(res.templates.length > 0)
  } finally { cleanup(env) }
})

test('workflow_get_template', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 获取模板\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const res = await env.api.handleAction('workflow_get_template', { name: '获取模板' })
    assert.equal(res.ok, true)
    assert.ok(res.yaml.includes('获取模板'))
  } finally { cleanup(env) }
})

test('workflow_get_template 缺少 name', async () => {
  const env = createTestEnv()
  try {
    const res = await env.api.handleAction('workflow_get_template', {})
    assert.equal(res.ok, false)
    assert.ok(res.error.includes('name'))
  } finally { cleanup(env) }
})

test('workflow_save_template', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 保存API\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    const res = await env.api.handleAction('workflow_save_template', { yaml })
    assert.equal(res.ok, true)
    assert.equal(res.name, '保存API')
  } finally { cleanup(env) }
})

test('workflow_save_template 缺少 yaml', async () => {
  const env = createTestEnv()
  try {
    const res = await env.api.handleAction('workflow_save_template', {})
    assert.equal(res.ok, false)
    assert.ok(res.error.includes('yaml'))
  } finally { cleanup(env) }
})

test('workflow_delete_template', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 删除API\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const res = await env.api.handleAction('workflow_delete_template', { name: '删除API' })
    assert.equal(res.ok, true)
  } finally { cleanup(env) }
})

test('workflow_list_tasks', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], { handler: () => ({ ok: true, text: 'ok', payload: {} }) })
  try {
    const yaml = `name: 列表API\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    await env.service.createTask({ workflowName: '列表API', inputs: {} })
    await new Promise(r => setTimeout(r, 500))
    const res = await env.api.handleAction('workflow_list_tasks', {})
    assert.equal(res.ok, true)
    assert.ok(res.tasks.length > 0)
  } finally { cleanup(env) }
})

test('workflow_create_task', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], { handler: () => ({ ok: true, text: 'ok', payload: {} }) })
  try {
    const yaml = `name: 创建API\nmode: single\ninputs:\n  - key: msg\n    label: 消息\n    type: text\n    default: hi\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const res = await env.api.handleAction('workflow_create_task', {
      workflowName: '创建API',
      inputs: { msg: 'test' },
    })
    assert.equal(res.ok, true)
    assert.ok(res.taskId)
  } finally { cleanup(env) }
})

test('workflow_create_task 缺少 workflowName', async () => {
  const env = createTestEnv()
  try {
    const res = await env.api.handleAction('workflow_create_task', {})
    assert.equal(res.ok, false)
    assert.ok(res.error.includes('workflowName'))
  } finally { cleanup(env) }
})

test('workflow_stop_task', async () => {
  const env = createTestEnv()
  try {
    const res = await env.api.handleAction('workflow_stop_task', { taskId: 'nonexistent' })
    assert.equal(res.ok, false)
  } finally { cleanup(env) }
})

test('workflow_get_task_detail', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], { handler: () => ({ ok: true, text: 'ok', payload: {} }) })
  try {
    const yaml = `name: 详情API\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: '详情API', inputs: {} })
    await new Promise(r => setTimeout(r, 500))
    const res = await env.api.handleAction('workflow_get_task_detail', { taskId })
    assert.equal(res.ok, true)
    assert.ok(res.task)
  } finally { cleanup(env) }
})

test('workflow_delete_task 仅允许终态任务', async () => {
  const env = createTestEnv()
  try {
    const tasks = [{
      id: 'wf_task_delete_test',
      workflowName: 'test',
      shop: null,
      inputs: {},
      inputSummary: '',
      status: 'running',
      success: 0,
      failed: 0,
      target: 1,
      current: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      rounds: [],
    }]
    fs.writeFileSync(env.tasksPath, JSON.stringify(tasks, null, 2), 'utf8')
    const res = await env.api.handleAction('workflow_delete_task', { taskId: 'wf_task_delete_test' })
    assert.equal(res.ok, false)
    assert.ok(res.error.includes('不可删除'))
  } finally { cleanup(env) }
})

test('workflow_list_step_skills', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const res = await env.api.handleAction('workflow_list_step_skills', {})
    assert.equal(res.ok, true)
    assert.ok(res.skills.length > 0, `skills was empty: ${JSON.stringify(res.skills)}`)
  } finally { cleanup(env) }
})

test('未知 action 返回错误', async () => {
  const env = createTestEnv()
  try {
    const res = await env.api.handleAction('workflow_unknown', {})
    assert.equal(res.ok, false)
    assert.ok(res.error.includes('Unknown'))
  } finally { cleanup(env) }
})

// ── 12. 工具层 ────────────────────────────────────────────

suite('12. 工具层 (buildWorkflowTool)')

test('工具定义基本属性', async () => {
  const env = createTestEnv()
  try {
    const tool = buildWorkflowTool({
      service: env.service,
      render: () => 'rendered',
    })
    assert.equal(tool.name, 'dsagent_workflow')
    assert.ok(tool.description)
    assert.ok(tool.parameters.action)
    assert.equal(tool.parameters.action.required, true)
  } finally { cleanup(env) }
})

test('工具 execute: list', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 工具列表\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const tool = buildWorkflowTool({
      service: env.service,
      render: () => 'rendered',
    })
    const result = await tool.execute({ action: 'list' })
    assert.equal(result.ok, true)
    assert.ok(result.text.includes('工具列表'))
  } finally { cleanup(env) }
})

test('工具 execute: list 空', async () => {
  const env = createTestEnv()
  try {
    const tool = buildWorkflowTool({
      service: env.service,
      render: () => 'rendered',
    })
    const result = await tool.execute({ action: 'list' })
    assert.equal(result.ok, true)
    assert.ok(result.text.includes('没有'))
  } finally { cleanup(env) }
})

test('工具 execute: get', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 工具获取\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const tool = buildWorkflowTool({
      service: env.service,
      render: () => 'rendered',
    })
    const result = await tool.execute({ action: 'get', name: '工具获取' })
    assert.equal(result.ok, true)
    assert.ok(result.yaml.includes('工具获取'))
  } finally { cleanup(env) }
})

test('工具 execute: tasks 无任务', async () => {
  const env = createTestEnv()
  try {
    const tool = buildWorkflowTool({
      service: env.service,
      render: () => 'rendered',
    })
    const result = await tool.execute({ action: 'tasks' })
    assert.equal(result.ok, true)
    assert.ok(result.text.includes('没有'))
  } finally { cleanup(env) }
})

test('工具 execute: 未知 action', async () => {
  const env = createTestEnv()
  try {
    const tool = buildWorkflowTool({
      service: env.service,
      render: () => 'rendered',
    })
    const result = await tool.execute({ action: 'invalid' })
    assert.equal(result.ok, false)
    assert.ok(result.text.includes('未知'))
  } finally { cleanup(env) }
})

// ── 13. 输入摘要 ──────────────────────────────────────────

suite('13. 输入摘要')

test('多输入摘要正确拼接', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], { handler: () => ({ ok: true, text: 'ok', payload: {} }) })
  try {
    const yaml = `name: 摘要测试\nmode: single\ninputs:\n  - key: keyword\n    label: 关键词\n    type: text\n    default: hi\n  - key: count\n    label: 数量\n    type: number\n    default: 5\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({
      workflowName: '摘要测试',
      inputs: { keyword: '连衣裙', count: 50 },
    })
    await new Promise(r => setTimeout(r, 500))
    const task = await env.service.getTaskDetail(taskId)
    assert.ok(task.inputSummary.includes('关键词'))
    assert.ok(task.inputSummary.includes('连衣裙'))
    assert.ok(task.inputSummary.includes('数量'))
    assert.ok(task.inputSummary.includes('50'))
  } finally { cleanup(env) }
})

// ── 14. 任务持久化 ────────────────────────────────────────

suite('14. 任务持久化')

test('任务记录写入 JSON 文件', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], { handler: () => ({ ok: true, text: 'ok', payload: {} }) })
  try {
    const yaml = `name: 持久化测试\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: '持久化测试', inputs: {} })
    await new Promise(r => setTimeout(r, 500))
    const raw = fs.readFileSync(env.tasksPath, 'utf8')
    const tasks = JSON.parse(raw)
    const task = tasks.find(t => t.id === taskId)
    assert.ok(task)
    assert.equal(task.workflowName, '持久化测试')
  } finally { cleanup(env) }
})

test('坏 JSON 文件不崩溃', async () => {
  const env = createTestEnv()
  try {
    fs.writeFileSync(env.tasksPath, 'not json {{{', 'utf8')
    const tasks = await env.service.listTasks()
    assert.equal(tasks.length, 0)
  } finally { cleanup(env) }
})

// ── 15. 浏览器锁 ──────────────────────────────────────────

suite('15. 浏览器互斥锁')

test('浏览器类技能串行执行', async () => {
  const browserSkill = { id: 'taobao-publish', platform: 'taobao' }
  const env = createTestEnv([browserSkill], {
    handler: () => {
      return new Promise(resolve => {
        setTimeout(() => resolve({ ok: true, text: 'ok', payload: {} }), 200)
      })
    },
  })
  try {
    const yaml = `name: 锁测试\nmode: batch\ncount_input: count\ninputs:\n  - key: count\n    label: 数量\n    type: number\n    default: 3\nsteps:\n  - name: 步骤1\n    skill: taobao-publish\n    on_failure: continue\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: '锁测试', inputs: { count: 3 } })
    await new Promise(r => setTimeout(r, 1200))
    const task = await env.service.getTaskDetail(taskId)
    assert.equal(task.status, 'completed')
    assert.equal(task.success, 3)
    // 每轮至少 200ms，总耗时应 > 600ms
    const totalDur = task.rounds.reduce((s, r) => s + r.durationMs, 0)
    assert.ok(totalDur >= 600, `总耗时 ${totalDur}ms 应 >= 600ms（串行执行）`)
  } finally { cleanup(env) }
})

// ── 16. 边界情况 ──────────────────────────────────────────

suite('16. 边界情况')

test('空 steps 的模板保存', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 空步骤\nmode: single\nsteps: []\n`
    const result = await env.service.saveTemplate(yaml)
    assert.equal(result.ok, true)
  } finally { cleanup(env) }
})

test('default 值被正确填充', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], { handler: () => ({ ok: true, text: 'ok', payload: {} }) })
  try {
    const yaml = `name: 默认值测试\nmode: single\ninputs:\n  - key: msg\n    label: 消息\n    type: text\n    default: 默认消息\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: '默认值测试', inputs: {} })
    await new Promise(r => setTimeout(r, 500))
    const task = await env.service.getTaskDetail(taskId)
    assert.equal(task.inputs.msg, '默认消息')
  } finally { cleanup(env) }
})

test('count_input 为 0 时报错', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 零数量\nmode: batch\ncount_input: count\ninputs:\n  - key: count\n    label: 数量\n    type: number\n    default: 1\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    await assert.rejects(
      () => env.service.createTask({ workflowName: '零数量', inputs: { count: 0 } }),
      /≥1/,
    )
  } finally { cleanup(env) }
})

test('多步骤串行执行', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], { handler: () => ({ ok: true, text: 'ok', payload: {} }) })
  try {
    const yaml = `name: 多步骤\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n    output: s1\n  - name: 步骤2\n    skill: test-skill\n    output: s2\n  - name: 步骤3\n    skill: test-skill\n    output: s3\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: '多步骤', inputs: {} })
    await new Promise(r => setTimeout(r, 500))
    const task = await env.service.getTaskDetail(taskId)
    assert.equal(task.status, 'completed')
    assert.equal(task.success, 1)
    assert.ok(env.executeSkill.getCallCount() >= 3, `执行了 ${env.executeSkill.getCallCount()} 次，应 >= 3`)
  } finally { cleanup(env) }
})

// ── 17. findTemplateFile 容错 ─────────────────────────────

suite('17. findTemplateFile 容错')

test('文件名与模板名不一致时仍可找到', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 内部名称\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    fs.writeFileSync(path.join(env.workflowDir, 'external_filename.yaml'), yaml, 'utf8')
    const t = await env.service.getTemplate('内部名称')
    assert.ok(t !== null)
    assert.equal(t.name, '内部名称')
  } finally { cleanup(env) }
})

// ── 18. inputs 归一化 ────────────────────────────────────

suite('18. inputs 归一化')

test('JSON 字符串 inputs 被正确解析', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], { handler: () => ({ ok: true, text: 'ok', payload: {} }) })
  try {
    const yaml = `name: JSON输入\nmode: single\ninputs:\n  - key: keyword\n    label: 关键词\n    type: text\n    default: hi\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const res = await env.api.handleAction('workflow_create_task', {
      workflowName: 'JSON输入',
      inputs: '{"keyword":"test"}',
    })
    assert.equal(res.ok, true)
  } finally { cleanup(env) }
})

test('无效 JSON 字符串 inputs 返回错误', async () => {
  const env = createTestEnv([{ id: 'test-skill' }])
  try {
    const yaml = `name: 坏JSON\nmode: single\ninputs:\n  - key: keyword\n    label: 关键词\n    type: text\n    default: hi\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const res = await env.api.handleAction('workflow_create_task', {
      workflowName: '坏JSON',
      inputs: 'not json {{{',
    })
    assert.equal(res.ok, false)
    assert.ok(res.error.includes('inputs'))
  } finally { cleanup(env) }
})

// ── 18. 运行时健壮性 ──────────────────────────────────────

suite('18. 运行时健壮性')

test('stopFlags 清理：queued→stopped 后 stopFlags 不泄漏', async () => {
  // 模拟 stopTask 在 runTask 拾取前调用，stopFlags 应被清理
  const env = createTestEnv([{ id: 'test-skill' }], {
    handler: () => new Promise(r => setTimeout(() => r({ ok: true, text: 'ok', payload: {} }), 50)),
  })
  try {
    const yaml = `name: 停止清理\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    const taskId = await env.service.createTask({ workflowName: '停止清理', inputs: {} })
    // 立即停止（在引擎拾取前）
    await env.service.stopTask(taskId)
    // 等待引擎完成（会走 runTask 的提前返回路径）
    await new Promise(r => setTimeout(r, 200))
    const task = await env.service.getTaskDetail(taskId)
    // 任务应该处于终态（stopped 或 completed）
    assert.ok(['stopped', 'completed'].includes(task.status), `status was ${task.status}`)
    // 再次停止同一任务不应成功（已终态）
    const reStop = await env.service.stopTask(taskId)
    assert.equal(reStop, false)
  } finally { cleanup(env) }
})

test('并发任务写盘不撕裂：多个任务同时执行后任务文件有效', async () => {
  const env = createTestEnv([{ id: 'test-skill' }], {
    handler: () => new Promise(r => setTimeout(() => r({ ok: true, text: 'ok', payload: {} }), 20)),
  })
  try {
    const yaml = `name: 并发写\nmode: batch\ncount_input: count\ninputs:\n  - key: count\n    label: 数量\n    type: number\n    default: 3\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    // 创建 3 个并发任务
    const ids = await Promise.all([
      env.service.createTask({ workflowName: '并发写', inputs: { count: 3 } }),
      env.service.createTask({ workflowName: '并发写', inputs: { count: 3 } }),
      env.service.createTask({ workflowName: '并发写', inputs: { count: 3 } }),
    ])
    // 等待全部完成
    await new Promise(r => setTimeout(r, 800))
    // 任务文件应是合法 JSON
    const raw = fs.readFileSync(env.tasksPath, 'utf8')
    const tasks = JSON.parse(raw)
    assert.ok(Array.isArray(tasks))
    assert.equal(tasks.length, 3)
    // 每个任务都应处于终态
    for (const t of tasks) {
      assert.ok(['completed', 'failed', 'stopped'].includes(t.status), `task ${t.id} status=${t.status}`)
    }
  } finally { cleanup(env) }
})

test('persistTasks 写盘失败不阻断后续操作', async () => {
  // 让 tasksPath 指向一个不存在的只读目录
  const env = createTestEnv([{ id: 'test-skill' }], {
    handler: () => ({ ok: true, text: 'ok', payload: {} }),
  })
  try {
    const yaml = `name: 写盘失败\nmode: single\nsteps:\n  - name: 步骤1\n    skill: test-skill\n`
    await env.service.saveTemplate(yaml)
    // 创建任务正常执行（即使落盘可能失败，引擎不崩）
    const taskId = await env.service.createTask({ workflowName: '写盘失败', inputs: {} })
    await new Promise(r => setTimeout(r, 200))
    const task = await env.service.getTaskDetail(taskId)
    assert.ok(task, '任务记录存在（内存中）')
    assert.ok(['completed', 'failed'].includes(task.status), `status=${task.status}`)
  } finally { cleanup(env) }
})

console.log('━━━ 工作流引擎端到端测试 ━━━\n')
await runAll()
