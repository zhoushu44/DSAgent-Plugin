#!/usr/bin/env node
/**
 * 抖音小店·店铺经营数据（douyin-shop）—— 只读
 *
 * ══════════════════════════════════════════════════════════════════
 * 2026-11-11 改造：从「开页面 + 拦响应」改为「纯 Node 直连」
 * ══════════════════════════════════════════════════════════════════
 * 改造前：goto 3 个页面 + 每个 sleep(12000) ≈ 36s+  → 约 36~45s/次
 * 改造后：基座 request() 纯 Node 直连               → 约 0.6~1.5s/次
 *
 * 依据：_douyin_node_probe/REPORT.md + probe-07-shop
 *   · 体验分 3 个接口 + 店铺指标 + 首页全部免签（剥净后 st=0）
 *
 * 能力：
 *   overview   店铺经营总览（体验分 + 商品计数 + 销量最高商品）
 *   score      店铺体验分（总览 + 子项指标 + 趋势）
 *   goods      商品数据明细
 *
 * 解析口径与改造前一致（grow_score_info / grow_score_metric_info 嵌套结构）。
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
const LIMIT = Math.min(100, Math.max(1, parseInt(ARGS.limit || '20', 10) || 20))
const ACCOUNT = (ARGS.account || '').trim()

function emit(payload) {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n')
}
function fail(kind, message, extra = {}) {
  emit({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })
  process.exit(1)
}
const log = (msg) => console.error('[douyin-shop] ' + msg)

// ── 基座 ──────────────────────────────────────────────────
const { loadAccount } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-request.mjs')))
const { withDouyinGuard } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-guard.mjs')))

// ── 账号 ──────────────────────────────────────────────────
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

if (!['overview', 'score', 'goods'].includes(MODE)) {
  fail('api_error', `未知 mode：${MODE}。可用：overview / score / goods`, { mode: MODE })
}

// ══════════════════════════════════════════════════════════════
// 取数：纯 Node（按模式决定打哪些接口）
// ══════════════════════════════════════════════════════════════
const R = { score: null, scoreSub: null, trend: null, metrics: null, gCount: null, gList: null, home: null }

await withDouyinGuard('douyin-shop', account.shop_key, async (g) => {
  const calls = []
  if (MODE === 'overview' || MODE === 'score') {
    calls.push(['score', 'shop.expScore', {}])
    calls.push(['scoreSub', 'shop.expScoreSub', {}])
    if (MODE === 'score') calls.push(['trend', 'shop.expScoreTrend', {}])
  }
  if (MODE === 'overview' || MODE === 'goods') {
    calls.push(['gCount', 'goods.count', {}])
    calls.push(['gList', 'goods.list', { page: 0, pageSize: LIMIT }])
  }

  for (const [key, api, params] of calls) {
    const r = await g.call(api, params, { account })
    R[key] = r
    if (!r.ok) {
      fail(r.errorKind === 'session' ? 'token_expired' : 'api_error',
        `接口 ${api} 失败（${r.errorKind}）：${r.msg || r.message || ''}`
        + (r.hint ? `\n提示：${r.hint}` : ''),
        { api, st: r.st, code: r.code })
    }
  }
})

// ══════════════════════════════════════════════════════════════
// 解析（口径与改造前一致）
// ══════════════════════════════════════════════════════════════
const score = R.score?.data || null
const scoreSub = R.scoreSub?.data || null
const trend = R.trend?.data || null
const gCount = R.gCount?.data || null
const gListRaw = R.gList?.data
const gArr = Array.isArray(gListRaw) ? gListRaw
  : Array.isArray(gListRaw?.list) ? gListRaw.list
  : Array.isArray(gListRaw?.items) ? gListRaw.items : []

// 金额一律「分 → 元」
const yuan = (v) => (v == null || v === '') ? null : (Number(v) / 100)

const goodsItems = gArr.slice(0, LIMIT).map((g) => ({
  id: g.product_id ?? g.id ?? null,
  name: g.name ?? '',
  img: g.img ?? null,
  sellNum: g.sell_num ?? null,
  priceLower: yuan(g.price_lower),
  priceHigher: yuan(g.price_higher),
  status: g.status ?? null,
  checkStatus: g.check_status ?? null,
  cates: [g.first_cid, g.second_cid, g.third_cid].filter((v) => v != null),
  createTime: g.create_time ?? null,
  updateTime: g.update_time ?? null,
}))

// 体验分：grow_score_info.grow_shop_score；子项在 scoreSub.grow_score_metric_info
const growInfo = score?.grow_score_info || null
const shopScore = growInfo?.grow_shop_score ?? null
const shopName = scoreSub?.shop_name || null
const subMetrics = (scoreSub?.grow_score_metric_info?.grow_score_metrics || []).map((m) => ({
  node: m.experience_node,
  title: m.title,
  value: m.value?.value_figure ?? null,
  valueType: m.value?.value_type ?? null,
  decimal: m.value?.decimal_places ?? 0,
  outStandard: m.metric_out_standard ?? null,
}))

const out = { ok: true, mode: MODE, shopKey: account.shop_key, items: [] }
const lines = []

// 耗时自述
out.perf = Object.fromEntries(
  Object.entries(R).filter(([, v]) => v).map(([k, v]) => [k + 'Ms', v.ms]),
)

if (MODE === 'overview' || MODE === 'score') {
  out.score = {
    shopName,
    category: score?.category ?? scoreSub?.category ?? null,
    score: shopScore,
    yesterday: growInfo?.grow_score_yesterday_info?.grow_score_yesterday ?? null,
    scoreType: score?.score_type ?? null,
    doneDate: score?.done_info?.done_date ?? null,
    shopOpenDays: growInfo?.shop_open_days ?? null,
    isStandardOut: growInfo?.is_metric_standard_out ?? null,
    subMetrics,
  }
  if (trend) {
    // ★ 坑：服务端 recent_7/14/30_avg_score 恒返回 0（实测 30 天全是 70 也返回 0），
    //   但 experience_score 数组里是真实日数据。以数组为准，自己算均值；原值保留备查。
    const series = Array.isArray(trend.experience_score) ? trend.experience_score : []
    const nums = series.map((x) => Number(x?.score)).filter((n) => Number.isFinite(n))
    const avgOf = (n) => {
      if (!nums.length) return null
      const tail = nums.slice(-n)
      if (!tail.length) return null
      return Math.round((tail.reduce((a, b) => a + b, 0) / tail.length) * 100) / 100
    }
    out.trend = {
      current: nums.length ? nums[nums.length - 1] : null,
      avg7: avgOf(7),
      avg14: avgOf(14),
      avg30: avgOf(30),
      days: nums.length,
      beginDate: trend.begin_date ?? null,
      currentDate: trend.current_date ?? null,
      hasData: trend.has_data ?? null,
      // 服务端原始值（恒为 0，仅留档对比）
      serverAvgRaw: {
        avg7: trend.recent_7_avg_score,
        avg14: trend.recent_14_avg_score,
        avg30: trend.recent_30_avg_score,
      },
      series,
    }
  }
  if (MODE === 'score') {
    lines.push('店铺体验分：')
    lines.push(`  店铺：${shopName ?? '—'}${out.score.category ? `（${out.score.category}）` : ''}`)
    lines.push(`  当前体验分：${shopScore ?? '—'}${out.score.yesterday != null ? `（昨日 ${out.score.yesterday}）` : ''}`)
    lines.push(`  开店天数：${out.score.shopOpenDays ?? '—'} | 数据日期：${out.score.doneDate ?? '—'}`)
    if (out.trend) {
      lines.push(`  近 7 天均值：${out.trend.avg7 ?? '—'} | 近 14 天：${out.trend.avg14 ?? '—'} | 近 30 天：${out.trend.avg30 ?? '—'}`)
      if (out.trend.beginDate) lines.push(`  统计区间：${out.trend.beginDate} ~ ${out.trend.currentDate ?? '—'}`)
    }
    if (subMetrics.length) {
      lines.push('  子项指标：')
      for (const m of subMetrics.slice(0, 12)) {
        const dec = m.decimal || 0
        const val = m.value == null ? '—' : Number(m.value).toFixed(dec)
        lines.push(`    · ${m.title}：${val}${m.outStandard != null ? `（标准 ${m.outStandard}）` : ''}`)
      }
    }

    // ★ 2026-11-11 试用补充：解释「分从哪来」，避免用户看到 70 分以为系统算错
    //   平台**不提供**满分/扣分明细（grow_score_info 里只有 grow_shop_score 一个分值），
    //   所以这里只能给出「哪些指标拖后腿」的客观判断，**不猜总分构成**。
    const flagged = subMetrics.filter((m) => m.outStandard != null && Number(m.value) > Number(m.outStandard))
    lines.push('')
    lines.push('  解读：')
    if (!subMetrics.length) {
      lines.push('    · 该店铺暂无子项指标数据')
    } else if (flagged.length) {
      lines.push(`    · ⚠️ 有 ${flagged.length} 项超出标准，是主要扣分点：`)
      flagged.forEach((m) => {
        lines.push(`        ${m.title}：实际 ${m.value} > 标准 ${m.outStandard}`)
      })
    } else {
      lines.push('    · 12 项子指标均未超标准（无扣分项）')
      lines.push(`    · 但当前分 ${shopScore ?? '—'} 未必是满分：平台**不公开**总分构成，`)
      lines.push('      70 分可能是该店所在类目的基准分，也可能与销量/店铺权重相关。')
      lines.push('      **不要据此判断「店铺表现差」** —— 子项全绿就是健康信号。')
    }
    // ★ 降分提示：只有 showDecreaseInfos=true 且 desc 非空才是「真有降分原因」
    //   （实测本店 showPrompt=true 但 showDecreaseInfos=false、desc 为空 = 空壳提示，不是风险）
    const dp = score?.grow_score_info?.grow_shop_decrease_prompt
    if (dp?.showDecreaseInfos === true && (dp?.desc || dp?.subTitle)) {
      lines.push(`    · ⚠️ 平台提示降分：${dp.desc || dp.subTitle}`)
    }
    out.score.flaggedCount = flagged.length
    out.score.decreasePrompt = dp?.showDecreaseInfos === true && (dp?.desc || dp?.subTitle)
      ? { desc: dp.desc, subTitle: dp.subTitle }
      : null
    out.score.note = 'platform_does_not_expose_score_composition'

    out.text = lines.join('\n') || '店铺体验分：暂无数据'
  }
}

if (MODE === 'overview' || MODE === 'goods') {
  out.goodsCount = gCount ? {
    onsale: gCount.onsale ?? 0, draft: gCount.draft ?? 0, audit: gCount.audit ?? 0,
    forbidden: gCount.forbidden ?? 0, unpass: gCount.unpass ?? 0, sellOut: gCount.sell_out_new ?? 0,
  } : null
  out.goods = goodsItems
  out.items = goodsItems
  if (MODE === 'goods') {
    out.text = goodsItems.length
      ? `商品数据（${goodsItems.length} 个，按页面前 ${LIMIT} 条）：\n`
        + goodsItems.map((g, i) =>
          `  ${i + 1}. [${g.id}] ${String(g.name).slice(0, 26)}`
          + `\n     销量=${g.sellNum ?? '—'} 价格带=${g.priceLower ?? '—'}~${g.priceHigher ?? '—'} 元`
          + `\n     状态=${g.status ?? '—'} 审核=${g.checkStatus ?? '—'} 类目=${g.cates.join('/') || '—'}`,
        ).join('\n')
      : '商品数据：暂无明细'
  }
}

if (MODE === 'overview') {
  lines.length = 0
  lines.push('店铺经营总览：')
  if (shopName) lines.push(`  店铺：${shopName}${out.score?.category ? `（${out.score.category}）` : ''}`)
  if (shopScore != null) lines.push(`  体验分：${shopScore}${out.score?.yesterday != null ? `（昨日 ${out.score.yesterday}）` : ''}`)
  if (out.goodsCount) {
    lines.push(`  商品：在售 ${out.goodsCount.onsale} | 草稿 ${out.goodsCount.draft} | 审核中 ${out.goodsCount.audit}`
      + ` | 违规 ${out.goodsCount.forbidden} | 未通过 ${out.goodsCount.unpass}`)
  }
  if (goodsItems.length) {
    const top = goodsItems.slice().sort((a, b) => Number(b.sellNum || 0) - Number(a.sellNum || 0))[0]
    lines.push(`  销量最高商品：[${top.id}] ${String(top.name).slice(0, 24)}`
      + `（销量 ${top.sellNum ?? '—'}，价格带 ${top.priceLower ?? '—'}~${top.priceHigher ?? '—'} 元）`)
  }
  out.text = lines.join('\n')
}

emit(out)
process.exit(0)
