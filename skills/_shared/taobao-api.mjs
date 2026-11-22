/**
 * taobao-api.mjs —— 淘宝接口注册表（基座）
 *
 * ★ 唯一真源：**host / api / version / referer / appKey / 签名参数** 都在这里。
 *   skill 侧只认逻辑名（如 `item.detail`），平台升级只改这个文件。
 *
 * ══════════════════════════════════════════════════════════════════
 * 域选择（实测，2026-11-18）
 * ══════════════════════════════════════════════════════════════════
 *   · 详情/评价/问大家 → `h5api.m.tmall.com` 稳定 SUCCESS
 *   · 同接口在 `h5api.m.taobao.com` → 偶发 RGV587_ERROR（风控）
 *     因此这些接口**必须**走 tmall 域，Referer/Origin 也要同域。
 *   · 搜索页 → `h5api.m.taobao.com` 正常
 *   · 闲鱼 → `h5api.m.goofish.com`，且 **appKey 不同（34839810）**
 *
 * ══════════════════════════════════════════════════════════════════
 * appKey 是「接口级」而非「平台级」——这是踩过的坑
 * ══════════════════════════════════════════════════════════════════
 *   淘宝/天猫 mtop：12574478
 *   闲鱼 mtop：      34839810
 *   签名算法相同，但 appKey 参与 sign 计算，用错就签名失败。
 *   所以 appKey 必须按接口声明，不能全局写死。
 */

/** @typedef {'taobao'|'tmall'|'goofish'} Domain */

export const DOMAINS = {
  taobao: {
    host: 'h5api.m.taobao.com',
    origin: 'https://h5api.m.taobao.com',
  },
  tmall: {
    host: 'h5api.m.tmall.com',
    origin: 'https://h5api.m.tmall.com',
  },
  goofish: {
    host: 'h5api.m.goofish.com',
    origin: 'https://www.goofish.com',
  },
}

/** 平台级默认 appKey（可被接口级覆盖） */
export const APP_KEYS = {
  taobao: '12574478',
  tmall: '12574478',
  goofish: '34839810',
}

/**
 * 接口注册表
 *
 * 字段
 *   api       mtop 接口名
 *   version   mtop 版本
 *   domain    走哪个域（见 DOMAINS）
 *   referer   函数或字符串；必须与 domain 同域，否则判风控
 *   appKey    可选，覆盖平台默认（闲鱼必须覆盖）
 *   extraParams  额外固定 query 参数
 *   desc      用途
 */
export const APIS = {
  // ── 商品详情（SKU 价格 / 库存 / 规格维度）────────────────────
  'item.detail': {
    api: 'mtop.taobao.pcdetail.data.get',
    version: '1.0',
    domain: 'tmall',
    referer: p => `https://detail.tmall.com/item.htm?id=${p.id}`,
    extraParams: { detail_v: '3.3.2' },
    desc: '商品详情：skuBase.props（规格维度）、skuCore.sku2info（SKU价格/库存）',
  },

  // ── 搜索页（市场分析 / 选品采集）───────────────────────────
  'search.list': {
    api: 'mtop.relationrecommend.wirelessrecommend.recommend',
    version: '2.0',
    domain: 'taobao',
    referer: 'https://s.taobao.com/',
    desc: '淘宝搜索页商品列表（市场分析用）',
  },

  // ── 评价 ────────────────────────────────────────────────
  'rate.list': {
    api: 'mtop.taobao.rate.detaillist.get',
    version: '6.0',
    domain: 'tmall',
    referer: p => `https://detail.tmall.com/item.htm?id=${p.itemId}`,
    desc: '商品评价列表（含 skuMap，可反查评价对应 SKU）',
  },

  // ── 问大家 ──────────────────────────────────────────────
  'wdj.list': {
    api: 'mtop.taobao.wdj.list.merge.search',
    version: '1.0',
    domain: 'tmall',
    referer: p => `https://detail.tmall.com/item.htm?id=${p.itemId}`,
    extraParams: { jsonpIncPrefix: 'pcdetail' },
    desc: '问大家问题列表',
  },
  'wdj.answer': {
    api: 'mtop.taobao.social.ugc.post.detail',
    version: '2.0',
    domain: 'tmall',
    // ★ 注意：接口在 tmall 域，但 referer 必须是 web.m.taobao.com（问大家详情页）
    referer: p => `https://web.m.taobao.com/app/mtb/ask-everyone/detail?id=${p.questionId}`,
    refererOrigin: 'https://web.m.taobao.com',
    extraParams: { jsonpIncPrefix: 'pcdetail' },
    desc: '问大家回答详情',
  },

  // ── 发布（无线 AI 发布 / PC 管理）── 需浏览器通道配合 ─────────
  // ★ 实测状态（2026-11-18）：
  //   publish.render        SUCCESS，可调
  //   publish.submit        接口存在，命中 RGV587（写操作，风控更严）
  //   publish.pc.manage     接口存在；**tab 是 data 体字段**（放 query 无效）
  //   publish.tmall.manage  同上
  'publish.render': {
    api: 'mtop.taobao.sell.wireless.ai.publish.render',
    version: '1.0',
    domain: 'taobao',
    referer: 'https://item.upload.taobao.com/',
    desc: '淘宝发布页表单渲染（服务端按类目下发默认值）',
  },
  'publish.submit': {
    api: 'mtop.taobao.sell.wireless.ai.publish.submit',
    version: '1.0',
    domain: 'taobao',
    referer: 'https://item.upload.taobao.com/',
    desc: '淘宝发布提交（写操作，风控更严；建议走浏览器通道）',
  },
  'publish.pc.manage': {
    api: 'mtop.taobao.sell.pc.manage.render',
    version: '1.0',
    domain: 'taobao',
    referer: 'https://item.upload.taobao.com/',
    // ★ tab 必须放 data 体（`extraParams` 里无效）
    defaultData: { tab: 'publish' },
    desc: '淘宝 PC 管理渲染（data.tab 必填，默认 publish）',
  },
  'publish.tmall.manage': {
    api: 'mtop.tmall.sell.pc.manage.render',
    version: '1.0',
    domain: 'taobao',
    referer: 'https://sell.publish.tmall.com/',
    defaultData: { tab: 'publish' },
    desc: '天猫 PC 管理渲染（data.tab 必填，默认 publish）',
  },

  // ── 健康中心 / 违规 ───────────────────────────────────────
  // ★ 2026-11-18 实测 `mtop.alibaba.healthcenter2.punish.list` = FAIL_SYS_API_NOT_FOUNDED。
  //   SOURCE.md 只写了通配符 `mtop.alibaba.healthcenter2.punish.*`，没有确认真实方法名。
  //   按「不编造」原则：**不注册**，等抓到真实接口名再补。
  //   体检页入口：https://healthcenter.taobao.com/home/health_home.htm

  // ── 闲鱼（appKey 不同！）────────────────────────────────────
  'xianyu.bootstrap': {
    api: 'mtop.taobao.idlehome.home.webpc.feed',
    version: '1.0',
    domain: 'goofish',
    appKey: '34839810',
    referer: 'https://www.goofish.com/',
    desc: '闲鱼首页 feed（兼作 _m_h5_tk token 引导）',
  },
  'xianyu.search': {
    api: 'mtop.taobao.idlemtopsearch.pc.search',
    version: '1.0',
    domain: 'goofish',
    appKey: '34839810',
    referer: 'https://www.goofish.com/search',
    desc: '闲鱼商品搜索',
  },
}

/**
 * 解析接口定义，产出可直接发请求的配置
 * @param {string} name 逻辑名，如 'item.detail'
 * @param {object} params 用于渲染 referer 的参数
 */
export function resolveApi(name, params = {}) {
  const spec = APIS[name]
  if (!spec) throw new Error(`未登记的淘宝接口: ${name}（请在 skills/_shared/taobao-api.mjs 注册）`)
  const dom = DOMAINS[spec.domain]
  const referer = typeof spec.referer === 'function' ? spec.referer(params) : spec.referer
  const appKey = spec.appKey || APP_KEYS[spec.domain] || APP_KEYS.taobao
  // refererOrigin：少数接口 referer 与域不同（如 wdj.answer 在 tmall 域但 referer 是 web.m.taobao.com）
  const origin = spec.refererOrigin || dom.origin
  return { ...spec, ...dom, referer, origin, appKey, name }
}

export function listApis() {
  return Object.entries(APIS).map(([name, s]) => ({
    name,
    api: s.api,
    version: s.version,
    domain: s.domain,
    desc: s.desc,
  }))
}
