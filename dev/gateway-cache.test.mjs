/**
 * 网关响应缓存回归测试。
 *
 * 重点验证**安全边界**（缓存错数据的代价远高于少缓一次）：
 *   1. 写操作绝不进缓存（http_post / 写语义 URL / MTOP 写接口名）
 *   2. 失败响应绝不进缓存（风控 / 登录失效 / 限流 / 非 2xx / 空 payload）
 *   3. 缓存键正确性：凭证变化即换键（防串号）、易变参数被剔除（否则永不命中）
 *   4. TTL 与 LRU 行为
 *   5. 按账号失效与风控验证后失效
 *
 * 运行：node dev/gateway-cache.test.mjs
 */
import assert from 'node:assert/strict'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const LIB = path.resolve(import.meta.dirname, '..', 'lib')
const gc = await import(pathToFileURL(path.join(LIB, 'services', 'gateway-cache.js')).href)

// ── 极简 runner ─────────────────────────────────────────────

const CASES = []
let currentSuite = ''
function suite(name) { currentSuite = name }
function test(name, fn) { CASES.push({ suite: currentSuite, name, fn }) }

async function runAll() {
  let pass = 0
  const failures = []
  for (const c of CASES) {
    try {
      gc.resetCacheConfigCache()
      delete process.env.DSAGENT_GATEWAY_CACHE
      delete process.env.DSAGENT_GATEWAY_CACHE_TTL
      delete process.env.DSAGENT_GATEWAY_CACHE_MAX
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
    console.log('网关缓存回归测试全部通过。')
  }
}

// ── 1. 写操作绝不缓存（最重要）───────────────────────────────

suite('1. 写操作排除（安全边界）')

test('http_post 一律不可缓存（发布/提交类走 POST）', () => {
  const r = gc.isCacheableRequest('http_post', 'https://example.com/api/list')
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'post_method')
})

test('http_get / mtop_jsonp 的普通读接口可缓存', () => {
  assert.equal(gc.isCacheableRequest('http_get', 'https://example.com/api/list').ok, true)
  assert.equal(gc.isCacheableRequest('mtop_jsonp', 'https://h5api.m.taobao.com/h5/mtop.shop.data.get/1.0/').ok, true)
})

test('未知 kind 不可缓存（保守拒绝）', () => {
  const r = gc.isCacheableRequest('http_put', 'https://example.com/x')
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'unsupported_kind')
})

test('写语义 URL 即使走 GET 也拒绝缓存（纵深防御）', () => {
  const writes = [
    'https://example.com/item/publish',
    'https://example.com/api/create',
    'https://example.com/api/update',
    'https://example.com/api/delete',
    'https://example.com/api/submit',
    'https://example.com/api/save',
    'https://example.com/api/upload',
    'https://example.com/api/confirm',
    'https://example.com/api/pay',
    'https://example.com/api/cancel',
    'https://api.example.com/?method=addItem',
  ]
  for (const u of writes) {
    const r = gc.isCacheableRequest('http_get', u)
    assert.equal(r.ok, false, `应拒绝缓存: ${u}`)
    assert.equal(r.reason, 'write_url')
  }
})

test('MTOP 写操作接口名被拒绝（如 mtop.item.add）', () => {
  const r = gc.isCacheableRequest('mtop_jsonp', 'https://h5api.m.taobao.com/h5/mtop.item.add/1.0/')
  assert.equal(r.ok, false, 'MTOP 写接口不应缓存')
})

test('MTOP 读操作接口名正常放行（如 mtop.shop.data.get）', () => {
  for (const u of ['mtop.shop.data.get', 'mtop.item.detail', 'mtop.sycm.overview']) {
    const r = gc.isCacheableRequest('mtop_jsonp', `https://h5api.m.taobao.com/h5/${u}/1.0/`)
    assert.equal(r.ok, true, `应可缓存: ${u}`)
  }
})

// ── 2. 失败响应绝不缓存 ─────────────────────────────────────

suite('2. 失败响应排除')

test('风控响应绝不缓存（否则故障持续整个 TTL）', () => {
  const r = gc.isCacheableResponse({
    status: 'error',
    failure_kind: 'risk_control',
    status_code: 200,
    payload: { ret: ['RGV587_ERROR::SM'] },
  })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'failure:risk_control')
})

test('登录失效响应绝不缓存（用户重登后不该读到旧失败）', () => {
  for (const kind of ['token_expired', 'not_bound', 'no_permission', 'rate_limit', 'api_error']) {
    const r = gc.isCacheableResponse({ status: 'error', failure_kind: kind, status_code: 200, payload: {} })
    assert.equal(r.ok, false, `${kind} 不应缓存`)
  }
})

test('status 非 success 不缓存', () => {
  const r = gc.isCacheableResponse({ status: 'error', status_code: 200, payload: { a: 1 } })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'not_success')
})

test('HTTP 非 2xx 不缓存（即使 failure_kind 为空）', () => {
  for (const code of [301, 404, 500, 503]) {
    const r = gc.isCacheableResponse({ status: 'success', status_code: code, payload: { a: 1 } })
    assert.equal(r.ok, false, `HTTP ${code} 不应缓存`)
  }
})

test('空 payload 不缓存（避免把临时空结果固化）', () => {
  assert.equal(gc.isCacheableResponse({ status: 'success', status_code: 200, payload: null }).ok, false)
  assert.equal(gc.isCacheableResponse({ status: 'success', status_code: 200, payload: undefined }).ok, false)
})

test('正常成功响应可缓存', () => {
  const r = gc.isCacheableResponse({
    status: 'success',
    failure_kind: '',
    status_code: 200,
    payload: { ret: ['SUCCESS::调用成功'], data: { rows: [] } },
  })
  assert.equal(r.ok, true)
})

// ── 3. 缓存键正确性 ─────────────────────────────────────────

suite('3. 缓存键')

const baseKey = (over = {}) => gc.buildCacheKey({
  kind: 'mtop_jsonp',
  platform: 'taobao',
  shopKey: 'taobao_111',
  url: 'https://h5api.m.taobao.com/h5/mtop.x.y/1.0/',
  params: { page: '1', data: '{"a":1}' },
  credentialFingerprint: 'fp1',
  ...over,
})

test('易变参数被剔除：t / callback / sign 不影响键（否则永不命中）', () => {
  const k1 = baseKey({ params: { page: '1', t: '1700000000001', callback: 'mtopjsonp111', sign: 'aaa', _tb_token_: 'tok1' } })
  const k2 = baseKey({ params: { page: '1', t: '1700000000999', callback: 'mtopjsonp222', sign: 'bbb', _tb_token_: 'tok2' } })
  assert.equal(k1, k2, 't/callback/sign/_tb_token_ 变化不应改变键')
})

test('业务参数变化必须改变键（分页/筛选不能串数据）', () => {
  const k1 = baseKey({ params: { page: '1' } })
  const k2 = baseKey({ params: { page: '2' } })
  assert.notEqual(k1, k2, '分页不同必须换键')
})

test('凭证指纹变化必须改变键（防跨账号串数据）', () => {
  const k1 = baseKey({ credentialFingerprint: 'fpA' })
  const k2 = baseKey({ credentialFingerprint: 'fpB' })
  assert.notEqual(k1, k2, '凭证变化必须换键')
})

test('shopKey / platform / url 变化必须改变键', () => {
  assert.notEqual(baseKey(), baseKey({ shopKey: 'taobao_222' }))
  assert.notEqual(baseKey(), baseKey({ platform: 'xianyu' }))
  assert.notEqual(baseKey(), baseKey({ url: 'https://other.example.com/x' }))
})

test('凭证指纹：相同凭证得同键，tb_token 变化得不同键', () => {
  const a = gc.credentialFingerprint('unb=1; cookie2=x', 'tokA')
  const b = gc.credentialFingerprint('unb=1; cookie2=x', 'tokA')
  const c = gc.credentialFingerprint('unb=1; cookie2=x', 'tokB')
  assert.equal(a, b)
  assert.notEqual(a, c, 'tb_token 变化应改变指纹（它可能被单独刷新）')
  // 指纹不应泄露原文
  assert.ok(!a.includes('unb'), '指纹不能含 Cookie 原文')
  assert.ok(!a.includes('tokA'), '指纹不能含 token 原文')
})

test('参数顺序不影响键（避免同一请求因顺序不同而重复缓存）', () => {
  const k1 = gc.buildCacheKey({
    kind: 'http_get', platform: 'p', shopKey: 's', url: 'u',
    params: { a: '1', b: '2' }, credentialFingerprint: 'f',
  })
  const k2 = gc.buildCacheKey({
    kind: 'http_get', platform: 'p', shopKey: 's', url: 'u',
    params: { b: '2', a: '1' }, credentialFingerprint: 'f',
  })
  assert.equal(k1, k2)
})

// ── 4. 读写、TTL、LRU ───────────────────────────────────────

suite('4. 读写与淘汰')

test('写入后能命中，且响应结构与原响应同构（多出 cache_hit 标记）', () => {
  gc.resetCacheConfigCache()
  const key = 'k1'
  const resp = { status: 'success', status_code: 200, payload: { data: { n: 1 } }, failure_kind: '', error_message: '' }
  gc.setCached(key, resp, resp.payload)
  const got = gc.getCached(key)
  assert.ok(got, '应命中')
  assert.equal(got.status, 'success')
  assert.equal(got.status_code, 200)
  assert.deepEqual(got.payload, { data: { n: 1 } })
  assert.equal(got.cache_hit, true, '应标记命中')
  assert.equal(typeof got.cache_age_ms, 'number')
})

test('未写入的键未命中', () => {
  gc.resetCacheConfigCache()
  assert.equal(gc.getCached('never-stored'), null)
})

test('TTL 过期后不再命中', async () => {
  gc.resetCacheConfigCache()
  process.env.DSAGENT_GATEWAY_CACHE_TTL = '1'
  const key = 'ttl-key'
  gc.setCached(key, { status: 'success', status_code: 200 }, { v: 1 })
  assert.ok(gc.getCached(key), 'TTL 内应命中')
  await new Promise(r => setTimeout(r, 1100))
  assert.equal(gc.getCached(key), null, 'TTL 后应过期')
})

test('过大响应不缓存（记录原因）', () => {
  gc.resetCacheConfigCache()
  const huge = 'x'.repeat(300 * 1024)   // > 256KB 上限
  gc.setCached('huge', { status: 'success', status_code: 200 }, huge)
  assert.equal(gc.getCached('huge'), null, '超大响应不应缓存')
  assert.ok(gc.cacheStats().skips.too_large >= 1, '应记录 too_large 原因')
})

test('LRU 淘汰：超出容量后淘汰最旧的', () => {
  gc.resetCacheConfigCache()
  process.env.DSAGENT_GATEWAY_CACHE_MAX = '3'
  for (let i = 0; i < 5; i++) {
    gc.setCached(`k${i}`, { status: 'success', status_code: 200 }, { i })
  }
  const s = gc.cacheStats()
  assert.equal(s.entries, 3, '应保持在容量上限')
  assert.ok(s.evictions >= 2, '应有淘汰')
  assert.equal(gc.getCached('k0'), null, '最旧的应被淘汰')
  assert.ok(gc.getCached('k4'), '最新的应保留')
})

test('命中会刷新 LRU 位置（热点条目不被误淘汰）', () => {
  gc.resetCacheConfigCache()
  process.env.DSAGENT_GATEWAY_CACHE_MAX = '3'
  gc.setCached('a', { status: 'success', status_code: 200 }, { a: 1 })
  gc.setCached('b', { status: 'success', status_code: 200 }, { b: 1 })
  gc.setCached('c', { status: 'success', status_code: 200 }, { c: 1 })
  // 访问 a → 它应变成最新
  assert.ok(gc.getCached('a'))
  // 再插入 d → 淘汰的应是最旧的 b（而非刚访问过的 a）
  gc.setCached('d', { status: 'success', status_code: 200 }, { d: 1 })
  assert.ok(gc.getCached('a'), '热点条目 a 应保留')
  assert.equal(gc.getCached('b'), null, 'b 应被淘汰')
})

// ── 5. 开关、失效、统计 ─────────────────────────────────────

suite('5. 开关与失效')

test('DSAGENT_GATEWAY_CACHE=off 时关闭缓存', () => {
  process.env.DSAGENT_GATEWAY_CACHE = 'off'
  gc.resetCacheConfigCache()
  assert.equal(gc.cacheEnabled(), false)
})

test('默认启用', () => {
  gc.resetCacheConfigCache()
  assert.equal(gc.cacheEnabled(), true)
})

test('按 shopKey 失效：只清该账号的条目', () => {
  gc.resetCacheConfigCache()
  gc.setCached('k-taobao', gc.attachCacheMeta({ status: 'success', status_code: 200 }, 'taobao_111', 'taobao'), { a: 1 })
  gc.setCached('k-xianyu', gc.attachCacheMeta({ status: 'success', status_code: 200 }, 'xianyu_999', 'xianyu'), { b: 1 })

  const removed = gc.invalidateCache({ shopKey: 'taobao_111' })
  assert.equal(removed, 1, '应只清 1 条')
  assert.equal(gc.getCached('k-taobao'), null, 'taobao 条目应被清')
  assert.ok(gc.getCached('k-xianyu'), 'xianyu 条目应保留')
})

test('清空全部缓存', () => {
  gc.resetCacheConfigCache()
  gc.setCached('a', { status: 'success', status_code: 200 }, { a: 1 })
  gc.setCached('b', { status: 'success', status_code: 200 }, { b: 1 })
  assert.equal(gc.clearCache(), 2)
  assert.equal(gc.cacheStats().entries, 0)
})

test('缓存内部字段不可枚举（不会通过 JSON 泄露给技能）', () => {
  const withMeta = gc.attachCacheMeta({ status: 'success', status_code: 200 }, 'taobao_111', 'taobao')
  const json = JSON.stringify(withMeta)
  assert.ok(!json.includes('_cache_shop_key'), 'JSON 序列化不应包含内部字段')
  assert.ok(!json.includes('taobao_111'), 'JSON 序列化不应泄露 shopKey')
  // 但仍可按属性访问（供失效使用）
  assert.equal(withMeta._cache_shop_key, 'taobao_111')
})

test('stripCacheMeta 能剥掉内部字段与命中标记', () => {
  const r = gc.stripCacheMeta({ status: 'success', cache_hit: true, cache_age_ms: 5, _cache_shop_key: 'x', payload: {} })
  assert.equal(r.cache_hit, undefined)
  assert.equal(r.cache_age_ms, undefined)
  assert.equal(r._cache_shop_key, undefined)
  assert.ok(r.payload)
})

test('统计：命中率与未缓存原因可观测', () => {
  gc.resetCacheConfigCache()
  gc.setCached('s1', { status: 'success', status_code: 200 }, { v: 1 })
  assert.ok(gc.getCached('s1'))   // 命中
  gc.getCached('nope')            // 未命中
  gc.setCached('big', { status: 'success', status_code: 200 }, 'x'.repeat(300 * 1024))  // 跳过

  const s = gc.cacheStats()
  assert.equal(s.hits, 1)
  assert.equal(s.misses, 1)
  assert.equal(s.hitRate, '50.0%')
  assert.ok(s.skips.too_large >= 1)
  assert.equal(s.enabled, true)
})

// ── 执行 ────────────────────────────────────────────────────

await runAll()
