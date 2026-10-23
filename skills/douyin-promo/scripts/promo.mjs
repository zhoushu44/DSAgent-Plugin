#!/usr/bin/env node
/**
 * 抖音·千川推广数据（douyin-promo）—— 只读
 *
 * 数据源：千川/抖店推广后台 fxg.jinritemai.com。
 * 采用「打开页面 → hook 页面自己发的响应」取数（与 pdd-promo 同思路）。
 *
 * 能力：
 *   overview   推广总览（资金账户 + 近几日消耗 + 计划数）
 *   plans      推广计划（广告组）列表
 *   units      推广单元（广告）列表
 *   goods      商品维度报表（每商品 花费/GMV/订单/ROI/点击/CTR）
 *   cost       每日消耗明细
 *
 * 规划中（本版不实现）：pause / resume / maxcost / roi / create / delete（L2 写操作）。
 * contract 已预留 --confirm 参数位，写模式落地时按两步走门禁接入。
 *
 * 用法：node scripts/promo.mjs --mode overview
 *
 * ⚠️ 当前为桩实现：APIS 常量里的接口 path 尚未回填，
 *    未取到数据时明确返回 api_error，绝不伪造成功。
 */

import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = process.env.DSAGENT_PLUGIN_ROOT || join(HERE, '..', '..', '..')
// Windows 下绝对路径必须转 file:// URL 才能被 ESM loader 接受
const PURL = (p) => pathToFileURL(p).href

// 抖店/千川风控绕过（hook XHR/fetch 让风控检测请求不发出去，不过滑块）
const { injectRiskBypass } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-risk-bypass.mjs')))

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
const truthy = (v) => String(v ?? '').trim().toLowerCase() === 'true'

const MODE = (ARGS.mode || 'overview').trim()
const GOODS_ID = (ARGS['goods-id'] || ARGS.goods_id || ARGS.goodsId || '').trim()
const DAYS = Math.min(90, Math.max(1, parseInt(ARGS.days || '7', 10) || 7))
const LIMIT = Math.min(100, Math.max(1, parseInt(ARGS.limit || '20', 10) || 20))
const CONFIRM = truthy(ARGS.confirm)
const ACCOUNT = (ARGS.account || '').trim()

// 必须是**单行** JSON：宿主按行读取 __DSAGENT_RESULT__ 协议
function emit(payload) {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n')
}
function fail(kind, message, extra = {}) {
  emit({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })
  process.exit(1)
}
const log = (msg) => console.error('[douyin-promo] ' + msg)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 规划中的写模式：本版不实现，遇到直接明确返回
const WRITE_MODES = ['pause', 'resume', 'maxcost', 'roi', 'create', 'delete']
if (WRITE_MODES.includes(MODE)) {
  fail('api_error',
    `${MODE} 是 L2 写操作，本版未实现（规划中）。当前只支持：overview / plans / units / goods / cost。`
    + `--confirm 参数位已在 contract 预留，写模式落地后按两步走门禁接入。`,
    { mode: MODE, planned: true })
}

// ── 账号选择 ──────────────────────────────────────────────
let store, CredentialStore
let profileDir, findChromePath, tryAcquireProfile, releaseProfile, clearProfileLocks
try {
  ;({ CredentialStore } = await import(PURL(join(PLUGIN_ROOT, 'lib', 'services', 'credential-store.js'))))
  ;({ profileDir, findChromePath, tryAcquireProfile, releaseProfile, clearProfileLocks } =
    await import(PURL(join(PLUGIN_ROOT, 'lib', 'browser-login.js'))))
  store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
} catch (e) {
  fail('api_error', `无法加载插件库（${PLUGIN_ROOT}）：${e.message}`)
}

// 千川推广后台用独立平台键 douyin_shop（抖店/千川同属商家后台登录态）
const accounts = store.listAccounts().filter((a) => a.platform === 'douyin_shop' && a.status !== 'invalid')
if (!accounts.length) {
  fail('not_bound', '未找到抖音小店账号。请到「账号连接」页面添加「抖店」账号（platform=douyin_shop，需有抖店商家权限）。')
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

const dir = profileDir('douyin_shop', account.shop_key)
if (!tryAcquireProfile(dir, 'douyin-promo')) {
  fail('api_error', '抖店的浏览器环境正被其他任务占用，请稍后重试。')
}
clearProfileLocks(dir)

let browser = null
try {
  const puppeteer = await import(PURL(join(PLUGIN_ROOT, 'node_modules', 'puppeteer-core',
    'lib', 'esm', 'puppeteer', 'puppeteer-core.js')))
  const chromePath = findChromePath()
  if (!chromePath) fail('api_error', '未找到 Chrome 或 Edge 浏览器')

  browser = await puppeteer.default.launch({
    headless: false,
    executablePath: chromePath,
    userDataDir: dir,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1400,900'],
  })
  const page = (await browser.pages())[0] || await browser.newPage()
  await injectRiskBypass(page)   // 风控绕过：拦掉检测请求，不过滑块

  // 抖店后台域 + 抖音主域双域注入（与 _douyin_probe 一致）
  const cookieList = Object.entries(account.cookies || {})
    .filter(([, v]) => v !== '' && v != null)
    .flatMap(([name, value]) => [
      { name, value: String(value), domain: '.jinritemai.com', path: '/' },
      { name, value: String(value), domain: '.douyin.com', path: '/' },
    ])
  if (cookieList.length) await page.setCookie(...cookieList)

  const cdp = await page.target().createCDPSession()
  await cdp.send('Network.enable')

  // ── APIS：接口 path 片段 → key（已由 _douyin_probe/probe-qc 实测回填）─────
  // ⚠️ 千川在**独立域** qianchuan.jinritemai.com，判据是 status_code===0（不是 st===0）。
  // ⚠️ 该店当前无在投计划，列表类接口只验证了「能通、返回空」，未拿到有数据的样本。
  const APIS = [
    ['advBalance',   '/ad/api/v1/account/finance/get-adv-balance'],      // 广告余额（多账户类型）
    ['costLevel',    '/ad/api/v1/account/agw/finance/GetAdvCostLevelInfo'], // 消耗层级
    ['ongoingList',  '/ad/ocean/api/v1/promotion/getOngoingPromotionList'], // 在投计划
    // ['userInfo', '/ad/api/v1/account/user/info'],  // ⚠️ 返回 AB 实验配置，非账户名，已弃用
  ['customerId',  '/ad/api/v1/account/account-info/get-customer-id'], // 客户 ID
    ['forbidRoi',    '/ad/api/v1/account/getForbidRoi1AdInfo'],          // ROI 投放限制
  ]
  const ACTIVE_APIS = APIS.filter(([, frag]) => frag && !String(frag).startsWith('TODO'))

  // 落 globalThis.__HITS：{key, url, status, data}
  globalThis.__HITS = globalThis.__HITS || []
  const byApi = {}

  cdp.on('Network.responseReceived', async (e) => {
    try {
      if (e.response.status !== 200) return
      const u = e.response.url
      if (!/jinritemai\.com|douyin\.com/.test(u)) return
      if (!/json|text|plain/.test(e.response.mimeType || '')) return
      const hit = ACTIVE_APIS.find(([, frag]) => u.includes(frag))
      if (!hit) return
      const b = await cdp.send('Network.getResponseBody', { requestId: e.requestId })
      const body = b.body || ''
      let j = null
      try { j = JSON.parse(body) } catch { /* 非 JSON，跳过 */ }
      if (!j) return
      const rec = { key: hit[0], url: u.slice(0, 300), status: e.response.status, data: j }
      globalThis.__HITS.push(rec)
      // 千川域判据 status_code===0；抖店域判据 st===0 / code===0
      const isOk = j.status_code === 0 || j.st === 0 || j.code === 0
        || j.code === '0' || j.success === true
      if (isOk) byApi[hit[0]] = j.data ?? j
    } catch { /* 单条失败不阻断 */ }
  })

  // 打开千川推广页，让页面自己发数据请求（路由由 probe7 菜单 DOM 实测）
  const PAGES = [
    'https://fxg.jinritemai.com/ffa/ad/promotion-v2',          // 抖店内嵌千川入口
    'https://qianchuan.jinritemai.com/ad/promotion-v2',        // 千川本体（余额/在投计划在这）
  ]
  for (const u of PAGES) {
    try {
      log('open ' + u)
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await sleep(15000)
      if (/\/login|passport/i.test(page.url())) {
        fail('token_expired', '抖店/千川后台登录态已失效，请到「账号连接」页面对该账号重新登录后重试。')
      }
    } catch (e) {
      log('goto fail: ' + (e?.message || e))
    }
  }

  // ── 守卫：接口未回填或未取到数据 → 明确失败，不假成功 ──
  const hitCount = globalThis.__HITS.length
  if (!ACTIVE_APIS.length) {
    fail('api_error', '接口待回填：先跑探测脚本（node skills/_douyin_probe/probe-qc.mjs），'
      + '把真实接口 path 填进 scripts/promo.mjs 的 APIS 常量。',
      { mode: MODE, stub: true, pages: PAGES, hits: hitCount })
  }
  if (!hitCount) {
    fail('api_error', '已打开千川推广页但未拦截到任何目标接口响应。'
      + '请先跑探测脚本确认页面是否登录、接口 path 是否变化。',
      { mode: MODE, stub: true, pages: PAGES, hits: 0, activeApis: ACTIVE_APIS.map(([k, f]) => `${k}=${f}`) })
  }

  // ── 解析（字段依据 _douyin_probe/API-FINDINGS.md 与实测响应）────────
  // 千川金额单位是**分**；advBalanceType 1=现金账户 9/10/11=各类返还/预付
  const advBalance = byApi.advBalance || null
  const costLevel = byApi.costLevel || null
  const ongoing = byApi.ongoingList || null
  // ⚠️ /ad/api/v1/account/user/info 返回的是 AB 实验配置（abInfo），不是账户名——
  //    实测踩坑，不拿它当 userInfo 源。千川账户名需另找接口（未确认），暂不输出。

  const yuan = (v) => (v == null || v === '' || Number.isNaN(Number(v))) ? null : (Number(v) / 100)
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }

  const balanceInfos = advBalance?.balanceInfos || null
  const balanceList = balanceInfos
    ? Object.values(balanceInfos).map((b) => ({
        type: b.advBalanceType ?? null,
        total: yuan(b.total),
        valid: yuan(b.valid),
        frozen: yuan(b.frozen),
      }))
    : []
  // 主展示口径：type 1（现金账户），拿不到则取第一个有值的
  const mainBalance = balanceList.find((b) => b.type === 1) || balanceList.find((b) => (b.valid ?? 0) > 0) || null

  // 在投计划：activitiesOfPromotion 为空对象 = 当前无在投
  const activities = ongoing?.activitiesOfPromotion || null
  const ongoingCount = activities ? Object.keys(activities).length : 0

  const out = { ok: true, mode: MODE, shopKey: account.shop_key, items: [] }
  const lines = []

  if (MODE === 'overview') {
    out.balance = mainBalance ? {
      type: mainBalance.type, total: mainBalance.total,
      valid: mainBalance.valid, frozen: mainBalance.frozen,
    } : null
    out.balanceAll = balanceList
    out.ongoingCount = ongoingCount
    out.costLevel = costLevel && Object.keys(costLevel).length ? costLevel : null

    lines.push('千川推广总览：')
    if (mainBalance) {
      lines.push(`  广告余额（账户类型 ${mainBalance.type}）：可用 ${mainBalance.valid ?? '—'} 元`
        + `${mainBalance.frozen ? ` | 冻结 ${mainBalance.frozen} 元` : ''}`
        + `${mainBalance.total != null ? ` | 总计 ${mainBalance.total} 元` : ''}`)
    } else {
      lines.push('  广告余额：暂无数据（get-adv-balance 未返回）')
    }
    if (balanceList.length > 1) {
      lines.push(`  账户类型共 ${balanceList.length} 种（现金/预付/返还等），详见 balanceAll 字段`)
    }
    lines.push(`  在投计划：${ongoingCount} 个`)
    if (!ongoingCount) {
      lines.push('    → 当前没有正在投放的计划（拉新计划/商品推广/直播推广均无）')
    }
    out.text = lines.join('\n')
  }

  // plans / units / goods / cost：列表类接口未拿到有数据样本（该店无在投计划），
  // 不假装支持——明确失败并说明缺什么。
  if (['plans', 'units', 'goods', 'cost'].includes(MODE)) {
    fail('api_error',
      `mode=${MODE} 尚未实现：千川计划/单元/商品报表接口未验证。`
      + `原因：该店铺当前无在投计划，列表类接口只验证了「能通、返回空」，`
      + `拿不到有数据的响应样本，字段映射无法确认。`
      + `待店铺有在投计划后重跑 skills/_douyin_probe/probe-qc.mjs 补齐。`,
      { mode: MODE, ongoingCount, available: ['overview'] })
  }

  if (MODE !== 'overview') {
    fail('api_error', `未知或未实现的 mode：${MODE}。当前可用：overview`, { mode: MODE })
  }

  emit(out)
} catch (err) {
  fail('api_error', `抖音千川推广查询异常：${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  releaseProfile(dir)
}
