#!/usr/bin/env node
/**
 * zhihu-publish-http — 知乎专栏文章发布（RE HTTP 三步链路）
 *
 * 已实测可用的发布链路（zhuanlan 域，只需 x-xsrftoken，无 x-zse-96 签名）：
 *   1) POST  /api/articles/drafts          建草稿
 *   2) PATCH /api/articles/{id}/draft      写标题 + 正文（HTML）
 *   3) PUT   /api/articles/{id}/publish    发布
 *
 * 实测踩坑（已规避）：
 *   - POST /api/articles 已 404，入口是 /api/articles/drafts
 *   - PATCH /api/articles/{id} 是 405，必须带 /draft 后缀
 *   - 发布是 PUT 不是 POST，POST /publish 返 405
 *   - /api/v4/me 在 zhuanlan 域 404，探登录态必须去 www 域
 *   - 响应体 slice 上限要够（60000），否则 JSON 解析失败但文章已发布
 *   - 单次 page.evaluate 只发一个 URL，长循环会挂死
 *
 * 输出：单行 JSON __DSAGENT_RESULT__（宿主按行读取）
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

const WWW = 'https://www.zhihu.com'
const ZHUANLAN = 'https://zhuanlan.zhihu.com'
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

const FILE = (ARGS.file || '').trim()
const CONTENT_ARG = (ARGS.content || '').trim()
const TITLE_ARG = (ARGS.title || '').trim()
const ACCOUNT = (ARGS.account || '').trim()
const DRY = truthy(ARGS.dry)
const CONFIRM = truthy(ARGS.confirm)

// ── 输出协议：必须单行 ───────────────────────────────────
function emit(payload) {
  console.log('__DSAGENT_RESULT__' + JSON.stringify(payload))
}
const fail = (kind, message, extra = {}) => {
  emit({ ok: false, failure_kind: kind, message, ...extra })
  process.exit(1)
}
const log = (msg) => console.error('[zhihu-publish-http] ' + msg)

// ── Markdown → HTML（知乎 content 收 HTML）────────────────
function mdToHtml(md) {
  const lines = md.split(/\r?\n/)
  const out = []
  let inTable = false
  let inCode = false

  const inline = (s) => {
    let t = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    t = t.replace(/`(.+?)`/g, '<code>$1</code>')
    t = t.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<i>$1</i>')
    return t
  }
  const isTableSep = (l) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(l) && l.includes('-')

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (ln.trim().startsWith('```')) {
      inCode = !inCode
      out.push(inCode ? '<pre><code>' : '</code></pre>')
      continue
    }
    if (inCode) { out.push(inline(ln)); continue }

    const s = ln.trim()
    if (s.startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      if (!inTable) {
        inTable = true
        const hdr = s.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
        out.push('<table><thead><tr>' + hdr.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>')
      } else {
        const cells = s.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
        out.push('<tr>' + cells.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>')
      }
      continue
    }
    if (inTable) { inTable = false; out.push('</tbody></table>') }

    if (ln.startsWith('### ')) out.push(`<h3>${inline(ln.slice(4).trim())}</h3>`)
    else if (ln.startsWith('## ')) out.push(`<h2>${inline(ln.slice(3).trim())}</h2>`)
    else if (ln.startsWith('## ')) out.push(`<h2>${inline(ln.slice(3).trim())}</h2>`)
    else if (ln.startsWith('# ')) { /* 标题由 title 字段承载，正文跳过 H1 */ }
    else if (s === '---') out.push('<hr>')
    else if (ln.startsWith('>')) out.push(`<blockquote>${inline(ln.slice(1).trim())}</blockquote>`)
    else if (ln.startsWith('- ')) out.push(`<p>· ${inline(ln.slice(2).trim())}</p>`)
    else if (/^\d+\.\s/.test(ln)) out.push(`<p>${inline(ln)}</p>`)
    else if (s === '') { /* 空行跳过 */ }
    else out.push(`<p>${inline(s)}</p>`)
  }
  if (inTable) out.push('</tbody></table>')
  return out.join('')
}

// ── 取标题与正文 ────────────────────────────────────────
let title = TITLE_ARG
let bodyMd = CONTENT_ARG
let sourceFile = ''

if (FILE) {
  if (!existsSync(FILE)) fail('api_error', `文件不存在：${FILE}`)
  const raw = readFileSync(FILE, 'utf8')
  const lines = raw.split(/\r?\n/)
  let bodyStart = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { bodyStart = i; break }
  }
  if (!title && lines[0] && lines[0].startsWith('# ')) title = lines[0].slice(2).trim()
  bodyMd = lines.slice(bodyStart).join('\n').trim()
  sourceFile = FILE
}

if (!title) fail('api_error', '缺少标题。用 --title 指定，或在 --file 首行写 `# 标题`')
if (!bodyMd) fail('api_error', '缺少正文。用 --content 传 Markdown，或用 --file 指定文章文件')
if (title.length > 100) fail('api_error', `标题 ${title.length} 字，超过知乎上限 100 字`)

const bodyHtml = mdToHtml(bodyMd)

// ── 预览模式（不带 confirm 也不带 dry 时，先给预览）──────
if (!CONFIRM && !DRY) {
  emit({
    ok: true,
    needConfirm: true,
    preview: {
      title, titleLen: title.length,
      bodyChars: bodyMd.length, htmlChars: bodyHtml.length,
      sourceFile: sourceFile || '(inline content)',
      bodyHead: bodyMd.slice(0, 200),
    },
    message: '【发布预览 · 需用户确认】确认无误后带 --confirm true 重新调用才会真正发布。',
  })
  process.exit(0)
}

// ── 起浏览器 ────────────────────────────────────────────
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
if (!tryAcquireProfile(dir, 'zhihu-publish-http')) {
  fail('api_error', '知乎的浏览器环境正被其他任务占用，请稍后重试。')
}
clearProfileLocks(dir)

let browser = null
try {
  const puppeteer = await import(pathToFileURL(join(PLUGIN_ROOT, 'node_modules', 'puppeteer-core',
    'lib', 'esm', 'puppeteer', 'puppeteer-core.js')).href)
  const chromePath = findChromePath()
  if (!chromePath) fail('api_error', '未找到 Chrome 或 Edge 浏览器')

  log('打开知乎专栏域（等签名环境，6s）...')
  browser = await puppeteer.launch({
    executablePath: chromePath,
    userDataDir: dir,
    headless: false,
    args: ['--no-first-run', '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled', '--window-size=1500,950'],
  })
  const page = await browser.newPage()
  await page.goto(ZHUANLAN + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(6000)

  // 登录态预检（zhuanlan 域的 /api/v4/me 是 404，必须回 www 域）
  // 必须用**函数式** evaluate：puppeteer 传字符串时按「表达式」求值，
  // 传 `async (url) => {...}` 会返回函数对象本身（序列化成 {}），不会执行。
  const meRes = await page.evaluate(async (url) => {
    try {
      const r = await fetch(url, { credentials: 'include' })
      return { status: r.status, body: (await r.text()).slice(0, 2000) }
    } catch (e) {
      return { status: -1, body: String(e) }
    }
  }, `${WWW}/api/v4/me`)
  if (meRes.status !== 200) {
    fail('token_expired', '知乎登录态失效，请到「账号连接」页面对该知乎账号重新登录')
  }
  let me = {}
  try { me = JSON.parse(meRes.body) } catch { /* ignore */ }
  if (!me.id) fail('token_expired', '无法获取知乎账号资料，登录态可能失效，请重新登录')
  log(`账号：${me.name} (id=${me.id})`)

  // 通用请求：页面内 fetch，自动带 Cookie 与 x-xsrf-token（函数式 evaluate）
  const call = async (method, url, body) => page.evaluate(async (args) => {
    const [m, u, bd] = args
    const tok = (document.cookie.match(/(?:^|; )_xsrf=([^;]+)/) || [, ''])[1]
    const H = { 'Content-Type': 'application/json', 'x-requested-with': 'fetch' }
    if (tok) H['x-xsrftoken'] = decodeURIComponent(tok)
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 20000)
      const r = await fetch(u, {
        method: m, credentials: 'include', headers: H,
        body: bd === null ? undefined : JSON.stringify(bd), signal: ctrl.signal,
      })
      clearTimeout(t)
      return { status: r.status, body: (await r.text()).slice(0, 60000) }
    } catch (e) {
      return { status: -1, body: String(e).slice(0, 300) }
    }
  }, [method, url, body === undefined ? null : body])

  // 步骤 1：建草稿
  log('步骤 1/3：建草稿')
  const s1 = await call('POST', `${ZHUANLAN}/api/articles/drafts`,
    { title, delta_time: 0, can_reward: false })
  if (s1.status !== 200 && s1.status !== 201) {
    fail('api_error', `建草稿失败 HTTP ${s1.status}: ${(s1.body || '').slice(0, 300)}`)
  }
  let draftId = null
  try { draftId = JSON.parse(s1.body).id } catch { /* 下面统一判 */ }
  if (!draftId) fail('parse_error', `草稿响应中无 id（可能被截断）：${(s1.body || '').slice(0, 300)}`)
  log(`draftId = ${draftId}`)

  // 步骤 2：写标题 + 正文
  log('步骤 2/3：写标题与正文')
  const s2 = await call('PATCH', `${ZHUANLAN}/api/articles/${draftId}/draft`,
    { title, content: bodyHtml, table_of_contents: false, delta_time: 0, can_reward: false })
  if (![200, 201, 204].includes(s2.status)) {
    fail('api_error', `写正文失败 HTTP ${s2.status}: ${(s2.body || '').slice(0, 300)}`)
  }

  if (DRY) {
    const jsonPath = join(OUT_DIR, `zhihu-draft-${draftId}.json`)
    writeFileSync(jsonPath, JSON.stringify({ draftId, title, html: bodyHtml }, null, 2), 'utf8')
    emit({
      ok: true, dry: true, draftId,
      title, titleLen: title.length,
      bodyChars: bodyMd.length, htmlChars: bodyHtml.length,
      url: `${ZHUANLAN}/p/${draftId}`,
      json_path: jsonPath,
      message: `草稿已建好并写入正文（未发布）。draftId=${draftId}`,
    })
    process.exit(0)
  }

  // 步骤 3：发布（PUT，不是 POST）
  log('步骤 3/3：发布')
  const s3 = await call('PUT', `${ZHUANLAN}/api/articles/${draftId}/publish`, {})
  const published = [200, 201].includes(s3.status)

  let art = {}
  try { art = JSON.parse(s3.body) } catch { /* 响应体可能超限，但文章已发布 */ }

  const jsonPath = join(OUT_DIR, `zhihu-publish-${draftId}.json`)
  writeFileSync(jsonPath, JSON.stringify({
    draftId, title, htmlChars: bodyHtml.length,
    steps: { create: s1.status, write: s2.status, publish: s3.status },
    response: (s3.body || '').slice(0, 4000),
  }, null, 2), 'utf8')

  if (!published) {
    fail('api_error', `发布失败 HTTP ${s3.status}: ${(s3.body || '').slice(0, 300)}`, { draftId, json_path: jsonPath })
  }

  emit({
    ok: true,
    published: true,
    draftId,
    articleId: art.id || draftId,
    title: art.title || title,
    url: art.url || `${ZHUANLAN}/p/${art.id || draftId}`,
    excerpt: String(art.excerpt || '').slice(0, 200),
    voteup_count: art.voteup_count ?? 0,
    steps: { create: s1.status, write: s2.status, publish: s3.status },
    json_path: jsonPath,
    message: '已发布。平台可能仍在审核，最终状态以「创作中心 → 内容管理」为准。',
  })
} catch (err) {
  fail('api_error', `发布异常：${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  releaseProfile(dir)
}
