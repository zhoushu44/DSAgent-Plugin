#!/usr/bin/env node
/**
 * 抖音小店·商品查询（douyin-goods）—— 只读
 *
 * ══════════════════════════════════════════════════════════════════
 * 2026-11-11 改造：从「开页面 + 拦响应」改为「纯 Node 直连」
 * ══════════════════════════════════════════════════════════════════
 * 改造前：goto 商品页 + sleep(12000) + CDP hook 响应   → 约 12~15s/次
 * 改造后：基座 request() 纯 Node 直连                 → 约 200~450ms/次
 *
 * 依据：_douyin_node_probe/REPORT.md（抖店只读免签，8/8 实测通过）
 *
 * 能力：
 *   overview   商品总览（在售/未在售计数 + 前 N 条明细）
 *   list       商品列表（商品ID/标题/类目/SKU数/价格带/在售状态）
 *   config     商品页配置（类目选项 / 运费模板 / 商品分组 / 整改信息）
 *
 * 仍未实现（接口未探测确认，明确失败不假装支持）：
 *   detail / sku / spec-pool
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
const log = (msg) => console.error('[douyin-goods] ' + msg)

// ── 基座 ──────────────────────────────────────────────────
const { loadAccount } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-request.mjs')))
const { withDouyinGuard } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-guard.mjs')))

// ── 账号选择 ──────────────────────────────────────────────
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

// ── 前置校验 ──────────────────────────────────────────────
if (['detail', 'sku', 'spec-pool'].includes(MODE)) {
  fail('api_error',
    `mode=${MODE} 尚未实现：单商品详情 / SKU / 规格池接口未在探测中确认`
    + `（需打开 /ffa/g/detail 页面单独抓包）。当前可用：overview / list / config。`,
    { mode: MODE, available: ['overview', 'list', 'config'] })
}
if (!['overview', 'list', 'config'].includes(MODE)) {
  fail('api_error', `未知或未实现的 mode：${MODE}。当前可用：overview / list / config`, { mode: MODE })
}

// 状态映射：对外 onSale/offSale/draft/audit/soldOut → 接口 tab 同名
const TAB = (STATUS && STATUS !== 'all') ? STATUS : 'onSale'

// ══════════════════════════════════════════════════════════════
// 取数：纯 Node
// ══════════════════════════════════════════════════════════════
let cntRes = null
let listRes = null
let cfgRes = null

await withDouyinGuard('douyin-goods', account.shop_key, async (g) => {
  if (MODE === 'config') {
    const [cate, freight, groups, rectify] = await Promise.all([
      g.call('goods.categoryOptions', {}, { account }),
      g.call('goods.freightTemplates', {}, { account }),
      g.call('goods.groupList', {}, { account }),
      g.call('goods.rectifyInfo', {}, { account }),
    ])
    cfgRes = { cate, freight, groups, rectify }
    const bad = Object.entries(cfgRes).find(([, r]) => !r.ok)
    if (bad) {
      fail(bad[1].errorKind === 'session' ? 'token_expired' : 'api_error',
        `配置接口 ${bad[0]} 失败（${bad[1].errorKind}）：${bad[1].msg || bad[1].message || ''}`)
    }
    return
  }

  cntRes = await g.call('goods.count', {}, { account })
  if (!cntRes.ok) {
    fail(cntRes.errorKind === 'session' ? 'token_expired' : 'api_error',
      `商品计数接口失败（${cntRes.errorKind}）：${cntRes.msg || cntRes.message || ''}`
      + (cntRes.hint ? `\n提示：${cntRes.hint}` : ''),
      { st: cntRes.st, code: cntRes.code, url: cntRes.url })
  }

  listRes = await g.call('goods.list', { page: 0, pageSize: LIMIT, tab: TAB }, { account })
  if (!listRes.ok) {
    fail(listRes.errorKind === 'session' ? 'token_expired' : 'api_error',
      `商品列表接口失败（${listRes.errorKind}）：${listRes.msg || listRes.message || ''}`
      + (listRes.hint ? `\n提示：${listRes.hint}` : ''),
      { st: listRes.st, code: listRes.code, url: listRes.url })
  }
})

// ══════════════════════════════════════════════════════════════
// config 模式输出
// ══════════════════════════════════════════════════════════════
if (MODE === 'config') {
  const cateArr = cfgRes.cate.data
  const freightArr = cfgRes.freight.data
  const groupsArr = cfgRes.groups.data
  const rectify = cfgRes.rectify.data
  const out = {
    ok: true, mode: 'config', shopKey: account.shop_key,
    categoryOptions: Array.isArray(cateArr) ? cateArr.length : (cateArr ? Object.keys(cateArr).length : 0),
    freightTemplates: Array.isArray(freightArr) ? freightArr.length : 0,
    productGroups: Array.isArray(groupsArr) ? groupsArr.length : 0,
    rectifyInfo: rectify ?? null,
    perf: {
      cateMs: cfgRes.cate.ms, freightMs: cfgRes.freight.ms,
      groupsMs: cfgRes.groups.ms, rectifyMs: cfgRes.rectify.ms,
    },
    categories: Array.isArray(cateArr) ? cateArr.slice(0, 40) : cateArr,
    freightList: Array.isArray(freightArr) ? freightArr : [],
  }
  const lines = [
    '商品页配置：',
    `  类目选项 ${out.categoryOptions} 条 | 运费模板 ${out.freightTemplates} 个 | 商品分组 ${out.productGroups} 个`,
  ]
  if (rectify) {
    lines.push(`  整改：可自动整改=${rectify.is_shop_grant_auto_rectification ?? '—'}`
      + ` | 待整改商品 ${rectify.rectify_product_count ?? 0}`)
  }
  out.text = lines.join('\n')
  emit(out)
  process.exit(0)
}

// ══════════════════════════════════════════════════════════════
// 解析（口径与改造前一致）
// ══════════════════════════════════════════════════════════════
const gCount = cntRes?.data || null
const gListRaw = listRes?.data
const gArr = Array.isArray(gListRaw) ? gListRaw
  : Array.isArray(gListRaw?.list) ? gListRaw.list
  : Array.isArray(gListRaw?.items) ? gListRaw.items : []

// 金额一律「分 → 元」
const yuan = (v) => (v == null || v === '') ? null : (Number(v) / 100)

const listItems = gArr.slice(0, LIMIT).map((g) => ({
  id: g.product_id ?? g.id ?? null,
  name: g.name ?? g.title ?? '',
  img: g.img ?? null,
  sellNum: g.sell_num ?? null,
  priceLower: yuan(g.price_lower),
  priceHigher: yuan(g.price_higher),
  marketPrice: yuan(g.market_price),
  discountPrice: yuan(g.discount_price),
  status: g.status ?? null,
  checkStatus: g.check_status ?? null,
  draftStatus: g.draft_status ?? null,
  cates: [g.first_cid, g.second_cid, g.third_cid].filter((v) => v != null),
  specId: g.spec_id ?? null,
  createTime: g.create_time ?? null,
  updateTime: g.update_time ?? null,
  productUrl: g.product_url ?? null,
}))

const out = { ok: true, mode: MODE, shopKey: account.shop_key, items: [] }
const lines = []

out.goodsCount = gCount ? {
  onsale: gCount.onsale ?? 0, draft: gCount.draft ?? 0, audit: gCount.audit ?? 0,
  forbidden: gCount.forbidden ?? 0, unpass: gCount.unpass ?? 0,
  unpassNew: gCount.unpass_new ?? 0, sellOut: gCount.sell_out_new ?? 0,
} : null
out.total = gCount ? (gCount.onsale ?? 0) : gArr.length
out.items = listItems
out.perf = {
  countMs: cntRes?.ms ?? null,
  listMs: listRes?.ms ?? null,
  cookieFilledFromProfile: listRes?.cookiesFilledFromProfile ?? 0,
}

const head = MODE === 'overview' ? '商品总览：' : `商品列表（${listItems.length} 条）：`
lines.push(head)
if (gCount) {
  lines.push(`  在售 ${gCount.onsale ?? 0} | 草稿 ${gCount.draft ?? 0} | 审核中 ${gCount.audit ?? 0}`
    + ` | 违规 ${gCount.forbidden ?? 0} | 未通过 ${gCount.unpass ?? 0}`
    + ` | 已售罄 ${gCount.sell_out_new ?? 0}`)
}
if (listItems.length) {
  lines.push('')
  listItems.slice(0, MODE === 'overview' ? 10 : LIMIT).forEach((g, i) => {
    lines.push(`  ${i + 1}. [${g.id}] ${String(g.name).slice(0, 30)}`)
    lines.push(`     销量=${g.sellNum ?? '—'} 价格带=${g.priceLower ?? '—'}~${g.priceHigher ?? '—'} 元`
      + ` 状态=${g.status ?? '—'} 审核=${g.checkStatus ?? '—'}`)
  })
}
out.text = lines.join('\n') || (MODE === 'overview' ? '商品总览：暂无数据' : '商品列表：暂无数据')

emit(out)
process.exit(0)
