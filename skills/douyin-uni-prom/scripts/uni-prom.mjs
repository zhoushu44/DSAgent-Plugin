#!/usr/bin/env node
/**
 * 抖音·全域投放（douyin-uni-prom）—— 千川新版「视频推广」替代品
 *
 * 背景（2026-10 逆向实证）：
 *   千川旧版菜单「视频推广 / 直播推广 / 商品推广」已下线，合并为「全域投放」，
 *   页面路由 /uni-prom，内部按 MarGoal 区分：1=推商品、2=推直播间。
 *   视频不再是推广对象，而是**投放素材**（抖音号视频 / 本地上传 / 直播剪辑）。
 *
 * 取数方式：
 *   「打开页面 → hook 页面自己发的响应」。千川接口有 verifyFp/fp 签名参数，
 *   手工 fetch 会撞「路径权限校验失败」(status_code 40002)，必须让页面自己发。
 *
 * 能力：
 *   overview   投放总览（余额 + 账户 + 今日/昨日核心指标）
 *   report     报表（消耗/GMV/订单/ROI，按维度汇总，支持自定义日期）
 *   plans      计划列表与汇总
 *   perm       写权限自检（能否上传/启停/新建）
 *   materials  素材列表（抖音号视频，即「视频推广」的素材面）
 *   awemes     已授权抖音号列表
 *
 * 素材分析报表（数据-全域数据-素材数据-视频素材）已拆为独立技能：
 *   douyin-material-report
 *
 * 写操作（上传视频 / 启停 / 新建）当前**未实现**：
 *   平台侧本账户为「仅观察」权限（createAuthEnable=false），
 *   点击上传/新建会弹「没有操作权限」，与接口可用性无关。
 *   用 --mode perm 可自查权限状态。
 *
 * 用法：node scripts/uni-prom.mjs --mode overview
 */

import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'
import { existsSync, rmSync, mkdirSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
// scripts/ → <skill>/ → skills/ → 插件根，需退三级（与 douyin-promo 等一致）
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
const ACCOUNT = (ARGS.account || '').trim()
const LIMIT = Math.min(100, Math.max(1, parseInt(ARGS.limit || '20', 10) || 20))
// 日期：--start / --end，默认今天
const today = () => {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}
const START = (ARGS.start || today()).trim()
const END = (ARGS.end || today()).trim()
// MarGoal：1=推商品（默认） 2=推直播间
const MAR_GOAL = String(ARGS.mar_goal || ARGS.goal || '1').trim()

// 必须是**单行** JSON：宿主按行读取 __DSAGENT_RESULT__ 协议
function emit(payload) {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n')
}
function fail(kind, message, extra = {}) {
  emit({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })
  process.exit(1)
}
const log = (msg) => console.error('[douyin-uni-prom] ' + msg)
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

// 千川用独立平台键 douyin_shop（与 douyin-promo 同一登录态）
const accounts = store.listAccounts().filter((a) => a.platform === 'douyin_shop' && a.status !== 'invalid')
if (!accounts.length) {
  fail('not_bound', '未找到抖音小店账号。请到「账号连接」页面添加「抖店」账号（platform=douyin_shop）。')
}

// ══════════════════════════════════════════════════════════════════════
// ★ margin 模式：利润率 → 涨价安全垫（纯本地计算，不开浏览器、零平台副作用）
//
//   触发场景：商品后期 + 提高利润 / 优化（规则见 _shared/margin-price-advice.md）。
//   与 pdd-promo / taobao-promo 共用同一个计算器，三平台口径一致。
//
//   用法：
//     node scripts/uni-prom.mjs --mode margin --price 39.9 --cost 33
//     node scripts/uni-prom.mjs --mode margin --price 39.9 --cost 33 --net-roi 2.8
//
//   ⚠️ 必须放在浏览器启动 / profile 抢占之前：本模式不碰平台。
// ══════════════════════════════════════════════════════════════════════
if (MODE === 'margin') {
  const { computeMarginAdvice, evaluateTrigger, renderText } =
    await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'margin_price.mjs')))
  try {
    const price = (ARGS.price || '').trim()
    const cost = (ARGS.cost || '').trim()
    if (!price || !cost) {
      fail('bad_input',
        'margin 模式需要 --price <单价,元> 和 --cost <单位成本,元>。\n\n'
        + '取数路径：单价用 douyin-shop --mode goods 的 priceLower/priceHigher；单位成本由商家提供（平台取不到）。\n'
        + '示例：node scripts/uni-prom.mjs --mode margin --price 39.9 --cost 33')
    }
    const stepsArg = (ARGS.steps || '').trim()
    const steps = stepsArg
      ? stepsArg.split(',').map(s => parseFloat(s.trim())).filter(n => Number.isFinite(n) && n > 0)
      : undefined
    const res = computeMarginAdvice({
      price: parseFloat(price),
      cost: parseFloat(cost),
      steps: steps && steps.length ? steps : undefined,
      netRoi: ARGS.net_roi != null ? parseFloat(ARGS.net_roi) : null,
    })
    const trigger = evaluateTrigger({
      daysActive: ARGS.days != null ? parseInt(ARGS.days, 10) : null,
      orderNum: ARGS.orders != null ? parseInt(ARGS.orders, 10) : null,
      marginRate: res.margin.rate,
      netRoi: ARGS.net_roi != null ? parseFloat(ARGS.net_roi) : null,
      hasErrorLabel: String(ARGS.error_label || '') === 'true',
      wantProfit: String(ARGS.want_profit || 'true') !== 'false',
    })
    const prioText = trigger.priority === 'high'
      ? '🔴 高（毛利率 ≤20% 或 净ROI 低于保本线 → 优先动价格）'
      : trigger.priority === 'normal'
        ? '🟡 常规（利润率尚可，仍建议小步试涨；安全垫小 = 掉量容忍度低，幅度更小、观察更密）'
        : '—'
    const advice = trigger.shouldAdvise ? [
      '建议动作：先涨 +1%~+2% 小步试涨，观察 3~5 个自然日',
      '观察指标：转化率、净ROI、订单数',
      '回滚条件：掉量 > 该幅度对应的安全垫 → 调回原价',
      '假设：单位成本不变、成本随销量等比例变动；掉量还受客户流失与竞品比价影响',
    ] : []
    emit({
      ok: true, mode: 'margin',
      margin: res.margin,
      steps: res.steps,
      roiCheck: res.roiCheck || null,
      trigger,
      text: [
        '【利润与涨价建议】',
        '',
        '触发条件自检：',
        `  商品后期：${trigger.lateStage ? '是' : '否（需连续≥7天投产且累计≥30单）'}`,
        `  优化诉求：${String(ARGS.want_profit || 'true') !== 'false' ? '是（提利润 / 优化）' : '否'}`,
        `  商品侧异常阻断：${trigger.blockedByErrorLabel ? '是（有异常标签，先整改商品，不给涨价建议）' : '否'}`,
        `  优先级：${prioText}`,
        `  → ${trigger.shouldAdvise ? '✅ 商品后期 + 优化诉求成立，给涨价安全垫建议' : '⛔ 不满足触发条件，走原有诊断结论'}`,
        ...(advice.length ? ['', advice.join('\n')] : []),
        '',
        renderText(res),
      ].join('\n'),
    })
  } catch (e) {
    fail('bad_input', e instanceof Error ? e.message : String(e))
  }
  // 不占 profile、不开浏览器，直接结束
  process.exit(0)
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
if (!tryAcquireProfile(dir, 'douyin-uni-prom')) {
  fail('api_error', '抖店/千川的浏览器环境正被其他任务占用，请稍后重试。')
}

// ★ 必须复用正式 profile 目录，不能用独立临时目录：
//   账号 cookies 里的 sessionid 是本地 session hash（如 7592d93b...），不是真实抖音票据，
//   单靠 setCookie 注入会被千川判为未登录并跳 business.oceanengine.com/login。
//   正式 profile 里 Chrome 持久化了完整的 Cookie + localStorage + indexedDB，登录态才有效
//   （与 douyin-shop / douyin-promo 同源，实测可正常落地 /uni-prom）。
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
    if (round > 0) { await sleep(5000); killOrphanChrome(); clearProfileLocks(dir) }
    else clearProfileLocks(dir)
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

  // ★ 不要 setCookie 注入账号 cookies！
  //   实测（2026-10-24）：账号 cookies 里的 sessionid 是本地 session hash（如 7592d93b...），
  //   不是真实抖音票据。把它注入浏览器会**覆盖** profile 里 Chrome 持久化的有效 Cookie，
  //   导致千川判定未登录并跳 business.oceanengine.com/login。
  //   正式 profile 已自带完整登录态（Cookie + localStorage + indexedDB），直接用即可。
  //   douyin-shop / douyin-promo 之所以没这问题，是因为它们的页面在 fxg 域、对票据要求更松。
  const cookieList = []

  // ── CDP 响应捕获 ────────────────────────────────────────
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
  // 打开全域投放页，让页面自己发全部请求（带签名）
  // ★ 不带 aavid：账号的 account_id 是本地 hash（如 7592d93b...），不是千川广告主 ID
  //   （真实 aavid 形如 1781536544329804）。乱塞会导致页面跳 /login 再回 /home。
  //  正确做法：先进 /uni-prom 让页面自行解析登录态，再从 URL / 响应里提取 aavid。
  // ★ 入口 URL 实测（2026-10-24）：
  //   /ad/uni-prom   → 跳 business.oceanengine.com/login（品牌域，未登录，不可用）
  //   /uni-prom      → net::ERR_FAILED（路由不可直达）
  //   /ad/promotion-v2 → 落地 qianchuan 且登录态有效（页面显示 404 无妨，
  //                      登录态已建立，页面上下文 fetch 能正常调接口）
  // 素材分析报表请用独立技能 douyin-material-report（入口是 dataV3/roi2-material-analysis）。
  // 登录态只覆盖 jinritemai.com 两域，business.oceanengine.com 不在内，绝不能跳过去。
  const HOME = 'https://qianchuan.jinritemai.com/ad/promotion-v2'
  log('open ' + HOME)
  // goto 前确认 page 可用（applyAccountEnv / setCookie 后偶发 detach）
  try { await page.evaluate(() => 1) } catch (e) {
    log('page unusable before goto, recreating:', String(e.message).split('\n')[0])
    try { await page.close() } catch { /* ignore */ }
    page = (await browser.pages())[0] || await browser.newPage()
    if (env) await applyAccountEnv(page, env).catch(() => {})
    for (let i = 0; i < cookieList.length; i += 25) {
      try { await page.setCookie(...cookieList.slice(i, i + 25)) } catch { /* ignore */ }
    }
  }
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => log('goto: ' + e.message))
  // ★ CDP 必须在 goto 之后挂：SPA 会重定向 /uni-prom → /home，goto 前挂的 session
  //   会随旧 target 一起失效，导致后续 page.evaluate 也异常。
  cdp = await attachCdp(page)
  // 千川 SPA 请求是分批发出的，等久一点才能覆盖到余额/报表/计划接口
  await sleep(16000)
  // 页面滚动一下，触发懒加载区块（报表/计划列表常在首屏之下）
  try {
    await page.evaluate(() => { window.scrollTo(0, 400) })
    await sleep(4000)
  } catch (e) { log('scroll skip:', String(e.message).split('\n')[0]) }
  log('captured after load:', captured.length)
  log('current url:', page.url())

  // 登录态判定：
  //   qianchuan.jinritemai.com/login  → SPA 内部登录页，登录态有效时会**自动跳走**，等等就好
  //   business.oceanengine.com/login  → 巨量引擎品牌域，真未登录（账号只授权了 jinritemai 域）
  //   jinritemai 内部 404             → 不影响登录态
  const isRealLoginPage = (u) => /oceanengine\.com\/login/i.test(u || '')
  const isInternalLogin = (u) => /qianchuan\.jinritemai\.com\/login/i.test(u || '')
  let finalUrl = ''
  const reauthCookies = async () => {
    for (let i = 0; i < cookieList.length; i += 25) {
      try { await page.setCookie(...cookieList.slice(i, i + 25)) } catch { /* ignore */ }
    }
  }
  for (let i = 0; i < 4; i++) {
    try { finalUrl = page.url() } catch { /* ignore */ }
    if (!isRealLoginPage(finalUrl) && !isInternalLogin(finalUrl)) break
    if (isRealLoginPage(finalUrl)) {
      log('hit oceanengine login, re-injecting cookies and reloading:', finalUrl)
      await reauthCookies()
      await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
      await sleep(9000)
    } else {
      // 内部登录页：等它自己跳走
      log('on internal login page, waiting for auto-redirect...')
      await sleep(7000)
    }
  }
  try { finalUrl = page.url() } catch { /* ignore */ }
  if (isRealLoginPage(finalUrl)) {
    fail('token_expired', '千川后台登录态已失效，请到「账号连接」页面对该账号重新登录后重试。',
      { url: finalUrl, captured: captured.length })
  }
  log('landed url:', finalUrl)

  // 从页面 / Cookie / 已捕获响应里提取千川广告主 ID（aavid）
  const extractAavid = () => {
    // 1) 当前 URL
    let m = page.url().match(/aavid=(\d{6,})/)
    if (m) return m[1]
    // 2) 已捕获的请求 URL
    for (const c of captured) {
      m = c.url.match(/aavid=(\d{6,})/)
      if (m) return m[1]
    }
    // 3) 已捕获响应体里的 advertiser_id
    for (const c of captured) {
      m = c.body.match(/"(?:advertiser_id|accountId|account_id)"\s*:\s*"?(\d{6,})/)
      if (m) return m[1]
    }
    return null
  }
  let AVID = extractAavid()
  if (!AVID) {
    // 4) 兜底：直接问接口（页面上下文，带签名）
    try {
      const r = await page.evaluate(async () => {
        const res = await fetch('https://qianchuan.jinritemai.com/ad/api/v1/account/account-info/get-customer-id', { credentials: 'include' })
        return await res.text()
      })
      AVID = (r.match(/"accountId"\s*:\s*"?(\d{6,})/) || [])[1] || null
    } catch { /* ignore */ }
  }

  if (!AVID) {
    fail('api_error', '未能从页面解析出千川账户 ID（aavid），可能登录态异常或页面未加载完成。',
      { url: page.url(), captured: captured.length })
  }
  log('aavid =', AVID)

  // ── 取数辅助：优先从已捕获响应里找，其次让页面自己再发一次 ──
  const findHit = (frag) => {
    for (let i = captured.length - 1; i >= 0; i--) {
      if (captured[i].url.includes(frag)) {
        try {
          const j = JSON.parse(captured[i].body)
          if (j && (j.status_code === 0 || j.code === 0 || j.st === 0)) return j
        } catch { /* skip */ }
      }
    }
    return null
  }
  /** 让页面发一次请求（带签名），返回解析后的 JSON */
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

  // ⚠️ 金额单位实测（2026-10-24）：
  //   get-adv-balance 返回 valid="2340000"，页面展示「账户余额 23.4 元」
  //   → 换算系数是 /100000（千分之一），不是常规的 /100。
  //   douyin-promo 里按 /100 算是错的（会放大 1000 倍）。
  const yuan = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n / 100000 : null
  }
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
  const fmtYuan = (v) => (v == null ? '—' : v.toFixed(2))

  const out = { ok: true, mode: MODE, shopKey: SHOP_KEY, aavid: AVID, items: [] }
  const lines = []

  // ═══════════ overview ═══════════
  if (MODE === 'overview') {
    // 余额
    const bal = findHit('get-adv-balance') || await apiCall(`/ad/api/v1/account/finance/get-adv-balance?aavid=${AVID}`)
    const balanceInfos = bal?.data?.balanceInfos || null
    const balanceList = balanceInfos
      ? Object.values(balanceInfos).map(b => ({
          type: b.advBalanceType ?? null,
          total: yuan(b.total), valid: yuan(b.valid), frozen: yuan(b.frozen),
        }))
      : []
    const mainBalance = balanceList.find(b => b.type === 1) || balanceList.find(b => (b.valid ?? 0) > 0) || null

    // 账户名
    const cust = findHit('get-customer-id') || await apiCall(`/ad/api/v1/account/account-info/get-customer-id?aavid=${AVID}`)
    const detail = cust?.data?.detail || {}
    const accountName = detail.name || null
    const advName = detail.accountName || null

    // 授权抖音号
    const aweme = findHit('default-aweme-user') || await apiCall(`/ad/api/creation/v1/uni-prom-product/default-aweme-user?aavid=${AVID}`)
    const awemeName = aweme?.data?.nickName || null
    const awemeId = aweme?.data?.userId || null

    // 报表：今日 + 昨日
    const statBody = (s, e) => ({
      Dimensions: ['marketing_goal'],
      StartTime: `${s} 00:00:00`,
      EndTime: `${e} 23:59:59`,
      DataSetKey: 'product_roi2_promotion',
      Metrics: ['stat_cost_for_roi2', 'total_pay_order_count_for_roi2',
        'total_pay_order_gmv_include_coupon_for_roi2', 'total_prepay_and_pay_order_roi2'],
      Filters: {
        ConditionRelationshipType: 1,
        Conditions: [
          { Field: 'advertiser_id', Operator: 7, Values: [AVID] },
          { Field: 'pricing_category', Operator: 7, Values: ['2'] },
          { Field: 'marketing_goal', Operator: 7, Values: [MAR_GOAL] },
          { Field: 'ecp_app_id', Operator: 7, Values: ['1'] },
        ],
      },
      aavid: AVID,
    })
    const statToday = await apiCall('/ad/api/data/v1/common/statQuery', statBody(START, START))
    const totals = statToday?.data?.StatsData?.Totals || null

    out.account = { aavid: AVID, customerName: accountName, advName, awemeName, awemeId }
    out.balance = mainBalance
    out.balanceAll = balanceList
    out.metrics = totals ? {
      cost: num(totals.stat_cost_for_roi2?.Value),
      gmv: num(totals.total_pay_order_gmv_include_coupon_for_roi2?.Value),
      orders: num(totals.total_pay_order_count_for_roi2?.Value),
      roi: num(totals.total_prepay_and_pay_order_roi2?.Value),
    } : null

    lines.push('全域投放总览：')
    if (accountName) lines.push(`  账户：${accountName}${advName ? `（${advName}）` : ''}`)
    if (awemeName) lines.push(`  授权抖音号：${awemeName}${awemeId ? `（${awemeId}）` : ''}`)
    if (mainBalance) {
      lines.push(`  广告可用余额：${fmtYuan(mainBalance.valid)} 元`
        + `${mainBalance.frozen ? ` | 冻结 ${fmtYuan(mainBalance.frozen)} 元` : ''}`)
    } else {
      lines.push('  广告余额：暂无数据')
    }
    lines.push(`  统计日期：${START}（推广目标：${MAR_GOAL === '2' ? '推直播间' : '推商品'}）`)
    if (out.metrics) {
      lines.push(`  消耗：${fmtYuan(out.metrics.cost)} 元 | 成交金额：${fmtYuan(out.metrics.gmv)} 元`)
      lines.push(`  成交订单：${out.metrics.orders ?? '—'} | 支付 ROI：${out.metrics.roi ?? '—'}`)
    } else {
      lines.push('  投放数据：暂无（statQuery 未返回）')
    }
    out.text = lines.join('\n')
  }

  // ═══════════ report ═══════════
  if (MODE === 'report') {
    const dims = (ARGS.dimensions || 'marketing_goal').trim()
    const metrics = (ARGS.metrics || 'stat_cost_for_roi2,total_pay_order_count_for_roi2,total_pay_order_gmv_include_coupon_for_roi2,total_prepay_and_pay_order_roi2').split(',')
    const body = {
      Dimensions: dims.split(',').map(s => s.trim()).filter(Boolean),
      StartTime: `${START} 00:00:00`,
      EndTime: `${END} 23:59:59`,
      DataSetKey: 'product_roi2_promotion',
      Metrics: metrics,
      Filters: {
        ConditionRelationshipType: 1,
        Conditions: [
          { Field: 'advertiser_id', Operator: 7, Values: [AVID] },
          { Field: 'pricing_category', Operator: 7, Values: ['2'] },
          { Field: 'marketing_goal', Operator: 7, Values: [MAR_GOAL] },
          { Field: 'ecp_app_id', Operator: 7, Values: ['1'] },
        ],
      },
      aavid: AVID,
    }
    const res = await apiCall('/ad/api/data/v1/common/statQuery', body)
    const stats = res?.data?.StatsData
    if (!stats) {
      fail('api_error', `报表查询失败：${res?.message || 'statQuery 未返回 StatsData'}`, { request: body })
    }
    const rows = (stats.Rows || []).slice(0, LIMIT).map(r => {
      const dimsOut = {}
      for (const [k, v] of Object.entries(r.Dimensions || {})) dimsOut[k] = v?.ValueStr ?? v?.Value ?? null
      const metricsOut = {}
      for (const [k, v] of Object.entries(r.Metrics || {})) {
        metricsOut[k] = num(v?.Value) ?? v?.ValueStr ?? null
      }
      return { dimensions: dimsOut, metrics: metricsOut }
    })
    out.rows = rows
    out.totals = stats.Totals || null
    out.items = rows

    lines.push(`全域投放报表（${START} ~ ${END}，目标：${MAR_GOAL === '2' ? '推直播间' : '推商品'}）：`)
    lines.push(`  维度：${dims}`)
    if (rows.length) {
      for (const r of rows) {
        const dimStr = Object.entries(r.dimensions).map(([k, v]) => `${k}=${v}`).join(' ')
        lines.push(`  · ${dimStr || '(汇总)'}`)
        lines.push(`     消耗=${r.metrics.stat_cost_for_roi2 ?? '—'} 元 | GMV=${r.metrics.total_pay_order_gmv_include_coupon_for_roi2 ?? '—'} 元`
          + ` | 订单=${r.metrics.total_pay_order_count_for_roi2 ?? '—'} | ROI=${r.metrics.total_prepay_and_pay_order_roi2 ?? '—'}`)
      }
    } else {
      lines.push('  该时间范围无数据')
    }
    if (stats.Totals) {
      lines.push(`  合计：消耗=${num(stats.Totals.stat_cost_for_roi2?.Value) ?? '—'} 元`
        + ` | GMV=${num(stats.Totals.total_pay_order_gmv_include_coupon_for_roi2?.Value) ?? '—'} 元`
        + ` | 订单=${num(stats.Totals.total_pay_order_count_for_roi2?.Value) ?? '—'}`)
    }
    out.text = lines.join('\n')
  }

  // ═══════════ plans ═══════════
  // ═══════════ plans ═══════════
  if (MODE === 'plans') {
    // uni-promotion/ad/list 与 list-summary 都有签名校验（status_code 40002 路径权限校验失败），
    // 手工 fetch 过不了。可行做法：打开计划管理页让页面自己发请求，再从已捕获响应里取。
    // getOngoingPromotionList 无签名校验，可作为「在投计划数」的补充口径。
    const ongoing = (await apiCall(`/ad/ocean/api/v1/promotion/getOngoingPromotionList?aavid=${AVID}`))
      || findHit('getOngoingPromotionList')
    const activities = ongoing?.data?.activitiesOfPromotion || null
    const ongoingCount = activities ? Object.keys(activities).length : 0

    // 触发页面自己发计划列表请求：导航到计划管理路由（SPA 会带签名重放）
    const summaryHit = findHit('uni-promotion/ad/list-summary') || findHit('uni-promotion/ad/list')
    let summary = summaryHit
    if (!summary) {
      for (const route of ['/ad/promotion-v2', '/uni-prom']) {
        try {
          await page.goto('https://qianchuan.jinritemai.com' + route, { waitUntil: 'domcontentloaded', timeout: 45000 })
          await sleep(12000)
          summary = findHit('uni-promotion/ad/list-summary') || findHit('uni-promotion/ad/list')
          if (summary) break
        } catch (e) { log('plans route fail', route, String(e.message).split('\n')[0]) }
      }
    }

    const totalNum = summary?.data?.totalNum != null ? Number(summary.data.totalNum) : null
    out.ongoingCount = ongoingCount
    out.totalNum = totalNum
    out.items = []

    lines.push(`全域投放计划（推广目标：${MAR_GOAL === '2' ? '推直播间' : '推商品'}）：`)
    if (totalNum != null) lines.push(`  计划总数：${totalNum} 个`)
    lines.push(`  在投计划：${ongoingCount} 个`)
    if (summary) {
      lines.push('  数据来源：页面真实请求（uni-promotion/ad/list-summary）')
    } else {
      lines.push('  明细列表未取到：该接口有签名校验，需在计划管理页由页面自身触发。')
      lines.push('  已返回可用的汇总口径（在投计划数）。')
    }
    if (!ongoingCount && !totalNum) {
      lines.push('  → 当前没有任何投放计划')
    }
    out.text = lines.join('\n')
  }

  // ═══════════ materials ═══════════
  if (MODE === 'materials') {
    // get_source_list_new 无签名校验，可直接调；失败再退回已捕获响应
    const res = (await apiCall(`/ad/api/data/v1/material/get_source_list_new?aavid=${AVID}`))
      || findHit('get_source_list_new')
    const sources = res?.data?.video || []
    const aweme = findHit('default-aweme-user') || await apiCall(`/ad/api/creation/v1/uni-prom-product/default-aweme-user?aavid=${AVID}`)
    const awemeId = aweme?.data?.userId || null
    const awemeName = aweme?.data?.nickName || null
    out.aweme = awemeId ? { id: awemeId, name: awemeName } : null
    out.materialSources = sources.map(s => ({ id: s.show_source, name: s.show_source_name, lego: s.lego_source_str }))
    out.items = out.materialSources
    lines.push('视频素材来源（全域投放可选素材池）：')
    if (awemeName) lines.push(`  授权抖音号：${awemeName}${awemeId ? `（${awemeId}）` : ''}`)
    if (out.materialSources.length) {
      for (const s of out.materialSources) {
        lines.push(`  · [${s.id}] ${s.name}${s.lego ? `（lego: ${s.lego}）` : ''}`)
      }
    } else {
      lines.push('  （素材来源列表为空，接口未返回）')
    }
    lines.push('')
    lines.push('说明：千川新版中视频是「投放素材」而非推广对象。')
    lines.push('素材来自抖音号已发布视频、本地上传、直播剪辑等来源。')
    out.text = lines.join('\n')
  }

  // ═══════════ awemes ═══════════
  if (MODE === 'awemes') {
    const res = await apiCall(`/ad/api/creation/v1/aweme/get-aweme-list-v2?aavid=${AVID}&marGoal=${MAR_GOAL}&entry=1&action=1&page=1&pageSize=${LIMIT}&needCanApply=0`)
    if (!res) {
      fail('api_error', '授权抖音号接口未返回数据（get-aweme-list-v2）。可能是页面上下文失效，请重试。')
    }
    const list = res?.data?.bindAwemeUserInfos || []
    const awemes = list.map(a => ({
      id: a.userId ?? a.awemeUserInfo?.id ?? null,
      name: a.awemeUserInfo?.name ?? null,
      showId: a.awemeUserInfo?.showId ?? a.awemeUserInfo?.uniqueId ?? null,
      hasShopPermission: a.hasShopPermission ?? null,
      isAwemeC: a.isAwemeC ?? null,
      authStart: a.startTime ?? null,
      authEnd: a.endTime ?? null,
    }))
    out.awemes = awemes
    out.items = awemes
    lines.push(`已授权抖音号（${awemes.length} 个）：`)
    for (const a of awemes) {
      lines.push(`  · ${a.name || a.id}（ID ${a.id}${a.showId ? ` / 抖号 ${a.showId}` : ''}）`
        + `${a.hasShopPermission ? ' | 有店铺权限' : ''}`)
    }
    if (!awemes.length) lines.push('  （无）')
    out.text = lines.join('\n')
  }



  // ═══════════ perm：写权限自检 ═══════════
  // 平台侧通过两处信号判定能否写：
  //   ① get-uni_prom_config / user/get-whitelist 的 createAuthEnable=false
  //   ② 点击「上传视频」「新建计划」时弹「没有操作权限 / 你当前的权限为仅观察」
  // 实测（2026-10-24）：本账户 createAuthEnable=false，弹「仅观察」，
  //   因此上传视频 / 启停计划 / 新建计划均被平台前置拒绝，与接口可用性无关。
  if (MODE === 'perm') {
    const uniCfg = (await apiCall('/ad/api/v1/account/uni_prom/get_uni_prom_config?objectType=4&objectId=' + AVID
      + '&needAwemeUserInfo=false&needAdvUserInfo=false&needActivityInfo=true&aavid=' + AVID))
      || findHit('get_uni_prom_config')
    const wl = (await apiCall('/ad/api/v1/account/user/get-whitelist?aavid=' + AVID)) || findHit('get-whitelist')
    const shopCfg = (await apiCall('/ad/api/creation/v1/shop-prom/get-config-v2?aavid=' + AVID + '&needCreateInfo=true'))
      || findHit('shop-prom/get-config-v2')

    const createAuthEnable = uniCfg?.data?.createAuthEnable ?? wl?.data?.createAuthEnable ?? null
    const canCreate = shopCfg?.data?.createInfo?.canCreate ?? null
    const uniPromVisible = uniCfg?.data?.uniPromVisible ?? null
    const dataReportVisible = uniCfg?.data?.dataReportVisible ?? null

    // 只读能力（这些不受权限影响）
    const readAbilities = [
      'overview 投放总览（余额/账户/抖音号/今日指标）',
      'report 报表查询（消耗/GMV/订单/ROI，自定义日期与维度）',
      'plans 计划列表与汇总',
      'materials 视频素材来源清单',
      'awemes 已授权抖音号',
    ]
    // 写能力（需要 createAuthEnable=true）
    const writeAbilities = [
      'material-upload 上传视频到素材库',
      'plan-start 开启投放计划',
      'plan-stop 暂停投放计划',
      'plan-create 新建投放计划',
    ]
    const writable = createAuthEnable === true

    out.permission = {
      createAuthEnable, canCreate, uniPromVisible, dataReportVisible,
      writable,
      readAbilities, writeAbilities,
    }
    lines.push('千川写权限自检：')
    lines.push('  账户：' + (out.account?.customerName || AVID))
    lines.push('  createAuthEnable：' + (createAuthEnable === null ? '未知（接口未返回）' : String(createAuthEnable)))
    if (canCreate != null) lines.push('  商品推广 canCreate：' + String(canCreate))
    lines.push('')
    if (writable) {
      lines.push('  ✅ 具备创建/编辑权限，写操作可用')
    } else {
      lines.push('  ❌ 当前为「仅观察」权限，不能创建、编辑、上传、启停')
      lines.push('     平台会在点击「上传视频 / 新建计划」时弹：')
      lines.push('     「没有操作权限 —— 你当前的权限为"仅观察"…」')
      lines.push('     处置：联系千川管理员给该账户开「操作」权限后重试')
    }
    lines.push('')
    lines.push('  可用（只读）：')
    for (const a of readAbilities) lines.push('    · ' + a)
    lines.push('  需开权限（写）：')
    for (const a of writeAbilities) lines.push('    · ' + a)
    out.text = lines.join('\n')
  }

  const VALID = ['overview', 'report', 'plans', 'materials', 'awemes', 'perm', 'margin']
  if (!VALID.includes(MODE)) {
    fail('api_error', `未知 mode：${MODE}。可用：${VALID.join(' / ')}`, { mode: MODE })
  }

  emit(out)
} catch (err) {
  fail('api_error', `抖音全域投放查询异常：${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  await sleep(2000)
  killOrphanChrome()
  clearProfileLocks(dir)
  releaseProfile(dir)
}
