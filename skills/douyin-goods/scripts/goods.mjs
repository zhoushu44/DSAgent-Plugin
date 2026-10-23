#!/usr/bin/env node
/**
 * 抖音小店·商品查询（douyin-goods）—— 只读
 *
 * 数据源：抖店后台 fxg.jinritemai.com。
 * 采用「打开页面 → hook 页面自己发的响应」取数。
 *
 * 能力：
 *   overview   商品总览（在售/未在售计数 + 前 N 条明细）
 *   list       商品列表（商品ID/标题/类目/SKU数/价格带/在售状态）
 *   detail     单商品详情
 *   sku        单商品 SKU 全量（规格/价格/库存/预览图）
 *   spec-pool  全店规格池采集（规格值→spec_id）
 *
 * 规划中（本版不实现）：offsale / onsale / delete（L2 写操作）。
 *
 * 用法：node scripts/goods.mjs --mode overview
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
const PRODUCT_ID = (ARGS['product-id'] || ARGS.productId || ARGS.goods_id || '').trim()
const LIMIT = Math.min(100, Math.max(1, parseInt(ARGS.limit || '20', 10) || 20))
// status/tab：onSale=在售(默认) / offSale=已下架 / draft=草稿 / audit=审核中 / soldOut=已售罄
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

// 抖店后台用独立平台键 douyin_shop（与内容平台 douyin 两套独立登录态）
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
if (!tryAcquireProfile(dir, 'douyin-goods')) {
  fail('api_error', '抖店的浏览器环境正被其他任务占用，请稍后重试。')
}
clearProfileLocks(dir)

// 参数前置校验（未过校验不必起浏览器）
// detail / sku / spec-pool 尚未实现，提前拒掉，避免白开浏览器
if (['detail', 'sku', 'spec-pool'].includes(MODE)) {
  releaseProfile(dir)
  fail('api_error',
    `mode=${MODE} 尚未实现：单商品详情 / SKU / 规格池接口未在探测中确认`
    + `（需打开 /ffa/g/detail 页面单独抓包）。当前可用：overview / list。`,
    { mode: MODE, available: ['overview', 'list'] })
}

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

  // ── APIS：接口 path 片段 → key（已由 _douyin_probe/probe5 实测回填）──────
  // 判据：抖店域 st===0
  const APIS = [
    ['goodsCount',  '/product/tproduct/aggsProductCount'],   // 各状态计数
    ['goodsList',   '/product/tproduct/list'],               // 商品列表（主接口）
    ['productGroup','/product/tproduct/getProductGroupList'],// 商品分组
    ['categoryOpt', '/product/tproduct/categoryOptionsN'],   // 类目选项
    ['freightTpl',  '/freight/template/getFreightTemplateList'], // 运费模板
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
      // 抖店域判据 st===0 / code===0
      const isOk = j.st === 0 || j.code === 0 || j.code === '0'
        || j.status_code === 0 || j.success === true
      if (isOk) byApi[hit[0]] = j.data ?? j
    } catch { /* 单条失败不阻断 */ }
  })

  // 打开抖店后台商品页，让页面自己发数据请求（路由由 probe7 从菜单 DOM 实测）
  // tab 参数实测值：onSale=在售 / offSale=已下架 / draft=草稿 / audit=审核中 / soldOut=已售罄
  const TAB = (STATUS && STATUS !== 'all') ? STATUS : 'onSale'
  const PAGES = [
    `https://fxg.jinritemai.com/ffa/g/list?tab=${encodeURIComponent(TAB)}`,
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
      + '把真实接口 path 填进 scripts/goods.mjs 的 APIS 常量。',
      { mode: MODE, stub: true, pages: PAGES, hits: hitCount })
  }
  if (!hitCount) {
    fail('api_error', '接口待回填：已打开抖店后台页面但未拦截到任何目标接口响应。'
      + '请先跑探测脚本确认页面是否登录、接口 path 是否变化。',
      { mode: MODE, stub: true, pages: PAGES, hits: 0, activeApis: ACTIVE_APIS.map(([k, f]) => `${k}=${f}`) })
  }

  // ── 解析（字段依据 _douyin_probe/API-FINDINGS.md 与实测响应）────────
  const gCount = byApi.goodsCount || null       // aggsProductCount
  const gListRaw = byApi.goodsList
  const gArr = Array.isArray(gListRaw) ? gListRaw
    : Array.isArray(gListRaw?.list) ? gListRaw.list
    : Array.isArray(gListRaw?.items) ? gListRaw.items : []
  const groups = byApi.productGroup || null

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

  if (MODE === 'overview' || MODE === 'list') {
    out.goodsCount = gCount ? {
      onsale: gCount.onsale ?? 0, draft: gCount.draft ?? 0, audit: gCount.audit ?? 0,
      forbidden: gCount.forbidden ?? 0, unpass: gCount.unpass ?? 0,
      unpassNew: gCount.unpass_new ?? 0, sellOut: gCount.sell_out_new ?? 0,
    } : null
    out.total = gCount ? (gCount.onsale ?? 0) : gArr.length
    out.items = listItems
    if (groups) out.groups = groups

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
  }

  // detail / sku / spec-pool：所需接口未在探测中确认，明确失败，不假装支持
  if (MODE === 'detail' || MODE === 'sku' || MODE === 'spec-pool') {
    fail('api_error',
      `mode=${MODE} 尚未实现：单商品详情 / SKU / 规格池接口未在探测中确认`
      + `（需打开 /ffa/g/detail 页面单独抓包）。当前可用：overview / list。`,
      { mode: MODE, available: ['overview', 'list'] })
  }

  if (!['overview', 'list'].includes(MODE)) {
    fail('api_error', `未知或未实现的 mode：${MODE}。当前可用：overview / list`, { mode: MODE })
  }

  emit(out)
} catch (err) {
  fail('api_error', `抖音商品查询异常：${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  releaseProfile(dir)
}
