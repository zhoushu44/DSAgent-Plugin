/**
 * 拼多多 Anti-Content 注入范围（唯一权威）
 *
 * 来源：线上 bundle 原文
 *   · 商家后台  alljs/mms_site/mms_static_mms_umdkits_umd_kits_api_Service.cdf406f6.v20261101171751_c69eb52d.js
 *               @147300（数组 le，162 条） + @159490（isCrawlerInfoRequired）
 *   · 推广域    alljs/yx/ad-static_mains__next_static_chunks_msfe-9d32834f5061ec2a.js
 *               @529922（eO 排除表 + eA 判定）@530955（Anti-Content 注入点）
 * 知识库：平台/entities/拼多多签名注入范围与接口白名单.md
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 最重要的一条（2026-11-04 真机证伪后修正）
 * ══════════════════════════════════════════════════════════════════
 * 平台有【两个互相独立】的条件，作用在【两个不同的东西】上，绝不能合并：
 *
 *   ① isCrawlerInfoRequired(url)  判据 = 162 条【路径前缀】白名单
 *        → 只控制 body 里的 crawlerInfo 字段
 *        → 源码：Service.cdf406f6@147300（数组 le）+ @159490（le.some(indexOf)）
 *
 *   ② shouldAddAntiHeader(url) / L(url)  判据 = 【域名】正则
 *        → 控制请求头 Anti-Content
 *        → 源码：Service.cdf406f6@134946
 *          L(e) = A(e) || I.test(e) || B.test(e) || D.test(e)
 *          I = /https?:\/\/(mms|ims|ipp|jubao|topen-api|shuyuan|imsapi|open-api|
 *                jinbao|open|fuwu|cashier|mcashier|mai|dmp|icube|wb|pifa|
 *                take-api|chat-mock).+?\.(com|net)/
 *          B = /https?:\/\/test(ing|2)\.hutaojie/
 *          D = /https?:\/\/(apiv2\.hutaojie|api\.pinduoduo)\.com/
 *
 * 真机反证（2026-11-04，账号 d105b9）：
 *   · POST /vodka/v2/mms/query/display/mall/goodsList
 *     不在 162 白名单 → crawlerInfo 不注入；但域名 mms.pinduoduo.com 命中 I →
 *     **Anti-Content 头仍然必须带**。我把它整个关掉后 → 直接 54001 captcha。
 *   · POST /sydney/api/mallDsr/dsrResult（在 162 白名单内，域名也命中）→ 200 OK。
 *
 * 结论：**只要域名是 mms.pinduoduo.com，Anti-Content 头就一定要带**；
 *       162 白名单只决定「body 里要不要多塞一个 crawlerInfo」。
 *       真正能"纯 HTTP 不打签名"的，只有非 pdd 业务域名（CDN / 第三方）。
 *
 * 推广域（yingxiao）是另一套：msfe-9d32834f@529922 的 eA() 判定，
 * 默认全加，排除 apiv2.hutaojie / api.pinduoduo。
 */

/** 商家后台 Anti-Content 前缀白名单（162 条，顺序与 bundle 一致，便于逐条比对） */
export const ANTI_CONTENT_WHITELIST = [
  "/apollo/",
  "api/merchant/directOld4NewMall",
  "api/mobile/sendVerificationCode",
  "auth",
  "earth/api/merchant/getCaptchaCode",
  "earth/api/mobile/sendVerifyMobileCode",
  "earth/api/mobile/checkAndSendVerificationCode",
  "earth/api/sendSms/refundAddress/sendModifyAfterSalesMobileVerificationCodeV2",
  "glide/mms/goodsCommit/action/edit",
  "glide/v2/mms/edit/commit/submit",
  "glide/v2/mms/edit/commit/update",
  "vodka/v2/mms/pc/offSale",
  "vodka/v2/mms/batchOffSale",
  "vodka/v2/mms/pc/onSale",
  "vodka/v2/mms/batchOnSale",
  "vodka/v2/mms/antiRisk/verify",
  "janus/api/getCaptchaCode",
  "mars/mobile/queryMobileByAfterSaleId",
  "mars/mobile/queryMobileByOrderSn",
  "mars/shop/orders/export/task/add",
  "sydney/api/afterSale/inSaleQualityWhiteList",
  "sydney/api/afterSale/inWhiteList",
  "sydney/api/dailyMallGoods/consultVisit",
  "sydney/api/dailyMallGoods/consultVisitList",
  "sydney/api/dailyMallGoods/dailyReport",
  "sydney/api/dailyMallGoods/readyDate",
  "sydney/api/dailyMallGoods/redDot",
  "sydney/api/goodsDataShow/activityGoodsList",
  "sydney/api/goodsDataShow/detailList",
  "sydney/api/goodsDataShow/goodsDateOverview",
  "sydney/api/goodsDataShow/mallSales",
  "sydney/api/goodsDataShow/maxSoldQuantity",
  "sydney/api/goodsDataShow/moduleShow",
  "sydney/api/goodsDataShow/noGoods",
  "sydney/api/goodsDataShow/overview",
  "sydney/api/goodsDataShow/overviewList",
  "sydney/api/goodsDataShow/readyDate",
  "sydney/api/goodsDataShow/spanDaysDetailList",
  "sydney/api/healthCheck",
  "sydney/api/mallDsr/dsrResult",
  "sydney/api/mallFlow/getMallFlowData",
  "sydney/api/mallFlow/getMallVisitPayPercent",
  "sydney/api/mallFlow/inWhiteList",
  "sydney/api/mallFlow/readyDate",
  "sydney/api/mallInfo/inWhiteList",
  "sydney/api/mallInfo/mallAttention",
  "sydney/api/mallInfo/mallAttentionPercent",
  "sydney/api/mallInfo/mallVisitPay",
  "sydney/api/mallInfo/mallVisitPayAttention",
  "sydney/api/mallInfo/mallVisitPayAttentionList",
  "sydney/api/mallInfo/mallVisitPayPercent",
  "sydney/api/mallInfo/readyDate",
  "sydney/api/mallSms/querySmsSendList",
  "sydney/api/mallSms/querySmsTotalSendCount",
  "sydney/api/recommendCategory/checkGoodsBlackGrayList",
  "sydney/api/recommendCategory/hasChangedCate2IdList",
  "sydney/api/recommendCategory/inWhiteList",
  "sydney/api/recommendCategory/interestedCategoryList",
  "sydney/api/recommendCategory/modifyInterestedCategory",
  "sydney/api/recommendCategory/queryCate1Name",
  "sydney/api/recommendCategory/queryCate2IdName",
  "sydney/api/recommendCategory/recommendCategoryList",
  "sydney/api/recommendCategory/recommendCount",
  "sydney/api/recommendCategory/recommendGoodsByCate2IdList",
  "sydney/api/recommendCategory/recommendGoodsRandom",
  "sydney/api/recommendCategory/searchCategoryList",
  "sydney/api/saleQuality/getReadyDate",
  "sydney/api/saleQuality/querySaleQualityDetailInfo",
  "sydney/api/saleQuality/querySaleQualityList",
  "sydney/api/userInfo",
  "sydney/api/mallDsr/queryDsrResult",
  "venus/api/",
  "earth/api/user/check/mobileNoBound",
  "janus/api/user/check/mobileNoBound",
  "earth/api/user/validateMallExists",
  "earth/api/user/validateMallExistsAndBankAccount",
  "janus/api/user/modifyPasswordByUsername",
  "earth/api/OpenPlatformMMS/sendVerificationCode",
  "sydney/api/coupon/queryTopThreeRatio",
  "sydney/api/coupon/readyDate",
  "sydney/api/coupon/queryMfbOverView",
  "sydney/api/coupon/queryMfbDateList",
  "sydney/api/coupon/queryCouponActivityStatus",
  "sydney/api/coupon/queryCouponDetailList",
  "sydney/api/coupon/queryCouponOrderList",
  "sydney/api/coupon/queryCouponSum",
  "janus/api/mobile/sendVerificationCode",
  "janus/api/mobile/sendVerificationCode/noLogin",
  "janus/api/user/getLoginVerificationCode",
  "sydney/api/mallInfo/mallPayList",
  "sydney/api/mallInfo/mallTradeFlowRT",
  "sydney/api/cateStatis/cateFlowChart",
  "sydney/api/cateStatis/cateFlowComp",
  "sydney/api/goodsInfo/guvPv",
  "sydney/api/base/getAllCate",
  "sydney/api/base/getMallCate",
  "sydney/api/coupon/couponDailyList",
  "sydney/api/coupon/couponConfigList",
  "sydney/api/mallScore/getMallScore",
  "sydney/api/hotWord/queryHotWord",
  "/sydney/api/mallFlow/queryMallFlowOverView",
  "/sydney/api/mallFlow/queryMallFlowOverViewReadyTime",
  "/sydney/api/mallFlow/queryMallFlowWhiteList",
  "/sydney/api/mallFlow/queryMallFlowOverViewList",
  "/earth/api/user/openPlatformBindMobile",
  "api/lich/",
  "/sydney/api/mallInfo/queryMallDataPageOverView",
  "/sydney/api/mallInfo/queryMallDataPageOverViewList",
  "/sydney/api/mallInfo/queryMallDataPageReadyTime",
  "/sydney/api/mallInfo/queryMallDataPageWhiteList",
  "/sydney/api/mallScore/queryMallConfigurationList",
  "/sydney/api/mallScore/submitConfigurationList",
  "/sydney/api/mallInfo/queryStatisticsTrend",
  "/sydney/api/goodsDataShow/queryGoodsPageRT",
  "/sydney/api/goodsDataShow/queryGoodsPageOverView",
  "/sydney/api/mallScore/queryMallConfigurationExist",
  "/sydney/api/goodsDataShow/queryGoodsPagePlnOstList",
  "/sydney/api/goodsDataShow/queryGoodsDetailList",
  "/sydney/api/goodsDataShow/queryGoodsPageOverViewReadyDate",
  "/sydney/api/goodsDataShow/queryGoodsDetailVOListWhiteList",
  "/sydney/api/goodsDataShow/queryGoodsDetailVOList",
  "/sydney/api/goodsDataShow/queryMallNewCreateGoods",
  "/sydney/api/goodsDataShow/queryGoodsSpanDateList",
  "/sydney/api/goodsDataShow/queryGoodsReadyDate",
  "/sydney/api/goodsDataShow/queryMallGoodsBillBoard",
  "/sydney/api/saleQuality/queryMallDsrReadyDate",
  "/sydney/api/saleQuality/queryMallDsrVO",
  "/sydney/api/saleQuality/queryMallDsrVOList",
  "/sydney/api/saleQuality/queryGoodsEvaluateVO",
  "/sydney/api/saleQuality/queryGoodsEvaluateDetailVOList",
  "/sydney/api/saleQuality/inWhiteList",
  "/sydney/api/activity/queryMallActivityGoodsList",
  "/sydney/api/activity/queryMallActivityTypeList",
  "/sydney/api/activity/readyDate",
  "/sydney/api/activity/queryMallActivityOverView",
  "earth/api/sendSms/sendOpenPlatformVerificationCode",
  "earth/api/sendSms/sendBackupMobileVerificationCode",
  "earth/api/sendSms/mallClose/sendOffGoodsVerificationCode",
  "earth/api/sendSms/mallClose/sendMallCloseVerificationCode",
  "earth/api/sendSms/sendOpenNewMallVerificationCode",
  "earth/api/sendSms/refundAddress/sendModifyAfterSalesMobileVerificationCode",
  "earth/api/sendSms/refundAddress/sendRefundMobileVerificationCode",
  "solvay/api/post/add",
  "solvay/api/reply/comment/add",
  "solvay/api/post/reply/add",
  "antis/api/sendSms/refundAddress/sendRefundMobileVerificationCode",
  "/mars/shop/recentOrderList",
  "/mars/shop/historyOrderList",
  "/mars/shop/historyOrders/export/task/add",
  "/mars/shop/recentOrders/export/task/add",
  "solvay/api/post/edit",
  "/janus/api/applyModifyBoundMobile",
  "/janus/api/createModifyMobileApplication",
  "/mars/mobile/queryBehalfMobileByOrderSn",
  "/earth/api/sendSms/sendDisagreeProtocolVerificationCode",
  "/pop/service/outsourcing/account/change/phone",
  "/pop/service/order/outsourcing/account/change/password",
  "pascal/api/",
  "/maryland/api/medicine/queryExportList",
  "/maryland/api/medicine/export",
  "/maryland/api/medicine/queryDownloadList",
  "/maryland/api/medicine/download"
]

/** 推广域排除表：命中这两个域名不加 Anti-Content（msfe eO） */
const YX_EXCLUDE_RE = /(apiv2\.hutaojie|api\.pinduoduo)\.com/

/**
 * mms 侧 Anti-Content 头的域名白名单 —— 注意这是【域名】不是路径，
 * 与 162 条路径白名单完全是两回事。原文：Service.cdf406f6@134946 的 I 正则。
 */
const MMS_ANTI_HOST_RE = /https?:\/\/(mms|ims|ipp|jubao|topen-api|shuyuan|imsapi|open-api|jinbao|open|fuwu|cashier|mcashier|mai|dmp|icube|wb|pifa|take-api|chat-mock).+?\.(com|net)/
const MMS_TEST_HOST_RE = /https?:\/\/test(ing|2)\.hutaojie(.+?)?\.com/
const MMS_EXCLUDE_HOST_RE = /https?:\/\/(apiv2\.hutaojie|api\.pinduoduo)\.com/
/**
 * ★ 我方额外加固（平台原文没有这条，但语义上必须加）：
 *   平台的 I 正则用 `(mms|...).+?\.(com|net)`，会把 mms-static.pddpic.com
 *   也判为命中（"mms" + "-static.pddpic" + ".com"）。平台自己的 SDK 从不用
 *   fetch 拉静态资源（走 <script>），所以它不受影响；但我们的 pdd-http 可能被
 *   误传 CDN 地址，给 CDN 带签名纯属浪费且暴露签名频次，故显式排除静态域。
 */
const MMS_STATIC_HOST_RE = /https?:\/\/[^/]*(mms-static|commimg|static|img)\.[^/]*pddpic\.com/

/** 兼容旧名 */
const LEGACY_HOST_RE = MMS_ANTI_HOST_RE

/** 取 URL 的 pathname（保留前导 /），无协议也能处理 */
function toPath (url) {
  if (!url) return ''
  try {
    if (/^https?:\/\//i.test(url)) return new URL(url).pathname
  } catch { /* ignore */ }
  const q = url.indexOf('?')
  return q >= 0 ? url.slice(0, q) : url
}

function isRelative (url) {
  if (!url) return false
  return !(/^https?:\/\//i.test(url) || /^\/\//.test(url))
}

/**
 * 商家后台：是否需要注入【body.crawlerInfo】
 * 语义：162 条路径前缀 indexOf 匹配（子串，不是 startsWith）
 * @param {string} url 完整 URL 或相对 path
 * @returns {boolean}
 */
export function needCrawlerInfo (url) {
  const p = toPath(url)
  if (!p) return false
  return ANTI_CONTENT_WHITELIST.some(prefix => p.indexOf(prefix) > -1)
}

/**
 * 商家后台：是否需要注入【header Anti-Content】
 * 语义：域名正则（不是路径！）。相对路径一律视为 mms 同源 → 需要。
 * @param {string} url
 * @returns {boolean}
 */
export function needAntiContentMms (url) {
  if (!url) return false
  if (MMS_EXCLUDE_HOST_RE.test(url)) return false
  if (MMS_STATIC_HOST_RE.test(url)) return false   // 见 MMS_STATIC_HOST_RE 注释：我方加固
  return isRelative(url) || MMS_ANTI_HOST_RE.test(url) || MMS_TEST_HOST_RE.test(url)
}

/**
 * 推广域：该 URL 是否需要 Anti-Content 签名
 * 语义：默认全加，排除 apiv2.hutaojie / api.pinduoduo
 * @param {string} url
 * @returns {boolean}
 */
export function needAntiContentYx (url) {
  if (!url) return false
  if (YX_EXCLUDE_RE.test(url)) return false
  return isRelative(url) || /^https?:\/\//i.test(url)
}

/**
 * 统一入口：是否需要 header Anti-Content
 * @param {string} url
 * @param {'mms'|'yx'} [force] 强制指定域（相对 path 时必传）
 * @returns {boolean}
 */
export function needAntiContent (url, force) {
  if (!url) return false
  if (force === 'yx') return needAntiContentYx(url)
  if (force === 'mms') return needAntiContentMms(url)
  if (/yingxiao\.pinduoduo\.com/i.test(url)) return needAntiContentYx(url)
  return needAntiContentMms(url)
}

/**
 * ★ 推荐入口：一次拿到该请求的完整签名策略
 * @param {string} url
 * @param {'mms'|'yx'} [force]
 * @returns {{ headerAnti: boolean, bodyCrawlerInfo: boolean, whitelistRule: string|null }}
 */
export function signPlan (url, force) {
  const headerAnti = needAntiContent(url, force)
  const isYx = force === 'yx' || (!force && /yingxiao\.pinduoduo\.com/i.test(url || ''))
  const bodyCrawlerInfo = headerAnti && (isYx || needCrawlerInfo(url))
  return { headerAnti, bodyCrawlerInfo, whitelistRule: matchWhitelistRule(url) }
}

/**
 * 老版 XHR 通道判定（只按域名）
 * @param {string} url
 * @returns {boolean}
 */
export function needAntiHeaderLegacy (url) {
  if (!url) return false
  return isRelative(url) || LEGACY_HOST_RE.test(url)
}

/** 便于排查：返回命中的白名单规则（未命中返回 null） */
export function matchWhitelistRule (url) {
  const p = toPath(url)
  return ANTI_CONTENT_WHITELIST.find(prefix => p.indexOf(prefix) > -1) || null
}

/** 平台自己的兜底字面量（注意拼写是 Risck，不是 Risk） */
export const ANTI_CONTENT_FALLBACK = 'getRisckInfoError'

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const cases = [
    ['https://mms.pinduoduo.com/vodka/v2/mms/edit/quantity/batchIncrease', false, '批量改库存 → 可纯 HTTP'],
    ['https://mms.pinduoduo.com/vodka/v2/mms/query/display/mall/goodsList', false, '商品列表 → 可纯 HTTP'],
    ['https://mms.pinduoduo.com/robot/shop/orders/shipping', false, '发货 → 可纯 HTTP'],
    ['https://mms.pinduoduo.com/mangkhut/mms/recentOrderList', false, '订单列表 → 可纯 HTTP'],
    ['https://mms.pinduoduo.com/glide/v2/mms/edit/commit/submit', true, '提交商品 → 必须签名'],
    ['https://mms.pinduoduo.com/vodka/v2/mms/batchOnSale', true, '批量上架 → 必须签名'],
    ['https://yingxiao.pinduoduo.com/mms-gateway/venus/api/promotion/batchCreate', true, '推广域默认全加'],
    ['https://api.pinduoduo.com/api/server/_stm', false, '推广域排除表'],
  ]
  let pass = 0
  console.log('pdd-sign-scope 自检（白名单 ' + ANTI_CONTENT_WHITELIST.length + ' 条）\n')
  for (const [u, want, label] of cases) {
    const got = needAntiContent(u)
    const ok = got === want
    if (ok) pass++
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  need=${got}  ${label}`)
    if (!ok) console.log('        ', u)
  }
  console.log(`\n${pass}/${cases.length} 通过`)
  if (pass !== cases.length) process.exit(1)
}
