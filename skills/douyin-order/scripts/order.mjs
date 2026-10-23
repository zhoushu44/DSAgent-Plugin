#!/usr/bin/env node
/**
 * 抖音小店·订单查询（douyin-order）—— 只读
 *
 * 数据源：抖店后台 fxg.jinritemai.com。
 * 采用「打开页面 → hook 页面自己发的响应」取数。
 *
 * 能力：
 *   overview   订单总览（各状态订单计数）
 *   list       订单列表（--status: all/topay/tosend/sent/done/closed）
 *   detail     单笔订单详情（--order-id）
 *
 * 规划中（本版不实现）：发货 / 改价 / 备注 / 取消订单（L2 写操作）。
 *
 * 用法：node scripts/order.mjs --mode list --status tosend
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
const ORDER_ID = (ARGS['order-id'] || ARGS.orderId || '').trim()
const LIMIT = Math.min(100, Math.max(1, parseInt(ARGS.limit || '20', 10) || 20))
const ACCOUNT = (ARGS.account || '').trim()

// 订单状态归一：待发货/已发货/已完成/全部
const STATUS_ALIAS = {
  all: 'all', 全部: 'all',
  topay: 'topay', 待付款: 'topay', 待支付: 'topay',
  tosend: 'tosend', 待发货: 'tosend',
  sent: 'sent', 已发货: 'sent', 已揽收: 'sent',
  done: 'done', 已完成: 'done', 已完成: 'done',
  closed: 'closed', 已关闭: 'closed', 已取消: 'closed',
}
const STATUS = STATUS_ALIAS[String(ARGS.status || 'all').trim()] || String(ARGS.status || 'all').trim()

// 必须是**单行** JSON：宿主按行读取 __DSAGENT_RESULT__ 协议
function emit(payload) {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n')
}
function fail(kind, message, extra = {}) {
  emit({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })
  process.exit(1)
}
const log = (msg) => console.error('[douyin-order] ' + msg)
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
if (!tryAcquireProfile(dir, 'douyin-order')) {
  fail('api_error', '抖店的浏览器环境正被其他任务占用，请稍后重试。')
}
clearProfileLocks(dir)

// 参数前置校验（未过校验不必起浏览器）
if (MODE === 'detail' && !ORDER_ID) {
  releaseProfile(dir)
  fail('api_error', 'detail 模式需要 --order-id 参数。', { mode: MODE })
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

  // ── APIS：接口 path 片段 → key（已由 _douyin_probe/probe10 实测回填）─────
  // 判据：抖店域 st===0
  const APIS = [
    ['orderList',  '/api/order/searchlist'],      // 订单列表（主接口，561KB 响应）
    ['orderCnt',   '/api/order/tabcnt'],          // 各状态计数
    ['orderNotice','/api/order/getNotice'],       // 订单通知
    ['operateCfg', '/api/order/operateReasonConfig'], // 操作原因配置
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

  // 打开抖店后台订单页，让页面自己发数据请求
  // TODO(待探测回填)：按真实页面路由调整（如 /ffa/o/list?status=x）
  // 打开抖店后台订单页，让页面自己发数据请求（路由由 probe7 从菜单 DOM 实测）
  // 实测 top_tab_id 枚举：all / topay(待支付) / stock_up(待发货) / on_delivery(已发货) / received(已完成)
  const TAB = (STATUS && STATUS !== 'all') ? STATUS : 'all'
  const PAGES = [
    `https://fxg.jinritemai.com/ffa/morder/order/list?top_tab_id=${encodeURIComponent(TAB)}`,
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
      + '把真实接口 path 填进 scripts/order.mjs 的 APIS 常量。',
      { mode: MODE, stub: true, pages: PAGES, hits: hitCount })
  }
  if (!hitCount) {
    fail('api_error', '接口待回填：已打开抖店后台页面但未拦截到任何目标接口响应。'
      + '请先跑探测脚本确认页面是否登录、接口 path 是否变化。',
      { mode: MODE, stub: true, pages: PAGES, hits: 0, activeApis: ACTIVE_APIS.map(([k, f]) => `${k}=${f}`) })
  }

  // ── 解析（字段依据 _douyin_probe/API-FINDINGS.md 与实测响应）────────
  const oCnt = byApi.orderCnt || null          // tabcnt
  const oListRaw = byApi.orderList
  const oArr = Array.isArray(oListRaw) ? oListRaw
    : Array.isArray(oListRaw?.list) ? oListRaw.list
    : Array.isArray(oListRaw?.orders) ? oListRaw.orders : []

  // 金额一律「分 → 元」
  const yuan = (v) => (v == null || v === '') ? null : (Number(v) / 100)
  const ts = (v) => { const n = Number(v); return n > 0 ? new Date(n * 1000).toLocaleString('zh-CN') : null }

  // 抖店 order_status 实测枚举（2026-10 在该店样本验证）
  // ⚠️ 只有 2 和 4 被真实样本证实；其余按抖店通用语义预留，未验证。
  const STATUS_DESC = {
    1: '待支付', 2: '待发货', 3: '已发货', 4: '已完成',
    5: '已关闭', 6: '已取消', 7: '售后中',
  }

  const orderItems = oArr.slice(0, LIMIT).map((o) => {
    const ri = o.receiver_info || null
    const addr = ri?.post_addr || null
    return {
      id: o.shop_order_id ?? o.order_id ?? null,
      status: o.order_status ?? null,
      statusDesc: STATUS_DESC[o.order_status] ?? `status=${o.order_status ?? '?'}`,
      productCount: o.product_count ?? null,
      payAmount: yuan(o.pay_amount),              // 元
      actualPayAmount: yuan(o.actual_pay_amount), // 元
      receiveAmount: yuan(o.actual_receive_amount_int), // 商家实收（元）
      payTypeDesc: o.pay_type_desc ?? null,
      createTime: ts(o.create_time),
      payTime: ts(o.pay_time),
      expShipTime: ts(o.exp_ship_time),
      logisticsTime: ts(o.logistics_time),
      receiptTime: ts(o.receipt_time),
      buyerNickname: o.user_nickname ?? null,
      receiver: ri?.post_receiver ?? null,        // 已脱敏（如「牛*」）
      receiverTel: ri?.post_tel ?? null,          // 已脱敏
      province: addr?.province?.name ?? null,
      city: addr?.city?.name ?? null,
      town: addr?.town?.name ?? null,
      addressDetail: addr?.detail ?? null,        // 平台已打码
      waitShipCount: o.wait_ship_count ?? 0,
      shippedCount: o.shipped_count ?? 0,
      remark: o.remark ?? o.buyer_words ?? '',
    }
  })

  const out = { ok: true, mode: MODE, shopKey: account.shop_key, items: [] }
  const lines = []

  if (MODE === 'overview' || MODE === 'list') {
    // tabcnt 是嵌套结构：sub_tab_count_map.all 底下才是「全部」维度的各状态计数。
    // 顶层 received:0 是「已发货未签收」中间态，不是「已完成」——直接读顶层会误判（实测踩坑）。
    const subAll = oCnt?.sub_tab_count_map?.all || null
    const cnt = subAll || oCnt || null
    out.counts = cnt ? {
      // 「全部」维度
      all: cnt.all ?? oCnt?.all ?? null,
      unpaid: cnt.unpaid ?? null,          // 待支付
      stockUp: cnt.stock_up ?? null,       // 待发货
      expShip: cnt.exp_ship ?? null,       // 即将超时发货
      shipDelay: cnt.ship_delay ?? null,   // 发货延迟
      onDelivery: cnt.on_delivery ?? null, // 已发货
      received: cnt.received ?? null,      // 已完成（已签收）
      closed: cnt.closed ?? null,          // 已关闭
      outOfStock: cnt.out_of_stock ?? null,// 缺货
      // 售后相关
      inAftersale: oCnt?.in_aftersale ?? null,
      haveAftersale: cnt.have_aftersale ?? null,
      handling: cnt.handling ?? null,
    } : null
    out.status = STATUS || 'all'
    out.items = orderItems
    out.total = orderItems.length

    if (MODE === 'overview') {
      lines.push('订单总览：')
      if (out.counts) {
        lines.push(`  全部 ${out.counts.all ?? '—'} | 待支付 ${out.counts.unpaid ?? '—'}`
          + ` | 待发货 ${out.counts.stockUp ?? '—'} | 已发货 ${out.counts.onDelivery ?? '—'}`)
        // ⚠️ tabcnt 的 closed 是「已完结」口径（含已完成），received 是「已签收」严格口径，
        //    两者不可混为一谈；订单列表里的 order_status=4 才是「已完成」。
        lines.push(`  已完结 ${out.counts.closed ?? '—'}`)
        if (out.counts.outOfStock != null) lines.push(`  缺货 ${out.counts.outOfStock}`)
        if (out.counts.expShip != null) lines.push(`  24h 需发货 ${out.counts.expShip}`)
        if (out.counts.shipDelay != null) lines.push(`  超时未发货 ${out.counts.shipDelay}`)
        if (out.counts.inAftersale != null) lines.push(`  售后中 ${out.counts.inAftersale}`)
      } else {
        lines.push('  各状态计数：暂无数据（tabcnt 未返回）')
      }
      if (orderItems.length) {
        lines.push('')
        lines.push(`当前页前 ${orderItems.length} 笔：`)
        orderItems.slice(0, 10).forEach((o, i) => {
          lines.push(`  ${i + 1}. [${o.id}] ${o.statusDesc}`
            + ` 金额 ${o.payAmount ?? '—'} 元 × ${o.productCount ?? '—'} 件`)
          lines.push(`     ${o.createTime ?? '—'} | ${o.province ?? ''}${o.city ?? ''}${o.town ?? ''} | ${o.receiver ?? '—'}`)
        })
      }
    } else {
      lines.push(`订单列表（${orderItems.length} 笔，状态=${STATUS || 'all'}）：`)
      if (orderItems.length) {
        orderItems.forEach((o, i) => {
          lines.push(`  ${i + 1}. [${o.id}] ${o.statusDesc}`
            + ` 金额 ${o.payAmount ?? '—'} 元 × ${o.productCount ?? '—'} 件`)
          lines.push(`     ${o.createTime ?? '—'} | ${o.receiver ?? '—'} | ${o.province ?? ''}${o.city ?? ''}${o.town ?? ''}`)
          if (o.expShipTime) lines.push(`     最晚发货 ${o.expShipTime}`)
        })
      } else {
        lines.push('  暂无数据（该状态下没有订单，或页面未加载完）')
      }
    }
    out.text = lines.join('\n')
  }

  // detail：所需接口未在探测中确认，明确失败，不假装支持
  if (MODE === 'detail') {
    fail('api_error',
      'mode=detail 尚未实现：单笔订单详情接口未在探测中确认'
      + '（需打开 /ffa/morder/order/detail-v2 页面单独抓包）。当前可用：overview / list。',
      { mode: MODE, available: ['overview', 'list'] })
  }

  if (!['overview', 'list'].includes(MODE)) {
    fail('api_error', `未知或未实现的 mode：${MODE}。当前可用：overview / list`, { mode: MODE })
  }

  emit(out)
} catch (err) {
  fail('api_error', `抖音订单查询异常：${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  releaseProfile(dir)
}
