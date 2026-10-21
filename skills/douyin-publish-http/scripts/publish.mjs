#!/usr/bin/env node
/**
 * 抖音内容发布（HTTP 直连版）— DSAgent douyin-publish-http v1.0
 *
 * 与 douyin-publish（DOM 路线）的区别：上传三步（VOD/ImageX + TOS）完全在
 * Node 侧原生 fetch 完成，不起 DOM 输入、不等转码跳转。只有首尾两步
 * （auth/v5、create_v2）借用浏览器里已 patch 的 fetch 补 a_bogus。
 *
 * ## L2 门禁
 *
 *     node publish.mjs --videoPath "D:/v/1.mp4" --title "标题"                  # 只出预览
 *     node publish.mjs --videoPath "D:/v/1.mp4" --title "标题" --confirm true   # 真正发布
 *
 * 不带 --confirm true 不启动浏览器、不产生任何写操作。
 *
 * ## 链路（全部实测抓包）
 *
 *   ① GET  creator.douyin.com/web/api/media/upload/auth/v5/   → STS（借浏览器）
 *   ② GET  vod|imagex.bytedanceapi.com  Action=Apply*Upload   → SessionKey（SigV4）
 *   ③ POST tos-*.douyin.com/upload/v1/<StoreUri>              → 文件直传（JWT+CRC32）
 *   ④ POST vod|imagex.bytedanceapi.com  Action=Commit*Upload  → video_id/image_uri
 *   ⑤ POST creator.douyin.com/web/api/media/aweme/create_v2/  → 发布（借浏览器）
 */

import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createHash, createHmac } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// {baseDir} = 技能目录，插件根在它上三级
const PLUGIN_ROOT = process.env.DSAGENT_PLUGIN_ROOT
  || join(HERE, '..', '..', '..')
// Windows 下绝对路径必须转 file:// URL 才能被 ESM loader 接受
const PURL = (p) => pathToFileURL(p).href

// ── 常量（抓包实测）────────────────────────────────────
const BASE_QS = 'cookie_enabled=true&screen_width=1920&screen_height=1080'
  + '&browser_language=zh-CN&browser_platform=Win32&browser_name=Mozilla'
  + '&browser_version=5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F155.0.0.0%20Safari%2F537.36'
  + '&browser_online=true&timezone_name=Etc%2FGMT-8&aid=1128&support_h265=1'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'
const APP_ID = '1128'
const VOD_HOST = 'https://vod.bytedanceapi.com'
const IMAGEX_HOST = 'https://imagex.bytedanceapi.com'
const VOD_REGION = 'cn-north-1'
const SERVICE_ID = 'jm8ajry58r'   // ImageX 的 ServiceId

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

const CONFIRM = truthy(ARGS.confirm)
const ACCOUNT = (ARGS.account || '').trim()
const TITLE = (ARGS.title || '').trim()
const DESC = (ARGS.description || '').trim()
const VIDEO = (ARGS.videoPath || ARGS.video || '').trim()
const IMAGES = (ARGS.images || ARGS.imagePaths || '')
  .split(',').map(s => s.trim()).filter(Boolean)

const OUT_DIR = join(HERE, '..', 'artifacts')
mkdirSync(OUT_DIR, { recursive: true })

// ── 输出协议 ────────────────────────────────────────────
// 必须是**单行** JSON：宿主按行读取 __DSAGENT_RESULT__ 协议，
// 带缩进（null, 2）会输出多行，宿主只拿到第一行 → 解析成 {"raw": "{"}。
function emit(payload) {
  console.log('__DSAGENT_RESULT__' + JSON.stringify(payload))
}
const fail = (kind, message, extra = {}) => {
  emit({ ok: false, failure_kind: kind, message, ...extra })
  process.exit(1)
}
const log = (msg) => console.error('[douyin-publish-http] ' + msg)

// ── 入参校验 ────────────────────────────────────────────
const hasVideo = !!VIDEO
const hasImages = IMAGES.length > 0
if (hasVideo && hasImages) fail('api_error', 'videoPath 与 images 只能二选一（视频投稿 or 图文投稿）')
if (!hasVideo && !hasImages) fail('api_error', '必须提供 videoPath（视频）或 images（图文，英文逗号分隔多张）')

const files = hasVideo ? [VIDEO] : IMAGES
for (const f of files) {
  if (!existsSync(f)) fail('api_error', `文件不存在：${f}`)
}
if (!TITLE) fail('api_error', '缺少 title（抖音要求标题非空）')
if (TITLE.length > 30) fail('api_error', `标题 ${TITLE.length} 字，超过抖音上限 30 字`)
if (DESC.length > 1000) fail('api_error', `描述 ${DESC.length} 字，超过上限 1000 字`)

const bufs = files.map(f => readFileSync(f))
const isVideo = hasVideo

// ── 工具 ────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return ((c ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0')
}

function sigV4({ method, url, query, body, ak, sk, token, region, service }) {
  const u = new URL(url)
  const pairs = []
  for (const [k, v] of Object.entries(query)) pairs.push([encodeURIComponent(k), encodeURIComponent(v)])
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const cq = pairs.map(([k, v]) => `${k}=${v}`).join('&')

  const now = new Date()
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  const amzDate = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  const dateStamp = amzDate.slice(0, 8)

  const bodyBuf = body ? (Buffer.isBuffer(body) ? body : Buffer.from(body)) : Buffer.alloc(0)
  const payloadHash = createHash('sha256').update(bodyBuf).digest('hex')

  const headers = { 'x-amz-date': amzDate, 'x-amz-security-token': token }
  if (method === 'POST') headers['x-amz-content-sha256'] = payloadHash
  const signedHeaders = Object.keys(headers).sort().join(';')
  const canonicalHeaders = Object.keys(headers).sort().map(k => `${k}:${headers[k]}\n`).join('')

  const cr = [method, u.pathname, cq, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${dateStamp}/${region}/${service}/aws4_request`
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope,
    createHash('sha256').update(cr).digest('hex')].join('\n')

  const hmac = (k, m) => createHmac('sha256', k).update(m).digest()
  const kSign = hmac(hmac(hmac(hmac(`AWS4${sk}`, dateStamp), region), service), 'aws4_request')
  const signature = createHmac('sha256', kSign).update(sts).digest('hex')

  return {
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    finalUrl: `${url}?${cq}`,
  }
}

function imageSize(buf) {
  // JPEG
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let o = 2
    while (o < buf.length) {
      if (buf[o] !== 0xFF) { o++; continue }
      const m = buf[o + 1]
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        return { width: buf.readUInt16BE(o + 7), height: buf.readUInt16BE(o + 5) }
      }
      o += 2 + buf.readUInt16BE(o + 2)
    }
  }
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  return { width: 1080, height: 1440 }
}

const rand = (n) => Array.from({ length: n },
  () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')

// ── 预览（不带 confirm 时到这里就返回）───────────────────
const preview = {
  ok: false,
  needConfirm: true,
  failure_kind: 'need_confirm',
  message: [
    '【发布预览 · 需用户确认】',
    `类型：${isVideo ? '视频' : `图文（${bufs.length} 张）`}`,
    `账号：${ACCOUNT || '(会话默认)'}`,
    isVideo ? `视频：${VIDEO}` : `图片：${IMAGES.join(' , ')}`,
    `标题：${TITLE}`,
    `描述：${DESC ? DESC.slice(0, 200) + (DESC.length > 200 ? '…' : '') : '(空)'}`,
    '',
    '确认无误后请带 --confirm true 重新调用。发布是不可撤销的真实操作（L2）。',
  ].join('\n'),
  videoPath: VIDEO || undefined,
  images: isVideo ? undefined : IMAGES,
  title: TITLE,
  description: DESC,
}
if (!CONFIRM) { emit(preview); process.exit(0) }

// ── 起浏览器（只为 ①⑤ 的签名 fetch）──────────────────────
let CredentialStore
let profileDir, findChromePath, tryAcquireProfile, releaseProfile, clearProfileLocks, sleep
try {
  ;({ CredentialStore } = await import(PURL(join(PLUGIN_ROOT, 'lib', 'services', 'credential-store.js'))))
  ;({ profileDir, findChromePath, tryAcquireProfile, releaseProfile, clearProfileLocks, sleep } =
    await import(PURL(join(PLUGIN_ROOT, 'lib', 'browser-login.js'))))
} catch (e) {
  fail('api_error', `无法加载插件库（${PLUGIN_ROOT}）：${e.message}。请确认技能安装在 DSAgent-Plugin/skills 下。`)
}

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const accounts = store.listAccounts().filter(a => a.platform === 'douyin' && a.status !== 'invalid')
if (!accounts.length) {
  fail('not_bound', '未找到抖音账号。请到「账号连接」页面添加抖音账号（扫码登录）后再发布。')
}
let account
if (ACCOUNT) {
  account = accounts.find(a => a.shop_key === ACCOUNT)
  if (!account) fail('api_error', `指定的账号 shopKey 不存在：${ACCOUNT}。可用：${accounts.map(a => a.shop_key).join(' / ')}`)
} else if (accounts.length === 1) {
  account = accounts[0]
} else {
  fail('need_account_choice',
    `抖音平台有 ${accounts.length} 个可用账号，请指定 --account：\n`
    + accounts.map((a, i) => `${i + 1}. ${a.nickname}（${a.shop_key}）`).join('\n'),
    { accounts: accounts.map(a => ({ shop_key: a.shop_key, nickname: a.nickname })) })
}

const dir = profileDir('douyin', account.shop_key)
if (!tryAcquireProfile(dir, 'douyin-publish-http')) {
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
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1200,800'],
  })
  const page = await browser.newPage()

  // 注入凭证库 Cookie（登录态失效时靠这个 + Profile 双保险）
  const cookieList = Object.entries(account.cookies || {})
    .filter(([, v]) => v !== '' && v != null)
    .map(([name, value]) => ({ name, value: String(value), domain: '.douyin.com', path: '/' }))
  if (cookieList.length) await page.setCookie(...cookieList)

  log('加载创作者平台（等 secsdk 装签名，11s）...')
  await page.goto('https://creator.douyin.com/creator-micro/content/upload',
    { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(11000)
  await page.evaluate(() => { window.__sf = window.fetch.bind(window) })

  const sf = (path, opts = {}) => page.evaluate(async ({ path, opts }) => {
    const r = await window.__sf(path, opts)
    const t = await r.text()
    let j = null
    try { j = JSON.parse(t) } catch { /* ignore */ }
    return { status: r.status, json: j, text: j ? null : t.slice(0, 800) }
  }, { path, opts })

  // ── 登录态预检 ───────────────────────────────────────
  const pre = await sf('/aweme/v1/creator/item/list/?cursor=0&count=1&aid=1128')
  if (pre.json?.status_code === 8) {
    fail('token_expired', '抖音登录态已失效（status_code=8）。请到「账号连接」页面对该抖音账号重新登录后重试。')
  }
  const uid = await page.evaluate(() => {
    const m = document.cookie.match(/(?:^|;\s*)uid_tt=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : ''
  }) || '84915906365'
  log(`uid = ${uid}`)

  // ═══════════ ① auth/v5 拿 STS ═══════════
  log('[1/5] 取上传凭证 (auth/v5)...')
  const authRes = await sf(`/web/api/media/upload/auth/v5/?${BASE_QS}`)
  const sts = typeof authRes.json?.auth === 'string' ? JSON.parse(authRes.json.auth) : authRes.json?.auth
  if (!sts?.AccessKeyID) {
    fail('api_error', 'auth/v5 未返回有效凭证：' + JSON.stringify(authRes).slice(0, 400))
  }
  const AK = sts.AccessKeyID, SK = sts.SecretAccessKey, TOKEN = sts.SessionToken

  // ═══════════ ②③④ 每个文件：Apply → 直传 → Commit ═══════════
  const mediaIds = []

  for (let i = 0; i < bufs.length; i++) {
    const buf = bufs[i]
    const fname = files[i].split(/[\\/]/).pop()
    const label = bufs.length > 1 ? ` (${i + 1}/${bufs.length})` : ''

    // ② 申请上传
    log(`[2/5] 申请上传${label}...`)
    let uploadAddr, sessionKey, storeUri
    if (isVideo) {
      const q = {
        Action: 'ApplyUploadInner', Version: '2020-11-19',
        SpaceName: 'aweme', FileType: 'video', IsInner: '1',
        FileSize: String(buf.length), app_id: APP_ID, user_id: uid, s: rand(10),
      }
      const sig = sigV4({ method: 'GET', url: VOD_HOST, query: q, body: null, ak: AK, sk: SK, token: TOKEN, region: VOD_REGION, service: 'vod' })
      const res = await fetch(sig.finalUrl, { method: 'GET', headers: { 'User-Agent': UA, Referer: 'https://creator.douyin.com/', ...sig.headers } })
      const j = await res.json()
      const node = j?.Result?.InnerUploadAddress?.UploadNodes?.[0]
      uploadAddr = node
      sessionKey = node?.SessionKey
      storeUri = node?.StoreInfos?.[0]?.StoreUri
    } else {
      const q = { Action: 'ApplyImageUpload', Version: '2018-08-01', ServiceId: SERVICE_ID, app_id: APP_ID, s: rand(10) }
      const sig = sigV4({ method: 'GET', url: IMAGEX_HOST, query: q, body: null, ak: AK, sk: SK, token: TOKEN, region: VOD_REGION, service: 'imagex' })
      const res = await fetch(sig.finalUrl, { method: 'GET', headers: { 'User-Agent': UA, Referer: 'https://creator.douyin.com/', ...sig.headers } })
      const j = await res.json()
      uploadAddr = j?.Result?.UploadAddress
      sessionKey = uploadAddr?.SessionKey
      storeUri = uploadAddr?.StoreInfos?.[0]?.StoreUri
    }
    if (!sessionKey || !storeUri) {
      fail('api_error', `申请上传失败${label}：` + JSON.stringify(j ?? {}).slice(0, 500))
    }
    const skObj = JSON.parse(Buffer.from(sessionKey, 'base64').toString('utf8'))
    const host = skObj.uploadHost || (isVideo ? 'tos-d-x-hl.douyin.com' : 'tos-d-ct-hl.snssdk.com')

    // ③ 直传
    log(`[3/5] 文件直传 TOS${label} → ${host}`)
    const tosAuth = isVideo ? uploadAddr.StoreInfos[0].Auth : uploadAddr.StoreInfos[0].Auth
    const tosRes = await fetch(`https://${host}/upload/v1/${storeUri}`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Referer': 'https://creator.douyin.com/',
        'Authorization': tosAuth,
        'Content-CRC32': crc32(buf),
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fname}"`,
      },
      body: buf,
    })
    const tosText = await tosRes.text()
    if (tosRes.status !== 200 && tosRes.status !== 204) {
      fail('api_error', `TOS 直传失败${label}：HTTP ${tosRes.status} ${tosText.slice(0, 300)}`)
    }

    // ④ 提交
    log(`[4/5] 提交上传${label}...`)
    const cBody = JSON.stringify({ SessionKey: sessionKey })
    let mediaId
    if (isVideo) {
      const q = { Action: 'CommitUploadInner', Version: '2020-11-19', SpaceName: 'aweme', app_id: APP_ID, user_id: uid }
      const sig = sigV4({ method: 'POST', url: VOD_HOST, query: q, body: cBody, ak: AK, sk: SK, token: TOKEN, region: VOD_REGION, service: 'vod' })
      const res = await fetch(sig.finalUrl, {
        method: 'POST',
        headers: { 'User-Agent': UA, Referer: 'https://creator.douyin.com/', 'Content-Type': 'text/plain;charset=UTF-8', ...sig.headers },
        body: cBody,
      })
      const j = await res.json()
      mediaId = j?.Result?.Results?.[0]?.Vid
    } else {
      const q = { Action: 'CommitImageUpload', Version: '2018-08-01', ServiceId: SERVICE_ID, app_id: APP_ID }
      const sig = sigV4({ method: 'POST', url: IMAGEX_HOST, query: q, body: cBody, ak: AK, sk: SK, token: TOKEN, region: VOD_REGION, service: 'imagex' })
      const res = await fetch(sig.finalUrl, {
        method: 'POST',
        headers: { 'User-Agent': UA, Referer: 'https://creator.douyin.com/', 'Content-Type': 'application/json', ...sig.headers },
        body: cBody,
      })
      const j = await res.json()
      mediaId = j?.Result?.Results?.[0]?.Uri
    }
    if (!mediaId) fail('api_error', `提交上传失败${label}，未拿到 media id`)
    mediaIds.push(mediaId)
    log(`  → ${mediaId}`)
  }

  // ═══════════ ⑤ create_v2 发布 ═══════════
  log('[5/5] 发布 (create_v2)...')
  const creationId = rand(8) + Date.now()
  const body = isVideo ? {
    item: {
      common: {
        text: (DESC ? DESC + ' ' : '') + TITLE,
        caption: '', item_title: TITLE,
        activity: '[]', text_extra: '[]', challenges: '[]', mentions: '[]',
        hashtag_source: '', hot_sentence: '', interaction_stickers: '[]',
        visibility_type: 0, download: 1, timing: 0,
        creation_id: creationId, media_type: 4,
        video_id: mediaIds[0], music_source: 0, music_id: null,
      },
      cover: {
        cover_text_uri: null, cover_text: null, poster: null, poster_delay: 0,
        cover_tools_extend_info: JSON.stringify({
          recommendServerInfo: { res: [], times: [] }, recommendCoverList: [],
          recommendCoverInfo: { isFromRecommend: true, isDefaultSelect: false, isRecommendClickFrom: '', selectInfo: {}, editingInfo: {} },
          recommendCoverTime: 0, coverInfo: {}, coverUrl: '',
          coverHorizontalInfo: null, coverHorizontalUrl: '', pasterInfo: null, stateInfo: null,
          croppedCoverInfo: null, uploadBackgroundInfo: null, uploadPasterInfo: null, uploadCoverStateInfo: null,
          xiguaCoverInfo: { posterDelay: 0 }, xiguaPasterInfo: null, xiguaStateInfo: null,
          xiguaUploadCoverStateInfo: null, xiguaUploadBackgroundInfo: null, xiguaUploadPasterInfo: null,
          editXigua: false, coverSource: '', previewVideoList: [{ isCurrent: true }],
        }),
        cover_tools_info: '{}',
      },
      mix: {}, selected_member: { is_selected_member_video: false },
      chapter: { chapter: JSON.stringify({ chapter_abstract: '', chapter_details: [], chapter_type: 0, chapter_tools_info: { chapter_recommend_detail: [], chapter_recommend_abstract: '', chapter_source: 2, chapter_recommend_type: -2, create_date: Math.floor(Date.now() / 1000), is_pc: '1', is_pre_generated: '0', is_syn: '1' } }) },
      anchor: {}, sync: { should_sync: false, sync_to_toutiao: 0 },
      open_platform: {}, assistant: { is_preview: 0, is_post_assistant: 1 },
    },
  } : {
    item: {
      common: {
        text: (DESC ? DESC + '。' : '') + TITLE,
        text_extra: '[]', activity: '[]', challenges: '[]',
        hashtag_source: '', mentions: '[]',
        visibility_type: 0, download: 1, timing: -1,
        media_type: 2,
        images: mediaIds.map((uri, i) => {
          const d = imageSize(bufs[i])
          return { uri, width: d.width, height: d.height }
        }),
        creation_id: creationId,
      },
      cover: { poster: mediaIds[0] },
      anchor: {},
    },
  }

  const pubRes = await sf(`/web/api/media/aweme/create_v2/?read_aid=2906&${BASE_QS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  writeFileSync(join(OUT_DIR, `publish-${Date.now()}.json`), JSON.stringify(pubRes, null, 2))

  if (pubRes.json?.status_code === 0) {
    const itemId = pubRes.json.item_id || pubRes.json.aweme_id
    emit({
      ok: true,
      item_id: itemId,
      media_type: isVideo ? 4 : 2,
      video_id: isVideo ? mediaIds[0] : undefined,
      image_uris: isVideo ? undefined : mediaIds,
      account: account.shop_key,
      title: TITLE,
      share_url: isVideo
        ? `https://www.iesdouyin.com/share/video/${itemId}/`
        : `https://www.iesdouyin.com/share/note/${itemId}/`,
      message: `抖音${isVideo ? '视频' : '图文'}已提交成功。item_id=${itemId}。平台可能仍在审核，最终状态以创作服务平台「作品管理」为准。`,
    })
  } else {
    fail('api_error', '发布未确认成功：' + JSON.stringify(pubRes.json || pubRes.text).slice(0, 500))
  }
} catch (err) {
  fail('api_error', `抖音发布异常：${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  releaseProfile(dir)
}
