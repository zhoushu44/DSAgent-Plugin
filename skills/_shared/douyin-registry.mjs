/**
 * douyin-registry.mjs —— 抖音（抖店）接口注册表（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么要有这张表
 * ══════════════════════════════════════════════════════════════════
 * 现在每个 douyin-* 技能各自硬编码接口 path、自己拼参数、自己 goto 页面。
 * 平台改版时 16 个技能要改 16 遍，而且没人知道哪些接口实测过。
 *
 * 这张表把「域名 / 方法 / 路径 / 默认参数 / Referer / 判据」收敛到一处，
 * 并给每个接口打上 lastVerified 与 evidence —— 没实测过的接口明确标 pending，
 * 绝不让技能拿一个「猜的」接口去发请求。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ 核心事实（2026-11-11 实测，见 _douyin_node_probe/REPORT.md）
 * ══════════════════════════════════════════════════════════════════
 *   抖店（fxg.jinritemai.com）只读接口 **不校验 a_bogus**。
 *
 *   证据：同一订单 URL，带 a_bogus+verifyFp+fp+msToken → 10001010A「环境风险」
 *         剥掉以上全部 → st=0，539KB 数据。3 轮稳定复现。
 *
 *   → 所以本表里的接口**一律不带签名字段**。带了反而会被风控拒。
 *   → 签名在 query string 里，不在 header（与拼多多 Anti-Content 相反）。
 *
 * ══════════════════════════════════════════════════════════════════
 * 用法
 * ══════════════════════════════════════════════════════════════════
 *   import { API, PAGES, resolve } from './douyin-registry.mjs'
 *   const spec = resolve('goods.list')   // → { domain, method, path, query, referer, ... }
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'

/* ══════════════════════════════════════════════════════════════════
 * 域名表
 * ══════════════════════════════════════════════════════════════════ */
export const DOMAINS = {
  fxg: {
    origin: 'https://fxg.jinritemai.com',
    // 抖店商家后台：只读接口免签，cookie 走 .jinritemai.com
    signMode: 'none',
    cookieDomain: 'jinritemai',
    note: '抖店后台（已验证只读免签）',
  },
  qianchuan: {
    origin: 'https://qianchuan.jinritemai.com',
    signMode: 'unknown',
    cookieDomain: 'jinritemai',
    note: '千川推广（未验证，启停接口已知会 40002）',
  },
  creator: {
    origin: 'https://creator.douyin.com',
    signMode: 'a_bogus',
    cookieDomain: 'douyin',
    note: '内容创作平台（需要 a_bogus，必须页面内 fetch）',
  },
}

/* ══════════════════════════════════════════════════════════════════
 * 接口表
 * ──────────────────────────────────────────────────────────────────
 *   domain       域名 key
 *   method       GET / POST
 *   path         接口路径（不含域名，不含 query）
 *   query        默认 query 参数（调用时可覆盖）
 *   body         默认 body（POST 用）
 *   referer      必填，缺了部分接口返回 43001 类错误
 *   pick         (data) => 摘要，用于日志与自检（可选）
 *   verified     实测日期；null = 未验证，调用会被拒绝
 *   note         备注
 * ══════════════════════════════════════════════════════════════════ */
export const API = {
  /* ── 商品域（全部 verified 2026-11-11）────────────────────── */
  'goods.count': {
    domain: 'fxg', method: 'GET', path: '/product/tproduct/aggsProductCount',
    query: { appid: 1 }, referer: '/ffa/g/list',
    pick: (d) => ({ onsale: d?.onsale, draft: d?.draft, audit: d?.audit }),
    verified: '20261111', note: '商品各状态计数',
  },
  'goods.list': {
    domain: 'fxg', method: 'GET', path: '/product/tproduct/list',
    query: {
      page: 0, pageSize: 20, tab: 'onSale', business_type: 4, is_online: 1,
      from_mng: 1, check_status: 3, status: 0,
      need_auto_rectify_info: 'true', need_pay_no_stock_skus: 'true',
      order_field: 'audit_time', sort: 'desc', appid: 1,
    },
    referer: '/ffa/g/list',
    pick: (d) => ({ count: Array.isArray(d) ? d.length : null }),
    verified: '20261111', note: '商品列表（163KB）★主力接口',
  },
  'goods.categoryOptions': {
    domain: 'fxg', method: 'GET', path: '/product/tproduct/categoryOptionsN',
    query: { appid: 1 }, referer: '/ffa/g/list',
    pick: (d) => ({ count: Array.isArray(d) ? d.length : Object.keys(d || {}).length }),
    verified: '20261111', note: '类目选项树',
  },
  'goods.rectifyInfo': {
    domain: 'fxg', method: 'GET', path: '/product/tproduct/rectifyInfo',
    query: { need_first_check: 'true', appid: 1 }, referer: '/ffa/g/list',
    pick: (d) => d,
    verified: '20261111', note: '商品整改信息',
  },
  'goods.groupList': {
    domain: 'fxg', method: 'GET', path: '/product/tproduct/getProductGroupList',
    query: { pageSize: 100, appid: 1 }, referer: '/ffa/g/list',
    pick: (d) => ({ count: Array.isArray(d) ? d.length : null }),
    verified: '20261111', note: '商品分组（可能为空）',
  },
  'goods.shipDelayRule': {
    domain: 'fxg', method: 'GET', path: '/product/tproduct/getShopShipDelayRule',
    query: { appid: 1 }, referer: '/ffa/g/list',
    pick: (d) => ({ keys: Object.keys(d || {}).length }),
    verified: '20261111', note: '发货延迟规则',
  },
  'goods.banner': {
    domain: 'fxg', method: 'GET', path: '/product/tproduct/listBanner',
    query: { appid: 1 }, referer: '/ffa/g/list',
    pick: (d) => ({ keys: Object.keys(d || {}).length }),
    verified: '20261111', note: '商品页横幅提示',
  },
  'goods.excitation': {
    domain: 'fxg', method: 'GET', path: '/product/tproduct/queryExcitation',
    query: { appid: 1 }, referer: '/ffa/g/list',
    pick: (d) => ({ keys: Object.keys(d || {}).length }),
    verified: '20261111', note: '激励/任务查询',
  },
  'goods.freightTemplates': {
    domain: 'fxg', method: 'GET', path: '/freight/template/getFreightTemplateList',
    query: { appid: 1 }, referer: '/ffa/g/list',
    pick: (d) => ({ count: Array.isArray(d) ? d.length : null }),
    verified: '20261111', note: '运费模板列表',
  },

  /* ── 订单域（全部 verified 2026-11-11）────────────────────── */
  'order.list': {
    domain: 'fxg', method: 'GET', path: '/api/order/searchlist',
    query: { order: '', order_by: '', page: 0, pageSize: 10, source: '', tab: 'all', appid: 1 },
    referer: '/ffa/morder/order/list',
    pick: (d) => ({ count: Array.isArray(d) ? d.length : null, firstId: d?.[0]?.shop_order_id }),
    verified: '20261111', note: '订单列表（533KB）★主力接口',
  },
  'order.count': {
    domain: 'fxg', method: 'GET', path: '/api/order/tabcnt',
    query: { appid: 1, tab: 'all' }, referer: '/ffa/morder/order/list',
    pick: (d) => ({ keys: Object.keys(d || {}).length }),
    verified: '20261111', note: '订单各状态计数',
  },
  'order.notice': {
    domain: 'fxg', method: 'GET', path: '/api/order/getNotice',
    query: { appid: 1 }, referer: '/ffa/morder/order/list',
    pick: (d) => ({ got: d != null }),
    verified: '20261111', note: '订单通知',
  },

  /* ── 店铺域 ───────────────────────────────────────────────── */
  'shop.homepage': {
    domain: 'fxg', method: 'GET', path: '/pc/api/home/homepage',
    query: { appid: 1 }, referer: '/ffa/mshop/homepage',
    pick: (d) => ({ keys: Object.keys(d || {}).length }),
    verified: '20261111', note: '店铺首页概况（117KB，含 lay_out_data/cards_data/business_data）',
  },
  'shop.expScore': {
    domain: 'fxg', method: 'GET', path: '/governance/shop/experiencescore/getOverviewV10',
    query: { exp_version: 'v10' }, referer: '/ffa/eco/experience-score',
    pick: (d) => ({
      score: d?.grow_score_info?.grow_shop_score,
      yesterday: d?.grow_score_info?.grow_score_yesterday_info?.grow_score_yesterday,
      category: d?.category,
      shopOpenDays: d?.grow_score_info?.shop_open_days,
    }),
    verified: '20261111', note: '体验分总览（参数 exp_version）',
  },
  'shop.expScoreSub': {
    domain: 'fxg', method: 'GET', path: '/governance/shop/experiencescore/getSubScoreMetricsV10',
    query: { exp_version: 'v10' }, referer: '/ffa/eco/experience-score',
    pick: (d) => ({
      shopName: d?.shop_name,
      category: d?.category,
      metrics: (d?.grow_score_metric_info?.grow_score_metrics || []).length,
    }),
    verified: '20261111', note: '体验分子项指标（参数 exp_version）',
  },
  'shop.expScoreTrend': {
    domain: 'fxg', method: 'GET', path: '/governance/shop/experiencescore/getTrendByVersion',
    query: { trend_type: 1, time: 30, exp_version: 'v10' }, referer: '/ffa/eco/experience-score',
    pick: (d) => ({
      current: d?.experience_score,
      avg7: d?.recent_7_avg_score,
      avg14: d?.recent_14_avg_score,
      avg30: d?.recent_30_avg_score,
    }),
    verified: '20261111', note: '体验分趋势（参数 trend_type/time/exp_version）',
  },
  'shop.metrics': {
    domain: 'fxg', method: 'GET', path: '/byteshop/shop_util/mertrics',
    query: {}, referer: '/ffa/mshop/homepage',
    pick: (d) => (d && typeof d === 'object' ? Object.keys(d).length : d),
    verified: '20261111', note: '店铺指标（注意路径拼写就是 mertrics，不是 metrics）',
  },
  'order.afterSale': {
    domain: 'fxg', method: 'GET', path: '/api/order/searchlist',
    query: { order: '', order_by: '', page: 0, pageSize: 10, source: '', tab: 'aftersale', appid: 1 },
    referer: '/ffa/mshop/after_sale/list',
    pick: (d) => ({ count: Array.isArray(d) ? d.length : null }),
    verified: null, note: '售后列表（未实测：返回 723KB 但响应结构待确认）',
  },

  /* ── 营销 / 活动域（verified 2026-11-11）──────────────────────
   * ★ 重要区分（实测）：
   *   本账号 get_activity_gray = {enable:false, msg:"无该配置"}
   *   → 没有【平台活动报名】权限（大促/秒杀等官方活动）
   *   → 但有【自建营销工具】权限，24 个工具（单品直降/优惠券/满减/组合/裂变…）
   *   所以活动类技能应该查「营销工具」，不是「平台活动报名」。
   * ────────────────────────────────────────────────────────── */
  'marketing.tools': {
    domain: 'fxg', method: 'POST', path: '/marketing/pc/v1/common/get_marketing_homepage_tools',
    query: { from_platform: 1, appid: 1 }, body: '{}',
    referer: '/ffa/marketing/home',
    pick: (d) => ({ toolCates: (d?.tool_cates || []).length, toolCards: (d?.tool_cards || []).length }),
    verified: '20261111', note: '营销工具清单（24 个：单品直降/优惠券/满减/赠品/裂变…）',
  },
  'marketing.fullDiscount': {
    domain: 'fxg', method: 'GET', path: '/marketing/activity/v1/query_full_discount_activity',
    query: { activity_status: 0, page: 1, pageSize: 20, appid: 1 },
    referer: '/ffa/marketing/home',
    pick: (d) => ({ total: d?.total, page: d?.page, size: d?.size }),
    verified: '20261111', note: '满减/多件优惠活动列表（activity_status 0/1/2/-1 均返回 success）',
  },
  'marketing.promoData': {
    domain: 'fxg', method: 'GET', path: '/marketing/marketing_data/v1/query_promotion_data',
    query: { source_type: 1, date_type: 1, from_platform: 1, appid: 1 },
    referer: '/ffa/marketing/home',
    pick: (d) => ({ keys: Object.keys(d || {}), hasStats: !!d?.stats_data }),
    verified: '20261111', note: '营销推广数据（date_type 1/2/7/30 均可用，~4KB）',
  },
  'marketing.activityGray': {
    domain: 'fxg', method: 'GET', path: '/marketing/activity/v1/get_activity_gray',
    query: { from_platform: 1, appid: 1 },
    referer: '/ffa/marketing/home',
    pick: (d) => ({ enable: d?.enable, membership: d?.membership }),
    verified: '20261111', note: '★权限探针：enable=false 表示无平台活动报名权限',
  },

  /* ── 千川域（verified 2026-11-11）────────────────────────────
   * ★ 实测推翻旧结论：千川**只读接口一样免签**。
   *   同一接口三种方式（带签名 / 剥净签名 / 完全手工零参数）全部 code=0。
   *   旧文档「手工 fetch 一律 40002」→ 那是**业务参数缺失**（code=2），不是签名问题。
   *
   *   余额：23400 元（balanceInfos 按 advBalanceType 分组）
   *   计费单位：分 → 元（/100）
   * ────────────────────────────────────────────────────────── */
  'promo.balance': {
    domain: 'qianchuan', method: 'GET', path: '/ad/api/v1/account/finance/get-adv-balance',
    query: {}, referer: '/uni-prom',
    pick: (d) => {
      const b = d?.balanceInfos || {}
      const main = b['1'] || {}
      return {
        totalYuan: main.total != null ? Number(main.total) / 100 : null,
        validYuan: main.valid != null ? Number(main.valid) / 100 : null,
        types: Object.keys(b).length,
      }
    },
    verified: '20261111', note: '★广告余额（零参数可用，balanceInfos 按类型分组，单位分）',
  },
  'promo.userInfo': {
    domain: 'qianchuan', method: 'GET', path: '/ad/api/v1/account/user/info',
    query: {}, referer: '/uni-prom',
    pick: (d) => ({ userId: d?.userInfo?.userId, keys: Object.keys(d || {}).slice(0, 8) }),
    verified: '20261111', note: '账户信息（8.3KB：abInfo/shopInfo/userInfo/accountInfo/permissionInfo）',
  },
  'promo.customerId': {
    domain: 'qianchuan', method: 'GET', path: '/ad/api/v1/account/account-info/get-customer-id',
    query: {}, referer: '/uni-prom',
    pick: (d) => ({ hasDetail: !!d?.detail }),
    verified: '20261111', note: '客户 ID（3KB）',
  },
  'promo.chargeInfo': {
    domain: 'qianchuan', method: 'GET', path: '/ad/api/promotion/v1/activity/get_charge_info',
    query: {}, referer: '/uni-prom',
    pick: (d) => ({ canCharge: d?.canCharge, methods: (d?.chargeMethodList || []).length }),
    verified: '20261111', note: '充值信息（是否可充 / 充值方式）',
  },
  'promo.uniPromConfig': {
    domain: 'qianchuan', method: 'GET', path: '/ad/api/v1/account/user/get-whitelist',
    query: {}, referer: '/uni-prom',
    pick: (d) => ({
      visible: d?.uniPromVisible,
      createAuthEnable: d?.createAuthEnable,
      inAllowList: d?.hitUniPromAllowList,
      dataReportVisible: d?.dataReportVisible,
    }),
    verified: '20261111',
    note: '★权限来源（19.4KB）。注意：get_uni_prom_config 会偶发 status_code=2「获取全域推广计划配置报错」，不要用它',
  },
  'promo.planSummary': {
    domain: 'qianchuan', method: 'POST', path: '/ad/api/pmc/v1/uni-promotion/ad/list-summary',
    query: {}, referer: '/uni-prom',
    // ★ 必须带业务 body：空 body → code=2。以下为实测可用最简结构
    body: null,   // 由调用方动态构造（需要 aavid + 时间窗）
    pick: (d) => ({ totalNum: d?.totalNum, hasMetrics: !!d?.totalMetrics }),
    verified: '20261111', note: '★计划列表汇总（必须带 body：AdFilter+Metrics+aavid；空 body 报 code=2）',
  },
  'promo.statQuery': {
    domain: 'qianchuan', method: 'POST', path: '/ad/api/data/v1/common/statQuery',
    query: {}, referer: '/dataV3/roi2-material-analysis',
    body: null,
    pick: (d) => ({ hasStatsData: !!d?.StatsData, totalCount: d?.StatsData?.TotalCount }),
    verified: '20261111',
    note: '★报表查询。body 必须含 Filters.Conditions（5 条：advertiser_id/ecp_app_id/query_self_data/adlab_mode_fork/adlab_scene_fork）；'
      + 'ComparisonParams 可选。成功响应只有 status_code，没有 code/st。用 statQueryBody() 构造。',
  },
  'promo.analysisReport': {
    domain: 'qianchuan', method: 'POST', path: '/ad/api/data/v1/overview/getAnalysisReport',
    query: {}, referer: '/uni-prom',
    body: '{}',
    pick: (d) => ({ hasText: !!d?.report_text }),
    verified: '20261111', note: '经营分析报告（report_text）',
  },
  'promo.recentDate': {
    domain: 'qianchuan', method: 'GET', path: '/ad/api/data/agw/getReportRecentDate',
    query: {}, referer: '/uni-prom',
    verified: null, note: '报表可选最近日期（实测返回空 body，未确认）',
  },
  'promo.ongoingList': {
    domain: 'qianchuan', method: 'GET', path: '/ad/ocean/api/v1/promotion/getOngoingPromotionList',
    query: {}, referer: '/ad/promotion-v2',
    pick: (d) => ({ keys: d?.activitiesOfPromotion ? Object.keys(d.activitiesOfPromotion).length : 0 }),
    verified: '20261111',
    note: '★在投计划列表（`activitiesOfPromotion: {}` = 当前无在投计划，属正常）',
  },
  'promo.costLevel': {
    domain: 'qianchuan', method: 'GET', path: '/ad/api/v1/account/agw/finance/GetAdvCostLevelInfo',
    query: {}, referer: '/ad/promotion-v2',
    pick: (d) => d,
    verified: '20261111', note: '消耗层级信息（42B 小响应）',
  },
  'promo.forbidRoi': {
    domain: 'qianchuan', method: 'GET', path: '/ad/api/v1/account/getForbidRoi1AdInfo',
    query: {}, referer: '/ad/promotion-v2',
    pick: (d) => ({ isForbid: d?.isForbid, isBrand: d?.isBrand }),
    verified: '20261111', note: 'ROI1 投放限制（是否被禁 + 生效时间段）',
  },
  'promo.materialSource': {
    domain: 'qianchuan', method: 'GET', path: '/ad/api/data/v1/material/get_source_list_new',
    query: {}, referer: '/dataV3/roi2-material-analysis',
    pick: (d) => ({ video: (d?.video || []).length, image: (d?.image || []).length, carousel: (d?.carousel || []).length }),
    verified: '20261111', note: '素材来源（视频/图片/轮播，2.2KB）',
  },
  'promo.materialReport': {
    domain: 'qianchuan', method: 'POST', path: '/ad/api/data/v1/common/statQuery',
    query: {}, referer: '/dataV3/roi2-material-analysis',
    body: null,
    pick: (d) => ({ hasStatsData: !!d?.StatsData, metricCount: d?.StatsData?.Totals ? Object.keys(d.StatsData.Totals).length : 0 }),
    verified: '20261111',
    note: '★素材分析报表（roi2_video_material_analysis）。'
      + 'Conditions 只认 4 条：advertiser_id / marketing_goal / adlab_mode_fork / material_type；'
      + '**不能**用 statQueryBody 的 5 条（ecp_app_id + query_self_data 会触发「网络请求超时」）。'
      + '用 materialReportBody() 构造。',
  },
}

/* ══════════════════════════════════════════════════════════════════
 * 页面表（DOM 驱动型技能用，避免各技能硬编码 URL）
 * ══════════════════════════════════════════════════════════════════ */
export const PAGES = {
  'page.goodsList': { domain: 'fxg', url: 'https://fxg.jinritemai.com/ffa/g/list?tab=onSale' },
  'page.orderList': { domain: 'fxg', url: 'https://fxg.jinritemai.com/ffa/morder/order/list' },
  'page.shopHome': { domain: 'fxg', url: 'https://fxg.jinritemai.com/ffa/mshop/homepage' },
  'page.afterSale': { domain: 'fxg', url: 'https://fxg.jinritemai.com/ffa/mshop/after_sale/list' },
  'page.publish': { domain: 'fxg', url: 'https://fxg.jinritemai.com/ffa/g/create' },
  'page.promo': { domain: 'qianchuan', url: 'https://qianchuan.jinritemai.com/ad/promotion-v2' },
}

/* ══════════════════════════════════════════════════════════════════
 * 解析 / 工具
 * ══════════════════════════════════════════════════════════════════ */

/** 取接口 spec；不存在或未验证 → 抛错（绝不静默发一个猜的接口） */
export function resolve(name, { allowUnverified = false } = {}) {
  const spec = API[name]
  if (!spec) {
    const hint = Object.keys(API).filter((k) => k.includes(name.split('.')[1] || '')).slice(0, 8)
    throw new Error(`未知接口 "${name}"。相近：${hint.join(' / ') || '（无）'}`)
  }
  if (!spec.verified && !allowUnverified) {
    throw new Error(
      `接口 "${name}" 未实测（verified=null）。` +
      `确认可用后把 verified 填成日期；临时调用请传 { allowUnverified: true }。` +
      `备注：${spec.note || ''}`,
    )
  }
  const dom = DOMAINS[spec.domain]
  if (!dom) throw new Error(`接口 "${name}" 的 domain "${spec.domain}" 不在 DOMAINS 表里`)
  return { ...spec, origin: dom.origin, signMode: dom.signMode, cookieDomain: dom.cookieDomain }
}

/** 拼完整 URL（GET 用；POST 也把 query 带上，抖店有些接口 query+body 都要） */
export function buildUrl(spec, params = {}) {
  const q = { ...(spec.query || {}), ...params }
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue
    qs.set(k, String(v))
  }
  const s = qs.toString()
  return spec.origin + spec.path + (s ? '?' + s : '')
}

/* ══════════════════════════════════════════════════════════════════
 * 千川报表 body 构造器
 * ──────────────────────────────────────────────────────────────────
 * 实测（probe-17）：statQuery 的 Filters.Conditions 必须带 5 条，
 * 少一条就 `status_code: -1「请求未成功」`。
 * 把这 5 条固化在这里，技能层不用各自拼。
 * ══════════════════════════════════════════════════════════════════ */
export const STAT_QUERY_CONDITIONS = [
  { Field: 'advertiser_id', Operator: 7, Values: [] },      // 必填：广告主 ID（从 promo.userInfo 或 get-customer-id 取）
  { Field: 'ecp_app_id', Operator: 7, Values: ['1', '2'] },
  { Field: 'query_self_data', Operator: 7, Values: ['off'] },
  { Field: 'adlab_mode_fork', Operator: 7, Values: ['1'] },
  { Field: 'adlab_scene_fork', Operator: 7, Values: ['1'] },
]

/**
 * 构造 statQuery 的 body。
 * @param {object} o
 * @param {string} o.advertiserId  广告主 ID（必填）
 * @param {string} o.startDate     YYYY-MM-DD
 * @param {string} o.endDate       YYYY-MM-DD
 * @param {string[]} o.dimensions  默认 ['combined_homepage_ad_category']
 * @param {string[]} o.metrics     默认 ['stat_cost']
 * @param {string} o.dataSetKey    默认 'overall_home_cost_total_prom'
 * @param {boolean} o.withComparison  是否带环比（默认 false，实测可省）
 */
export function statQueryBody(o = {}) {
  const {
    advertiserId, startDate, endDate,
    dimensions = ['combined_homepage_ad_category'],
    metrics = ['stat_cost'],
    dataSetKey = 'overall_home_cost_total_prom',
    withComparison = false,
  } = o
  if (!advertiserId) throw new Error('statQueryBody 需要 advertiserId')
  if (!startDate || !endDate) throw new Error('statQueryBody 需要 startDate / endDate')

  const conditions = STAT_QUERY_CONDITIONS.map((c) =>
    c.Field === 'advertiser_id' ? { ...c, Values: [String(advertiserId)] } : { ...c },
  )
  const body = {
    StartTime: `${startDate} 00:00:00`,
    EndTime: `${endDate} 23:59:59`,
    DataSetKey: dataSetKey,
    Dimensions: dimensions,
    Metrics: metrics,
    Filters: { ConditionRelationshipType: 1, Conditions: conditions },
  }
  if (withComparison) {
    body.ComparisonParams = {
      RatioStartTime: `${startDate} 00:00:00`,
      RatioEndTime: `${endDate} 23:59:59`,
    }
  }
  return JSON.stringify(body)
}

/* ══════════════════════════════════════════════════════════════════
 * 素材分析报表 body 构造器（roi2_video_material_analysis）
 * ──────────────────────────────────────────────────────────────────
 * 实测（probe-19 / probe-20）：
 *   素材报表的 Filters **只有 4 条**，且字段名与通投报表完全不同：
 *     advertiser_id / marketing_goal / adlab_mode_fork / material_type
 *   若照搬 statQueryBody 的 ecp_app_id + query_self_data，
 *   服务端返回「网络请求超时」（其实是条件冲突，不是真超时）。
 *
 *   material_type: 3=视频素材（实测字段 100 个指标全部可用）
 *   marketing_goal: 2=推直播间 / 1=推商品
 * ══════════════════════════════════════════════════════════════════ */
export const MATERIAL_REPORT_METRICS = [
  // 消耗（3）
  'stat_cost_for_overall_roi2', 'stat_cost_for_roi2', 'basic_stat_cost_for_roi2_v2',
  // 成交（8）
  'total_prepay_and_pay_order_roi2', 'total_pay_order_gmv_include_coupon_for_roi2',
  'total_pay_order_count_for_roi2', 'total_cost_per_pay_order_for_roi2',
  'total_pay_order_gmv_for_roi2', 'total_pay_order_coupon_amount_for_roi2',
  'total_ecom_platform_subsidy_amount_for_roi2', 'total_unfinished_estimate_order_gmv_for_roi2',
  // 结算（11）
  'total_prepay_and_pay_settle_roi2_1h', 'total_order_settle_amount_for_roi2_1h',
  'total_order_settle_count_for_roi2_1h', 'total_cost_per_pay_order_settle_for_roi2_1h',
  'total_order_real_settle_amount_for_roi2_1h', 'total_order_settle_amount_rate_for_roi2_1h',
  'total_order_settle_count_rate_for_roi2_1h', 'total_refund_order_count_for_roi2_1h',
  'total_refund_order_gmv_for_roi2_1h_all', 'total_refund_order_gmv_for_roi2_1h_rate',
  'no_refund_ecom_coupon_amount_for_roi2', 'no_refund_ecom_platform_subsidy_amount_for_roi2',
  // 效率（2）
  'total_cpc_for_roi2', 'total_ecpm_for_roi2',
  // 视频质量与互动（10）—— 字段名取自 probe-19 抓包的真实 100 指标，**勿猜**
  'video_play_duration_2s_rate_for_roi2', 'video_play_duration_3s_rate_for_roi2',
  'video_play_duration_5s_rate_for_roi2', 'video_play_duration_10s_rate_for_roi2',
  'video_play_finish_rate_for_roi2_v2',      // ★ 完播率（不是 video_play_over_rate_for_roi2，那个不在数据集里）
  'video_play_count_for_roi2_v2',
  'video_like_count_for_roi2',
  'video_comment_count_for_roi2_v2',
  'video_follow_count_for_roi2',
  'video_avg_watch_duration_for_roi2',
]

/** 素材报表的 Dimensions（full 模式，11 个维度） */
export const MATERIAL_DIMENSIONS_FULL = [
  'material_type', 'material_name_v2', 'material_id', 'material_suggest_v2',
  'material_content_v2', 'material_image_mode_v2', 'material_suggest_reason_v2',
  'material_duration_v2', 'material_create_time_v2', 'material_source_v2', 'material_tag_list',
]

/** 精简维度（只要 id + 名称 + 内容） */
export const MATERIAL_DIMENSIONS_SLIM = ['material_name_v2', 'material_content_v2', 'material_id']

/**
 * 构造素材分析报表 body。
 * @param {object} o
 * @param {string} o.advertiserId   千川账户 ID（accountId，不是 customerId）
 * @param {string} o.startDate
 * @param {string} o.endDate
 * @param {number} [o.marketingGoal=2]  1=推商品 2=推直播间
 * @param {number} [o.materialType=3]   3=视频素材
 * @param {string[]} [o.metrics]        默认 MATERIAL_REPORT_METRICS
 * @param {string[]} [o.dimensions]     默认 MATERIAL_DIMENSIONS_SLIM
 */
export function materialReportBody(o = {}) {
  const {
    advertiserId, startDate, endDate,
    marketingGoal = 2,
    materialType = 3,
    metrics = MATERIAL_REPORT_METRICS,
    dimensions = MATERIAL_DIMENSIONS_SLIM,
  } = o
  if (!advertiserId) throw new Error('materialReportBody 需要 advertiserId')
  if (!startDate || !endDate) throw new Error('materialReportBody 需要 startDate / endDate')

  return JSON.stringify({
    StartTime: `${startDate} 00:00:00`,
    EndTime: `${endDate} 23:59:59`,
    refer: 'ecp',
    DataSetKey: 'roi2_video_material_analysis',
    Dimensions: dimensions,
    Metrics: metrics,
    Filters: {
      ConditionRelationshipType: 1,
      Conditions: [
        { Field: 'advertiser_id', Operator: 7, Values: [String(advertiserId)] },
        { Field: 'marketing_goal', Operator: 7, Values: [String(marketingGoal)] },
        { Field: 'adlab_mode_fork', Operator: 7, Values: ['1'] },
        { Field: 'material_type', Operator: 7, Values: [String(materialType)] },
      ],
    },
  })
}

/** 列出接口（自检 / 文档用） */
export function listApis({ onlyVerified = false } = {}) {
  return Object.entries(API)
    .filter(([, v]) => !onlyVerified || v.verified)
    .map(([name, v]) => ({
      name, domain: v.domain, method: v.method, path: v.path,
      verified: v.verified, note: v.note,
    }))
}

/** 健康检查：表结构自检（CI 用） */
export function validateTable() {
  const issues = []
  for (const [name, v] of Object.entries(API)) {
    if (!DOMAINS[v.domain]) issues.push(`${name}: domain "${v.domain}" 不存在`)
    if (!v.path?.startsWith('/')) issues.push(`${name}: path 必须以 / 开头`)
    if (!['GET', 'POST'].includes(v.method)) issues.push(`${name}: method 必须是 GET/POST`)
    if (!v.referer) issues.push(`${name}: 缺 referer（部分接口缺了会 43001）`)
    if (v.verified && !/^\d{8}$/.test(v.verified)) issues.push(`${name}: verified 应为 YYYYMMDD`)
  }
  return { ok: issues.length === 0, issues, total: Object.keys(API).length }
}

export default { DOMAINS, API, PAGES, resolve, buildUrl, listApis, validateTable, statQueryBody, STAT_QUERY_CONDITIONS }
