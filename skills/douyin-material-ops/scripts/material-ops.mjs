/**
 * material-ops.mjs —— 千川「素材」全流程（纯 Node HTTP，零浏览器）
 *
 * 子命令：
 *   list      素材清单（含 12 项投放指标）
 *   video     按 vid 查素材元信息（封面/时长/尺寸）
 *   add       添加素材到计划
 *   remove    从计划移除素材（自动 ForceDelete 兜底）
 *
 * ★ 全部走 HTTP，不启浏览器；cookie 从本地凭证库读。
 * ★ 写操作（add/remove）必须带 --confirm true 才真正提交。
 *
 * 用法：
 *   node material-ops.mjs --mode list   [--status 1|2|all]
 *   node material-ops.mjs --mode video  --vid <videoId>
 *   node material-ops.mjs --mode add    --vid <videoId> [--name "xxx.mp4"]
 *   node material-ops.mjs --mode remove --vid <videoId> [--mid <materialId>]
 */
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = process.env.DSAGENT_PLUGIN_ROOT || 'E:\\360MoveData\\Users\\Administrator\\Desktop\\DSAgent-Plugin'
const PURL = (p) => pathToFileURL(p).href
const OUT = join(HERE, '..', 'artifacts')
mkdirSync(OUT, { recursive: true })

const ORIGIN = 'https://qianchuan.jinritemai.com'
const AVID = process.env.QC_AVID || '1781536544329804'
const AD_ID = process.env.QC_AD_ID || ''
const PRODUCT_ID = process.env.QC_PRODUCT_ID || '3850111082890920369'
const AWEME = process.env.QC_AWEME || '1033987013478174'

/* ── 参数 ─────────────────────────────────────────────────── */
const argv = process.argv.slice(2)
const args = {}
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue
  const k = argv[i].slice(2)
  const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
  args[k] = v
}
const MODE = args.mode || 'list'
const CONFIRM = args.confirm === 'true'
const DRY = !CONFIRM
const ACCOUNT = args.account || ''

/* ── 输出协议 ─────────────────────────────────────────────── */
function emit(payload) {
  console.log('__DSAGENT_RESULT__' + JSON.stringify(payload))
}
function fail(kind, message, extra = {}) {
  emit({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })
  process.exit(0)
}

/* ── 凭证 ─────────────────────────────────────────────────── */
let CK = ''
try {
  const { CredentialStore } = await import(PURL(join(PLUGIN, 'lib', 'services', 'credential-store.js')))
  const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
  const list = store.listAccounts().filter((a) => a.platform === 'douyin_shop' && a.status !== 'invalid')
  if (!list.length) fail('not_bound', '未绑定「抖音小店」账号，请先在「账号连接」里添加。')
  let acc = list[0]
  if (ACCOUNT) {
    const hit = list.find((a) => a.shop_key === ACCOUNT)
    if (!hit) fail('bad_input', `找不到账号 ${ACCOUNT}，可用：${list.map((a) => a.shop_key).join(', ')}`)
    acc = hit
  } else if (list.length > 1) {
    fail('need_account_choice', '有多个 douyin_shop 账号，请用 --account 指定。', { candidates: list.map((a) => ({ shopKey: a.shop_key, shopName: a.shop_name || '' })) })
  }
  CK = Object.entries(acc.cookies || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${v}`).join('; ')
} catch (e) {
  fail('api_error', '读取凭证失败：' + String(e?.message || e).slice(0, 200))
}

/* ── HTTP ─────────────────────────────────────────────────── */
async function req(method, path, body) {
  const headers = {
    accept: 'application/json, text/plain, */*',
    origin: ORIGIN,
    referer: ORIGIN + '/uni-prom',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
    cookie: CK,
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const r = await fetch(ORIGIN + path, {
    method, headers, redirect: 'manual',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const t = await r.text()
  let j = null; try { j = JSON.parse(t) } catch { }
  const code = j?.code ?? j?.status_code
  return { status: r.status, code, msg: j?.msg || j?.message || '', data: j?.data, raw: t.slice(0, 400) }
}

/* ── 自动探查 adId / productId ───────────────────────────── */
let _adCtx = null
async function resolveAdContext() {
  if (_adCtx) return _adCtx
  const r = await req('POST', '/ad/api/pmc/v1/uni-promotion/ad/list-required', {
    aavid: AVID, _origin_ajax_: 1, UseNewChain: true,
    Params: {
      AdFilter: { AdlabScene: 0, MarGoal: 1, SmartBidType: 0, UniPromShopFilter: { UniPromShopView: 1 }, DataTimeRange: { StartTime: '2026-01-01 00:00:00', EndTime: '2026-12-31 23:59:59' } },
      PageParams: { Page: 1, PageSize: 50 }, ListAdsModules: [36, 7], Metrics: ['stat_cost_for_roi2'], SophonxDataSetKey: 'overall_roi_promotion_list_for_product',
    },
  })
  if (r.code !== 0) fail('api_error', '获取计划列表失败：' + r.msg, { code: r.code })
  const ads = r.data?.adInfos || []
  if (!ads.length) fail('bad_input', '该账户下没有全域投放计划，无法操作素材。')
  const ad = AD_ID ? (ads.find((a) => String(a.id) === String(AD_ID)) || ads[0]) : ads[0]
  const goods = r.data?.adGoodsMap?.[ad.id] || []
  const productId = PRODUCT_ID || goods[0]?.id || goods[0]?.productId || ''
  _adCtx = { adId: String(ad.id), adName: ad.name, adStatus: ad.adDeliveryName, productIds: goods.map((g) => String(g.id || g.productId)).filter(Boolean), productId }
  return _adCtx
}

/* ── 素材清单 ─────────────────────────────────────────────── */
const METRICS = [
  'product_show_count_for_roi2', 'product_click_count_for_roi2', 'product_cvr_rate_for_roi2', 'product_convert_rate_for_roi2',
  'stat_cost_for_roi2', 'total_pay_order_count_for_roi2', 'total_pay_order_gmv_include_coupon_for_roi2',
  'total_prepay_and_pay_order_roi2', 'total_cost_per_pay_order_for_roi2', 'total_pay_order_gmv_for_roi2',
  'product_ecpm_for_roi2', 'product_cpc_for_roi2',
]
const METRIC_LABEL = {
  product_show_count_for_roi2: '展现', product_click_count_for_roi2: '点击',
  product_cvr_rate_for_roi2: '点击率', product_convert_rate_for_roi2: '转化率',
  stat_cost_for_roi2: '消耗', total_pay_order_count_for_roi2: '订单',
  total_pay_order_gmv_include_coupon_for_roi2: '成交GMV', total_prepay_and_pay_order_roi2: 'ROI',
  total_cost_per_pay_order_for_roi2: '单均成本', total_pay_order_gmv_for_roi2: 'GMV',
  product_ecpm_for_roi2: 'CPM', product_cpc_for_roi2: 'CPC',
}
const STATUS_LABEL = { 1: '投放中', 2: '已删除' }

async function listMaterials(status = 'all') {
  const ctx = await resolveAdContext()
  const conds = [
    { Field: 'query_type', Operator: 7, Values: ['all'] },
    { Field: 'roi2_material_type_v3', Operator: 7, Values: ['1001'] },
    { Field: 'marketing_goal', Operator: 7, Values: ['1'] },
    { Field: 'roi2_material_video_type', Operator: 7, Values: ['2'] },
    { Field: 'ad_id', Operator: 7, Values: [ctx.adId] },
  ]
  if (String(status) !== 'all') conds.push({ Field: 'roi2_material_status', Operator: 7, Values: [String(status)] })

  // ★ 平台限制：时间跨度不能超过 180 天 → 取最近 179 天
  const pad = (n) => String(n).padStart(2, '0')
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const endD = new Date()
  const startD = new Date(endD.getTime() - 179 * 24 * 3600 * 1000)
  const START_TIME = `${fmt(startD)} 00:00:00`
  const END_TIME = `${fmt(endD)} 23:59:59`

  const r = await req('POST', '/ad/api/pmc/v1/uni-promotion/material/list-required?reqFrom=uni-prom-creative-tab-list', {
    DataSetKey: 'site_promotion_product_post_data_video',
    Metrics: METRICS,
    Filters: { ConditionRelationshipType: 1, Conditions: conds },
    StartTime: START_TIME,
    EndTime: END_TIME,
    PageParams: { Limit: 100, Offset: 0 },
    OrderBy: [{ Type: 2, Field: 'product_show_count_for_roi2' }],
    Dimensions: ['material_id', 'roi2_material_status', 'roi2_material_video_type', 'roi2_material_video_name',
      'roi2_material_video_play_info', 'material_tag_list', 'roi2_material_show_status',
      'roi2_material_show_status_reason', 'roi2_material_upload_time'],
    reqFrom: 'video-material-material-select-table',
  })
  if (r.code !== 0) return { ok: false, code: r.code, msg: r.msg }

  const rows = r.data?.statsData?.rows || []
  const materials = rows.map((x) => {
    const d = x.dimensions || {}
    let play = {}
    try { play = JSON.parse(d.roi2MaterialVideoPlayInfo?.value || '{}') } catch { }
    const met = {}
    for (const [k, v] of Object.entries(x.metrics || {})) {
      const snake = k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
      met[METRIC_LABEL[snake] || METRIC_LABEL[k] || k] = v?.valueStr ?? v?.value
    }
    return {
      mid: d.materialId?.value,
      vid: play.VideoId,
      name: d.roi2MaterialVideoName?.value,
      status: d.roi2MaterialStatus?.valueStr,
      statusCode: d.roi2MaterialStatus?.value,
      videoType: d.roi2MaterialVideoType?.valueStr,
      uploadTime: d.roi2MaterialUploadTime?.value,
      cover: play.CoverImage?.WebUrl || null,
      duration: play.VideoDuration ?? null,
      tags: d.materialTagList?.value,
      metrics: met,
    }
  })
  return { ok: true, ad: ctx, total: r.data?.statsData?.totalCount, materials }
}

/* ── 素材元信息 ───────────────────────────────────────────── */
async function getVideoInfo(vid) {
  const r = await req('GET', `/ad/api/creation/v1/material/get-video-play-info?vid=${encodeURIComponent(vid)}&supportFresh=1&aavid=${AVID}`)
  if (r.code !== 0) return { ok: false, code: r.code, msg: r.msg || '拿不到该 vid 的元信息（可能是别人的视频或已失效）' }
  const v = r.data?.video
  if (!v) return { ok: false, msg: '接口未返回 video' }
  const cover = v.imageUrl || {}
  return {
    ok: true, vid: v.itemId, duration: v.duration, width: v.width, height: v.height,
    imageMode: v.imageMode, coverUri: cover.uri, coverUrl: (cover.urlList || [])[0] || null,
    coverWidth: cover.width || v.width, coverHeight: cover.height || v.height,
  }
}

/* ── 添加素材 ─────────────────────────────────────────────── */
async function addMaterial({ vid, name }) {
  if (!vid) fail('bad_input', '缺少 --vid。请先用 --mode list 或视频库拿到 videoId。')
  const ctx = await resolveAdContext()
  if (!ctx.productId) fail('bad_input', '该计划下取不到商品 ID，无法添加素材。')

  const meta = await getVideoInfo(vid).catch(() => ({ ok: false }))

  // 绑定 owner：file_name 决定素材在列表里显示的名字
  const fileName = name || (meta.ok ? `素材_${Math.round((meta.duration || 0) * 10) / 10}s.mp4` : vid)
  const bind = await req('POST', '/ad/api/creation/material/bind-video-to-owner', { vids: [{ file_name: fileName, video_id: vid }] })
  if (bind.code !== 0) fail('api_error', '绑定素材失败：' + bind.msg, { code: bind.code })
  const mid = Object.values(bind.data?.vidToMidMap || {})[0] || null

  const videoMaterial = { videoId: vid, imageMode: meta.ok ? (meta.imageMode ?? 15) : 15, productId: ctx.productId }
  if (meta.ok && meta.coverUrl) {
    videoMaterial.coverImage = {
      ...(meta.coverUri ? { webUri: meta.coverUri } : {}),
      webUrl: meta.coverUrl,
      width: meta.coverWidth,
      height: meta.coverHeight,
    }
  }

  const body = {
    aggregateAID: ctx.adId,
    createMultiProductsCreative: [{
      productId: ctx.productId,
      createCreativeInfo: {
        proceduralCreative: {
          videoMaterial: [videoMaterial],
          titleMaterial: [{ title: name || ' 一次性茶杯带茶叶隐茶杯', isDynamic: false, usedWordList: [], materialSceneType: 0 }],
        },
      },
    }],
  }

  if (DRY) {
    return {
      ok: true, dryRun: true, mode: 'add', ad: ctx, mid, hasCover: !!videoMaterial.coverImage,
      preview: { vid, fileName, productId: ctx.productId }, body,
      text: `【添加素材 · 预览】\n  计划：${ctx.adName}（${ctx.adId}）\n  视频：${vid}\n  素材名：${fileName}\n  封面：${videoMaterial.coverImage ? '已带' : '无'}\n  商品：${ctx.productId}\n\n确认后加 --confirm true 才会真正提交。`,
    }
  }

  const r = await req('POST', '/ad/api/pmc/v1/uni-promotion/material/add-uni-prom-materials', body)
  if (r.code !== 0) return { ok: false, mode: 'add', code: r.code, msg: r.msg, text: `添加素材失败：${r.msg}（code=${r.code}）` }
  return {
    ok: true, mode: 'add', ad: ctx, mid, hasCover: !!videoMaterial.coverImage, vid, fileName,
    text: `✅ 素材已加入计划\n  计划：${ctx.adName}\n  素材名：${fileName}\n  素材ID：${mid}\n  视频ID：${vid}`,
  }
}

/* ── 移除素材 ─────────────────────────────────────────────── */
async function removeMaterial({ vid, mid }) {
  if (!vid) fail('bad_input', '缺少 --vid。')
  const ctx = await resolveAdContext()

  const mkBody = (force) => ({
    optType: 'delete',
    params: {
      AdID: ctx.adId,
      Vids: [vid],
      ...(mid ? { LegoMids: [mid], UseLegoMid: true } : {}),
      ...(force ? { ForceDelete: true } : {}),
    },
  })

  if (DRY) {
    return {
      ok: true, dryRun: true, mode: 'remove', ad: ctx,
      preview: { vid, mid }, body: mkBody(false), bodyForce: mkBody(true),
      text: `【移除素材 · 预览】\n  计划：${ctx.adName}（${ctx.adId}）\n  视频：${vid}\n  素材ID：${mid || '(未提供)'}\n\n注意：计划只剩这一条素材时会返回 4065，脚本会自动带 ForceDelete 重试。\n确认后加 --confirm true 才会真正提交。`,
    }
  }

  let r = await req('POST', '/ad/api/pmc/v1/uni-promotion/material/set-opt', mkBody(false))
  let forced = false
  if (r.code !== 0 && (r.code === 4065 || /至少需要一个视频/.test(r.msg))) {
    forced = true
    r = await req('POST', '/ad/api/pmc/v1/uni-promotion/material/set-opt', mkBody(true))
  }
  if (r.code !== 0) return { ok: false, mode: 'remove', code: r.code, msg: r.msg, forced, text: `移除素材失败：${r.msg}（code=${r.code}）` }
  return {
    ok: true, mode: 'remove', ad: ctx, vid, mid, forced,
    text: `✅ 素材已从计划移除\n  计划：${ctx.adName}\n  视频：${vid}${forced ? '\n  （计划仅剩这一条素材，已用 ForceDelete 强制删除）' : ''}`,
  }
}

/* ── 素材审核状态 ─────────────────────────────────────────── */
const AUDIT_LABEL = { 1: '未审核', 2: '审核中', 3: '审核通过', 4: '审核拒绝' }
async function materialStatus({ mid }) {
  if (!mid) fail('bad_input', '缺少 --mid。')
  const ctx = await resolveAdContext()
  const today = new Date()
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const r = await req('POST', '/ad/api/pmc/v1/uni-promotion/material/list-optional?reqFrom=uni-prom-creative-tab-list&aavid=' + AVID, {
    ObjectType: 1, ObjectID: AWEME, LegoMidList: [mid],
    OptionalModules: ['audit_info_module', 'block_info_module', 'product_info_module', 'video_suggest_module',
      'material_heat_operation_virtual_module', 'repair_content_module', 'roi2_material_show_status', 'audit_suggest_module'],
    MaterialType: 3, MarGoal: 1, AggregateAid: ctx.adId,
    StartTime: `${ymd} 00:00:00`, EndTime: `${ymd} 23:59:59`,
  })
  if (r.code !== 0) return { ok: false, code: r.code, msg: r.msg }
  const m = (r.data?.materialInfoMap || {})[mid] || {}
  return {
    ok: true, mid, auditCode: m.materialAuditStatus, audit: AUDIT_LABEL[m.materialAuditStatus] || '?',
    isDel: m.isDel, isFrozen: m.isFrozen, hasAuditSuggest: m.hasAuditSuggest,
    text: `素材 ${mid}：审核 ${AUDIT_LABEL[m.materialAuditStatus] || '?'}，已删除=${m.isDel}，冻结=${m.isFrozen}\n（注意：该接口的 audit 字段与 UI 可能不一致，以页面显示为准）`,
  }
}

/* ── 分发 ─────────────────────────────────────────────────── */
try {
  let out
  switch (MODE) {
    case 'list': out = await listMaterials(args.status || 'all'); break
    case 'video': out = await getVideoInfo(args.vid); break
    case 'add': out = await addMaterial({ vid: args.vid, name: args.name || args.title }); break
    case 'remove': out = await removeMaterial({ vid: args.vid, mid: args.mid }); break
    case 'status': out = await materialStatus({ mid: args.mid }); break
    default: fail('bad_input', `未知 mode：${MODE}。可用：list / video / add / remove / status`)
  }
  if (out && out.ok && !out.text) {
    const n = out.materials?.length ?? 0
    out.text = MODE === 'list'
      ? `素材清单（${out.ad?.adName || ''}）：共 ${out.total ?? n} 条\n` + (out.materials || []).map((m, i) =>
        `  ${i + 1}. ${m.name}\n     素材ID ${m.mid}｜${m.status}｜${m.videoType}｜上传 ${m.uploadTime}\n     消耗 ${m.metrics?.消耗 ?? '-'}｜GMV ${m.metrics?.['成交GMV'] ?? '-'}｜ROI ${m.metrics?.ROI ?? '-'}｜点击率 ${m.metrics?.点击率 ?? '-'}`).join('\n')
      : JSON.stringify(out).slice(0, 800)
  }
  if (out && !out.ok && !out.text) {
    out.text = `操作失败：${out.msg || ''}（code=${out.code ?? '?'}）`
    out.failureKind = out.failureKind || 'api_error'
  }
  emit(out)
} catch (e) {
  fail('api_error', '素材操作异常：' + String(e?.message || e).slice(0, 300))
}
