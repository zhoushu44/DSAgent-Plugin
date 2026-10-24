/**
 * 拼多多 · 多多视频（pdd-video）
 *
 * 域：live.pinduoduo.com/n-creator/video/home?from=mms
 *     （独立域，mms 扫码后 SSO 自动打通，不用单独登录）
 *
 * ══════════════════════════════════════════════════════════════════
 * 上传链路（2026-10-24 逆向，已实证跑通）
 * ══════════════════════════════════════════════════════════════════
 *   ★ 上传必须走 DOM 注入（input[type=file].uploadFile）
 *     直接调 /live/galerie/signature 会 48143「非法请求」——
 *     该接口依赖页面 SDK 的请求上下文，page.evaluate fetch 复刻不了。
 *     DOM 注入后页面自己走完整 10 步：
 *       ① prePublish/clear            清空待发布队列
 *       ② publish/page/query          发布页配置 + 内容声明清单
 *       ③ galerie/signature           视频上传票据（bucket_tag=backbone-video-sign）
 *       ④ upload_init                 {content_type, create_media, sign}
 *       ⑤ upload_part × N             multipart/form-data
 *       ⑥ upload_complete             {sign: 文件MD5, large_file_size}
 *       ⑦ meta/query                  拿 vid
 *       ⑧ galerie/signature           封面票据（bucket_tag=backbone-cover-b）
 *       ⑨ store_image                 封面上传
 *       ⑩ prePublish/add              加入待发布队列
 *
 * ══════════════════════════════════════════════════════════════════
 * 发布链路（2026-10-24 逆向，参数结构已实证正确）
 * ══════════════════════════════════════════════════════════════════
 *   POST /api/backbone/video/publish
 *   body: { feeds: [feed, ...] }
 *
 *   feed 字段：desc, scheduleTime, goodsIdList, outVideoUrl,
 *     useRecRelatedGoods, anchorDeclarationType, cover,
 *     cutStartTime, cutEndTime, vid, topicId, syncVideo,
 *     needCreateCoverUrl, newPushPxq
 *
 *   anchorDeclarationType: 11=内容无需标注 1=含AI生成 5=含虚构演绎
 *                          7=内容含营销   3=内容为转载 8=个人观点
 *
 * ══════════════════════════════════════════════════════════════════
 * 数据链路（2026-10-24 逆向，已实证）
 * ══════════════════════════════════════════════════════════════════
 *   POST /api/backbone/goods/stats/overview  {dateType, moduleType}
 *        ★ moduleType=1 有数据（商家自营），2 全 null（达人带货）
 *        ★ totalGMVOrigin 单位是「分」，要 /100
 *   POST /api/backbone/goods/stats/trend     {dateType}
 *   GET  /api/backbone/goods/mall/weekly_report
 *   GET  /api/backbone/goods/mall/diagnosis_and_suggest
 *   GET  /api/backbone/goods/show/case
 *   GET  /api/backbone/goods/mall/reject/reason/list
 *
 *   删除：POST /mms/amco/prePublish/delete  {urlList, vidList}
 *         （{videoId}/{vid} 不生效）
 */
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')

const argOf = (n) => {
  const i = process.argv.indexOf(`--${n}`)
  if (i < 0 || i + 1 >= process.argv.length) return undefined
  const v = process.argv[i + 1]
  return v.startsWith('--') ? undefined : v
}
const emit = (obj) => { process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n') }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const mode = argOf('mode') || 'list'
const HOME = 'https://live.pinduoduo.com/n-creator/video/home?from=mms'
const has = (n) => process.argv.includes(`--${n}`)
const limit = Math.min(100, Math.max(1, parseInt(argOf('limit') || '20', 10) || 20))

;(async () => {
  const puppeteer = require('puppeteer-core')
  const { launchOptions, STEALTH_SCRIPT } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-launch.mjs`)
  const { CredentialStore } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/lib/services/credential-store.js`)
  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  // ★ 默认账号：取最近更新的、有 PASS_ID 的 pdd_mms 账号
  //   不能简单 slice(-1) —— 凭证库顺序不稳定，可能取到没登录 live 域的号
  const mmsAccs = store.listAccounts().filter(a => a.platform === 'pdd_mms' && a.cookies?.['PASS_ID'])
  let SHOP = argOf('account') || mmsAccs.slice(-1)[0]?.shop_key
  if (!SHOP) {
    const any = store.listAccounts().filter(a => a.platform === 'pdd_mms')
    SHOP = argOf('account') || any.slice(-1)[0]?.shop_key
  }
  if (!SHOP) { emit({ ok: false, failureKind: 'not_bound', text: '未绑定拼多多商家后台账号' }); process.exit(2) }
  if (mmsAccs.length > 1 && !argOf('account')) {
    console.error(`[pdd-video] 多个账号可用，默认取 ${SHOP}；可用 --account 指定：\n` + mmsAccs.map(a => `  ${a.shop_key}  ${a.display_label || ''}`).join('\n'))
  }

  // ── upload：文件校验（不启浏览器）──
  const file = argOf('file')
  if (mode === 'upload') {
    if (!file) { emit({ ok: false, failureKind: 'api_error', text: 'upload 模式必须带 --file <视频路径>' }); process.exit(2) }
    if (!fs.existsSync(file)) { emit({ ok: false, failureKind: 'api_error', text: `文件不存在：${file}` }); process.exit(2) }
    const sizeMB = fs.statSync(file).size / 1024 / 1024
    const ext = path.extname(file).toLowerCase()
    if (!['.mp4', '.mov', '.mkv', '.webm', '.avi', '.flv', '.wmv', '.m4v'].includes(ext)) {
      emit({ ok: false, failureKind: 'api_error', text: `不支持的格式 ${ext}（支持 mp4/mov/mkv/webm/avi/flv/wmv/m4v）` }); process.exit(2)
    }
    if (sizeMB > 500) { emit({ ok: false, failureKind: 'api_error', text: `文件 ${sizeMB.toFixed(1)}MB 超过 500MB` }); process.exit(2) }
    if (!has('confirm')) {
      emit({
        ok: false, needConfirm: true, mode: 'upload', file,
        text: `【多多视频上传预览 · 需用户确认】\n文件：${path.basename(file)}\n大小：${sizeMB.toFixed(2)}MB\n格式：${ext}\n\n链路（DOM 注入，页面自己走 10 步）：\n  ① prePublish/clear → ② publish/page/query\n  ③ galerie/signature（视频票据）\n  ④ upload_init → ⑤ upload_part × N → ⑥ upload_complete\n  ⑦ meta/query（拿 vid）→ ⑧ 封面票据 → ⑨ store_image → ⑩ prePublish/add\n\n确认后请带 --confirm true 重新调用。\n加 --publish true 可上传后直接发布。`,
      })
      process.exit(0)
    }
  }

  // ── delete：预览 ──
  if (mode === 'delete') {
    let vid = argOf('video-id')
    if (!vid && !has('confirm')) {
      emit({
        ok: false, needConfirm: true, mode: 'delete',
        text: `【多多视频删除预览 · 需用户确认】\n\n未指定 --video-id，将删除待发布队列里的**第一个**视频。\n\n用 --mode list 查看队列里的 vid。\n\n确认后请带 --confirm true 重新调用（可加 --video-id 指定）。`,
      })
      process.exit(0)
    }
    if (!has('confirm')) {
      emit({
        ok: false, needConfirm: true, mode: 'delete', videoId: vid,
        text: `【多多视频删除预览 · 需用户确认】\n视频 vid：${vid}\n\n删除后不可恢复。\n\n确认后请带 --confirm true 重新调用。`,
      })
      process.exit(0)
    }
  }

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

  /** 带重试的 evaluate（避开偶发 detached Frame） */
  async function ev(fn, ...args) {
    for (let i = 0; i < 6; i++) {
      try { return await page.evaluate(fn, ...args) }
      catch (e) {
        if (/detached Frame|Target closed|Session closed/i.test(String(e))) { await sleep(2000); continue }
        throw e
      }
    }
    return null
  }
  /** 等页面有内容（★ 不要长等：SSO 会改 URL，等太久页面会空） */
  async function waitReady(minLen = 400, maxMs = 30000) {
    const t0 = Date.now()
    while (Date.now() - t0 < maxMs) {
      try {
        const len = await ev(() => (document.body?.innerText || '').length)
        const isLogin = await ev(() => /\/login|\/sso/i.test(location.href))
        if (len > minLen && !isLogin) return true
      } catch { /* ignore */ }
      await sleep(2000)
    }
    return false
  }
  /** 等上传 input 就绪（实测 2 秒内出现） */
  async function waitUploadInput(maxSec = 40) {
    for (let i = 0; i < maxSec / 2; i++) {
      try { const n = await page.$$('input[type="file"]'); if (n.length) return n } catch { /* ignore */ }
      await sleep(2000)
    }
    return []
  }
  /** 统一 POST（走页面会话） */
  const api = (p, bd) => page.evaluate(async (p2, b2) => {
    try {
      const resp = await fetch('https://live.pinduoduo.com' + p2, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b2 || {}),
      })
      return { status: resp.status, json: await resp.json().catch(() => null) }
    } catch (e) { return { status: 0, json: null, err: String(e).slice(0, 100) } }
  }, p, bd || {})
  /** 统一 GET */
  const apiGet = (p) => page.evaluate(async (p2) => {
    try {
      const resp = await fetch('https://live.pinduoduo.com' + p2, { credentials: 'include' })
      return { status: resp.status, json: await resp.json().catch(() => null) }
    } catch (e) { return { status: 0, json: null, err: String(e).slice(0, 100) } }
  }, p)
  /** 取待发布队列 */
  const getQueue = async () => {
    const r = await api('/mms/amco/prePublish/query', { pageSize: 50, pageNum: 1 })
    return r.json?.result?.result?.list || []
  }

  const out = { ok: true, mode, shopKey: SHOP }

  try {
    await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {})
    const ready = await waitReady(400, 30000)
    if (!ready) {
      const url = await ev(() => location.href) || ''
      const len = await ev(() => (document.body?.innerText || '').length) || 0
      out.ok = false; out.failureKind = 'token_expired'
      out.text = [
        '多多视频页面未就绪（30s 内无内容）。',
        `  当前 URL: ${url}`,
        `  页面文本长度: ${len}`,
        '',
        /\/login|\/sso/i.test(url)
          ? '账号在 live.pinduoduo.com（推广/视频域）未登录。\n请到「账号连接」重新扫码登录 pdd_mms（会自动打通 live 域）。'
          : '可能账号选错了。可用 --account <shopKey> 指定已登录的账号。',
        '',
        '可用账号：',
        ...mmsAccs.map(a => `  ${a.shop_key}  ${a.display_label || ''}`),
      ].join('\n')
      emit(out); process.exit(2)
    }
    await sleep(6000)

    // ══════════════════ upload（DOM 注入）══════════════════
    if (mode === 'upload') {
      const title = argOf('title') || path.basename(file).replace(/\.[^.]+$/, '')
      const goodsId = argOf('goods-id') ? Number(argOf('goods-id')) : null

      const inputs = await waitUploadInput(40)
      if (!inputs.length) {
        out.ok = false; out.failureKind = 'api_error'
        out.text = '页面找不到上传 input（input[type=file]）'
        emit(out); process.exit(2)
      }
      console.error('[pdd-video] DOM 注入文件，页面自己走上传链路...')
      await inputs[0].uploadFile(file)

      // 等上传完成：必须看到「发布面板」出现（内容声明 + 一键发布）
      // ★ 先记录上传前的页面状态，避免被残留面板误导
      const beforeTxt = await ev(() => document.body?.innerText || '') || ''
      const hadPanelBefore = /内容声明/.test(beforeTxt) && /一键发布/.test(beforeTxt)
      console.error(`[pdd-video] 上传前面板状态: ${hadPanelBefore ? '已有面板（可能是上次残留）' : '无面板'}`)

      let uploaded = false
      for (let k = 0; k < 60; k++) {
        await sleep(3000)
        const txt = await ev(() => document.body?.innerText || '') || ''
        // 面板出现 + 页面文本长度明显增长（说明真的在加载新内容）
        const hasPanel = /内容声明/.test(txt) && /一键发布/.test(txt)
        const grew = txt.length > beforeTxt.length + 100
        // 或出现「上传中」进度
        const uploading = /上传中|上传进度|\d+%/.test(txt)
        if (hasPanel && (grew || !hadPanelBefore)) {
          uploaded = true
          console.error(`[pdd-video] 上传完成（${(k + 1) * 3}s，len ${beforeTxt.length}→${txt.length}）`)
          break
        }
        if (k % 5 === 0) console.error(`[pdd-video] 等待上传… ${(k + 1) * 3}s len=${txt.length} 面板=${hasPanel} 进度=${uploading}`)
      }
      if (!uploaded) {
        out.ok = false; out.failureKind = 'api_error'
        out.text = `上传超时（180s）。页面文本长度 ${beforeTxt.length}，未见发布面板刷新。`
        emit(out); process.exit(2)
      }

      // 取 vid：查队列（多重试，上传后服务端要时间落库）
      let vid = ''
      let item = null
      for (let attempt = 0; attempt < 6; attempt++) {
        await sleep(4000)
        const list = await getQueue()
        console.error(`[pdd-video] 队列查询第 ${attempt + 1} 次：${list.length} 个`)
        if (list.length) {
          // 取标题匹配的（避免拿到上一个残留）
          item = list.find(v => String(v.title || '').includes(path.basename(file).slice(0, 20))) || list[0]
          vid = item.vid
          break
        }
      }
      out.ok = !!vid
      out.upload = { vid, via: 'dom-inject', size: fs.statSync(file).size, title: item?.title || title, coverUrl: item?.coverUrl || '' }
      out.text = out.ok
        ? [
            '✅ 多多视频上传成功（DOM 注入，页面走完整 10 步）',
            `  vid: ${vid}`,
            `  标题: ${item?.title || title}`,
            `  大小: ${(fs.statSync(file).size / 1024 / 1024).toFixed(2)}MB`,
            item?.coverUrl ? `  封面: ${item.coverUrl.slice(0, 80)}` : '',
            '',
            '视频已在待发布队列（--mode list 可查）。',
          ].filter(Boolean).join('\n')
        : '⚠️ 页面显示上传成功，但队列没查到 vid'

      // 可选：直接发布
      if (out.ok && has('publish') && argOf('publish') !== 'false') {
        const L = ['', '▶ 执行发布...']
        const feed = {
          desc: argOf('desc') || '',
          scheduleTime: null,
          goodsIdList: goodsId ? [goodsId] : [],
          outVideoUrl: '',
          useRecRelatedGoods: false,
          anchorDeclarationType: Number(argOf('declaration') || 11),
          cover: item?.coverUrl || '',
          cutStartTime: null,
          cutEndTime: null,
          vid,
          topicId: null,
          syncVideo: false,
          needCreateCoverUrl: null,
          newPushPxq: null,
        }
        const pubR = await api('/api/backbone/video/publish', { feeds: [feed] })
        out.publish = pubR.json?.result ?? pubR.json
        out.publishCode = pubR.json?.errorCode
        out.publishMsg = pubR.json?.errorMsg
        if (pubR.json?.success) {
          L.push('✅ 发布成功！视频已提交审核，通过后对外展示。')
          try { await api('/mms/amco/prePublish/delete', { urlList: [], vidList: [vid] }) } catch { /* ignore */ }
        } else {
          L.push(`⚠️ 发布返回：errorCode=${out.publishCode ?? '?'} ${out.publishMsg || ''}`)
          if (out.publishCode === 2000000) {
            L.push('')
            L.push('「账号被系统判定不适合发布」→ 权限问题。')
            L.push('用 --mode permission 查带货/内容权限。')
          }
          out.ok = false
          out.failureKind = 'no_permission'
        }
        out.text += '\n' + L.join('\n')
      } else if (out.ok) {
        out.text += '\n\n提示：加 --publish true 可上传后直接发布。'
      }
      if (!out.ok) process.exitCode = 2
    }

    // ══════════════════ delete ═══════════════════
    else if (mode === 'delete') {
      let vid = argOf('video-id')
      const list = await getQueue()
      if (!vid) {
        if (!list.length) {
          out.ok = false; out.failureKind = 'api_error'
          out.text = '待发布队列已空，没有可删除的视频'
          emit(out); process.exit(2)
        }
        vid = list[0].vid
        out.autoPicked = true
      }
      const url = list.find(v => v.vid === vid)?.url || ''
      const r = await api('/mms/amco/prePublish/delete', { urlList: url ? [url] : [], vidList: [vid] })
      out.ok = !!r.json?.success
      out.endpoint = '/mms/amco/prePublish/delete'
      out.request = { urlList: url ? [url] : [], vidList: [vid] }
      const remain = await getQueue()
      out.remaining = remain.length
      if (out.ok && remain.length === 0) {
        out.text = `✅ 已删除（队列已清空）\n  vid: ${vid}${out.autoPicked ? '（自动选取队列第一个）' : ''}`
      } else if (out.ok) {
        out.text = `⚠️ 接口返回成功，但队列还剩 ${remain.length} 个\n` + remain.slice(0, 5).map((v, i) => `  剩 [${i}] ${v.vid}`).join('\n')
      } else {
        out.text = `❌ 删除失败：${JSON.stringify(r.json).slice(0, 250)}`
      }
      if (!out.ok) process.exitCode = 2
    }

    // ══════════════════ list（待发布队列）══════════════════
    else if (mode === 'list') {
      const list = await getQueue()
      out.videos = list.slice(0, limit).map(v => ({
        videoId: v.vid ?? v.videoId,
        title: String(v.title ?? '').slice(0, 80),
        desc: String(v.desc ?? '').slice(0, 120),
        url: v.url ?? '',
        coverUrl: v.coverUrl ?? '',
        cutStartTime: v.cutStartTime ?? null,
        scheduleTime: v.scheduleTime ?? null,
        goodsList: (v.goodsItemList || []).map(g => ({ goodsId: g.goodsId, name: g.goodsName })),
      }))
      out.count = list.length
      out.text = out.videos.length
        ? `多多视频待发布队列（${out.videos.length} 个）：\n` + out.videos.map((v, i) =>
            [`  ${i + 1}. ${v.title.slice(0, 50)}`, `     vid: ${v.videoId}`, v.url ? `     ${v.url.slice(0, 90)}` : '', v.goodsList.length ? `     商品 ${v.goodsList.length} 个` : ''].filter(Boolean).join('\n')).join('\n')
        : '多多视频待发布队列：0 个。\n店铺还没发过带货视频。'
    }

    // ══════════════════ published（已发布）══════════════════
    else if (mode === 'published') {
      const status = argOf('status') != null ? Number(argOf('status')) : 1
      const end = Date.now()
      const start = argOf('start') ? new Date(argOf('start')).getTime() : end - 30 * 86400000
      const r = await api('/api/backbone/video/query', { status, pageSize: limit, page: 1, startTime: start, endTime: end })
      const res = r.json?.result
      const feeds = res?.feeds || []
      out.feeds = feeds.map(f => ({
        feedId: f.feedId ?? f.id,
        title: String(f.title ?? f.desc ?? '').slice(0, 80),
        cover: f.cover ?? f.coverUrl ?? '',
        vid: f.vid ?? null,
        status: f.status ?? null,
        playCnt: f.playCnt ?? f.viewCnt ?? f.playCount ?? null,
        likeCnt: f.likeCnt ?? f.likeCount ?? null,
        commentCnt: f.commentCnt ?? f.commentCount ?? null,
        goodsList: (f.goodsList || []).map(g => ({ goodsId: g.goodsId, name: g.goodsName })),
      }))
      out.count = feeds.length
      out.total = res?.total ?? null
      out.text = out.feeds.length
        ? `已发布视频（status=${status}，${out.feeds.length} 个${out.total != null ? ` / total ${out.total}` : ''}）：\n` +
          out.feeds.map((f, i) => [`  ${i + 1}. [${f.feedId}] ${f.title.slice(0, 45)}`, `     播放=${f.playCnt ?? '—'} 点赞=${f.likeCnt ?? '—'} 评论=${f.commentCnt ?? '—'}`, f.goodsList.length ? `     商品: ${f.goodsList.map(g => g.name || g.goodsId).slice(0, 3).join('、')}` : ''].filter(Boolean).join('\n')).join('\n')
        : `已发布视频（status=${status}）：0 个\n\nstatus 取值：0~4 有效（5 报 BAD_PARAMS），-1 = 全部`
    }

    // ══════════════════ data（带货数据）══════════════════
    else if (mode === 'data' || mode === 'goods-data') {
      const dateType = Number(argOf('date-type') || 2)      // 1=昨日 2=近7日 3=近30日
      const moduleType = Number(argOf('module-type') || 1)  // 1=商家自营(有数据) 2=达人带货(空)
      const [ovR, trR, wkR, sgR] = await Promise.all([
        api('/api/backbone/goods/stats/overview', { dateType, moduleType }),
        api('/api/backbone/goods/stats/trend', { dateType }),
        apiGet('/api/backbone/goods/mall/weekly_report'),
        apiGet('/api/backbone/goods/mall/diagnosis_and_suggest'),
      ])
      const ov = ovR.json?.result
      const tr = trR.json?.result
      const wk = wkR.json?.result
      const sg = sgR.json?.result
      out.data = { dateType, moduleType, overview: ov, trend: tr, weekly: wk, suggest: sg }

      const DT = { 1: '昨日', 2: '近7日', 3: '近30日' }
      const L = [`多多视频 · 带货数据（${DT[dateType] || dateType}，moduleType=${moduleType}${moduleType === 1 ? ' 商家自营' : ' 达人带货'}）`, '']

      if (ov && ov.totalGMV != null) {
        const pct = (r) => (r == null ? '' : `  较前30日 ${r > 0 ? '+' : ''}${(r * 100).toFixed(2)}%`)
        L.push(`【数据总览】${ov.startPt || ''} ~ ${ov.endPt || ''}`)
        L.push(`  支付金额      ¥${ov.totalGMV}${pct(ov.totalGMVRate)}`)
        L.push(`  支付订单数    ${ov.orderCount}${pct(ov.orderCountRate)}`)
        L.push(`  支付人数      ${ov.orderUV}${pct(ov.orderUVRate)}`)
        L.push(`  发布视频数    ${ov.feedCount}${pct(ov.feedCountRate)}`)
        L.push(`  视频播放次数  ${ov.videoViewCnt}${pct(ov.videoViewCntRate)}`)
        L.push(`  商品曝光次数  ${ov.goodsClkCnt}${pct(ov.goodsClkCntGrowthRate)}`)
        L.push(`  已讲解商品    ${ov.hasExplainGoodsTotal}（覆盖率 ${ov.explainCoverRate || '—'}）`)
        // ★ totalGMVOrigin 单位是「分」
        const gmv = Number(ov.totalGMVOrigin || 0) / 100 || Number(ov.totalGMV || 0)
        const ord = Number(ov.orderCountOrigin || ov.orderCount || 0)
        const uv = Number(ov.orderUVOrigin || ov.orderUV || 0)
        const view = Number(ov.videoViewCntOrigin || ov.videoViewCnt || 0)
        if (ord > 0) L.push(`  客单价        ¥${(gmv / ord).toFixed(2)}`)
        if (uv > 0) L.push(`  人均订单      ${(ord / uv).toFixed(2)}`)
        if (view > 0) L.push(`  千次播放成交  ¥${(gmv / view * 1000).toFixed(2)}`)
      } else {
        L.push('【数据总览】无数据（moduleType 选错？1=商家自营有数据，2=达人带货为空）')
      }

      const items = tr?.items || []
      if (items.length) {
        L.push('')
        L.push(`【趋势】${items.length} 天`)
        for (const d of items.slice(0, 15)) {
          L.push(`  ${d.statDate}  GMV¥${String(d.totalGMV ?? 0).padStart(7)}  订单${String(d.orderCount ?? 0).padStart(3)}  播放${String(d.videoViewCnt ?? 0).padStart(5)}  商品点击${String(d.goodsClkCnt ?? 0).padStart(4)}  发视频${d.feedCount ?? 0}`)
        }
        if (items.length > 15) L.push(`  …还有 ${items.length - 15} 天`)
        const sum = items.reduce((s, d) => ({
          gmv: s.gmv + (d.totalGMV || 0), ord: s.ord + (d.orderCount || 0),
          view: s.view + (d.videoViewCnt || 0), clk: s.clk + (d.goodsClkCnt || 0),
          feed: s.feed + (d.feedCount || 0),
        }), { gmv: 0, ord: 0, view: 0, clk: 0, feed: 0 })
        L.push('')
        L.push(`  合计：GMV ¥${sum.gmv.toFixed(2)} / 订单 ${sum.ord} / 播放 ${sum.view} / 商品点击 ${sum.clk} / 发视频 ${sum.feed}`)
        const best = [...items].sort((a, b) => (b.totalGMV || 0) - (a.totalGMV || 0)).slice(0, 3)
        L.push(`  GMV Top3: ${best.map(d => `${d.statDate} ¥${d.totalGMV}`).join(' | ')}`)
      }

      const sl = sg?.suggestList || []
      if (sl.length) {
        L.push('')
        L.push('【诊断建议】')
        for (const s of sl.slice(0, 5)) {
          const title = Array.isArray(s.title) ? s.title.map(x => x.text).join('') : (s.title || '')
          const content = String(s.content || '').replace(/<[^>]+>/g, '')
          L.push(`  · ${title}${content ? ' — ' + content.slice(0, 60) : ''}${s.buttonText ? ` [${s.buttonText}]` : ''}`)
        }
      }

      if (wk && wk.startPt) {
        L.push('')
        L.push(`【带货周报】${wk.startPt} ~ ${wk.endPt}`)
        const g = wk.publishWeeklyReportGoodsGmv
        if (g) L.push(`  发布视频数 ${g.feedCount ?? '—'} | 支付金额 ¥${g.totalOrderAmount ?? '—'}`)
      }
      out.text = L.join('\n')
    }

    // ══════════════════ permission ═══════════════════
    else if (mode === 'permission') {
      const [cR, fR, gR] = await Promise.all([
        api('/api/backbone/video/signed_contract/query', {}),
        api('/element/obs/video_flow_card/entrance', {}),
        api('/carllive/replay/mall_promotion_config', {}),
      ])
      const c = cR.json?.result, f = fR.json?.result, g = gR.json?.result
      out.permission = { contract: c, flowCard: f, cfg: g }
      const L = ['多多视频 · 权限与奖励', '', '【带货/内容权限】',
        `  商品带货权限   ${c?.goodsFeedPermission ? '✅ 已开通' : '❌ 未开通'}`,
        `  普通内容权限   ${c?.commonFeedPermission ? '✅ 已开通' : '❌ 未开通'}`]
      if (c?.commonFeedPermissionUrl) L.push(`  协议: ${c.commonFeedPermissionUrl}（v${c.commonFeedPermissionVer || '?'}）`)
      L.push('', '【流量卡奖励】',
        `  入口显示       ${f?.showEntry ? '✅' : '❌'}`,
        `  审核奖励       ${f?.auditVideoFlowCardReward ?? '—'} 张流量卡`,
        `  批量投放灰度   ${f?.grayResult?.video_batch_flow_limit ? '✅' : '❌'}`,
        '', '【带货配置】',
        `  入口           ${g?.show_entrance ? '✅ 显示' : '❌ 隐藏'}`,
        `  有流量标签     ${g?.has_stream_tag ? '✅' : '❌'}`,
        `  切片视频奖励   ${g?.hit_slice_video_reward_qualified ? '✅ 符合' : '❌ 不符合'}`)
      out.text = L.join('\n')
    }

    // ══════════════════ anchor ═══════════════════
    else if (mode === 'anchor') {
      // /kiwi/obs/anchor/info 是 GET（POST 会 405）
      const r = await apiGet('/kiwi/obs/anchor/info')
      const a = r.json?.result ?? r.json
      const valid = a && typeof a === 'object' && (a.anchorUid || a.anchorName || a.name)
      out.anchor = a
      out.text = valid
        ? `主播信息：\n  anchorUid:  ${a.anchorUid ?? '—'}\n  anchorName: ${a.anchorName ?? a.name ?? '—'}\n  roomId:      ${a.roomId ?? '—'}\n  fansNum:     ${a.fansNumTip ?? a.fansNumDataTip ?? '—'}${a.fansNumSuffixTip ?? ''}\n  showNum:     ${a.showNum ?? '—'}\n  goodsLimit:  ${a.goodsLimit ?? '—'}`
        : `主播信息：接口返回异常（${JSON.stringify(a).slice(0, 150)}）`
    }

    // ══════════════════ qualify ═══════════════════
    else if (mode === 'qualify') {
      const r = await api('/api/backbone/video/publish_qualification', {})
      const q = r.json?.result
      out.qualify = q
      out.text = q
        ? `发布资格：${q.hasQualification ? '✅ 有资格' : '❌ 无资格'}${q.reason ? `（${q.reason}）` : ''}${q.disableGoodsTab ? '\n⚠️ 商品带货 tab 被禁用' : ''}`
        : '发布资格：未获取到'
    }

    // ══════════════════ topics ═══════════════════
    else if (mode === 'topics') {
      const r = await api('/api/orpheus-obs/topic/list', { page_size: 20, page: 1 })
      const arr = r.json?.result?.topic_volist || []
      out.topics = r.json?.result
      if (arr.length) {
        out.text = `话题 ${arr.length} 个：\n` + arr.slice(0, 20).map(x => `  · ${x.name || x.title || x.topicName}（${x.id || x.topicId || '—'}）`).join('\n')
      } else {
        const pc = await api('/api/backbone/video/publish/page/query', {})
        const decl = pc.json?.result?.anchorDeclarationList || []
        out.declarations = decl
        out.text = `话题：0 个（topic_volist 空）\n\n发布必填 · 内容声明（anchorDeclarationType）：\n` +
          (decl.length ? decl.map(d => `  · type=${d.type}  ${d.name}`).join('\n') : '  （未获取到）')
      }
    }

    else {
      out.ok = false; out.failureKind = 'api_error'
      out.text = `未知 mode：${mode}\n\n可用：\n  list        待发布队列\n  published   已发布视频\n  upload      上传视频（L2 写）\n  delete      删除视频（L2 写）\n  data        带货数据\n  permission  权限与流量卡奖励\n  anchor      主播信息\n  qualify     发布资格\n  topics      话题/内容声明`
      process.exitCode = 2
    }
  } catch (e) {
    out.ok = false; out.failureKind = 'exception'
    out.text = `多多视频 ${mode} 失败：${e.message?.slice(0, 200)}`
    emit(out); process.exit(2)
  }

  emit(out)
  process.exit(out.ok ? 0 : 2)
})().catch(async (e) => {
  emit({ ok: false, failureKind: 'exception', text: `多多视频异常：${e.message?.slice(0, 200)}` })
  process.exit(2)
})
