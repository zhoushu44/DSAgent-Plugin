/**
 * 端到端验证平台坑位记忆（P3）。
 *
 * 核心要验证的三条性质：
 *   ① 证据不足不提示 —— 单次失败只是偶发，不得进入提示（防止噪声污染）
 *   ② 同因不同例必须折叠 —— 商品 ID 不同的同类失败要合并计数，否则永远到不了阈值
 *   ③ 只记录事实，不做模型推断 —— 所有字段都来自机器可验证的观测
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert'
import {
  createPitfallMemory, normalizeSignature, pitfallKey,
  renderPitfallHint, exportPitfallDraft, PITFALL,
} from '../lib/services/pitfall-memory.js'

let pass = 0, fail = 0
const ok = (n, c, extra) => {
  if (c) { console.log(`  ✓ ${n}`); pass++ }
  else { console.log(`  ✗ ${n}${extra ? `\n      ${extra}` : ''}`); fail++ }
}
async function okA(n, fn) {
  try { await fn(); console.log(`  ✓ ${n}`); pass++ }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++ }
}

/* ══════════════ 1. 签名归一化 ══════════════ */
console.log('\n[1] 签名归一化（同因不同例必须折叠）')

ok('长数字被替换为 <ID>', normalizeSignature('商品 614498626290 取数失败') === normalizeSignature('商品 762128994852 取数失败'))
ok('普通短数字不被替换（避免误折叠版本号等）', normalizeSignature('重试第 3 次') === '重试第 3 次', normalizeSignature('重试第 3 次'))
ok('UUID 被替换', !normalizeSignature('trace 550e8400-e29b-41d4-a716-446655440000 失败').includes('550e8400'))
ok('长 hex 被替换', normalizeSignature('token a1b2c3d4e5f6a7b8c9d0 无效').includes('<ID>'))
ok('双引号值被替换', normalizeSignature('字段 "价格底线" 缺失') === normalizeSignature('字段 "库存" 缺失'))
ok('单引号值被替换', normalizeSignature("key 'abc' not found") === normalizeSignature("key 'xyz' not found"))
ok('中文引号值被替换', normalizeSignature('字段“成本”缺失') === normalizeSignature('字段“利润”缺失'))
ok('Windows 绝对路径被替换', !normalizeSignature('无法读取 C:\\Users\\zs\\Desktop\\a\\b\\c.txt').includes('Users'))
ok('连续空白折叠', normalizeSignature('a    b\n\nc') === 'a b c')
ok('首尾标点被清理', normalizeSignature('  ：错误信息。  ') === '错误信息')
ok('超长签名被截断', normalizeSignature('x'.repeat(500)).length <= PITFALL.SIGNATURE_MAX + 1)
ok('空输入返回空串', normalizeSignature('') === '')

/* ══════════════ 2. 坑位键 ══════════════ */
console.log('\n[2] 坑位键（平台/失败类型/签名 三维区分）')
ok('同签名不同平台 → 不同键', pitfallKey({ platform: 'taobao', failureKind: 'api_error', signature: 's' }) !== pitfallKey({ platform: 'pdd', failureKind: 'api_error', signature: 's' }))
ok('同平台不同失败类型 → 不同键', pitfallKey({ platform: 'taobao', failureKind: 'risk_control', signature: 's' }) !== pitfallKey({ platform: 'taobao', failureKind: 'rate_limit', signature: 's' }))
ok('同平台同类型同签名 → 同键', pitfallKey({ platform: 'taobao', failureKind: 'api_error', signature: 's' }) === pitfallKey({ platform: 'taobao', failureKind: 'api_error', signature: 's' }))
ok('无平台时归为 common', pitfallKey({ failureKind: 'api_error', signature: 's' }).startsWith('common::'))
ok('空签名有占位符', pitfallKey({ platform: 'x', failureKind: 'y', signature: '' }).includes('(无签名)'))

/* ══════════════ 3. 证据不足不提示（核心性质 ①） ══════════════ */
console.log('\n[3] 证据不足不提示（核心性质 — 防噪声）')
const t1 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-a-')), '.pitfall.json')

await okA('单次失败不晋升、不进提示', async () => {
  const m = createPitfallMemory(t1)
  const r = await m.record({ skillId: 'product-reviews', platform: 'taobao', failureKind: 'risk_control', message: '命中风控' })
  assert.equal(r.promoted, false, '单次不应晋升')
  const active = await m.activeFor({ skillId: 'product-reviews' })
  assert.equal(active.length, 0, '证据不足不得进入提示')
})

await okA('第二次仍不晋升', async () => {
  const m = createPitfallMemory(t1)
  const r = await m.record({ skillId: 'product-reviews', platform: 'taobao', failureKind: 'risk_control', message: '命中风控' })
  assert.equal(r.promoted, false)
  assert.equal((await m.activeFor({ skillId: 'product-reviews' })).length, 0)
})

await okA(`第 ${PITFALL.PROMOTE_THRESHOLD} 次晋升并进入提示`, async () => {
  const m = createPitfallMemory(t1)
  const r = await m.record({ skillId: 'product-reviews', platform: 'taobao', failureKind: 'risk_control', message: '命中风控' })
  assert.equal(r.promoted, true, '达到阈值应晋升')
  assert.equal(r.entry.count, PITFALL.PROMOTE_THRESHOLD)
  const active = await m.activeFor({ skillId: 'product-reviews' })
  assert.equal(active.length, 1)
  assert.equal(active[0].confirmed, true)
})

await okA('晋升状态持久化到磁盘', async () => {
  const m = createPitfallMemory(t1)
  const all = await m.list()
  assert.equal(all.length, 1)
  assert.equal(all[0].confirmed, true)
  assert.equal(all[0].count, PITFALL.PROMOTE_THRESHOLD)
})

/* ══════════════ 4. 同因不同例折叠（核心性质 ②） ══════════════ */
console.log('\n[4] 同因不同例折叠（核心性质 — 否则永远到不了阈值）')
const t2 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-b-')), '.pitfall.json')

await okA('三个不同商品 ID 的同类失败合并为一条并晋升', async () => {
  const m = createPitfallMemory(t2)
  for (const id of ['614498626290', '762128994852', '123456789012']) {
    await m.record({ skillId: 'product-reviews', platform: 'taobao', failureKind: 'api_error', message: `商品 ${id} 详情接口被拒` })
  }
  const all = await m.list()
  assert.equal(all.length, 1, `应折叠为 1 条，实际 ${all.length} 条：${JSON.stringify(all.map(e => e.signature))}`)
  assert.equal(all[0].count, 3)
  assert.equal(all[0].confirmed, true)
})

await okA('同一坑被多个技能命中时 skillIds 累积', async () => {
  const m = createPitfallMemory(t2)
  // 用 ≥5 位 ID，确保归一化成 <ID> 从而命中同一条记录
  await m.record({ skillId: 'product-wdj', platform: 'taobao', failureKind: 'api_error', message: '商品 888888 详情接口被拒' })
  const all = await m.list()
  const e = all.find(x => x.failureKind === 'api_error')
  assert.ok(e.skillIds.includes('product-reviews') && e.skillIds.includes('product-wdj'), JSON.stringify(e.skillIds))
})

await okA('短数字不折叠（避免误合并版本号等）', async () => {
  const t = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-short-')), '.pitfall.json')
  const m = createPitfallMemory(t)
  await m.record({ skillId: 's', platform: 'x', failureKind: 'api_error', message: '商品 999 失败' })
  await m.record({ skillId: 's', platform: 'x', failureKind: 'api_error', message: '商品 888 失败' })
  const all = await m.list()
  assert.equal(all.length, 2, '不同短数字应保留为两条（不被误折叠）')
})

/* ══════════════ 5. 平台维度过滤 ══════════════ */
console.log('\n[5] 平台 / 技能维度过滤')
const t3 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-c-')), '.pitfall.json')

await okA('不同平台的坑互不干扰', async () => {
  const m = createPitfallMemory(t3)
  for (let i = 0; i < 3; i++) await m.record({ skillId: 's1', platform: 'taobao', failureKind: 'rate_limit', message: '限流' })
  for (let i = 0; i < 3; i++) await m.record({ skillId: 's2', platform: 'pdd', failureKind: 'rate_limit', message: '系统繁忙' })
  const taobao = await m.activeFor({ platform: 'taobao' })
  const pdd = await m.activeFor({ platform: 'pdd' })
  assert.equal(taobao.length, 1)
  assert.equal(pdd.length, 1)
  assert.notEqual(taobao[0].signature, pdd[0].signature)
})

await okA('按技能过滤只返回涉及的技能', async () => {
  const m = createPitfallMemory(t3)
  const onlyS1 = await m.activeFor({ skillId: 's1' })
  assert.equal(onlyS1.length, 1)
  assert.ok(onlyS1[0].skillIds.includes('s1'))
  const unknown = await m.activeFor({ skillId: 'nonexistent' })
  assert.equal(unknown.length, 0)
})

/* ══════════════ 6. 陈旧坑位退出提示 ══════════════ */
console.log('\n[6] 陈旧坑位退出提示（平台会修问题，旧坑是噪声）')
const t4 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-d-')), '.pitfall.json')

await okA('超过 STALE_DAYS 未复现的坑位不再提示，但记录保留', async () => {
  // 手工构造一条很旧的已确认记录
  const old = Date.now() - (PITFALL.STALE_DAYS + 10) * 86_400_000
  fs.writeFileSync(t4, JSON.stringify({
    'taobao::api_error::旧坑': {
      signature: '旧坑', failureKind: 'api_error', platform: 'taobao',
      skillIds: ['s1'], count: 9, firstSeenAt: old, lastSeenAt: old,
      lastMessage: '旧的错误', confirmed: true,
    },
  }), 'utf8')
  const m = createPitfallMemory(t4)
  assert.equal((await m.activeFor({})).length, 0, '陈旧坑位不应进提示')
  assert.equal((await m.list()).length, 1, '记录必须保留（可回溯）')
  const st = await m.stats()
  assert.equal(st.stale, 1)
  assert.equal(st.confirmed, 1)
})

await okA('陈旧坑位重新复现后回到提示', async () => {
  const m = createPitfallMemory(t4)
  await m.record({ skillId: 's1', platform: 'taobao', failureKind: 'api_error', message: '旧坑' })
  assert.equal((await m.activeFor({})).length, 1, '重新复现应回到提示')
})

/* ══════════════ 7. 并发与健壮性 ══════════════ */
console.log('\n[7] 并发与健壮性')
const t5 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e-')), '.pitfall.json')

await okA('并发记录不丢计数（写串行化）', async () => {
  const m = createPitfallMemory(t5)
  await Promise.all(Array.from({ length: 20 }, () =>
    m.record({ skillId: 'hot', platform: 'x', failureKind: 'api_error', message: '并发失败' })))
  const all = await m.list()
  assert.equal(all.length, 1)
  assert.equal(all[0].count, 20, `期望 20，实际 ${all[0].count}`)
})

await okA('统计文件损坏时不抛错', async () => {
  const t = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-bad-')), '.pitfall.json')
  fs.writeFileSync(t, '{ not json', 'utf8')
  const m = createPitfallMemory(t)
  assert.deepEqual(await m.list(), [])
})

await okA('形状不对的条目被净化丢弃', async () => {
  const t = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-dirty-')), '.pitfall.json')
  fs.writeFileSync(t, JSON.stringify({
    good: { signature: 'a', failureKind: 'api_error', platform: 'x', skillIds: ['s'], count: 3, firstSeenAt: 1, lastSeenAt: Date.now(), lastMessage: '', confirmed: true },
    badCount: { signature: 'b', count: 0 },
    notObject: 'string',
    missingCount: { signature: 'c' },
  }), 'utf8')
  const m = createPitfallMemory(t)
  const all = await m.list()
  assert.equal(all.length, 1, JSON.stringify(all.map(e => e.signature)))
  assert.equal(all[0].signature, 'a')
})

await okA('clear 清空全部', async () => {
  const m = createPitfallMemory(t5)
  await m.clear()
  assert.equal((await m.list()).length, 0)
})

await okA('remove 删除单条', async () => {
  const m = createPitfallMemory(t5)
  await m.record({ skillId: 's', platform: 'x', failureKind: 'api_error', message: 'e' })
  const all = await m.list()
  assert.equal(all.length, 1)
  const key = pitfallKey({ platform: 'x', failureKind: 'api_error', signature: 'e' })
  assert.equal(await m.remove(key), true)
  assert.equal((await m.list()).length, 0)
  assert.equal(await m.remove(key), false, '重复删除应返回 false')
})

/* ══════════════ 8. 提示渲染 ══════════════ */
console.log('\n[8] 提示渲染')
const entries = [{
  signature: '商品 <ID> 详情接口被拒', failureKind: 'risk_control', platform: 'taobao',
  skillIds: ['product-reviews'], count: 5, firstSeenAt: Date.now() - 86_400_000,
  lastSeenAt: Date.now() - 3_600_000, lastMessage: 'FAIL_SYS_ILLEGAL_ACCESS', confirmed: true,
}]

const hint = renderPitfallHint(entries)
ok('提示含证据次数', hint.includes('已复现 5 次'))
ok('提示含处置建议（只说有坑不说怎么办等于没提示）', hint.includes('dsagent_risk_verify'))
ok('提示含失败类型', hint.includes('risk_control'))
ok('提示含「是历史统计」的免责说明', hint.includes('历史统计'))
ok('空输入返回空串', renderPitfallHint([]) === '')

const draft = exportPitfallDraft(entries, { skillId: 'product-reviews' })
ok('草稿带未审核警示', draft.includes('未经人工确认'))
ok('草稿含复现次数', draft.includes('复现次数：5'))
ok('草稿含原始错误样本', draft.includes('FAIL_SYS_ILLEGAL_ACCESS'))
ok('草稿含建议沉淀位置', draft.includes('SKILL.patch.md'))
ok('空草稿有明确说明', exportPitfallDraft([]).includes('暂无'))

/* ══════════════ 9. 容量控制 ══════════════ */
console.log('\n[9] 容量控制（防止长期运行无限增长）')
await okA(`超过 ${PITFALL.MAX_ENTRIES} 条时淘汰最陈旧记录`, async () => {
  const t = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-cap-')), '.pitfall.json')
  const m = createPitfallMemory(t)
  // 直接构造超限数据验证淘汰逻辑（避免写 500+ 次）
  const big = {}
  for (let i = 0; i < PITFALL.MAX_ENTRIES + 50; i++) {
    big[`k${i}`] = {
      signature: `sig${i}`, failureKind: 'api_error', platform: 'x', skillIds: ['s'],
      count: 1, firstSeenAt: 1000 + i, lastSeenAt: 1000 + i, lastMessage: '', confirmed: false,
    }
  }
  fs.writeFileSync(t, JSON.stringify(big), 'utf8')
  const m2 = createPitfallMemory(t)
  // 触发一次写入即会走 evictIfNeeded
  await m2.record({ skillId: 's', platform: 'x', failureKind: 'api_error', message: 'trigger' })
  const all = await m2.list()
  assert.ok(all.length <= PITFALL.MAX_ENTRIES, `应在 ${PITFALL.MAX_ENTRIES} 以内，实际 ${all.length}`)
})

/* ══════════════ 汇总 ══════════════ */
console.log(`\n${'═'.repeat(56)}`)
console.log(`  通过 ${pass}　失败 ${fail}`)
console.log(`${'═'.repeat(56)}\n`)
process.exit(fail ? 1 : 0)
