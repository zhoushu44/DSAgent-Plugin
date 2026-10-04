/**
 * host 半区集成验证：确认 apply() 真的注册了全部工具与系统提示词。
 *
 * 用一个最小 Context 桩（只实现 tools / systemPrompt / effect / http 等被用到的面），
 * 跑一遍 apply()，把注册的工具名与提示词文本收集出来核对。
 * 这样能在不启动 DSH 的前提下发现「工具漏注册」「提示词没注入」这类问题。
 */
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let pass = 0, fail = 0
const ok = (n, c, extra) => {
  if (c) { console.log(`  ✓ ${n}`); pass++ }
  else { console.log(`  ✗ ${n}${extra ? `\n      ${extra}` : ''}`); fail++ }
}

// 隔离：把工作区指到临时目录，避免污染仓库
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsagent-host-'))
process.env.DSAGENT_WORKSPACE = tmp

const registered = []
let promptText = ''
let httpHandler = null
const effects = []

const ctx = {
  tools: {
    define: (def) => { registered.push(def); return def },
    register: (def) => { registered.push(def); return () => {} },
  },
  systemPrompt: {
    section: (opts) => { promptText += (opts?.text ?? '') + '\n'; return () => {} },
  },
  effect: (fn, name) => {
    try { const r = fn(); effects.push({ name, dispose: typeof r === 'function' ? r : null }) }
    catch (e) { console.log(`      [effect ${name}] ${e.message}`) }
  },
  // host 半区通过 ctx.inject(['webServer'], cb) 动态等待 carrier service。
  // 测试桩直接同步回调一个假 webCtx，从而跑到 HTTP 路由注册那段代码。
  inject: (deps, cb) => {
    const webCtx = {
      effect: (fn) => { try { fn() } catch { /* 忽略 */ } },
      webServer: {
        register: (route) => { httpHandler = route; return () => {} },
      },
    }
    try { cb(webCtx) } catch { /* 路由注册失败不影响工具注册验证 */ }
  },
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  on: () => {},
  plugin: () => {},
}

console.log('\n[1] 加载 host 半区并执行 apply()')
const mod = await import('../lib/index.js')
ok('模块导出 apply', typeof mod.apply === 'function')
ok('模块导出 name = dsagent', mod.name === 'dsagent')
ok('模块导出 config', typeof mod.config === 'object')

try {
  mod.apply(ctx, {
    skillRoot: path.resolve('skills'),
    storePath: path.join(tmp, 'dsagent-accounts.json'),
    guideOnUnbound: true,
    wikiRoot: path.join(tmp, 'wiki'),
  })
  ok('apply() 不抛错', true)
} catch (e) {
  ok('apply() 不抛错', false, e.stack)
}

console.log('\n[2] 工具注册')
const names = registered.map(t => t.name).filter(Boolean)
console.log(`     共注册 ${names.length} 个工具`)

// 原有工具必须仍在（回归）
const ORIGINAL = [
  'dsagent_list_accounts', 'dsagent_check_account_health', 'dsagent_search_accounts',
  'dsagent_list_skills', 'dsagent_get_skill_detail', 'dsagent_execute_skill',
  'dsagent_generate_report', 'dsagent_list_platforms', 'dsagent_proxy',
  'dsagent_browser_login', 'dsagent_browser_close', 'dsagent_risk_verify',
  'dsagent_save_cookie', 'dsagent_chat_with_context',
  'dsagent_douyin_publish', 'dsagent_zhihu_publish', 'dsagent_xiaohongshu_publish',
  'dsagent_xianyu_publish', 'dsagent_taobao_publish', 'dsagent_pdd_publish',
  'dsagent_bilibili_download', 'dsagent_pdd_crawl', 'dsagent_xianyu_analytics',
]
const missingOriginal = ORIGINAL.filter(n => !names.includes(n))
ok('原有工具全部仍在（无回归）', missingOriginal.length === 0, `缺失：${missingOriginal.join(', ')}`)

// 新增知识库工具
const WIKI_TOOLS = [
  'dsagent_wiki_schema', 'dsagent_wiki_template', 'dsagent_wiki_write',
  'dsagent_wiki_search', 'dsagent_wiki_stats', 'dsagent_pitfalls',
]
const missingWiki = WIKI_TOOLS.filter(n => !names.includes(n))
ok('6 个知识库 / 坑位工具已注册', missingWiki.length === 0, `缺失：${missingWiki.join(', ')}`)

console.log('\n[3] 系统提示词')
ok('提示词非空', promptText.length > 1000, `实际 ${promptText.length} 字符`)
ok('提示词含技能调用方式', promptText.includes('技能调用方式'))
ok('提示词含错误处理表', promptText.includes('failureKind'))
ok('提示词仍含 need_account_choice 引导', promptText.includes('need_account_choice'))
ok('提示词仍含风控引导', promptText.includes('dsagent_risk_verify'))

console.log('\n[4] 工具参数定义健全性（DSH 校验器要求）')
// DSH 要求：可选参数必须整体省略 required 键，写 required:false 会导致插件加载失败（FIX-LOG #49）
let badOptional = []
for (const t of registered) {
  for (const [pname, pdef] of Object.entries(t.parameters ?? {})) {
    if (pdef && typeof pdef === 'object' && 'required' in pdef && pdef.required === false) {
      badOptional.push(`${t.name}.${pname}`)
    }
  }
}
ok('无 required:false 的可选参数（FIX-LOG #49 回归）', badOptional.length === 0, badOptional.join(', '))

console.log('\n[5] 各工具的 execute 可调用签名')
let noExec = registered.filter(t => typeof t.execute !== 'function').map(t => t.name)
ok('每个工具都有 execute 函数', noExec.length === 0, noExec.join(', '))

console.log('\n[6] 知识库工具实际可用（真实调用）')
async function callTool(name, args) {
  const t = registered.find(x => x.name === name)
  if (!t) throw new Error(`工具不存在：${name}`)
  return await t.execute(args ?? {}, { agent: { id: 'test-agent' } })
}

try {
  const r = await callTool('dsagent_wiki_schema', {})
  const text = typeof r === 'string' ? r : (r?.text ?? JSON.stringify(r))
  ok('wiki_schema 返回八域路由表', text.includes('商品') && text.includes('概念') && text.includes('接待'))
} catch (e) { ok('wiki_schema 可调用', false, e.message) }

try {
  const r = await callTool('dsagent_wiki_schema', { domain: '商品' })
  const text = typeof r === 'string' ? r : (r?.text ?? JSON.stringify(r))
  ok('wiki_schema(商品) 返回字段定义', text.includes('价格底线') && text.includes('必抓'))
} catch (e) { ok('wiki_schema(商品) 可调用', false, e.message) }

try {
  const r = await callTool('dsagent_wiki_template', { domain: '商品' })
  const text = typeof r === 'string' ? r : (r?.text ?? JSON.stringify(r))
  ok('wiki_template 返回锁定模板', text.includes('实体识别字段') && text.includes('null'))
} catch (e) { ok('wiki_template 可调用', false, e.message) }

try {
  const r = await callTool('dsagent_wiki_template', { domain: '经营' })
  const text = typeof r === 'string' ? r : (r?.text ?? JSON.stringify(r))
  ok('wiki_template(经营) 缺 subtype 时给出明确提示', /实体子类型|subtype/.test(text))
} catch (e) { ok('wiki_template(经营) 可调用', false, e.message) }

try {
  const r = await callTool('dsagent_wiki_stats', {})
  const text = typeof r === 'string' ? r : (r?.text ?? JSON.stringify(r))
  ok('wiki_stats 返回概览', text.includes('Wiki 根目录') || text.includes('总页数'))
} catch (e) { ok('wiki_stats 可调用', false, e.message) }

try {
  const r = await callTool('dsagent_wiki_search', {})
  const text = typeof r === 'string' ? r : (r?.text ?? JSON.stringify(r))
  ok('wiki_search 空库时给出入门指引', text.includes('暂无页面') || text.includes('没有匹配'))
} catch (e) { ok('wiki_search 可调用', false, e.message) }

// ── 坑位记忆工具（P3）──
try {
  const r = await callTool('dsagent_pitfalls', {})
  const text = typeof r === 'string' ? r : (r?.text ?? JSON.stringify(r))
  ok('pitfalls 空库时给出说明', text.includes('没有达到阈值') || text.includes('活跃坑位') || text.includes('坑位'))
} catch (e) { ok('pitfalls 可调用', false, e.message) }

try {
  const r = await callTool('dsagent_pitfalls', { mode: 'all' })
  const text = typeof r === 'string' ? r : (r?.text ?? JSON.stringify(r))
  ok('pitfalls mode=all 可调用', text.length > 0)
} catch (e) { ok('pitfalls mode=all 可调用', false, e.message) }

try {
  const r = await callTool('dsagent_pitfalls', { mode: 'draft' })
  const text = typeof r === 'string' ? r : (r?.text ?? JSON.stringify(r))
  ok('pitfalls mode=draft 导出草稿', text.includes('草稿') || text.includes('暂无'))
} catch (e) { ok('pitfalls mode=draft 可调用', false, e.message) }

// wiki_write 拒绝不规范页面
try {
  const r = await callTool('dsagent_wiki_write', {
    domain: '商品', kind: '实体', title: '坏页',
    frontmatterYaml: 'type: 实体', body: '# 坏页',
  })
  const okFlag = r?.ok === false
  ok('wiki_write 拒绝不规范页面', okFlag, JSON.stringify(r).slice(0, 200))
} catch (e) { ok('wiki_write 可调用', false, e.message) }

// 端到端：取模板 → 填值 → 写入 → 检索到
try {
  const tplRes = await callTool('dsagent_wiki_template', { domain: '经营', subtype: '复盘' })
  const tplText = typeof tplRes === 'string' ? tplRes : (tplRes?.text ?? '')
  const fm = [
    'type: 实体',
    'title: 2026Q3 冲量复盘',
    'description: 三季度冲量计划的结果与归因',
    'resource: raw/2026Q3复盘.md',
    'tags: [复盘, 冲量]',
    'timestamp: 2026-10-04:01:00:00',
    '所属领域: 经营',
    '实体子类型: 复盘',
    '披露等级: 仅内部',
    '置信度说明: 平台数据与内部台账交叉验证',
    '实体识别字段:',
    '  经营事项编号: OPS-2026Q3',
    '  经营事项名称: 2026Q3 冲量复盘',
    '  周期: 2026-07 ~ 2026-09',
    '领域字段集:',
    '  目标与依据:',
    '    经营目标: GMV 1200 万',
    '  复盘与判断:',
    '    结果对比: 实际 1050 万，缺口 12.5%',
    '    归因判断: 主推款断货两周导致流量承接不足',
  ].join('\n')
  const w = await callTool('dsagent_wiki_write', {
    domain: '经营', kind: '实体', title: '2026Q3 冲量复盘',
    frontmatterYaml: fm, body: '# 2026Q3 冲量复盘\n\n正文内容。',
  })
  ok('wiki_write 接受规范页面', w?.ok === true, JSON.stringify(w).slice(0, 300))

  const s = await callTool('dsagent_wiki_search', { domain: '经营' })
  const sText = typeof s === 'string' ? s : (s?.text ?? '')
  ok('写入后能被检索到', sText.includes('2026Q3 冲量复盘'), sText.slice(0, 200))

  const st = await callTool('dsagent_wiki_stats', {})
  const stText = typeof st === 'string' ? st : (st?.text ?? '')
  ok('stats 反映已写入 1 页', stText.includes('总页数：1'), stText.slice(0, 200))

  ok('INDEX.md 已生成且链接可达', (() => {
    const idx = path.join(tmp, 'wiki', 'INDEX.md')
    if (!fs.existsSync(idx)) return false
    const text = fs.readFileSync(idx, 'utf8')
    const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map(m => decodeURI(m[1]))
    return links.length > 0 && links.every(l => fs.existsSync(path.join(tmp, 'wiki', l)))
  })())
} catch (e) { ok('端到端写入流程', false, e.stack) }

console.log(`\n${'═'.repeat(56)}`)
console.log(`  通过 ${pass}　失败 ${fail}`)
console.log(`${'═'.repeat(56)}\n`)
process.exit(fail ? 1 : 0)
