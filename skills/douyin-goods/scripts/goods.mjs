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

const accounts = store.listAccounts().filter((a) => a.platform === 'douyin' && a.status !== 'invalid')
if (!accounts.length) {
  fail('not_bound', '未找到抖音账号。请到「账号连接」页面添加抖音小店账号（抖店后台 fxg.jinritemai.com）。')
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

const dir = profileDir('douyin', account.shop_key)
if (!tryAcquireProfile(dir, 'douyin-goods')) {
  fail('api_error', '抖音的浏览器环境正被其他任务占用，请稍后重试。')
}
clearProfileLocks(dir)

// 参数前置校验（未过校验不必起浏览器）
if ((MODE === 'detail' || MODE === 'sku') && !PRODUCT_ID) {
  releaseProfile(dir)
  fail('api_error', `${MODE} 模式需要 --product-id 参数。`, { mode: MODE })
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

  // ── APIS：接口 path 片段 → key ───────────────────────────
  // TODO(待探测回填)：跑 node skills/_douyin_probe/probe.mjs，从 probe-out/hits-*.json
  //   里按响应内容定位下列用途的真实接口，把 'TODO:...' 换成 path 片段。
  //   含 'TODO' 的条目不参与匹配（见 ACTIVE_APIS），回填后自动生效。
  const APIS = [
    ['goodsOverview', 'TODO:商品总览接口 path 片段'],
    ['goodsList',     'TODO:商品列表接口 path 片段'],
    ['goodsDetail',   'TODO:单商品详情接口 path 片段'],
    ['goodsSku',      'TODO:单商品 SKU 全量接口 path 片段'],
    ['specPool',      'TODO:规格池接口 path 片段'],
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
      const okCode = j.st === 0 || j.code === 0 || j.code === '0' || j.success === true
      if (okCode) byApi[hit[0]] = j.data ?? j
    } catch { /* 单条失败不阻断 */ }
  })

  // 打开抖店后台商品页，让页面自己发数据请求
  const PAGES = [
    'https://fxg.jinritemai.com/ffa/g/list',
    'https://fxg.jinritemai.com/ffa/g/list?status=1',
  ]
  if (MODE === 'detail' || MODE === 'sku') {
    PAGES.unshift(`https://fxg.jinritemai.com/ffa/g/detail?id=${encodeURIComponent(PRODUCT_ID)}`)
  }
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

  // ── 解析 ────────────────────────────────────────────────
  // TODO(待探测回填)：以下字段映射需按真实响应结构调整
  const gOverview = byApi.goodsOverview || null
  const gList = byApi.goodsList?.list || byApi.goodsList?.items || byApi.goodsList?.products || []
  const gDetail = byApi.goodsDetail || null
  const gSku = byApi.goodsSku?.skus || byApi.goodsSku?.list || []
  const specPool = byApi.specPool || null

  const listItems = gList.slice(0, LIMIT).map((g) => ({
    // TODO(待探测回填)：按真实字段名调整
    id: g.product_id ?? g.id ?? null,
    name: g.name ?? g.title ?? '',
    category: g.category ?? g.category_name ?? null,
    skuCount: g.sku_count ?? null,
    priceRange: g.price_range ?? g.price ?? null,
    status: g.status ?? g.product_status ?? null,
  }))

  const out = { ok: true, mode: MODE, shopKey: account.shop_key, items: [] }
  const lines = []

  if (MODE === 'overview') {
    const onSale = listItems.filter((g) => String(g.status) === '1' || g.status === 'online' || g.status === 1).length
    out.summary = {
      onSale: gOverview?.on_sale ?? onSale ?? null,
      notOnSale: gOverview?.off_sale ?? null,
      totalShown: listItems.length,
    }
    out.items = listItems
    out.goodsOverview = gOverview
    lines.push('商品总览：')
    lines.push(`  在售：${out.summary.onSale ?? '—'} | 未在售：${out.summary.notOnSale ?? '—'}`)
    if (listItems.length) {
      lines.push(`  前 ${listItems.length} 条：`)
      listItems.slice(0, 10).forEach((g, i) => {
        lines.push(`    ${i + 1}. [${g.id}] ${String(g.name).slice(0, 30)}${g.priceRange ? `（${g.priceRange}）` : ''}`)
      })
    }
    out.text = lines.join('\n') || '商品总览：暂无数据'
  }

  if (MODE === 'list') {
    out.items = listItems
    out.text = listItems.length
      ? `商品列表（${listItems.length} 条）：\n` + listItems.map((g, i) =>
          `  ${i + 1}. [${g.id}] ${String(g.name).slice(0, 30)}`
          + `\n     类目=${g.category ?? '—'} SKU数=${g.skuCount ?? '—'} 价格=${g.priceRange ?? '—'} 状态=${g.status ?? '—'}`
        ).join('\n')
      : '商品列表：暂无数据'
  }

  if (MODE === 'detail') {
    out.detail = gDetail ? {
      id: gDetail.product_id ?? gDetail.id ?? PRODUCT_ID,
      name: gDetail.name ?? gDetail.title ?? '',
      category: gDetail.category ?? null,
      images: gDetail.images ?? gDetail.imgs ?? null,
      priceRange: gDetail.price_range ?? null,
      status: gDetail.status ?? null,
    } : null
    out.text = out.detail
      ? `商品详情 [${out.detail.id}] ${out.detail.name}\n  类目=${out.detail.category ?? '—'} 价格=${out.detail.priceRange ?? '—'} 状态=${out.detail.status ?? '—'}`
      : `商品 ${PRODUCT_ID}：暂无详情（接口未返回）`
  }

  if (MODE === 'sku') {
    out.productId = PRODUCT_ID
    out.sku = gSku.map((s) => ({
      // TODO(待探测回填)：按真实字段名调整
      skuId: s.sku_id ?? s.id ?? null,
      spec: s.spec ?? s.spec_name ?? null,
      price: s.price ?? null,
      stock: s.stock ?? null,
      image: s.image ?? null,
    }))
    out.items = out.sku
    out.text = out.sku.length
      ? `商品 ${PRODUCT_ID} SKU（${out.sku.length} 个）：\n` + out.sku.map((s, i) =>
          `  ${i + 1}. [${s.skuId}] ${String(s.spec ?? '—').slice(0, 30)} 价格=${s.price ?? '—'} 库存=${s.stock ?? '—'}`
        ).join('\n')
      : `商品 ${PRODUCT_ID}：暂无 SKU 数据`
  }

  if (MODE === 'spec-pool') {
    out.specPool = specPool || null
    out.text = specPool
      ? '规格池采集完成，详见 specPool 字段。'
      : '规格池：暂无数据（接口未返回）'
  }

  if (!['overview', 'list', 'detail', 'sku', 'spec-pool'].includes(MODE)) {
    fail('api_error', `未知 mode：${MODE}。可用：overview / list / detail / sku / spec-pool`, { mode: MODE })
  }

  emit(out)
} catch (err) {
  fail('api_error', `抖音商品查询异常：${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  releaseProfile(dir)
}
