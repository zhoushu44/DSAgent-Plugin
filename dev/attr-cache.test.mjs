/**
 * 属性缓存分层扩展回归测试（PUBLISH-SPEC §3.6 / 实施计划第 6 步）。
 *
 * 覆盖两层：
 *   A. 旧 API（lookup/record/invalidate/snapshot）——行为零变化
 *   B. 新分层 API：
 *      - SKU 维度缓存 lookupSkuDims/recordSkuDims（并集合并，多维不覆盖）
 *      - 店铺级枚举缓存 lookupFreight/recordFreight（运费模板/发货时间）
 *      - schema 指纹 schemaFingerprint/checkSchemaFingerprint（首记不失效/变化失效属性桶/顺序无关）
 *
 * 运行：node dev/attr-cache.test.mjs
 *   ★ 须先 npm run build:host（import 的是 lib/ 编译产物）
 */
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const LIB = path.resolve(import.meta.dirname, '..', 'lib')
const ac = await import(pathToFileURL(path.join(LIB, 'services', 'attr-cache.js')).href)
const { createAttrCache, schemaFingerprint } = ac

/** 每个用例独立临时文件实例，互不污染 */
async function freshCache() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'attr-cache-test-'))
  const cache = createAttrCache(path.join(dir, '.attr-cache.json'))
  return { cache, storePath: path.join(dir, '.attr-cache.json'), async cleanup() { await fs.rm(dir, { recursive: true, force: true }) } }
}

const CASES = []
let currentSuite = ''
function suite(name) { currentSuite = name }
function test(name, fn) { CASES.push({ suite: currentSuite, name, fn }) }

async function runAll() {
  let pass = 0
  const failures = []
  for (const c of CASES) {
    try {
      await c.fn()
      pass++
      console.log(`  ✓ ${c.name}`)
    } catch (err) {
      failures.push({ ...c, err })
      console.log(`  ✗ ${c.name}`)
      console.log(`      ${err?.message ?? err}`)
    }
  }
  console.log(`\n结果：${pass}/${CASES.length} 通过`)
  if (failures.length) {
    console.log('\n失败用例：')
    for (const f of failures) {
      console.log(`  ✗ [${f.suite}] ${f.name}`)
      console.log(`    ${f.err?.stack?.split('\n').slice(0, 3).join('\n    ') ?? f.err}`)
    }
    process.exitCode = 1
  } else {
    console.log('属性缓存分层回归测试全部通过。')
  }
}

// ── A. 旧 API（行为零变化） ────────────────────────────────

suite('A. 旧 API 行为零变化')

test('record → lookup 往返；未记录返回 null', async () => {
  const { cache, cleanup } = await freshCache()
  try {
    assert.equal(await cache.lookup('pdd_mms', '咖啡纸杯', '材质'), null)
    await cache.record('pdd_mms', '咖啡纸杯', '材质', 'PP塑料')
    assert.equal(await cache.lookup('pdd_mms', '咖啡纸杯', '材质'), 'PP塑料')
  } finally { await cleanup() }
})

test('类目关键词大小写归一（Coffee Cup ≡ coffee cup）', async () => {
  const { cache, cleanup } = await freshCache()
  try {
    await cache.record('pdd_mms', 'Coffee Cup', '材质', 'PP塑料')
    assert.equal(await cache.lookup('pdd_mms', ' coffee cup ', '材质'), 'PP塑料')
  } finally { await cleanup() }
})

test('hits 累计 + invalidate 清桶', async () => {
  const { cache, cleanup } = await freshCache()
  try {
    await cache.record('taobao', '童装', '袖长', '短袖')
    await cache.record('taobao', '童装', '袖长', '长袖')
    const snap = await cache.snapshot()
    assert.equal(snap['taobao:童装'].袖长.hits, 2)
    await cache.invalidate('taobao', '童装')
    assert.equal(await cache.lookup('taobao', '童装', '袖长'), null)
    assert.equal((await cache.snapshot())['taobao:童装'], undefined)
  } finally { await cleanup() }
})

test('落盘真实存在（tmp + rename 原子写）', async () => {
  const { cache, storePath, cleanup } = await freshCache()
  try {
    await cache.record('pdd_mms', '纸杯', '容量', '500ml')
    const raw = JSON.parse(await fs.readFile(storePath, 'utf8'))
    assert.equal(raw['pdd_mms:纸杯'].容量.value, '500ml')
  } finally { await cleanup() }
})

// ── B1. SKU 维度缓存 ────────────────────────────────────────

suite('B1. SKU 维度缓存')

test('recordSkuDims → lookupSkuDims 往返；未记录返回 []', async () => {
  const { cache, cleanup } = await freshCache()
  try {
    assert.deepEqual(await cache.lookupSkuDims('pdd_mms', '童装'), [])
    await cache.recordSkuDims('pdd_mms', '童装', ['身高'])
    assert.deepEqual(await cache.lookupSkuDims('pdd_mms', '童装'), ['身高'])
  } finally { await cleanup() }
})

test('多维并集合并不覆盖（d1=颜色 后 d2=身高 → 两者都在）', async () => {
  const { cache, cleanup } = await freshCache()
  try {
    await cache.recordSkuDims('pdd_mms', 'T恤', ['颜色'])
    await cache.recordSkuDims('pdd_mms', 'T恤', ['身高'])
    const dims = await cache.lookupSkuDims('pdd_mms', 'T恤')
    assert.ok(dims.includes('颜色'), `应含颜色，实得 ${dims}`)
    assert.ok(dims.includes('身高'), `应含身高，实得 ${dims}`)
  } finally { await cleanup() }
})

test('空数组/空白项不记；上限 4 个维度', async () => {
  const { cache, cleanup } = await freshCache()
  try {
    await cache.recordSkuDims('pdd_mms', 'X', ['', '  '])
    assert.deepEqual(await cache.lookupSkuDims('pdd_mms', 'X'), [])
    for (const d of ['a', 'b', 'c', 'd', 'e', 'f']) await cache.recordSkuDims('pdd_mms', 'X', [d])
    const dims = await cache.lookupSkuDims('pdd_mms', 'X')
    assert.equal(dims.length, 4)
    assert.deepEqual(dims, ['c', 'd', 'e', 'f'])
  } finally { await cleanup() }
})

test('与属性桶键隔离（:sku 后缀不污染原桶）', async () => {
  const { cache, cleanup } = await freshCache()
  try {
    await cache.recordSkuDims('pdd_mms', '童装', ['身高'])
    await cache.record('pdd_mms', '童装', '材质', '棉')
    assert.equal(await cache.lookup('pdd_mms', '童装', '材质'), '棉')
    assert.equal(await cache.lookup('pdd_mms', '童装', 'dims'), null)
    assert.deepEqual(await cache.lookupSkuDims('pdd_mms', '童装'), ['身高'])
  } finally { await cleanup() }
})

test('损坏的 dims JSON 静默返回 []', async () => {
  const { cache, storePath, cleanup } = await freshCache()
  try {
    await cache.recordSkuDims('pdd_mms', '童装', ['身高'])
    await cache.recordSkuDims('pdd_mms', '童装', ['身高']) // 先落一次盘
    const raw = JSON.parse(await fs.readFile(storePath, 'utf8'))
    raw['pdd_mms:童装:sku'].dims.value = '{not-json'
    await fs.writeFile(storePath, JSON.stringify(raw), 'utf8')
    // 新实例才会重读文件
    const cache2 = createAttrCache(storePath)
    assert.deepEqual(await cache2.lookupSkuDims('pdd_mms', '童装'), [])
  } finally { await cleanup() }
})

// ── B2. 店铺级枚举缓存（运费模板/发货时间） ──────────────────

suite('B2. 店铺级枚举缓存（freight）')

test('template/delivery 独立记取', async () => {
  const { cache, cleanup } = await freshCache()
  try {
    await cache.recordFreight('pdd_mms', 'template', '全国包邮模板')
    await cache.recordFreight('pdd_mms', 'delivery', '24小时发货及揽收')
    assert.equal(await cache.lookupFreight('pdd_mms', 'template'), '全国包邮模板')
    assert.equal(await cache.lookupFreight('pdd_mms', 'delivery'), '24小时发货及揽收')
  } finally { await cleanup() }
})

test('未记录返回 null；空值不记', async () => {
  const { cache, cleanup } = await freshCache()
  try {
    assert.equal(await cache.lookupFreight('taobao', 'template'), null)
    await cache.recordFreight('taobao', 'template', '  ')
    assert.equal(await cache.lookupFreight('taobao', 'template'), null)
  } finally { await cleanup() }
})

test('店铺级键跨类目共享（类目A记录 → 类目B可查）', async () => {
  const { cache, cleanup } = await freshCache()
  try {
    await cache.recordFreight('pdd_mms', 'template', '全国包邮模板')
    await cache.recordSkuDims('pdd_mms', '童装', ['身高'])
    assert.equal(await cache.lookupFreight('pdd_mms', 'template'), '全国包邮模板')
  } finally { await cleanup() }
})

test('hits 累计（同一模板记两次 hits=2）', async () => {
  const { cache, storePath, cleanup } = await freshCache()
  try {
    await cache.recordFreight('pdd_mms', 'template', 'T1')
    await cache.recordFreight('pdd_mms', 'template', 'T1')
    const raw = JSON.parse(await fs.readFile(storePath, 'utf8'))
    assert.equal(raw['pdd_mms:freight'].template.hits, 2)
  } finally { await cleanup() }
})

test('平台隔离（pdd_mms 与 taobao 互不可见）', async () => {
  const { cache, cleanup } = await freshCache()
  try {
    await cache.recordFreight('pdd_mms', 'template', 'PDD模板')
    await cache.recordFreight('taobao', 'template', 'TB模板')
    assert.equal(await cache.lookupFreight('pdd_mms', 'template'), 'PDD模板')
    assert.equal(await cache.lookupFreight('taobao', 'template'), 'TB模板')
  } finally { await cleanup() }
})

// ── B3. schema 指纹 ────────────────────────────────────────

suite('B3. schema 指纹')

test('schemaFingerprint 顺序无关 + 空白归一', () => {
  const a = schemaFingerprint(['材质', '袖长', '容量'])
  const b = schemaFingerprint(['容量 ', '材质', '  袖 长 '])
  assert.equal(a, b)
})

test('schemaFingerprint 内容敏感（改名即变）', () => {
  const a = schemaFingerprint(['材质', '袖长'])
  const b = schemaFingerprint(['材质', '裤长'])
  assert.notEqual(a, b)
  const c = schemaFingerprint(['材质', '袖长', '容量'])
  assert.notEqual(a, c)
})

test('首次记录只记不失效（changed=false，属性桶保留）', async () => {
  const { cache, cleanup } = await freshCache()
  try {
    await cache.record('pdd_mms', '纸杯', '材质', 'PP塑料')
    const r1 = await cache.checkSchemaFingerprint('pdd_mms', '纸杯', ['材质', '容量'])
    assert.equal(r1.changed, false)
    assert.equal(await cache.lookup('pdd_mms', '纸杯', '材质'), 'PP塑料')
  } finally { await cleanup() }
})

test('指纹不变 → changed=false（属性桶保留）', async () => {
  const { cache, cleanup } = await freshCache()
  try {
    await cache.record('pdd_mms', '纸杯', '材质', 'PP塑料')
    await cache.checkSchemaFingerprint('pdd_mms', '纸杯', ['材质', '容量'])
    const r2 = await cache.checkSchemaFingerprint('pdd_mms', '纸杯', ['容量', '材质'])
    assert.equal(r2.changed, false)
    assert.equal(await cache.lookup('pdd_mms', '纸杯', '材质'), 'PP塑料')
  } finally { await cleanup() }
})

test('指纹变化 → changed=true + 属性桶失效', async () => {
  const { cache, cleanup } = await freshCache()
  try {
    await cache.record('pdd_mms', '纸杯', '材质', 'PP塑料')
    await cache.checkSchemaFingerprint('pdd_mms', '纸杯', ['材质', '容量'])
    const r = await cache.checkSchemaFingerprint('pdd_mms', '纸杯', ['材质', '容量', '新栏目'])
    assert.equal(r.changed, true)
    assert.equal(r.prev, schemaFingerprint(['材质', '容量']))
    assert.equal(await cache.lookup('pdd_mms', '纸杯', '材质'), null, '属性桶应被失效')
  } finally { await cleanup() }
})

test('属性桶为空时指纹变化不报 changed 语义外的副作用', async () => {
  const { cache, cleanup } = await freshCache()
  try {
    const r1 = await cache.checkSchemaFingerprint('pdd_mms', '纸杯', ['材质'])
    assert.equal(r1.changed, false)
    const r2 = await cache.checkSchemaFingerprint('pdd_mms', '纸杯', ['材质', '袖长'])
    assert.equal(r2.changed, true, '有旧指纹且变化 → changed=true（即使无属性桶）')
    assert.equal((await cache.snapshot())['pdd_mms:纸杯'], undefined)
  } finally { await cleanup() }
})

test('指纹失效不伤 :sku / freight 分层（只清属性桶）', async () => {
  const { cache, cleanup } = await freshCache()
  try {
    await cache.record('pdd_mms', '纸杯', '材质', 'PP塑料')
    await cache.recordSkuDims('pdd_mms', '纸杯', ['数量'])
    await cache.recordFreight('pdd_mms', 'template', '全国包邮')
    await cache.checkSchemaFingerprint('pdd_mms', '纸杯', ['材质'])
    await cache.checkSchemaFingerprint('pdd_mms', '纸杯', ['材质', '新栏'])
    assert.equal(await cache.lookup('pdd_mms', '纸杯', '材质'), null, '属性桶已失效')
    assert.deepEqual(await cache.lookupSkuDims('pdd_mms', '纸杯'), ['数量'], 'SKU 维度保留')
    assert.equal(await cache.lookupFreight('pdd_mms', 'template'), '全国包邮', 'freight 保留')
  } finally { await cleanup() }
})

test('类目隔离（A 类目改版不失效 B 类目）', async () => {
  const { cache, cleanup } = await freshCache()
  try {
    await cache.record('pdd_mms', '纸杯', '材质', 'PP塑料')
    await cache.record('pdd_mms', '童装', '袖长', '短袖')
    await cache.checkSchemaFingerprint('pdd_mms', '纸杯', ['材质'])
    await cache.checkSchemaFingerprint('pdd_mms', '纸杯', ['材质', '新栏'])
    assert.equal(await cache.lookup('pdd_mms', '童装', '袖长'), '短袖')
  } finally { await cleanup() }
})

test('新实例重读落盘文件（持久化跨实例）', async () => {
  const { cache, storePath, cleanup } = await freshCache()
  try {
    await cache.record('pdd_mms', '纸杯', '材质', 'PP塑料')
    await cache.recordSkuDims('pdd_mms', '纸杯', ['数量'])
    await cache.recordFreight('pdd_mms', 'delivery', '当日发货及揽收')
    const cache2 = createAttrCache(storePath)
    assert.equal(await cache2.lookup('pdd_mms', '纸杯', '材质'), 'PP塑料')
    assert.deepEqual(await cache2.lookupSkuDims('pdd_mms', '纸杯'), ['数量'])
    assert.equal(await cache2.lookupFreight('pdd_mms', 'delivery'), '当日发货及揽收')
  } finally { await cleanup() }
})

await runAll()
