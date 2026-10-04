/**
 * 回归测试：文本级校验（checkPageText）必须与模板级校验（validateTemplate）覆盖对齐。
 *
 * 背景（真实缺陷，2026-10-04 在 DSH 真实运行时发现）：
 *   `dsagent_wiki_write` 工具收的是 frontmatter **文本**，因此它走的是
 *   `checkPageText()`；而 `validateTemplate()` 作用于模板**对象**。
 *   首版 checkPageText 只做顶层字段/废弃字段/[src]/域块/title-H1 五项检查，
 *   **完全没有机密字段检查**，于是：
 *
 *     用 dsagent_wiki_template 生成模板 → 走 validateTemplate → 拦得住
 *     直接手写 frontmatterYaml 传进 write → 走 checkPageText → **拦不住**
 *
 *   实测结果：`披露等级: 可对外` 的页面里成功写入了机密字段 `价格底线: 0.55元/只`。
 *
 * 教训：**测了 A 却上了 B** —— 参数形状不同导致两条校验路径分叉。
 * 本文件因此对「同一份违规内容」同时跑两条路径，要求它们给出一致的结论。
 */
import assert from 'node:assert'
import {
  checkPageText, validateTemplate, buildTemplate, renderPage, parseFieldPaths,
} from '../lib/services/wiki-frontmatter.js'

let pass = 0, fail = 0
const ok = (n, c, extra) => {
  if (c) { console.log(`  ✓ ${n}`); pass++ }
  else { console.log(`  ✗ ${n}${extra ? `\n      ${extra}` : ''}`); fail++ }
}

const errs = (issues) => issues.filter(i => i.severity === 'error')
const codes = (issues) => issues.map(i => i.code)

/* ══════════ 1. 本次缺陷的直接回归：机密字段写入「可对外」页 ══════════ */
console.log('\n[1] 机密字段泄漏回归（本次发现的真实缺陷）')

/** 构造一份「可对外」但含机密字段的页面文本 */
function leakyPage() {
  return {
    frontmatterYaml: [
      'type: 实体',
      'title: 泄密测试页',
      'description: 验证机密字段是否会被拦下',
      'resource: raw/test.md',
      'tags: [测试]',
      'timestamp: 2026-10-04:10:30:00',
      '所属领域: 商品',
      '披露等级: 可对外',
      '置信度说明: 测试用',
      '实体识别字段:',
      '  商品编号: T-001',
      '  商品名称: 测试品',
      '领域字段集:',
      '  价格策略:',
      '    价格底线: 0.55元/只',
    ].join('\n'),
    body: '# 泄密测试页\n\n正文。',
  }
}

{
  const { frontmatterYaml, body } = leakyPage()
  const text = `---\n${frontmatterYaml}\n---\n\n${body}\n`
  const issues = checkPageText(text)
  ok('★ 文本路径拦下机密字段（这正是修复前漏掉的）',
    codes(issues).includes('classified_in_public_page'),
    `实际 codes = ${codes(issues).join(',')}`)
}

{
  // 同一份内容走模板路径 —— 两条路径必须一致
  const t = buildTemplate('商品', '实体')
  t.top.title = '泄密测试页'
  t.top.description = '验证机密字段是否会被拦下'
  t.top.resource = 'raw/test.md'
  t.top.tags = ['测试']
  t.top.timestamp = '2026-10-04:10:30:00'
  t.top.披露等级 = '可对外'
  t.top.置信度说明 = '测试用'
  t.identity.商品编号 = 'T-001'
  t.identity.商品名称 = '测试品'
  t.groups['价格策略'].价格底线 = '0.55元/只'
  ok('★ 模板路径同样拦下（两路径一致）',
    codes(validateTemplate(t)).includes('classified_in_public_page'))
}

ok('机密字段页面被 renderPage 拒绝产出', (() => {
  const { frontmatterYaml } = leakyPage()
  // renderPage 走模板对象；这里验证文本路径的调用方（write 工具）会因 issues 拒绝写入
  const text = `---\n${frontmatterYaml}\n---\n\n# 泄密测试页\n`
  return errs(checkPageText(text)).length > 0
})())

ok('「仅内部」页允许出现机密字段（不误伤）', (() => {
  const { frontmatterYaml } = leakyPage()
  const fm = frontmatterYaml.replace('披露等级: 可对外', '披露等级: 仅内部')
  const issues = checkPageText(`---\n${fm}\n---\n\n# 泄密测试页\n`)
  return !codes(issues).includes('classified_in_public_page')
})())

ok('机密字段留空（null）不报错', (() => {
  const { frontmatterYaml } = leakyPage()
  const fm = frontmatterYaml.replace('    价格底线: 0.55元/只', '    价格底线: null')
  const issues = checkPageText(`---\n${fm}\n---\n\n# 泄密测试页\n`)
  return !codes(issues).includes('classified_in_public_page')
})())

/* ══════════ 2. 其余对齐项：文本路径原先缺失的检查 ══════════ */
console.log('\n[2] 文本路径补全的其余检查（原先缺失）')

const base = (over = {}) => {
  const fm = [
    'type: 实体',
    'title: 测试页',
    'description: 测试描述',
    'resource: raw/test.md',
    'tags: [测试]',
    'timestamp: 2026-10-04:10:30:00',
    '所属领域: 商品',
    '披露等级: 仅内部',
    '置信度说明: 测试用',
    '实体识别字段:',
    '  商品编号: T-001',
    '  商品名称: 测试品',
    '领域字段集:',
    '  商品基础判断:',
    '    目标买家: 批发商',
  ]
  for (const [k, v] of Object.entries(over)) {
    fm.push(`${k}: ${v}`)
  }
  return `---\n${fm.join('\n')}\n---\n\n# 测试页\n`
}

ok('自创字段名被拦下（模型漂移最高频形态）', (() => {
  const t = base().replace('  商品编号: T-001', '  商品SKU编号: T-001')
  return codes(checkPageText(t)).includes('unknown_field')
})())

ok('自创分组名被拦下', (() => {
  const t = base().replace('  商品基础判断:', '  我自己编的分组:')
  return codes(checkPageText(t)).includes('unknown_group')
})())

ok('单一形态域带实体子类型被拦下', (() => {
  return codes(checkPageText(base({ 实体子类型: '成品' }))).includes('subtype_not_allowed')
})())

ok('多形态域缺实体子类型被拦下', (() => {
  const fm = [
    'type: 实体', 'title: 测试页', 'description: 测试描述', 'resource: raw/test.md',
    'tags: [测试]', 'timestamp: 2026-10-04:10:30:00', '所属领域: 经营',
    '披露等级: 仅内部', '置信度说明: 测试用',
    '实体识别字段:', '  经营事项编号: OPS-1',
  ].join('\n')
  return codes(checkPageText(`---\n${fm}\n---\n\n# 测试页\n`)).includes('missing_subtype')
})())

ok('多形态域子类型非法取值被拦下', (() => {
  // ★ 必须用**多形态域**（经营）测枚举；用商品域只会命中 subtype_not_allowed，
  //   根本到不了枚举校验那一条（测试夹具踩过的坑）。
  const fm = [
    'type: 实体', 'title: 测试页', 'description: 测试描述', 'resource: raw/test.md',
    'tags: [测试]', 'timestamp: 2026-10-04:10:30:00', '所属领域: 经营',
    '实体子类型: 瞎写的类型',
    '披露等级: 仅内部', '置信度说明: 测试用',
    '实体识别字段:', '  经营事项编号: OPS-1',
  ].join('\n')
  const cs = codes(checkPageText(`---\n${fm}\n---\n\n# 测试页\n`))
  return cs.includes('invalid_subtype') && !cs.includes('subtype_not_allowed')
})())

ok('未知领域被拦下', (() => {
  const t = base().replace('所属领域: 商品', '所属领域: 不存在的域')
  return codes(checkPageText(t)).includes('unknown_domain')
})())

ok('建页锚点为空被拦下（Accio：放弃建页而非编造）', (() => {
  const t = base().replace('  商品编号: T-001', '  商品编号: null')
  return codes(checkPageText(t)).includes('missing_anchor')
})())

console.log('\n[2b] 接待域两条 L1 硬规则（文本路径）')

const receptionPage = (intent, code, status, confidence) => {
  const fm = [
    'type: 实体', 'title: 价格异议应对', 'description: 测试描绘',
    'resource: raw/test.md', 'tags: [测试]', 'timestamp: 2026-10-04:10:30:00',
    '所属领域: 接待', '实体子类型: 策略',
    '披露等级: 仅内部',
    `置信度说明: ${confidence}`,
    '实体识别字段:', '  接待编号: R-1',
    '领域字段集:', '  策略定义:', `    策略状态: ${status}`,
    '意图字段集:', `  接待意图: ${intent}`, `  接待意图码: ${code}`,
  ].join('\n')
  return `---\n${fm}\n---\n\n# 价格异议应对\n`
}

ok('接待意图不在受控 8 值内被拦下', (() => {
  return codes(checkPageText(receptionPage('第九个意图', 'x', '候选', '证据充分'))).includes('invalid_reception_intent')
})())
ok('接待意图缺失被拦下', (() => {
  const t = receptionPage('', '', '候选', '证据充分')
  return codes(checkPageText(t)).includes('missing_reception_intent')
})())
ok('意图码与意图不匹配被拦下', (() => {
  return codes(checkPageText(receptionPage('价格异议', 'wrong', '候选', '证据充分'))).includes('intent_code_mismatch')
})())
ok('意图码正确时通过该检查', (() => {
  return !codes(checkPageText(receptionPage('价格异议', 'price_objection', '候选', '证据充分'))).includes('intent_code_mismatch')
})())
ok('证据不足却标「启用」被拦下', (() => {
  return codes(checkPageText(receptionPage('价格异议', 'price_objection', '启用', '证据不足，仅 2 条对话'))).includes('weak_strategy_marked_enabled')
})())
ok('证据充分标「启用」不误伤', (() => {
  return !codes(checkPageText(receptionPage('价格异议', 'price_objection', '启用', '多轮对话验证充分'))).includes('weak_strategy_marked_enabled')
})())

/* ══════════ 3. 两条路径一致性（防再次分叉） ══════════ */
console.log('\n[3] 两条校验路径一致性（防止再次分叉）')

ok('正常页面在两路径都不报 error', (() => {
  const textPage = base()
  const t = buildTemplate('商品', '实体')
  t.top.title = '测试页'
  t.top.description = '测试描述'
  t.top.resource = 'raw/test.md'
  t.top.tags = ['测试']
  t.top.timestamp = '2026-10-04:10:30:00'
  t.top.披露等级 = '仅内部'
  t.top.置信度说明 = '测试用'
  t.identity.商品编号 = 'T-001'
  t.identity.商品名称 = '测试品'
  t.groups['商品基础判断'].目标买家 = '批发商'
  return errs(checkPageText(textPage)).length === 0 && errs(validateTemplate(t)).length === 0
})())

ok('模板生成 → render → 文本校验，闭环通过', (() => {
  const t = buildTemplate('商品', '实体')
  t.top.title = '闭环测试页'
  t.top.description = '测试描述'
  t.top.resource = 'raw/test.md'
  t.top.tags = ['测试']
  t.top.timestamp = '2026-10-04:10:30:00'
  t.top.披露等级 = '仅内部'
  t.top.置信度说明 = '测试用'
  t.identity.商品编号 = 'T-001'
  t.identity.商品名称 = '测试品'
  const r = renderPage(t, '# 闭环测试页\n\n正文。')
  if (!r.ok) return false
  return errs(checkPageText(r.content)).length === 0
})())

/* ══════════ 4. parseFieldPaths 单测 ══════════ */
console.log('\n[4] parseFieldPaths（文本 → 字段路径）')
ok('解析顶层标量', parseFieldPaths('披露等级: 可对外').get('披露等级') === '可对外')
ok('解析两层映射', (() => {
  const p = parseFieldPaths(['领域字段集:', '  价格策略:', '    价格底线: 0.55'].join('\n'))
  return p.get('领域字段集/价格策略/价格底线') === '0.55'
})())
ok('空值映射压栈、不产生叶子', (() => {
  const p = parseFieldPaths('领域字段集:\n  价格策略:')
  return ![...p.keys()].some(k => k.endsWith('价格策略'))
})())
ok('引号被剥离', parseFieldPaths('title: "带引号"').get('title') === '带引号')
ok('注释行被忽略', (() => {
  const p = parseFieldPaths('# 注释\n披露等级: 仅内部')
  return p.size === 1
})())

console.log(`\n${'═'.repeat(56)}`)
console.log(`  通过 ${pass}　失败 ${fail}`)
console.log(`${'═'.repeat(56)}\n`)
process.exit(fail ? 1 : 0)
