/**
 * promo-node.mjs —— pdd-promo 的 **Node-first 读通道**
 *
 * 背景（2026-11-09）：
 *   旧实现靠「打开推广页 → 收割页面自己发出的 XHR 响应」拿数据，
 *   一个 overview 要开 3 个页面、每个等 13s ≈ 40s，且读到的字段取决于页面渲染了什么。
 *
 *   现在推广域签名已在基座打通（浏览器签名 + Node 发请求），
 *   读接口可以**直接在 Node 里调**，毫秒级返回，字段完整。
 *
 * 设计：
 *   - 走基座 pdd-request.callApi() → 自动合并真实请求体默认值 + 统一风控闸门
 *   - Node 拿不到的数据（诊断抽屉等）才由调用方回落到浏览器
 *   - 本模块**不自己管风控**：限流/账号锁/错误分类全在基座
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const imp = (rel) => import(pathToFileURL(path.join(HERE, '..', '..', '_shared', rel)).href)

/** 今天 / 昨天的 YYYY-MM-DD */
function ymd(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function ymdShift(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return ymd(d)
}

/**
 * 每个模式需要哪些接口。
 * 少调一个就少等一个间隔（推广域 6s/次），所以按需取，别一股脑全调。
 *   userInfo      —— 拿 mall_id（报表类接口的 entityId 是店铺级的）
 *   accountAll    —— 余额/账户
 *   dailyCost     —— 日消耗
 *   adGroups      —— 广告组
 *   list          —— 推广单元列表（速率表/商品维度都靠它）
 *   scenes        —— 直播/全站/明星店场景
 *   goodsUpgrade  —— 商品是否升级推广版
 *   entityReport  —— 商品维度报表（曝光/点击/花费/ROI）
 *   assistInfo    —— 推广助手诊断建议
 *   chargeSuggest —— 充值建议
 *   rangeReport   —— 按天区间报表
 */
const PLAN = {
  overview: ['userInfo', 'accountAll', 'dailyCost', 'adGroups', 'list', 'scenes', 'goodsUpgrade', 'entityReport'],
  goods: ['userInfo', 'accountAll', 'dailyCost', 'adGroups', 'list', 'scenes', 'goodsUpgrade', 'entityReport'],
  rates: ['userInfo', 'accountAll', 'list', 'entityReport'],
  units: ['userInfo', 'list'],
  daily: ['userInfo', 'dailyCost', 'rangeReport'],
  default: ['userInfo', 'accountAll', 'dailyCost', 'adGroups', 'list', 'scenes', 'goodsUpgrade', 'entityReport', 'assistInfo', 'chargeSuggest', 'rangeReport'],
}

/**
 * 采集推广域读数据。
 * @returns {{byApi:object, channel:string, errors:Array, ok:boolean}}
 */
export async function collectPromoViaNode(opts = {}) {
  const { callApi } = await imp('pdd-request.mjs')
  const { shopKey, account, guard, page, mode } = opts
  const today = ymd()
  const yesterday = ymdShift(-1)
  // ★ daily 模式需要按天序列，默认 body 只给近 2 天——显式传窗口
  const days = Math.min(90, Math.max(1, Number(opts.days) || 7))
  const startDate = ymdShift(-(days - 1))
  const byApi = {}
  const errors = []
  const want = PLAN[mode] || PLAN.default
  const need = (k) => want.includes(k)

  const call = async (name, body, extra) => {
    try {
      const r = await callApi(name, body, { shopKey, account, guard, page, ...(extra || {}) })
      if (r.ok) {
        byApi[name.replace(/^promo\./, '')] = r.data
        return r.data
      }
      errors.push({ name, ec: r.ec, kind: r.failureKind, hint: r.hint })
      return null
    } catch (e) {
      errors.push({ name, ec: 'exception', kind: 'skill_error', hint: String(e.message).slice(0, 120) })
      return null
    }
  }

  // ⓪ 店铺信息 —— 拿 mall_id（报表接口的 entityId 是**店铺级**的，不同账号不同）
  const ui = need('userInfo') ? await call('promo.userInfo', {}) : null
  const mallId = ui?.mall?.mallId ?? null
  const mallName = ui?.mall?.mallName ?? null
  const ctx = { mallId, today, yesterday, startDate }
  if (!mallId) console.warn('[promo-node] 拿不到 mall_id，报表类接口会失败')

  // ① 账户汇总（余额/消耗/主体）—— 核心
  if (need('accountAll')) await call('promo.accountAll', {}, { ctx })
  // ② 每日消耗
  if (need('dailyCost')) await call('promo.dailyCost', { beginDate: yesterday, endDate: today }, { ctx })
  // ③ 推广广告组
  if (need('adGroups')) await call('promo.adGroups', {}, { ctx })
  // ④ 推广单元列表（商品维度）
  if (need('list')) await call('promo.list', { beginDate: today, endDate: today, pageNumber: 1, pageSize: 50 }, { ctx })
  // ⑤ 全场景广告列表
  if (need('scenes')) await call('promo.scenes', {}, { ctx })
  // ⑥ 商品是否已升级
  if (need('goodsUpgrade')) await call('promo.goodsUpgrade', {}, { ctx })
  // ⑦ 推广助手信息（诊断/建议）
  if (need('assistInfo')) await call('promo.assistInfo', { beginDate: today, endDate: today }, { ctx })
  // ⑧ 充电建议
  if (need('chargeSuggest')) await call('promo.chargeSuggest', {}, { ctx })
  // ⑨ 商品维度报表（曝光/点击/花费/ROI）
  if (need('entityReport')) await call('promo.entityReport', {}, { ctx })
  // ⓾ 每日消耗
  if (need('dailyCost')) await call('promo.dailyCost', { beginDate: yesterday, endDate: today }, { ctx })
  // ⓾ 区间报表（按天）—— daily 模式要 N 天序列，显式覆盖默认的 2 天窗口
  if (need('rangeReport')) {
    const rr = await call('promo.rangeReport', { startDate, endDate: today }, { ctx })
    // ★ 形状必须和浏览器收割一致：[{dailyReportList:[...]}]（数组）
    //   页面会同时发「近 N 日」+「上一周期」两份，消费者取 dailyReportList 最长的一份
    if (rr) byApi.rangeReport = [rr]
  }

  const okCount = Object.keys(byApi).length
  return {
    byApi,
    ok: okCount >= 2,
    channel: 'node',
    errors,
    mallId,
    mallName,
    summary: { collected: okCount, failed: errors.length },
  }
}

/** 命名对齐旧实现：旧代码按 byApi.xxx 取，这里给出同样的键名 */
export function normalizeByApi(byApi) {
  const out = {}
  if (byApi.accountAll) out.accountAll = byApi.accountAll
  if (byApi.dailyCost) out.dailyCost = byApi.dailyCost
  if (byApi.adGroups) out.adGroups = byApi.adGroups
  if (byApi.unitList) out.unitList = byApi.unitList
  if (byApi.list) out.unitList = byApi.list          // promo.list → 旧代码用 unitList 这个键
  if (byApi.scenes) out.scenes = byApi.scenes
  if (byApi.goodsUpgrade) out.goodsUpgrade = byApi.goodsUpgrade
  if (byApi.assistInfo) out.assistInfo = byApi.assistInfo
  if (byApi.chargeSuggest) out.chargeSuggest = byApi.chargeSuggest
  if (byApi.entityReport) out.entityReport = byApi.entityReport
  if (byApi.rangeReport) out.rangeReport = byApi.rangeReport
  if (byApi.userInfo) out.userInfo = byApi.userInfo
  return out
}

/**
 * 按 adId 采集「诊断 + 详情」—— 喂给 diagnose / item / balance 三个模式。
 *
 * ★ 2026-11-09 突破：这两个原来只能**打开诊断抽屉**才发得出请求，现在发现
 *   真实接口是 smartTool/diagnosis/v2/queryPromotionDiagnosis，body 只有
 *   {adId, platform:1}（platform 缺了报「平台类型错误」）—— 直接 Node 调。
 *
 * @param {object} opts { adIds:[], shopKey, account, guard }
 * @returns {{adDiagnosisByAd, promotionDetailByAd, errors, ok}}
 */
export async function collectDiagnoseViaNode(opts = {}) {
  const { callApi } = await imp('pdd-request.mjs')
  const { shopKey, account, guard } = opts
  const adIds = (opts.adIds || []).map(x => String(x)).filter(Boolean)
  const adDiagnosisByAd = {}
  const promotionDetailByAd = {}
  const errors = []

  const call = async (name, body) => {
    try {
      const r = await callApi(name, body, { shopKey, account, guard })
      return r.ok ? r.data : (errors.push({ name, ec: r.ec, hint: r.hint }), null)
    } catch (e) {
      errors.push({ name, ec: 'exception', hint: String(e.message).slice(0, 120) })
      return null
    }
  }

  // 诊断并发拿（不同 adId 之间没有依赖，串行只是白等 6s 域间隔）
  await Promise.all(adIds.map(async (id) => {
    // 新版接口优先（字段全：竞争数据/摘要/建议列表/报告）；失败再试旧的
    const d = await call('promo.diagnosisV2', { adId: Number(id), platform: 1 })
      || await call('promo.adDiagnosis', { adId: Number(id), platform: 1 })
    if (d) adDiagnosisByAd[id] = d
    // 单元详情（花费/ROI/出价）
    const det = await call('promo.detail', { adId: Number(id) })
    if (det) promotionDetailByAd[id] = det
  }))

  const n = Object.keys(adDiagnosisByAd).length
  return { adDiagnosisByAd, promotionDetailByAd, errors, ok: n > 0, channel: 'node', summary: { diagnosed: n, requested: adIds.length, failed: errors.length } }
}

export default { collectPromoViaNode, normalizeByApi, collectDiagnoseViaNode }
