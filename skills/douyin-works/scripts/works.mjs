#!/usr/bin/env node
/**
 * 抖音作品数据查询与分析 — DSAgent douyin-works v1.0
 *
 * 拉自己账号的作品列表 + 30 项内容质量指标（work_list 的 items[].metrics），
 * 输出结构化分析结论（六条口径）。
 *
 * ## 用法
 *
 *     node works.mjs                          # 列最近 20 条
 *     node works.mjs --count 50               # 列 50 条
 *     node works.mjs --video v0300fg1...      # 查某条的播放直链
 *     node works.mjs --json                   # 原始 JSON
 *     node works.mjs --analyze                # 按六条口径出分析结论
 *
 * ## 接口（全部实测）
 *
 *   A. 作品列表   GET /aweme/v1/creator/item/list/?cursor=<ts>&count=<n>&aid=1128
 *   B. 播放直链   GET /web/api/media/video/transend/?video_id=<vid>&aid=1128
 *   C. 30 项指标  GET /janus/douyin/creator/pc/work_list?status=0&count=50&...
 */

import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = process.env.DSAGENT_PLUGIN_ROOT || join(HERE, '..', '..', '..')
// Windows 下绝对路径必须转 file:// URL 才能被 ESM loader 接受
const PURL = (p) => pathToFileURL(p).href
const OUT_DIR = join(HERE, '..', 'artifacts')
mkdirSync(OUT_DIR, { recursive: true })

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

const COUNT = parseInt(ARGS.count || '20', 10) || 20
const VIDEO_ID = (ARGS.video || '').trim()
const AS_JSON = truthy(ARGS.json)
const ANALYZE = truthy(ARGS.analyze)
const ACCOUNT = (ARGS.account || '').trim()

// 必须是**单行** JSON：宿主按行读取 __DSAGENT_RESULT__ 协议，
// 带缩进（null, 2）会输出多行，宿主只拿到第一行 → 解析成 {"raw": "{"}。
function emit(payload) {
  console.log('__DSAGENT_RESULT__' + JSON.stringify(payload))
}
const fail = (kind, message, extra = {}) => {
  emit({ ok: false, failure_kind: kind, message, ...extra })
  process.exit(1)
}
const log = (msg) => console.error('[douyin-works] ' + msg)

// ── 起浏览器（work_list 要 a_bogus）──────────────────────
let store, CredentialStore
let profileDir, findChromePath, tryAcquireProfile, releaseProfile, clearProfileLocks, sleep
try {
  ;({ CredentialStore } = await import(PURL(join(PLUGIN_ROOT, 'lib', 'services', 'credential-store.js'))))
  ;({ profileDir, findChromePath, tryAcquireProfile, releaseProfile, clearProfileLocks, sleep } =
    await import(PURL(join(PLUGIN_ROOT, 'lib', 'browser-login.js'))))
  store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
} catch (e) {
  fail('api_error', `无法加载插件库（${PLUGIN_ROOT}）：${e.message}`)
}

const accounts = store.listAccounts().filter(a => a.platform === 'douyin' && a.status !== 'invalid')
if (!accounts.length) fail('not_bound', '未找到抖音账号。请到「账号连接」页面添加抖音账号。')
let account
if (ACCOUNT) {
  account = accounts.find(a => a.shop_key === ACCOUNT)
  if (!account) fail('api_error', `账号 shopKey 不存在：${ACCOUNT}。可用：${accounts.map(a => a.shop_key).join(' / ')}`)
} else if (accounts.length === 1) {
  account = accounts[0]
} else {
  fail('need_account_choice',
    `抖音平台有 ${accounts.length} 个可用账号，请指定 --account：\n`
    + accounts.map((a, i) => `${i + 1}. ${a.nickname}（${a.shop_key}）`).join('\n'),
    { accounts: accounts.map(a => ({ shop_key: a.shop_key, nickname: a.nickname })) })
}

const dir = profileDir('douyin', account.shop_key)
if (!tryAcquireProfile(dir, 'douyin-works')) {
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
    headless: false, executablePath: chromePath, userDataDir: dir,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1200,800'],
  })
  const page = await browser.newPage()

  const cookieList = Object.entries(account.cookies || {})
    .filter(([, v]) => v !== '' && v != null)
    .map(([name, value]) => ({ name, value: String(value), domain: '.douyin.com', path: '/' }))
  if (cookieList.length) await page.setCookie(...cookieList)

  log('加载作品管理页（等 secsdk 装签名，13s）...')
  await page.goto('https://creator.douyin.com/creator-micro/content/manage',
    { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(13000)
  await page.evaluate(() => { window.__sf = window.fetch.bind(window) })

  const sf = (path) => page.evaluate(async (path) => {
    const r = await window.__sf(path)
    const t = await r.text()
    let j = null
    try { j = JSON.parse(t) } catch { /* ignore */ }
    return { status: r.status, json: j, text: j ? null : t.slice(0, 500) }
  }, path)

  // 登录态预检
  const pre = await sf('/aweme/v1/creator/item/list/?cursor=0&count=1&aid=1128')
  if (pre.json?.status_code === 8) {
    fail('token_expired', '抖音登录态已失效（status_code=8）。请到「账号连接」页面对该抖音账号重新登录后重试。')
  }

  // ── 模式 1：查单个 video_id 的播放直链 ──────────────────
  if (VIDEO_ID) {
    const r = await sf(`/web/api/media/video/transend/?video_id=${VIDEO_ID}&aid=1128`)
    if (r.json?.status_code === 0) {
      const v = r.json
      emit({
        ok: true,
        video_id: VIDEO_ID,
        resolution: `${v.width}x${v.height}`,
        duration: v.duration,
        bitrate: v.bitrate,
        codec: v.codec_type,
        fps: v.fps,
        format: v.format,
        size: v.size,
        poster_uri: v.poster_uri,
        play_url: v.play_url,
        poster_url: v.poster_url,
        message: `播放直链已获取（${v.width}x${v.height} ${v.duration}s）。注意该链接带时效签名，需重新请求刷新。`,
      })
    } else {
      fail('api_error', '查询失败：' + JSON.stringify(r.json || r.text).slice(0, 400))
    }
  } else {
  // ── 模式 2：work_list 拉 30 项指标 ──────────────────────
  const wl = await sf('/janus/douyin/creator/pc/work_list?status=0&count=50&max_cursor=0&scene=star_atlas&device_platform=android&aid=1128')
  const items = wl.json?.items || []
  if (!items.length) {
    fail('api_error', 'work_list 未返回作品：' + JSON.stringify(wl.json).slice(0, 400))
  }
  writeFileSync(join(OUT_DIR, `works-${Date.now()}.json`), JSON.stringify(items, null, 2))

  // work_list 的 id 把 item_id_plain 末三位清零了，补拉 item/list 拿精确 id。
  // 匹配键用「标题 + 分钟级时间」：两边 create_time 粒度不同（item/list 只到分），
  // 用秒级时间戳匹配会因几十秒偏差全部落空（实测踩过）。
  let idMap = new Map()
  try {
    const il = await sf('/aweme/v1/creator/item/list/?cursor=0&count=50&aid=1128')
    for (const it of il.json?.item_info_list || []) {
      const m = String(it.create_time || '').match(/(\d{4})年(\d{2})月(\d{2})日\s+(\d{2}):(\d{2})/)
      if (!m) continue
      const minuteKey = `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}`
      const title = String(it.title || '').trim()
      // 双键：标题精确 + 标题前20字，提高命中率
      idMap.set(`t|${title}`, it.item_id_plain)
      idMap.set(`p|${title.slice(0, 20)}`, it.item_id_plain)
    }
  } catch { /* item/list 失败不影响主流程，降级用 work_list 的 id */ }

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
  const rows = items.map(it => {
    const m = it.metrics || {}
    const views = num(m.view_count)
    const type = it.type === 1 ? '图文' : it.type === 2 ? '视频' : 'type' + it.type
    const desc = (it.description || '').trim()
    // 优先用 item/list 的精确 id；拿不到则用 work_list 的（末三位已被清零）
    const id = idMap.get(`t|${desc}`) || idMap.get(`p|${desc.slice(0, 20)}`) || String(it.id)
    return {
      id,
      type,
      desc,
      descLen: desc.length,
      createTime: new Date(num(it.create_time) * 1000).toLocaleString('zh-CN'),
      ts: num(it.create_time),
      views,
      likes: num(m.like_count),
      comments: num(m.comment_count),
      shares: num(m.share_count),
      favs: num(m.favorite_count),
      subs: num(m.subscribe_count),
      likeRate: views ? +(num(m.like_count) / views * 100).toFixed(2) : 0,
      completionRate: num(m.completion_rate),
      completionRate5s: num(m.completion_rate_5s),
      bounceRate2s: num(m.bounce_rate_2s),
      avgViewSecond: num(m.avg_view_second),
      fanViewProportion: num(m.fan_view_proportion),
      coverShow: num(m.cover_show),
      pictureCount: it.picture_info?.count || 0,
      reviewStatus: it.review?.status,
      reviewText: it.review?.details?.[0]?.text || (it.review?.status === 2 ? '已通过' : `status=${it.review?.status}`),
      coverUri: it.cover?.uri,
    }
  }).sort((a, b) => b.ts - a.ts)

  if (AS_JSON) { emit({ ok: true, total: rows.length, rows }); } else {

  // ── 六条口径分析 ────────────────────────────────────────
  const totalViews = rows.reduce((s, r) => s + r.views, 0)
  const totalLikes = rows.reduce((s, r) => s + r.likes, 0)
  const totalComments = rows.reduce((s, r) => s + r.comments, 0)
  const totalShares = rows.reduce((s, r) => s + r.shares, 0)
  const totalSubs = rows.reduce((s, r) => s + r.subs, 0)
  const top = rows.reduce((a, b) => (b.views > a.views ? b : a), rows[0])
  const topShare = totalViews ? (top.views / totalViews * 100).toFixed(1) : '0'
  const restricted = rows.filter(r => r.reviewStatus !== 2)
  // cover_show 只对视频有意义（图文无「封面曝光」概念），限视频判断推荐流是否给量
  const zeroCoverShow = rows.filter(r => r.coverShow === 0 && r.views > 0 && r.type === '视频')

  const lines = []
  lines.push(`════ 抖音作品数据（${rows.length} 条）════\n`)
  lines.push('【汇总】')
  lines.push(`  累计播放 ${totalViews.toLocaleString()} | 赞 ${totalLikes} | 评 ${totalComments} | 转 ${totalShares} | 涨粉 ${totalSubs}`)
  lines.push(`  平均播放 ${Math.round(totalViews / rows.length).toLocaleString()} | 中位数 ${rows.map(r => r.views).sort((a, b) => a - b)[Math.floor(rows.length / 2)].toLocaleString()}`)
  lines.push('')
  lines.push('【明细】')
  rows.forEach((r, i) => {
    lines.push(`${String(i + 1).padStart(3)}. [${r.type}] ${r.desc.slice(0, 40)}${r.descLen > 40 ? '…' : ''}`)
    lines.push(`     id=${r.id} ${r.createTime} 标题${r.descLen}字`)
    lines.push(`     播放${r.views.toLocaleString()} 赞${r.likes} 评${r.comments} 转${r.shares} 涨粉${r.subs}`)
    lines.push(`     点赞率${r.likeRate}% 2s跳出${(r.bounceRate2s * 100).toFixed(1)}% 5s完播${(r.completionRate5s * 100).toFixed(1)}% 完播${(r.completionRate * 100).toFixed(1)}%`)
    if (r.reviewStatus !== 2) lines.push(`     ⚠ ${r.reviewText}`)
    lines.push('')
  })

  if (ANALYZE) {
    lines.push('════ 六条分析口径 ════\n')
    lines.push(`1. 头马篇：《${top.desc.slice(0, 30)}…》播放 ${top.views.toLocaleString()}，占总播放 ${topShare}%。`)
    lines.push(`2. 互动匹配度：总播放 ${totalViews.toLocaleString()}，总互动 ${totalLikes + totalComments + totalShares}，`
      + `互动率 ${totalViews ? ((totalLikes + totalComments + totalShares) / totalViews * 100).toFixed(2) : '0.00'}%。`)
    lines.push(`3. 涨粉效率：总涨粉 ${totalSubs}，单次阅读涨粉率 ${totalViews ? (totalSubs / totalViews * 100).toFixed(3) : '0.000'}%。`
      + (totalSubs === 0 ? '为 0 → 内容没有建立「关注理由」。' : ''))
    if (restricted.length) {
      lines.push(`4. 限流检测：${restricted.length} 条非正常状态 →`)
      restricted.forEach(r => lines.push(`   · 《${r.desc.slice(0, 30)}…》${r.reviewText}`))
    } else {
      lines.push('4. 限流检测：未发现异常状态。')
    }
    if (zeroCoverShow.length) {
      lines.push(`5. 流量来源：${zeroCoverShow.length} 条 cover_show=0 但有点播 →`)
      zeroCoverShow.forEach(r => lines.push(`   · 《${r.desc.slice(0, 30)}…》播放 ${r.views} 但封面曝光 0 → 流量来自搜索/分享，推荐流未给量`))
    } else {
      lines.push('5. 流量来源：未发现 cover_show=0 的作品。')
    }
    // 第 6 条：下一步
    const actions = []
    if (restricted.length) actions.push(`先申诉被限流的《${restricted[0].desc.slice(0, 20)}…》——这是唯一有量级的资产`)
    if (rows.some(r => r.descLen > 30)) actions.push('标题压到 30 字内（当前平均 ' + Math.round(rows.reduce((s, r) => s + r.descLen, 0) / rows.length) + ' 字）')
    if (zeroCoverShow.length) actions.push('重做封面与开头 3 秒，把 2s 跳出率压到 30% 以下')
    if (totalSubs === 0) actions.push('建立系列感与人设，给观众「关注理由」')
    lines.push(`6. 下一步：${actions.length ? actions.join('；') : '维持当前节奏，持续观测四项核心指标（完播/5s完播/2s跳出/涨粉）'}`)
    lines.push('')
  }

  const text = lines.join('\n')
  if (ANALYZE) console.log(text)

  emit({
    ok: true,
    total: rows.length,
    summary: {
      totalViews, totalLikes, totalComments, totalShares, totalSubs,
      avgViews: Math.round(totalViews / rows.length),
      restricted: restricted.length,
      zeroCoverShow: zeroCoverShow.length,
    },
    top: { id: top.id, desc: top.desc.slice(0, 60), views: top.views, sharePct: topShare },
    rows: rows.slice(0, COUNT).map(r => ({
      id: r.id, type: r.type, desc: r.desc.slice(0, 80), descLen: r.descLen,
      createTime: r.createTime, views: r.views, likes: r.likes, comments: r.comments,
      shares: r.shares, subs: r.subs, likeRate: r.likeRate,
      bounceRate2s: +(r.bounceRate2s * 100).toFixed(1),
      completionRate5s: +(r.completionRate5s * 100).toFixed(1),
      reviewStatus: r.reviewStatus, reviewText: r.reviewText,
    })),
    analysis: ANALYZE ? text : undefined,
    message: `已获取 ${rows.length} 条作品数据。加 --analyze 输出六条口径结论，--video <video_id> 查播放直链。`,
  })
  }
  }
} catch (err) {
  fail('api_error', `抖音作品查询异常：${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  releaseProfile(dir)
}
