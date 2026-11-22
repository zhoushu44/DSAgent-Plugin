#!/usr/bin/env node
/**
 * xiaohongshu-analytics —— 小红书创作数据（查询 + 分析）
 * ============================================================================
 * 执行策略（**先主链路，失败才兜底**）：
 *
 *   ① 主链路（默认）：纯 HTTP + 自算签名（_shared/xhs-sign.mjs）
 *        GET /api/sns/web/v1/note_list —— 不开浏览器、秒级返回
 *
 *   ② 兜底（`--fallback page`，或主链路报 sign_rejected / risk_control）：
 *        开真 Chrome 读「笔记管理」页 DOM（_shared/xhs-browser.mjs）
 *        · 慢，但页面自己带签名，抗改版
 *
 * 模式：
 *   overview  笔记列表 + 指标汇总（默认）
 *   list      仅笔记列表
 *   detail    单篇详情（预留：当前降级为列表内定位）
 *   trend     单篇日趋势（预留）
 *
 * 用法：
 *   node scripts/fetch.mjs --mode overview --limit 50 [--csv]
 *   node scripts/fetch.mjs --mode list --limit 100 --fallback page
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SKILL_ROOT = join(HERE, '..')
const PLUGIN_ROOT = process.env.DSAGENT_PLUGIN_ROOT || join(SKILL_ROOT, '..', '..')
const PURL = (p) => pathToFileURL(p).href

const NOTE_MANAGER = 'https://creator.xiaohongshu.com/new/note-manager'

/* ── 参数 ─────────────────────────────────────────────────── */
function parseArgs(argv) {
  const out = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--'))
      continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--'))
      out[key] = 'true'
    else { out[key] = next; i++ }
  }
  return out
}
const ARGS = parseArgs(process.argv)
const truthy = (v) => ['true', '1', 'yes', 'y'].includes(String(v ?? '').trim().toLowerCase())

const MODE = (ARGS.mode || 'overview').trim()
const NOTE_ID = (ARGS['note-id'] || ARGS.noteId || '').trim()
const LIMIT = Math.min(200, Math.max(1, parseInt(ARGS.limit || '50', 10) || 50))
const WANT_CSV = truthy(ARGS.csv)
const ACCOUNT = (ARGS.account || '').trim()
/** auto=先主链路再兜底 | http=只走主链路 | page=强制兜底 */
const FALLBACK = (ARGS.fallback || 'auto').trim().toLowerCase()

/* ── 输出协议 ─────────────────────────────────────────────── */
const log = (m) => process.stderr.write('[xhs-analytics] ' + m + '\n')
const fail = (kind, message, extra = {}) => ({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })

/** stdout 走管道时写入是异步的，必须等 flush 再退出 */
function emitAndExit(payload, code) {
  const line = '__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n'
  process.exitCode = code
  process.stdout.write(line, () => process.exit(code))
  setTimeout(() => process.exit(code), 2000).unref?.()
}

/** 退出哨兵：裸 process.exit 会跳过 finally，浏览器/Profile 锁就还不了 */
class Exit extends Error {
  constructor(code, payload) {
    super('__exit__')
    this.code = code
    this.payload = payload
  }
}
const exitWith = (code, payload) => { throw new Exit(code, payload) }

/* ── 心跳（兜底链路要开浏览器，可能超 60s idle）──────────── */
let beatTimer = null
let beat = 0
function startHeartbeat(stepRef) {
  beatTimer = setInterval(() => {
    beat += 1
    log(`心跳 ${beat}（${stepRef.value}，已 ${beat * 10}s）`)
  }, 10_000)
  beatTimer.unref?.()
}
function stopHeartbeat() {
  if (beatTimer)
    clearInterval(beatTimer)
  beatTimer = null
}

/* ── 页面内读取脚本（兜底用，与旧 fetch_data.py 的 JS_* 一致）── */
const JS_READ_LIST = `(function(){
  var t = document.body.innerText.replace(/\\s+/g,' ');
  var tabs = [];
  var els = [...document.querySelectorAll('*')].filter(function(e){
    return e.children.length === 0 && /^(全部|已发布|审核中|未通过)\\s*\\d*$/.test((e.innerText||'').trim());
  });
  for (var i=0;i<els.length;i++){ tabs.push((els[i].innerText||'').trim()); }
  return JSON.stringify({
    url: location.href,
    tabs: tabs,
    total: (t.match(/全部\\s*(\\d+)/)||[])[1] || null,
    text: t.slice(0, 3000),
  });
})()`

const JS_READ_ROWS = `(function(){
  var rows = [];
  var cands = document.querySelectorAll('tr, [class*=table-row], [class*=note-row], [class*=list-item]');
  for (var i=0;i<cands.length;i++){
    var el = cands[i];
    var txt = (el.innerText||'').replace(/\\s+/g,' ').trim();
    if (!txt || txt.length < 6) continue;
    if (/^(全部|已发布|审核中|未通过)\\s*\\d*$/.test(txt)) continue;
    var hasDate = /\\d{4}-\\d{2}-\\d{2}/.test(txt);
    if (!hasDate) continue;
    rows.push({ raw: txt.slice(0, 400) });
    if (rows.length >= 100) break;
  }
  var full = document.body.innerText.replace(/\\s+/g,' ');
  if (!rows.length) {
    var re = /([\\u4e00-\\u9fa5\\w\\s#＃！？，。、~-]{2,60}?)\\s*(\\d{4}-\\d{2}-\\d{2}\\s*\\d{2}:\\d{2})/g;
    var m;
    while ((m = re.exec(full)) && rows.length < 100) {
      rows.push({ raw: (m[1] + ' ' + m[2]).slice(0, 400) });
    }
  }
  return JSON.stringify({ url: location.href, count: rows.length, rows: rows, fullText: full.slice(0, 4000) });
})()`

/* ── 解析（DOM 兜底文本 → 笔记）──────────────────────────── */
/**
 * 页面列序实测：状态/时长 → 互动数字 → 标题 → 日期时间
 */
function parseNotesFromRows(rows) {
  const notes = []
  for (const r of rows || []) {
    const raw = String(r?.raw || '').trim()
    if (!raw)
      continue

    const m = raw.match(/(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2})?/)
    const date = m ? (m[1] + (m[2] ? ' ' + m[2] : '')) : null

    let status = null
    for (const s of ['审核中', '未通过', '已发布', '草稿']) {
      if (raw.includes(s)) { status = s; break }
    }

    const idx = m ? raw.indexOf(m[0]) : raw.length
    let before = raw.slice(0, idx)
    before = before.replace(/^(审核中|未通过|已发布|草稿)\s*/, '').trim()

    const tokens = before.split(/\s+/).filter(Boolean)
    const title = tokens.filter((t) => !/^\d+$/.test(t)).join(' ').replace(/^[\s　,，|·-]+|[\s　,，|·-]+$/g, '') || '(无标题)'

    let nums = tokens.filter((t) => /^\d+$/.test(t))
    if (!nums.length && m) {
      const tail = raw.slice(idx + m[0].length)
      nums = tail.split(/\s+/).filter((t) => /^\d+$/.test(t))
    }

    notes.push({ title: title.slice(0, 80), status, date, nums: nums.slice(-6), raw: raw.slice(0, 250) })
  }

  const seen = new Set()
  const uniq = []
  for (const n of notes) {
    const k = n.title + '|' + (n.date || '')
    if (seen.has(k))
      continue
    seen.add(k)
    uniq.push(n)
  }
  return uniq
}

/* ── 汇总 ─────────────────────────────────────────────────── */
function summarize(notes, tabs, extra = {}) {
  const byStatus = {}
  for (const n of notes) {
    const k = n.status || '未知'
    byStatus[k] = (byStatus[k] || 0) + 1
  }
  const dated = notes.filter((n) => n.time || n.date)
    .sort((a, b) => String(b.time || b.date).localeCompare(String(a.time || a.date)))

  const out = {
    total: extra.totalNumber ?? notes.length,
    byStatus,
    latest: dated[0]?.time || dated[0]?.date || null,
    oldest: dated[dated.length - 1]?.time || dated[dated.length - 1]?.date || null,
    interactions: notes
      .filter((n) => (n.nums || []).length)
      .slice(0, 20)
      .map((n) => ({ title: (n.title || '').slice(0, 40), date: n.time || n.date || null, vals: n.nums })),
  }
  // 列表页不显示单条状态，状态由 tab 决定 —— 明确标注口径，别让模型误读
  if (out.total && (byStatus['未知'] || 0) === notes.length && tabs?.length) {
    out.statusNote = `列表页不显示单条状态，状态由 tab 决定。当前 tabs：${tabs.join(' / ')}。`
      + '可按 tab 分别采集以确定每篇状态。'
  }
  return out
}

function writeCsv(notes, path) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const lines = [['标题', '状态', '时间', '互动数', '笔记ID', '原始行'].join(',')]
  for (const n of notes) {
    lines.push([n.title, n.status, n.time || n.date, (n.nums || []).join(' '), n.id, n.raw].map(esc).join(','))
  }
  writeFileSync(path, '\ufeff' + lines.join('\r\n') + '\r\n', 'utf8')
}

/* ── 主链路：纯 HTTP ─────────────────────────────────────── */
async function fetchViaHttp(api, cookieStr) {
  const all = []
  let total = null
  const pageSize = Math.min(100, Math.max(1, LIMIT))

  for (let page = 0; page < 2; page++) {
    const r = await api.listNotes({ cookieStr, page, pageSize })
    if (!r.ok)
      return { ok: false, failureKind: r.failureKind, message: r.message }
    const { notes, total: t } = api.normalizeNoteList(r.payload)
    if (t !== null)
      total = t
    all.push(...notes)
    if (notes.length < pageSize || all.length >= LIMIT)
      break
  }

  return { ok: true, channel: 'http', notes: all, total }
}

/* ── 兜底：页面 DOM ─────────────────────────────────────── */
async function fetchViaPage(lib, store, shopKey) {
  const session = await lib.openXhsSession({ store, shopKey, log })
  try {
    const { page, ev } = session
    log('打开笔记管理页…')
    await page.goto(NOTE_MANAGER, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    if (/\/login|passport/i.test(page.url()))
      return { ok: false, failureKind: 'token_expired', message: '小红书创作中心登录态已失效，请到「账号连接」重新登录。' }
    await lib.sleep(9000)

    let info = {}
    try { info = JSON.parse(await ev(JS_READ_LIST)) } catch { info = {} }

    let rows = []
    try {
      const rowsRes = JSON.parse(await ev(JS_READ_ROWS))
      rows = rowsRes.rows || []
    } catch { rows = [] }

    const notes = parseNotesFromRows(rows)
    if (!notes.length && !info.total)
      return {
        ok: false, failureKind: 'parse_error',
        message: '未从笔记管理页解析到任何笔记或总数（可能登录态失效或页面改版）。',
        detail: { url: info.url || page.url(), tabs: info.tabs || [], text: String(info.text || '').slice(0, 300) },
      }

    return { ok: true, channel: 'page', notes, total: info.total, tabs: info.tabs || [] }
  } finally {
    try { await session.close() } catch { /* 忽略 */ }
  }
}

/* ── 主流程 ───────────────────────────────────────────────── */
async function main() {
  if (!['overview', 'list', 'detail', 'trend'].includes(MODE))
    exitWith(1, fail('api_error', `--mode 只能是 overview / list / detail / trend，当前：${MODE}`))
  if ((MODE === 'detail' || MODE === 'trend') && !NOTE_ID)
    exitWith(1, fail('api_error', `--mode ${MODE} 需要 --note-id（笔记 ID，可从 list 模式的 notes[].id 或页面链接取）`))
  if (!['auto', 'http', 'page'].includes(FALLBACK))
    exitWith(1, fail('api_error', '--fallback 只能是 auto / http / page。'))

  const stepRef = { value: 'boot' }
  startHeartbeat(stepRef)

  try {
    const lib = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'xhs-browser.mjs')))
    const api = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'xhs-api.mjs')))
    const libs = await lib.loadXhsLibs()
    const store = lib.openStore(libs)

    const pick = await lib.pickXhsAccount(store, { want: ACCOUNT, skill: 'xiaohongshu-analytics' })
    if (!pick.ok)
      exitWith(2, fail(pick.failureKind || 'not_bound', pick.text || '账号不可用', pick.accounts ? { accounts: pick.accounts } : {}))

    const account = store.get(pick.shopKey)
    if (!account)
      exitWith(2, fail('not_bound', `账号不存在：${pick.shopKey}`))

    const cookieStr = api.jarToCookieStr(account.cookies)
    log(`使用账号 ${pick.label || pick.shopKey}（${pick.shopKey}）`)

    let got = null

    if (FALLBACK !== 'page') {
      stepRef.value = 'http'
      log('主链路：纯 HTTP + 自算签名')
      const r = await fetchViaHttp(api, cookieStr)
      if (r.ok) {
        got = r
        log(`主链路取到 ${r.notes.length} 条`)
      } else {
        log(`主链路失败（${r.failureKind}）：${r.message}`)
        if (FALLBACK === 'auto' && api.shouldFallback(r.failureKind))
          log('切换到页面兜底…')
        else
          exitWith(r.failureKind === 'token_expired' ? 2 : 1, fail(r.failureKind || 'api_error', r.message, { channel: 'http' }))
      }
    }

    if (!got) {
      stepRef.value = 'page'
      const r = await fetchViaPage(lib, store, pick.shopKey)
      if (!r.ok)
        exitWith(1, fail(r.failureKind || 'api_error', r.message, r.detail ? { detail: r.detail } : {}))
      got = r
    }

    const notes = got.notes || []
    const totalNum = got.total === null || got.total === undefined ? null : Number(got.total)
    const summary = summarize(notes, got.tabs || [], { totalNumber: Number.isFinite(totalNum) ? totalNum : undefined })

    const base = {
      ok: true,
      mode: MODE,
      account: pick.shopKey,
      channel: got.channel,
      total: got.total ?? null,
      tabs: got.tabs || [],
    }

    if (MODE === 'list') {
      exitWith(0, { ...base, notes: notes.slice(0, LIMIT) })
    }

    const result = { ...base, summary, notes: notes.slice(0, LIMIT) }

    if (MODE === 'detail' || MODE === 'trend') {
      const hit = notes.find((n) => String(n.id || '') === NOTE_ID || String(n.raw || '').includes(NOTE_ID)) || null
      result.requestedNoteId = NOTE_ID
      result.degraded = true
      result.message = `mode=${MODE} 尚未实现（单篇数据接口未确认），已降级为列表内定位。`
      result.note = hit
      if (!hit)
        result.message += ` 列表前 ${notes.length} 条中未找到 id=${NOTE_ID}。`
    }

    if (WANT_CSV) {
      const d = new Date()
      const p2 = (n) => String(n).padStart(2, '0')
      const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
      const dir = join(process.cwd(), 'artifacts', 'xhs-analytics')
      mkdirSync(dir, { recursive: true })
      const p = join(dir, `xhs_notes_${stamp}.csv`)
      writeCsv(notes.slice(0, LIMIT), p)
      result.csv = p
    }

    exitWith(0, result)
  } catch (e) {
    if (e instanceof Exit)
      throw e
    throw Object.assign(new Error(String(e?.message || e)), { failureKind: e?.failureKind || 'skill_error' })
  } finally {
    stopHeartbeat()
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    if (e instanceof Exit)
      return emitAndExit(e.payload ?? { ok: false, failure_kind: 'skill_error', message: 'no payload' }, e.code)
    emitAndExit(fail(e?.failureKind || 'skill_error', String(e?.message || e)), 1)
  },
)
