#!/usr/bin/env node
/**
 * 抖音·千川全域投放（douyin-uni-prom）—— 只读
 *
 * ══════════════════════════════════════════════════════════════════
 * 2026-11-11 改造：从「开页面 + hook 响应」改为「纯 Node 直连」
 * ══════════════════════════════════════════════════════════════════
 * 改造前：goto /uni-prom + sleep(16000) + CDP hook  → 约 16~20s/次
 * 改造后：基座 request() 纯 Node 直连              → 约 0.4~1.5s/次
 *
 * ★ 推翻旧结论：千川**只读接口也免签**。
 *   实测同一接口三种方式（带签名/剥净/完全手工零参数）全部 code=0。
 *   旧文档「手工 fetch 一律 40002」= 业务参数缺失（code=2），不是签名问题。
 *
 * 能力：
 *   overview   投放总览（余额 + 账户 + 计划数 + 分析报告）
 *   balance    广告余额明细（按 advBalanceType 分组）
 *   perm       权限自检（createAuthEnable / uniPromVisible）
 *   report     报表查询（statQuery）
 *   plans      计划列表汇总（list-summary）
 *   analysis   经营分析报告（report_text）
 *
 * 写操作（建计划 / 启停）本版不实现 —— 需 L2 门禁 + 真实业务参数。
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
const MAR_GOAL = String(ARGS.mar_goal || ARGS.goal || '1').trim()
const LIMIT = Math.min(100, Math.max(1, parseInt(ARGS.limit || '20', 10) || 20))
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const START = (ARGS.start || today()).trim()
const END = (ARGS.end || today()).trim()

function emit(payload) {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n')
}
function fail(kind, message, extra = {}) {
  emit({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })
  process.exit(1)
}
const log = (msg) => console.error('[douyin-uni-prom] ' + msg)

// ══════════════════════════════════════════════════════════════
// margin 模式：纯本地计算（不碰平台，必须放在账号检查之前）
// ══════════════════════════════════════════════════════════════
if (MODE === 'margin') {
  const { computeMarginAdvice, evaluateTrigger, renderText } =
    await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'margin_price.mjs')))
  try {
    const price = (ARGS.price || '').trim()
    const cost = (ARGS.cost || '').trim()
    if (!price || !cost) fail('bad_input', 'margin 模式需要 --price 和 --cost')
    const advice = computeMarginAdvice({
      price: Number(price), cost: Number(cost),
      netRoi: ARGS['net-roi'] ? Number(ARGS['net-roi']) : undefined,
      platform: 'douyin',
    })
    emit({ ok: true, mode: 'margin', advice, text: renderText ? renderText(advice) : JSON.stringify(advice) })
  } catch (e) {
    fail('api_error', `margin 计算失败：${e?.message || e}`)
  }
  process.exit(0)
}

const { loadAccount } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-request.mjs')))
const { withDouyinGuard } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-guard.mjs')))

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

const WRITE_MODES = ['create', 'pause', 'resume', 'delete', 'upload']
if (WRITE_MODES.includes(MODE)) {
  fail('api_error',
    `mode=${MODE} 是 L2 写操作，本版未实现（需 --confirm 门禁 + 真实业务参数）。`
    + `可用：overview / balance / perm / report / plans / analysis / margin。`,
    { mode: MODE })
}
if (!['overview', 'balance', 'perm', 'report', 'plans', 'analysis'].includes(MODE)) {
  fail('api_error', `未知 mode：${MODE}。可用：overview / balance / perm / report / plans / analysis / margin`, { mode: MODE })
}

// ══════════════════════════════════════════════════════════════
// 取数
// ══════════════════════════════════════════════════════════════
const R = {}

await withDouyinGuard('douyin-uni-prom', account.shop_key, async (g) => {
  const need = (k) => MODE === 'overview' || MODE === k

  if (need('balance')) {
    R.balance = await g.call('promo.balance', {}, { account })
    if (!R.balance.ok) fail(R.balance.errorKind === 'session' ? 'token_expired' : 'api_error',
      `余额接口失败（${R.balance.errorKind}）：${R.balance.msg || R.balance.message || ''}`)
  }
  if (MODE === 'overview' || MODE === 'perm') {
    R.config = await g.call('promo.uniPromConfig', {}, { account })
    if (!R.config.ok) fail(R.config.errorKind === 'session' ? 'token_expired' : 'api_error',
      `权限接口失败（${R.config.errorKind}）：${R.config.msg || R.config.message || ''}`)
  }
  if (MODE === 'overview') {
    R.userInfo = await g.call('promo.userInfo', {}, { account })
  }
  if (MODE === 'overview' || MODE === 'plans') {
    // ★ list-summary 必须带业务 body，空 body 报 code=2
    const body = JSON.stringify({
      DiscardTotalNum: true,
      AdFilter: {
        MarGoal: Number(MAR_GOAL), AdlabMode: 1, CustomFilterType: 1,
        UniPromShopFilter: { UniPromShopView: 1 },
        StartTime: `${START} 00:00:00`, EndTime: `${END} 23:59:59`,
      },
      Metrics: [],
    })
    R.plans = await g.call('promo.planSummary', {}, { account, body })
  }
  if (MODE === 'overview' || MODE === 'analysis') {
    R.analysis = await g.call('promo.analysisReport', {}, { account, body: '{}' })
  }
  if (MODE === 'report') {
    R.report = await g.call('promo.statQuery', {}, {
      account,
      body: JSON.stringify({
        StartTime: `${START} 00:00:00`, EndTime: `${END} 23:59:59`,
        ComparisonParams: { RatioStartTime: `${START} 00:00:00`, RatioEndTime: `${END} 23:59:59` },
        DataSetKey: 'overall_home_cost_total_prom',
        Dimensions: ['combined_homepage_ad_category'],
        Metrics: ['stat_cost'],
        Filters: { ConditionRelationshipType: 1, Conditions: [] },
      }),
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
    totalYuan: yuan(main.total),
    validYuan: yuan(main.valid),
    frozenYuan: yuan(main.frozen),
    byType: Object.fromEntries(Object.entries(infos).map(([k, v]) => [k, {
      totalYuan: v.total != null ? yuan(v.total) : null,
      validYuan: v.valid != null ? yuan(v.valid) : null,
    }])),
  }
}

// 权限
if (R.config?.data) {
  const c = R.config.data
  out.permission = {
    uniPromVisible: c.uniPromVisible,
    createAuthEnable: c.createAuthEnable,
    hitUniPromAllowList: c.hitUniPromAllowList,
    note: c.createAuthEnable === false
      ? '仅观察权限：可查数据，不能建/改计划'
      : '可创建计划（写操作本版仍未实现）',
  }
}

// 账户
if (R.userInfo?.data) {
  const d = R.userInfo.data
  out.accountInfo = {
    userId: d.userInfo?.userId ?? null,
    shopName: d.shopInfo?.shopName ?? d.shopInfo?.name ?? null,
    advId: d.abInfo?.advId ?? d.abInfo?.adv_id ?? null,
  }
}

// 计划
if (R.plans?.data) {
  out.plans = {
    totalNum: R.plans.data.totalNum ?? null,
    metrics: R.plans.data.totalMetrics?.metrics ?? null,
  }
}

// 分析报告
if (R.analysis?.data) {
  out.analysis = { text: R.analysis.data.report_text ?? null }
}

// 报表
if (R.report?.data) {
  out.report = R.report.data
}

/* ── 文案 ─────────────────────────────────────────────────── */
if (MODE === 'overview') {
  lines.push('千川投放总览：')
  if (out.accountInfo?.shopName) lines.push(`  店铺：${out.accountInfo.shopName}`)
  if (out.accountInfo?.userId) lines.push(`  广告主 userId：${out.accountInfo.userId}`)
  if (out.balance) {
    lines.push(`  账户余额：${out.balance.validYuan?.toFixed(2) ?? '—'} 元可用`
      + `（总额 ${out.balance.totalYuan?.toFixed(2) ?? '—'} / 冻结 ${out.balance.frozenYuan?.toFixed(2) ?? '—'}）`)
  }
  if (out.permission) lines.push(`  投放权限：${out.permission.note}`)
  if (out.plans) lines.push(`  在投计划：${out.plans.totalNum ?? '—'} 个（${START} ~ ${END}）`)
  if (out.analysis?.text) lines.push(`  经营分析：${out.analysis.text}`)
  out.text = lines.join('\n')
} else if (MODE === 'balance') {
  lines.push('广告余额：')
  if (out.balance) {
    lines.push(`  可用：${out.balance.validYuan?.toFixed(2)} 元`)
    lines.push(`  总额：${out.balance.totalYuan?.toFixed(2)} 元`)
    lines.push(`  冻结：${out.balance.frozenYuan?.toFixed(2)} 元`)
    const types = Object.keys(out.balance.byType || {})
    if (types.length > 1) {
      lines.push('  分类型：')
      for (const t of types) {
        const v = out.balance.byType[t]
        if (v.validYuan) lines.push(`    类型${t}：可用 ${v.validYuan.toFixed(2)} 元`)
      }
    }
  }
  out.text = lines.join('\n')
} else if (MODE === 'perm') {
  lines.push('千川投放权限：')
  lines.push(`  统一投放可见：${out.permission?.uniPromVisible ?? '—'}`)
  lines.push(`  可创建计划：${out.permission?.createAuthEnable ?? '—'}`)
  lines.push(`  在白名单：${out.permission?.hitUniPromAllowList ?? '—'}`)
  lines.push(`  ${out.permission?.note ?? ''}`)
  out.text = lines.join('\n')
} else if (MODE === 'plans') {
  lines.push(`计划列表汇总（${START} ~ ${END}，MarGoal=${MAR_GOAL}）：`)
  lines.push(`  计划数：${out.plans?.totalNum ?? '—'}`)
  out.text = lines.join('\n')
} else if (MODE === 'analysis') {
  lines.push('经营分析报告：')
  lines.push(`  ${out.analysis?.text || '（无内容）'}`)
  out.text = lines.join('\n')
} else if (MODE === 'report') {
  lines.push(`报表（${START} ~ ${END}）：`)
  const sd = out.report?.StatsData
  if (sd?.Totals) {
    for (const [k, v] of Object.entries(sd.Totals)) lines.push(`  ${k}：${v?.ValueStr ?? v?.Value ?? '—'}`)
    lines.push(`  总数：${sd.TotalCount ?? '—'}`)
  } else lines.push('  暂无数据')
  out.text = lines.join('\n')
}

emit(out)
process.exit(0)
