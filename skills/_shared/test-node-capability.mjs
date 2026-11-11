/**
 * test-node-capability.mjs - 逐个 skill 测「能不能纯 Node」
 *
 * 只测只读操作，不做任何写操作。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const { request } = await import(pathToFileURL(path.join(ROOT, 'skills/_shared/pdd-request.mjs')).href)
const seedStore = await import(pathToFileURL(path.join(ROOT, 'skills/_shared/pdd-seed-store.mjs')).href)
// ★ 基座统一选号：status=valid + 有种子 + 真实探测通过（不再硬编码会失效的 shopKey）
const { pickPddAccount } = await import(pathToFileURL(path.join(ROOT, 'skills/_shared/pdd-account-pick.mjs')).href)
const acc = await pickPddAccount()
if (!acc) { console.log('无有效账号'); process.exit(1) }
console.log('使用账号: ' + String(acc.shop_key).slice(-12) + ' ' + (acc.display_label || '') + '  [' + acc.pickedReason + ']')
const account = { cookies: acc.cookies, localStorage: seedStore.readSeed(acc.shop_key)?.localStorage || {} }

/**
 * 每个 skill 的核心只读接口。
 *
 * ★ 2026-11-10：不要硬编码商品 ID。
 *   之前写死 goodsId:1025317086069，但测试会按「status=valid + 有种子」动态选号，
 *   选到别的店铺就报 600018「该商品不属于本店铺」—— 看着像功能坏了，其实是测试自己错。
 *   改成 {} 占位，运行时用商品列表返回的第一个 goods_id 填。
 */
const TESTS = [
  // pdd-shop 商品
  ['pdd-shop', '商品列表', '/glide/v2/mms/addProperties/goodsList', { page_num: 1, page_size: 3, only_query_no_props_goods: false, only_query_un_auth_brand: false }],
  ['pdd-shop', 'SKU 详情', '/vodka/v2/mms/query/sku/info', { goodsId: '{{firstGoodsId}}' }],
  ['pdd-shop', '商品统计', '/vodka/v2/mms/query/display/mall_goods/count', {}],
  // pdd-works 经营
  ['pdd-works', '店铺信息', '/earth/api/mallInfo/commonMallInfo', {}, 'GET'],
  ['pdd-works', '店铺流量', '/sydney/api/mallScore/queryMallFlowData', {}],
  // pdd-chance 机会商品
  ['pdd-chance', '机会商品首页', '/opportunity-goods/chance-goods/home_list', {}],
  // pdd-promo 推广
  ['pdd-promo', '广告日消费', '/mms-gateway/reinhardt/invoice/getAdvertiserDailyCosts', {}],
  // pdd-activity 活动
  ['pdd-activity', '活动列表', '/lakemms/activityGoods/list', {}],
  // pdd-video 视频
  ['pdd-video', '待发布列表', '/mms/amco/prePublish/query', { pageSize: 10, pageNum: 1 }],
]

console.log('NODE CAPABILITY TEST')
console.log('（只读，不写）\n')

// ★ live 域票据预热：它是从常驻签名服务现取的（冷启动要 10s+），
//   不预热的话第一个 live 接口会超时/拿不到票 → 误报 40001。
try {
  const dm = await import('./pdd-signer-daemon.mjs')
  const h = await dm.daemonHealth(800).catch(() => null)
  if (h) {
    const t = Date.now()
    const d = await dm.daemonDomainCookies(acc.shop_key, ['live.pinduoduo.com']).catch(() => null)
    const ok = !!d?.['live.pinduoduo.com']?.L_PASS_ID
    console.log(`live 域票据预热: ${ok ? '✅' : '⚠ 未拿到'} ${Date.now() - t}ms\n`)
  } else {
    console.log('常驻签名服务未运行 → live 域可能走凭证库兜底\n')
  }
} catch { /* ignore */ }

const results = []
let firstGoodsId = null
for (const [skill, label, p, body, method] of TESTS) {
  const t0 = Date.now()
  let r
  // ★ 占位符：用本店真实商品 ID 替换，避免硬编码跨店失败
  let realBody = body
  if (JSON.stringify(body || {}).includes('{{firstGoodsId}}')) {
    if (!firstGoodsId) { console.log('  ⚠ 拿不到本店商品 ID，跳过 SKU 详情'); results.push({ skill, label, path: p, ok: false, ec: 'NO_GOODS', channel: 'none', ms: 0 }); continue }
    realBody = JSON.parse(JSON.stringify(body).replace('{{firstGoodsId}}', String(firstGoodsId)))
  }
  try {
    r = await request(p, realBody, { account, shopKey: acc.shop_key, method: method || 'POST' })
  } catch (e) {
    r = { ok: false, ec: 'EXC', hint: e.message.slice(0, 40), channel: 'none' }
  }
  // 商品列表成功后记住第一个 goods_id
  if (r.ok && p.includes('goodsList') && !firstGoodsId) {
    firstGoodsId = r.data?.list?.[0]?.goods_id || r.data?.result?.list?.[0]?.goods_id || null
  }
  const ms = Date.now() - t0
  const icon = r.ok ? 'OK  ' : 'FAIL'
  console.log(`${icon} ${skill.padEnd(16)} ${label.padEnd(12)} ${String(ms).padStart(6)}ms ch=${String(r.channel || '-').padEnd(8)} ec=${String(r.ec ?? 'ok').padEnd(9)} ${r.ok ? JSON.stringify(r.data).slice(0, 40) : String(r.hint || '').slice(0, 30)}`)
  results.push({ skill, label, path: p, ok: r.ok, ec: r.ec, channel: r.channel, ms })
  await new Promise(s => setTimeout(s, 2000))
}

const ok = results.filter(r => r.ok)
console.log('\n=== SUMMARY ===')
console.log(`纯 Node 可用: ${ok.length}/${results.length}`)
console.log('\n按 skill:')
const bySkill = {}
for (const r of results) {
  bySkill[r.skill] = bySkill[r.skill] || { ok: 0, total: 0 }
  bySkill[r.skill].total++
  if (r.ok) bySkill[r.skill].ok++
}
for (const [s, v] of Object.entries(bySkill)) {
  console.log(`  ${s.padEnd(18)} ${v.ok}/${v.total}  ${v.ok === v.total ? '✅ 完全可纯Node' : v.ok > 0 ? '⚠️ 部分' : '❌ 不可'}`)
}

fs.writeFileSync(path.join(ROOT, 'skills/_shared/.node-capability.json'), JSON.stringify(results, null, 1), 'utf8')
await new Promise(r => setTimeout(r, 200))
process.exit(0)
