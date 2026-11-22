#!/usr/bin/env node
/**
 * 抖音·全域投放计划管理（douyin-plan-ops）v2.0
 *
 * ══════════════════════════════════════════════════════════════
 * ★ 2026-11-12 重写：浏览器 → 纯 Node HTTP
 * ══════════════════════════════════════════════════════════════
 * 旧版问题（实测复现）：
 *   · --mode list 走浏览器 safeEval 调接口，浏览器链路一失败就静默返回 []
 *     → 明明有 1 条计划，却报「计划数：0」，且不报错
 *   · 启停走「找 .ovui-switch 点击」，依赖 DOM 结构，页面一改版就废
 *   · 每次要起 Chrome，15~20 秒
 *
 * 新版（实测）：
 *   · 同一份 body 直接 HTTP → adInfos=1，正常返回
 *   · 启停接口 batch_update_operation 纯 HTTP → code=0，flag=true
 *   · 浏览器全关也能跑通，耗时 ~1 秒
 *
 * 数据源（全部实测）：
 *   POST /ad/api/pmc/v1/uni-promotion/ad/list-required   计划列表
 *   POST /ad/api/pmc/v1/batch_update_operation           计划启停
 *
 * 计划状态：adDeliveryType === 0 → 投放中；!== 0 → 已暂停
 * 启停 optType：1 = 开启（Enable），2 = 暂停（Pause）
 */
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = process.env.DSAGENT_PLUGIN_ROOT || join(HERE, '..', '..', '..')
const PURL = (p) => pathToFileURL(p).href
const ORIGIN = 'https://qianchuan.jinritemai.com'

/* ── 参数 ─────────────────────────────────────────────────── */
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

const MODE = String(ARGS.mode || 'list').trim()
const ACCOUNT = String(ARGS.account || '').trim()
const AD_ID = String(ARGS.ad_id || ARGS.adId || '').trim()
const LIMIT = Math.min(100, Math.max(1, parseInt(ARGS.limit || '20', 10) || 20))
const MAR_GOAL = String(ARGS.mar_goal || ARGS.goal || '1').trim()
const CONFIRM = String(ARGS.confirm) === 'true'

const pad = (n) => String(n).padStart(2, '0')
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = new Date()
const START = String(ARGS.start || fmtDate(today)).trim()
const END = String(ARGS.end || START).trim()

/* ── 输出 ─────────────────────────────────────────────────── */
function emit(payload) {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n')
}
function fail(kind, message, extra = {}) {
  emit({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })
  process.exit(0)
}

/* ── 凭证 ─────────────────────────────────────────────────── */
let CK = ''
let SHOP_KEY = ''
try {
  const { CredentialStore } = await import(PURL(join(PLUGIN_ROOT, 'lib', 'services', 'credential-store.js')))
  const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
  const accounts = store.listAccounts().filter((a) => a.platform === 'douyin_shop' && a.status !== 'invalid')
  if (!accounts.length) {
    fail('not_bound', '未找到抖音小店账号。请到「账号连接」页面添加「抖店」账号（platform=douyin_shop）。')
  }
  let account
  if (ACCOUNT) {
    account = accounts.find((a) => a.shop_key === ACCOUNT)
    if (!account) {
      fail('bad_input', `账号 shopKey 不存在：${ACCOUNT}。可用：${accounts.map((a) => a.shop_key).join(' / ')}`)
    }
  } else if (accounts.length === 1) {
    account = accounts[0]
  } else {
    fail('need_account_choice',
      `抖音平台有 ${accounts.length} 个可用账号，请指定 --account：\n`
      + accounts.map((a, i) => `${i + 1}. ${a.shop_name || a.nickname || ''}（${a.shop_key}）`).join('\n'),
      { candidates: accounts.map((a) => ({ shopKey: a.shop_key, shopName: a.shop_name || a.nickname || '' })) })
  }
  SHOP_KEY = account.shop_key
  CK = Object.entries(account.cookies || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${v}`).join('; ')
} catch (e) {
  fail('api_error', '读取凭证失败：' + String(e?.message || e).slice(0, 200))
}

/* ── HTTP ─────────────────────────────────────────────────── */
async function req(method, path, body) {
  const headers = {
    accept: 'application/json, text/plain, */*',
    origin: ORIGIN,
    referer: ORIGIN + '/uni-prom',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
    cookie: CK,
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const r = await fetch(ORIGIN + path, {
    method, headers, redirect: 'manual',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const t = await r.text()
  let j = null; try { j = JSON.parse(t) } catch { }
  return {
    status: r.status,
    code: j?.code ?? j?.status_code,
    msg: j?.msg || j?.message || '',
    data: j?.data,
    raw: t.slice(0, 400),
  }
}

/* ── 账户 ID ──────────────────────────────────────────────── */
let _avid = ''
async function resolveAavid() {
  if (_avid) return _avid
  const r = await req('GET', '/ad/api/v1/account/account-info/get-customer-id')
  if (r.code === 0 || r.code === '0') {
    const d = r.data?.detail
    const first = Array.isArray(d) ? d[0] : d
    const id = first?.accountId || first?.account_id
    if (id) { _avid = String(id); return _avid }
  }
  fail('api_error', '未能取到千川账户 ID（aavid）：' + (r.msg || ''), { code: r.code })
}

/* ── 计划列表 ─────────────────────────────────────────────── */
async function fetchPlans() {
  const AVID = await resolveAavid()
  const body = {
    _origin_ajax_: 1,
    UseNewChain: true,
    Params: {
      AdFilter: {
        AdlabScene: 0,
        DataTimeRange: { StartTime: START + ' 00:00:00', EndTime: END + ' 23:59:59' },
        MarGoal: Number(MAR_GOAL),
        SmartBidType: 0,
        UniPromShopFilter: { UniPromShopView: 1 },
      },
      PageParams: { Page: 1, PageSize: LIMIT },
      ListAdsModules: [36, 7, 53, 10],
      OrderBy: { Field: 'stat_cost_for_roi2', Type: 2 },
      Metrics: ['stat_cost_for_roi2'],
      SophonxDataSetKey: 'overall_roi_promotion_list_for_product',
    },
    aavid: AVID,
  }
  const r = await req('POST', '/ad/api/pmc/v1/uni-promotion/ad/list-required', body)
  if (r.code !== 0 && r.code !== '0') {
    fail('api_error', '获取计划列表失败：' + (r.msg || r.raw), { code: r.code })
  }
  const ads = r.data?.adInfos || []
  const statsMap = r.data?.adStatsMap || {}
  const goodsMap = r.data?.adGoodsMap || {}
  return { aavid: AVID, ads, statsMap, goodsMap }
}

/* ── 计划解析 ─────────────────────────────────────────────── */
// 金额单位：budget="30000000" → 页面显示 300 元，换算 /100000
const yuan = (v) => { const n = Number(v); return Number.isFinite(n) ? n / 100000 : null }
const ts2date = (t) => {
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString().slice(0, 19).replace('T', ' ') : null
}
const STATUS_NAME = { 0: '投放中', 1: '已暂停', 2: '已结束', 3: '审核中', 4: '预算不足', 5: '已暂停' }

function parsePlan(ad, statsMap, goodsMap) {
  const op = ad.operation || {}
  const stats = (statsMap || {})[ad.id]?.metrics || {}
  const goods = (goodsMap || {})[ad.id] || []
  const statusCode = Number(ad.adDeliveryType)
  return {
    adId: String(ad.id),
    name: ad.name,
    status: ad.adDeliveryName || STATUS_NAME[statusCode] || (statusCode === 0 ? '投放中' : '已暂停'),
    statusCode,
    isRunning: statusCode === 0,
    marGoal: ad.marGoal,
    marGoalName: Number(ad.marGoal) === 2 ? '推直播间' : '推商品',
    budget: yuan(ad.budget),
    budgetMode: ad.budgetMode,
    roiGoal: ad.ecpRoi2Goal ?? null,
    externalAction: ad.externalAction,
    externalActionName: ad.externalActionName,
    deepExternalAction: ad.deepExternalAction,
    deepExternalActionName: ad.deepExternalActionName,
    smartBidType: ad.smartBidType,
    qcpxMode: ad.qcpxMode,
    isMultiProduct: ad.isMultiProduct ?? null,
    productCount: goods.length,
    productIds: goods.map((g) => String(g.id || g.productId || '')).filter(Boolean),
    createTime: ts2date(ad.createTime),
    modifyTime: ts2date(ad.modifyTime),
    cost: stats.statCostForRoi2 ? Number(stats.statCostForRoi2.valueStr) : null,
    canOptStatus: op.optStatusOperation?.editable ?? null,
    canEdit: op.editOperation?.editable ?? null,
    canEditBudget: op.budgetEditOperation?.editable ?? null,
    canEditRoi: op.roi2GoalOperation?.editable ?? null,
    canCopy: op.copyOperation?.copyable ?? null,
    optMsg: op.optStatusOperation?.msg || '',
  }
}

/* ── 计划启停 ─────────────────────────────────────────────── */
async function setPlanStatus(adId, enable) {
  // optType: 1=启用（Enable），2=暂停（Pause）
  const body = { objects: [{ objectID: String(adId), type: 1 }], optType: enable ? 1 : 2 }
  const r = await req('POST', '/ad/api/pmc/v1/batch_update_operation', body)
  const okFlag = r.data?.results?.some((x) => x.flag === true) ?? false
  return { ok: (r.code === 0 || r.code === '0') && okFlag, code: r.code, msg: r.msg, data: r.data, body }
}

/* ══════════════════════════════════════════════════════════
 * 主流程
 * ══════════════════════════════════════════════════════════ */
try {
  const out = { ok: true, mode: MODE, shopKey: SHOP_KEY }

  /* ── list ───────────────────────────────────────────── */
  if (MODE === 'list') {
    const { aavid, ads, statsMap, goodsMap } = await fetchPlans()
    const plans = ads.map((a) => parsePlan(a, statsMap, goodsMap))
    out.aavid = aavid
    out.plans = plans
    out.items = plans
    out.total = plans.length

    const lines = []
    lines.push(`全域投放计划（${MAR_GOAL === '2' ? '推直播间' : '推商品'}｜${START} ~ ${END}）：`)
    lines.push(`  账户 aavid：${aavid}`)
    lines.push(`  计划数：${plans.length}`)
    lines.push('')
    if (plans.length) {
      for (const p of plans) {
        lines.push(`  · ${p.name}`)
        lines.push(`     ID：${p.adId}｜状态：${p.status}${p.isRunning ? '（在投）' : ''}`)
        lines.push(`     预算：${p.budget == null ? '—' : p.budget + ' 元/日'}`
          + `｜ROI目标：${p.roiGoal ?? '—'}`
          + `｜转化：${p.deepExternalActionName || p.externalActionName || '—'}`)
        lines.push(`     消耗：${p.cost ?? '—'} 元｜商品数：${p.productCount}`
          + `｜创建：${p.createTime ?? '—'}`)
        lines.push(`     启停权限：${p.canOptStatus ? '✅' : '❌'}｜编辑：${p.canEdit ? '✅' : '❌'}`
          + `｜改预算：${p.canEditBudget ? '✅' : '❌'}`)
      }
    } else {
      lines.push('  （无计划）')
      lines.push(`  若页面显示有计划但这里为空，可用 --mar_goal ${MAR_GOAL === '1' ? '2' : '1'} 切换到`
        + `${MAR_GOAL === '1' ? '推直播间' : '推商品'}看看；`)
      lines.push('  或放宽 --start / --end 时间范围。')
    }
    out.text = lines.join('\n')
    emit(out)
  }

  /* ── stop / start ───────────────────────────────────── */
  else if (MODE === 'stop' || MODE === 'start') {
    if (!AD_ID) {
      fail('bad_input', `${MODE} 模式需要 --ad_id 参数。可先用 --mode list 查看计划 ID。`,
        { available: ['list', 'stop', 'start'] })
    }

    const { aavid, ads, statsMap, goodsMap } = await fetchPlans()
    const target = ads.find((a) => String(a.id) === String(AD_ID))
    if (!target) {
      fail('bad_input', `未找到计划 ${AD_ID}。当前列表共 ${ads.length} 条：`
        + ads.map((a) => `${a.name}(${a.id})`).join('、'),
        { requestedAdId: AD_ID, available: ads.map((a) => ({ id: String(a.id), name: a.name, status: a.adDeliveryName })) })
    }

    const plan = parsePlan(target, statsMap, goodsMap)
    out.aavid = aavid
    out.plan = plan
    out.action = MODE

    if (plan.canOptStatus === false) {
      fail('permission_denied', `计划「${plan.name}」不允许启停。平台提示：${plan.optMsg || '（无）'}`, { plan })
    }

    const wantRun = MODE === 'start'
    if (plan.isRunning === wantRun) {
      out.noop = true
      out.text = `计划「${plan.name}」（${plan.adId}）当前已是「${plan.status}」，无需${wantRun ? '开启' : '暂停'}。`
      emit(out)
      process.exit(0)
    }

    if (!CONFIRM) {
      out.pending = true
      out.preview = {
        adId: plan.adId,
        from: plan.status,
        to: wantRun ? '投放中' : '已暂停',
        request: { objects: [{ objectID: plan.adId, type: 1 }], optType: wantRun ? 1 : 2 },
      }
      out.text = [
        `【预览】${wantRun ? '开启' : '暂停'}计划：`,
        `  计划名称：${plan.name}`,
        `  计划 ID  ：${plan.adId}`,
        `  当前状态：${plan.status}`,
        `  操作后   ：${wantRun ? '投放中' : '已暂停'}`,
        `  每日预算：${plan.budget == null ? '—' : plan.budget + ' 元'}`,
        `  ROI 目标 ：${plan.roiGoal ?? '—'}`,
        `  今日消耗 ：${plan.cost ?? '—'} 元`,
        '',
        '  执行方式：POST /ad/api/pmc/v1/batch_update_operation（纯 HTTP，无浏览器）',
        '  确认执行请加 --confirm true',
      ].join('\n')
      emit(out)
      process.exit(0)   // ★ L2 门禁：预览后必须退出，绝不能继续执行
    }

    /* 执行 */
    const r = await setPlanStatus(plan.adId, wantRun)
    if (!r.ok) {
      out.ok = false
      out.failureKind = 'api_error'
      out.failure_kind = 'api_error'
      out.code = r.code
      out.msg = r.msg
      out.text = `${wantRun ? '开启' : '暂停'}计划失败：${r.msg || r.raw}（code=${r.code}）`
      emit(out)
      process.exit(0)
    }

    /* 回读验证 */
    await new Promise((s) => setTimeout(s, 1200))
    const after = await fetchPlans()
    const afterAd = after.ads.find((a) => String(a.id) === String(plan.adId))
    const afterPlan = afterAd ? parsePlan(afterAd, after.statsMap, after.goodsMap) : null

    out.verified = afterPlan ? afterPlan.isRunning === wantRun : false
    out.after = afterPlan ? { status: afterPlan.status, statusCode: afterPlan.statusCode, isRunning: afterPlan.isRunning } : null
    out.text = [
      `✅ ${wantRun ? '开启' : '暂停'}成功`,
      `  计划：${plan.name}（${plan.adId}）`,
      `  ${plan.status} → ${afterPlan?.status || (wantRun ? '投放中' : '已暂停')}`,
      `  回读校验：${out.verified ? '通过 ✅' : '⚠️ 状态未如预期，请刷新后台确认'}`,
    ].join('\n')
    emit(out)
  }

  /* ── 其他 ───────────────────────────────────────────── */
  else {
    fail('bad_input', `未知 mode：${MODE}。可用：list / stop / start`)
  }
} catch (e) {
  fail('api_error', '计划管理异常：' + String(e?.message || e).slice(0, 300))
}
