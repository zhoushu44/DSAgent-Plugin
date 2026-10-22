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

// 抖店后台与 douyin 同平台凭证（credentialPlatform 同源，域为 .jinritemai.com）
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
if (!tryAcquireProfile(dir, 'douyin-shop')) {
  fail('api_error', '抖音的浏览器环境正被其他任务占用，请稍后重试。')
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
  //   里按响应内容定位下列用途的真实接口，把 'TODO:...' 换成 path 片段（如 'byteshop/xxx/list'）。
  //   含 'TODO' 的条目不参与匹配（见 ACTIVE_APIS），回填后自动生效。
  const APIS = [
    ['shopInfo',      'TODO:店铺信息/等级接口 path 片段'],
    ['flow',          'TODO:店铺流量接口 path 片段'],
    ['score',         'TODO:店铺体验分接口 path 片段'],
    ['goodsOverview', 'TODO:商品数据总览接口 path 片段'],
    ['goodsList',     'TODO:商品数据明细接口 path 片段'],
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
      // 抖店响应体统一 {st, code, msg, data}；st===0 / code==='0' 为成功
      const okCode = j.st === 0 || j.code === 0 || j.code === '0' || j.success === true
      if (okCode) byApi[hit[0]] = j.data ?? j
    } catch { /* 单条失败不阻断 */ }
  })

  // 打开抖店后台页面，让页面自己发数据请求
  const PAGES = [
    'https://fxg.jinritemai.com/ffa/',
    'https://fxg.jinritemai.com/ffa/shop',
    'https://fxg.jinritemai.com/ffa/data',
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

  // ── 解析 ────────────────────────────────────────────────
  // TODO(待探测回填)：以下字段映射需按真实响应结构调整
  const shopInfo = byApi.shopInfo || null
  const flow = byApi.flow || null
  const score = byApi.score || null
  const gOverview = byApi.goodsOverview || null
  const gList = byApi.goodsList?.list || byApi.goodsList?.items || []

  const goodsItems = gList.slice(0, LIMIT).map((g) => ({
    id: g.id ?? g.product_id ?? g.productId ?? null,
    name: g.name ?? g.title ?? '',
    // TODO(待探测回填)：按真实字段名调整下列取值
    uv: g.uv ?? null,
    payAmt: g.pay_amount ?? g.payAmt ?? null,
    payCnt: g.pay_count ?? g.payCnt ?? null,
    vcr: g.pay_uv_rate ?? g.vcr ?? null,
  }))

  const out = { ok: true, mode: MODE, shopKey: account.shop_key, items: [] }
  const lines = []

  if (MODE === 'overview' || MODE === 'flow') {
    out.flow = flow ? { uv: flow.uv ?? null, pv: flow.pv ?? null, payAmt: flow.pay_amount ?? null, payCnt: flow.pay_count ?? null } : null
    if (MODE === 'flow') {
      lines.push('店铺流量：')
      lines.push(`  访客(uv)：${out.flow?.uv ?? '—'}`)
      lines.push(`  浏览量(pv)：${out.flow?.pv ?? '—'}`)
      lines.push(`  成交金额：${out.flow?.payAmt ?? '—'} | 成交订单：${out.flow?.payCnt ?? '—'}`)
      out.text = lines.join('\n')
    }
  }

  if (MODE === 'overview' || MODE === 'score') {
    out.score = score || null
    if (MODE === 'score') {
      // TODO(待探测回填)：按真实体验分字段调整
      lines.push('店铺体验分（服务数据）：')
      lines.push(`  商品体验：${score?.product_experience ?? '—'}`)
      lines.push(`  物流体验：${score?.logistics_experience ?? '—'}`)
      lines.push(`  服务体验：${score?.service_experience ?? '—'}`)
      lines.push(`  综合体验分：${score?.shop_experience ?? '—'}`)
      out.text = lines.join('\n') || '店铺体验分：暂无数据'
    }
  }

  if (MODE === 'overview' || MODE === 'goods') {
    out.goodsOverview = gOverview || null
    out.goods = goodsItems
    out.items = goodsItems
    if (MODE === 'goods') {
      out.text = goodsItems.length
        ? `商品数据明细（${goodsItems.length} 个商品）：\n` + goodsItems.map((g, i) =>
            `  ${i + 1}. [${g.id}] ${String(g.name).slice(0, 24)}`
            + `\n     访客=${g.uv ?? '—'} 成交=${g.payAmt ?? '—'}元 订单=${g.payCnt ?? '—'} 转化率=${g.vcr ?? '—'}`
          ).join('\n')
        : '商品数据：暂无明细（接口未返回或页面未加载完）'
    }
  }

  if (MODE === 'overview') {
    lines.length = 0
    lines.push('店铺经营总览：')
    if (shopInfo) lines.push(`  店铺：${shopInfo.name ?? '—'}${shopInfo.level ? `（${shopInfo.level}）` : ''}`)
    if (out.flow) lines.push(`  访客 ${out.flow.uv ?? '—'} | 浏览量 ${out.flow.pv ?? '—'}`)
    if (goodsItems.length) {
      const top = goodsItems.slice().sort((a, b) => Number(b.payAmt || 0) - Number(a.payAmt || 0))[0]
      lines.push(`  成交金额最高商品：[${top.id}] ${String(top.name).slice(0, 24)}（${top.payAmt ?? '—'}元 / ${top.payCnt ?? '—'}单）`)
    }
    out.text = lines.join('\n')
  }

  if (!['overview', 'flow', 'score', 'goods'].includes(MODE)) {
    fail('api_error', `未知 mode：${MODE}。可用：overview / flow / score / goods`, { mode: MODE })
  }

  emit(out)
} catch (err) {
  fail('api_error', `抖音店铺经营数据查询异常：${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  releaseProfile(dir)
}
