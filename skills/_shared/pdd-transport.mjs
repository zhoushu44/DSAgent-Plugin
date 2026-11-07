/**
 * pdd-transport.mjs —— 通道选择器（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么做这个（2026-11-05）
 * ══════════════════════════════════════════════════════════════════
 * 基座里有两个请求通道，职责长期不清：
 *
 *   pdd-http.mjs    387 行  纯 Node（无浏览器）  简化签名 t1
 *   pdd-client.mjs  664 行  需要浏览器 + CDP     真签名 t2/t3 + webSpiderRule
 *
 * 之前 skill 各自凭感觉选（pdd-shop 两个都用、pdd-works 只用 client），
 * 结果是「同样的接口，有的走轻通道有的走重通道」，风控表现不可预测。
 *
 * 这个模块把选择规则显式化：**按接口前缀自动选通道**，skill 不用再判断。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ 2026-11-07 重大更新：t2 不再需要浏览器
 * ══════════════════════════════════════════════════════════════════
 *
 * 突破：jsdom + react_anti SDK 可以在纯 Node 里生成 0as 真签名。
 *
 *   之前 /vodka/ /glide/ → pdd-client（浏览器）  28000ms
 *   现在 /vodka/ /glide/ → pdd-vodka-signer      150~330ms   （快 ~180 倍）
 *
 * 关键前提：
 *   ① messagePack({antiVersion:'v1'})  → 0as（不加参数是 0at，无效）
 *   ② localStorage 种子（ISLOGIN / MMS-LOGIN-FP / _nano_fp）
 *   ③ location.href 必须是真实页面 URL
 *   ④ 不需要伪造鼠标事件（采集器全空也能过）
 *
 * 实测可用接口（纯 Node，2026-11-07）：
 *   ✅ /glide/v2/mms/addProperties/goodsList
 *   ✅ /vodka/v2/mms/query/display/mall_goods/count
 *   ✅ /vodka/v2/mms/common/query/status
 *   ✅ /vodka/v2/mms/query/display/goods_copyed/is_exist
 *   ✅ /vodka/v2/mms/newStyleGoods/gray/queryNewStyleGoodsGray
 *   ⚠️ /vodka/v2/mms/query/display/mall/goodsList（接口级限流，浏览器也 54001）
 *
 * t3 仍然必须用浏览器（webSpiderRule 需要在页面上下文捕获）。
 *
 * ══════════════════════════════════════════════════════════════════
 * 选择规则（来自实测，不是拍脑袋）
 * ══════════════════════════════════════════════════════════════════
 *
 *   /vodka/  /glide/          商品域，签名门禁最严   → t2（纯 Node 0as）/ t3（浏览器）
 *   /sydney/ /earth/          经营域，宽松           → t1（简化签名）
 *   /lakemms/ /leekmms/       活动域，独立频控       → t1
 *   /opportunity-goods/       机会商品，不在白名单   → t1（甚至可不签名）
 *   /mms-gateway/             推广域，默认全加签名   → t2/t3
 *   live.pinduoduo.com        视频域                → t1
 */

/**
 * 必须用真签名（t2）的前缀 —— 实测 t1 会失败
 * ★ 2026-11-05：并入 pdd-client 原有的两个特例
 *   queryGoodsPageOverViewReadyDate / queryGoodsReadyDate
 *   （它们不带标准前缀但同样走 t2，漏掉会改变现有行为）
 */
const NEEDS_REAL_SIGN = [
  /\/vodka\//,
  /\/glide\//,
  /queryGoodsPageOverViewReadyDate/,
  /queryGoodsReadyDate/,
  /^\/mms-gateway\//,
]

/** 可以用简化签名（t1）的前缀 */
const OK_SIMPLE_SIGN = [
  /\/sydney\//, /\/earth\//, /\/janus\//,
  /\/lakemms\//, /\/leekmms\//,
  /\/opportunity-goods\//, /\/mangkhut\//, /\/mercury\//, /\/honolulu\//,
]

/**
 * 判断某 URL 该走哪个通道
 * @param {string} url
 * @param {object} [opts] { hasAccount: boolean } —— 有账号种子时可走纯 Node t2
 * @returns {'t1'|'t2'|'t2n'|'t3'}  t1=纯Node简化签名；t2=真签名；t2n=纯Node真签名；t3=真签名+webSpiderRule
 */
export function pickTier(url, opts = {}) {
  const u = String(url || '')
  // 商品明细这类最严格的，用 t3（额外带 webSpiderRule）—— 需要浏览器
  if (/queryGoodsDetailVOList|queryGoodsPageOverView(\?|$)/.test(u)) return 't3'
  for (const re of NEEDS_REAL_SIGN) {
    if (re.test(u)) {
      // ★ 2026-11-07：有账号种子时走纯 Node（快 180 倍）
      return opts.hasAccount ? 't2n' : 't2'
    }
  }
  for (const re of OK_SIMPLE_SIGN) if (re.test(u)) return 't1'
  // 默认保守：走真签名。宁可慢，不要莫名 54001。
  return opts.hasAccount ? 't2n' : 't2'
}

/**
 * 该 URL 是否必须开浏览器
 * @param {string} url
 * @param {object} [opts] { hasAccount: boolean }
 * @returns {boolean}
 */
export function needsBrowser(url, opts = {}) {
  return pickTier(url, opts) === 't2' || pickTier(url, opts) === 't3'
}

/**
 * 通道能力说明（排查用）
 */
export const TRANSPORT_INFO = {
  t1: { module: 'pdd-http.mjs', browser: false, signature: 'simple', note: '纯 Node，快（~200ms），只适用于宽松域' },
  t2: { module: 'pdd-client.mjs', browser: true, signature: 'risksdk (页面内)', note: '真签名（浏览器），无账号种子时的兜底' },
  t2n: { module: 'pdd-vodka-signer.mjs', browser: false, signature: '0as (jsdom+SDK)', note: '★ 纯 Node 真签名，/vodka/ /glide/ 首选，快 ~180 倍' },
  t3: { module: 'pdd-client.mjs', browser: true, signature: 'risksdk+webSpiderRule', note: '最严接口（商品明细），必须浏览器' },
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const cases = [
    ['/vodka/v2/mms/query/display/mall/goodsList', 't2n', '商品列表（有账号→纯Node）'],
    ['/glide/v2/mms/edit/commit/submit', 't2n', '提交商品（有账号→纯Node）'],
    ['/sydney/api/mallFlow/getMallFlowData', 't1', '店铺流量'],
    ['/sydney/api/goodsDataShow/queryGoodsDetailVOList', 't3', '商品明细（必须浏览器）'],
    ['/lakemms/enrollV2', 't1', '活动报名'],
    ['/opportunity-goods/chance-goods/home_list', 't1', '机会商品'],
    ['/mms-gateway/venus/api/promotion/batchCreate', 't2n', '推广建计划'],
    ['/unknown/path', 't2n', '未知路径（保守走真签名）'],
  ]
  let pass = 0
  for (const [url, expect, note] of cases) {
    const got = pickTier(url, { hasAccount: true })
    const gotNoAcc = pickTier(url, { hasAccount: false })
    const ok = got === expect
    if (ok) pass++
    console.log(`${ok ? '✓' : '✗'} ${url.padEnd(56)} → ${got.padEnd(4)} (无账号:${gotNoAcc.padEnd(3)})  ${note}`)
  }
  console.log(`\n${pass}/${cases.length} 通过`)
}
