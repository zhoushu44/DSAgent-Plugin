#!/usr/bin/env node
/**
 * 抖音·千川推广数据（douyin-promo）—— 只读
 *
 * ══════════════════════════════════════════════════════════════════
 * 2026-11-11 改造：从「开页面 + hook 响应」改为「纯 Node 直连」
 * ══════════════════════════════════════════════════════════════════
 * 改造前：goto 千川页 + sleep(15000) + CDP hook  → 约 15~20s/次
 * 改造后：基座 request() 纯 Node 直连           → 约 0.4~1.5s/次
 *
 * ★ 推翻旧结论：千川只读接口**免签**。
 *   同一接口三种方式（带签名/剥净/完全手工零参数）全部 code=0。
 *   旧文档「手工 fetch 撞 40002」= 业务参数缺失，不是签名问题。
 *
 * ★ 本技能 vs douyin-uni-prom 的分工：
 *   douyin-promo     —— 账户侧：余额 / 消耗层级 / 客户ID / 禁ROI / 在投计划（oce an 接口）
 *   douyin-uni-prom  —— 投放侧：全域投放计划汇总 / 报表 / 分析报告 / 素材
 *   两者都可查余额；promo 侧重「账户还能不能投」，uni-prom 侧重「投得怎么样」。
 *
 * 能力：
 *   overview   推广总览（余额 + 消耗层级 + 在投计划数 + 客户ID + 禁ROI）
 *   balance    余额明细
 *   plans      在投计划列表（getOngoingPromotionList）
 *   cost       消耗层级信息
 *   report     报表查询（statQuery，需 advertiserId）
 *
 * 写操作（暂停/开启/改价/建计划）本版不实现。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = process.env.DSAGENT_PLUGIN_ROOT || join(HERE, '..', '..', '..')
const PURL = (p) => pathToFileURL(p).href

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
const ACCOUNT = (ARGS.account || '').trim()
const LIMIT = Math.min(100, Math.max(1, parseInt(ARGS.limit || '20', 10) || 20))
const DAYS = Math.min(90, Math.max(1, parseInt(ARGS.days || '7', 10) || 7))
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const daysAgo = (n) => new Date(Date.now() + 8 * 3600e3 - n * 86400e3).toISOString().slice(0, 10)
const START = (ARGS.start || daysAgo(DAYS - 1)).trim()
const END = (ARGS.end || today()).trim()

function emit(payload) {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n')
}
function fail(kind, message, extra = {}) {
  emit({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })
  process.exit(1)
}
const log = (msg) => console.error('[douyin-promo] ' + msg)

const { loadAccount } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-request.mjs')))
const { withDouyinGuard } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-guard.mjs')))
const { statQueryBody } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-registry.mjs')))

const accRes = await loadAccount('douyin_shop', ACCOUNT)
if (!accRes.ok) {
  if (accRes.errorKind === 'need_account_choice') {
    fail('need_account_choice', accRes.message, {
      accounts: accRes.accounts.map((a) => ({ shop_key: a.shop_key, nickname: a.nickname })),
    })
  }
  if (accRes.errorKind === 'not_bound') {
    fail('not_bound', '未找到抖音小店账号。请到「账号连接」页面添加「抖店」账号（platform=douyin_shop）。')
  }
  fail('api_error', accRes.message)
}
const account = accRes.account

const WRITE_MODES = ['pause', 'resume', 'maxcost', 'roi', 'create', 'delete']
if (WRITE_MODES.includes(MODE)) {
  fail('api_error',
    `mode=${MODE} 是 L2 写操作，本版未实现（需 --confirm 门禁）。可用：overview / balance / plans / cost / report。`,
    { mode: MODE })
}
if (!['overview', 'balance', 'plans', 'cost', 'report'].includes(MODE)) {
  fail('api_error', `未知 mode：${MODE}。可用：overview / balance / plans / cost / report`, { mode: MODE })
}

// ══════════════════════════════════════════════════════════════
// 取数
// ══════════════════════════════════════════════════════════════
const R = {}

await withDouyinGuard('douyin-promo', account.shop_key, async (g) => {
  // 余额（所有模式都可能用到）
  R.balance = await g.call('promo.balance', {}, { account })
  if (!R.balance.ok) {
    fail(R.balance.errorKind === 'session' ? 'token_expired' : 'api_error',
      `余额接口失败（${R.balance.errorKind}）：${R.balance.msg || R.balance.message || ''}`)
  }

  if (MODE === 'overview' || MODE === 'plans') {
    R.ongoing = await g.call('promo.ongoingList', {}, { account })
  }
  if (MODE === 'overview' || MODE === 'cost') {
    R.costLevel = await g.call('promo.costLevel', {}, { account })
  }
  if (MODE === 'overview') {
    R.customer = await g.call('promo.customerId', {}, { account })
    R.forbidRoi = await g.call('promo.forbidRoi', {}, { account })
  }
  if (MODE === 'report') {
    // 报表需要 advertiserId
    const cust = await g.call('promo.customerId', {}, { account })
    let advertiserId = ARGS['advertiser-id'] || ARGS.advertiserId || ''
    if (!advertiserId && cust.ok) {
      const d = cust.data?.detail
      advertiserId = Array.isArray(d) ? (d[0]?.customerId ?? d[0]?.customer_id ?? '') : (d?.customerId ?? '')
    }
    if (!advertiserId) {
      fail('bad_input',
        'report 模式需要 advertiserId（广告主 ID）。'
        + '请传 --advertiser-id，或先跑 --mode overview 查看 customerId 接口返回。',
        { hint: 'customerId 接口返回结构：' + JSON.stringify(cust.data || {}).slice(0, 300) })
    }
    R.report = await g.call('promo.statQuery', {}, {
      account,
      body: statQueryBody({ advertiserId, startDate: START, endDate: END }),
    })
  }
})

// ══════════════════════════════════════════════════════════════
// 解析
// ══════════════════════════════════════════════════════════════
const yuan = (v) => (v == null || v === '' ? null : Number(v) / 100)
const out = { ok: true, mode: MODE, shopKey: account.shop_key }
const lines = []
out.perf = Object.fromEntries(Object.entries(R).filter(([, v]) => v).map(([k, v]) => [k + 'Ms', v.ms]))

// 余额
if (R.balance?.data?.balanceInfos) {
  const infos = R.balance.data.balanceInfos
  const main = infos['1'] || {}
  out.balance = {
    type: 1,
    total: yuan(main.total),
    valid: yuan(main.valid),
    frozen: yuan(main.frozen),
  }
  out.balanceAll = Object.entries(infos).map(([t, v]) => ({
    type: Number(t),
    total: v.total != null ? yuan(v.total) : null,
    valid: v.valid != null ? yuan(v.valid) : null,
    frozen: v.frozen != null ? yuan(v.frozen) : null,
  }))
}

// 在投计划
if (R.ongoing) {
  const ap = R.ongoing.data?.activitiesOfPromotion
  const arr = Array.isArray(ap) ? ap : (ap && typeof ap === 'object' ? Object.values(ap) : [])
  out.ongoingCount = Array.isArray(ap) ? ap.length : (ap ? Object.keys(ap).length : 0)
  out.ongoing = Array.isArray(ap) ? ap.slice(0, LIMIT) : ap
}

// 消耗层级
if (R.costLevel?.data) {
  out.costLevel = R.costLevel.data
}

// 客户 ID
if (R.customer?.data) {
  const d = R.customer.data.detail
  out.customer = Array.isArray(d) ? d.slice(0, 10) : d
  const first = Array.isArray(d) ? d[0] : d
  if (first) {
    // ★ 两个 ID 含义不同，别混用：
    //   accountId  1781536544329804  = 千川账户 ID（报表 Filters.advertiser_id 用这个）
    //   customerId 659089484         = 客户 ID（公司主体）
    out.accountId = first.accountId ?? first.account_id ?? null
    out.customerId = first.customerId ?? first.customer_id ?? null
    out.advertiserId = out.accountId       // 报表口径用 accountId
    out.companyName = first.name ?? null
    out.companyStatus = first.statusName ?? null
  }
}

// 禁 ROI（★ 时间戳是秒级 Unix，要转成年月日）
if (R.forbidRoi?.data) {
  const f = R.forbidRoi.data
  const tsToDate = (t) => {
    const n = Number(t)
    if (!Number.isFinite(n) || n <= 0) return null
    return new Date((n < 1e12 ? n * 1000 : n)).toISOString().slice(0, 10)
  }
  const start = tsToDate(f.bannerStartTime)
  const end = tsToDate(f.bannerEndTime)
  const nowBjt = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  // ★ isForbid=true 只代表「历史上被设过限制」；横幅过了 endDate 就不再生效。
  const active = f.isForbid === true && (!end || end >= nowBjt)
  out.forbidRoi = {
    isForbid: f.isForbid ?? null,
    isBrand: f.isBrand ?? null,
    startDate: start,
    endDate: end,
    activeInWindow: active,
    note: f.isForbid
      ? (active ? 'ROI 限制生效中' : `ROI 限制已过期（${end} 结束），当前不受限`)
      : '未受限',
    raw: { bannerStartTime: f.bannerStartTime, bannerEndTime: f.bannerEndTime },
  }
}

// 报表
if (R.report?.data) {
  out.report = R.report.data
}

/* ── 文案 ─────────────────────────────────────────────────── */
if (MODE === 'overview') {
  lines.push('千川推广总览：')
  if (out.balance) {
    lines.push(`  账户余额：${out.balance.valid?.toFixed(2) ?? '—'} 元可用`
      + `（总额 ${out.balance.total?.toFixed(2) ?? '—'} / 冻结 ${out.balance.frozen?.toFixed(2) ?? '—'}）`)
  }
  if (out.ongoingCount != null) {
    lines.push(`  在投计划：${out.ongoingCount} 个${out.ongoingCount === 0 ? '（当前没有在投放）' : ''}`)
  }
  if (out.advertiserId) lines.push(`  千川账户 ID：${out.advertiserId}`)
  if (out.companyName) lines.push(`  客户主体：${out.companyName}（${out.companyStatus ?? '—'}）`)
  if (out.forbidRoi?.isForbid != null) {
    // ★ isForbid=true 只代表「历史上设过 ROI 限制」；横幅过了 endDate 就不再生效。
    //   直接说「受限」会误报（本店横幅 2025-05 就结束了）。
    lines.push(`  ROI 限制：${out.forbidRoi.note}`)
  }
  if (out.costLevel && Object.keys(out.costLevel).length) {
    lines.push(`  消耗层级：${JSON.stringify(out.costLevel).slice(0, 120)}`)
  }
  out.text = lines.join('\n')
} else if (MODE === 'balance') {
  lines.push('广告余额：')
  if (out.balance) {
    lines.push(`  可用：${out.balance.valid?.toFixed(2)} 元`)
    lines.push(`  总额：${out.balance.total?.toFixed(2)} 元`)
    lines.push(`  冻结：${out.balance.frozen?.toFixed(2)} 元`)
  }
  const nz = (out.balanceAll || []).filter((x) => x.valid && x.valid > 0)
  if (nz.length > 1) {
    lines.push('  分类型：')
    nz.forEach((x) => lines.push(`    类型 ${x.type}：可用 ${x.valid.toFixed(2)} 元`))
  }
  out.text = lines.join('\n')
} else if (MODE === 'plans') {
  lines.push(`在投计划（${out.ongoingCount ?? 0} 个）：`)
  if (!out.ongoingCount) {
    lines.push('  当前没有在投放的计划')
    lines.push('  注：店铺未开推广属正常，不是故障。')
  } else {
    const arr = Array.isArray(out.ongoing) ? out.ongoing : []
    arr.slice(0, LIMIT).forEach((p, i) => {
      lines.push(`  ${i + 1}. [${p.adId ?? p.ad_id ?? p.id ?? '—'}] ${p.adName ?? p.name ?? p.title ?? '—'}`)
    })
  }
  out.text = lines.join('\n')
} else if (MODE === 'cost') {
  lines.push('消耗层级：')
  const c = out.costLevel || {}
  if (!Object.keys(c).length) lines.push('  暂无数据')
  else for (const [k, v] of Object.entries(c).slice(0, 10)) lines.push(`  ${k}：${JSON.stringify(v).slice(0, 80)}`)
  out.text = lines.join('\n')
} else if (MODE === 'report') {
  lines.push(`推广报表（${START} ~ ${END}）：`)
  const sd = out.report?.StatsData
  if (sd?.Totals) {
    for (const [k, v] of Object.entries(sd.Totals)) {
      lines.push(`  ${k}：${v?.ValueStr ?? v?.Value ?? '—'}`)
    }
    lines.push(`  数据条数：${sd.TotalCount ?? '—'}`)
  } else {
    lines.push('  暂无数据（该时间窗内没有消耗）')
  }
  out.text = lines.join('\n')
}

emit(out)
process.exit(0)
