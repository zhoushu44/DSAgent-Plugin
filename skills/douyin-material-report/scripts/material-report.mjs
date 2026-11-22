#!/usr/bin/env node
/**
 * 抖音·素材分析报表（douyin-material-report）—— 只读
 *
 * ══════════════════════════════════════════════════════════════════
 * 2026-11-11 改造：从「开页面 + hook 响应」改为「纯 Node 直连」
 * ══════════════════════════════════════════════════════════════════
 * 改造前：goto 素材分析页 + sleep(16000) + 页面内 fetch  → 约 16~20s/次
 * 改造后：基座 request() 纯 Node 直连                  → 约 0.8~1.5s/次
 *
 * ★ 关键发现（probe-19）：素材报表的 Filters **只有 4 条**，字段名与通投报表不同：
 *     advertiser_id / marketing_goal / adlab_mode_fork / material_type
 *   照搬通投报表那套（ecp_app_id + query_self_data）会返回
 *   「网络请求超时」—— 那是条件冲突，不是真超时。
 *
 * 数据源：`/ad/api/data/v1/common/statQuery`，DataSetKey=roi2_video_material_analysis
 * 实测一次可拿 100 个指标全部返回（7.6KB / 771ms）。
 *
 * 能力：
 *   report    素材分析报表（视频/图片/图文/标题，按素材维度）
 *   source    素材来源清单（抖音号主页/本地上传/直播剪辑…）
 *   overview  概览（素材来源数 + 报表汇总）
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
const OFFSET = Math.max(0, parseInt(ARGS.offset || '0', 10) || 0)
const MATERIAL_TYPE = parseInt(ARGS.material_type || ARGS.materialType || '3', 10)
const MAR_GOAL = parseInt(ARGS.mar_goal || ARGS.goal || '2', 10)
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
const log = (msg) => console.error('[douyin-material-report] ' + msg)

const { loadAccount } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-request.mjs')))
const { withDouyinGuard } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-guard.mjs')))
const { materialReportBody, MATERIAL_DIMENSIONS_FULL } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-registry.mjs')))

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

if (!['report', 'source', 'overview'].includes(MODE)) {
  fail('api_error', `未知 mode：${MODE}。可用：report / source / overview`, { mode: MODE })
}

// 素材类型映射
const MT_DESC = { 1: '直播间画面', 2: '图片素材', 3: '视频素材', 4: '图文素材', 5: '标题素材' }

// ══════════════════════════════════════════════════════════════
// 取数
// ══════════════════════════════════════════════════════════════
const R = {}

await withDouyinGuard('douyin-material-report', account.shop_key, async (g) => {
  // 需要 advertiserId（accountId）
  const cust = await g.call('promo.customerId', {}, { account })
  let advertiserId = ARGS['advertiser-id'] || ARGS.advertiserId || ''
  if (!advertiserId && cust.ok) {
    const d = cust.data?.detail
    const first = Array.isArray(d) ? d[0] : d
    advertiserId = first?.accountId ?? first?.account_id ?? ''
  }
  if (!advertiserId) {
    fail('bad_input', '无法取得千川账户 ID（accountId）。请传 --advertiser-id。',
      { hint: JSON.stringify(cust.data || {}).slice(0, 300) })
  }
  R.advertiserId = advertiserId

  if (MODE === 'overview' || MODE === 'source') {
    R.source = await g.call('promo.materialSource', {}, { account })
  }
  if (MODE === 'overview' || MODE === 'report') {
    R.report = await g.call('promo.materialReport', {}, {
      account,
      body: materialReportBody({
        advertiserId, startDate: START, endDate: END,
        marketingGoal: MAR_GOAL, materialType: MATERIAL_TYPE,
        dimensions: MODE === 'report' ? MATERIAL_DIMENSIONS_FULL : undefined,
      }),
    })
    if (!R.report.ok) {
      fail(R.report.errorKind === 'session' ? 'token_expired' : 'api_error',
        `素材报表接口失败（${R.report.errorKind}）：${R.report.msg || R.report.message || ''}`
        + (R.report.hint ? `\n提示：${R.report.hint}` : ''),
        { st: R.report.st, code: R.report.code })
    }
  }
})

// ══════════════════════════════════════════════════════════════
// 解析
// ══════════════════════════════════════════════════════════════
const out = { ok: true, mode: MODE, shopKey: account.shop_key, advertiserId: R.advertiserId }
const lines = []
out.perf = Object.fromEntries(Object.entries(R).filter(([, v]) => v && v.ms).map(([k, v]) => [k + 'Ms', v.ms]))

// 素材来源
if (R.source?.data) {
  const s = R.source.data
  out.source = {
    video: (s.video || []).map((v) => ({ source: v.show_source, name: v.show_source_name })),
    image: (s.image || []).map((v) => ({ source: v.show_source, name: v.show_source_name })),
    carousel: (s.carousel || []).map((v) => ({ source: v.show_source, name: v.show_source_name })),
  }
  out.sourceCount = {
    video: out.source.video.length,
    image: out.source.image.length,
    carousel: out.source.carousel.length,
  }
}

// 报表
if (R.report?.data) {
  const sd = R.report.data.StatsData || {}
  const totals = sd.Totals || {}
  out.metricCount = Object.keys(totals).length
  out.totalRows = sd.TotalCount ?? null
  out.materialType = MATERIAL_TYPE
  out.materialTypeDesc = MT_DESC[MATERIAL_TYPE] || String(MATERIAL_TYPE)

  // 关键指标挑出来（避免返回几百个字段）
  // ★ 字段名全部来自 probe-19 抓包的真实 100 指标，不猜
  const KEY = {
    stat_cost_for_roi2: '消耗',
    stat_cost_for_overall_roi2: '整体消耗',
    total_pay_order_gmv_for_roi2: '成交GMV',
    total_pay_order_gmv_include_coupon_for_roi2: '成交GMV(含券)',
    total_pay_order_count_for_roi2: '成交订单',
    total_cost_per_pay_order_for_roi2: '单均成本',
    total_prepay_and_pay_order_roi2: 'ROI',
    total_cpc_for_roi2: 'CPC',
    total_ecpm_for_roi2: 'CPM',
    video_play_duration_2s_rate_for_roi2: '2s播放率',
    video_play_duration_3s_rate_for_roi2: '3s播放率',
    video_play_finish_rate_for_roi2_v2: '完播率',
    video_play_count_for_roi2_v2: '播放数',
    video_like_count_for_roi2: '点赞数',
    video_comment_count_for_roi2_v2: '评论数',
    video_follow_count_for_roi2: '涨粉数',
    video_avg_watch_duration_for_roi2: '平均观看时长',
  }
  out.keyMetrics = {}
  for (const [k, label] of Object.entries(KEY)) {
    if (totals[k] !== undefined) {
      out.keyMetrics[label] = totals[k]?.ValueStr ?? totals[k]?.Value ?? null
    }
  }
  out.allMetrics = totals
}

/* ── 文案 ─────────────────────────────────────────────────── */
if (MODE === 'overview') {
  lines.push('素材分析概览：')
  lines.push(`  账户 ID：${out.advertiserId}`)
  lines.push(`  统计区间：${START} ~ ${END}`)
  if (out.sourceCount) {
    lines.push(`  素材来源：视频 ${out.sourceCount.video} / 图片 ${out.sourceCount.image} / 轮播 ${out.sourceCount.carousel}`)
  }
  if (out.materialTypeDesc) lines.push(`  素材类型：${out.materialTypeDesc}`)
  if (out.totalRows != null) lines.push(`  报表行数：${out.totalRows}`)
  const km = out.keyMetrics || {}
  const shown = Object.entries(km).filter(([, v]) => v != null && v !== '-')
  if (shown.length) {
    lines.push('  核心指标：')
    for (const [k, v] of shown) lines.push(`    ${k}：${v}`)
  } else {
    lines.push('  核心指标：暂无消耗（该店铺当前没有投放）')
  }
  out.text = lines.join('\n')
} else if (MODE === 'source') {
  lines.push('素材来源：')
  for (const [k, label] of [['video', '视频'], ['image', '图片'], ['carousel', '轮播']]) {
    const arr = out.source?.[k] || []
    lines.push(`  ${label}（${arr.length} 个来源）：`)
    arr.slice(0, LIMIT).forEach((s) => lines.push(`    · ${s.name}（source=${s.source}）`))
  }
  out.text = lines.join('\n')
} else if (MODE === 'report') {
  lines.push(`素材分析报表（${START} ~ ${END}，${out.materialTypeDesc}）：`)
  if (out.totalRows != null) lines.push(`  数据行数：${out.totalRows}`)
  const km = out.keyMetrics || {}
  const shown = Object.entries(km).filter(([, v]) => v != null && v !== '-')
  if (shown.length) {
    lines.push('  汇总指标：')
    for (const [k, v] of shown) lines.push(`    ${k}：${v}`)
  } else {
    lines.push('  暂无消耗数据')
  }
  lines.push(`  （共 ${out.metricCount} 个指标可用，完整数据见 JSON 的 allMetrics）`)
  out.text = lines.join('\n')
}

emit(out)
process.exit(0)
