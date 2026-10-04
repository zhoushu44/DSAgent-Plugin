/**
 * 端到端验证八域知识 Wiki 层（P4）。
 *
 * 重点验证 Accio 的硬约束是否真的生效：
 *   - 锁定模板生成的 key 与 Schema 完全一致
 *   - 自创字段 / 错误枚举 / 单一形态域带子类型 都被拦下
 *   - 机密字段不得进入「可对外」页面
 *   - 接待域受控词表与「证据不足不得标启用」两条 L1 硬规则
 *   - render 递归删空值（缺席 ≠ 空值）
 *   - 越界路径写入被拒
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert'
import { DOMAIN_NAMES, getDomain, isSingleFormDomain, RECEPTION_INTENTS, domainRoutingTable, describeDomain, filterByDisclosure } from '../lib/services/wiki-schema.js'
import { buildTemplate, templateToYaml, templateGuide, renderPage, validateTemplate, checkPageText, TOP_ORDER } from '../lib/services/wiki-frontmatter.js'
import { createWikiStore, sanitizeFilename } from '../lib/services/wiki-store.js'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { console.log(`  ✓ ${n}`); pass++ } else { console.log(`  ✗ ${n}`); fail++ } }
async function okA(n, fn) {
  try { await fn(); console.log(`  ✓ ${n}`); pass++ }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++ }
}

/* ══════════════ 1. 八域 Schema ══════════════ */
console.log('\n[1] 八域 Schema')
ok('八个域齐全', DOMAIN_NAMES.length === 8, DOMAIN_NAMES.join('/'))
ok('域名为 Accio 原文', ['商品','店铺','客户','经营','平台','资产','接待','概念'].every(d => DOMAIN_NAMES.includes(d)))
ok('单一形态域 = 商品/店铺/客户', ['商品','店铺','客户'].every(d => isSingleFormDomain(d)))
ok('多形态域 = 经营/平台/资产/接待/概念', ['经营','平台','资产','接待','概念'].every(d => !isSingleFormDomain(d)))
ok('接待意图封闭 8 键', RECEPTION_INTENTS.length === 8)
ok('概念域含「定义/计算方式/统计范围」三个必抓', ['定义','计算方式','统计范围'].every(n => getDomain('概念').groups.some(g => g.fields.some(f => f.name === n && f.duty === 'must-grab'))))
ok('商品域「价格底线」标为机密', getDomain('商品').groups.flatMap(g => g.fields).find(f => f.name === '价格底线')?.disclosure === '机密')
ok('路由表含全部八域', DOMAIN_NAMES.every(d => domainRoutingTable().includes(d)))
ok('describeDomain 输出必抓标记', describeDomain('商品').includes('〖必抓〗'))
ok('未知域返回提示而非崩溃', describeDomain('不存在的域').includes('未知领域'))

/* ══════════════ 2. 锁定模板 ══════════════ */
console.log('\n[2] 锁定模板生成')
const tpl = buildTemplate('商品', '实体')
ok('顶层含全部 10 项', TOP_ORDER.every(k => k in tpl.top))
ok('单一形态域不含实体子类型', !tpl.subtype && tpl.top.实体子类型 === null)
ok('识别字段来自商品域', Object.keys(tpl.identity).includes('商品编号'))
ok('分组来自商品域', Object.keys(tpl.groups).includes('商品基础判断'))
ok('值一律为 null（待模型填）', Object.values(tpl.identity).every(v => v === null))

ok('单一形态域传 subtype 会报错（Accio 验收项 3）', (() => {
  try { buildTemplate('商品', '实体', '成品'); return false } catch { return true }
})())
ok('多形态域不传 subtype 会报错', (() => {
  try { buildTemplate('经营', '实体'); return false } catch { return true }
})())
ok('多形态域传非法 subtype 会报错', (() => {
  try { buildTemplate('经营', '实体', '瞎写的类型'); return false } catch { return true }
})())
ok('多形态域传合法 subtype 成功', buildTemplate('经营', '实体', '复盘').subtype === '复盘')
ok('概念页按概念域字段（无论哪个域）', Object.keys(buildTemplate('商品', '概念').identity).includes('概念编号'))
ok('YAML 模板含全部 key', templateToYaml(tpl).includes('商品编号') && templateToYaml(tpl).includes('实体识别字段'))
ok('填值指引含必填说明', templateGuide(tpl).includes('只替换'))

/* ══════════════ 3. 校验器拦住模型漂移（核心价值） ══════════════ */
console.log('\n[3] 校验器拦住模型漂移')

function filledGood() {
  const t = buildTemplate('商品', '实体')
  t.top.title = '304不锈钢六角螺栓'
  t.top.description = '自产304不锈钢六角螺栓，规格M6-M24，面向批量紧固件采购客户'
  t.top.resource = ['raw/cloud/紧固件产品目录-6832142.md']
  t.top.tags = ['不锈钢螺栓', '紧固件', '六角螺栓']
  t.top.timestamp = '2026-08-28:21:52:38'
  t.top.披露等级 = '仅内部'
  t.top.置信度说明 = '商品目录与订单记录交叉验证，数据可信'
  t.identity.商品编号 = 'SKU-001'
  t.identity.商品名称 = '304不锈钢六角螺栓'
  t.groups['商品基础判断'].目标买家 = '批量紧固件采购的五金贸易商'
  t.groups['商品基础判断'].商品生命阶段 = '成熟'
  t.groups['商品基础判断'].主推状态 = '常规'
  t.groups['价格策略'].价格底线 = '0.55元/只'
  t.groups['卖点与披露'].公开卖点 = '自有产线、材质可追溯'
  t.groups['卖点与披露'].披露红线 = '不得对外透露成本与最低可成交价'
  return t
}

ok('完整填充通过校验', validateTemplate(filledGood()).filter(i => i.severity === 'error').length === 0)
ok('缺 title 被拦下', validateTemplate({ ...filledGood(), top: { ...filledGood().top, title: null } }).some(i => i.code === 'missing_top_field'))
ok('缺建页锚点被拦下（Accio：放弃建页而非编造）', (() => {
  const t = filledGood(); t.identity.商品编号 = null
  return validateTemplate(t).some(i => i.code === 'missing_anchor')
})())
ok('自创字段名被拦下（核心：模型漂移的主要形态）', (() => {
  const t = filledGood(); t.identity['商品SKU编号'] = 'x'
  return validateTemplate(t).some(i => i.code === 'unknown_field')
})())
ok('自创分组名被拦下', (() => {
  const t = filledGood(); t.groups['我自己加的分组'] = { 随便: 'x' }
  return validateTemplate(t).some(i => i.code === 'unknown_group')
})())
ok('单一形态域出现实体子类型被拦下', (() => {
  const t = filledGood(); t.top.实体子类型 = '成品'
  return validateTemplate(t).some(i => i.code === 'subtype_not_allowed')
})())
ok('多形态域子类型非法取值被拦下', (() => {
  const t = buildTemplate('经营', '实体', '复盘')
  t.top.实体子类型 = '我编的类型'
  return validateTemplate(t).some(i => i.code === 'invalid_subtype')
})())
ok('机密字段进入「可对外」页面被拦下', (() => {
  const t = filledGood(); t.top.披露等级 = '可对外'
  return validateTemplate(t).some(i => i.code === 'classified_in_public_page')
})())

console.log('\n[3b] 接待域两条 L1 硬规则')
ok('接待意图缺失被拦下', (() => {
  const t = buildTemplate('接待', '实体', '策略')
  return validateTemplate(t).some(i => i.code === 'missing_reception_intent')
})())
ok('接待意图不在受控词表被拦下', (() => {
  const t = buildTemplate('接待', '实体', '策略')
  t.intent.接待意图 = '第九个意图'
  return validateTemplate(t).some(i => i.code === 'invalid_reception_intent')
})())
ok('意图码与意图不匹配被拦下', (() => {
  const t = buildTemplate('接待', '实体', '策略')
  t.intent.接待意图 = '价格异议'
  t.intent.接待意图码 = 'wrong_code'
  return validateTemplate(t).some(i => i.code === 'intent_code_mismatch')
})())
ok('意图码正确时通过该检查', (() => {
  const t = buildTemplate('接待', '实体', '策略')
  t.intent.接待意图 = '价格异议'
  t.intent.接待意图码 = 'price_objection'
  return !validateTemplate(t).some(i => i.code === 'intent_code_mismatch')
})())
ok('证据不足却标「启用」被拦下（接待域 L1 硬规则）', (() => {
  const t = filledGood() // 借用其顶层
  const rt = buildTemplate('接待', '实体', '策略')
  rt.top.title = 'x'; rt.top.description = 'd'; rt.top.resource = 'raw/a.md'
  rt.top.tags = ['a']; rt.top.timestamp = '2026-01-01:00:00:00'
  rt.top.披露等级 = '仅内部'
  rt.top.置信度说明 = '证据不足，仅 2 条对话支撑'
  rt.groups['策略定义'].策略状态 = '启用'
  rt.intent.接待意图 = '价格异议'
  rt.intent.接待意图码 = 'price_objection'
  return validateTemplate(rt).some(i => i.code === 'weak_strategy_marked_enabled')
})())

/* ══════════════ 4. render 递归删空值 ══════════════ */
console.log('\n[4] render 递归删空值（缺席 ≠ 空值）')
const rendered = renderPage(filledGood(), '# 304不锈钢六角螺栓\n\n正文内容。')
ok('render 成功', rendered.ok)
ok('已填值出现', rendered.content.includes('商品编号: SKU-001'))
ok('未填字段整行省略（不留 null）', !rendered.content.includes('null'))
ok('未填字段名不出现', !rendered.content.includes('关联平台货品编号'))
ok('空分组整组省略', !rendered.content.includes('竞争与对标'))
ok('正文已拼接', rendered.content.includes('# 304不锈钢六角螺栓'))
ok('frontmatter 以 --- 包裹', rendered.content.startsWith('---\n'))
ok('校验失败时 render 拒绝产出', !renderPage({ ...filledGood(), top: { ...filledGood().top, title: null } }, 'x').ok)
ok('特殊字符值被自动加引号（Accio 点名的 YAML 陷阱）', (() => {
  const t = filledGood()
  t.top.tags = ['[方括号开头]']
  const r = renderPage(t, '# x')
  return r.ok && r.content.includes('"[方括号开头]"')
})())

/* ══════════════ 5. checkPageText 拦手写页面 ══════════════ */
console.log('\n[5] checkPageText 拦手写页面')
ok('缺 frontmatter 报错', checkPageText('# 没有头').some(i => i.code === 'missing_frontmatter'))
ok('废弃字段被点名（Accio 验收项 4）', checkPageText('---\ntype: 实体\n页面编号: 1\n---\n# x').some(i => i.code === 'deprecated_field'))
ok('frontmatter 内 [src] 被拦下', checkPageText('---\ntype: 实体\nx: [src: a.md#L1]\n---\n# x').some(i => i.code === 'src_in_frontmatter'))
ok('缺域字段块（空壳页）被拦下', (() => {
  const fm = ['type: 实体','title: x','description: d','resource: raw/a.md','tags: [a]','timestamp: 2026-01-01:00:00:00','所属领域: 商品','披露等级: 仅内部','置信度说明: ok'].join('\n')
  return checkPageText(`---\n${fm}\n---\n\n# x`).some(i => i.code === 'no_domain_blocks')
})())
ok('title 与 H1 不一致被拦下', (() => {
  const fm = ['type: 实体','title: 标题A','description: d','resource: raw/a.md','tags: [a]','timestamp: 2026-01-01:00:00:00','所属领域: 商品','披露等级: 仅内部','置信度说明: ok','实体识别字段:','  商品编号: 1'].join('\n')
  return checkPageText(`---\n${fm}\n---\n\n# 标题B`).some(i => i.code === 'title_h1_mismatch')
})())
ok('规范页面通过', (() => {
  const fm = ['type: 实体','title: 标题A','description: d','resource: raw/a.md','tags: [a]','timestamp: 2026-01-01:00:00:00','所属领域: 商品','披露等级: 仅内部','置信度说明: ok','实体识别字段:','  商品编号: 1','领域字段集:','  商品基础判断:','    目标买家: 批发'].join('\n')
  return checkPageText(`---\n${fm}\n---\n\n# 标题A`).every(i => i.severity !== 'error')
})())

/* ══════════════ 6. 披露过滤 ══════════════ */
console.log('\n[6] 披露等级过滤')
const pub = filterByDisclosure(getDomain('商品'), '可对外')
ok('可对外过滤掉机密字段', pub.dropped.some(f => f.name === '价格底线'))
ok('可对外过滤掉「仅内部」字段', pub.dropped.some(f => f.name === '品质判断'))
ok('可对外保留公开字段', pub.kept.some(f => f.name === '公开卖点'))
const internal = filterByDisclosure(getDomain('商品'), '仅内部')
ok('仅内部保留「仅内部」字段', internal.kept.some(f => f.name === '品质判断'))
ok('仅内部仍过滤机密字段', internal.dropped.some(f => f.name === '价格底线'))

/* ══════════════ 7. 文件名清洗 ══════════════ */
console.log('\n[7] 文件名清洗（含路径分隔符的标题）')
ok('斜杠被替换（否则会意外建子目录）', sanitizeFilename('服装/男装/T恤') === '服装_男装_T恤', sanitizeFilename('服装/男装/T恤'))
ok('Windows 保留字符被替换', !/[\\/:*?"<>|]/.test(sanitizeFilename('a:b*c?d"e<f>g|h')))
ok('结尾点与空格被去掉（Windows 非法）', sanitizeFilename('标题... ') === '标题')
ok('超长标题被截断到 100', sanitizeFilename('x'.repeat(300)).length === 100)
ok('空标题返回空串', sanitizeFilename('   ') === '')

/* ══════════════ 8. 存储层 ══════════════ */
console.log('\n[8] 存储层（真实落盘）')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsagent-wiki-'))
const ws = createWikiStore(tmp)

await okA('init 创建八域目录骨架', async () => {
  await ws.init()
  for (const d of DOMAIN_NAMES) {
    assert.ok(fs.existsSync(path.join(tmp, d, 'entities')), `${d}/entities 缺失`)
    assert.ok(fs.existsSync(path.join(tmp, d, 'concepts')), `${d}/concepts 缺失`)
  }
  assert.ok(fs.existsSync(path.join(tmp, 'PRINCIPLES.md')))
  assert.ok(fs.existsSync(path.join(tmp, 'log.md')))
})

await okA('写入规范页面', async () => {
  const r = renderPage(filledGood(), '# 304不锈钢六角螺栓\n\n正文。')
  const res = await ws.savePage({ domain: '商品', kind: '实体', title: '304不锈钢六角螺栓', content: r.content })
  assert.ok(res.ok, res.error)
  assert.ok(fs.existsSync(path.join(tmp, res.path)), '文件应存在')
})

await okA('校验不过的页面被拒绝写入', async () => {
  const bad = '---\ntype: 实体\n---\n\n# x'
  const res = await ws.savePage({ domain: '商品', kind: '实体', title: '坏页面', content: bad })
  assert.equal(res.ok, false)
  assert.ok(!fs.existsSync(path.join(tmp, '商品', 'entities', '坏页面.md')))
})

await okA('越界路径被拒绝', async () => {
  const res = await ws.readPage('../../../etc/passwd')
  assert.equal(res.ok, false)
})

await okA('listEntries 读出页面元信息', async () => {
  const entries = await ws.listEntries()
  const e = entries.find(x => x.title === '304不锈钢六角螺栓')
  assert.ok(e, JSON.stringify(entries))
  assert.equal(e.domain, '商品')
  assert.equal(e.kind, '实体')
  assert.equal(e.disclosure, '仅内部')
})

await okA('stats 统计正确', async () => {
  const st = await ws.stats()
  assert.equal(st.total, 1)
  assert.equal(st.entities, 1)
  assert.equal(st.concepts, 0)
  assert.equal(st.byDomain['商品'], 1)
})

await okA('buildIndex 生成的链接可达（Accio 验收项 1）', async () => {
  const idx = await ws.buildIndex()
  const text = fs.readFileSync(idx.path, 'utf8')
  assert.ok(text.includes('304不锈钢六角螺栓'))
  // 抽出 markdown 链接目标，逐个验证文件真实存在
  const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map(m => decodeURI(m[1]))
  for (const l of links) {
    assert.ok(fs.existsSync(path.join(tmp, l)), `索引链接不可达：${l}`)
  }
})

await okA('appendLog 只追加不覆盖', async () => {
  await ws.appendLog('第一条')
  await ws.appendLog('第二条')
  const text = fs.readFileSync(path.join(tmp, 'log.md'), 'utf8')
  assert.ok(text.includes('第一条') && text.includes('第二条'), '两条日志都应保留')
})

/* ══════════════ 汇总 ══════════════ */
console.log(`\n${'═'.repeat(56)}`)
console.log(`  通过 ${pass}　失败 ${fail}`)
console.log(`${'═'.repeat(56)}\n`)
process.exit(fail ? 1 : 0)
