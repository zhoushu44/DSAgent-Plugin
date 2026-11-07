#!/usr/bin/env node
/**
 * 抖音·素材分析报表（douyin-material-report）
 *
 * 逆向自千川「数据 → 全域数据 → 素材数据 → 素材分析」页
 * 路由：/dataV3/roi2-material-analysis
 *
 * 数据源（实测 2026-10-24）：
 *   POST /ad/api/data/v1/common/statQuery
 *     DataSetKey: roi2_video_material_analysis
 * 与投放报表同源（都是 statQuery 引擎），只是 DataSetKey 与维度换成素材维度。
 *
 * 素材类型（material_type，对应页面 tab）：
 *   3 = 视频素材（默认）   1 = 直播间画面   2 = 图片素材
 *   4 = 图文素材           5 = 标题素材
 *
 * 指标分五组，共 47 个：
 *   消耗    stat_cost_for_roi2 / basic_stat_cost_for_roi2_v2 / stat_cost_for_overall_roi2
 *   成交    GMV(含/不含优惠券) / 成交订单数 / 订单成本 / 支付ROI / 整体ROI
 *   结算    结算金额 / 结算率 / 1小时退款订单数 / 退款金额 / 退款率
 *   效率    CPC(点击单价) / ECPM(千次展现费用) / 优惠券金额 / 平台补贴金额
 *   视频质量 2s/3s/5s/10s播放率 / 完播率 / 播放次数 / 平均观看时长 / 点赞 / 关注 / 评论
 *   追投    additional_delivery_* 系列
 *
 * 实现要点（都是实测踩过的坑）：
 *   1. 入口必须用 dataV3/roi2-material-analysis，用别的路由这个 DataSetKey 不放行
 *   2. 不能 setCookie 注入账号 cookies——里面的 sessionid 是本地 hash，
 *      注入会覆盖 profile 里 Chrome 持久化的有效 Cookie，直接被踢到巨量引擎登录页
 *   3. CDP 必须在 page.goto() 之后挂，SPA 重定向会换 target
 *   4. taskkill 杀不掉已存在的 Chrome，必须 Stop-Process（否则启动报
 *      "Failed to launch the browser process"）
 *   5. 指标值要区分 '-'（无数据）和 '0.00'（真的是 0）
 *
 * 用法：
 *   node scripts/material-report.mjs --start 2026-07-26 --end 2026-10-24
 *   node scripts/material-report.mjs --material_type 2      # 图片素材
 *   node scripts/material-report.mjs --mar_goal 2           # 推直播维度
 */

import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
// scripts/ → <skill>/ → skills/ → 插件根，退三级
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

const ACCOUNT = (ARGS.account || '').trim()
const LIMIT = Math.min(100, Math.max(1, parseInt(ARGS.limit || '20', 10) || 20))
const OFFSET = Math.max(0, parseInt(ARGS.offset || '0', 10) || 0)
const today = () => {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}
const START = (ARGS.start || today()).trim()
const END = (ARGS.end || START).trim()
// material_type: 3=视频素材(默认) 1=直播间画面 2=图片 4=图文 5=标题
const MAT_TYPE = String(ARGS.material_type || '3').trim()
// mar_goal: 1=推商品(默认) 2=推直播间
const MAR_GOAL = String(ARGS.mar_goal || ARGS.goal || '1').trim()

// 必须是**单行** JSON：宿主按行读取 __DSAGENT_RESULT__ 协议
function emit(payload) {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n')
}
function fail(kind, message, extra = {}) {
  emit({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })
  process.exit(1)
}
const log = (msg) => console.error('[douyin-material-report] ' + msg)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── 账号与库加载 ──────────────────────────────────────────
let store, CredentialStore
let profileDir, findChromePath, tryAcquireProfile, releaseProfile, clearProfileLocks, applyAccountEnv, envOf
try {
  ;({ CredentialStore } = await import(PURL(join(PLUGIN_ROOT, 'lib', 'services', 'credential-store.js'))))
  ;({ profileDir, findChromePath, tryAcquireProfile, releaseProfile, clearProfileLocks, applyAccountEnv, envOf } =
    await import(PURL(join(PLUGIN_ROOT, 'lib', 'browser-login.js'))))
  store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
} catch (e) {
  fail('api_error', `无法加载插件库（${PLUGIN_ROOT}）：${e.message}`)
}

const accounts = store.listAccounts().filter((a) => a.platform === 'douyin_shop' && a.status !== 'invalid')
if (!accounts.length) {
  fail('not_bound', '未找到抖音小店账号。请到「账号连接」页面添加「抖店」账号（platform=douyin_shop）。')
}
let account
if (ACCOUNT) {
  account = accounts.find((a) => a.shop_key === ACCOUNT)
  if (!account) {
    fail('api_error', `账号 shopKey 不存在：${ACCOUNT}。可用：${accounts.map((a) => a.shop_key).join(' / ')}`)
  }
} else if (accounts.length === 1) {
  account = accounts[0]
} else {
  fail('need_account_choice',
    `抖音平台有 ${accounts.length} 个可用账号，请指定 --account：\n`
    + accounts.map((a, i) => `${i + 1}. ${a.nickname}（${a.shop_key}）`).join('\n'),
    { accounts: accounts.map((a) => ({ shop_key: a.shop_key, nickname: a.nickname })) })
}

const SHOP_KEY = account.shop_key
const pat = SHOP_KEY.replace(/[^a-zA-Z0-9]/g, '')

/** 杀孤儿 Chrome（taskkill 在本机对已存 Chrome 常静默失败，必须 Stop-Process） */
function killOrphanChrome() {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*${pat}*' } | Select-Object -ExpandProperty ProcessId"`,
      { encoding: 'utf8' }
    )
    const pids = out.split(/\r?\n/).map(s => parseInt(s.trim(), 10)).filter(Boolean)
    if (pids.length) {
      execSync(
        `powershell -NoProfile -Command "${pids.map(p => `Stop-Process -Id ${p} -Force -ErrorAction SilentlyContinue`).join('; ')}"`,
        { stdio: 'ignore' }
      )
    }
    return pids.length
  } catch { return 0 }
}

const dir = profileDir('douyin_shop', SHOP_KEY)
if (!tryAcquireProfile(dir, 'douyin-material-report')) {
  fail('api_error', '抖店/千川的浏览器环境正被其他任务占用，请稍后重试。')
}

// ★ 必须复用正式 profile 目录，不能用独立临时目录：
//   账号 cookies 里的 sessionid 是本地 session hash，注入会被千川判未登录。
const PROBE_DIR = dir

let browser = null
try {
  const puppeteer = await import(PURL(join(PLUGIN_ROOT, 'node_modules', 'puppeteer-core',
    'lib', 'esm', 'puppeteer', 'puppeteer-core.js')))
  const chromePath = findChromePath()
  if (!chromePath) fail('api_error', '未找到 Chrome 或 Edge 浏览器')

  killOrphanChrome()
  let lastErr = null
  for (let round = 0; round < 4 && !browser; round++) {
    if (round > 0) { await sleep(5000); killOrphanChrome() }
    clearProfileLocks(dir)
    try {
      browser = await puppeteer.default.launch({
        headless: false,
        executablePath: chromePath,
        userDataDir: PROBE_DIR,
        defaultViewport: { width: 1600, height: 1000 },
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1600,1000'],
      })
    } catch (e) { lastErr = e; log(`launch round ${round} fail`) }
  }
  if (!browser) throw lastErr || new Error('浏览器启动失败')

  let page = (await browser.pages())[0] || await browser.newPage()
  const env = envOf(account)
  if (env) await applyAccountEnv(page, env).catch(() => {})

  // ★ 不 setCookie 注入：会覆盖 profile 里有效的登录态，详见文件头注释第 2 条

  // ── CDP 响应捕获（goto 之后才挂） ──────────────────────
  const captured = []
  let cdp = null
  const attachCdp = async (p) => {
    try {
      const c = await p.target().createCDPSession()
      await c.send('Network.enable')
      const meta = new Map()
      c.on('Network.requestWillBeSent', e => { if (e.request?.postData) meta.set(e.requestId, e.request.postData) })
      c.on('Network.responseReceived', async e => {
        try {
          const u = e.response.url
          if (!/jinritemai\.com/.test(u)) return
          if (!/json|text|plain/.test(e.response.mimeType || '')) return
          const b = await c.send('Network.getResponseBody', { requestId: e.requestId }).catch(() => null)
          if (!b?.body) return
          captured.push({ url: u, status: e.response.status, postData: meta.get(e.requestId) || null, body: b.body })
        } catch { /* ignore */ }
      })
      return c
    } catch { return null }
  }

  // 入口：素材分析页（这个路由才会放行 roi2_video_material_analysis）
  const HOME = 'https://qianchuan.jinritemai.com/dataV3/roi2-material-analysis?aavid=1781536544329804'
  log('open ' + HOME)
  try { await page.evaluate(() => 1) } catch (e) {
    log('page unusable before goto, recreating:', String(e.message).split('\n')[0])
    try { await page.close() } catch { /* ignore */ }
    page = (await browser.pages())[0] || await browser.newPage()
    if (env) await applyAccountEnv(page, env).catch(() => {})
  }
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => log('goto: ' + e.message))
  cdp = await attachCdp(page)
  await sleep(16000)
  try { await page.evaluate(() => { window.scrollTo(0, 400) }); await sleep(4000) } catch { /* ignore */ }
  log('landed:', page.url(), '| captured:', captured.length)

  // 登录态判定（只认巨量引擎域登录页为真失效）
  const isRealLoginPage = (u) => /oceanengine\.com\/login/i.test(u || '')
  let finalUrl = ''
  for (let i = 0; i < 3; i++) {
    try { finalUrl = page.url() } catch { /* ignore */ }
    if (!isRealLoginPage(finalUrl)) break
    log('hit oceanengine login, reloading:', finalUrl)
    await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
    await sleep(9000)
  }
  try { finalUrl = page.url() } catch { /* ignore */ }
  if (isRealLoginPage(finalUrl)) {
    fail('token_expired', '千川后台登录态已失效，请到「账号连接」页面对该账号重新登录后重试。',
      { url: finalUrl })
  }

  // 提取千川广告主 ID（aavid）
  const extractAavid = () => {
    let m = page.url().match(/aavid=(\d{6,})/)
    if (m) return m[1]
    for (const c of captured) {
      m = c.url.match(/aavid=(\d{6,})/)
      if (m) return m[1]
    }
    for (const c of captured) {
      m = c.body.match(/"(?:advertiser_id|accountId|account_id)"\s*:\s*"?(\d{6,})/)
      if (m) return m[1]
    }
    return null
  }
  let AVID = extractAavid()
  if (!AVID) {
    try {
      const r = await page.evaluate(async () => {
        const res = await fetch('https://qianchuan.jinritemai.com/ad/api/v1/account/account-info/get-customer-id', { credentials: 'include' })
        return await res.text()
      })
      AVID = (r.match(/"accountId"\s*:\s*"?(\d{6,})/) || [])[1] || null
    } catch { /* ignore */ }
  }
  if (!AVID) {
    fail('api_error', '未能解析出千川账户 ID（aavid），可能登录态异常或页面未加载完成。', { url: finalUrl })
  }
  log('aavid =', AVID)

  // ── 取数辅助 ────────────────────────────────────────────
  const apiCall = async (path, body) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await page.evaluate(async ({ path, body }) => {
          const opts = { credentials: 'include', headers: { 'Content-Type': 'application/json' } }
          if (body) { opts.method = 'POST'; opts.body = JSON.stringify(body) }
          const res = await fetch('https://qianchuan.jinritemai.com' + path, opts)
          return await res.text()
        }, { path, body })
        try { return JSON.parse(r) } catch { return null }
      } catch (e) {
        log('apiCall fail', path, String(e.message).split('\n')[0])
        await sleep(2500)
      }
    }
    return null
  }

  // ── 构造请求体（47 指标全量） ───────────────────────────
  const body = {
    StartTime: START + ' 00:00:00',
    EndTime: END + ' 23:59:59',
    refer: 'ecp',
    DataSetKey: 'roi2_video_material_analysis',
    Metrics: [
      // 消耗
      'stat_cost_for_overall_roi2', 'stat_cost_for_roi2', 'basic_stat_cost_for_roi2_v2',
      // 成交
      'total_prepay_and_pay_order_roi2', 'total_pay_order_gmv_include_coupon_for_roi2',
      'total_pay_order_count_for_roi2', 'total_cost_per_pay_order_for_roi2',
      'total_pay_order_gmv_for_roi2', 'total_pay_order_coupon_amount_for_roi2',
      'total_ecom_platform_subsidy_amount_for_roi2', 'total_unfinished_estimate_order_gmv_for_roi2',
      // 结算
      'total_prepay_and_pay_settle_roi2_1h', 'total_order_settle_amount_for_roi2_1h',
      'total_order_settle_count_for_roi2_1h', 'total_cost_per_pay_order_settle_for_roi2_1h',
      'total_order_real_settle_amount_for_roi2_1h', 'total_order_settle_amount_rate_for_roi2_1h',
      'total_order_settle_count_rate_for_roi2_1h',
      'total_refund_order_count_for_roi2_1h', 'total_refund_order_gmv_for_roi2_1h_all',
      'total_refund_order_gmv_for_roi2_1h_rate',
      'no_refund_ecom_coupon_amount_for_roi2', 'no_refund_ecom_platform_subsidy_amount_for_roi2',
      // 效率
      'total_cpc_for_roi2', 'total_ecpm_for_roi2',
      // 视频质量（实测 2s/3s/5s/10s/完播 全部可用）
      'video_play_duration_2s_rate_for_roi2', 'video_play_duration_3s_rate_for_roi2',
      'video_play_duration_5s_rate_for_roi2', 'video_play_duration_10s_rate_for_roi2',
      'video_play_finish_rate_for_roi2_v2', 'video_play_count_for_roi2_v2',
      'video_avg_watch_duration_for_roi2', 'video_like_count_for_roi2',
      'video_follow_count_for_roi2', 'video_comment_count_for_roi2_v2',
      // 直播（图文/标题类素材无值）
      'live_show_count_for_roi2_v2', 'live_watch_count_for_roi2_v2',
      'live_cvr_rate_for_roi2_v2', 'live_convert_rate_for_roi2_v2',
      // 整体 ROI
      'total_prepay_and_pay_settle_overall_roi2_1h', 'total_cost_per_pay_order_settle_for_overall_roi2_1h',
      // 追投
      'additional_delivery_stat_cost_for_roi2_assist',
      'additional_delivery_total_pay_order_gmv_include_coupon_for_roi2_assist',
      'additional_delivery_total_pay_order_gmv_for_roi2_assist',
      'additional_delivery_total_pay_order_coupon_amount_for_roi2_assist',
      'additional_delivery_total_order_settle_amount_for_roi2_1h_assist',
      'additional_delivery_total_prepay_and_pay_settle_roi2_1h_assist',
      'additional_delivery_total_refund_order_gmv_for_roi2_1h_rate_assist',
      'additional_delivery_convert_rate_for_roi2_assist',
      'additional_delivery_convert_rate_for_roi2_1h_assist',
      'additional_delivery_show_cnt_for_roi2_assist',
      'additional_delivery_click_cnt_for_roi2_assist',
      'shop_estimated_comission_cost',
    ],
    Dimensions: [
      'material_type', 'material_name_v2', 'material_id',
      'material_suggest_v2', 'material_content_v2', 'material_image_mode_v2',
      'material_suggest_reason_v2', 'material_duration_v2', 'material_create_time_v2',
      'material_source_v2', 'material_tag_list',
    ],
    Filters: {
      ConditionRelationshipType: 1,
      Conditions: [
        { Field: 'advertiser_id', Operator: 7, Values: [AVID] },
        { Field: 'marketing_goal', Operator: 7, Values: [MAR_GOAL] },
        { Field: 'adlab_mode_fork', Operator: 7, Values: ['1'] },
        { Field: 'material_type', Operator: 7, Values: [MAT_TYPE] },
      ],
    },
    OrderBy: [{ Field: 'stat_cost_for_roi2', Type: 2 }],
    aavid: AVID,
    PageParams: { Offset: OFFSET, Limit: LIMIT },
    reqFrom: 'roi2_material_list',
  }

  const res = await apiCall('/ad/api/data/v1/common/statQuery', body)
  const stats = res?.data?.StatsData
  if (!stats) {
    fail('api_error',
      '素材报表查询失败：statQuery 未返回 StatsData。响应：' + (res?.message || JSON.stringify(res).slice(0, 200)),
      { request: { DataSetKey: body.DataSetKey, materialType: MAT_TYPE, marGoal: MAR_GOAL, start: START, end: END } })
  }

  // ── 解析 ────────────────────────────────────────────────
  // '-' 表示无数据，'0.00' 表示真的是 0，必须区分
  const numOrNull = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
  const pick = (obj, key) => {
    const m = obj?.[key]
    if (!m) return null
    if (m.ValueStr === '-' || m.ShortValueStr === '-') return null
    return numOrNull(m.Value)
  }

  const parseRow = (r) => {
    const d = r.Dimensions || {}
    const m = r.Metrics || {}
    const dim = (k) => d[k]?.ValueStr ?? d[k]?.Value ?? null
    return {
      materialId: dim('material_id'),
      name: dim('material_name_v2'),
      type: dim('material_type'),
      duration: dim('material_duration_v2'),
      createTime: dim('material_create_time_v2'),
      source: dim('material_source_v2'),
      tags: dim('material_tag_list'),
      suggest: dim('material_suggest_v2'),
      content: dim('material_content_v2'),
      suggestReason: dim('material_suggest_reason_v2'),
      // 消耗
      cost: pick(m, 'stat_cost_for_roi2'),
      overallCost: pick(m, 'stat_cost_for_overall_roi2'),
      basicCost: pick(m, 'basic_stat_cost_for_roi2_v2'),
      // 成交
      gmv: pick(m, 'total_pay_order_gmv_include_coupon_for_roi2'),
      orders: pick(m, 'total_pay_order_count_for_roi2'),
      costPerOrder: pick(m, 'total_cost_per_pay_order_for_roi2'),
      roi: pick(m, 'total_prepay_and_pay_order_roi2'),
      overallRoi: pick(m, 'total_prepay_and_pay_settle_overall_roi2_1h'),
      couponAmount: pick(m, 'total_pay_order_coupon_amount_for_roi2'),
      platformSubsidy: pick(m, 'total_ecom_platform_subsidy_amount_for_roi2'),
      // 结算
      settleAmount: pick(m, 'total_order_settle_amount_for_roi2_1h'),
      settleRate: pick(m, 'total_order_settle_amount_rate_for_roi2_1h'),
      refundCount: pick(m, 'total_refund_order_count_for_roi2_1h'),
      refundRate: pick(m, 'total_refund_order_gmv_for_roi2_1h_rate'),
      // 效率
      cpc: pick(m, 'total_cpc_for_roi2'),
      ecpm: pick(m, 'total_ecpm_for_roi2'),
      // 视频质量
      play2sRate: pick(m, 'video_play_duration_2s_rate_for_roi2'),
      play3sRate: pick(m, 'video_play_duration_3s_rate_for_roi2'),
      play5sRate: pick(m, 'video_play_duration_5s_rate_for_roi2'),
      play10sRate: pick(m, 'video_play_duration_10s_rate_for_roi2'),
      finishRate: pick(m, 'video_play_finish_rate_for_roi2_v2'),
      playCount: pick(m, 'video_play_count_for_roi2_v2'),
      avgWatchDuration: pick(m, 'video_avg_watch_duration_for_roi2'),
      likeCount: pick(m, 'video_like_count_for_roi2'),
      followCount: pick(m, 'video_follow_count_for_roi2'),
      commentCount: pick(m, 'video_comment_count_for_roi2_v2'),
      // 直播
      liveShowCount: pick(m, 'live_show_count_for_roi2_v2'),
      liveWatchCount: pick(m, 'live_watch_count_for_roi2_v2'),
    }
  }

  const rows = (stats.Rows || []).map(parseRow)
  const totals = stats.Totals || {}
  const summary = {
    cost: pick(totals, 'stat_cost_for_roi2'),
    overallCost: pick(totals, 'stat_cost_for_overall_roi2'),
    gmv: pick(totals, 'total_pay_order_gmv_include_coupon_for_roi2'),
    orders: pick(totals, 'total_pay_order_count_for_roi2'),
    roi: pick(totals, 'total_prepay_and_pay_order_roi2'),
    settleAmount: pick(totals, 'total_order_settle_amount_for_roi2_1h'),
    refundRate: pick(totals, 'total_refund_order_gmv_for_roi2_1h_rate'),
    cpc: pick(totals, 'total_cpc_for_roi2'),
    ecpm: pick(totals, 'total_ecpm_for_roi2'),
    play2sRate: pick(totals, 'video_play_duration_2s_rate_for_roi2'),
    play3sRate: pick(totals, 'video_play_duration_3s_rate_for_roi2'),
    play5sRate: pick(totals, 'video_play_duration_5s_rate_for_roi2'),
    play10sRate: pick(totals, 'video_play_duration_10s_rate_for_roi2'),
    finishRate: pick(totals, 'video_play_finish_rate_for_roi2_v2'),
    playCount: pick(totals, 'video_play_count_for_roi2_v2'),
    avgWatchDuration: pick(totals, 'video_avg_watch_duration_for_roi2'),
  }

  const MAT_TYPE_NAME = {
    '1': '直播间画面', '2': '图片素材', '3': '视频素材', '4': '图文素材', '5': '标题素材',
  }[MAT_TYPE] || ('类型' + MAT_TYPE)
  const MG_NAME = MAR_GOAL === '2' ? '推直播间' : '推商品'

  const fmt = (v) => (v == null ? '—' : (Number.isInteger(v) ? String(v) : v.toFixed(2)))
  const pct = (v) => (v == null ? '—' : v.toFixed(2) + '%')

  const out = {
    ok: true, shopKey: SHOP_KEY, aavid: AVID,
    start: START, end: END,
    materialType: MAT_TYPE, materialTypeName: MAT_TYPE_NAME,
    marGoal: MAR_GOAL, marGoalName: MG_NAME,
    summary, rows, items: rows, total: rows.length,
  }
  const lines = []

  lines.push(`素材分析报表（${MAT_TYPE_NAME}｜${MG_NAME}｜${START} ~ ${END}）：`)
  lines.push(`  账户 aavid：${AVID}`)
  lines.push('')
  lines.push('  【汇总】')
  lines.push(`  消耗=${fmt(summary.cost)} 元 | 成交金额=${fmt(summary.gmv)} 元 | 成交订单=${fmt(summary.orders)}`
    + ` | 支付ROI=${fmt(summary.roi)}`)
  if (summary.cpc != null || summary.ecpm != null) {
    lines.push(`  点击单价=${fmt(summary.cpc)} 元 | 千次展现=${fmt(summary.ecpm)} 元`)
  }
  if (summary.settleAmount != null) {
    lines.push(`  结算金额=${fmt(summary.settleAmount)} 元`
      + (summary.refundRate != null ? ` | 1小时退款率=${pct(summary.refundRate)}` : ''))
  }
  lines.push(`  视频质量：2s播放率=${pct(summary.play2sRate)} | 3s播放率=${pct(summary.play3sRate)}`
    + ` | 5s播放率=${pct(summary.play5sRate)} | 10s播放率=${pct(summary.play10sRate)}`)
  lines.push(`            完播率=${pct(summary.finishRate)} | 播放次数=${fmt(summary.playCount)}`
    + ` | 平均观看时长=${fmt(summary.avgWatchDuration)} 秒`)

  if (rows.length) {
    lines.push('')
    lines.push(`  【素材明细】${rows.length} 条（按消耗降序）`)
    for (const r of rows) {
      lines.push(`  · ${String(r.name || r.materialId || '(未命名)').slice(0, 40)}`)
      const meta = []
      if (r.duration) meta.push(`时长 ${r.duration}`)
      if (r.source) meta.push(`来源 ${r.source}`)
      if (r.createTime) meta.push(`创建 ${String(r.createTime).slice(0, 10)}`)
      if (r.materialId) meta.push(`ID ${r.materialId}`)
      if (meta.length) lines.push(`     ${meta.join(' | ')}`)
      lines.push(`     消耗=${fmt(r.cost)} 元 | 成交金额=${fmt(r.gmv)} 元 | 订单=${fmt(r.orders)}`
        + ` | ROI=${fmt(r.roi)} | 单均成本=${fmt(r.costPerOrder)} 元`)
      if (r.cpc != null || r.ecpm != null) {
        lines.push(`     点击单价=${fmt(r.cpc)} 元 | 千次展现=${fmt(r.ecpm)} 元`)
      }
      if (r.settleAmount != null || r.refundRate != null) {
        lines.push(`     结算金额=${fmt(r.settleAmount)} 元`
          + (r.refundRate != null ? ` | 1小时退款率=${pct(r.refundRate)}` : ''))
      }
      if (r.play2sRate != null || r.finishRate != null || r.playCount != null) {
        lines.push(`     2s播放率=${pct(r.play2sRate)} | 3s播放率=${pct(r.play3sRate)}`
          + ` | 5s播放率=${pct(r.play5sRate)} | 10s播放率=${pct(r.play10sRate)}`)
        lines.push(`     完播率=${pct(r.finishRate)} | 播放次数=${fmt(r.playCount)}`
          + ` | 平均观看时长=${fmt(r.avgWatchDuration)} 秒`)
      }
      const social = []
      if (r.likeCount != null) social.push(`点赞 ${fmt(r.likeCount)}`)
      if (r.followCount != null) social.push(`关注 ${fmt(r.followCount)}`)
      if (r.commentCount != null) social.push(`评论 ${fmt(r.commentCount)}`)
      if (social.length) lines.push(`     ${social.join(' | ')}`)
    }
  } else {
    lines.push('')
    lines.push('  【素材明细】该时间范围与筛选条件下无素材数据')
    lines.push('  可能原因：① 该时间段素材未参与投放（报表只统计有投放的素材）')
    lines.push('           ② 账户无消耗（可用 --mode overview 的 douyin-uni-prom 查余额）')
    lines.push('  建议：把时间范围放宽到 90 天再试')
  }

  out.text = lines.join('\n')
  emit(out)
} catch (err) {
  fail('api_error', `抖音素材分析报表查询异常：${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  await sleep(2000)
  killOrphanChrome()
  clearProfileLocks(dir)
  releaseProfile(dir)
}
