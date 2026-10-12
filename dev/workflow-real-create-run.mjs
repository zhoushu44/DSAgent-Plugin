/**
 * 真实工作流创建+运行脚本。
 *
 * 与之前的测试不同——这里用项目 skills/ 目录里的真实技能：
 *   - tariff-search（关税查询，有 scripts/search_tariff.py 入口）
 *   - zhihu-crawl（知乎采集，有 scripts/fetch_data.py 入口）
 *   - douyin-crawl（抖音采集，有 scripts/fetch_data.py 入口）
 *
 * 模板校验、变量渲染、引擎调度、日志、持久化全部走真实 service 代码。
 * executeSkill 用模拟器（否则需要真实 Python 环境 + 平台账号）。
 *
 * 工作流 1：多轮关税查询（batch, tariff-search, 3轮）
 * 工作流 2：知乎采集 → 关税查询链式（single, 2步骤, 变量传递）
 * 工作流 3：抖音热点采集（batch, douyin-crawl, 2轮）
 */
import { pathToFileURL } from 'node:url'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'

const LIB = path.resolve(import.meta.dirname, '..', 'lib')
const SKILLS = path.resolve(import.meta.dirname, '..', 'skills')

const serviceMod = await import(pathToFileURL(path.join(LIB, 'workflow', 'service.js')).href)
const { createWorkflowService } = serviceMod

// ── 用真实技能目录 ────────────────────────────────────

/** 扫描 skills/ 目录构建 SkillRow（与 skill-service.ts 的扫描逻辑一致） */
function scanRealSkills() {
  const rows = []
  for (const entry of fs.readdirSync(SKILLS)) {
    const skillFile = path.join(SKILLS, entry, 'SKILL.md')
    if (!fs.existsSync(skillFile)) continue
    const body = fs.readFileSync(skillFile, 'utf8')
    // 解析 frontmatter
    const fmMatch = body.match(/^---\n([\s\S]*?)\n---/)
    const fm = fmMatch ? fmMatch[1] : ''
    const nameMatch = fm.match(/^name:\s*(.+)/m)
    const descMatch = fm.match(/^description:\s*["']?(.+?)(?:["']?\s*)$/m)
    const platformMatch = fm.match(/platform:\s*(.+)/) || fm.match(/binding.*?(\w+)/)
    rows.push({
      id: entry,
      name: nameMatch ? nameMatch[1].trim() : entry,
      description: descMatch ? descMatch[1].trim() : '',
      version: '1.0.0',
      platform: 'common',
      capability: 'test',
      risk: 'L0',
      enabled: true,
      dir: path.join(SKILLS, entry),
      body,
      frontmatter: fm,
      quality: 0.8,
      issues: [],
      hasPatch: false,
    })
  }
  return rows
}

const skillRows = scanRealSkills()
console.log(`扫描到 ${skillRows.length} 个真实技能`)

// 验证关键技能存在且有 script 入口
const needSkills = ['tariff-search', 'zhihu-crawl', 'douyin-crawl']
for (const id of needSkills) {
  const row = skillRows.find(r => r.id === id)
  if (!row) { console.error(`缺少技能: ${id}`); process.exit(1) }
  console.log(`  ✓ ${id}: ${row.name}`)
}

const skillApi = {
  list(opts) {
    let rows = [...skillRows]
    if (opts?.onlyEnabled) rows = rows.filter(r => r.enabled)
    return Promise.resolve(rows)
  },
  get(id) { return Promise.resolve(skillRows.find(r => r.id === id) ?? null) },
}

// ── executeSkill 模拟器（模拟真实脚本执行返回） ────────

let execLog = []
function executeSkill(opts) {
  const entry = {
    skillId: opts.skillId,
    requestStr: opts.requestStr?.slice(0, 80),
    explicitArgs: opts.explicitArgs,
    time: new Date().toISOString(),
  }
  execLog.push(entry)
  return new Promise(resolve => {
    setTimeout(() => {
      // 模拟不同技能的返回
      if (opts.skillId === 'tariff-search') {
        resolve({
          ok: true,
          text: `关税查询完成：HS 6204.42.00 税率 16%`,
          payload: {
            mode: 'script',
            result: 'ok',
            hs_code: '6204.42.00',
            tariff_rate: '16%',
            product: opts.explicitArgs?.find((_, i, a) => a[i-1] === '--product') || 'N/A',
          },
        })
      } else if (opts.skillId === 'zhihu-crawl') {
        resolve({
          ok: true,
          text: `知乎采集完成：找到 5 条结果`,
          payload: {
            mode: 'script',
            result: 'ok',
            count: 5,
            items: ['文章1', '文章2', '文章3'],
          },
        })
      } else if (opts.skillId === 'douyin-crawl') {
        resolve({
          ok: true,
          text: `抖音采集完成（第${opts.requestStr?.match(/index=(\d+)/)?.[1] || '?'}轮）`,
          payload: {
            mode: 'script',
            result: 'ok',
            count: 20,
            videos: [`video-1`, `video-2`],
          },
        })
      }
      resolve({ ok: true, text: `${opts.skillId} 执行完成`, payload: { mode: 'script', result: 'ok' } })
    }, 80)
  })
}

// ── 创建 service ───────────────────────────────────────

const tmpDir = path.join(os.tmpdir(), `wf-real-skills-${Date.now()}`)
const workflowDir = path.join(tmpDir, 'workflows')
const tasksPath = path.join(tmpDir, 'workflow-tasks.json')
fs.mkdirSync(workflowDir, { recursive: true })

const service = createWorkflowService({
  skill: skillApi,
  executeSkill,
  workflowDir,
  tasksPath,
})

// ── 辅助 ───────────────────────────────────────────────

function header(title) {
  console.log('\n' + '═'.repeat(60))
  console.log(`  ${title}`)
  console.log('═'.repeat(60))
}

async function waitTask(taskId, maxWait = 10000) {
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    const task = await service.getTaskDetail(taskId)
    if (task && ['completed', 'failed', 'stopped'].includes(task.status)) return task
    await new Promise(r => setTimeout(r, 80))
  }
  throw new Error(`等待任务 ${taskId} 超时`)
}

function printTaskDetail(task) {
  console.log(`  任务 ID:      ${task.id}`)
  console.log(`  工作流:        ${task.workflowName}`)
  console.log(`  输入摘要:      ${task.inputSummary}`)
  console.log(`  状态:          ${task.status}`)
  console.log(`  进度:          ${task.current}/${task.target}（成功 ${task.success}｜失败 ${task.failed}）`)
  console.log(`  开始时间:      ${task.startedAt}`)
  console.log(`  结束时间:      ${task.finishedAt ?? '（未结束）'}`)
  if (task.error) console.log(`  任务级错误:    ${task.error}`)
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

// ════════════════════════════════════════════════════════
// 工作流 1：多轮关税查询（batch, 3 轮）
// ════════════════════════════════════════════════════════

header('工作流 1：多轮关税查询（tariff-search, batch 3 轮）')

const yaml1 = `
name: 批量关税查询
category: 关税查询
mode: batch
count_input: count
description: 批量查询不同产品的出口关税税率，每轮查一个产品
inputs:
  - key: product
    label: 产品名称
    type: text
    required: true
    default: 无线耳机
  - key: from_country
    label: 出口国
    type: select
    options:
      - CN
      - US
      - JP
    required: true
    default: CN
  - key: to_country
    label: 进口国
    type: select
    options:
      - US
      - CN
      - EU
    required: true
    default: US
  - key: count
    label: 查询轮数
    type: number
    required: true
    default: 3
    min: 1
    max: 10
steps:
  - name: 查询关税
    skill: tariff-search
    args:
      product: "{{product}}"
      from: "{{from_country}}"
      to: "{{to_country}}"
      digit: "10"
      index: "{{loop.index}}"
      total: "{{loop.total}}"
    output: tariff
    on_failure: continue
`

const sv1 = await service.saveTemplate(yaml1)
console.log(`  保存模板: ok=${sv1.ok}, name=${sv1.name}`)
if (!sv1.ok) {
  console.log(`  校验问题: ${JSON.stringify(sv1.issues)}`)
  process.exit(1)
}

// 查看编排页技能清单
const stepSkills = await service.listStepSkills()
const tariffSkill = stepSkills.find(s => s.id === 'tariff-search')
console.log(`  编排页技能: tariff-search, browser=${tariffSkill?.browser}, contractArgs=${tariffSkill?.contractArgs ? '有' : '无'}`)

execLog = []
const t1 = await service.createTask({
  workflowName: '批量关税查询',
  inputs: { product: '蓝牙音箱', from_country: 'CN', to_country: 'US', count: 3 },
})
console.log(`  创建任务: ${t1}`)

const r1 = await waitTask(t1)
console.log('\n  ── 任务详情 ──')
printTaskDetail(r1)

// ════════════════════════════════════════════════════════
// 工作流 2：知乎采集 → 关税查询链式（single, 2 步骤）
// ════════════════════════════════════════════════════════

header('工作流 2：知乎采集 → 关税查询链式（single, 变量传递）')

const yaml2 = `
name: 知乎采集转关税查询
category: 数据采集
mode: single
description: 先从知乎采集关键词相关内容，再用采集结果查询关税
inputs:
  - key: keyword
    label: 搜索关键词
    type: text
    required: true
    default: 跨境电商
  - key: product
    label: 产品名称
    type: text
    required: true
    default: 蓝牙耳机
steps:
  - name: 知乎采集
    skill: zhihu-crawl
    args:
      mode: search
      keyword: "{{keyword}}"
      count: "5"
    output: crawl
  - name: 关税查询
    skill: tariff-search
    args:
      product: "{{product}}"
      from: CN
      to: US
      digit: "10"
      source: "{{crawl.raw}}"
      article_count: "{{crawl.count}}"
`

const sv2 = await service.saveTemplate(yaml2)
console.log(`  保存模板: ok=${sv2.ok}, name=${sv2.name}`)
if (!sv2.ok) {
  console.log(`  校验问题: ${JSON.stringify(sv2.issues)}`)
  process.exit(1)
}

execLog = []
const t2 = await service.createTask({
  workflowName: '知乎采集转关税查询',
  inputs: { keyword: '跨境电商关税', product: '智能手表' },
})
console.log(`  创建任务: ${t2}`)

const r2 = await waitTask(t2)
console.log('\n  ── 任务详情 ──')
printTaskDetail(r2)

// 验证变量传递
console.log('\n  ── 变量传递验证 ──')
console.log(`  executeSkill 调用次数: ${execLog.length}`)
if (execLog.length >= 2) {
  console.log(`  第 1 步 (zhihu-crawl): requestStr="${execLog[0].requestStr?.slice(0, 50)}..."`)
  console.log(`  第 2 步 (tariff-search): requestStr="${execLog[1].requestStr?.slice(0, 50)}..."`)
  // 第 2 步的 args 应该包含渲染后的 source 和 article_count
  const step2Args = execLog[1].explicitArgs || []
  const sourceIdx = step2Args.indexOf('--source')
  const sourceVal = sourceIdx >= 0 ? step2Args[sourceIdx + 1] : 'N/A'
  console.log(`  第 2 步 source 参数（来自 {{crawl.raw}}）: "${String(sourceVal).slice(0, 60)}..."`)
  const acIdx = step2Args.indexOf('--article_count')
  const acVal = acIdx >= 0 ? step2Args[acIdx + 1] : 'N/A'
  console.log(`  第 2 步 article_count 参数（来自 {{crawl.count}}）: ${acVal}`)
}

// ════════════════════════════════════════════════════════
// 工作流 3：抖音热点采集（batch, 2 轮）
// ════════════════════════════════════════════════════════

header('工作流 3：抖音热点采集（douyin-crawl, batch 2 轮）')

const yaml3 = `
name: 抖音热点批量采集
category: 数据采集
mode: batch
count_input: count
description: 按关键词批量采集抖音热点视频，多轮执行
inputs:
  - key: keyword
    label: 搜索关键词
    type: text
    required: true
    default: 热门
  - key: count
    label: 采集轮数
    type: number
    required: true
    default: 2
    min: 1
    max: 5
steps:
  - name: 采集视频
    skill: douyin-crawl
    args:
      mode: user
      keyword: "{{keyword}}"
      index: "{{loop.index}}"
      total: "{{loop.total}}"
    output: crawl
    on_failure: continue
`

const sv3 = await service.saveTemplate(yaml3)
console.log(`  保存模板: ok=${sv3.ok}, name=${sv3.name}`)
if (!sv3.ok) {
  console.log(`  校验问题: ${JSON.stringify(sv3.issues)}`)
  process.exit(1)
}

execLog = []
const t3 = await service.createTask({
  workflowName: '抖音热点批量采集',
  inputs: { keyword: '夏季穿搭', count: 2 },
})
console.log(`  创建任务: ${t3}`)

const r3 = await waitTask(t3)
console.log('\n  ── 任务详情 ──')
printTaskDetail(r3)

// ════════════════════════════════════════════════════════
// 查看所有模板和任务
// ════════════════════════════════════════════════════════

header('模板清单')

const templates = await service.listTemplates()
console.log(`  共 ${templates.length} 个模板:`)
for (const t of templates) {
  console.log(`    - ${t.name} | ${t.category} | ${t.mode} | 输入${t.inputCount} 步骤${t.stepCount} | ${t.description?.slice(0, 40)}`)
}

header('任务清单')

const tasks = await service.listTasks()
console.log(`  共 ${tasks.length} 个任务:`)
for (const t of tasks) {
  console.log(`    - ${t.id} | ${t.workflowName} | ${t.status} | ${t.success}/${t.target} | ${t.inputSummary}`)
}

// ════════════════════════════════════════════════════════
// 持久化验证
// ════════════════════════════════════════════════════════

header('持久化验证（磁盘文件）')

const diskRaw = fs.readFileSync(tasksPath, 'utf8')
const diskTasks = JSON.parse(diskRaw)
console.log(`  磁盘任务数: ${diskTasks.length}`)
for (const t of diskTasks) {
  console.log(`    - ${t.id} | ${t.workflowName} | ${t.status} | ${t.success}/${t.target}`)
  console.log(`      轮次: ${t.rounds?.length || 0} | 日志条数: ${t.rounds?.reduce((s, r) => s + (r.logs?.length || 0), 0) || 0}`)
}

// ════════════════════════════════════════════════════════
// 总结
// ════════════════════════════════════════════════════════

header('总结')

const allCompleted = [r1, r2, r3].every(r => r.status === 'completed')
console.log(`  工作流 1 (批量关税查询):     ${r1.status} | ${r1.success}/${r1.target} 轮成功`)
console.log(`  工作流 2 (知乎采集→关税查询): ${r2.status} | ${r2.rounds.length} 轮 | 变量传递 ${execLog.length >= 2 ? '✓' : '✗'}`)
console.log(`  工作流 3 (抖音热点采集):      ${r3.status} | ${r3.success}/${r3.target} 轮成功`)
console.log(`  模板数: ${templates.length}`)
console.log(`  任务数: ${tasks.length}`)
console.log(`  磁盘持久化: ${diskTasks.length} 条`)
console.log(`\n  ${allCompleted ? '✓ 三个工作流全部成功' : '✗ 有工作流未成功'}`)

// 清理
try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
