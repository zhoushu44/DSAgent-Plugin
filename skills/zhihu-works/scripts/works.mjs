#!/usr/bin/env node
/**
 * zhihu-works — 知乎创作数据查询与分析（Node 版）
 *
 * 与 zhihu-analytics（Python 版）同一套接口，差异只在语言与输出协议：
 *   - 单行 JSON 输出 __DSAGENT_RESULT__（宿主按行读取，带缩进会被截断）
 *   - 一次 page.evaluate 只发一个 URL（长循环会让 evaluate 挂死）
 *
 * 已验证接口（全部 200）：
 *   GET /api/v4/creators/creations/v2/all                                       创作列表
 *   GET /api/v4/creators/analysis/realtime/content/list?type=article             实时指标
 *   GET /api/v4/creators/analysis/realtime/content/aggr?type=article&token=      单篇汇总
 *   GET /api/v4/creators/analysis/realtime/content/daily?type=article&token=     单篇日趋势
 *   GET /api/v4/creators/analysis/realtime/content/visitor_portrait              读者画像
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = join(HERE, '..')
const PLUGIN_ROOT = process.env.DSAGENT_PLUGIN_ROOT || join(SKILL_DIR, '..', '..')
const OUT_DIR = join(SKILL_DIR, 'artifacts')
mkdirSync(OUT_DIR, { recursive: true })

const BASE = 'https://www.zhihu.com'
const BODY_SLICE = 60000

// ── 参数 ────────────────────────────────────────────────
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
const TYPE = (ARGS.type || 'article').trim()
const CONTENT_ID = (ARGS.content_id || ARGS['content-id'] || '').trim()
const DAYS = Math.min(Math.max(parseInt(ARGS.days || '30', 10) || 30, 1), 365)
const LIMIT = Math.min(Math.max(parseInt(ARGS.limit || '20', 10) || 20, 1), 50)
const WANT_CSV = truthy(ARGS.csv)
const ACCOUNT = (ARGS.account || '').trim()

// ── 输出协议：必须单行 ───────────────────────────────────
function emit(payload) {
  console.log('__DSAGENT_RESULT__' + JSON.stringify(payload))
}
const fail = (kind, message, extra = {}) => {
  emit({ ok: false, failure_kind: kind, message, ...extra })
  process.exit(1)
}
const log = (msg) => console.error('[zhihu-works] ' + msg)

const VALID_MODES = ['overview', 'list', 'article', 'trend']
if (!VALID_MODES.includes(MODE)) fail('skill_error', `mode 非法：${MODE}，可用 ${VALID_MODES.join('/')}`)
if (!['article', 'answer', 'pin'].includes(TYPE)) {
  fail('skill_error', `type 非法：${TYPE}，只能用 article/answer/pin（all 会返回 error type）`)
}
if ((MODE === 'article' || MODE === 'trend') && !CONTENT_ID) {
  fail('skill_error', `${MODE} 模式需要 --content-id，先跑 --mode list 取内容 ID`)
}

// ── 页面内 fetch：一次一个 URL ──────────────────────────
// 必须用**函数式** evaluate：puppeteer 的 page.evaluate 传字符串时按「表达式」求值，
// 传 `async (url) => {...}` 会返回函数对象本身（序列化成 {}），不会执行。
async function fetchInPage(page, url) {
  return page.evaluate(async (u) => {
    try {
      const r = await fetch(u, { credentials: 'include' })
      return { status: r.status, body: (await r.text()).slice(0, 60000) }
    } catch (e) {
      return { status: -1, body: String(e).slice(0, 300) }
    }
  }, url)
}

async function fetchJson(page, url, what) {
  const r = await fetchInPage(page, url)
  if (r.status !== 200) {
    const kind = r.status === 403 ? 'risk_control' : 'api_error'
    fail(kind, `${what} HTTP ${r.status}: ${(r.body || '').slice(0, 200)}`)
  }
  let payload
  try { payload = JSON.parse(r.body) } catch {
    fail('parse_error', `${what} 响应解析失败: ${(r.body || '').slice(0, 200)}`)
  }
  if (Array.isArray(payload)) return { data: payload }
  if (!payload || typeof payload !== 'object') fail('parse_error', `${what} 响应格式异常`)
  if (payload.error && typeof payload.error === 'object') {
    fail('api_error', `${what} 知乎接口错误: ${payload.error.message || payload.error.code}`)
  }
  if (payload.msg && payload.code && !('data' in payload)) {
    fail('api_error', `${what} 知乎接口错误: ${payload.msg} (code=${payload.code})`)
  }
  return payload
}

// ── 归一化 ──────────────────────────────────────────────
const num = (v) => { const n = parseInt(v ?? 0, 10); return Number.isFinite(n) ? n : 0 }
const rate = (v) => (typeof v === 'number' ? Math.round(v * 10000) / 10000 : null)
const tsDate = (ts) => {
  const n = parseInt(ts, 10)
  if (!Number.isFinite(n) || n <= 0) return ''
  const d = new Date((n + 8 * 3600) * 1000)   // 北京时间
  return d.toISOString().slice(0, 10)
}

function normalizeTrendDay(d) {
  if (!d || typeof d !== 'object') return {}
  let upvote = d.upvote
  if (upvote === null || upvote === undefined) upvote = d.new_upvote
  let like = d.like
  if (like === null || like === undefined) like = d.new_like
  const pv = num(d.pv)
  const inter = num(upvote) + num(d.comment) + num(like) + num(d.collect) + num(d.share)
  return {
    p_date: d.p_date || '',
    pv,
    upvote: num(upvote),
    comment: num(d.comment),
    like: num(like),
    collect: num(d.collect),
    share: num(d.share),
    follow_uv: num(d.new_follow_uv),
    pageshow_uv: num(d.pageshow_uv),
    fcr: rate(d.follower_conversion_rate),
    avg_read: d.avg_read_duration ?? null,
    interact_rate: pv ? Math.round((inter / pv) * 10000) / 10000 : null,
    follow_rate: pv ? Math.round((num(d.new_follow_uv) / pv) * 10000) / 10000 : null,
  }
}

function mergeRows(creations, contentList) {
  const items = creations.data || []
  const metrics = contentList.data || []
  return items.map((it, idx) => {
    const d = (it && it.data) || {}
    const m = metrics[idx] || {}
    const inter = num(m.upvote) + num(m.comment) + num(m.like) + num(m.collect) + num(m.share)
    const pv = num(m.pv)
    const mark = m.content_mark || {}
    return {
      id: String(d.id || ''),
      type: it.type || '',
      title: d.title || '(无标题)',
      created: tsDate(d.created_time),
      updated: tsDate(d.updated_time),
      pv,
      upvote: num(m.upvote),
      comment: num(m.comment),
      like: num(m.like),
      collect: num(m.collect),
      share: num(m.share),
      follow_uv: num(m.new_follow_uv),
      fcr: rate(m.follower_conversion_rate),
      pir: rate(m.positive_interact_rate),
      avg_read: m.avg_read_duration ?? null,
      interact_rate: pv ? Math.round((inter / pv) * 10000) / 10000 : null,
      follow_rate: pv ? Math.round((num(m.new_follow_uv) / pv) * 10000) / 10000 : null,
      is_collapsed: !!mark.is_collapsed,
      is_suggest: !!mark.is_suggest,
    }
  })
}

function buildReport(rows) {
  const arts = rows.filter(r => r.type === 'article')
  const pool = arts.length ? arts : rows
  if (!pool.length) return '账号下暂无内容数据。'
  const srt = [...pool].sort((a, b) => b.pv - a.pv)
  const top = srt[0]
  const totalPv = pool.reduce((s, r) => s + r.pv, 0)
  const totalInter = pool.reduce((s, r) => s + r.upvote + r.comment + r.like + r.collect + r.share, 0)
  const totalFollow = pool.reduce((s, r) => s + r.follow_uv, 0)
  const collapsed = pool.filter(r => r.is_collapsed)
  const pct = (v) => (typeof v === 'number' ? `${(v * 100).toFixed(2)}%` : '—')
  const L = []
  L.push(`1. 头马篇：《${top.title.slice(0, 24)}》阅读 ${top.pv}，占总阅读 ${totalPv ? pct(top.pv / totalPv) : '—'}，涨粉率 ${pct(top.fcr)}。`)
  L.push(`2. 阅读/互动匹配度：总阅读 ${totalPv}，总互动 ${totalInter}，互动率 ${totalPv ? pct(totalInter / totalPv) : '—'}。`
    + (totalPv && totalInter / totalPv < 0.01 ? '<1%，正文没接住流量，改正文结构。' : '基本匹配。'))
  L.push(`3. 涨粉效率：涨粉 UV ${totalFollow}，单次阅读涨粉率 ${totalPv ? pct(totalFollow / totalPv) : '—'}。`
    + (totalPv ? '>1% 强 / 0.1%~1% 一般 / <0.1% 缺关注理由。' : ''))
  L.push('4. 折叠/限流：' + (collapsed.length
    ? `检测到 ${collapsed.length} 篇被折叠（${collapsed.map(r => r.title.slice(0, 12)).join('、')}），折叠会压掉阅读。`
    : '未检测到折叠。'))
  L.push(`5. 时间衰减：头马篇发布 ${top.created}，平均阅读时长 ${top.avg_read ?? '数据不足'}。（逐日衰减看 --mode trend）`)
  L.push(`6. 下一步：复制《${top.title.slice(0, 16)}》的选题角度做同系列；对阅读高互动低的篇，前 300 字改成「结论 + 清单」结构。`)
  return L.join('\n')
}

// ── 主流程 ──────────────────────────────────────────────
let store, CredentialStore
let profileDir, findChromePath, tryAcquireProfile, releaseProfile, clearProfileLocks, sleep
try {
  ;({ CredentialStore } = await import(pathToFileURL(join(PLUGIN_ROOT, 'lib', 'services', 'credential-store.js')).href))
  ;({ profileDir, findChromePath, tryAcquireProfile, releaseProfile, clearProfileLocks, sleep } =
    await import(pathToFileURL(join(PLUGIN_ROOT, 'lib', 'browser-login.js')).href))
  store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
} catch (e) {
  fail('api_error', `无法加载插件库（${PLUGIN_ROOT}）：${e.message}`)
}

const accounts = store.listAccounts().filter(a => a.platform === 'zhihu' && a.status !== 'invalid')
if (!accounts.length) fail('not_bound', '未找到知乎账号。请到「账号连接」页面添加知乎账号。')
let account
if (ACCOUNT) {
  account = accounts.find(a => a.shop_key === ACCOUNT)
  if (!account) fail('api_error', `账号 shopKey 不存在：${ACCOUNT}。可用：${accounts.map(a => a.shop_key).join(' / ')}`)
} else if (accounts.length === 1) {
  account = accounts[0]
} else {
  fail('need_account_choice',
    `知乎平台有 ${accounts.length} 个可用账号，请指定 --account：\n`
    + accounts.map((a, i) => `${i + 1}. ${a.nickname}（${a.shop_key}）`).join('\n'),
    { accounts: accounts.map(a => ({ shop_key: a.shop_key, nickname: a.nickname })) })
}

const dir = profileDir('zhihu', account.shop_key)
if (!tryAcquireProfile(dir, 'zhihu-works')) {
  fail('api_error', '知乎的浏览器环境正被其他任务占用，请稍后重试。')
}
clearProfileLocks(dir)

let browser = null
try {
  const puppeteer = await import(pathToFileURL(join(PLUGIN_ROOT, 'node_modules', 'puppeteer-core',
    'lib', 'esm', 'puppeteer', 'puppeteer-core.js')).href)
  const chromePath = findChromePath()
  if (!chromePath) fail('api_error', '未找到 Chrome 或 Edge 浏览器')

  log('打开知乎创作中心（等 x-zse-96 签名环境，9s）...')
  browser = await puppeteer.launch({
    executablePath: chromePath,
    userDataDir: dir,
    headless: false,
    args: ['--no-first-run', '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled', '--window-size=1600,1000'],
  })
  const page = await browser.newPage()
  await page.goto(BASE + '/creator', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(9000)

  // 登录态预检（必须 www 域）
  const me = await fetchJson(page, `${BASE}/api/v4/me`, '登录态检查')
  if (!me.id) fail('token_expired', '无法获取知乎账号资料，登录态可能失效，请重新登录')
  log(`账号：${me.name} (id=${me.id})`)

  const end = new Date()
  const start = new Date(end.getTime() - DAYS * 86400000)
  const iso = (d) => d.toISOString().slice(0, 10)

  let rows = []
  let extra = {}

  if (MODE === 'article' || MODE === 'trend') {
    if (MODE === 'article') {
      const aggr = await fetchJson(page,
        `${BASE}/api/v4/creators/analysis/realtime/content/aggr?type=${TYPE}&token=${CONTENT_ID}&start=${iso(start)}&end=${iso(end)}`,
        '单篇汇总')
      let portrait = { content: { status: 'unavailable' } }
      try {
        portrait = await fetchJson(page,
          `${BASE}/api/v4/creators/analysis/realtime/content/visitor_portrait?type=${TYPE}&token=${CONTENT_ID}`,
          '读者画像')
      } catch { /* DMP 未开通是正常降级 */ }
      const item = { ...aggr }
      delete item.paging
      item.visitor_portrait = (portrait.content) || {}
      rows = [item]
      extra = { content_id: CONTENT_ID }
    } else {
      const daily = await fetchJson(page,
        `${BASE}/api/v4/creators/analysis/realtime/content/daily?type=${TYPE}&token=${CONTENT_ID}&start=${iso(start)}&end=${iso(end)}`,
        '单篇日趋势')
      rows = (daily.data || []).map(normalizeTrendDay)
      extra = { content_id: CONTENT_ID, days: DAYS, window: { start: iso(start), end: iso(end) } }
    }
  } else {
    const creations = await fetchJson(page,
      `${BASE}/api/v4/creators/creations/v2/all?start=0&end=0&limit=${LIMIT}&offset=0&need_co_creation=1&sort_type=created`,
      '创作列表')
    if (MODE === 'list') {
      rows = (creations.data || []).map(it => {
        const d = (it && it.data) || {}
        return {
          id: String(d.id || ''), type: it.type || '',
          title: d.title || '(无标题)', created: tsDate(d.created_time),
          excerpt: String(d.excerpt || '').slice(0, 120),
        }
      })
      extra = { totals: (creations.paging || {}).totals }
    } else {
      const contentList = await fetchJson(page,
        `${BASE}/api/v4/creators/analysis/realtime/content/list?type=${TYPE}&offset=0&limit=${LIMIT}`,
        `实时内容指标(${TYPE})`)
      rows = mergeRows(creations, contentList)
      extra = { totals: (creations.paging || {}).totals, report: buildReport(rows) }
    }
  }

  if (!rows.length) {
    emit({ ok: true, mode: MODE, total: 0, data: [], fetch_time: new Date().toISOString() })
    process.exit(0)
  }

  if (MODE === 'overview') {
    const top = rows.reduce((a, b) => (b.pv > a.pv ? b : a), rows[0])
    extra.top = { id: top.id, title: top.title, pv: top.pv }
  }

  // 落盘 + CSV
  const stamp = Date.now()
  const jsonPath = join(OUT_DIR, `zhihu-works-${MODE}-${stamp}.json`)
  writeFileSync(jsonPath, JSON.stringify(rows, null, 2), 'utf8')
  log(`产物：${jsonPath}`)

  let csvPath = null
  if (WANT_CSV) {
    const keys = Object.keys(rows[0])
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    csvPath = join(OUT_DIR, `zhihu-works-${MODE}-${stamp}.csv`)
    writeFileSync(csvPath,
      [keys.join(','), ...rows.map(r => keys.map(k => esc(r[k])).join(','))].join('\n'),
      'utf8')
    log(`CSV：${csvPath}`)
  }

  emit({
    ok: true,
    mode: MODE,
    type: TYPE,
    total: rows.length,
    days: DAYS,
    data: rows,
    account: { name: me.name, id: me.id, url_token: me.url_token },
    fetch_time: new Date().toISOString(),
    json_path: jsonPath,
    csv_path: csvPath,
    message: `已获取 ${rows.length} 条内容数据。加 --analyze 或看 report 字段得六条口径结论。`,
    ...extra,
  })
} catch (err) {
  fail('api_error', `知乎作品查询异常：${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  releaseProfile(dir)
}
