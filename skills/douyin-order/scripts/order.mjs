#!/usr/bin/env node
/**
 * 抖音小店·订单查询（douyin-order）—— 只读
 *
 * ══════════════════════════════════════════════════════════════════
 * 2026-11-11 改造：从「开页面 + 拦响应」改为「纯 Node 直连」
 * ══════════════════════════════════════════════════════════════════
 * 改造前：goto 订单页 + sleep(12000) + CDP hook 响应   → 约 12~15s/次
 * 改造后：基座 request() 纯 Node 直连                 → 约 200~450ms/次
 *
 * 依据：_douyin_node_probe/REPORT.md
 *   · 抖店只读接口**不校验 a_bogus**（带签名反而 10001010A 环境风险）
 *   · 3 轮稳定复现；8/8 接口纯 Node 通过
 *
 * 本次只换了「取数层」，解析逻辑（字段口径 / tabcnt 嵌套结构 / 金额分转元）
 * 原样保留 —— 那些是踩过坑验证过的，不动。
 *
 * 能力：
 *   overview   订单总览（各状态计数 + 前 N 笔）
 *   list       订单列表（按状态筛选）
 *   detail     未实现（单笔详情接口未探测确认）
 */
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = process.env.DSAGENT_PLUGIN_ROOT || join(HERE, '..', '..', '..')
const PURL = (p) => pathToFileURL(p).href

// ── 参数解析 ──────────────────────────────────────────────
function parseArgs(argv) {
  const out = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = 'true'
    else { out[key] = next; i++ }
  }
  return out
}
const ARGS = parseArgs(process.argv)

const MODE = (ARGS.mode || 'overview').trim()
const PRODUCT_ID = (ARGS['product-id'] || ARGS.productId || '').trim()
const LIMIT = Math.min(100, Math.max(1, parseInt(ARGS.limit || '20', 10) || 20))
const STATUS = (ARGS.status || ARGS.tab || '').trim()
const ACCOUNT = (ARGS.account || '').trim()

// 必须是**单行** JSON：宿主按行读取 __DSAGENT_RESULT__ 协议
function emit(payload) {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n')
}
function fail(kind, message, extra = {}) {
  emit({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })
  process.exit(1)
}
const log = (msg) => console.error('[douyin-order] ' + msg)

// ── 基座 ──────────────────────────────────────────────────
const { request, loadAccount, pickList } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-request.mjs')))
const { withDouyinGuard } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-guard.mjs')))
const { PAGES } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-registry.mjs')))

// ── 账号选择（多账号必须显式指定，绝不静默取第一个）─────────
const accRes = await loadAccount('douyin_shop', ACCOUNT)
if (!accRes.ok) {
  if (accRes.errorKind === 'need_account_choice') {
    fail('need_account_choice', accRes.message, {
      accounts: accRes.accounts.map((a) => ({ shop_key: a.shop_key, nickname: a.nickname })),
    })
  }
  if (accRes.errorKind === 'not_bound') {
    fail('not_bound', '未找到抖音小店账号。请到「账号连接」页面添加「抖店」账号（platform=douyin_shop，需有抖店商家权限）。')
  }
  fail('api_error', accRes.message)
}
const account = accRes.account

// ── 参数前置校验（避免白跑请求）───────────────────────────
if (MODE === 'detail') {
  fail('api_error',
    'mode=detail 尚未实现：单笔订单详情接口未在探测中确认'
    + '（需打开 /ffa/morder/order/detail-v2 页面单独抓包）。当前可用：overview / list。',
    { mode: MODE, available: ['overview', 'list'] })
}
if (!['overview', 'list'].includes(MODE)) {
  fail('api_error', `未知或未实现的 mode：${MODE}。当前可用：overview / list`, { mode: MODE })
}

// 状态映射：技能对外用 all/topay/stock_up/on_delivery/received，
// 接口 tab 参数直接用同名（实测 tabcnt 与该表一致）
const TAB = (STATUS && STATUS !== 'all') ? STATUS : 'all'

// ══════════════════════════════════════════════════════════════
// 取数：纯 Node
// ══════════════════════════════════════════════════════════════
let cntRes = null
let listRes = null
let pendingRes = null   // ★ 单独的待发货全量（用于超时告警，不受分页限制）

const task = await withDouyinGuard('douyin-order', account.shop_key, async (g) => {
  cntRes = await g.call('order.count', { tab: TAB }, { account })
  if (!cntRes.ok) {
    fail(cntRes.errorKind === 'session' ? 'token_expired' : 'api_error',
      `订单计数接口失败（${cntRes.errorKind}）：${cntRes.msg || cntRes.message || ''}`
      + (cntRes.hint ? `\n提示：${cntRes.hint}` : ''),
      { st: cntRes.st, code: cntRes.code, url: cntRes.url })
  }
  listRes = await g.call('order.list', { page: 0, pageSize: LIMIT, tab: TAB }, { account })
  if (!listRes.ok) {
    fail(listRes.errorKind === 'session' ? 'token_expired' : 'api_error',
      `订单列表接口失败（${listRes.errorKind}）：${listRes.msg || listRes.message || ''}`
      + (listRes.hint ? `\n提示：${listRes.hint}` : ''),
      { st: listRes.st, code: listRes.code, url: listRes.url })
  }

  // ★ 2026-11-11 修 bug：超时告警不能只看当前页！
  //   实测：tab=all 前 10 条里只有 2 笔待发货，但平台说 stock_up=3，
  //   漏掉的那笔已超时 106 天。单独查 stock_up 才能拿全。
  //   仅 overview 模式需要（list 模式用户自己选了状态）。
  if (MODE === 'overview') {
    pendingRes = await g.call('order.list', { page: 0, pageSize: 100, tab: 'stock_up' }, { account })
  }
})

// ── 解析（口径与改造前完全一致，勿改）────────────────────────
const oCnt = cntRes?.data || null
const oListRaw = listRes?.data
const oArr = Array.isArray(oListRaw) ? oListRaw
  : Array.isArray(oListRaw?.list) ? oListRaw.list
  : Array.isArray(oListRaw?.orders) ? oListRaw.orders : []

// 金额一律「分 → 元」
const yuan = (v) => (v == null || v === '') ? null : (Number(v) / 100)
const ts = (v) => { const n = Number(v); return n > 0 ? new Date(n * 1000).toLocaleString('zh-CN') : null }

/**
 * ★ 发货超时判定（2026-11-11 试用发现：原来只显示「最晚发货」时间，
 *   不判断是否已超时，用户看不出来。实测有 3 笔待发货里 2 笔已超时多日。）
 * @returns {{level:'overdue'|'today'|'ok'|null, hoursLeft:number|null, text:string}}
 */
const shipDeadline = (expShipSec) => {
  const n = Number(expShipSec)
  if (!Number.isFinite(n) || n <= 0) return { level: null, hoursLeft: null, text: '' }
  const deadline = n * 1000
  const now = Date.now()
  const diffH = (deadline - now) / 3600e3

  if (diffH < 0) {
    const overdueH = Math.abs(diffH)
    const days = Math.floor(overdueH / 24)
    const hours = Math.round(overdueH % 24)
    const dur = days > 0 ? `${days} 天${hours > 0 ? ` ${hours} 小时` : ''}` : `${Math.round(overdueH)} 小时`
    return { level: 'overdue', hoursLeft: diffH, text: `⚠️ 已超时 ${dur}` }
  }
  if (diffH <= 24) {
    return { level: 'today', hoursLeft: diffH, text: `⏰ 还剩 ${Math.round(diffH)} 小时` }
  }
  return { level: 'ok', hoursLeft: diffH, text: `还剩 ${Math.floor(diffH / 24)} 天` }
}

// 抖店 order_status 实测枚举（2026-10 在该店样本验证）
// ⚠️ 只有 2 和 4 被真实样本证实；其余按抖店通用语义预留，未验证。
const STATUS_DESC = {
  1: '待支付', 2: '待发货', 3: '已发货', 4: '已完成',
  5: '已关闭', 6: '已取消', 7: '售后中',
}

const orderItems = oArr.slice(0, LIMIT).map((o) => {
  const ri = o.receiver_info || null
  const addr = ri?.post_addr || null
  return {
    id: o.shop_order_id ?? o.order_id ?? null,
    status: o.order_status ?? null,
    statusDesc: STATUS_DESC[o.order_status] ?? `status=${o.order_status ?? '?'}`,
    productCount: o.product_count ?? null,
    payAmount: yuan(o.pay_amount),              // 元
    actualPayAmount: yuan(o.actual_pay_amount), // 元
    receiveAmount: yuan(o.actual_receive_amount_int), // 商家实收（元）
    payTypeDesc: o.pay_type_desc ?? null,
    createTime: ts(o.create_time),
    payTime: ts(o.pay_time),
    expShipTime: ts(o.exp_ship_time),
    shipDeadline: shipDeadline(o.exp_ship_time),   // ★ 发货倒计时/超时判定
    logisticsTime: ts(o.logistics_time),
    receiptTime: ts(o.receipt_time),
    buyerNickname: o.user_nickname ?? null,
    receiver: ri?.post_receiver ?? null,        // 已脱敏（如「牛*」）
    receiverTel: ri?.post_tel ?? null,          // 已脱敏
    province: addr?.province?.name ?? null,
    city: addr?.city?.name ?? null,
    town: addr?.town?.name ?? null,
    addressDetail: addr?.detail ?? null,        // 平台已打码
    waitShipCount: o.wait_ship_count ?? 0,
    shippedCount: o.shipped_count ?? 0,
    remark: o.remark ?? o.buyer_words ?? '',
  }
})

const out = { ok: true, mode: MODE, shopKey: account.shop_key, items: [] }
const lines = []

if (MODE === 'overview' || MODE === 'list') {
  // tabcnt 是嵌套结构：sub_tab_count_map.all 底下才是「全部」维度的各状态计数。
  // 顶层 received:0 是「已发货未签收」中间态，不是「已完成」——直接读顶层会误判（实测踩坑）。
  const subAll = oCnt?.sub_tab_count_map?.all || null
  const cnt = subAll || oCnt || null
  out.counts = cnt ? {
    // 「全部」维度
    all: cnt.all ?? oCnt?.all ?? null,
    unpaid: cnt.unpaid ?? null,          // 待支付
    stockUp: cnt.stock_up ?? null,       // 待发货
    expShip: cnt.exp_ship ?? null,       // 即将超时发货
    shipDelay: cnt.ship_delay ?? null,   // 发货延迟
    onDelivery: cnt.on_delivery ?? null, // 已发货
    received: cnt.received ?? null,      // 已完成（已签收）
    closed: cnt.closed ?? null,          // 已关闭
    outOfStock: cnt.out_of_stock ?? null,// 缺货
    // 售后相关
    inAftersale: oCnt?.in_aftersale ?? null,
    haveAftersale: cnt.have_aftersale ?? null,
    handling: cnt.handling ?? null,
  } : null
  out.status = STATUS || 'all'
  out.items = orderItems
  out.total = orderItems.length

    // ★ 发货超时汇总（2026-11-11 修 bug）
    // ⚠️ 两个坑都踩过：
    //   ① 忘了过滤 order_status=2 → 把已完成历史单也算成待发货超时（误报 10 笔）
    //   ② 只看当前页 → 漏掉不在首页的超时单（实测漏 1 笔超时 106 天，占 33%）
    //   所以：必须用**单独的 stock_up 全量列表**（pendingRes），不是 orderItems。
    const pendingRaw = Array.isArray(pendingRes?.data) ? pendingRes.data
      : (pendingRes?.data?.list || pendingRes?.data?.orders || [])
    const pendingAll = pendingRaw
      .filter((o) => (o.order_status ?? 2) === 2)
      .map((o) => ({
        id: o.shop_order_id ?? o.order_id ?? null,
        createTime: ts(o.create_time),
        expShipTime: ts(o.exp_ship_time),
        deadline: shipDeadline(o.exp_ship_time),
        amount: yuan(o.pay_amount),
      }))

    const overdueList = pendingAll.filter((o) => o.deadline.level === 'overdue')
    const dueSoon = pendingAll.filter((o) => o.deadline.level === 'today')

    if (overdueList.length || dueSoon.length) {
      // ★ 排序：超时最久的排最前
      overdueList.sort((a, b) => (a.deadline.hoursLeft ?? 0) - (b.deadline.hoursLeft ?? 0))
      out.shipAlert = {
        source: 'stock_up_full',            // 说明数据来源，便于排查
        pendingTotal: pendingAll.length,
        overdueCount: overdueList.length,
        dueWithin24h: dueSoon.length,
        overdueOrders: overdueList.map((o) => ({
          id: o.id, createTime: o.createTime,
          expShipTime: o.expShipTime, overdueBy: o.deadline.text,
          amount: o.amount,
        })),
      }
    }
    // 一致性自检：平台计数 vs 实际取到的条数
    if (pendingAll.length && out.counts?.stockUp != null
        && pendingAll.length !== out.counts.stockUp) {
      out.shipAlert = out.shipAlert || {}
      out.shipAlert.countMismatch = {
        platformTabcnt: out.counts.stockUp,
        fetched: pendingAll.length,
        note: '平台计数与取到的条数不一致，可能超 100 笔或权限受限',
      }
    }

  // 耗时自述（便于验证 Node 化收益）
  out.perf = {
    countMs: cntRes?.ms ?? null,
    listMs: listRes?.ms ?? null,
    cookieFilledFromProfile: listRes?.cookiesFilledFromProfile ?? 0,
  }

  if (MODE === 'overview') {
    lines.push('订单总览：')
    if (out.counts) {
      lines.push(`  全部 ${out.counts.all ?? '—'} | 待支付 ${out.counts.unpaid ?? '—'}`
        + ` | 待发货 ${out.counts.stockUp ?? '—'} | 已发货 ${out.counts.onDelivery ?? '—'}`)
      // ⚠️ tabcnt 的 closed 是「已完结」口径（含已完成），received 是「已签收」严格口径，
      //    两者不可混为一谈；订单列表里的 order_status=4 才是「已完成」。
      lines.push(`  已完结 ${out.counts.closed ?? '—'}`)
      if (out.counts.outOfStock != null) lines.push(`  缺货 ${out.counts.outOfStock}`)
      if (out.counts.expShip != null) lines.push(`  24h 需发货 ${out.counts.expShip}`)
      if (out.counts.shipDelay != null) lines.push(`  超时未发货 ${out.counts.shipDelay}`)
      if (out.counts.inAftersale != null) lines.push(`  售后中 ${out.counts.inAftersale}`)
    } else {
      lines.push('  各状态计数：暂无数据（tabcnt 未返回）')
    }
    if (orderItems.length) {
      lines.push('')
      lines.push(`当前页前 ${orderItems.length} 笔：`)
      orderItems.slice(0, 10).forEach((o, i) => {
        lines.push(`  ${i + 1}. [${o.id}] ${o.statusDesc}`
          + ` 金额 ${o.payAmount ?? '—'} 元 × ${o.productCount ?? '—'} 件`)
        lines.push(`     ${o.createTime ?? '—'} | ${o.province ?? ''}${o.city ?? ''}${o.town ?? ''} | ${o.receiver ?? '—'}`)
      })
    }
    // ★ 超时提醒放最后，最醒目
    if (out.shipAlert) {
      lines.push('')
      if (out.shipAlert.overdueCount) {
        lines.push(`⚠️  有 ${out.shipAlert.overdueCount} 笔待发货已超时：`)
        out.shipAlert.overdueOrders.forEach((o) => {
          lines.push(`     [${o.id}] ${o.overdueBy}（应于 ${o.expShipTime} 前发）金额 ${o.amount ?? '—'} 元`)
        })
      }
      if (out.shipAlert.dueWithin24h) {
        lines.push(`⏰ 另有 ${out.shipAlert.dueWithin24h} 笔 24 小时内需发货`)
      }
    }
  } else {
    lines.push(`订单列表（${orderItems.length} 笔，状态=${STATUS || 'all'}）：`)
    if (orderItems.length) {
      orderItems.forEach((o, i) => {
        lines.push(`  ${i + 1}. [${o.id}] ${o.statusDesc}`
          + ` 金额 ${o.payAmount ?? '—'} 元 × ${o.productCount ?? '—'} 件`)
        lines.push(`     ${o.createTime ?? '—'} | ${o.receiver ?? '—'} | ${o.province ?? ''}${o.city ?? ''}${o.town ?? ''}`)
        if (o.expShipTime) {
          const dl = o.shipDeadline
          lines.push(`     最晚发货 ${o.expShipTime}${dl?.text ? `  ${dl.text}` : ''}`)
        }
      })
    } else {
      lines.push('  暂无数据（该状态下没有订单）')
    }
  }
  out.text = lines.join('\n')
}

emit(out)
process.exit(0)
