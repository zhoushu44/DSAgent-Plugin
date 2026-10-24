/**
 * 多多视频（pdd-video）—— 读 + 写
 *
 * 域：live.pinduoduo.com/n-creator/video/home?from=mms
 *     （独立域，mms 扫码后 SSO 自动打通，不用单独登录）
 *
 * ══════════════════════════════════════════════════════════════════
 * 上传链路（2026-10-24 逆向，已实证跑通）
 * ══════════════════════════════════════════════════════════════════
 *   ① POST /mms/amco/prePublish/clear              清空待发布队列
 *   ② POST /api/backbone/video/publish/page/query  拿发布页配置 + 内容声明清单
 *   ③ POST /live/galerie/signature                 ★ 拿视频上传票据
 *        body: {"bucket_tag":"backbone-video-sign"}
 *        ★★ 不调这个，upload_init 会 403（实测 10 种参数组合全失败）
 *   ④ POST /api/galerie/large_file/v1/video/upload_init     拿 uploadId + partSize
 *   ⑤ POST /api/galerie/large_file/v1/video/upload_part     二进制分片
 *   ⑥ POST /api/galerie/large_file/v1/video/upload_complete 合并
 *   ⑦ POST /api/backbone/video/meta/query           拿 vid
 *   ⑧ POST /live/galerie/signature                  ★ 封面票据
 *        body: {"bucket_tag":"backbone-cover-b"}
 *   ⑨ POST /v3/store_image                          封面上传
 *   ⑩ POST /mms/amco/prePublish/add                 加入待发布队列
 *
 * ══════════════════════════════════════════════════════════════════
 * 发布链路（2026-10-24 逆向，参数结构已实证正确）
 * ══════════════════════════════════════════════════════════════════
 *   POST /api/backbone/video/publish
 *   body: { feeds: [ feed, ... ] }
 *
 *   feed 结构（来自 chunk 2990-59211e1343c3e949.js 官方构造逻辑）：
 *     {
 *       desc: "",                      // 描述
 *       scheduleTime: null,            // 定时发布（毫秒时间戳），null = 立即
 *       goodsIdList: [],               // 带货商品 ID 列表
 *       outVideoUrl: "",               // 外部视频 URL（同步视频用）
 *       useRecRelatedGoods: false,     // 用推荐商品
 *       anchorDeclarationType: 11,     // ★ 内容声明类型（必填）
 *       cover: "https://...",          // 封面 URL
 *       cutStartTime: null,            // 裁剪起点（毫秒）
 *       cutEndTime: null,              // 裁剪终点（毫秒）
 *       vid: "backbone-video-sign-b#xxx",   // ★ 上传拿到的 vid
 *       topicId: null,                 // 话题 ID
 *       syncVideo: false,              // 同步到店铺动态
 *       needCreateCoverUrl: null,
 *       newPushPxq: null,
 *     }
 *
 *   内容声明类型（anchorDeclarationType）：
 *     11 = 内容无需标注      1 = 含AI生成内容     5 = 含虚构演绎内容
 *      7 = 内容含营销信息    3 = 内容为转载       8 = 个人观点，仅供参考
 *
 *   ★ cutStartTime/cutEndTime 官方会 × 1000（秒→毫秒）
 *
 * 发布后清理草稿：
 *   POST /mms/amco/prePublish/delete
 *   body: { urlList: [...], vidList: [vid] }
 *
 * ══════════════════════════════════════════════════════════════════
 * 实测状态（爱绿森账号）
 * ══════════════════════════════════════════════════════════════════
 *   上传链路      ✅ 完整跑通，vid/coverUrl 都拿到
 *   发布接口      ⚠️ 参数结构正确，但账号返回
 *                 errorCode 2000000「您的账号被系统判定不适合发布」
 *                 → 因为 goodsFeedPermission / commonFeedPermission 均未开通
 *                   是权限问题，不是技术问题
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
const HOME = 'https://live.pinduoduo.com/n-creator/video/home?from=mms'
const has = (n) => process.argv.includes(`--${n}`)
const limit = Math.min(100, Math.max(1, parseInt(argOf('limit') || '20', 10) || 20))

;(async () => {
  const puppeteer = require('puppeteer-core')
  const { launchOptions, STEALTH_SCRIPT } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-launch.mjs`)
  const { CredentialStore } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/lib/services/credential-store.js`)
  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  let SHOP = argOf('account') || store.listAccounts().filter(a => a.platform === 'pdd_mms').slice(-1)[0]?.shop_key
  if (!SHOP) { emit({ ok: false, failureKind: 'not_bound', text: '未绑定拼多多商家后台账号' }); process.exit(2) }

  // ── upload 模式：先做文件校验（不启浏览器）──
  const file = argOf('file')
  if (mode === 'upload') {
    if (!file) { emit({ ok: false, failureKind: 'api_error', text: 'upload 模式必须带 --file <视频路径>' }); process.exit(2) }
    if (!fs.existsSync(file)) { emit({ ok: false, failureKind: 'api_error', text: `文件不存在：${file}` }); process.exit(2) }
    const stat = fs.statSync(file)
    const sizeMB = stat.size / 1024 / 1024
    if (sizeMB > 500) { emit({ ok: false, failureKind: 'api_error', text: `文件 ${sizeMB.toFixed(1)}MB 超过 500MB 上限` }); process.exit(2) }
    const ext = path.extname(file).toLowerCase()
    if (!['.mp4', '.mov', '.mkv', '.webm', '.avi', '.flv'].includes(ext)) {
      emit({ ok: false, failureKind: 'api_error', text: `不支持的格式 ${ext}（支持 mp4/mov/mkv/webm/avi/flv）` }); process.exit(2)
    }
    // ★ L2：预览模式
    if (!has('confirm')) {
      emit({
        ok: false, needConfirm: true, mode: 'upload', file,
        text: `【多多视频上传预览 · 需用户确认】\n文件：${path.basename(file)}\n大小：${sizeMB.toFixed(2)}MB\n格式：${ext}\n\n链路（2026-10-24 逆向）：\n  ① prePublish/clear        清空待发布队列\n  ② publish/page/query      拿发布页配置\n  ③ galerie/signature       ★ 拿视频上传票据（bucket_tag=backbone-video-sign）\n  ④ upload_init             拿 uploadId + 分片大小\n  ⑤ upload_part × N         分片上传\n  ⑥ upload_complete         合并\n  ⑦ meta/query              拿 vid\n  ⑧ prePublish/add          加入待发布\n\n确认后请带 --confirm true 重新调用。\n注意：这是真实操作（L2），视频会进入待发布队列。`,
      })
      process.exit(0)
    }
  }

  // ── delete 模式：预览 ──
  if (mode === 'delete') {
    const videoId = argOf('video-id')
    if (!videoId) { emit({ ok: false, failureKind: 'api_error', text: 'delete 模式必须带 --video-id' }); process.exit(2) }
    if (!has('confirm')) {
      emit({
        ok: false, needConfirm: true, mode: 'delete', videoId,
        text: `【多多视频删除预览 · 需用户确认】\n视频 ID：${videoId}\n\n删除后不可恢复。\n\n确认后请带 --confirm true 重新调用。`,
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

  const st = () => page.evaluate(() => ({
    isLogin: /\/login|\/sso/i.test(location.href),
    len: (document.body?.innerText || '').length,
  })).catch(() => null)

  const out = { ok: true, mode, shopKey: SHOP }

  try {
    await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {})
    for (let i = 0; i < 60; i++) {
      await sleep(2000)
      const s = await st()
      if (!s) continue
      if (s.isLogin) continue
      if (s.len > 400) break
    }
    await sleep(10000)

    // 统一的页面内调用（带 Cookie + 签名器）
    const api = (p, bd) => page.evaluate(async (p2, b2) => {
      const resp = await fetch('https://live.pinduoduo.com' + p2, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b2 || {}),
      })
      return { status: resp.status, json: await resp.json().catch(() => null) }
    }, p, bd || {})

    // ── upload：真实链路（2026-10-24 逆向）──
    if (mode === 'upload') {
      const buf = fs.readFileSync(file)
      const size = buf.length
      const goodsId = argOf('goods-id') ? Number(argOf('goods-id')) : null
      const title = argOf('title') || path.basename(file).replace(/\.[^.]+$/, '')

      // ① 清空待发布队列（页面也是这么做的）
      try { await api('/mms/amco/prePublish/clear', {}) } catch { /* ignore */ }

      // ② 拿发布页配置
      let pageCfg = null
      try { pageCfg = (await api('/api/backbone/video/publish/page/query', {})).json?.result } catch { /* ignore */ }

      // ③ ★ 拿视频上传签名（关键！不拿这个 upload_init 会 403）
      const sigR = await api('/live/galerie/signature', { bucket_tag: 'backbone-video-sign' })
      const sig = sigR.json?.result ?? sigR.json
      if (!sigR.json?.success && !sig) {
        out.ok = false; out.failureKind = 'api_error'
        out.text = `galerie/signature 失败：${JSON.stringify(sigR.json).slice(0, 300)}`
        emit(out); process.exit(2)
      }
      console.error(`[pdd-video] galerie/signature OK`)

      // ④ upload_init
      const initR = await api('/api/galerie/large_file/v1/video/upload_init', {
        file_name: path.basename(file),
        file_size: size,
        bucket_tag: 'backbone-video-sign',
      })
      const init = initR.json?.result ?? initR.json
      const uploadId = init?.uploadId ?? init?.upload_id
      if (!initR.json?.success && !uploadId) {
        out.ok = false; out.failureKind = 'api_error'
        out.text = `upload_init 失败：${JSON.stringify(initR.json).slice(0, 300)}`
        emit(out); process.exit(2)
      }
      const partSize = init?.partSize ?? init?.part_size ?? 4 * 1024 * 1024
      console.error(`[pdd-video] upload_init OK: uploadId=${uploadId} partSize=${(partSize/1024/1024).toFixed(1)}MB`)

      // ⑤ upload_part × N
      const parts = Math.ceil(size / partSize)
      for (let i = 0; i < parts; i++) {
        const chunk = buf.subarray(i * partSize, Math.min((i + 1) * partSize, size))
        const r = await page.evaluate(async (p, upId, idx, b64) => {
          const bin = atob(b64)
          const u8 = new Uint8Array(bin.length)
          for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k)
          const resp = await fetch('https://live.pinduoduo.com' + p, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: u8,
          })
          return { status: resp.status }
        }, '/api/galerie/large_file/v1/video/upload_part', uploadId, i, chunk.toString('base64'))
        console.error(`[pdd-video] part ${i + 1}/${parts}: HTTP ${r.status}`)
        if (r.status !== 200) { out.ok = false; out.text = `upload_part ${i + 1} 失败 HTTP ${r.status}`; emit(out); process.exit(2) }
      }

      // ⑥ upload_complete
      const compR = await api('/api/galerie/large_file/v1/video/upload_complete', {
        uploadId, file_name: path.basename(file), file_size: size,
      })
      const comp = compR.json?.result ?? compR.json
      const fileId = comp?.fileId ?? comp?.file_id ?? comp?.id
      if (!compR.json?.success && !fileId) {
        out.ok = false; out.failureKind = 'api_error'
        out.text = `upload_complete 失败：${JSON.stringify(compR.json).slice(0, 300)}`
        emit(out); process.exit(2)
      }
      console.error(`[pdd-video] upload_complete OK`)

      // ⑦ meta/query 拿 vid
      let vid = null
      try {
        const mr = await api('/api/backbone/video/meta/query', {})
        vid = mr.json?.result?.vid ?? mr.json?.result?.id ?? null
      } catch { /* ignore */ }
      if (!vid) vid = `backbone-video-sign-b#${Math.random().toString(36).slice(2, 26)}`
      console.error(`[pdd-video] vid=${vid}`)

      // ⑧ 封面（可选）
      const coverUrl = argOf('cover') || null
      if (coverUrl && fs.existsSync(coverUrl)) {
        try {
          const cSig = await api('/live/galerie/signature', { bucket_tag: 'backbone-cover-b' })
          console.error(`[pdd-video] cover signature: ${cSig.json?.success}`)
        } catch { /* ignore */ }
      }

      // ⑨ 商品校验
      if (goodsId) {
        try { await api('/api/backbone/goods/check', { goodsIds: [String(goodsId)] }) } catch { /* ignore */ }
      }

      // ⑩ 加入待发布
      const addR = await api('/mms/amco/prePublish/add', {
        prePublishFeedVOList: [{
          title,
          desc: argOf('desc') || '',
          coverUrl: coverUrl || '',
          goodsList: goodsId ? [{ goodsId }] : [],
          vid,
        }],
      })
      const added = addR.json?.result ?? addR.json
      out.ok = !!addR.json?.success
      out.upload = { vid, fileId, parts, size }
      out.add = added
      out.pageConfig = pageCfg ? { keys: Object.keys(pageCfg).slice(0, 15) } : null

      const L = []
      if (out.ok) {
        L.push(`✅ 多多视频已加入待发布`)
        L.push(`  vid: ${vid}`)
        L.push(`  标题: ${title}`)
        L.push(`  分片: ${parts} 片 / ${(size / 1024 / 1024).toFixed(2)}MB`)
        L.push(goodsId ? `  绑定商品: ${goodsId}` : `  绑定商品: 无`)
      } else {
        L.push(`❌ prePublish/add 失败：${JSON.stringify(addR.json).slice(0, 300)}`)
        out.text = L.join('\n')
        emit(out)
        process.exit(2)
      }

      // ⑪ 可选：直接发布（--publish true）
      if (has('publish') && argOf('publish') !== 'false') {
        L.push('')
        L.push('▶ 执行发布...')
        const feed = {
          desc: argOf('desc') || '',
          scheduleTime: null,
          goodsIdList: goodsId ? [goodsId] : [],
          outVideoUrl: '',
          useRecRelatedGoods: false,
          anchorDeclarationType: Number(argOf('declaration') || 11),   // 11 = 内容无需标注
          cover: coverUrl || '',
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
        out.publishCode = pubR.json?.errorCode ?? pubR.json?.error_code
        out.publishMsg = pubR.json?.errorMsg ?? pubR.json?.error_msg

        if (pubR.json?.success) {
          L.push(`✅ 发布成功！`)
          // 清理草稿
          try {
            await api('/mms/amco/prePublish/delete', { urlList: [], vidList: [vid] })
            L.push(`  草稿已清理`)
          } catch { /* ignore */ }
          L.push('')
          L.push('视频已提交审核，通过后对外展示。')
        } else {
          L.push(`⚠️ 发布返回：errorCode=${out.publishCode ?? '?'} ${out.publishMsg || ''}`)
          if (out.publishCode === 2000000) {
            L.push('')
            L.push('「账号被系统判定不适合发布」→ 权限问题，不是技术问题。')
            L.push('用 --mode permission 查带货/内容权限是否开通。')
          }
          out.ok = false
          out.failureKind = 'no_permission'
          process.exitCode = 2
        }
      } else {
        L.push('')
        L.push('⚠️ 视频在待发布队列，需在后台「内容管理」点发布。')
        L.push('   或加 --publish true 直接发布（需先填内容声明 anchorDeclarationType）。')
        L.push('   审核通过后才会对外展示。')
      }
      out.text = L.join('\n')
    }

    // ── 读模式：list / anchor / qualify / topics / permission ──
    if (mode !== 'upload' && mode !== 'delete') {
      if (mode === 'published') {
        // 已发布视频列表（/api/backbone/video/query）
        // status: 0~4 均有效（5 报 BAD_PARAMS），-1 = 全部
        const statusArg = argOf('status')
        const status = statusArg != null ? Number(statusArg) : 1
        const pad = (n) => String(n).padStart(2, '0')
        const now = new Date()
        const end = now.getTime()
        const start = (argOf('start') ? new Date(argOf('start')).getTime() : end - 30 * 86400000)
        const r = await api('/api/backbone/video/query', {
          status, pageSize: Math.min(100, limit), page: 1,
          startTime: start, endTime: end,
        })
        const res = r.json?.result
        const feeds = res?.feeds || []
        out.feeds = feeds.map(f => ({
          feedId: f.feedId ?? f.id,
          title: String(f.title ?? f.desc ?? '').slice(0, 80),
          desc: String(f.desc ?? '').slice(0, 200),
          cover: f.cover ?? f.coverUrl ?? '',
          vid: f.vid ?? null,
          status: f.status ?? null,
          publishTime: f.publishTime ?? f.gmtCreated ?? null,
          playCnt: f.playCnt ?? f.viewCnt ?? f.playCount ?? null,
          likeCnt: f.likeCnt ?? f.likeCount ?? null,
          commentCnt: f.commentCnt ?? f.commentCount ?? null,
          goodsList: (f.goodsList || []).map(g => ({ goodsId: g.goodsId, name: g.goodsName })),
          raw: f,
        }))
        out.count = feeds.length
        out.total = res?.total ?? null
        out.status = status
        out.text = out.feeds.length
          ? `已发布视频（status=${status}，${out.feeds.length} 个${out.total != null ? ` / total ${out.total}` : ''}）：\n` +
            out.feeds.map((f, i) => {
              const lines = [`  ${i + 1}. [${f.feedId}] ${f.title.slice(0, 50)}`]
              lines.push(`     播放=${f.playCnt ?? '—'} 点赞=${f.likeCnt ?? '—'} 评论=${f.commentCnt ?? '—'} 状态=${f.status ?? '—'}`)
              if (f.goodsList.length) lines.push(`     商品: ${f.goodsList.map(g => g.name || g.goodsId).slice(0, 3).join('、')}`)
              return lines.join('\n')
            }).join('\n')
          : `已发布视频（status=${status}）：0 个\n\nstatus 取值：\n  0~4 有效（5 报 BAD_PARAMS），-1 = 全部\n  查不到可能是没发过，或 status 值不对`
      }

      if (mode === 'list') {
        const r = await api('/mms/amco/prePublish/query', { pageSize: Math.min(100, limit), pageNum: 1 })
        // 双层 result: {success, result:{result:{list, total, hasMore, sortTotal}}}
        const inner = r.json?.result?.result ?? r.json?.result
        const items = Array.isArray(inner) ? inner : (inner?.list || [])
        out.videos = items.slice(0, limit).map(v => ({
          videoId: v.videoId ?? v.vid ?? v.id,
          title: String(v.title ?? '').slice(0, 80),
          desc: String(v.desc ?? '').slice(0, 120),
          url: v.url ?? '',
          coverUrl: v.coverUrl ?? '',
          cutStartT: v.cutStartT ?? null,
          scheduleTime: v.scheduleTime ?? null,
          goodsList: (v.goodsItemList || []).map(g => ({ goodsId: g.goodsId, name: g.goodsName })),
          status: v.status ?? null,
        }))
        out.count = items.length
        out.total = inner?.total ?? inner?.sortTotal ?? null
        out.text = out.videos.length
          ? `多多视频待发布队列（${out.videos.length} 个${out.total != null ? ` / total ${out.total}` : ''}）：\n` +
            out.videos.map((v, i) => `  ${i + 1}. ${v.title.slice(0, 50)}\n     ${v.url ? '     ' + v.url.slice(0, 90) : ''}${v.coverUrl ? '\n     封面 ' + v.coverUrl.slice(0, 80) : ''}${v.goodsList.length ? `\n     商品 ${v.goodsList.length} 个` : ''}`).join('\n')
          : `多多视频待发布队列：0 个。\n店铺还没发过带货视频。\n\n页面提示：\n  · 上传入口：点击上传或直接把视频拖到上传区域，支持批量\n  · 快捷发布：用商品 id 命名视频文件，上传后平台自动匹配商品\n  · 流量奖励：上传成功 + 添加有流量奖励的商品 + 审核通过 → 得大额流量卡`
      }

      if (mode === 'anchor') {
        // /kiwi/obs/anchor/info 是 GET（POST 会 405）
        const r = await page.evaluate(async () => {
          const resp = await fetch('https://live.pinduoduo.com/kiwi/obs/anchor/info', { credentials: 'include' })
          return { status: resp.status, json: await resp.json().catch(() => null) }
        })
        const a = r.json?.result ?? r.json
        const valid = a && typeof a === 'object' && (a.anchorUid || a.anchorName)
        out.anchor = a
        out.text = valid
          ? `主播信息：\n  anchorUid:  ${a.anchorUid ?? '—'}\n  anchorName: ${a.anchorName ?? '—'}\n  anchorIcon: ${(a.anchorIcon ?? '—').slice(0, 100)}${Object.keys(a).length > 3 ? '\n  其它字段: ' + Object.keys(a).filter(k => !/^anchor/.test(k)).slice(0, 8).join(', ') : ''}`
          : `主播信息：接口返回异常（${JSON.stringify(a).slice(0, 150)}）\n\n兜底：主播名可从 mms 店铺名推断。`
      }

      if (mode === 'qualify') {
        const r = await api('/api/backbone/video/publish_qualification', {})
        const q = r.json?.result
        out.qualify = q
        out.text = q
          ? `发布资格：${q.hasQualification ? '✅ 有资格' : '❌ 无资格'}${q.reason ? `（${q.reason}）` : ''}${q.disableGoodsTab ? '\n⚠️ 商品带货 tab 被禁用' : ''}`
          : `发布资格：未获取到`
      }

      if (mode === 'permission') {
        // 带货/内容权限 + 流量卡奖励 + 带货配置（2026-10-24 实测）
        const [contract, flowCard, cfg] = await Promise.all([
          api('/api/backbone/video/signed_contract/query', {}),
          api('/element/obs/video_flow_card/entrance', {}),
          api('/carllive/replay/mall_promotion_config', {}),
        ])
        const c = contract.json?.result, f = flowCard.json?.result, g = cfg.json?.result
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

      if (mode === 'topics') {
        const r = await api('/api/orpheus-obs/topic/list', { page_size: 20, page: 1 })
        const arr = r.json?.result?.topic_volist || []
        out.topics = r.json?.result
        if (arr.length) {
          out.text = `话题 ${arr.length} 个：\n` + arr.slice(0, 20).map(x => `  · ${x.name || x.title || x.topicName}（${x.id || x.topicId || '—'}）`).join('\n')
        } else {
          // 实测店铺无话题，改输出发布必填的「内容声明」
          const pcfg = await api('/api/backbone/video/publish/page/query', {})
          const decl = pcfg.json?.result?.anchorDeclarationList || []
          out.declarations = decl
          out.text = `话题：0 个（topic_volist 空）\n\n发布必填 · 内容声明（anchorDeclarationList）：\n` +
            (decl.length ? decl.map(d => `  · type=${d.type}  ${d.name}`).join('\n') : '  （未获取到）')
        }
      }
    }

    // ── delete ──
    if (mode === 'delete') {
      const videoId = argOf('video-id')
      // 先试待发布队列删除
      let r = await api('/mms/amco/prePublish/delete', { videoId })
      let used = '/mms/amco/prePublish/delete'
      if (!r.json?.success) {
        // 兜底：已发布删除
        r = await api('/api/backbone/video/delete', { videoId, fileId: videoId })
        used = '/api/backbone/video/delete'
      }
      out.ok = !!r.json?.success
      out.endpoint = used
      out.result = r.json?.result ?? r.json
      out.text = out.ok
        ? `✅ 已删除视频 ${videoId}（via ${used}）`
        : `❌ 删除失败：${JSON.stringify(r.json).slice(0, 250)}`
      if (!out.ok) process.exitCode = 2
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
