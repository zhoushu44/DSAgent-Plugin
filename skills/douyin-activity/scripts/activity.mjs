#!/usr/bin/env node
/**
 * 抖音小店·活动报名（douyin-activity）—— 只读
 *
 * 数据源：抖店后台营销活动子应用 fxg.jinritemai.com。
 * 采用「打开页面 → hook 页面自己发的响应」取数（与 pdd-activity 同思路）。
 *
 * 能力：
 *   overview   活动总览（类型数 + 可报名活动数 + 推荐活动）
 *   list       可报名活动列表（活动ID/名称/类型/时间/报名截止）
 *   types      活动类型清单（含关键词说明）
 *   records    报名记录列表（活动ID/商品/状态）
 *
 * 规划中（本版不实现）：enroll / quit（L2 写操作）。
 * contract 已预留 --confirm 参数位，写模式落地时按两步走门禁接入。
 *
 * 用法：node scripts/activity.mjs --mode overview
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
const log = (msg) => console.error('[douyin-activity] ' + msg)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 规划中的写模式：本版不实现，遇到直接明确返回
const WRITE_MODES = ['enroll', 'quit']
if (WRITE_MODES.includes(MODE)) {
  fail('api_error',
    `${MODE} 是 L2 写操作，本版未实现（规划中）。当前只支持：overview / list / types / records。`
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
if (!tryAcquireProfile(dir, 'douyin-activity')) {
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
    ['actOverview',  'TODO:活动总览接口 path 片段'],
    ['actList',      'TODO:可报名活动列表接口 path 片段'],
    ['actTypes',     'TODO:活动类型清单接口 path 片段'],
    ['actRecords',   'TODO:报名记录接口 path 片段'],
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

  // 打开抖店后台活动页，让页面自己发数据请求
  // TODO(待探测回填)：按真实页面路由调整（如 /ffa/marketing/activity）
  const PAGES = [
    'https://fxg.jinritemai.com/ffa/marketing/activity',
    'https://fxg.jinritemai.com/ffa/marketing/activity/records',
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
      + '把真实接口 path 填进 scripts/activity.mjs 的 APIS 常量。',
      { mode: MODE, stub: true, pages: PAGES, hits: hitCount })
  }
  if (!hitCount) {
    fail('api_error', '接口待回填：已打开活动页面但未拦截到任何目标接口响应。'
      + '请先跑探测脚本确认页面是否登录、接口 path 是否变化。',
      { mode: MODE, stub: true, pages: PAGES, hits: 0, activeApis: ACTIVE_APIS.map(([k, f]) => `${k}=${f}`) })
  }

  // ── 解析 ────────────────────────────────────────────────
  // TODO(待探测回填)：以下字段映射需按真实响应结构调整
  const aOverview = byApi.actOverview || null
  const aList = byApi.actList?.list || byApi.actList?.activities || byApi.actList?.items || []
  const aTypes = byApi.actTypes?.list || byApi.actTypes?.types || byApi.actTypes?.items || []
  const aRecords = byApi.actRecords?.list || byApi.actRecords?.records || byApi.actRecords?.items || []

  const typeItems = aTypes.slice(0, LIMIT).map((t) => ({
    // TODO(待探测回填)：按真实字段名调整
    id: t.type_id ?? t.id ?? null,
    name: t.name ?? t.type_name ?? '',
    keywords: t.keywords ?? t.description ?? null,
  }))

  const actItems = aList.slice(0, LIMIT).map((a) => ({
    // TODO(待探测回填)：按真实字段名调整
    id: a.activity_id ?? a.id ?? null,
    name: a.name ?? a.activity_name ?? '',
    type: a.type ?? a.type_name ?? null,
    startTime: a.start_time ?? null,
    endTime: a.end_time ?? null,
    deadline: a.enroll_deadline ?? a.deadline ?? null,
  }))

  const recItems = aRecords.slice(0, LIMIT).map((r) => ({
    // TODO(待探测回填)：按真实字段名调整
    activityId: r.activity_id ?? null,
    activityName: r.activity_name ?? null,
    goodsId: r.product_id ?? r.goods_id ?? null,
    status: r.status ?? r.audit_status ?? null,
  }))

  const out = { ok: true, mode: MODE, shopKey: account.shop_key, items: [] }
  const lines = []

  if (MODE === 'overview') {
    out.activityTypes = typeItems
    out.activities = actItems
    out.recommended = aOverview?.recommended ?? aOverview?.recommend_activities ?? null
    lines.push('活动总览：')
    lines.push(`  活动类型数：${typeItems.length || (aOverview?.type_count ?? '—')}`)
    lines.push(`  可报名活动数：${actItems.length || (aOverview?.activity_count ?? '—')}`)
    if (Array.isArray(out.recommended) && out.recommended.length) {
      lines.push('  推荐活动：')
      out.recommended.slice(0, 5).forEach((r) => lines.push(`    · ${r.name ?? r.title ?? JSON.stringify(r).slice(0, 60)}`))
    }
    out.text = lines.join('\n') || '活动总览：暂无数据'
  }

  if (MODE === 'list') {
    out.activities = actItems
    out.items = actItems
    out.text = actItems.length
      ? `可报名活动（${actItems.length} 个）：\n` + actItems.map((a, i) =>
          `  ${i + 1}. [${a.id}] ${String(a.name).slice(0, 30)}`
          + `\n     类型=${a.type ?? '—'} 时间=${a.startTime ?? '—'} ~ ${a.endTime ?? '—'} 报名截止=${a.deadline ?? '—'}`
        ).join('\n')
      : '可报名活动：暂无数据'
  }

  if (MODE === 'types') {
    out.activityTypes = typeItems
    out.items = typeItems
    out.text = typeItems.length
      ? `活动类型（${typeItems.length} 种）：\n` + typeItems.map((t, i) =>
          `  ${i + 1}. [${t.id}] ${String(t.name).slice(0, 30)}${t.keywords ? ` — ${String(t.keywords).slice(0, 40)}` : ''}`
        ).join('\n')
      : '活动类型：暂无数据'
  }

  if (MODE === 'records') {
    out.records = recItems
    out.items = recItems
    out.text = recItems.length
      ? `报名记录（${recItems.length} 条）：\n` + recItems.map((r, i) =>
          `  ${i + 1}. [${r.activityId}] ${String(r.activityName ?? '').slice(0, 30)}`
          + `\n     商品=${r.goodsId ?? '—'} 状态=${r.status ?? '—'}`
        ).join('\n')
      : '报名记录：暂无数据'
  }

  if (!['overview', 'list', 'types', 'records'].includes(MODE)) {
    fail('api_error', `未知 mode：${MODE}。可用：overview / list / types / records`, { mode: MODE })
  }

  emit(out)
} catch (err) {
  fail('api_error', `抖音活动查询异常：${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  releaseProfile(dir)
}
