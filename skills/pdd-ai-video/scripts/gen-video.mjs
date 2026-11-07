/**
 * pdd-ai-video — 拼多多 AI 素材工具（aid 域）图生视频
 *
 * ══════════════════════════════════════════════════════════════════
 * 设计要点（2026-11-06 定稿）
 * ══════════════════════════════════════════════════════════════════
 *
 * ★ 两阶段流水线（批量场景必须先 upload 全部，再 gen）
 *     阶段1 upload：本地图 → mms 图片空间 → img.pddpic.com URL，落 manifest.json
 *     阶段2 gen   ：从 manifest 读 URL → genVideo → 轮询 → 下载
 *   好处：上传失败不会白扣生成额度；可中断续跑；URL 可复用、可人工检查
 *
 * ★ 凭证一次取，长期复用（不反复拿）
 *     ptj_token 缓存到 .cache/ptj-token.json，带 expiresAt
 *     每次启动先校验有效期，有效直接用；过期才自动开一次浏览器刷新
 *     mms cookie 直接读凭证库（无需刷新）
 *
 * ★ 全链路纯 HTTP（零 anti-content）
 *     上传走 mms 的 store_image（不是 aid 的 material/upload，后者要 anti-content）
 *
 * ══════════════════════════════════════════════════════════════════
 * 实测硬约束（2026-11-05 参数测试结论）
 * ══════════════════════════════════════════════════════════════════
 *   genVideo 不做任何入参校验，全部返回 1000000 + uuid；
 *   真实校验在后台异步做，失败静默 40000，且额度照扣不退。
 *
 *   ① 图片必须 img.pddpic.com 域（外部域名必败）
 *   ② 图片 ≥480px 且比例 1:1 / 3:4 / 16:9（否则 40000）
 *   ③ 轮询必须 res.uuid === uuid（传假 uuid 会返回 uuid:null + RUNNING）
 *   ④ 并发 ≤2 且提交间隔 ≥2s（否则互相踢槽，失败还扣额度）
 *   ⑤ duration 参数无效，固定产出 ~5.09s / 112 帧 / 624×624
 *   ⑥ set/free 取消不退额度
 *   ⑦ 每日 100 个视频上限
 *
 *   本脚本在提交前做强校验（规格/格式/数量），避免白扣额度。
 *
 * ══════════════════════════════════════════════════════════════════
 * 用法
 * ══════════════════════════════════════════════════════════════════
 *   # 只上传（20 张图 → manifest）
 *   node gen-video.mjs --mode upload --dir "D:/imgs"
 *
 *   # 从 manifest 生成（可指定条数）
 *   node gen-video.mjs --mode gen --manifest <path> --limit 20
 *
 *   # 一条龙（上传 + 生成）
 *   node gen-video.mjs --mode run --dir "D:/imgs" --limit 20
 *
 *   # 其他
 *   node gen-video.mjs --mode quota
 *   node gen-video.mjs --mode status
 *   node gen-video.mjs --mode refresh-token
 */
import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(HERE, '..', '..', '..')
const PKG_BASE = [path.join(PLUGIN_ROOT, 'package.json'), path.join(HERE, 'package.json')].find((p) => fs.existsSync(p)) || path.join(HERE, 'package.json')
const require = createRequire(PKG_BASE)

const argOf = (n) => {
  const i = process.argv.indexOf(`--${n}`)
  if (i < 0 || i + 1 >= process.argv.length) return undefined
  const v = process.argv[i + 1]
  return v.startsWith('--') ? undefined : v
}
const emit = (o) => process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(o) + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.error(`[pdd-ai-video ${new Date().toISOString().slice(11, 19)}]`, ...a)

const MODE = argOf('mode') || 'run'
const SHOP = argOf('account')
const DIR = argOf('dir') || ''
const FILE_ARG = argOf('file') || ''
const OUTDIR = path.resolve(argOf('out') || path.join(HERE, '..', 'artifacts'))
const MANIFEST = argOf('manifest') || ''
const LIMIT = parseInt(argOf('limit') || '0', 10) || 0
const CONC = Math.max(1, Math.min(2, parseInt(argOf('concurrency') || '2', 10) || 2))
const GAP = Math.max(500, parseInt(argOf('gap') || '2200', 10) || 2200)
const MAXWAIT = Math.max(30000, parseInt(argOf('maxwait') || '420000', 10) || 420000)
const UID_ARG = argOf('uid') || ''
const DRY = process.argv.includes('--dry')

const CACHE_DIR = path.join(HERE, '..', '.cache')
const TOKEN_FILE = path.join(CACHE_DIR, 'ptj-token.json')
fs.mkdirSync(CACHE_DIR, { recursive: true })
fs.mkdirSync(OUTDIR, { recursive: true })

// ══════════════════════════════════════════════════════════════════
// 凭证
// ══════════════════════════════════════════════════════════════════

function loadMms() {
  const { CredentialStore } = require('./lib/services/credential-store.js')
  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  const accs = store.listAccounts().filter((a) => a.platform === 'pdd_mms')
  if (!accs.length) return null
  // ★ 账号选择：--account > ptj-token 缓存里记录的账号 > 凭证库第一个
  //   （凭证库顺序不稳定，新增账号后会取错，优先用 token 缓存里那个已验证可用的）
  let acc = null
  if (SHOP) {
    acc = accs.find((a) => a.shop_key === SHOP || a.display_label === SHOP)
  } else {
    let cachedShop = null
    try {
      const t = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
      if (t.shopKey) cachedShop = t.shopKey
    } catch { /* ignore */ }
    if (cachedShop) acc = accs.find((a) => a.shop_key === cachedShop)
    if (!acc) acc = accs.find((a) => String(a.cookies?.PASS_ID || '').length > 0) || accs[0]
  }
  if (!acc) return null
  const ck = acc.cookies || {}
  return {
    shopKey: acc.shop_key,
    label: acc.display_label,
    cookie: Object.entries(ck).map(([k, v]) => `${k}=${v}`).join('; '),
    ua: acc.account_meta?.env?.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  }
}

/** 读缓存的 ptj_token；过期或不存在返回 null */
function readToken() {
  try {
    const j = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
    if (!j.token) return null
    if (j.expiresAt && Date.now() > j.expiresAt - 60_000) return null   // 留 1 分钟余量
    return j
  } catch { return null }
}

/**
 * 从 ptj_token 里解 mallId
 * token 是单段 base64，payload 形如 {"t":"...","v":1,"s":5,"m":844492650,"u":154461147}
 * ★ m 就是 mallId，比问页面要可靠（页面上 __NEXT_DATA__ 和 cookie 都常常取不到）
 */
function mallIdFromToken(token) {
  try {
    const s = Buffer.from(String(token), 'base64').toString('utf8')
    const j = JSON.parse(s)
    if (j && j.m) return String(j.m)
  } catch { /* ignore */ }
  return null
}

function writeToken(token, expiresAt, mallId) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({
    token, expiresAt, mallId: mallId || mallIdFromToken(token), savedAt: new Date().toISOString(),
  }, null, 2))
}

/** 开一次浏览器拿 ptj_token（24h 有效，正常情况一天只跑一次） */
async function refreshToken(mms) {
  const puppeteer = require('puppeteer-core')
  const { launchOptions, STEALTH_SCRIPT } = await import('file://' + path.join(PLUGIN_ROOT, 'skills/_shared/pdd-launch.mjs').replace(/\\/g, '/'))
  let browser
  for (let i = 0; i < 5; i++) {
    try { browser = await puppeteer.launch(launchOptions(mms.shopKey)); break }
    catch { await sleep(2500) }
  }
  if (!browser) throw new Error('浏览器启动失败（profile 被占用）')
  try {
    const page = (await browser.pages())[0] || (await browser.newPage())
    await page.evaluateOnNewDocument(STEALTH_SCRIPT)
    await page.goto('https://mms.pinduoduo.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    await sleep(5500)
    await page.goto('https://aid.pinduoduo.com/design/ai-generator?layout=drawer&source=mms&currentTab=Image2Video', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    await sleep(9000)
    const cookies = await page.cookies()
    const t = cookies.find((c) => c.name === 'ptj_token')
    const mid = (cookies.find((c) => c.name === 'mall_id') || {}).value
    const landed = page.url()
    if (!t) throw new Error('未拿到 ptj_token，落地页=' + landed)
    const exp = t.expires ? t.expires * 1000 : Date.now() + 23 * 3600e3
    const midResolved = mid || mallIdFromToken(t.value) || mms.mallId
    writeToken(t.value, exp, midResolved)
    return { token: t.value, expiresAt: exp, mallId: midResolved }
  } finally {
    await browser.close().catch(() => {})
  }
}

async function getCtx() {
  const mms = loadMms()
  if (!mms) { emit({ ok: false, failureKind: 'not_bound', text: '未绑定拼多多商家后台账号（pdd_mms）' }); process.exit(2) }

  let tok = readToken()
  let refreshed = false
  if (!tok) {
    if (MODE === 'refresh-token') { /* 走下面刷新 */ }
    else if (DRY) { emit({ ok: false, failureKind: 'token_expired', text: 'ptj_token 已过期或不存在（dry-run 不自动刷新）' }); process.exit(3) }
    log('ptj_token 无效或已过期，自动开浏览器刷新（约 20s，24h 内只需一次）')
    try { tok = await refreshToken({ ...mms, mallId: UID_ARG }); refreshed = true }
    catch (e) { emit({ ok: false, failureKind: 'token_expired', text: '刷新 ptj_token 失败: ' + String(e.message || e).slice(0, 200) }); process.exit(3) }
  }

  // mallId 优先级：显式 --uid > token 里的 m > 缓存值
  const mallId = UID_ARG || mallIdFromToken(tok.token) || tok.mallId
  if (!mallId) { emit({ ok: false, failureKind: 'api_error', text: '缺少 mallId，请传 --uid' }); process.exit(4) }

  return { ...mms, token: tok.token, tokenExpiresAt: tok.expiresAt, mallId: String(mallId), refreshed }
}

// ══════════════════════════════════════════════════════════════════
// HTTP
// ══════════════════════════════════════════════════════════════════

const aidH = (ctx) => ({
  'content-type': 'application/json',
  'user-agent': ctx.ua,
  'origin': 'https://aid.pinduoduo.com',
  'referer': 'https://aid.pinduoduo.com/design/ai-generator?layout=drawer&source=mms&currentTab=Image2Video',
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9',
  'cookie': `ptj_token=${ctx.token}`,
})
const mmsH = (ctx, extra = {}) => ({
  'user-agent': ctx.ua,
  'origin': 'https://mms.pinduoduo.com',
  'referer': 'https://mms.pinduoduo.com/',
  'accept': 'application/json, text/plain, */*',
  'cookie': ctx.cookie,
  ...extra,
})

let _tokenExpired = false
async function api(ctx, ep, body) {
  const r = await fetch('https://aid.pinduoduo.com' + ep, { method: 'POST', headers: aidH(ctx), body: JSON.stringify(body) })
  const txt = await r.text()
  let j = null
  try { j = JSON.parse(txt) } catch { throw new Error(`HTTP ${r.status} 非 JSON: ${txt.slice(0, 120)}`) }
  if (j.errorCode === 40022 || j.errorCode === 43001) _tokenExpired = true
  return j
}

async function getQuota(ctx) {
  const j = await api(ctx, '/api/banner-intelligent/smartTool/video/available', { uid: Number(ctx.mallId) })
  return { remaining: j?.result?.remainingTimes ?? null, available: j?.result?.available ?? null }
}

// ══════════════════════════════════════════════════════════════════
// 图片预检（避免白扣额度）
// ══════════════════════════════════════════════════════════════════

/** 读 PNG/JPEG 尺寸（不依赖第三方库） */
function imageSize(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(64 * 1024)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    const b = buf.subarray(0, n)
    // PNG
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), fmt: 'png' }
    }
    // JPEG：扫 SOF
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2
      while (i < b.length - 9) {
        if (b[i] !== 0xff) { i++; continue }
        const marker = b[i + 1]
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7), fmt: 'jpeg' }
        }
        const len = b.readUInt16BE(i + 2)
        i += 2 + len
      }
    }
    // WebP
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      return { w: 0, h: 0, fmt: 'webp' }
    }
    return null
  } finally { fs.closeSync(fd) }
}

const OK_RATIOS = [
  { name: '1:1', v: 1 },
  { name: '3:4', v: 3 / 4 },
  { name: '4:3', v: 4 / 3 },
  { name: '16:9', v: 16 / 9 },
  { name: '9:16', v: 9 / 16 },
]
function checkRatio(w, h) {
  if (!w || !h) return { ok: false, reason: '尺寸未知' }
  const r = w / h
  for (const t of OK_RATIOS) if (Math.abs(r - t.v) < 0.02) return { ok: true, ratio: t.name }
  return { ok: false, reason: `比例 ${r.toFixed(3)}（${w}x${h}）不在 1:1/3:4/16:9 白名单` }
}

/** 逐项预检，返回 {ok, warnings, errors} */
function precheck(file) {
  const errors = []
  const warnings = []
  if (!fs.existsSync(file)) { errors.push('文件不存在'); return { ok: false, errors, warnings } }
  const st = fs.statSync(file)
  const ext = path.extname(file).toLowerCase()
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) errors.push(`格式 ${ext} 不支持（仅 png/jpg/jpeg）`)
  if (st.size > 3 * 1024 * 1024) errors.push(`大小 ${(st.size / 1048576).toFixed(2)}MB 超过 3MB`)
  if (st.size > 5 * 1024 * 1024) errors.push(`超过 store_image 单次 5MB 上限`)
  const sz = imageSize(file)
  if (sz && sz.w && sz.h) {
    if (sz.w < 480 || sz.h < 480) errors.push(`尺寸 ${sz.w}x${sz.h} 小于 480px`)
    const cr = checkRatio(sz.w, sz.h)
    if (!cr.ok) errors.push(cr.reason)
    else warnings.push(`比例 ${cr.ratio}`)
  } else if (sz?.fmt !== 'webp') {
    warnings.push('尺寸解析失败，未做规格校验（可能导致生成阶段 40000，额度不退）')
  }
  return { ok: errors.length === 0, errors, warnings, w: sz?.w, h: sz?.h, bytes: st.size }
}

// ══════════════════════════════════════════════════════════════════
// 阶段1：上传
// ══════════════════════════════════════════════════════════════════

async function uploadOne(ctx, file) {
  const st = fs.statSync(file)
  if (st.size > 5 * 1024 * 1024) throw new Error(`超过 5MB（${(st.size / 1048576).toFixed(1)}MB）`)

  const r1 = await fetch('https://mms.pinduoduo.com/galerie/business/get_signature', {
    method: 'POST',
    headers: mmsH(ctx, { 'content-type': 'application/json' }),
    body: JSON.stringify({ bucket_tag: 'mms-material-img' }),
  })
  const j1 = await r1.json().catch(() => ({}))
  const sig = j1?.result?.signature
  if (!sig) throw new Error('get_signature 失败: ' + JSON.stringify(j1).slice(0, 150))

  const ext = path.extname(file).toLowerCase()
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
  const fd = new FormData()
  fd.append('upload_sign', sig)
  fd.append('image', new Blob([fs.readFileSync(file)], { type: mime }), path.basename(file).toLowerCase())
  fd.append('forbid_override', 'false')

  const r2 = await fetch('https://file.pinduoduo.com/v3/store_image', { method: 'POST', headers: mmsH(ctx), body: fd })
  const j2 = await r2.json().catch(() => ({}))
  if (!j2?.url) throw new Error('store_image 失败: ' + JSON.stringify(j2).slice(0, 150))
  return { url: j2.url, width: j2.width, height: j2.height, size: j2.size }
}

function listFiles() {
  const out = []
  if (FILE_ARG) {
    for (const f of FILE_ARG.split(',').map((s) => s.trim()).filter(Boolean)) out.push(path.resolve(f))
  }
  if (DIR) {
    if (!fs.existsSync(DIR)) throw new Error('目录不存在: ' + DIR)
    for (const f of fs.readdirSync(DIR).sort()) {
      if (/\.(png|jpe?g)$/i.test(f)) out.push(path.join(path.resolve(DIR), f))
    }
  }
  return [...new Set(out)]
}

async function doUpload(ctx) {
  const files = listFiles()
  if (!files.length) { emit({ ok: false, failureKind: 'api_error', text: '没有可上传的图片（--dir 或 --file）' }); return }

  // ★ 预检全部，不合格的直接剔除，不浪费额度
  const items = []
  const rejected = []
  for (const f of files) {
    const pc = precheck(f)
    if (pc.ok) items.push({ file: f, name: path.basename(f), w: pc.w, h: pc.h, bytes: pc.bytes })
    else rejected.push({ file: f, name: path.basename(f), errors: pc.errors })
  }
  log(`预检：通过 ${items.length} / 共 ${files.length}，剔除 ${rejected.length}`)
  for (const r of rejected) log(`  ✗ ${r.name}: ${r.errors.join('；')}`)

  if (DRY) {
    emit({
      ok: true, mode: 'upload', dryRun: true, total: files.length, passed: items.length, rejected,
      text: `[演练] 预检通过 ${items.length}/${files.length}\n${rejected.map((r) => `✗ ${r.name}: ${r.errors.join('；')}`).join('\n')}`,
    })
    return
  }
  if (!items.length) {
    emit({ ok: false, failureKind: 'api_error', text: `全部 ${files.length} 张未通过预检`, rejected })
    return
  }

  const done = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    try {
      const up = await uploadOne(ctx, it.file)
      done.push({ ...it, imgUrl: up.url, uploadedW: up.width, uploadedH: up.height })
      log(`上传 ${i + 1}/${items.length} ${it.name} → ${up.url.slice(-38)}`)
    } catch (e) {
      rejected.push({ file: it.file, name: it.name, errors: ['上传失败: ' + String(e.message || e).slice(0, 120)] })
      log(`上传失败 ${it.name}: ${String(e.message || e).slice(0, 100)}`)
    }
    if (i < items.length - 1) await sleep(400)   // 温和间隔
  }

  const manifestPath = MANIFEST || path.join(OUTDIR, `manifest-${Date.now()}.json`)
  const manifest = {
    createdAt: new Date().toISOString(),
    shopKey: ctx.shopKey,
    mallId: ctx.mallId,
    total: files.length,
    uploaded: done.length,
    rejected: rejected.length,
    items: done,
    failed: rejected,
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  log(`manifest → ${manifestPath}`)

  emit({
    ok: done.length > 0,
    mode: 'upload',
    shopKey: ctx.shopKey,
    total: files.length,
    uploaded: done.length,
    rejected: rejected.length,
    manifestPath,
    items: done.map((d) => ({ name: d.name, imgUrl: d.imgUrl, w: d.w, h: d.h })),
    failed: rejected,
    text: [
      `图片上传完成：成功 ${done.length} / 共 ${files.length}`,
      rejected.length ? `剔除/失败 ${rejected.length} 张：` : '',
      ...rejected.map((r) => `  ✗ ${r.name}: ${r.errors.join('；')}`),
      ``,
      `manifest: ${manifestPath}`,
      `下一步：node gen-video.mjs --mode gen --manifest "${manifestPath}" --limit ${Math.min(done.length, LIMIT || done.length)}`,
    ].filter(Boolean).join('\n'),
  })
  return manifestPath
}

// ══════════════════════════════════════════════════════════════════
// 阶段2：生成
// ══════════════════════════════════════════════════════════════════

async function genOne(ctx, imgUrl) {
  const j = await api(ctx, '/api/banner-intelligent/smartTool/video/genVideo', {
    url: imgUrl, duration: 5, uid: Number(ctx.mallId), source: 'mms',
  })
  const uuid = j?.result?.uuid
  if (!uuid) throw new Error('未返回 uuid: ' + JSON.stringify(j).slice(0, 150))
  return uuid
}

async function pollOne(ctx, uuid, maxwait = MAXWAIT) {
  const t0 = Date.now()
  let polls = 0
  while (Date.now() - t0 < maxwait) {
    polls++
    await sleep(3000)
    const j = await api(ctx, '/api/banner-intelligent/smartTool/video/getResult', { uid: Number(ctx.mallId), uuid, source: 'mms' })
    const r = j?.result || {}
    // ★ 必须 uuid 严格匹配：传假 uuid 会返回 uuid:null + RUNNING
    if (r.uuid === uuid && r.videoUrl) return { ok: true, videoUrl: r.videoUrl, polls, ms: Date.now() - t0 }
    if (j?.errorCode === 40000) return { ok: false, failureKind: 'task_failed', polls, ms: Date.now() - t0, text: '后台生成失败（40000）：图片规格不符或并发冲突，额度已扣不退' }
  }
  return { ok: false, failureKind: 'timeout', polls, ms: Date.now() - t0, text: `等待 ${(maxwait / 1000) | 0}s 未出结果` }
}

async function download(ctx, videoUrl, outFile) {
  const r = await fetch(videoUrl, { headers: { 'user-agent': ctx.ua, referer: 'https://aid.pinduoduo.com/' } })
  if (!r.ok) throw new Error('下载 HTTP ' + r.status)
  const buf = Buffer.from(await r.arrayBuffer())
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, buf)
  return { file: outFile, bytes: buf.length }
}

function safeName(s) {
  return String(s).replace(/\.[^.]+$/, '').replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 28) || 'img'
}

// ══════════════════════════════════════════════════════════════════
// 阶段3：发布到多多视频（可选，--publish true）
//
// ★ 为什么必须走 CDP 点击而不是 HTTP：
//   /api/backbone/video/publish 是强校验接口，页面点「发布」时浏览器拦截器
//   会注入 anti-content（SDK 实时指纹），page.evaluate+fetch 走不到那条链路，
//   稳定返回 2000000「账号被系统判定不适合发布」。
//   实测：同一 vid / 同一 body / 同一 cookie，UI 点击成功、fetch 直调失败。
//
// ★ 商品绑定必须用 prePublish/add + specialType:2
//   goodsList:[{ goodsId:"字符串", specialType:2 }]
//   specialType=2 对应「商品ID」tab，用 1 或 null 会导致 goodsItemList 为空 → 发布被拒
// ══════════════════════════════════════════════════════════════════

const PUBLISH = process.argv.includes('--publish')
const PUBLISH_GOODS_ID = argOf('goods-id') || ''
const PUBLISH_DECL = Number(argOf('declaration') || 11)
const PUBLISH_TITLE_PREFIX = argOf('video-title') || ''

const DECL_TEXT_MAP = {
  11: '内容无需标注',
  1: '含AI生成内容',
  5: '含虚构演绎内容',
  7: '内容含营销信息',
  3: '内容为转载',
  8: '个人观点，仅供参考',
}

/** 把一条本地 mp4 发到多多视频（上传 → 绑商品 → 选声明 → 点击发布）
 *
 * ★ 2026-11-06 稳定性改造（实测把 65% 提升到高分）：
 *   ① 复用浏览器：整个批次只 launch 一次，每条复用一个 page（省 20 次启动，快一半）
 *   ② 等元素出现而不是等固定时间：
 *      - 上传入口：轮询 input[type=file]，最多 45s
 *      - 编辑页就绪：轮询「视频上传成功」+ 发布按钮，最多 60s
 *   ③ 失败自动重试：页面没就绪时 reload 再来，最多 2 轮
 */
async function publishOne(ctx, videoFile, idx, total, browser, isFirst, STEALTH_SCRIPT) {
  const title = PUBLISH_TITLE_PREFIX
    ? `${PUBLISH_TITLE_PREFIX}${total > 1 ? ' ' + idx : ''}`
    : path.basename(videoFile).replace(/\.mp4$/i, '')

  let page
  try {
    page = await browser.newPage()
    await page.evaluateOnNewDocument(STEALTH_SCRIPT)
    await page.setViewport({ width: 1600, height: 1200 })

    const ev = async (fn, ...a) => {
      for (let i = 0; i < 15; i++) {
        try { return await page.evaluate(fn, ...a) } catch (e) {
          if (/Execution context|detached|Target closed|Cannot find context/i.test(String(e))) { await sleep(2500); continue }
          throw e
        }
      }
      return null
    }

    /** 轮询等待条件成立 */
    const waitFor = async (fn, timeoutMs, intervalMs = 1500) => {
      const t0 = Date.now()
      while (Date.now() - t0 < timeoutMs) {
        const v = await ev(fn).catch(() => null)
        if (v) return v
        await sleep(intervalMs)
      }
      return null
    }

    /** 等待编辑页就绪（发布按钮出现 + 视频上传成功） */
    const waitEditReady = async (timeoutMs = 60000) => waitFor(() => {
      const hasBtn = [...document.querySelectorAll('button,div,span,a')].some((e) => {
        const t = (e.innerText || '').trim()
        if (t !== '发布' && t !== '一键发布') return false
        const r = e.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      })
      const hasOk = /视频上传成功/.test(document.body?.innerText || '')
      return hasBtn && hasOk
    }, timeoutMs)

    // 整个流程最多重试 2 轮（页面没就绪时 reload）
    let lastErr = null
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        // 进 live 域
        if (attempt === 1 && !isFirst) log('    （复用浏览器，新建标签页）')
        // ★ 关键：每个新 page 都要先访问 mms 建会话，否则直接跳 live 域会被 SSO 弹回登录页，
        //   表现为「找不到上传入口」（2026-11-07 实测：跳过这步 15/15 全失败）
        await page.goto('https://mms.pinduoduo.com/', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {})
        await sleep(attempt === 1 ? 5000 : 7000)
        await page.goto('https://live.pinduoduo.com/n-creator/video/home?from=mms', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {})
        await sleep(attempt === 1 ? 9000 : 12000)

        // 诊断：确认不是停在登录页
        const url = page.url()
        if (/login/i.test(url)) throw new Error('被弹回登录页（SSO 未打通）')

        // ① 等上传入口（★ 用 page.waitForSelector，不要用 evaluate 轮询：
        //    之前用 ev 轮询返回 Promise 导致判定恒真/恒假，15/15 全失败）
        let inputs = []
        try {
          await page.waitForSelector('input[type=file]', { timeout: 45000, visible: false })
          inputs = await page.$$('input[type=file]')
        } catch { /* 下面统一抛错 */ }
        if (!inputs.length) throw new Error('找不到上传入口')
        await inputs[0].uploadFile(videoFile)

        // ② 等编辑页就绪（上传完成 + 发布按钮出现）
        const ready = await waitEditReady(75000)
        if (!ready) throw new Error('编辑页未就绪（发布按钮/上传成功提示未出现）')

        // 关遮罩
        await ev(() => {
          const m = [...document.querySelectorAll('[class*=mask]')]
          m.forEach((x) => { if (x.style) x.style.display = 'none' })
          const c = [...document.querySelectorAll('[class*=close]')].filter((e) => e.offsetParent)
          c.slice(0, 3).forEach((e) => { try { e.click() } catch {} })
        })
        await sleep(1500)

        // ③ 描述
        const desc = argOf('video-desc') || '加厚双层中空设计，热饮不烫手，冷饮不冒汗'
        await ev((d) => {
          const ta = document.querySelector('textarea')
          if (ta) {
            Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, d)
            ta.dispatchEvent(new Event('input', { bubbles: true }))
            ta.dispatchEvent(new Event('change', { bubbles: true }))
          }
        }, desc)
        await sleep(1200)

        // ④ 绑商品
        if (PUBLISH_GOODS_ID) {
          await ev(() => {
            const c = [...document.querySelectorAll('*')].filter((e) => (e.innerText || '').trim() === '添加商品' && e.children.length <= 3)
            if (c.length) c[c.length - 1].click()
          })
          await sleep(5000)
          await ev(() => {
            const t = [...document.querySelectorAll('*')].filter((e) => (e.innerText || '').trim() === '商品ID' && e.children.length <= 2)
            if (t.length) t[0].click()
          })
          await sleep(2000)
          await ev((g) => {
            const ins = [...document.querySelectorAll('input')].filter((i) => i.offsetParent && !i.readOnly)
            const t = ins.find((i) => /商品|ID|请输入/i.test(i.placeholder || '')) || ins[0]
            if (t) {
              Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(t, String(g))
              t.dispatchEvent(new Event('input', { bubbles: true }))
              t.dispatchEvent(new Event('change', { bubbles: true }))
            }
          }, PUBLISH_GOODS_ID)
          await sleep(1800)
          await ev(() => {
            const b = [...document.querySelectorAll('button,span,div')].filter((e) => /^(查询|搜索)$/.test((e.innerText || '').trim()) && !e.children.length)
            if (b.length) b[0].click()
          })
          await sleep(4000)
          await ev(() => {
            const r = [...document.querySelectorAll('input[type=radio]')].filter((x) => x.offsetParent)
            if (r.length) r[0].click()
          })
          await sleep(1200)
          await ev(() => {
            const b = [...document.querySelectorAll('button,span,div')].filter((e) => (e.innerText || '').trim() === '下一步' && !e.children.length)
            if (b.length) b[0].click()
          })
          await sleep(5000)
        }

        // ⑤ 内容声明（★ 选完必须校验，否则发布按钮点不动）
        let declOk = false
        for (let tryN = 0; tryN < 3 && !declOk; tryN++) {
          const declPos = await ev(() => {
            const ph = [...document.querySelectorAll('input')].find((i) => /请选择/.test(i.placeholder || '') && i.offsetParent)
            if (!ph) return null
            ph.scrollIntoView({ block: 'center' })
            const r = ph.getBoundingClientRect()
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
          })
          if (!declPos) { await sleep(1500); continue }

          await page.mouse.click(declPos.x, declPos.y)
          await sleep(2500)

          const txt = DECL_TEXT_MAP[PUBLISH_DECL] || '内容无需标注'
          const picked = await ev((t) => {
            const c = [...document.querySelectorAll('div,li,span')].filter((e) => {
              const s = (e.innerText || '').trim()
              const r = e.getBoundingClientRect()
              return s.startsWith(t) && r.width > 100
            })
            if (!c.length) return null
            const el = c[c.length - 1]
            const o = { bubbles: true, cancelable: true, view: window }
            el.dispatchEvent(new MouseEvent('mousedown', o))
            el.dispatchEvent(new MouseEvent('mouseup', o))
            el.dispatchEvent(new MouseEvent('click', o))
            return (el.innerText || '').trim()
          }, txt)
          await sleep(2200)

          // 校验：input 的 value 或容器文字里出现选项文案
          declOk = await ev((t) => {
            const ro = [...document.querySelectorAll('input[readonly],input')]
              .filter((i) => i.offsetParent)
              .some((i) => (i.value || '').includes(t))
            if (ro) return true
            const all = [...document.querySelectorAll('*')]
            const lab = all.find((e) => (e.innerText || '').trim() === '内容声明')
            if (lab) {
              let p = lab.parentElement
              for (let k = 0; k < 5 && p; k++) {
                if ((p.innerText || '').includes(t)) return true
                p = p.parentElement
              }
            }
            return false
          }, txt)
          log(declOk ? `    内容声明已选：${picked || txt}` : `    内容声明第 ${tryN + 1} 次未选中，重试…`)
        }
        if (!declOk) throw new Error('内容声明未能选中')

        // ⑥ 点发布
        let pubResp = null
        const onResp = async (res) => {
          if (/backbone\/video\/publish$/.test(res.url())) {
            try { pubResp = await res.json() } catch {}
          }
        }
        page.on('response', onResp)

        const pubPos = await ev(() => {
          const cands = [...document.querySelectorAll('button,div,span,a')].filter((e) => {
            const t = (e.innerText || '').trim()
            if (t !== '发布' && t !== '一键发布') return false
            const r = e.getBoundingClientRect()
            if (r.width <= 0 || r.height <= 0) return false
            const st = getComputedStyle(e)
            return st.display !== 'none' && st.visibility !== 'hidden'
          })
          if (!cands.length) return null
          const ones = cands.filter((e) => (e.innerText || '').trim() === '一键发布')
          const pool = ones.length ? ones : cands
          pool.sort((a, b) => b.getBoundingClientRect().y - a.getBoundingClientRect().y)
          const el = pool[0]
          el.scrollIntoView({ block: 'center' })
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })
        if (!pubPos) throw new Error('找不到发布按钮')

        await page.mouse.click(pubPos.x, pubPos.y)
        for (let i = 0; i < 60 && !pubResp; i++) await sleep(1000)
        page.off('response', onResp)

        const feedIds = pubResp?.result?.feedIds || []
        if (pubResp?.success && feedIds.length) {
          return { ok: true, title, feedId: feedIds[0], feedIds, attempt }
        }
        // 有明确响应但失败 → 不重试（是业务错误）
        if (pubResp) {
          return {
            ok: false, title, attempt,
            failureKind: pubResp?.errorCode === 2000000 ? 'no_permission' : 'api_error',
            code: pubResp?.errorCode,
            text: pubResp?.errorMsg || '(无响应)',
          }
        }
        throw new Error('发布无响应')
      } catch (e) {
        lastErr = String(e.message || e).slice(0, 160)
        log(`    第 ${attempt} 轮失败：${lastErr}`)
        if (attempt < 2) {
          log('    刷新页面重试…')
          await page.goto('about:blank', { timeout: 20000 }).catch(() => {})
          await sleep(3000)
        }
      }
    }

    return { ok: false, title, failureKind: 'api_error', text: lastErr || '重试后仍失败' }
  } finally {
    await page?.close().catch(() => {})
  }
}


async function doGen(ctx, items, runTag) {
  let list = items.filter((x) => x.imgUrl)
  if (LIMIT > 0) list = list.slice(0, LIMIT)
  if (!list.length) { emit({ ok: false, failureKind: 'api_error', text: 'manifest 里没有可用条目' }); return }

  // 额度预检：不够就别开跑（失败不退，宁可提前停）
  const q = await getQuota(ctx)
  log(`剩余额度 ${q.remaining}，计划生成 ${list.length} 个`)
  if (q.remaining != null && q.remaining < list.length) {
    log(`⚠ 额度不足：剩 ${q.remaining}，计划 ${list.length}。将只跑 ${q.remaining} 个`)
    list = list.slice(0, q.remaining)
  }

  const started = Date.now()
  const results = []
  let stopReason = null

  for (let i = 0; i < list.length; i += CONC) {
    if (_tokenExpired) { stopReason = 'token 失效，已中止（已完成的已保存）'; break }
    const batch = list.slice(i, i + CONC)
    log(`批次 ${Math.floor(i / CONC) + 1}/${Math.ceil(list.length / CONC)}（${batch.length} 个）`)

    const gens = []
    for (let k = 0; k < batch.length; k++) {
      if (k > 0) await sleep(GAP)          // ★ 错峰，避免互相踢槽
      try {
        const uuid = await genOne(ctx, batch[k].imgUrl)
        gens.push({ ...batch[k], uuid })
        log(`  gen ${batch[k].name} uuid=${uuid}`)
      } catch (e) {
        results.push({ name: batch[k].name, imgUrl: batch[k].imgUrl, ok: false, failureKind: 'gen_failed', text: String(e.message || e).slice(0, 180) })
        log(`  gen 失败 ${batch[k].name}`)
        if (_tokenExpired) { stopReason = 'token 失效'; break }
      }
    }
    if (stopReason) break

    const polls = await Promise.all(gens.map((g) => pollOne(ctx, g.uuid).catch((e) => ({ ok: false, failureKind: 'poll_error', text: String(e.message || e).slice(0, 150) }))))
    for (let k = 0; k < gens.length; k++) {
      const g = gens[k], p = polls[k]
      if (!p.ok) {
        results.push({ name: g.name, imgUrl: g.imgUrl, uuid: g.uuid, ok: false, ...p })
        log(`  ✗ ${g.name} ${p.text || p.failureKind}`)
        continue
      }
      try {
        const dl = await download(ctx, p.videoUrl, path.join(OUTDIR, `${runTag}-${safeName(g.name)}-${g.uuid.slice(0, 8)}.mp4`))
        results.push({ name: g.name, imgUrl: g.imgUrl, uuid: g.uuid, ok: true, videoUrl: p.videoUrl, outFile: dl.file, bytes: dl.bytes, polls: p.polls, seconds: +(p.ms / 1000).toFixed(1) })
        log(`  ✅ ${g.name} ${(dl.bytes / 1024).toFixed(0)}KB (${(p.ms / 1000).toFixed(0)}s)`)
      } catch (e) {
        results.push({ name: g.name, imgUrl: g.imgUrl, uuid: g.uuid, ok: true, videoUrl: p.videoUrl, downloadError: String(e.message || e).slice(0, 150) })
        log(`  ⚠ ${g.name} 生成成功但下载失败`)
      }
    }
  }

  const qEnd = await getQuota(ctx).catch(() => ({ remaining: null }))
  let okN = results.filter((r) => r.ok).length

  // ══════ 可选：发布到多多视频 ══════
  const publishResults = []
  if (PUBLISH) {
    const ready = results.filter((r) => r.ok && r.outFile)
    if (!ready.length) {
      log('⚠ --publish 已开启，但没有可发布的视频（全部生成失败）')
    } else {
      if (!PUBLISH_GOODS_ID) {
        log('⚠ --publish 已开启但未传 --goods-id，发布将不带商品（可能被拒）')
      }
      log(`\n开始发布 ${ready.length} 条到多多视频（CDP 点击，串行）…`)
      let puppeteer, launchOptions, STEALTH_SCRIPT
      try {
        const { createRequire: cr } = await import('node:module')
        const req2 = cr(PKG_BASE)
        puppeteer = req2('puppeteer-core')
        const mod = await import('file://' + path.join(PLUGIN_ROOT, 'skills/_shared/pdd-launch.mjs').replace(/\\/g, '/'))
        launchOptions = mod.launchOptions
        STEALTH_SCRIPT = mod.STEALTH_SCRIPT
      } catch (e) {
        log('⚠ 无法加载 puppeteer，跳过发布：' + String(e.message || e).slice(0, 120))
      }

      if (puppeteer) {
        // ★★ 2026-11-07 架构调整：**复用 pdd-video 的发布实现**，不再在 aid 里重写一套
        //
        //   原因：pdd-video 的 upload+publish 链路已经过 20+ 条实战验证（含内容声明、
        //   商品绑定 specialType:2、CDP 点击发布），自己重写一版反而引入 SSO/声明选中/
        //   页面就绪等一堆时序 bug（实测 0/15、0/2 全失败，而 pdd-video 单次成功率 ~65% 且
        //   补发后 100%）。
        //
        //   做法：直接以子进程调用 pdd-video 的 video.mjs --mode upload --publish true
        const { execFileSync } = await import('node:child_process')
        const PDD_VIDEO_SCRIPT = path.resolve(PLUGIN_ROOT, 'skills/pdd-video/scripts/video.mjs')
        const hasPddVideo = fs.existsSync(PDD_VIDEO_SCRIPT)

        if (!hasPddVideo) {
          log('⚠ 未找到 pdd-video 技能，跳过发布')
        } else {
          for (let i = 0; i < ready.length; i++) {
            const r = ready[i]
            const idx = i + 1
            log(`  [${idx}/${ready.length}] 发布 ${path.basename(r.outFile)}…`)
            try {
              const title = PUBLISH_TITLE_PREFIX
                ? `${PUBLISH_TITLE_PREFIX}${ready.length > 1 ? ' ' + idx : ''}`
                : path.basename(r.outFile).replace(/\.mp4$/i, '')
              const args = [
                PDD_VIDEO_SCRIPT,
                '--mode', 'upload',
                '--file', r.outFile,
                '--title', title,
                '--desc', argOf('video-desc') || '加厚双层中空设计，热饮不烫手，冷饮不冒汗',
                '--account', ctx.shopKey,
                '--confirm', 'true',
                '--publish', 'true',
                '--declaration', String(PUBLISH_DECL),
              ]
              if (PUBLISH_GOODS_ID) args.push('--goods-id', String(PUBLISH_GOODS_ID))

              // ★ execFileSync 在子进程非 0 退出时会抛异常，但真正的结果在 stdout 的
              //   __DSAGENT_RESULT__ 里。用 spawnSync 拿 stdout，不因退出码丢结果。
              const { spawnSync } = await import('node:child_process')
              const rr = spawnSync('node', args, { encoding: 'utf8', timeout: 420000, maxBuffer: 32 * 1024 * 1024 })
              const outStr = (rr.stdout || '') + (rr.stderr || '')
              const mm = outStr.match(/__DSAGENT_RESULT__(.+)/)
              const pv = mm ? JSON.parse(mm[1]) : null
              const feedIds = pv?.feedIds || []
              const ok = !!pv?.ok && feedIds.length > 0
              publishResults.push({ name: r.name, outFile: r.outFile, ok, title, feedId: feedIds[0] || null, feedIds, code: pv?.publishCode || null, text: ok ? null : (pv?.publishMsg || pv?.failureKind || `exit=${rr.status}`) })
              r.publish = { ok, feedId: feedIds[0] || null, code: pv?.publishCode || null, text: ok ? null : (pv?.publishMsg || '') }
              log(ok ? `    ✅ feedId=${feedIds[0]}` : `    ❌ ${pv?.publishCode || pv?.failureKind || 'exit=' + rr.status} ${pv?.publishMsg || ''}`)
            } catch (e) {
              const msg = String(e.message || e).slice(0, 180)
              publishResults.push({ name: r.name, outFile: r.outFile, ok: false, failureKind: 'exception', text: msg })
              r.publish = { ok: false, text: msg }
              log(`    ❌ 异常 ${msg.slice(0, 120)}`)
            }
            if (i < ready.length - 1) await sleep(4000)
          }
        }
        // 兼容下面的 finally 结构
        var browser = null
      }
    }
  }

  const pubOk = publishResults.filter((p) => p.ok).length
  const used = q.remaining != null && qEnd.remaining != null ? q.remaining - qEnd.remaining : null
  const lines = results.map((r) => {
    const pubTag = r.publish ? (r.publish.ok ? ` → 已发布 ${r.publish.feedId}` : ` → 发布失败 ${r.publish.code || ''}`) : ''
    return `${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? `  ${(r.bytes / 1024).toFixed(0)}KB ${r.seconds}s` : `  ${r.text || r.failureKind}`}${pubTag}`
  })

  emit({
    ok: okN > 0 && okN === results.length && (!PUBLISH || pubOk === publishResults.length),
    mode: 'gen',
    shopKey: ctx.shopKey,
    total: results.length,
    success: okN,
    failed: results.length - okN,
    quotaBefore: q.remaining,
    quotaAfter: qEnd.remaining,
    quotaUsed: used,
    elapsedSec: +((Date.now() - started) / 1000).toFixed(0),
    outDir: OUTDIR,
    stopReason,
    publishEnabled: PUBLISH,
    publishTotal: publishResults.length,
    publishSuccess: pubOk,
    publishResults,
    results,
    text: [
      `图生视频：成功 ${okN}/${results.length}｜额度 ${q.remaining}→${qEnd.remaining}（扣 ${used ?? '?'}，失败不退）｜耗时 ${((Date.now() - started) / 1000).toFixed(0)}s`,
      PUBLISH ? `发布多多视频：成功 ${pubOk}/${publishResults.length}${PUBLISH_GOODS_ID ? `｜商品 ${PUBLISH_GOODS_ID}` : ''}` : '',
      stopReason ? `⚠ 中止原因：${stopReason}` : '',
      `输出目录：${OUTDIR}`,
      '',
      ...lines,
    ].filter(Boolean).join('\n'),
  })
}

// ══════════════════════════════════════════════════════════════════
// main
// ══════════════════════════════════════════════════════════════════

;(async () => {
  const ctx = await getCtx()
  log(`账号 ${ctx.label}｜mallId ${ctx.mallId}｜token 至 ${new Date(ctx.tokenExpiresAt).toLocaleString('zh-CN')}${ctx.refreshed ? '（刚刷新）' : ''}`)

  if (MODE === 'quota') {
    const q = await getQuota(ctx)
    emit({ ok: true, mode: 'quota', shopKey: ctx.shopKey, mallId: ctx.mallId, remaining: q.remaining, total: 100, text: `今日剩余 ${q.remaining} / 100 个视频` })
    return
  }

  if (MODE === 'status') {
    const j = await api(ctx, '/api/banner-intelligent/smartTool/video/get/status', { uid: Number(ctx.mallId) })
    const r = j?.result || {}
    emit({
      ok: true, mode: 'status', enum: r.smartToolStatusEnum, currentUuid: r.smartToolVideoRequest?.uuid || null,
      raw: r,
      text: `当前状态 ${r.smartToolStatusEnum || '(空闲)'}${r.smartToolVideoRequest?.uuid ? `｜进行中 ${r.smartToolVideoRequest.uuid}` : ''}\n注意：get/status 只跟踪最后提交的一个任务，多任务请用 --mode gen 的逐条轮询`,
    })
    return
  }

  if (MODE === 'refresh-token') {
    const t = await refreshToken({ ...ctx, mallId: ctx.mallId })
    emit({ ok: true, mode: 'refresh-token', mallId: t.mallId, expiresAt: new Date(t.expiresAt).toLocaleString('zh-CN'), text: `ptj_token 已刷新，有效至 ${new Date(t.expiresAt).toLocaleString('zh-CN')}\nmallId=${t.mallId}` })
    return
  }

  if (MODE === 'upload') { await doUpload(ctx); return }

  if (MODE === 'gen') {
    let items = []
    if (MANIFEST) {
      if (!fs.existsSync(MANIFEST)) { emit({ ok: false, failureKind: 'api_error', text: 'manifest 不存在: ' + MANIFEST }); return }
      const mf = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
      items = (mf.items || []).map((x) => ({ name: x.name || safeName(x.file), imgUrl: x.imgUrl, w: x.w, h: x.h }))
      log(`读 manifest: ${MANIFEST}，${items.length} 条`)
    } else if (FILE_ARG) {
      items = FILE_ARG.split(',').map((s) => s.trim()).filter(Boolean).map((u) => ({ name: 'url', imgUrl: u }))
    } else { emit({ ok: false, failureKind: 'api_error', text: 'gen 需要 --manifest <路径> 或 --file <imgUrl,...>' }); return }
    await doGen(ctx, items, 'gen')
    return
  }

  if (MODE === 'run') {
    // 一条龙：上传 → 生成
    const files = listFiles()
    if (!files.length) { emit({ ok: false, failureKind: 'api_error', text: 'run 需要 --dir 或 --file' }); return }
    log(`run：共 ${files.length} 张，两阶段执行（先全部上传，再统一生成）`)
    const mfPath = await doUpload(ctx)
    if (!mfPath) return
    const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'))
    const items = (mf.items || []).map((x) => ({ name: x.name, imgUrl: x.imgUrl, w: x.w, h: x.h }))
    await doGen(ctx, items, 'run')
    return
  }

  emit({ ok: false, failureKind: 'api_error', text: `未知 mode: ${MODE}（upload / gen / run / quota / status / refresh-token）` })
})().catch((e) => {
  emit({ ok: false, failureKind: 'exception', text: 'pdd-ai-video 异常: ' + String(e && e.message || e).slice(0, 400) })
  process.exit(1)
})
