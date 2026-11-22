#!/usr/bin/env node
/**
 * 抖音小店·营销活动查询（douyin-activity）—— 只读
 *
 * ══════════════════════════════════════════════════════════════════
 * 2026-11-11 改造 + 重新定位
 * ══════════════════════════════════════════════════════════════════
 * 【改造前】goto 页面 hook 响应，但 4 个接口全是 TODO 占位 → 永远返回"接口待回填"
 * 【改造后】纯 Node，真实可用接口
 *
 * ★ 重要重新定位（实测发现）：
 *   本账号 get_activity_gray = { enable: false, membership: false, msg: "无该配置" }
 *   → 该店铺**没有【平台活动报名】权限**（抖音大促/秒杀等官方活动）
 *   → 但有【自建营销工具】权限，共 24 个（单品直降/优惠券/满减/赠品/裂变…）
 *
 *   所以本技能从「平台活动报名」改为「营销活动 & 工具」：
 *     tools     营销工具清单（24 个，含入口 URL / 描述 / 场景）
 *     overview  营销总览（权限 + 工具数 + 满减活动数 + 推广数据）
 *     list      满减/多件优惠活动列表
 *     data      营销推广数据
 *     perm      活动报名权限自检
 *
 *   如果将来这个账号拿到平台活动权限（enable=true），再补报名类接口。
 *
 * 报名（enroll）/ 取消（quit）仍是 L2 写操作，**未实现**且明确拒绝。
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
const LIMIT = Math.min(100, Math.max(1, parseInt(ARGS.limit || '20', 10) || 20))
const ACCOUNT = (ARGS.account || '').trim()
const ACTIVITY_STATUS = ARGS.status !== undefined ? parseInt(ARGS.status, 10) : 0

function emit(payload) {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n')
}
function fail(kind, message, extra = {}) {
  emit({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })
  process.exit(1)
}
const log = (msg) => console.error('[douyin-activity] ' + msg)

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

const WRITE_MODES = ['enroll', 'quit', 'signup']
if (WRITE_MODES.includes(MODE)) {
  fail('api_error',
    `mode=${MODE} 是 L2 写操作，本版未实现（需 --confirm 门禁 + 真实提交链路）。`
    + `另：本账号 get_activity_gray.enable=false，无平台活动报名权限。`,
    { mode: MODE, available: ['overview', 'tools', 'list', 'data', 'perm'] })
}
if (!['overview', 'tools', 'list', 'data', 'perm'].includes(MODE)) {
  fail('api_error', `未知 mode：${MODE}。可用：overview / tools / list / data / perm`, { mode: MODE })
}

// ══════════════════════════════════════════════════════════════
// 取数
// ══════════════════════════════════════════════════════════════
const R = { gray: null, tools: null, list: null, data: null }

await withDouyinGuard('douyin-activity', account.shop_key, async (g) => {
  const calls = []
  if (MODE === 'overview' || MODE === 'perm') calls.push(['gray', 'marketing.activityGray', {}])
  if (MODE === 'overview' || MODE === 'tools') calls.push(['tools', 'marketing.tools', {}])
  if (MODE === 'overview' || MODE === 'list') calls.push(['list', 'marketing.fullDiscount', { activity_status: ACTIVITY_STATUS, page: 1, pageSize: LIMIT }])
  if (MODE === 'overview' || MODE === 'data') calls.push(['data', 'marketing.promoData', { source_type: 1, date_type: 7, from_platform: 1, appid: 1 }])

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
// 解析
// ══════════════════════════════════════════════════════════════
const gray = R.gray?.data || null
const toolsData = R.tools?.data || null
const listData = R.list?.data || null
const promoData = R.data?.data || null

const toolCards = (toolsData?.tool_cards || []).map((c) => ({
  name: c.strategy_name,
  desc: c.strategy_desc,
  toolId: c.strategy_tool,
  listUrl: c.activity_list_url,
  jumpUrl: c.jump_url,
  tags: c.tool_tags || [],
  scenes: c.applicable_scene || [],
  noPermission: c.no_permission_verify === true,
}))
const toolCates = (toolsData?.tool_cates || []).map((c) => ({ label: c.label, count: (c.strategy_tools || []).length }))

const out = { ok: true, mode: MODE, shopKey: account.shop_key }
const lines = []
out.perf = Object.fromEntries(Object.entries(R).filter(([, v]) => v).map(([k, v]) => [k + 'Ms', v.ms]))

// 权限（贯穿所有模式都告知）
const hasPlatformActivity = gray?.enable === true || gray?.membership === true
out.activityPermission = {
  enable: gray?.enable ?? null,
  membership: gray?.membership ?? null,
  note: hasPlatformActivity
    ? '有平台活动报名权限'
    : '无平台活动报名权限（get_activity_gray.enable=false）；可用的是自建营销工具',
}

if (MODE === 'perm') {
  out.gray = gray
  lines.push('活动报名权限自检：')
  lines.push(`  enable=${gray?.enable ?? '—'}  membership=${gray?.membership ?? '—'}`)
  lines.push(`  ${out.activityPermission.note}`)
  out.text = lines.join('\n')
}

if (MODE === 'overview' || MODE === 'tools') {
  out.tools = toolCards
  out.toolCates = toolCates
  out.toolCount = toolCards.length
  if (MODE === 'tools') {
    lines.push(`营销工具（${toolCards.length} 个）：`)
    for (const t of toolCards) {
      lines.push(`  · ${t.name}${t.tags.length ? `（${t.tags.join('/')}）` : ''}`)
      if (t.desc) lines.push(`      ${t.desc}`)
      if (t.listUrl) lines.push(`      入口：${t.listUrl}`)
    }
    if (!hasPlatformActivity) {
      lines.push('')
      lines.push('注：本账号无「平台活动报名」权限（大促/秒杀等官方活动），以上为自建营销工具。')
    }
    out.text = lines.join('\n')
  }
}

if (MODE === 'overview' || MODE === 'list') {
  out.total = listData?.total ?? 0
  out.page = listData?.page ?? null
  out.size = listData?.size ?? null
  out.activityStatus = ACTIVITY_STATUS
  // 满减活动列表本体（接口返回里除 total/page/size 外的字段）
  const listItems = listData?.activity_list || listData?.list || listData?.items || []
  out.activities = Array.isArray(listItems) ? listItems.slice(0, LIMIT) : []
  if (MODE === 'list') {
    lines.push(`满减/多件优惠活动（status=${ACTIVITY_STATUS}，共 ${out.total} 个）：`)
    if (out.activities.length) {
      out.activities.forEach((a, i) => {
        lines.push(`  ${i + 1}. [${a.activity_id ?? a.id ?? '—'}] ${a.activity_name ?? a.name ?? a.title ?? '—'}`)
        if (a.start_time || a.end_time) lines.push(`     时间：${a.start_time ?? '—'} ~ ${a.end_time ?? '—'}`)
      })
    } else {
      lines.push('  暂无活动（该状态下列表为空）')
    }
    out.text = lines.join('\n')
  }
}

if (MODE === 'overview' || MODE === 'data') {
  out.promoData = promoData
  if (MODE === 'data') {
    lines.push('营销推广数据（近 7 天）：')
    const stats = promoData?.stats_data || {}
    if (Object.keys(stats).length) {
      for (const [k, v] of Object.entries(stats).slice(0, 20)) {
        const val = (v && typeof v === 'object') ? JSON.stringify(v).slice(0, 60) : v
        lines.push(`  ${k}：${val}`)
      }
    } else {
      lines.push('  暂无数据')
    }
    out.text = lines.join('\n')
  }
}

if (MODE === 'overview') {
  lines.length = 0
  lines.push('营销活动总览：')
  lines.push(`  平台活动报名权限：${hasPlatformActivity ? '有' : '无'}`)
  lines.push(`  自建营销工具：${toolCards.length} 个`)
  lines.push(`  满减/多件优惠活动：${out.total ?? 0} 个`)
  if (toolCards.length) {
    const names = toolCards.slice(0, 8).map((t) => t.name).join('、')
    lines.push(`  常用工具：${names}${toolCards.length > 8 ? ' 等' : ''}`)
  }
  if (promoData?.stats_data) {
    const keys = Object.keys(promoData.stats_data)
    if (keys.length) lines.push(`  推广数据字段：${keys.slice(0, 6).join('、')}`)
  }
  if (!hasPlatformActivity) {
    lines.push('')
    lines.push('提示：该店铺无平台活动报名权限，营销动作走「自建营销工具」（单品直降/优惠券/满减等）。')
  }
  out.text = lines.join('\n')
}

emit(out)
process.exit(0)
