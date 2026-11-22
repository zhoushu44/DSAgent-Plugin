#!/usr/bin/env node
/**
 * verify-invariants.mjs —— 抖音基座「不变量」回归（每次改代码必跑）
 *
 * 为什么需要：试用时踩过两个「看起来正常但实际错」的坑 ——
 *   ① 超时告警漏报（只扫当前页，漏掉不在首页的超时单）
 *   ② 超时告警误报（没过滤订单状态，把已完成单也算进去）
 * 这两个都不会抛异常、不会让技能失败，**只会悄悄给出错的数字**。
 *
 * 所以必须有断言把「不变量」钉死。本脚本检查：
 *
 *   [1] 计数一致性：平台 tabcnt/count vs 实际列表全量条数
 *   [2] 状态过滤：shipAlert 只统计 order_status=2
 *   [3] 分页完整：shipAlert 覆盖全部待发货，不是只覆盖当前页
 *   [4] 交叉验证：同一事实多来源一致
 *   [5] 假成功：接口失败时不返回 ok:true
 *
 * 用法：
 *   node skills/_shared/verify-invariants.mjs
 *   node skills/_shared/verify-invariants.mjs --account douyin_shop_xxx
 */
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PURL = (p) => pathToFileURL(p).href
const argv = process.argv.slice(2)
const argOf = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : '' }

const { loadAccount } = await import(PURL(join(HERE, 'douyin-request.mjs')))
const { openTask } = await import(PURL(join(HERE, 'douyin-guard.mjs')))

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
}

const acc = await loadAccount('douyin_shop', argOf('--account'))
if (!acc.ok) { console.error('账号加载失败：' + acc.message); process.exit(1) }
const account = acc.account
const g = await openTask('verify-invariants', account.shop_key)
const call = (api, pa = {}, opts = {}) => g.call(api, pa, { account, ...opts })

try {
  /* ═══════ [1] 计数一致性 ═══════ */
  console.log('\n── [1] 计数一致性（平台计数 vs 列表全量）──')
  const gc = await call('goods.count')
  const gl = await call('goods.list', { page: 0, pageSize: 100, tab: 'onSale' })
  const glArr = Array.isArray(gl.data) ? gl.data : (gl.data?.items || [])
  check('商品 count == list 条数', Number(gc.data?.onsale) === glArr.length,
    `count=${gc.data?.onsale} list=${glArr.length}`)

  const oc = await call('order.count')
  const sub = oc.data?.sub_tab_count_map?.all || oc.data || {}
  const statusSum = (sub.unpaid ?? 0) + (sub.stock_up ?? 0) + (sub.on_delivery ?? 0)
    + (sub.received ?? 0) + (sub.closed ?? 0)
  check('订单各状态加总 == all', statusSum === (sub.all ?? -1),
    `sum=${statusSum} all=${sub.all}`)

  // 每个状态：tabcnt vs 全量列表
  for (const tk of ['stock_up', 'on_delivery', 'received', 'unpaid']) {
    const want = Number(sub[tk] ?? 0)
    const r = await call('order.list', { page: 0, pageSize: 100, tab: tk })
    const arr = Array.isArray(r.data) ? r.data : []
    check(`订单 ${tk}: tabcnt == list`, want === arr.length, `tabcnt=${want} list=${arr.length}`)
  }

  /* ═══════ [2][3] shipAlert 正确性 ═══════ */
  console.log('\n── [2][3] shipAlert 过滤与分页 ──')
  const pend = await call('order.list', { page: 0, pageSize: 100, tab: 'stock_up' })
  const pendArr = Array.isArray(pend.data) ? pend.data : []
  const nonPending = pendArr.filter((o) => (o.order_status ?? 2) !== 2)
  check('stock_up 列表里全是 order_status=2', nonPending.length === 0,
    `非待发货 ${nonPending.length} 笔`)

  // 模拟 order.mjs 的 shipAlert 逻辑，核对条数
  const now = Date.now()
  const overdue = pendArr.filter((o) => {
    const n = Number(o.exp_ship_time)
    return Number.isFinite(n) && n > 0 && n * 1000 < now
  })
  const platformDelay = Number(sub.ship_delay ?? 0)
  // 平台 ship_delay 是「超时未发货」口径，应与我们算的一致（容差 1，可能有边界单）
  check('shipAlert 超时数 ≈ 平台 ship_delay', Math.abs(overdue.length - platformDelay) <= 1,
    `自算=${overdue.length} 平台=${platformDelay}`)

  // ★ 关键：shipAlert 必须基于 stock_up 全量，不能基于 tab=all 的前 N 条
  //   注意断言写法：前10里的待发货**少于**全量，正好证明「只查前10会漏报」，
  //   所以这里要验证的是「order.mjs 实际输出的 shipAlert.overdueCount == 全量自算值」，
  //   而不是拿前10去比全量（那样不相等才是对的，第一版断言写反了）。
  const allTop = await call('order.list', { page: 0, pageSize: 10, tab: 'all' })
  const allTopArr = Array.isArray(allTop.data) ? allTop.data : []
  const pendingInTop = allTopArr.filter((o) => o.order_status === 2).length

  // 直接跑 order.mjs --mode overview，读它真实输出的 shipAlert
  const { execFileSync } = await import('node:child_process')
  const orderScript = join(HERE, '..', 'douyin-order', 'scripts', 'order.mjs')
  let skillAlert = null
  try {
    const outRaw = execFileSync(process.execPath, [orderScript, '--mode', 'overview', '--limit', '10'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 })
    const line = outRaw.split('\n').find((l) => l.includes('__DSAGENT_RESULT__'))
    const payload = JSON.parse(line.replace('__DSAGENT_RESULT__', ''))
    skillAlert = payload.shipAlert || null
  } catch (e) {
    skillAlert = { __err: String(e?.message || e).slice(0, 100) }
  }

  if (skillAlert?.__err) {
    check('order.mjs 能跑出 shipAlert', false, skillAlert.__err)
  } else {
    const skillOverdue = skillAlert?.overdueCount ?? 0
    check('order.mjs shipAlert.overdueCount == 全量自算超时数',
      skillOverdue === overdue.length,
      `技能=${skillOverdue} 自算=${overdue.length}（前10只有${pendingInTop}笔待发货，说明全量查询是必要的）`)
    check('shipAlert 标注了数据源',
      skillAlert?.source === 'stock_up_full' || overdue.length === 0,
      `source=${skillAlert?.source ?? '(无)'}`)
  }

  /* ═══════ [4] 交叉验证 ═══════ */
  console.log('\n── [4] 交叉验证 ──')
  const sc = await call('shop.expScore')
  const tr = await call('shop.expScoreTrend')
  const scoreNow = sc.data?.grow_score_info?.grow_shop_score
  const series = tr.data?.experience_score || []
  const lastDay = series.length ? series[series.length - 1]?.score : null
  check('体验分 总览 == 趋势最后一天', scoreNow === lastDay, `${scoreNow} vs ${lastDay}`)

  const cust = await call('promo.customerId')
  const det = Array.isArray(cust.data?.detail) ? cust.data.detail[0] : cust.data?.detail
  check('千川 accountId ≠ customerId（防混用）',
    det?.accountId && det?.customerId && String(det.accountId) !== String(det.customerId),
    `accountId=${det?.accountId} customerId=${det?.customerId}`)

  /* ═══════ [5] 假成功防护 ═══════ */
  console.log('\n── [5] 假成功防护 ──')
  const { pickList } = await import(PURL(join(HERE, 'douyin-request.mjs')))
  let threw = false
  try { pickList({ ok: false, errorKind: 'risk_control', msg: 'x' }, 'items', '测试') } catch { threw = true }
  check('pickList 对失败结果抛错', threw)

  // 未知接口必须报错，不能静默返回空
  let unknownThrew = false
  try {
    const { resolve } = await import(PURL(join(HERE, 'douyin-registry.mjs')))
    resolve('goods.this_does_not_exist')
  } catch { unknownThrew = true }
  check('未知接口抛错（不静默）', unknownThrew)
} finally {
  await g.close().catch(() => { })
}

const pass = results.filter((r) => r.pass).length
console.log(`\n══════════ ${pass}/${results.length} 通过 ══════════`)
if (pass < results.length) {
  console.log('失败项：')
  results.filter((r) => !r.pass).forEach((r) => console.log(`  ❌ ${r.name}  ${r.detail}`))
  process.exit(1)
}
process.exit(0)
