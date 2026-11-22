/**
 * test-edit/index.mjs — 编辑能力逐项测试
 *
 * 测试对象：之前发布的测试商品
 * 每个测试独立运行、独立判定，一项失败不影响其他项。
 *
 * 用法:
 *   node test-edit/index.mjs --list                    列出测试商品
 *   node test-edit/index.mjs --probe <goodsId>         只读：拉取商品完整数据（不改）
 *   node test-edit/index.mjs --test stock <goodsId>    测改库存
 *   node test-edit/index.mjs --test price <goodsId>    测改价格
 *   node test-edit/index.mjs --test title <goodsId>    测改标题
 *   node test-edit/index.mjs --test itemNo <goodsId>   测改编码
 *   node test-edit/index.mjs --test image <goodsId>    测换主图（页面）
 *   node test-edit/index.mjs --all <goodsId>           依次跑全部
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..')
const SHARED = path.join(PLUGIN, 'skills', '_shared')
const load = f => import(pathToFileURL(path.join(SHARED, f)).href)

const { request, invalidateStoreCookieCache } = await load('pdd-request.mjs')
const { CredentialStore } = await import(pathToFileURL(path.join(PLUGIN, 'lib/services/credential-store.js')).href)

const emit = (o) => { console.log('\n' + JSON.stringify(o, null, 2)); process.exit(o.ok ? 0 : 1) }
const argOf = (n, d = '') => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d }
const has = (n) => process.argv.includes('--' + n)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log('[T]', ...a)

// ── 账号 ──
const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
const all = store.listAccounts().filter(x => x.platform === 'pdd_mms')
const ckOf = x => { const v = x.cookies; if (!v) return 0; if (typeof v === 'object') return Object.keys(v).length; if (typeof v === 'string') return v.split(';').filter(Boolean).length; return 0 }
const acc = all.filter(x => ckOf(x) > 0 && x.status !== 'reauth_required')[0]
if (!acc) emit({ ok: false, text: '没有可用账号' })
invalidateStoreCookieCache(acc.shop_key)
log('账号:', acc.display_label, acc.shop_key)

// ── 测试商品（之前发布的）──
const TEST_GOODS = [
  { id: '1028374071813', name: '纸杯（最新，含详情图）', catId: 16675 },
  { id: '1027998749178', name: '纸杯（1维容量）', catId: 16675 },
  { id: '1028059700489', name: '女装T恤（2维 3色×4码）', catId: 8463 },
  { id: '1028252715395', name: '休闲裤', catId: 8475 },
]

// ── 拉商品完整数据（只读）──
async function fetchGoods(goodsId) {
  const r = await request(`/glide/v2/mms/query/commit/on_shop/detail?goods_id=${goodsId}`, {}, {
    method: 'GET', account: acc, shopKey: acc.shop_key,
  })
  return r
}

// ══ 测试 1：拉取商品数据（只读，验证接口通不通）══
async function probe(goodsId) {
  log(`\n=== 探测商品 ${goodsId} ===`)
  const r = await fetchGoods(goodsId)
  if (!r.ok) {
    log('❌ 拉取失败:', r.ec, r.error_msg || '')
    return { ok: false, step: 'fetch', ec: r.ec, msg: r.error_msg }
  }
  const d = r.data?.result || r.data || {}
  const keys = Object.keys(d)
  log('✅ 拉取成功，字段数:', keys.length)
  log('主要字段:', keys.slice(0, 30).join(', '))

  // 关键业务字段
  const info = {
    goods_id: d.goods_id || d.id,
    goods_name: d.goods_name,
    carousel_gallery: (d.carousel_gallery || []).length,
    detail_gallery: (d.detail_gallery || []).length,
    sku_count: (d.sku || d.skus || []).length,
    market_price: d.market_price,
  }
  log('关键字段:', JSON.stringify(info))
  return { ok: true, fieldCount: keys.length, info, raw: d }
}

// ══ 测试 2：改库存（batchStock 专用接口）══
async function testStock(goodsId, newStock = 200) {
  log(`\n=== 测试改库存 → ${newStock} ===`)
  // 先读当前 SKU
  const skuR = await request(`/vodka/v2/mms/query/sku/info?goods_id=${goodsId}`, {}, {
    method: 'GET', account: acc, shopKey: acc.shop_key,
  })
  if (!skuR.ok) { log('❌ 读 SKU 失败:', skuR.ec, skuR.error_msg || ''); return { ok: false, step: 'readSku', ec: skuR.ec } }
  const skus = skuR.data?.result?.sku_list || skuR.data?.result?.skus || []
  log('当前 SKU 数:', skus.length)
  if (!skus.length) return { ok: false, step: 'readSku', msg: 'SKU 为空' }

  const before = skus.map(s => ({ id: s.sku_id || s.id, q: s.quantity || s.stock }))
  log('改前库存:', JSON.stringify(before.slice(0, 3)))

  // batchIncrease 的 body 格式
  const body = {
    goods_id: Number(goodsId),
    sku_list: skus.map(s => ({ sku_id: s.sku_id || s.id, quantity: newStock })),
  }
  const r = await request('/vodka/v2/mms/edit/quantity/batchIncrease', body, {
    method: 'POST', account: acc, shopKey: acc.shop_key,
  })
  log('改库存结果:', r.ok ? '✅' : '❌', r.ec || '', r.error_msg || '')

  // 回读验证
  if (r.ok) {
    await sleep(2000)
    const after = await request(`/vodka/v2/mms/query/sku/info?goods_id=${goodsId}`, {}, {
      method: 'GET', account: acc, shopKey: acc.shop_key,
    })
    const skus2 = after.data?.result?.sku_list || after.data?.result?.skus || []
    const afterQ = skus2.map(s => s.quantity || s.stock)
    log('改后库存:', JSON.stringify(afterQ.slice(0, 3)))
    const ok = afterQ.some(q => Number(q) === Number(newStock))
    log(ok ? '✅ 回读一致' : '⚠ 回读不一致')
    return { ok: r.ok, changed: ok, before: before.slice(0, 3), after: afterQ.slice(0, 3) }
  }
  return { ok: false, step: 'batchStock', ec: r.ec, msg: r.error_msg, body }
}

// ══ 测试 3：改价格（走 commitEdit）══
async function testPrice(goodsId, newPrice = 15.8) {
  log(`\n=== 测试改价格 → ${newPrice} ===`)
  const r = await fetchGoods(goodsId)
  if (!r.ok) return { ok: false, step: 'fetch', ec: r.ec }
  const d = r.data?.result || r.data || {}
  const skus = d.sku || d.skus || []
  log('SKU 数:', skus.length)
  if (!skus.length) return { ok: false, step: 'fetch', msg: 'SKU 为空' }

  // 改 SKU 价格字段
  const before = skus.map(s => s.group_price || s.price)
  log('改前价格:', JSON.stringify(before.slice(0, 3)))
  for (const s of skus) {
    s.group_price = Number(newPrice) * 100   // 分
    s.price = Number(newPrice) * 100 + 100
  }

  const body = { ...d, sku: skus }
  const er = await request('/glide/mms/goodsCommit/action/edit', body, {
    method: 'POST', account: acc, shopKey: acc.shop_key,
  })
  log('改价格结果:', er.ok ? '✅' : '❌', er.ec || '', er.error_msg || '')
  return { ok: er.ok, ec: er.ec, msg: er.error_msg, before: before.slice(0, 3) }
}

// ══ 主流程 ══
const mode = has('list') ? 'list'
  : has('probe') ? 'probe'
    : has('test') ? 'test'
      : has('all') ? 'all' : 'list'

if (mode === 'list') {
  log('测试商品清单:')
  for (const g of TEST_GOODS) log(`  ${g.id}  ${g.name}  (catId=${g.catId})`)
  emit({ ok: true, goods: TEST_GOODS })
}

const goodsId = argOf('probe') || argOf('all') || process.argv[process.argv.indexOf('--test') + 2]

if (mode === 'probe') {
  const r = await probe(goodsId)
  emit(r)
}

if (mode === 'test') {
  const what = argOf('test')
  let r
  switch (what) {
    case 'stock': r = await testStock(goodsId); break
    case 'price': r = await testPrice(goodsId); break
    default: r = { ok: false, msg: `未知测试项: ${what}` }
  }
  emit(r)
}

if (mode === 'all') {
  const results = []
  for (const [name, fn] of [['probe', probe], ['stock', testStock], ['price', testPrice]]) {
    try {
      const r = await fn(goodsId)
      results.push({ test: name, ...r })
    } catch (e) {
      results.push({ test: name, ok: false, error: String(e.message).slice(0, 150) })
    }
    await sleep(3000)
  }
  emit({ ok: results.every(r => r.ok), results })
}
