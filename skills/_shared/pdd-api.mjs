/**
 * pdd-api.mjs —— 拼多多接口注册表 + 统一请求层（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 设计目标（2026-11-05）
 * ══════════════════════════════════════════════════════════════════
 * **PDD 升级时只改这个文件，skill 一行不动。**
 *
 * 要实现这点，必须把下面这些「平台知识」全部从 skill 里搬到基座：
 *
 *   ① 接口路径      —— 平台改版最爱改的东西（/vodka/v2/... → /vodka/v3/...）
 *   ② 请求头拼装    —— Anti-Content / VerifyAuthToken / Content-Type
 *   ③ 签名范围判定  —— 哪些接口要签名、哪些不要（pdd-sign-scope）
 *   ④ 错误码归因    —— 54001 / 40002 / 43001 / 54003 / 310120000
 *   ⑤ 节流与冷却    —— pdd-guard / pdd-antiban
 *   ⑥ 响应解包      —— result / data / success 三种形态
 *
 * skill 里只保留「业务语义」：调哪个接口（用逻辑名）、传什么业务参数、怎么解释结果。
 *
 * ══════════════════════════════════════════════════════════════════
 * 怎么用
 * ══════════════════════════════════════════════════════════════════
 *   import { api, API } from '../_shared/pdd-api.mjs'
 *
 *   // 旧写法（skill 里硬编码路径 + 自己拼头）
 *   const resp = await fetch('https://mms.pinduoduo.com/vodka/v2/mms/query/sku/info', {
 *     method:'POST', credentials:'include',
 *     headers: { 'Content-Type':'application/json', 'Anti-Content': ac, VerifyAuthToken: vt },
 *     body: JSON.stringify({ goodsId })
 *   })
 *
 *   // 新写法
 *   const r = await api(page, 'goods.skuInfo', { goodsId })
 *   if (r.ok) console.log(r.data)
 *
 * 平台升级时：只改 API 表里的 path，skill 不动。
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const load = (f) => import(pathToFileURL(path.join(HERE, f)).href)

/* ══════════════════════════════════════════════════════════════════
 * 一、接口注册表
 * ══════════════════════════════════════════════════════════════════
 * key 是**逻辑名**（skill 用这个），value 是平台细节（基座维护）。
 * PDD 改版时只改这里的 path / method / domain。
 *
 * 字段：
 *   path     接口路径（相对 origin）
 *   method   POST / GET
 *   domain   可选，默认 mms.pinduoduo.com
 *   note     备注（改版时对照用）
 *   lastSeen 最近一次从线上 bundle 确认的版本（便于识别过期）
 */
export const API = {
  /* ── 商品（vodka / glide）────────────────────────────────── */
  // ★ 2026-11-07 纯 Node 实测可用（10 个）：
  //   goods.listGlide / goods.skuInfo / goods.batchOnSale / goods.count
  //   goods.copyedExist / goods.newStyleGray / common.status
  //   shop.info(earth) / shop.flow(sydney) / chance.home(opportunity-goods)
  // ⚠️ goods.list(mall/goodsList) 对当前账号被单接口限制，用 listGlide 替代
  'goods.list': { path: '/vodka/v2/mms/query/display/mall/goodsList', method: 'POST', note: '商品列表', lastSeen: '20261101' },
  // ★ 2026-11-07：glide 商品列表（实测纯 Node 0as 可通，返回 total=14）
  //   与 goods.list 是两套接口：goods.list 走 vodka 分页查询，这个走 glide 商品属性域
  'goods.listGlide': { path: '/glide/v2/mms/addProperties/goodsList', method: 'POST', note: '商品列表（glide）', lastSeen: '20261107' },
  // ★ 2026-11-07：纯 Node 验证可通的轻量接口
  'goods.count': { path: '/vodka/v2/mms/query/display/mall_goods/count', method: 'POST', note: '商品总数', lastSeen: '20261107' },
  'goods.copyedExist': { path: '/vodka/v2/mms/query/display/goods_copyed/is_exist', method: 'POST', note: '商品是否被复制', lastSeen: '20261107' },
  'goods.newStyleGray': { path: '/vodka/v2/mms/newStyleGoods/gray/queryNewStyleGoodsGray', method: 'POST', note: '新版商品灰度', lastSeen: '20261107' },
  'common.status': { path: '/vodka/v2/mms/common/query/status', method: 'POST', note: '通用状态查询', lastSeen: '20261107' },
  // ★ 2026-11-07 实测：参数名必须是 goodsId（驼峰），goods_id / goods_sn 都报 3000000
  'goods.skuInfo': { path: '/vodka/v2/mms/query/sku/info', method: 'POST', note: '单商品 SKU 详情（参数 goodsId）', lastSeen: '20261107' },
  'goods.onSale': { path: '/vodka/v2/mms/pc/onSale', method: 'POST', note: '上架', lastSeen: '20261101' },
  'goods.offSale': { path: '/vodka/v2/mms/pc/offSale', method: 'POST', note: '下架', lastSeen: '20261101' },
  // ★ 2026-11-07 实测：goodsIds: [123] 可通，返回 1000000
  'goods.batchOnSale': { path: '/vodka/v2/mms/batchOnSale', method: 'POST', note: '批量上架（参数 goodsIds[]）', lastSeen: '20261107' },
  'goods.batchOffSale': { path: '/vodka/v2/mms/batchOffSale', method: 'POST', note: '批量下架', lastSeen: '20261101' },
  'goods.batchStock': { path: '/vodka/v2/mms/edit/quantity/batchIncrease', method: 'POST', note: '批量改库存（增量）', lastSeen: '20261101' },
  'goods.resourceValidate': { path: '/vodka/v2/mms/pc/resourceValidate', method: 'POST', note: '上下架前置校验', lastSeen: '20261101' },
  'goods.commitOnShop': { path: '/glide/v2/mms/query/commit/on_shop/detail', method: 'POST', note: '已上架商品详情', lastSeen: '20261101' },
  'goods.commitCreateBySn': { path: '/glide/v2/mms/edit/commit/create_by_sn', method: 'POST', note: '按货号建草稿', lastSeen: '20261101' },
  'goods.commitDelete': { path: '/glide/v2/mms/edit/commit/delete', method: 'POST', note: '删草稿', lastSeen: '20261101' },
  'goods.commitEdit': { path: '/glide/mms/goodsCommit/action/edit', method: 'POST', note: '整单落草稿', lastSeen: '20261101' },
  'goods.commitSubmit': { path: '/glide/v2/mms/edit/commit/submit', method: 'POST', note: '提交上架', lastSeen: '20261101' },
  'goods.commitUpdate': { path: '/glide/v2/mms/edit/commit/update', method: 'POST', note: '更新已上架商品', lastSeen: '20261101' },

  /* ── 店铺 / 经营（sydney）────────────────────────────────── */
  'shop.info': { path: '/earth/api/mallInfo/commonMallInfo', method: 'GET', note: '店铺基础信息', lastSeen: '20261101' },
  'shop.flow': { path: '/sydney/api/mallScore/queryMallFlowData', method: 'POST', note: '↪ 已重定向到实测可用接口（新名 getMallFlowData 报 2000000 无权限）', aliasOf: 'shop.legacyFlow', lastSeen: '20261105' },
  'shop.flowOverview': { path: '/sydney/api/mallFlow/queryMallFlowOverView', method: 'POST', note: '流量总览', lastSeen: '20261101' },
  'shop.dsr': { path: '/sydney/api/mallDsr/dsrResult', method: 'POST', note: 'DSR 评分', lastSeen: '20261101' },
  'shop.score': { path: '/sydney/api/mallScore/queryMallScoreOverView', method: 'POST', note: '↪ 已重定向到实测可用接口（新名 getMallScore 报 43001）', aliasOf: 'shop.legacyScore', lastSeen: '20261105' },
  'shop.goodsOverview': { path: '/sydney/api/goodsDataShow/queryGoodsPageOverviewForMms', method: 'POST', note: '↪ 已重定向到实测可用接口（新名 queryGoodsPageOverView 报 2000000）', aliasOf: 'shop.legacyGoodsOverview', lastSeen: '20261105' },
  'shop.goodsDetailVO': { path: '/sydney/api/goodsDataShow/queryGoodsDetailVOList', method: 'POST', note: '商品明细列表', lastSeen: '20261101' },
  'shop.goodsSpanDate': { path: '/sydney/api/goodsDataShow/queryGoodsSpanDateList', method: 'POST', note: '商品区间数据', lastSeen: '20261101' },

  /* ── 推广（venus / poseidon / reinhardt）──────────────────── */
  'promo.list': { path: '/mms-gateway/venus/api/goods/promotion/v3/list', method: 'POST', domain: 'yingxiao', note: '推广列表', lastSeen: '20261101' },
  'promo.detail': { path: '/mms-gateway/venus/api/goods/promotion/detail/query', method: 'POST', domain: 'yingxiao', note: '推广详情', lastSeen: '20261101' },
  'promo.updateMaxCost': { path: '/mms-gateway/venus/api/goods/promotion/update/max/cost', method: 'POST', domain: 'yingxiao', note: '改日限额', lastSeen: '20261101' },
  'promo.updateBid': { path: '/mms-gateway/venus/api/promotion/batchUpdateBid', method: 'POST', domain: 'yingxiao', note: '改出价/投产比', lastSeen: '20261101' },
  'promo.batchCreate': { path: '/mms-gateway/venus/api/promotion/batchCreate', method: 'POST', domain: 'yingxiao', note: '建推广', lastSeen: '20261101' },
  'promo.updateStatus': { path: '/mms-gateway/venus/api/global/unit/batchUpdateStatus', method: 'POST', domain: 'yingxiao', note: '启停单元', lastSeen: '20261101' },
  'promo.delete': { path: '/mms-gateway/venus/api/goods/promotion/virtual/delete', method: 'POST', domain: 'yingxiao', note: '删推广', lastSeen: '20261101' },
  'promo.accountAll': { path: '/mms-gateway/reinhardt/homepage/v3/accountAll', method: 'POST', domain: 'yingxiao', note: '账户汇总', lastSeen: '20261101' },
  'promo.entityReport': { path: '/mms-gateway/poseidon/api/report/queryEntityReport', method: 'POST', domain: 'yingxiao', note: '报表', lastSeen: '20261101' },
  'promo.dailyCost': { path: '/mms-gateway/reinhardt/invoice/getAdvertiserDailyCosts', method: 'POST', domain: 'yingxiao', note: '每日消耗', lastSeen: '20261101' },

  /* ── 活动（lakemms / leekmms）────────────────────────────── */
  'act.list': { path: '/lakemms/activityGoods/list', method: 'POST', note: '报名记录', lastSeen: '20261101' },
  'act.statics': { path: '/lakemms/activityGoods/statics', method: 'POST', note: '活动统计', lastSeen: '20261101' },
  'act.effectData': { path: '/lakemms/data_board/query/activity_effect_data', method: 'POST', note: '活动效果', lastSeen: '20261101' },
  'act.cancelEnroll': { path: '/lakemms/activityGoods/cancelEnroll', method: 'POST', note: '取消报名', lastSeen: '20261101' },
  'act.enrollPopups': { path: '/leekmms/activity/query/enrollPopups', method: 'POST', note: '报名弹窗', lastSeen: '20261101' },
  'act.lowPriceCheck': { path: '/lakemms/activityGoods/lowPriceCheckV3', method: 'POST', note: '低价校验', lastSeen: '20261101' },
  'act.enroll': { path: '/lakemms/enrollV2', method: 'POST', note: '提交报名', lastSeen: '20261101' },

  /* ── 机会商品（opportunity-goods）────────────────────────── */
  'chance.home': { path: '/opportunity-goods/chance-goods/home_list', method: 'POST', note: '机会商品主列表', lastSeen: '20261028' },
  'chance.my': { path: '/opportunity-goods/chance-goods/my_list', method: 'POST', note: '我的机会商品', lastSeen: '20261028' },
  'chance.cateInfo': { path: '/opportunity-goods/chance-goods/cate_info', method: 'POST', note: '类目信息', lastSeen: '20261028' },

  /* ── 视频（live 域）──────────────────────────────────────── */
  'video.list': { path: '/mms/amco/prePublish/query', method: 'POST', domain: 'live', note: '待发布视频', lastSeen: '20261030' },
  'video.query': { path: '/api/backbone/video/query', method: 'POST', domain: 'live', note: '视频列表', lastSeen: '20261030' },
  'video.publish': { path: '/api/backbone/video/publish', method: 'POST', domain: 'live', note: '发布视频', lastSeen: '20261030' },
  /* ── 补充：各 skill 实际在用（2026-11-05 全量审计补齐）──────── */
  'promo.adGroups': { path: '/mms-gateway/venus/api/goods/promotion/listAdGroupInfo', method: 'POST', domain: 'yingxiao', note: '推广广告组列表', lastSeen: '20261101' },

  /* ★ 2026-11-05 新增：发布同款链路 + 详情（从 chance.bcbbcdc7.chunk 逆向） */
  'chance.quickRelease': { path: '/opportunity-goods/chance-goods/quick_release', method: 'POST', note: '发布同款-创建草稿（★写操作）', lastSeen: '20261105' },
  'chance.keywordsRecommend': { path: '/opportunity-goods/chance-goods/get_keywords_recommend', method: 'POST', note: '商机热词推荐', lastSeen: '20261105' },
  'chance.getHotSearchGoods': { path: '/opportunity-goods/chance-goods/get_hot_search_goods', method: 'POST', note: '热搜词关联商品', lastSeen: '20261105' },
  'chance.totalInfo': { path: '/opportunity-goods/chance-goods/total_info', method: 'POST', note: '机会商品总览（商家数）', lastSeen: '20261105' },

  'chance.base': { path: '/opportunity-goods/chance-goods', method: 'POST', note: '机会商品基址（各子接口前缀）', lastSeen: '20261028' },
  'chance.collection': { path: '/opportunity-goods/chance-goods/collection/list', method: 'POST', note: '收藏列表', lastSeen: '20261028' },
  'chance.missionInfo': { path: '/opportunity-goods/chance-goods/mission_info', method: 'POST', note: '任务信息', lastSeen: '20261028' },
  'chance.filters': { path: '/opportunity-goods/chance-goods/get_filters', method: 'POST', note: '筛选项', lastSeen: '20261028' },
  'chance.defaultCategory': { path: '/opportunity-goods/chance-goods/default_category', method: 'POST', note: '默认类目', lastSeen: '20261028' },

  'video.mallDiagnosis': { path: '/api/backbone/goods/mall/diagnosis_and_suggest', method: 'POST', domain: 'live', note: '商品诊断建议', lastSeen: '20261030' },
  'video.weeklyReport': { path: '/api/backbone/goods/mall/weekly_report', method: 'POST', domain: 'live', note: '周报', lastSeen: '20261030' },
  'video.statsOverview': { path: '/api/backbone/goods/stats/overview', method: 'POST', domain: 'live', note: '数据总览', lastSeen: '20261030' },
  'video.statsTrend': { path: '/api/backbone/goods/stats/trend', method: 'POST', domain: 'live', note: '数据趋势', lastSeen: '20261030' },
  'video.publishPage': { path: '/api/backbone/video/publish/page/query', method: 'POST', domain: 'live', note: '发布页查询', lastSeen: '20261030' },
  'video.publishQualification': { path: '/api/backbone/video/publish_qualification', method: 'POST', domain: 'live', note: '发布资格', lastSeen: '20261030' },
  'video.signedContract': { path: '/api/backbone/video/signed_contract/query', method: 'POST', domain: 'live', note: '签约状态', lastSeen: '20261030' },
  'video.topicList': { path: '/api/orpheus-obs/topic/list', method: 'POST', domain: 'live', note: '话题列表', lastSeen: '20261030' },
  'video.prePublishDelete': { path: '/mms/amco/prePublish/delete', method: 'POST', domain: 'live', note: '删除待发布', lastSeen: '20261030' },
  'video.videoFlowCard': { path: '/element/obs/video_flow_card/entrance', method: 'POST', domain: 'live', note: '视频流量卡入口', lastSeen: '20261030' },
  'video.replayPromotionCfg': { path: '/carllive/replay/mall_promotion_config', method: 'POST', domain: 'live', note: '回放推广配置', lastSeen: '20261030' },
  'video.anchorInfo': { path: '/kiwi/obs/anchor/info', method: 'GET', domain: 'live', note: '主播信息', lastSeen: '20261030' },

  /* ── AI 视频（banner-intelligent）────────────────────────── */
  'aivideo.genVideo': { path: '/api/banner-intelligent/smartTool/video/genVideo', method: 'POST', note: '生成视频', lastSeen: '20261105' },
  'aivideo.getResult': { path: '/api/banner-intelligent/smartTool/video/getResult', method: 'POST', note: '取生成结果', lastSeen: '20261105' },
  'aivideo.available': { path: '/api/banner-intelligent/smartTool/video/available', method: 'POST', note: '可用额度', lastSeen: '20261105' },
  'aivideo.getStatus': { path: '/api/banner-intelligent/smartTool/video/get/status', method: 'POST', note: '任务状态', lastSeen: '20261105' },

  /* ★ 2026-11-05 A/B 实测纠正：下面 4 个才是在用的！
     曾经以为它们是「旧别名」、新名才是现行 —— 实测反了：
     旧名全部 OK（1000000），新名全部失败（2000000 / 43001）。
     结论：不要改名。
     保留在此仅为兼容；新代码请用 shop.goodsDetailVO / shop.goodsOverview / shop.flow / shop.score。 */
  'shop.legacyGoodsDetailVO': { path: '/sydney/api/goodsDataShow/queryGoodsDetailVOListForMMS', method: 'POST', note: '✅现行可用（2026-11-05 A/B 实测）', lastSeen: '20261105' },
  'shop.legacyGoodsOverview': { path: '/sydney/api/goodsDataShow/queryGoodsPageOverviewForMms', method: 'POST', note: '✅现行可用（2026-11-05 A/B 实测 OK）', lastSeen: '20261105' },
  'shop.legacyFlow': { path: '/sydney/api/mallScore/queryMallFlowData', method: 'POST', note: '✅现行可用（2026-11-05 A/B 实测 OK）', lastSeen: '20261105' },
  'shop.legacyScore': { path: '/sydney/api/mallScore/queryMallScoreOverView', method: 'POST', note: '✅现行可用（2026-11-05 A/B 实测 OK）', lastSeen: '20261105' },
}

/** 域名 → origin */
const ORIGINS = {
  mms: 'https://mms.pinduoduo.com',
  yingxiao: 'https://yingxiao.pinduoduo.com',
  live: 'https://live.pinduoduo.com',
}


/* ══════════════════════════════════════════════════════════════════
 * 页面路由表（DOM 驱动型 skill 用）
 * ══════════════════════════════════════════════════════════════════
 * pdd-publish-http / pdd-link-matrix 不发 API 请求，而是打开页面点 DOM，
 * 由页面自己发请求。它们依赖的是**页面 URL**，同样会随 PDD 改版变化，
 * 所以也收进基座。
 */
export const PAGES = {
  'page.goodsList': { url: 'https://mms.pinduoduo.com/goods/goods_list', note: '商品列表', lastSeen: '20261101' },
  'page.goodsAdd': { url: 'https://mms.pinduoduo.com/goods/goods_add/index', note: '商品发布页', lastSeen: '20261101' },
  'page.promoOverview': { url: 'https://yingxiao.pinduoduo.com/mains/promotionOverview', note: '推广总览', lastSeen: '20261101' },
  'page.actIndex': { url: 'https://mms.pinduoduo.com/act/index?SourceType=MMSActicon', note: '营销活动首页', lastSeen: '20261101' },
  'page.actRecords': { url: 'https://mms.pinduoduo.com/act/register_record', note: '报名记录', lastSeen: '20261101' },
  'page.sycmEvaluation': { url: 'https://mms.pinduoduo.com/sycm/evaluation', note: '店铺评分页', lastSeen: '20261101' },
  'page.sycmGoodsEffect': { url: 'https://mms.pinduoduo.com/sycm/goods_effect', note: '商品效果页', lastSeen: '20261101' },
  'page.videoHome': { url: 'https://live.pinduoduo.com/n-creator/video/home?from=mms', note: '多多视频主页', lastSeen: '20261030' },
  'page.chanceList': { url: 'https://mms.pinduoduo.com/goods/goods_list/chance', note: '机会商品页', lastSeen: '20261028' },
  'page.promoList': { url: 'https://yingxiao.pinduoduo.com/goods/promotion/list', note: '推广列表页', lastSeen: '20261101' },
  'page.promoReport': { url: 'https://yingxiao.pinduoduo.com/goods/report/promotion/overView', note: '推广报表页', lastSeen: '20261101' },
}

/** 取页面 URL */
export function pageUrl(name) {
  const s = PAGES[name]
  if (!s) throw new Error('页面注册表缺少: ' + name)
  return s.url
}

/* ══════════════════════════════════════════════════════════════════
 * 二、统一请求
 * ══════════════════════════════════════════════════════════════════ */

/**
 * @param {object} page            puppeteer page（在页面上下文发请求，自动带 Cookie）
 * @param {string} name            接口逻辑名（API 表的 key）
 * @param {object} [body]          业务参数
 * @param {object} [opts]
 * @param {object} [opts.guard]     pdd-guard 实例（有则做节流 + 错误归因）
 * @param {object} [opts.account]   ★ 纯 Node 通道：{ cookies, localStorage, referer?, userAgent? }
 *                                  传了就完全不开浏览器（/vodka/ /glide/ 可用）
 *                                  不传则走原来的浏览器通道（page.evaluate）
 * @param {string} [opts.shopKey]
 * @param {boolean} [opts.raw]      true = 返回原始响应体，不做 result 解包
 * @param {object} [opts.extraHeaders] 极少数接口需要的额外头
 * @returns {Promise<{ok, ec, data, raw, status, failureKind}>}
 */
export async function api(page, name, body = {}, opts = {}) {
  const spec = API[name]
  if (!spec) {
    return { ok: false, ec: 'unknown-api', failureKind: 'config_error', data: null, raw: null, status: 0,
      hint: `API 表里没有「${name}」，可用：${Object.keys(API).slice(0, 8).join(', ')}…` }
  }

  const domainKey = spec.domain || 'mms'
  const origin = ORIGINS[domainKey] || ORIGINS.mms
  const url = origin + spec.path

  // ① 节流（有 guard 才做）
  if (opts.guard?.beforeCall) {
    const pre = await opts.guard.beforeCall(url)
    if (!pre.allow) {
      return { ok: false, ec: 'blocked', failureKind: 'rate_limit', data: null, raw: null, status: 0, hint: pre.reason }
    }
  }

  // ② 拿签名头（全部由基座决定，skill 不碰）
  const { signPlan, getVerifyAuthToken, READ_CAPTCHA_COOKIE_FN } = await loadSign()
  const plan = signPlan(url)
  let anti = ''
  let vtk = ''

  // ══════════════════════════════════════════════════════════════════
  // ★ 2026-11-07：Node 优先，浏览器兜底
  // ══════════════════════════════════════════════════════════════════
  //   有 account（含 cookies + seed）→ 先走纯 Node
  //   纯 Node 失败（54001/签名无效）→ 自动降级到浏览器（如果 page 可用）
  //
  //   性能：纯 Node 120~330ms，浏览器 28000ms
  //   适用：/vodka/ /glide/ 已实测稳定；推广域不稳定，会自动降级
  const canPureNode = !!opts.account?.cookies && plan.headerAnti
  const hasBrowser = !!page
  let pureNode = canPureNode
  let nodeFailReason = ''

  if (pureNode) {
    try {
      const vs = await load('pdd-vodka-signer.mjs')
      const seed = opts.account.localStorage || (await load('pdd-seed-store.mjs')).readSeed(opts.shopKey || '')?.localStorage || {}
      anti = await vs.sign({
        cookies: opts.account.cookies || {},
        localStorage: seed,
      })
      if (!anti || !anti.startsWith('0as')) {
        nodeFailReason = `签名生成异常（${anti ? anti.slice(0, 6) : '空'}）`
        pureNode = false
      }
    } catch (e) {
      nodeFailReason = `签名器异常：${String(e.message).slice(0, 60)}`
      pureNode = false
    }
  } else if (plan.headerAnti) {
    anti = await getAntiContent(page, origin)
  }

  // VerifyAuthToken 只在浏览器通道可用（需要页面 cookie 操作）
  if (!pureNode && opts.shopKey) {
    try { vtk = await getVerifyAuthToken(page, opts.shopKey) } catch { /* ignore */ }
  }

  // ③ 组装 body（crawlerInfo 由 plan.bodyCrawlerInfo 决定，不是无脑加）
  const finalBody = (plan.bodyCrawlerInfo && anti) ? { ...body, crawlerInfo: anti } : body

  // ④ 发请求（Node 优先，失败自动降级浏览器）
  let res
  let usedChannel = 'browser'

  if (pureNode) {
    usedChannel = 'node'
    res = await (async () => {
      const cookieStr = Object.entries(opts.account.cookies || {})
        .map(([k, v]) => `${k}=${v}`).join('; ')
      const hd = buildHeaders(anti, vtk, plan, opts.extraHeaders)
      const headers = {}
      for (const [k, v] of Object.entries(hd)) headers[k.toLowerCase()] = v
      headers['origin'] = origin
      headers['referer'] = opts.account.referer || 'https://mms.pinduoduo.com/goods/goods_list'
      headers['user-agent'] = opts.account.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'
      headers['cookie'] = cookieStr
      headers['accept'] = headers['accept'] || 'application/json, text/plain, */*'
      try {
        const resp = await fetch(url, {
          method: spec.method,
          headers,
          ...(spec.method === 'GET' ? {} : { body: JSON.stringify(finalBody || {}) }),
        })
        const text = await resp.text()
        let json = null
        try { json = JSON.parse(text) } catch { /* 非 JSON */ }
        return { status: resp.status, json, text: text.slice(0, 500) }
      } catch (e) {
        return { status: 0, json: null, err: String(e).slice(0, 120) }
      }
    })()

    // ★ 降级判断：Node 通道返回 54001（签名不被接受）且浏览器可用 → 切浏览器重试
    const nodeEc = Number(res.json?.error_code ?? res.json?.errorCode ?? 0)
    const nodeOk = res.json?.success === true || nodeEc === 1000000
    const nodeRisk = nodeEc === 54001 || nodeEc === 54003
    if (!nodeOk && nodeRisk && hasBrowser) {
      nodeFailReason = `Node 签名被拒（ec=${nodeEc}），降级浏览器`
      usedChannel = 'browser'
      anti = await getAntiContent(page, origin)
      if (opts.shopKey) { try { vtk = await getVerifyAuthToken(page, opts.shopKey) } catch { } }
      const fbBody = (plan.bodyCrawlerInfo && anti) ? { ...body, crawlerInfo: anti } : body
      res = await page.evaluate(async (u, m, hd, bd) => {
        try {
          const resp = await fetch(u, {
            method: m, credentials: 'include', headers: hd,
            ...(m === 'GET' ? {} : { body: JSON.stringify(bd || {}) }),
          })
          const text = await resp.text()
          let json = null
          try { json = JSON.parse(text) } catch { /* 非 JSON */ }
          return { status: resp.status, json, text: text.slice(0, 500) }
        } catch (e) {
          return { status: 0, json: null, err: String(e).slice(0, 120) }
        }
      }, url, spec.method, buildHeaders(anti, vtk, plan, opts.extraHeaders), fbBody)
    }
  } else {
    res = await page.evaluate(async (u, m, hd, bd) => {
      try {
        const resp = await fetch(u, {
          method: m,
          credentials: 'include',
          headers: hd,
          ...(m === 'GET' ? {} : { body: JSON.stringify(bd || {}) }),
        })
        const text = await resp.text()
        let json = null
        try { json = JSON.parse(text) } catch { /* 非 JSON */ }
        return { status: resp.status, json, text: text.slice(0, 500) }
      } catch (e) {
        return { status: 0, json: null, err: String(e).slice(0, 120) }
      }
    }, url, spec.method, buildHeaders(anti, vtk, plan, opts.extraHeaders), finalBody)
  }

  // ⑤ 错误归因（统一口径）
  const { normalize } = await loadErr()
  const ec = Number(res.json?.error_code ?? res.json?.errorCode ?? 0)
  const success = res.json?.success === true || ec === 1000000

  if (opts.guard?.afterCall) {
    try { await opts.guard.afterCall(url, res.json) } catch { /* ignore */ }
  }

  const n = normalize({ ec: success ? null : ec, json: res.json }, name)
  const tr = await transportMod()
  const suggestedTier = tr?.pickTier ? tr.pickTier(url) : null

  return {
    ok: success,
    ec: success ? null : ec,
    suggestedTier,
    channel: usedChannel,          // 'node' | 'browser' —— 排查用
    nodeFallback: nodeFailReason,  // Node 失败原因（成功则为空）
    status: res.status,
    failureKind: success ? '' : n.failureKind,
    data: success ? unwrap(res.json, opts.raw) : null,
    raw: res.json,
    hint: success ? '' : (n.text || '').slice(0, 200),
  }
}

function buildHeaders(anti, vtk, plan, extra) {
  const h = { 'Content-Type': 'application/json' }
  if (plan.headerAnti && anti) h['Anti-Content'] = anti
  if (vtk) h['VerifyAuthToken'] = vtk
  return { ...h, ...(extra || {}) }
}

/** 响应解包：兼容 result / data 两种外壳 */
function unwrap(json, raw) {
  if (raw) return json
  if (!json || typeof json !== 'object') return json
  if ('result' in json) return json.result
  if ('data' in json) return json.data
  return json
}

/* ══════════════════════════════════════════════════════════════════
 * 三、Anti-Content 统一获取
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 取 Anti-Content（三种来源按可靠性排序）
 *   ① pdd-mode2 的 getAntiContent（fbeZ 模块生成真签名，最准）
 *   ② 页面 hook 拿到的 __sigPair.anti（页面自己刚发的请求）
 *   ③ window.__AC（如果有）
 *
 * @param {object} page
 * @param {string} origin
 * @returns {Promise<string>}
 */
export async function getAntiContent(page, origin = ORIGINS.mms) {
  // ① 真签名（lib/pdd-mode2 里的 fbeZ 模块方案）
  try {
    const mode2 = await import(pathToFileURL('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/lib/pdd-mode2.js').href)
    if (mode2?.getAntiContent) {
      const r = await mode2.getAntiContent(page, { force: true })
      if (r?.data) return r.data
      if (typeof r === 'string' && r) return r
    }
  } catch { /* 落到下面 */ }

  // ② 页面 hook 的签名
  try {
    const v = await page.evaluate(() => {
      const p = window.__sigPair
      if (p?.anti) return p.anti
      if (window.__AC?.v) return window.__AC.v
      return ''
    })
    if (v) return v
  } catch { /* ignore */ }

  return ''
}

// ★ 2026-11-05：通道选择统一由 pdd-transport 决定（按接口前缀，不靠 skill 猜）
let _transport = null
async function transportMod() {
  if (!_transport) _transport = await load('pdd-transport.mjs').catch(() => null)
  return _transport
}

async function loadSign() {
  const m = await load('pdd-sign-scope.mjs')
  const g = await load('pdd-guard.mjs')
  return { signPlan: m.signPlan, getVerifyAuthToken: g.getVerifyAuthToken, READ_CAPTCHA_COOKIE_FN: g.READ_CAPTCHA_COOKIE_FN }
}
async function loadErr() {
  return load('pdd-error.mjs')
}

/** 列出生效的接口名（排查用） */
export function listApis(prefix = '') {
  return Object.keys(API).filter(k => k.startsWith(prefix)).sort()
}

/** 校验 API 表完整性（改版后自查） */
export function validateTable() {
  const bad = []
  for (const [k, v] of Object.entries(API)) {
    if (!v.path || !v.path.startsWith('/')) bad.push(`${k}: path 非法`)
    if (!['GET', 'POST'].includes(v.method)) bad.push(`${k}: method 非法`)
    if (v.domain && !ORIGINS[v.domain]) bad.push(`${k}: domain 未注册（${v.domain}）`)
    // ★ 2026-11-05：aliasOf 校验 —— 别名必须指向存在的 key，且 path 必须一致
    //   否则「重定向」只是写了个注释，实际还打旧路径，等于没改。
    if (v.aliasOf) {
      const target = API[v.aliasOf]
      if (!target) bad.push(`${k}: aliasOf 指向的 key 不存在（${v.aliasOf}）`)
      else if (target.path !== v.path) bad.push(`${k}: aliasOf 的 path 不一致（${v.path} ≠ ${target.path}）`)
      else if (target.aliasOf) bad.push(`${k}: aliasOf 不能链式指向另一个别名（${v.aliasOf}）`)
    }
  }
  return { ok: bad.length === 0, bad, total: Object.keys(API).length }
}

export default { api, API, PAGES, pageUrl, getAntiContent, listApis, validateTable, ORIGINS }
