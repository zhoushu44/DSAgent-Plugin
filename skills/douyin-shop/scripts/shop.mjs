#!/usr/bin/env node
/**
 * 抖音小店·店铺经营数据（douyin-shop）—— 只读
 *
 * 数据源：抖店后台 fxg.jinritemai.com。
 * 采用「打开页面 → hook 页面自己发的响应」取数
 * （与 douyin-works 同思路，规避抖店的风控签名）。
 *
 * 能力：
 *   overview   店铺经营总览（店铺信息 + 流量 + 商品数据总览）
 *   flow       店铺流量（访客 uv / 浏览量 pv / 成交金额 / 成交订单）
 *   score      店铺体验分（商品/物流/服务体验）
 *   goods      商品数据明细（每商品 访客/成交金额/成交订单/转化率）
 *
 * 用法：node scripts/shop.mjs --mode overview
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

// 抖店风控绕过（hook XHR/fetch 让风控检测请求不发出去，不过滑块）
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
const LIMIT = Math.min(100, Math.max(1, parseInt(ARGS.limit || '20', 10) || 20))
const ACCOUNT = (ARGS.account || '').trim()

// 必须是**单行** JSON：宿主按行读取 __DSAGENT_RESULT__ 协议，
// 带缩进（null, 2）会输出多行，宿主只拿到第一行 → 解析成 {"raw": "{"}。
function emit(payload) {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n')
}
function fail(kind, message, extra = {}) {
  emit({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })
  process.exit(1)
}
const log = (msg) => console.error('[douyin-shop] ' + msg)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

// 抖店后台用独立平台键 douyin_shop（与内容平台 douyin 分开管理，
// 避免「发抖音视频」和「抖店经营查询」互相抢号；依据 src/mqs-publish.ts 的 platform 设计）
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
if (!tryAcquireProfile(dir, 'douyin-shop')) {
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

  // ── APIS：接口 path 片段 → key（已由 _douyin_probe/probe8 实测回填）──────
  // 判据：抖店域 st===0；千川域 status_code===0（见 isOk 分支）。
  const APIS = [
    // 店铺经营首页（等级/今日昨日概况）
    ['shopInfo',      '/pc/api/home/homepage'],
    // 店铺指标
    ['shopMetrics',   '/byteshop/shop_util/mertrics'],
    // 体验分（governance 域）
    ['score',         '/governance/shop/experiencescore/getOverviewV10'],
    ['scoreTrend',    '/governance/shop/experiencescore/getTrendByVersion'],
    ['scoreSub',      '/governance/shop/experiencescore/getSubScoreMetricsV10'],
    // 商品数据（与 douyin-goods 同源，用于 overview 的「成交最高商品」）
    ['goodsList',     '/product/tproduct/list'],
    ['goodsCount',    '/product/tproduct/aggsProductCount'],
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
      // 抖店域判据 st===0 / code===0；千川域判据 status_code===0
      const isOk = j.st === 0 || j.code === 0 || j.code === '0'
        || j.status_code === 0 || j.success === true
      if (isOk) byApi[hit[0]] = j.data ?? j
    } catch { /* 单条失败不阻断 */ }
  })

  // 打开抖店后台页面，让页面自己发数据请求（路由由 probe7 从菜单 DOM 实测）
  const PAGES = [
    'https://fxg.jinritemai.com/ffa/mshop/homepage/index',   // 经营首页 → homepage/mertrics
    'https://fxg.jinritemai.com/ffa/eco/experience-score',   // 体验分 → governance/*
    'https://fxg.jinritemai.com/ffa/g/list',                 // 商品 → tproduct/*
  ]
  for (const u of PAGES) {
    try {
      log('open ' + u)
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await sleep(12000)
      if (/\/login|passport/i.test(page.url())) {
        fail('token_expired', '抖店后台登录态已失效，请到「账号连接」页面对该账号重新登录后重试。')
      }
    } catch (e) {
      log('goto fail: ' + (e?.message || e))
    }
  }

  // ── 桩守卫：接口未回填或未取到数据 → 明确失败，不假成功 ──
  const hitCount = globalThis.__HITS.length
  if (!ACTIVE_APIS.length) {
    fail('api_error', '接口待回填：先跑探测脚本（node skills/_douyin_probe/probe.mjs），'
      + '把真实接口 path 填进 scripts/shop.mjs 的 APIS 常量。',
      { mode: MODE, stub: true, pages: PAGES, hits: hitCount })
  }
  if (!hitCount) {
    fail('api_error', '接口待回填：已打开抖店后台页面但未拦截到任何目标接口响应。'
      + '请先跑探测脚本确认页面是否登录、接口 path 是否变化。',
      { mode: MODE, stub: true, pages: PAGES, hits: 0, activeApis: ACTIVE_APIS.map(([k, f]) => `${k}=${f}`) })
  }

  // ── 解析（字段依据 _douyin_probe/API-FINDINGS.md 与实测响应）────────
  const shopInfo = byApi.shopInfo || null
  const shopMetrics = byApi.shopMetrics || null
  const score = byApi.score || null            // getOverviewV10
  const scoreSub = byApi.scoreSub || null      // getSubScoreMetricsV10
  const gCount = byApi.goodsCount || null      // aggsProductCount
  const gList = byApi.goodsList?.list || byApi.goodsList?.items || byApi.goodsList || []
  const gArr = Array.isArray(gList) ? gList : []

  // 金额一律「分 → 元」
  const yuan = (v) => (v == null || v === '') ? null : (Number(v) / 100)
  const fmtYuan = (v) => { const y = yuan(v); return y == null ? '—' : y.toFixed(2) }

  const goodsItems = gArr.slice(0, LIMIT).map((g) => ({
    id: g.product_id ?? g.id ?? null,
    name: g.name ?? '',
    img: g.img ?? null,
    sellNum: g.sell_num ?? null,
    priceLower: yuan(g.price_lower),          // 元
    priceHigher: yuan(g.price_higher),        // 元
    status: g.status ?? null,
    checkStatus: g.check_status ?? null,
    cates: [g.first_cid, g.second_cid, g.third_cid].filter((v) => v != null),
    createTime: g.create_time ?? null,
    updateTime: g.update_time ?? null,
  }))

  // 体验分：grow_score_info.grow_shop_score；子项在 scoreSub.grow_score_metric_info
  const growInfo = score?.grow_score_info || null
  const shopScore = growInfo?.grow_shop_score ?? null
  const shopName = scoreSub?.shop_name || shopMetrics?.shop_name || null
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
    if (MODE === 'score') {
      lines.push('店铺体验分：')
      lines.push(`  店铺：${shopName ?? '—'}${out.score.category ? `（${out.score.category}）` : ''}`)
      lines.push(`  当前体验分：${shopScore ?? '—'}${out.score.yesterday != null ? `（昨日 ${out.score.yesterday}）` : ''}`)
      lines.push(`  开店天数：${out.score.shopOpenDays ?? '—'} | 数据日期：${out.score.doneDate ?? '—'}`)
      if (subMetrics.length) {
        lines.push('  子项指标：')
        for (const m of subMetrics.slice(0, 12)) {
          const dec = m.decimal || 0
          const val = m.value == null ? '—' : Number(m.value).toFixed(dec)
          lines.push(`    · ${m.title}：${val}${m.outStandard != null ? `（标准 ${m.outStandard}）` : ''}`)
        }
      }
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
            + `\n     状态=${g.status ?? '—'} 审核=${g.checkStatus ?? '—'} 类目=${g.cates.join('/') || '—'}`
          ).join('\n')
        : '商品数据：暂无明细（接口未返回或页面未加载完）'
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
      lines.push(`  销量最高商品：[${top.id}] ${String(top.name).slice(0, 24)}（销量 ${top.sellNum ?? '—'}，价格带 ${top.priceLower ?? '—'}~${top.priceHigher ?? '—'} 元）`)
    }
    out.text = lines.join('\n')
  }

  if (!['overview', 'score', 'goods'].includes(MODE)) {
    fail('api_error', `未知 mode：${MODE}。可用：overview / score / goods`, { mode: MODE })
  }

  emit(out)
} catch (err) {
  fail('api_error', `抖音店铺经营数据查询异常：${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  releaseProfile(dir)
}
