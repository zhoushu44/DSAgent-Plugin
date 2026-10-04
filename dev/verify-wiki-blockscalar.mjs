/**
 * 回归测试：wiki 索引必须正确解析 YAML 块标量。
 *
 * 背景（真实缺陷，2026-10-04 在真实 wiki 数据上发现）：
 *   `wiki-store.ts` 的 `pick()` 自己写了一个「只读同一行」的 frontmatter 取值函数，
 *   注释还声称「与 skill-quality 同一套口径」，但实际并不一致。
 *
 *   于是遇到 YAML 块标量时读出的是标记符号本身：
 *
 *     description: >-          ← 折叠块标量
 *       第一行
 *       第二行
 *
 *   `pick(fm, 'description')` 返回字符串 ">-"，
 *   并被当作描述渲染进 INDEX.md —— 表现为索引每条都显示「— >-」。
 *
 * ★ 这是本项目第三次出现同一类错误（前两次：机密字段校验两路径分叉、
 *   坑位记录策略两路径分叉）：
 *   **同一个概念在两处实现，只有一处是对的。**
 *   因此本套件除了验证修复，还断言「wiki-store 复用了统一实现」。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert'
import { createWikiStore } from '../lib/services/wiki-store.js'
import { readFrontmatterField } from '../lib/services/skill-quality.js'

let pass = 0, fail = 0
const ok = (n, c, extra) => {
  if (c) { console.log(`  ✓ ${n}`); pass++ }
  else { console.log(`  ✗ ${n}${extra ? `\n      ${extra}` : ''}`); fail++ }
}
async function okA(n, fn) {
  try { await fn(); console.log(`  ✓ ${n}`); pass++ }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++ }
}

/* ══════════ 1. 统一实现：readFrontmatterField 处理块标量 ══════════ */
console.log('\n[1] 统一实现 readFrontmatterField 的块标量处理')

ok('折叠块 >- 取值正确（不返回 ">-"）', (() => {
  const fm = ['description: >-', '  第一行', '  第二行'].join('\n')
  const v = readFrontmatterField(fm, 'description')
  return v === '第一行 第二行'
})())

ok('块标量 | 取值正确', (() => {
  const fm = ['description: |', '  第一行', '  第二行'].join('\n')
  return readFrontmatterField(fm, 'description') === '第一行 第二行'
})())

ok('带缩进修饰符的块标量（>- / |+ / |-）', (() => {
  for (const marker of ['>-', '|+', '|-', '>', '|']) {
    const v = readFrontmatterField(`description: ${marker}\n  内容`, 'description')
    assert.equal(v, '内容', `marker=${marker} 得到 ${JSON.stringify(v)}`)
  }
  return true
})())

ok('块标量在下一个顶层键处正确结束（不多吃）', (() => {
  const fm = ['description: >-', '  描述内容', 'title: 标题'].join('\n')
  const v = readFrontmatterField(fm, 'description')
  return v === '描述内容' && readFrontmatterField(fm, 'title') === '标题'
})())

ok('普通单行标量照常工作', (() => {
  return readFrontmatterField('title: 普通标题', 'title') === '普通标题'
})())

/* ══════════ 2. 端到端：真实页面 → 索引描述 ══════════ */
console.log('\n[2] 端到端：写含块标量的页面，索引描述必须正确')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-block-'))
const ws = createWikiStore(tmp)

/** 构造一个 description 用折叠块标量的概念页（正是真实数据里的写法） */
const conceptPage = `---
type: 概念
title: 选品方法论
description: >-
  选品是把"市场有需求 + 竞争可进入 + 经济上成立 + 能落地执行"四件事同时验证，
  产出可排序、可审计、可追溯的候选产品清单的过程。本页是选品这件事的口径唯一出处。
resource: skills/demand-niche-analysis/SKILL.patch.md
tags: [选品, 需求裂变]
timestamp: "2026-10-05"
所属领域: 概念
实体子类型: 方法论
披露等级: 仅内部
置信度说明: 方法论级概念，置信度 High
实体识别字段:
  概念编号: CONCEPT-SELECTION-001
  概念名称: 选品方法论
领域字段集:
  口径与算法:
    定义: 选品是在证据约束下缩小不确定性的决策过程
    计算方式: 不适用（非指标）
    统计范围: 不适用
意图字段集:
  概念查询意图: 问选品怎么做
---

# 选品方法论

正文内容。
`

await okA('页面写入成功', async () => {
  await ws.init()
  const r = await ws.savePage({ domain: '概念', kind: '概念', title: '选品方法论', content: conceptPage })
  assert.ok(r.ok, r.error)
})

await okA('★ 索引描述不是 ">-"（本次缺陷的直接回归）', async () => {
  const entries = await ws.listEntries()
  const e = entries.find(x => x.title === '选品方法论')
  assert.ok(e, '应能列出该页面')
  assert.notEqual(e.description, '>-', `描述仍是块标量标记：${JSON.stringify(e.description)}`)
  assert.ok(e.description.includes('选品'), `描述内容不对：${JSON.stringify(e.description)}`)
})

await okA('★ INDEX.md 里不出现裸 "— >-"', async () => {
  const idx = await ws.buildIndex()
  const text = fs.readFileSync(idx.path, 'utf8')
  assert.ok(!/—\s*>-\s*$/m.test(text), 'INDEX.md 仍出现 >- 标记')
  assert.ok(text.includes('选品'), 'INDEX.md 应含描述正文')
})

await okA('其他字段也正确（timestamp / 披露等级）', async () => {
  const entries = await ws.listEntries()
  const e = entries.find(x => x.title === '选品方法论')
  assert.equal(e.disclosure, '仅内部')
  assert.equal(e.timestamp, '2026-10-05')
})

/* ══════════ 3. 混合场景：块标量与单行标量同页并存 ══════════ */
console.log('\n[3] 混合场景')

await okA('同页既有块标量又有单行标量，互不干扰', async () => {
  const page = `---
type: 概念
title: 混合测试
description: >-
  折叠块描述第一段，
  折叠块描述第二段。
resource: raw/混合测试.md
tags: [测试, 混合]
timestamp: 2026-10-05
披露等级: 可对外
置信度说明: 单行值不受影响
所属领域: 概念
实体子类型: 术语
实体识别字段:
  概念编号: C-002
  概念名称: 混合测试
领域字段集:
  口径与算法:
    定义: 测试
    计算方式: 不适用
    统计范围: 不适用
---

# 混合测试

正文。
`
  const r = await ws.savePage({ domain: '概念', kind: '概念', title: '混合测试', content: page })
  assert.ok(r.ok, r.error)
  const entries = await ws.listEntries()
  const e = entries.find(x => x.title === '混合测试')
  assert.ok(e.description.includes('折叠块描述第一段'), `description=${JSON.stringify(e.description)}`)
  assert.equal(e.timestamp, '2026-10-05')
  assert.equal(e.disclosure, '可对外')
})

/* ══════════ 4. 防止再次分叉：断言复用统一实现 ══════════ */
console.log('\n[4] 防止再次分叉（结构断言）')

ok('wiki-store 不再自行实现 frontmatter 取值（复用统一实现）', (() => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/services/wiki-store.ts'), 'utf8')
  // 必须 import 统一实现
  const importsUnified = /import\s*\{[^}]*readFrontmatterField[^}]*\}\s*from\s*'\.\/skill-quality\.js'/.test(src)
  // 不得再出现「自己 match 单行 frontmatter」的旧实现特征
  const hasOwnRegex = /new RegExp\(`\^\[ \\t\]\*\$\{key\}/.test(src)
  return importsUnified && !hasOwnRegex
})())

console.log(`\n${'═'.repeat(56)}`)
console.log(`  通过 ${pass}　失败 ${fail}`)
console.log(`${'═'.repeat(56)}\n`)
process.exit(fail ? 1 : 0)
