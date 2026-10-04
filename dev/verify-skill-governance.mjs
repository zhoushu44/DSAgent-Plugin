/**
 * 端到端验证新增的质量治理 / 触发路由 / 统计 / 补丁四套机制。
 *
 * 只依赖 lib/ 编译产物，不触碰真实凭证库与技能目录（补丁/统计走临时目录）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert'

import {
  validateSkill, scoreSkill, parseToolTriggers, detectYamlHazards,
  matchesTriggerArgs, splitSkillMarkdown, readFrontmatterField, LIMITS,
} from '../lib/services/skill-quality.js'
import { createToolTriggerRegistry } from '../lib/services/tool-triggers.js'
import { createSkillStats, computeSkillScore, EVICTION } from '../lib/services/skill-stats.js'
import { readSkillPatch, mergePatch, PATCH_FILENAME } from '../lib/services/skill-patch.js'

let pass = 0, fail = 0
function ok(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++ }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++ }
}
async function okAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++ }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++ }
}

/* ══════════════ 1. 双语槽位评分 ══════════════ */
console.log('\n[1] 双语槽位评分（Accio 同量表）')

const goodCn = `---
name: demo-cn
description: ${'演示技能用途与触发场景。'.repeat(8)}
---

# 演示

## 前置条件
- 需要先绑定对应平台账号，否则取数会返回未绑定。

## 工作流
1. 通过本地网关取回原始数据。
2. 归一化字段并丢弃空行。
3. 渲染报告并写入 artifacts 目录。

## 错误处理
- 命中风控时走 dsagent_risk_verify 过验证后再重试。

补充说明：本段用于把正文长度推过质量评分要求的 200 字符下限，
避免因样例过短而误判为正文不合格。
`
const goodEn = `---
name: demo-en
description: ${'Demo skill usage and triggers. '.repeat(6)}
---

# Demo

## Preconditions
- Requires a bound account before running any step.

## Workflow
1. Fetch the raw records through the gateway client.
2. Normalise the payload and drop empty rows.
3. Render the report and write it to the artifacts directory.

## Pitfalls
- Risk control returns a challenge page instead of data.
`
const padEn = '\nAdditional operational notes kept long enough to clear the 200 character body floor used by the quality rubric.\n'

ok('中文技能命中全部三个槽位', () => {
  const v = validateSkill(goodCn)
  assert.equal(v.score.breakdown.hasWorkflow, true, 'workflow')
  assert.equal(v.score.breakdown.hasErrorHandling, true, 'errorHandling')
  assert.equal(v.score.breakdown.hasPrecondition, true, 'precondition')
  assert.equal(v.score.score, 1, `score=${v.score.score}`)
})
ok('英文技能得同样满分（中英等价）', () => {
  const v = validateSkill(goodEn + padEn)
  assert.equal(v.score.score, 1, `score=${v.score.score}`)
})
ok('描述式中文标题也能命中（## 完整 HTML 报告工作流）', () => {
  const raw = goodCn.replace('## 工作流', '## 完整 HTML 报告工作流（含分析结论）')
  assert.equal(validateSkill(raw).score.breakdown.hasWorkflow, true)
})
ok('描述式中文标题也能命中（## 4 步主流程）', () => {
  const raw = goodCn.replace('## 工作流', '## 4 步主流程')
  assert.equal(validateSkill(raw).score.breakdown.hasWorkflow, true)
})
ok('### 三级标题不误判为槽位', () => {
  const raw = `---\nname: x\ndescription: ${'y'.repeat(80)}\n---\n\n# t\n\n### 工作流\n1. a\n${'z'.repeat(250)}`
  assert.equal(validateSkill(raw).score.breakdown.hasWorkflow, false)
})
ok('缺 frontmatter → 0 分 + error', () => {
  const v = validateSkill('# 没有 frontmatter\n\n## 工作流\n1. a')
  assert.equal(v.score.score, 0)
  assert.ok(v.issues.some(i => i.code === 'missing_frontmatter' && i.severity === 'error'))
})
ok('description 过短报 error，过长报 warn', () => {
  const short = validateSkill(`---\nname: a\ndescription: 太短\n---\n\n## 工作流\n1. x\n${'z'.repeat(250)}`)
  assert.ok(short.issues.some(i => i.code === 'desc_too_short' && i.severity === 'error'))
  const long = validateSkill(`---\nname: a\ndescription: ${'x'.repeat(500)}\n---\n\n## 工作流\n1. x\n${'z'.repeat(250)}`)
  assert.ok(long.issues.some(i => i.code === 'desc_too_long' && i.severity === 'warn'))
})
ok('Workflow 超过 7 步报 warn', () => {
  const raw = `---\nname: a\ndescription: ${'x'.repeat(80)}\n---\n\n## 工作流\n${[1,2,3,4,5,6,7,8,9].map(i => `${i}. step`).join('\n')}\n${'z'.repeat(250)}`
  assert.ok(validateSkill(raw).issues.some(i => i.code === 'workflow_too_detailed'))
})
ok('阈值常量与 Accio 对齐', () => {
  assert.equal(LIMITS.DESC_MIN, 72)
  assert.equal(LIMITS.DESC_MAX, 420)
  assert.equal(LIMITS.WORKFLOW_MAX_STEPS, 7)
  assert.equal(LIMITS.BODY_MIN_LENGTH, 200)
})

/* ══════════════ 2. frontmatter 解析加固 ══════════════ */
console.log('\n[2] frontmatter 解析加固')

ok('块标量 description 正确取值（不解析成 "|"）', () => {
  const raw = `---\nname: a\ndescription: |\n  第一行\n  第二行\n---\n\n## 工作流\n1. x`
  const { frontmatter } = splitSkillMarkdown(raw)
  assert.equal(readFrontmatterField(frontmatter, 'description'), '第一行 第二行')
})
ok('带 BOM 的文件仍能识别 frontmatter', () => {
  const raw = '\uFEFF---\nname: a\ndescription: hello\n---\n\n## 工作流\n1. x'
  assert.equal(splitSkillMarkdown(raw).hasFrontmatter, true)
})
ok('引号包裹的值被正确剥离', () => {
  const fm = `name: "quoted-name"\ndescription: 'single'`
  assert.equal(readFrontmatterField(fm, 'name'), 'quoted-name')
  assert.equal(readFrontmatterField(fm, 'description'), 'single')
})
ok('检测 [ 开头的 YAML 陷阱（Accio 明确警告的那类）', () => {
  const hazards = detectYamlHazards('description: [src: a.md#L1, b.md#L2]')
  assert.equal(hazards.length, 1)
  assert.equal(hazards[0].char, '[')
})
ok('[ 开头但已加引号 → 不报陷阱', () => {
  assert.equal(detectYamlHazards('description: "[src: a.md#L1]"').length, 0)
})
ok('块标量不报陷阱', () => {
  assert.equal(detectYamlHazards('description: |\n  [src: a.md]').length, 0)
})

/* ══════════════ 3. tool_triggers 解析与匹配 ══════════════ */
console.log('\n[3] tool_triggers 解析与匹配')

const triggerFm = [
  'name: x',
  'tool_triggers:',
  '  - tool: dsagent_execute_skill',
  '    args:',
  '      id: /^(product-reviews|product-wdj)$/',
  '  - tool: dsagent_proxy',
].join('\n')

ok('解析出 2 条规则', () => {
  const t = parseToolTriggers(triggerFm)
  assert.equal(t.length, 2, JSON.stringify(t))
  assert.equal(t[0].tool, 'dsagent_execute_skill')
  assert.equal(t[0].args.id, '/^(product-reviews|product-wdj)$/')
  assert.equal(t[1].tool, 'dsagent_proxy')
  assert.equal(t[1].args, undefined)
})
ok('空声明 [] → 0 条', () => {
  assert.equal(parseToolTriggers('tool_triggers: []').length, 0)
})
ok('无声明 → 0 条', () => {
  assert.equal(parseToolTriggers('name: x\ndescription: y').length, 0)
})
ok('tool 缺省项被丢弃', () => {
  assert.equal(parseToolTriggers('tool_triggers:\n  - args:\n      id: abc').length, 0)
})
ok('多键 args 全部解析', () => {
  const t = parseToolTriggers('tool_triggers:\n  - tool: t\n    args:\n      a: "1"\n      b: /x/')
  assert.deepEqual(t[0].args, { a: '1', b: '/x/' })
})
ok('args 正则匹配', () => {
  assert.equal(matchesTriggerArgs({ id: '/^(a|b)$/' }, { id: 'a' }), true)
  assert.equal(matchesTriggerArgs({ id: '/^(a|b)$/' }, { id: 'c' }), false)
})
ok('args 精确匹配', () => {
  assert.equal(matchesTriggerArgs({ mode: 'feed' }, { mode: 'feed' }), true)
  assert.equal(matchesTriggerArgs({ mode: 'feed' }, { mode: 'search' }), false)
})
ok('缺参数 → 不匹配（与 Accio 一致）', () => {
  assert.equal(matchesTriggerArgs({ mode: 'feed' }, {}), false)
  assert.equal(matchesTriggerArgs({ mode: 'feed' }, { mode: null }), false)
})
ok('非法正则 → 不匹配且回调被触发', () => {
  let called = false
  const r = matchesTriggerArgs({ id: '/([unclosed/' }, { id: 'x' }, () => { called = true })
  assert.equal(r, false)
  assert.equal(called, true)
})

/* ══════════════ 4. 触发注册表 ══════════════ */
console.log('\n[4] 触发注册表（含内置规则）')

const reg = createToolTriggerRegistry()
reg.rebuild([
  { id: 'product-reviews', description: '评价采集', skillPath: '/s/product-reviews/SKILL.md', frontmatter: triggerFm },
  { id: 'other-skill', description: '别的技能', skillPath: '/s/other/SKILL.md', frontmatter: 'name: other-skill' },
])

ok('命中声明式规则', () => {
  const hits = reg.match('dsagent_execute_skill', { id: 'product-reviews' })
  assert.ok(hits.some(h => h.skillId === 'product-reviews'), JSON.stringify(hits))
})
ok('未命中不相关的技能', () => {
  const hits = reg.match('dsagent_execute_skill', { id: 'other-skill' })
  assert.equal(hits.some(h => h.skillId === 'other-skill'), false)
})
ok('内置风控规则对淘宝系技能生效', () => {
  const hits = reg.match('dsagent_execute_skill', { id: 'product-wdj' })
  assert.ok(hits.some(h => h.skillId.startsWith('builtin:')), JSON.stringify(hits))
})
ok('内置规则对无关技能不生效（如 a-stock-diagnosis）', () => {
  const hits = reg.match('dsagent_execute_skill', { id: 'a-stock-diagnosis' })
  assert.equal(hits.length, 0, JSON.stringify(hits))
})
ok('会话级去重：同会话第二次不重复提示', () => {
  const r2 = createToolTriggerRegistry()
  r2.rebuild([])
  const first = r2.match('dsagent_execute_skill', { id: 'product-wdj' }, 'sess-1')
  const second = r2.match('dsagent_execute_skill', { id: 'product-wdj' }, 'sess-1')
  const other = r2.match('dsagent_execute_skill', { id: 'product-wdj' }, 'sess-2')
  assert.ok(first.length > 0)
  assert.equal(second.length, 0, '同会话应去重')
  assert.ok(other.length > 0, '不同会话应重新提示')
})
ok('resetSession 清空该会话去重状态', () => {
  const r3 = createToolTriggerRegistry()
  r3.rebuild([])
  r3.match('dsagent_execute_skill', { id: 'product-wdj' }, 's')
  assert.equal(r3.match('dsagent_execute_skill', { id: 'product-wdj' }, 's').length, 0)
  r3.resetSession('s')
  assert.ok(r3.match('dsagent_execute_skill', { id: 'product-wdj' }, 's').length > 0)
})
ok('formatHint 渲染文件类提示', () => {
  const r4 = createToolTriggerRegistry()
  r4.rebuild([{ id: 's1', description: 'desc1', skillPath: '/a/SKILL.md', frontmatter: 'tool_triggers:\n  - tool: t1' }])
  const txt = r4.formatHint(r4.match('t1', {}))
  assert.ok(txt.includes('s1') && txt.includes('/a/SKILL.md'), txt)
})
ok('formatHint 渲染内置提示正文', () => {
  const r5 = createToolTriggerRegistry()
  r5.rebuild([])
  const txt = r5.formatHint(r5.match('dsagent_execute_skill', { id: 'product-wdj' }))
  assert.ok(txt.includes('dsagent_risk_verify'), txt)
})
ok('非法正则在 rebuild 阶段被丢弃', () => {
  const r6 = createToolTriggerRegistry()
  r6.rebuild([{ id: 'bad', description: 'd', skillPath: '/b/SKILL.md', frontmatter: 'tool_triggers:\n  - tool: t\n    args:\n      x: /([bad/' }])
  assert.equal(r6.stats().invalidRegex, 1)
  assert.equal(r6.stats().declared, 0)
})

/* ══════════════ 5. 使用统计与淘汰评分 ══════════════ */
console.log('\n[5] 使用统计与淘汰评分')

ok('评分权重与 Accio 一致（0.4/0.4/0.2）', () => {
  assert.equal(EVICTION.W_USE, 0.4)
  assert.equal(EVICTION.W_RECENCY, 0.4)
  assert.equal(EVICTION.W_QUALITY, 0.2)
})
ok('从未使用 → 频次与新鲜度均为 0', () => {
  const r = computeSkillScore(null, 1)
  assert.equal(r.breakdown.useCount, 0)
  assert.equal(r.breakdown.recency, 0)
  assert.ok(Math.abs(r.score - 0.2) < 1e-9, `score=${r.score}`)
})
ok('高频 + 近期 + 满分文档 → 接近 1.0', () => {
  const now = Date.now()
  const r = computeSkillScore({ useCount: 50, lastUsedAt: now }, 1, now)
  assert.ok(r.score > 0.99, `score=${r.score}`)
})
ok('180 天前的使用 → 新鲜度衰减到 0', () => {
  const now = Date.now()
  const r = computeSkillScore({ useCount: 50, lastUsedAt: now - 181 * 86400000 }, 1, now)
  assert.equal(r.breakdown.recency, 0)
})

await okAsync('recordUse 持久化并累加', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsagent-stats-'))
  const p = path.join(dir, '.skill-stats.json')
  const s1 = createSkillStats(p)
  await s1.recordUse('skill-a')
  await s1.recordUse('skill-a')
  await s1.recordUse('skill-b')
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
  assert.equal(raw['skill-a'].useCount, 2, JSON.stringify(raw))
  assert.equal(raw['skill-b'].useCount, 1)
  // 新实例从盘上读回（验证持久化而非仅内存）
  const s2 = createSkillStats(p)
  const rd = await s2.readAll()
  assert.equal(rd['skill-a'].useCount, 2)
})

await okAsync('并发 recordUse 不丢计数（写串行化）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsagent-conc-'))
  const p = path.join(dir, '.skill-stats.json')
  const s = createSkillStats(p)
  await Promise.all(Array.from({ length: 20 }, () => s.recordUse('hot')))
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
  assert.equal(raw.hot.useCount, 20, `期望 20，实际 ${raw.hot.useCount}`)
})

await okAsync('统计文件损坏时不抛错', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsagent-bad-'))
  const p = path.join(dir, '.skill-stats.json')
  fs.writeFileSync(p, '{ this is not json', 'utf8')
  const s = createSkillStats(p)
  const r = await s.readAll()
  assert.deepEqual(r, {})
})

await okAsync('idleCandidates 只列曾经用过且长期空闲的', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsagent-idle-'))
  const p = path.join(dir, '.skill-stats.json')
  const old = Date.now() - 200 * 86400000
  fs.writeFileSync(p, JSON.stringify({
    stale: { useCount: 1, lastUsedAt: old },           // 用过 1 次 + 很久没动 → 候选
    never: { useCount: 0, lastUsedAt: 0 },             // 从未用过 → 不进候选（可能是新技能）
    active: { useCount: 30, lastUsedAt: Date.now() },  // 高频在用 → 不进候选
    recent: { useCount: 1, lastUsedAt: Date.now() },   // 刚用过 → 不进候选
  }), 'utf8')
  const s = createSkillStats(p)
  const cands = await s.idleCandidates(() => 1)
  const ids = cands.map(c => c.id)
  assert.deepEqual(ids, ['stale'], JSON.stringify(ids))
})

await okAsync('文档质量满分也不会让陈旧技能逃过候选（回归：阈值失效缺陷）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsagent-idle2-'))
  const p = path.join(dir, '.skill-stats.json')
  const old = Date.now() - 200 * 86400000
  fs.writeFileSync(p, JSON.stringify({ perfect: { useCount: 1, lastUsedAt: old } }), 'utf8')
  const s = createSkillStats(p)
  // 质量分为 1.0 时综合分 = 0.4*0.02 + 0.4*0 + 0.2*1 ≈ 0.208 > CANDIDATE_THRESHOLD(0.2)
  // 老实现用「综合分 < 阈值」判定会在这里漏掉该技能
  const cands = await s.idleCandidates(() => 1)
  assert.deepEqual(cands.map(c => c.id), ['perfect'], '高质量陈旧技能必须仍被列为候选')
})

/* ══════════════ 6. SKILL.patch.md 补丁层 ══════════════ */
console.log('\n[6] SKILL.patch.md 补丁层')

await okAsync('读取不存在的 patch → present:false（不抛错）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsagent-nopatch-'))
  const r = await readSkillPatch(dir)
  assert.equal(r.present, false)
})
await okAsync('读取存在的 patch', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsagent-patch-'))
  fs.writeFileSync(path.join(dir, PATCH_FILENAME), '本店铺详情接口必须走 tmall 域。', 'utf8')
  const r = await readSkillPatch(dir)
  assert.equal(r.present, true)
  assert.ok(r.content.includes('tmall'))
})
ok('mergePatch 追加在正文之后并带自引用防护', () => {
  const merged = mergePatch('# 主文档\n\n## 工作流\n1. x', { present: true, content: '修正内容' })
  assert.ok(merged.includes('#### SKILL.patch.md'), merged)
  assert.ok(merged.includes('修正内容'))
  assert.ok(merged.includes('无需再读取'), '应含自引用防护提示')
  // patch 必须在主文档之后（冲突时以 patch 为准）
  assert.ok(merged.indexOf('# 主文档') < merged.indexOf('修正内容'))
})
ok('无 patch 时 mergePatch 原样返回正文', () => {
  const body = '# 主文档\n内容'
  assert.equal(mergePatch(body, { present: false, content: '' }), body)
})
await okAsync('超长 patch 被截断并标注', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsagent-bigpatch-'))
  fs.writeFileSync(path.join(dir, PATCH_FILENAME), 'x'.repeat(20000), 'utf8')
  const r = await readSkillPatch(dir)
  assert.equal(r.truncated, true)
  assert.ok(r.content.includes('已截断'))
})

/* ══════════════ 汇总 ══════════════ */
console.log(`\n${'═'.repeat(56)}`)
console.log(`  通过 ${pass}　失败 ${fail}`)
console.log(`${'═'.repeat(56)}\n`)
process.exit(fail ? 1 : 0)
