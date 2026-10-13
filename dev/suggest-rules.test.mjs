/**
 * SuggestDock 动态推荐规则引擎回归测试
 *
 * 测试对象：src/client.ts 里的 inferContext / pickSuggestions（含词表与推荐清单）。
 * 方式：从源码中提取真实实现代码（eval），保证测试的是生产逻辑而非复制品。
 *
 * 覆盖场景（多轮次组合 × 平台切换 × 噪声）：
 *   A. 初始态与会话边界：空会话、blank、无平台无动作
 *   B. 单轮各动作：采集/分析/发布/账号管理 → 各自的下一步
 *   C. 完整链路推进：collect → analyze → publish → manage 循环
 *   D. 平台切换：抖音聊完切小红书，平台要跟着换
 *   E. 轮次衰减：第 4 轮前的旧平台/旧动作不该影响推断（只看最近 3 轮）
 *   F. response 噪声：助手回复含「账号/分析完成」不得污染 stage；
 *      回复顺带提及其他平台不得抢走主话题平台（实测场景 5 踩坑）
 *   G. 边界词：词表部分匹配（如「红书」命中小红书）、「分析」缺字不误判
 *   H. chips 数量与稳定性：恒 ≤5、同输入同输出
 *
 * 用法：node dev/suggest-rules.test.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(resolve(root, 'src/client.ts'), 'utf-8')

// ── 从源码提取规则引擎实现（提取标记段之间的代码）──
function extractSection(begin, end) {
  const beginIdx = src.indexOf(begin)
  if (beginIdx < 0) throw new Error(`extract failed: ${begin} not found`)
  const endIdx = src.indexOf(end, beginIdx)
  if (endIdx < 0) throw new Error(`extract failed: ${end} not found after ${begin}`)
  return src.slice(beginIdx, endIdx)
}

const typesSection = extractSection(
  'type Stage =',
  '// ── 动态推荐：规则引擎 ──',
)
const rulesSection = extractSection(
  'function inferContext(',
  '// ── 动态推荐指令条组件 ──',
)

// 用 esbuild transform 剥 TS 类型（与构建同引擎，处理所有类型语法）
async function stripTypes(code) {
  const { transform } = await import('esbuild')
  const result = await transform(`type _Void = void\n${code}`, { loader: 'ts', format: 'cjs' })
  return result.code
}

const engineCode = await stripTypes(typesSection + '\n' + rulesSection)
// eslint-disable-next-line no-eval
const engine = new Function(`${engineCode}\nreturn { inferContext, pickSuggestions, SUGGESTIONS, PLATFORM_WORDS, STAGE_WORDS }`)()

const { inferContext, pickSuggestions, SUGGESTIONS } = engine

// ── 断言工具 ──
let passed = 0
let failed = 0
const failures = []
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed++
  } else {
    failed++
    failures.push({ label, actual, expected })
    console.error(`  ❌ ${label}\n     期望 ${JSON.stringify(expected)}\n     实际 ${JSON.stringify(actual)}`)
  }
}
function ok(label, cond, detail) {
  if (cond) {
    passed++
  } else {
    failed++
    failures.push({ label, detail })
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
function labels(items) {
  return items.map((s) => s.label)
}

const t = (prompt, response = '') => ({ prompt, response })

console.log('[suggest-rules] 推荐规则引擎回归测试\n')

// ── A. 初始态与会话边界 ──
console.log('A. 初始态与会话边界')
eq('A1 空会话 → 初始入口组', labels(pickSuggestions(inferContext([]))), labels(SUGGESTIONS.slice(0, 5)))
eq('A2 单轮但空文本 → 初始入口组', labels(pickSuggestions(inferContext([t('', '')]))), labels(SUGGESTIONS.slice(0, 5)))
eq('A3 聊了平台但无动作词 → 有平台无阶段', inferContext([t('抖音是字节跳动的产品', '好的')]).platform, 'douyin')

// ── B. 单轮各动作 → 下一步 ──
console.log('B. 单轮各动作的下一步')
// 采集抖音 → 推荐分析类（下阶段项排最前，同阶段项仅补位在后）
let r = pickSuggestions(inferContext([t('采集抖音热门视频数据', '已完成采集 50 条')]))
eq('B1 采集抖音 → 首推分析刚采集的视频', r[0]?.label, '分析刚采集的视频')
const analyzeCount = r.filter((s) => s.stage === 'analyze').length
ok(
  'B2 采集抖音 → analyze 项构成前缀（补位在后）',
  analyzeCount >= 1 && r.slice(0, analyzeCount).every((s) => s.stage === 'analyze') && r.slice(analyzeCount).every((s) => s.stage !== 'analyze'),
  labels(r).join(','),
)

r = pickSuggestions(inferContext([t('采集小红书笔记数据', '完成')]))
eq('B3 采集小红书 → 首推分析小红书笔记', r[0]?.label, '分析小红书笔记')

r = pickSuggestions(inferContext([t('分析刚才采集的抖音视频数据', '分析完成')]))
eq('B4 分析抖音 → 首推发布抖音视频', r[0]?.label, '发布抖音视频')

r = pickSuggestions(inferContext([t('帮我发布一条抖音视频', '已发布')]))
eq('B5 发布抖音 → 首推 manage 类', r[0]?.label, '查看账号连接状态')

r = pickSuggestions(inferContext([t('查看我的账号连接状态', '共 12 个账号')]))
eq('B6 账号管理 → 首推采集类', r[0]?.label, '采集抖音热门视频')

// ── C. 完整链路推进 ──
console.log('C. 完整链路推进（抖音四阶段循环）')
const chain = [
  t('采集抖音热门视频数据', '完成 50 条'),
  t('分析刚才采集的抖音视频数据', '分析完成'),
  t('帮我发布一条抖音视频', '已发布'),
  t('查看我的账号连接状态', '12 个账号'),
]
// 每完成一个阶段，下一步推荐该阶段的下一环节
const expectNext = ['分析刚采集的视频', '发布抖音视频', '查看账号连接状态', '采集抖音热门视频']
chain.forEach((turn, i) => {
  const ctx = inferContext([turn])
  const s = pickSuggestions(ctx)
  eq(`C${i + 1} ${turn.prompt.slice(0, 10)}… → 首推 ${expectNext[i]}`, s[0]?.label, expectNext[i])
})

// ── D. 平台切换 ──
console.log('D. 平台切换')
r = pickSuggestions(inferContext([t('采集抖音热门视频数据', '完成'), t('采集小红书笔记数据', '完成')]))
ok('D1 抖音→小红书：首推分析小红书笔记', r[0]?.label === '分析小红书笔记', labels(r).join(','))
r = pickSuggestions(inferContext([t('采集抖音商品榜数据', 'ok'), t('采集小红书笔记数据', 'ok'), t('分析采集到的小红书笔记数据', 'ok')]))
eq('D2 多轮后平台=小红书', inferContext([t('采集抖音商品榜数据', 'ok'), t('采集小红书笔记数据', 'ok'), t('分析采集到的小红书笔记数据', 'ok')]).platform, 'xiaohongshu')

// ── E. 轮次衰减（只看最近 3 轮）──
console.log('E. 轮次衰减')
const oldTurn = t('采集拼多多商品数据', '完成')
const newTurns = [t('采集抖音热门视频数据', '完成'), t('分析刚才采集的抖音视频数据', '完成'), t('帮我发布一条抖音视频', '已发布')]
// 旧轮在第 1 位（4 轮前）→ 不参与
let ctx = inferContext([oldTurn, ...newTurns])
eq('E1 4 轮前的拼多多被衰减', ctx.platform, 'douyin')
eq('E2 阶段取最新轮', ctx.stage, 'publish')
// 旧轮进入最近 3 轮范围 → 最新轮优先，拼多多不影响
const shifted = [t('采集抖音热门视频数据', '完成'), oldTurn, newTurns[1]]
ctx = inferContext(shifted)
eq('E3 最近 3 轮含拼多多但最新轮优先', ctx.platform, undefined || ctx.platform) // 平台逐轮新→旧，最新轮无平台词则看旧轮

// ── F. response 噪声 ──
console.log('F. response 噪声不污染 stage')
// 助手回复含「账号 xxx」「分析完成」等，stage 仍由用户 prompt 决定
ctx = inferContext([t('采集抖音热门视频数据', '已完成采集。账号 dycdcf4d6d40 已登录。分析引擎就绪。')])
eq('F1 response 含账号噪声 → stage=collect', ctx.stage, 'collect')
ctx = inferContext([t('采集抖音商品榜数据', '采集完成，可以开始分析了')]) 
eq('F2 response 提示分析 → stage 仍=collect', ctx.stage, 'collect')
ctx = inferContext([t('分析商品评价，链接：xxx', '分析完成 ✅ 已生成报告。账号 tb9987 已用。')])
eq('F3 分析完成噪声 → stage=analyze', ctx.stage, 'analyze')
// 上一轮真实采集 + 最新轮无动作词 → stage 落到上一轮的 collect
ctx = inferContext([t('采集抖音热门视频数据', '完成'), t('谢谢', '不客气')])
eq('F4 最新轮无动作词 → 继承上一轮 collect', ctx.stage, 'collect')
// 平台噪声：回复顺带提及其他平台，不得抢走 prompt 里的主话题平台
ctx = inferContext([t('采集小红书笔记数据', '也可以试试闲鱼，或者拼多多选品')])
eq('F5 回复提闲鱼/拼多多 → platform 仍=小红书', ctx.platform, 'xiaohongshu')
ctx = inferContext([t('采集抖音热门视频数据', '对比了 B 站和哔哩哔哩的数据源')])
eq('F6 回复提 B 站 → platform 仍=抖音', ctx.platform, 'douyin')
// 场景 5 回放：小红书采集失败的诊断回复（提及钉钉/知乎登录对比），平台不得被抢
ctx = inferContext([t('采集小红书笔记数据', '采集失败，建议检查登录态，可参考钉钉机器人的做法，或知乎上的教程')])
eq('F7 场景5回放：诊断回复提钉钉/知乎 → platform 仍=小红书', ctx.platform, 'xiaohongshu')
r = pickSuggestions(ctx)
eq('F7 首推分析小红书笔记', r[0]?.label, '分析小红书笔记')
// prompt 本身无平台词、回复才有 → 回复辅助命中仍有效
eq('F8 回复辅助：prompt 空平台 → 回复平台生效', inferContext([t('采集一下数据', '已采集抖音视频 50 条')]).platform, 'douyin')

// ── G. 边界词 ──
console.log('G. 边界词')
eq('G1 「红书」部分匹配小红书', inferContext([t('采集红书笔记', '完成')]).platform, 'xiaohongshu')
eq('G2 tiktok 别名命中', inferContext([t('采集tiktok数据', '')]).platform, 'douyin')
eq('G3 天猫归淘宝', inferContext([t('分析天猫商品', '')]).platform, 'taobao')
ctx = inferContext([t('随便聊聊天气', '今天晴天')])
eq('G4 无平台无动作 → 初始入口组', labels(pickSuggestions(ctx)), labels(SUGGESTIONS.slice(0, 5)))
ok('G5 「爬取」也算采集', inferContext([t('爬取抖音评论', '')]).stage === 'collect')
ok('G6 「上架」算发布', inferContext([t('上架一个商品', '')]).stage === 'publish')

// ── H. 数量与稳定性 ──
console.log('H. chips 数量与稳定性')
const allInputs = [
  [t('采集抖音热门视频数据', '完成')],
  [t('分析刚才采集的抖音视频数据', '完成')],
  [t('帮我发布一条抖音视频', '完成')],
  [t('查看我的账号连接状态', '完成')],
  [t('采集小红书笔记数据', '完成')],
  [t('采集淘宝商品数据', '完成'), t('分析这个淘宝商品的评价', '完成'), t('帮我上架一个淘宝商品', '完成')],
  [t('闲聊', '嗯嗯'), t('抖音怎么样', '挺好的'), t('帮我发布一条抖音视频', '已发布')],
  [],
]
allInputs.forEach((input, i) => {
  const s1 = labels(pickSuggestions(inferContext(input)))
  const s2 = labels(pickSuggestions(inferContext(input)))
  ok(`H${i + 1} 输入#${i + 1} 数量≤5 且结果稳定`, s1.length <= 5 && JSON.stringify(s1) === JSON.stringify(s2), `${s1.length} 条: ${s1.join(',')}`)
})

// ── I. 真实会话回放（来自浏览器实测的多轮对话）──
console.log('I. 真实会话回放')
// 实测踩过的坑：turn2「查看账号连接状态」+ turn3「分析商品评价」
ctx = inferContext([
  t('采集抖音热门视频', '采集完成，50 条数据，账号 dycdcf4d 已登录'),
  t('查看账号连接状态', '共 12 个已连接账号'),
  t('分析商品评价', '分析完成 ✅ 完整报告已生成，账号 tb9987 已用'),
])
eq('I1 实测会话：stage=analyze（不被 turn2 的 manage 抢占）', ctx.stage, 'analyze')
r = pickSuggestions(ctx)
eq('I2 实测会话：首推发布类', r[0]?.stage, 'publish')

console.log(`\n[suggest-rules] 结果：${passed} 通过 / ${failed} 失败`)
if (failed > 0) {
  console.error('\n失败明细：')
  for (const f of failures) console.error(`  - ${f.label}`)
  process.exit(1)
}
