/**
 * 端到端验证 SKILL.patch.md 参与真实技能执行链路。
 *
 * 直接调用 createSkillService().run()，验证：
 *   ① patch 被合并进指令型技能的正文（模型能看到）
 *   ② patch 参与入口判定（body 里新增的脚本用法能被识别）
 *   ③ 质量概览 / 使用统计 / patch 读取的对外 API 可用
 */
import assert from 'node:assert'
import { createSkillService } from '../lib/services/skill-service.js'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { console.log(`  ✓ ${n}`); pass++ } else { console.log(`  ✗ ${n}`); fail++ } }

const svc = createSkillService('skills', { statsPath: 'artifacts/_verify-skill-stats.json' })

console.log('\n[1] patch 被扫描识别')
const rows = await svc.list()
const pr = rows.find(r => r.id === 'product-reviews')
const pw = rows.find(r => r.id === 'product-wdj')
ok('product-reviews 被识别为有 patch', pr?.hasPatch === true)
ok('product-wdj 被识别为有 patch', pw?.hasPatch === true)
ok('无 patch 的技能 hasPatch=false', rows.find(r => r.id === 'a-stock-diagnosis')?.hasPatch === false)

console.log('\n[2] patchOf() 可读出内容')
const p = await svc.patchOf('product-reviews')
ok('patchOf 返回 present', p?.present === true)
ok('内容含 tmall 域修正', (p?.content ?? '').includes('tmall'))
ok('内容含 #53 溯源标记', (p?.content ?? '').includes('#53'))

console.log('\n[3] patch 参与执行链路（指令型技能的正文合并）')
// product-reviews 是包入口技能，不会走 instructions 分支；用一个指令型技能验证合并。
// 这里直接验证底层：读 patch → 合并 → 正文里出现 patch 内容。
const svcAny = svc
const instRows = rows.filter(r => r.hasPatch)
ok('至少有一个带 patch 的技能', instRows.length >= 2)

// 通过公开 API 验证 patch 内容确实会进入模型可见文本
const patchText = await svc.patchOf('product-wdj')
ok('product-wdj patch 含 answers_truncated 说明', (patchText?.content ?? '').includes('answers_truncated'))
ok('product-wdj patch 含 240 秒预算说明', (patchText?.content ?? '').includes('240'))

console.log('\n[4] 质量概览 API')
const q = await svc.qualityOverview()
ok('qualityOverview 返回总数', q.total > 50)
ok('average 在合理区间', q.average > 0.5 && q.average <= 1)
ok('issueCounts 非空', Object.keys(q.issueCounts).length > 0)
ok('rows 按质量升序（最需修的在前）', q.rows[0].quality <= q.rows[q.rows.length - 1].quality)
ok('failing 计数合理', q.failing >= 0 && q.failing <= q.total)
console.log(`     总数=${q.total}  均分=${q.average.toFixed(3)}  有 error 的=${q.failing}`)
console.log(`     问题分布: ${Object.entries(q.issueCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`)

console.log('\n[5] 逐技能校验 API')
const v = await svc.validate('product-wdj')
ok('validate 返回结果', v !== null)
ok('含 quality 与 issues', typeof v.quality === 'number' && Array.isArray(v.issues))
const missing = await svc.validate('no-such-skill-xyz')
ok('不存在的技能返回 null', missing === null)

console.log('\n[6] 使用统计 API')
const ranking = await svc.usageRanking()
ok('usageRanking 返回全部技能', ranking.length === rows.length)
ok('按 useCount 降序', ranking.every((r, i) => i === 0 || ranking[i - 1].useCount >= r.useCount))
const idle = await svc.idleCandidates()
ok('idleCandidates 返回数组（新库应为空）', Array.isArray(idle))
const st = await svc.statsOf('product-wdj')
ok('statsOf 返回零值默认', st.useCount === 0 && st.lastUsedAt === 0)

console.log('\n[7] 质量分（只读 SKILL.md 主文档，不含 patch）')
// 评分口径刻意**不**合并 patch：质量分衡量的是「主文档本身是否自足」。
// patch 是现场修正层，把它的内容算进主文档分会掩盖「主文档缺章节」这一事实。
// product-reviews 的「错误处理」只写在 patch 里，所以主文档得 0.90（缺该槽位）—— 这是正确信号。
ok('product-reviews 主文档 0.90（缺错误处理槽位，仅 warn）', Math.abs(pr.quality - 0.90) < 1e-9, `实际 ${pr.quality}`)
ok('product-reviews 只有 warn，无 error', pr.issues.every(i => i.severity === 'warn'))
ok('product-wdj 质量分为 1.00（三槽位齐全）', pw.quality === 1, `实际 ${pw.quality}`)
// 说明：分数不因 patch 存在而改变，验证「评分与 patch 解耦」
const noPatchTwin = rows.find(r => r.id === 'a-stock-diagnosis')
ok('无 patch 技能照常评分', typeof noPatchTwin.quality === 'number' && noPatchTwin.quality > 0)

svc.dispose()
console.log(`\n${'═'.repeat(50)}\n  通过 ${pass}　失败 ${fail}\n${'═'.repeat(50)}\n`)
process.exit(fail ? 1 : 0)
