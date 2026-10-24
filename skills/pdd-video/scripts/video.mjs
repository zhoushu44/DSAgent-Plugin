/**
 * 拼多多 · 多多视频（pdd-video）
 *
 * 域名：live.pinduoduo.com（独立域，通过 mms SSO 打通）
 * 入口：https://live.pinduoduo.com/n-creator/video/home?from=mms
 *
 * 能力：
 *   list        我的视频列表（/mms/amco/prePublish/query）
 *   anchor      主播信息（/kiwi/obs/anchor/info + /api/backbone/anchor/query）
 *   qualify     发布资格（/api/backbone/video/publish_qualification）
 *   topics      话题列表（/api/orpheus-obs/topic/list）
 *
 * 用法：
 *   node scripts/video.mjs --mode list
 *   node scripts/video.mjs --mode anchor
 */
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')

const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined }
const emit = (obj) => { process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n') }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const mode = argOf('mode') || 'list'
const limit = Math.min(100, Math.max(1, parseInt(argOf('limit') || '20', 10) || 20))

const HOME = 'https://live.pinduoduo.com/n-creator/video/home?from=mms'

;(async () => {
  const puppeteer = require('puppeteer-core')
  const { launchOptions, STEALTH_SCRIPT } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-launch.mjs`)
  const { CredentialStore } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/lib/services/credential-store.js`)
  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  let SHOP = argOf('account') || store.listAccounts().filter(a => a.platform === 'pdd_mms').slice(-1)[0]?.shop_key
  if (!SHOP) { emit({ ok: false, failureKind: 'not_bound', text: '未绑定拼多多商家后台账号' }); process.exit(2) }

  const browser = await puppeteer.launch(launchOptions(SHOP, {
    args: [
      '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  }))
  const page = (await browser.pages())[0] || await browser.newPage()
  await page.evaluateOnNewDocument(STEALTH_SCRIPT)

  const cdp = await page.target().createCDPSession()
  await cdp.send('Network.enable')

  // 收集 live 域的接口响应
  const caps = []
  cdp.on('Network.responseReceived', async (e) => {
    const u = String(e.response?.url || '')
    if (!/live\.pinduoduo\.com/.test(u)) return
    if (!/api|\/mms\//.test(u)) return
    if (/pmm|pfb|xg\//.test(u)) return     // 排除埋点
    try {
      const { body } = await cdp.send('Network.getResponseBody', { requestId: e.requestId })
      if (body && body.length > 20) caps.push({ url: u, body: body.slice(0, 300000), len: body.length })
    } catch { /* ignore */ }
  })

  const st = () => page.evaluate(() => ({
    isLogin: /\/login|\/sso/i.test(location.href),
    len: (document.body?.innerText || '').length,
    url: location.href.slice(0, 120),
  })).catch(() => null)

  console.error('[pdd-video] 打开多多视频...')
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {})
  for (let i = 0; i < 60; i++) {
    await sleep(2000)
    const s = await st()
    if (!s) continue
    if (s.isLogin) { if (i % 5 === 0) console.error('[pdd-video] 等待 SSO 打通...'); continue }
    if (s.len > 400) { console.error(`[pdd-video] 就绪: ${s.url}`); break }
  }
  await sleep(12000)

  // 兜底：部分接口要点「内容管理」才发，这里直接导航
  const byApi = new Map()
  const collect = () => {
    for (const c of caps) {
      const k = c.url.replace(/^https:\/\/[^/]+/, '').split('?')[0]
      if (!byApi.has(k)) byApi.set(k, c)
    }
  }
  collect()

  // 主动补一次（有些接口要交互才发）
  const extra = async (path, body) => {
    try {
      const r = await page.evaluate(async (p, bd) => {
        const resp = await fetch('https://live.pinduoduo.com' + p, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bd || {}),
        })
        return { status: resp.status, json: await resp.json().catch(() => null) }
      }, path, body || {})
      return r.json
    } catch { return null }
  }

  const out = { ok: true, mode, shopKey: SHOP, url: HOME }

  if (mode === 'list') {
    let list = null
    const hit = byApi.get('/mms/amco/prePublish/query')
    if (hit) {
      try {
        const j = JSON.parse(hit.body)
        // 实测返回是双层 result：{success, result:{result:{list,hasMore,total,sortTotal}}}
        list = j.result?.result ?? j.result ?? j.data
      } catch { /* ignore */ }
    }
    if (!list) list = await extra('/mms/amco/prePublish/query', { pageSize: limit, pageNum: 1 })
    // 兼容多种形态：{list,total} / [] / {videos} / {items}
    let items = []
    let total = null
    if (Array.isArray(list)) items = list
    else if (list && typeof list === 'object') {
      items = list.list || list.videos || list.items || list.videoList || []
      total = list.total ?? list.sortTotal ?? null
    }
    out.videos = items.slice(0, limit).map(v => ({
      videoId: v.videoId ?? v.id ?? v.video_id ?? v.bizId,
      title: String(v.title ?? v.name ?? v.videoTitle ?? v.desc ?? '').slice(0, 60),
      cover: v.cover ?? v.coverUrl ?? v.img ?? v.thumbUrl ?? '',
      duration: v.duration ?? v.videoDuration ?? null,
      status: v.status ?? v.auditStatus ?? v.publishStatus ?? null,
      publishTime: v.publishTime ?? v.createdAt ?? v.gmtCreated ?? null,
      playCnt: v.playCnt ?? v.playCount ?? v.viewCnt ?? null,
      goodsCnt: v.goodsCnt ?? v.bindGoodsCount ?? null,
      raw: v,
    }))
    out.count = items.length
    out.total = total
    out.hasMore = list?.hasMore ?? null
    out.text = out.videos.length
      ? `多多视频（${out.videos.length} 个${total != null ? ` / 共 ${total}` : ''}）：\n` + out.videos.map((v, i) =>
          `  ${i + 1}. [${v.videoId}] ${v.title || '(无标题)'} | 状态=${v.status ?? '—'} | 时长=${v.duration ?? '—'} | 播放=${v.playCnt ?? '—'} | 商品=${v.goodsCnt ?? '—'}`).join('\n')
      : `多多视频：0 个${total != null ? `（total=${total}）` : ''}。\n店铺还没发过带货视频。\n\n页面提示：\n  · 上传入口：点击上传或直接把视频拖到上传区域，支持批量上传\n  · 快捷发布：用商品 id 命名视频文件，上传后平台自动匹配商品\n  · 流量奖励：上传成功 + 添加有流量奖励的商品 + 审核通过 → 得大额流量卡`
  }

  if (mode === 'anchor') {
    let info = null
    const hit = byApi.get('/kiwi/obs/anchor/info') || byApi.get('/api/backbone/anchor/query')
    if (hit) { try { info = JSON.parse(hit.body).result ?? JSON.parse(hit.body).data } catch { /* ignore */ } }
    if (!info) info = await extra('/api/backbone/anchor/query', {})
    out.anchor = info
    out.text = info
      ? `主播信息：${JSON.stringify(info).slice(0, 400)}`
      : `主播信息：未获取到`
  }

  if (mode === 'qualify') {
    const q = await extra('/api/backbone/video/publish_qualification', {})
    out.qualify = q
    out.text = q ? `发布资格：${JSON.stringify(q).slice(0, 400)}` : `发布资格：未获取到`
  }

  if (mode === 'topics') {
    const t = await extra('/api/orpheus-obs/topic/list', {})
    out.topics = t
    const arr = Array.isArray(t) ? t : (t?.list || t?.topics || [])
    out.text = arr.length ? `话题 ${arr.length} 个：\n` + arr.slice(0, 20).map(x => `  · ${x.name || x.title || x.topicName}（${x.id || x.topicId || '—'}）`).join('\n') : `话题：0 个`
  }

  emit(out)
  process.exit(0)
})().catch(async (e) => {
  emit({ ok: false, failureKind: 'exception', text: `多多视频探索失败：${e.message?.slice(0, 200)}` })
  process.exit(2)
})
