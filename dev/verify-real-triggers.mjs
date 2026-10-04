import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert'
import { splitSkillMarkdown, parseToolTriggers } from '../lib/services/skill-quality.js'
import { createToolTriggerRegistry } from '../lib/services/tool-triggers.js'

const root = 'skills'
const targets = ['product-reviews', 'product-wdj']

console.log('=== 真实技能文件的 tool_triggers 解析 ===')
const sources = []
for (const d of fs.readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name)) {
  const p = path.join(root, d, 'SKILL.md')
  if (!fs.existsSync(p)) continue
  const raw = fs.readFileSync(p, 'utf8')
  const { frontmatter } = splitSkillMarkdown(raw)
  sources.push({ id: d, description: d, skillPath: path.resolve(p), frontmatter })
}

for (const id of targets) {
  const s = sources.find(x => x.id === id)
  const t = parseToolTriggers(s.frontmatter)
  console.log(`\n${id}: 解析出 ${t.length} 条规则`)
  for (const r of t) console.log(`   tool=${r.tool}  args=${JSON.stringify(r.args ?? {})}`)
  assert.ok(t.length >= 2, `${id} 应至少有 2 条规则`)
}

// 注意：skill id 取自 frontmatter name，而目录名可能不同；这里用目录名验证匹配行为
const reg = createToolTriggerRegistry()
reg.rebuild(sources)
console.log('\n=== 注册表统计 ===')
console.log(JSON.stringify(reg.stats(), null, 2))

console.log('\n=== 匹配行为验证（真实注册表） ===')
const cases = [
  ['dsagent_execute_skill', { id: 'product-reviews' }, '应命中 product-reviews 声明 + 内置风控'],
  ['dsagent_execute_skill', { id: 'product-wdj' }, '应命中 product-wdj 声明 + 内置风控'],
  ['dsagent_execute_skill', { id: 'a-stock-diagnosis' }, '应无命中（非淘宝系、无声明）'],
  ['dsagent_proxy', { url: 'https://rate.taobao.com/detailList.htm' }, '应命中 product-reviews 的代理兜底规则'],
  ['dsagent_proxy', { url: 'https://example.com/other' }, '应无命中'],
]
for (const [tool, args, expect] of cases) {
  const hits = reg.match(tool, args)
  console.log(`\n  ${tool}(${JSON.stringify(args)})`)
  console.log(`    期望：${expect}`)
  console.log(`    实际命中 ${hits.length} 条：${hits.map(h => h.skillId).join(', ') || '(无)'}`)
}

// 断言关键行为
const wdjHits = reg.match('dsagent_execute_skill', { id: 'product-wdj' })
assert.ok(wdjHits.some(h => h.skillId === 'product-wdj'), 'product-wdj 声明规则应命中')
assert.ok(wdjHits.some(h => h.skillId.startsWith('builtin:')), '内置风控规则应命中')

const proxyHits = reg.match('dsagent_proxy', { url: 'https://rate.taobao.com/x' })
assert.ok(proxyHits.some(h => h.skillId === 'product-reviews'), 'product-reviews 代理兜底规则应命中')

const noneHits = reg.match('dsagent_execute_skill', { id: 'a-stock-diagnosis' })
assert.equal(noneHits.length, 0, 'a-stock-diagnosis 不应命中任何规则')

console.log('\n=== 渲染给模型的提示 ===')
console.log(reg.formatHint(reg.match('dsagent_execute_skill', { id: 'product-wdj' }, 'demo-session')))

console.log('\n✅ 真实技能文件的 tool_triggers 全部验证通过')
