/**
 * test-suite.mjs — 拼多多基座完整测试套件
 *
 * 覆盖：
 *   ① 模块完整性（语法 + 加载 + 导出）
 *   ② 域识别准确性
 *   ③ 种子维护逻辑
 *   ④ 节流策略
 *   ⑤ 纯 Node 接口（只读）
 *   ⑥ 降级机制
 *
 * 用法：
 *   node test-suite.mjs                # 全部
 *   node test-suite.mjs --only=1,2     # 指定
 *   node test-suite.mjs --skip=5       # 跳过
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const L = (f) => import(pathToFileURL(path.join(ROOT, 'skills/_shared', f)).href)

// ★ 账号动态取 —— 硬编码的 shopKey 早已失效（2026-11-09：pdd_mms_2b1bca… 不在了）
// ★ 2026-11-10 修：**必须选「有种子」的账号**。
//   pickPddAccount() 只按 status=valid 选，但库里可能同时存在：
//     · 空空商行  → 有种子 ✅
//     · 爱绿森 ×2 → 无种子（从没跑过 exportSeedFromBrowser）
//   选中后者会让「健康检查 / 种子读取」间歇性失败，看着像功能坏了。
//   → 这里显式挑「有种子」的那个；都没有才退回原来逻辑。
const { pickPddAccount } = await import(pathToFileURL(path.join(ROOT, 'skills/_shared/pdd-account-pick.mjs')).href)
const { CredentialStore: _CS } = await import(pathToFileURL(path.join(ROOT, 'lib/services/credential-store.js')).href)
const { readSeed: _readSeed } = await import(pathToFileURL(path.join(ROOT, 'skills/_shared/pdd-seed-store.mjs')).href)
let _acc = null
try {
  const _store = new _CS(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
  const _withSeed = _store.listAccounts()
    .filter(a => a.platform === 'pdd_mms' && a.status === 'valid' && _readSeed(a.shop_key)?.localStorage)
  if (_withSeed.length) _acc = { ..._withSeed[0], pickedReason: 'valid + 有种子' }
} catch { /* 退回动态选号 */ }
if (!_acc) _acc = await pickPddAccount()
const SHOP = _acc?.shop_key || ''
if (_acc) console.log(`使用账号: ${SHOP.slice(-12)} ${_acc.display_label || ''}  [${_acc.pickedReason || 'auto'}]`)

const argv = process.argv.slice(2)
const onlyArg = argv.find(a => a.startsWith('--only='))
const skipArg = argv.find(a => a.startsWith('--skip='))
const only = onlyArg ? onlyArg.slice(7).split(',').map(Number).filter(n => !isNaN(n)) : null
const skip = skipArg ? skipArg.slice(7).split(',').map(Number).filter(n => !isNaN(n)) : []
const run = (n) => (!only || only.includes(n)) && !skip.includes(n)

const results = []
function record(name, ok, detail = '', ms = 0) {
  results.push({ name, ok, detail, ms })
  const icon = ok ? '✅' : '❌'
  console.log(`  ${icon} ${name.padEnd(38)} ${String(ms).padStart(6)}ms  ${detail}`)
}

/* ══════════════════════════════════════════════════════════════════
 * ① 模块完整性
 * ══════════════════════════════════════════════════════════════════ */
if (run(1)) {
  console.log('\n【① 模块完整性】')
  const MODS = [
    ['pdd-api.mjs', ['api', 'API', 'PAGES', 'validateTable']],
    ['pdd-request.mjs', ['request', 'detectDomain']],
    ['pdd-seed-store.mjs', ['readSeed', 'writeSeed', 'isSeedFresh']],
    ['pdd-seed-auto.mjs', ['checkSeedHealth', 'ensureSeed', 'seedStatus', 'noteSignFailure']],
    ['pdd-guard.mjs', ['openTask', 'withPddGuard', 'guardHealth']],
    ['pdd-vodka-signer.mjs', ['sign', 'initSandbox', 'sdkReady']],
    ['pdd-promo-signer.mjs', ['signPromo', 'callPromo', 'initPromo']],
    ['pdd-transport.mjs', ['pickTier', 'needsBrowser']],
  ]
  for (const [file, exports] of MODS) {
    const t0 = Date.now()
    try {
      const m = await L(file)
      const missing = exports.filter(e => m[e] === undefined)
      record(file, missing.length === 0, missing.length ? `缺 ${missing.join(',')}` : `${exports.length} 个导出`, Date.now() - t0)
    } catch (e) {
      record(file, false, e.message.slice(0, 50), Date.now() - t0)
    }
  }
}

/* ══════════════════════════════════════════════════════════════════
 * ② 域识别
 * ══════════════════════════════════════════════════════════════════ */
if (run(2)) {
  console.log('\n【② 域识别】')
  const { detectDomain } = await L('pdd-request.mjs')
  const CASES = [
    ['/vodka/v2/mms/query/display/mall/goodsList', 'mms'],
    ['/glide/v2/mms/addProperties/goodsList', 'mms'],
    ['/sydney/api/mallFlow/getMallFlowData', 'mms'],
    ['/earth/api/mallInfo/commonMallInfo', 'mms'],
    ['/opportunity-goods/chance-goods/home_list', 'mms'],
    ['/mms-gateway/reinhardt/invoice/getAdvertiserDailyCosts', 'yingxiao'],
    ['/mms-gateway/venus/api/goods/promotion/v3/list', 'yingxiao'],
    ['/api/backbone/video/publish/page/query', 'live'],
    ['/mms/amco/prePublish/query', 'live'],
    ['/kiwi/obs/anchor/info', 'live'],
  ]
  let pass = 0
  for (const [p, exp] of CASES) {
    const got = detectDomain(p)
    if (got === exp) pass++
    else console.log(`    ❌ ${p} → ${got} (期望 ${exp})`)
  }
  record('域识别 10 例', pass === CASES.length, `${pass}/${CASES.length}`)
}

/* ══════════════════════════════════════════════════════════════════
 * ③ 种子维护
 * ══════════════════════════════════════════════════════════════════ */
if (run(3)) {
  console.log('\n【③ 种子维护】')
  const sa = await L('pdd-seed-auto.mjs')
  const seedStore = await L('pdd-seed-store.mjs')
  const { CredentialStore } = await import(pathToFileURL(path.join(ROOT, 'lib/services/credential-store.js')).href)
  const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
  const acc = store.listAccounts().find(a => String(a.shop_key) === SHOP)

  const t0 = Date.now()
  const h = sa.checkSeedHealth(SHOP, acc?.cookies || {})
  record('健康检查', !h.need, h.need ? h.reason : '健康', Date.now() - t0)

  const t1 = Date.now()
  const seed = seedStore.readSeed(SHOP)
  record('种子读取', !!seed?.localStorage, seed ? `${Object.keys(seed.localStorage).length} 项` : '无', Date.now() - t1)

  const t2 = Date.now()
  const st = sa.seedStatus(SHOP, acc?.cookies || {})
  record('状态查询', typeof st.needRefresh === 'boolean', `needRefresh=${st.needRefresh}`, Date.now() - t2)

  // 损坏检测（不真损坏，只验证函数可用）
  const t3 = Date.now()
  const h2 = sa.checkSeedHealth('NOT_EXIST_SHOP', {})
  record('缺失检测', h2.need === true, h2.reason, Date.now() - t3)
}

/* ══════════════════════════════════════════════════════════════════
 * ④ 节流策略
 * ══════════════════════════════════════════════════════════════════ */
if (run(4)) {
  console.log('\n【④ 节流策略】')
  const ab = await L('pdd-antiban.mjs')

  const t0 = Date.now()
  const CLASS_CASES = [
    ['/vodka/v2/mms/query/display/mall/goodsList', 'read'],
    ['/glide/v2/mms/addProperties/goodsList', 'read'],
    ['/vodka/v2/mms/pc/offSale', 'write'],
    ['/vodka/v2/mms/batchOnSale', 'write'],
    ['/glide/v2/mms/edit/commit/update', 'write'],
  ]
  let cp = 0
  for (const [p, exp] of CLASS_CASES) {
    if (ab.classifyEndpoint(p) === exp) cp++
    else console.log(`    ❌ ${p} → ${ab.classifyEndpoint(p)}`)
  }
  record('接口分类 5 例', cp === CLASS_CASES.length, `${cp}/${CLASS_CASES.length}`, Date.now() - t0)

  // 读接口 10 次耗时
  const t1 = Date.now()
  const TEST_SHOP = 'test_throttle_' + Date.now()
  for (let i = 0; i < 10; i++) {
    const r = await ab.reserveSlot(TEST_SHOP, '/vodka/v2/mms/query/display/mall/goodsList')
    if (r.waitMs > 0) await new Promise(s => setTimeout(s, r.waitMs))
  }
  const readMs = Date.now() - t1
  ab.clearCooldown(TEST_SHOP)
  record('读接口 10 次', readMs < 5000, `${readMs}ms (旧策略约 40000ms)`, readMs)

  // 扫描检测
  const t2 = Date.now()
  const SCAN_SHOP = 'test_scan_' + Date.now()
  let triggered = false
  for (let i = 1; i <= 15; i++) {
    const r = await ab.reserveSlot(SCAN_SHOP, `/test/ep/${i}`)
    if (r.cooling) { triggered = true; break }
    if (r.waitMs > 0) await new Promise(s => setTimeout(s, Math.min(r.waitMs, 30)))
  }
  ab.clearCooldown(SCAN_SHOP)
  record('扫描检测触发', triggered, triggered ? '第 13 个左右触发' : '未触发', Date.now() - t2)
}

/* ══════════════════════════════════════════════════════════════════
 * ⑤ 纯 Node 接口
 * ══════════════════════════════════════════════════════════════════ */
if (run(5)) {
  console.log('\n【⑤ 纯 Node 接口】')
  const { request } = await L('pdd-request.mjs')
  const seedStore = await L('pdd-seed-store.mjs')
  const { CredentialStore } = await import(pathToFileURL(path.join(ROOT, 'lib/services/credential-store.js')).href)
  const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
  // ★ 账号动态取：硬编码的 shopKey 早已失效（2026-11-09 实测）
  const acc = store.listAccounts().find(a => a.platform === 'pdd_mms' && a.status === 'valid')
    || store.listAccounts().find(a => a.platform === 'pdd_mms')
  if (!acc) { console.log('⑤ 跳过：凭证库无 pdd_mms 账号'); }
  const account = acc
    ? { cookies: acc.cookies, localStorage: seedStore.readSeed(acc.shop_key)?.localStorage || {} }
    : { cookies: {}, localStorage: {} }

  const CASES = [
    ['/glide/v2/mms/addProperties/goodsList', { page_num: 1, page_size: 3, only_query_no_props_goods: false, only_query_un_auth_brand: false }, '商品列表'],
    ['/vodka/v2/mms/query/sku/info', { goodsId: 1025317086069 }, 'SKU 详情'],
    ['/vodka/v2/mms/query/display/mall_goods/count', {}, '商品数'],
    ['/vodka/v2/mms/common/query/status', {}, '通用状态'],
    ['/earth/api/mallInfo/commonMallInfo', {}, '店铺信息', 'GET'],
  ]
  let ok = 0
  for (const [p, b, label, method] of CASES) {
    const t0 = Date.now()
    try {
      const r = await request(p, b, { account, shopKey: SHOP, method: method || 'POST' })
      if (r.ok) ok++
      record(label, r.ok, r.ok ? `channel=${r.channel}${r.data?.total !== undefined ? ' total=' + r.data.total : ''}` : `ec=${r.ec}`, Date.now() - t0)
    } catch (e) {
      record(label, false, e.message.slice(0, 40), Date.now() - t0)
    }
    await new Promise(s => setTimeout(s, 2500))
  }
}

/* ══════════════════════════════════════════════════════════════════
 * ⑥ 降级机制（逻辑验证，不发真实请求）
 * ══════════════════════════════════════════════════════════════════ */
if (run(6)) {
  console.log('\n【⑥ 降级机制】')
  const { request } = await L('pdd-request.mjs')
  const t0 = Date.now()
  // 无 account 无 page → 应返回 no_channel
  const r = await request('/vodka/v2/mms/common/query/status', {}, {})
  record('无通道时报错', r.ec === 'no_channel', `ec=${r.ec}`, Date.now() - t0)
}

/* ══════════════════════════════════════════════════════════════════
 * 汇总
 * ══════════════════════════════════════════════════════════════════ */
const pass = results.filter(r => r.ok).length
const fail = results.length - pass
console.log('\n' + '='.repeat(78))
console.log(`总计: ${results.length} 项 | ✅ ${pass} 通过 | ${fail > 0 ? '❌ ' + fail + ' 失败' : '0 失败'}`)
if (fail > 0) {
  console.log('\n失败项:')
  results.filter(r => !r.ok).forEach(r => console.log(`  ❌ ${r.name}: ${r.detail}`))
}
console.log('='.repeat(78))

fs.writeFileSync(path.join(ROOT, 'skills/_shared/.test-result.json'), JSON.stringify({
  at: new Date().toISOString(), total: results.length, pass, fail, results,
}, null, 1), 'utf8')

await new Promise(r => setTimeout(r, 200))
process.exit(fail > 0 ? 1 : 0)
