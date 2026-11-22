/**
 * taobao-sku.mjs —— 淘宝 SKU 解析（基座）
 *
 * 把 item.detail 的 payload 解析成扁平的 SKU 行，供各技能直接消费。
 *
 * ══════════════════════════════════════════════════════════════════
 * 真实结构（2026-11-18 实测 mtop.taobao.pcdetail.data.get）
 * ══════════════════════════════════════════════════════════════════
 *   data.skuBase.props   → [{ pid, name:'颜色分类', values:[{vid,name,image}] }, ...]
 *   data.skuBase.skus    → [{ skuId, propPath:'1627207:xxx;122216343:yyy' }]
 *   data.skuCore.sku2info→ {
 *        '6312010667658': {
 *          price: { priceText:'89', priceMoney:8900, priceTitle:'优惠前' },
 *          subPrice: { priceText:'79', priceTitle:'券后' },     // 不一定有
 *          quantity: 200, quantityText:'有货',
 *          logisticsTime: '预售，7天内发货'
 *        },
 *        '0': { ... }      // ★ skuId=0 是「商品整体/兜底价」，不是真实 SKU
 *      }
 *
 * 关键坑：
 *   · `sku2info['0']` 必须跳过，否则每个商品多一条假 SKU
 *   · priceText 是**券前价**（priceTitle='优惠前'），券后价在 subPrice
 *   · quantityText 可能是「有货 / 无货 / 预售」，不要只认 quantity 数字
 */
import { request } from './taobao-request.mjs'

const COLOR_HINTS = ['颜色', '色系', '色彩', '花色', '款式']
const SIZE_HINTS = ['尺码', '尺寸', '规格', '号型', '身高', '码数', '大小', '适用年龄', '版本']

function classifyProp(name) {
  const n = String(name || '')
  if (COLOR_HINTS.some(k => n.includes(k))) return 'color'
  if (SIZE_HINTS.some(k => n.includes(k))) return 'size'
  return 'other'
}

/** props → { pid: {name, kind, values: {vid: {name, image}}} } */
function buildPropIndex(skuBase) {
  const idx = {}
  for (const p of skuBase?.props || []) {
    if (!p?.pid) continue
    const values = {}
    for (const v of p.values || []) {
      if (v?.vid === undefined || v?.vid === null) continue
      values[String(v.vid)] = { name: String(v.name || ''), image: String(v.image || '') }
    }
    idx[String(p.pid)] = { name: String(p.name || ''), kind: classifyProp(p.name), values }
  }
  return idx
}

/** skuId → propPath */
function buildSkuPropMap(skuBase) {
  const map = {}
  for (const s of skuBase?.skus || []) {
    const id = String(s?.skuId ?? '')
    const path = String(s?.propPath || '')
    if (id && path) map[id] = path
  }
  // 兼容部分返回把映射放在 sku2props
  for (const [id, path] of Object.entries(skuBase?.sku2props || {})) {
    if (typeof path === 'string' && path.includes(':')) map[String(id)] = path
  }
  return map
}

function resolveProps(propPath, propIdx) {
  const out = []
  for (const chunk of String(propPath || '').split(';')) {
    const [pid, vid] = chunk.split(':')
    if (!pid || vid === undefined) continue
    const prop = propIdx[pid]
    if (!prop) continue
    const val = prop.values[String(vid)]
    out.push({ pid, name: prop.name, kind: prop.kind, value: val?.name || '', image: val?.image || '' })
  }
  return out
}

function pickPrice(info) {
  const main = info?.price || {}
  const sub = info?.subPrice || {}
  const before = String(main.priceText ?? main.priceMoney ?? '') || ''
  const after = String(sub.priceText ?? sub.priceMoney ?? '') || ''
  const beforeLabel = String(main.priceTitle || '')
  const afterLabel = String(sub.priceTitle || '')
  return { before, after: after || before, beforeLabel, afterLabel }
}

function pickStock(info) {
  const qty = info?.quantity
  const text = String(info?.quantityText || '')
  const numeric = typeof qty === 'number' ? qty : (qty === undefined ? null : Number(qty))
  return {
    stock: numeric !== null && !Number.isNaN(numeric) ? numeric : null,
    inStock: /有货/.test(text) ? '是' : (/无货|缺货/.test(text) ? '否' : ''),
    stockText: text,
    logisticsTime: String(info?.logisticsTime || ''),
  }
}

/**
 * 解析一个 item.detail 的 data
 * @param {object} data   r.data（即 mtop payload 的 .data）
 * @returns {{itemId:string, title:string, shopName:string, skuRows:Array, dimensions:Array, skuCount:number}}
 */
export function parseSkuData(data) {
  const skuBase = data?.skuBase || {}
  const skuCore = data?.skuCore || {}
  const item = data?.item || {}
  const seller = data?.seller || {}

  const propIdx = buildPropIndex(skuBase)
  const propMap = buildSkuPropMap(skuBase)
  const sku2info = skuCore.sku2info || {}

  const dimensions = Object.values(propIdx).map(p => ({
    name: p.name, kind: p.kind, valueCount: Object.keys(p.values).length,
  }))

  const skuRows = []
  for (const [skuId, info] of Object.entries(sku2info)) {
    if (skuId === '0') continue                 // 兜底价，不是真实 SKU
    if (!info || typeof info !== 'object') continue
    const resolved = resolveProps(propMap[skuId], propIdx)
    const color = resolved.filter(r => r.kind === 'color').map(r => r.value).filter(Boolean).join('/')
    const size = resolved.filter(r => r.kind !== 'color').map(r => r.value).filter(Boolean).join('/')
    const specs = resolved.filter(r => r.value).map(r => `${r.name}=${r.value}`).join(' ; ')
    const price = pickPrice(info)
    const stock = pickStock(info)
    skuRows.push({
      skuId,
      color, size, specs,
      priceBefore: price.before,
      priceAfter: price.after,
      priceBeforeLabel: price.beforeLabel,
      priceAfterLabel: price.afterLabel,
      stock: stock.stock,
      inStock: stock.inStock,
      stockText: stock.stockText,
      logisticsTime: stock.logisticsTime,
    })
  }

  // 价格区间
  const nums = skuRows.map(r => Number(r.priceAfter)).filter(n => Number.isFinite(n) && n > 0)
  const beforeNums = skuRows.map(r => Number(r.priceBefore)).filter(n => Number.isFinite(n) && n > 0)

  return {
    itemId: String(item.itemId || ''),
    title: String(item.title || ''),
    shopName: String(seller.shopName || seller.sellerNick || ''),
    spuId: String(item.spuId || ''),
    skuCount: skuRows.length,
    dimensions,
    skuRows,
    priceAfterMin: nums.length ? Math.min(...nums) : null,
    priceAfterMax: nums.length ? Math.max(...nums) : null,
    priceBeforeMin: beforeNums.length ? Math.min(...beforeNums) : null,
    priceBeforeMax: beforeNums.length ? Math.max(...beforeNums) : null,
    inStockCount: skuRows.filter(r => r.inStock === '是').length,
  }
}

/** 拉一个商品的 SKU（含请求） */
export async function fetchSku(itemId, opts = {}) {
  const r = await request('item.detail', { id: String(itemId) }, opts)
  if (!r.ok) return { ok: false, ...r, itemId: String(itemId) }
  const parsed = parseSkuData(r.data)
  return { ok: true, itemId: String(itemId), ...parsed, ms: r.ms, shopKey: r.shopKey }
}

/** 批量拉 SKU */
export async function fetchSkuBatch(itemIds, opts = {}) {
  const items = []
  const errors = []
  const list = [...itemIds]
  for (let i = 0; i < list.length; i++) {
    const id = list[i]
    if (opts.onProgress) opts.onProgress(i + 1, list.length, id)
    const r = await fetchSku(id, opts)
    if (r.ok) items.push(r)
    else {
      errors.push({ itemId: String(id), failureKind: r.failureKind, hint: r.hint, remainMs: r.remainMs })
      if (r.failureKind === 'risk_control') break
    }
  }
  return { items, errors }
}

export default { parseSkuData, fetchSku, fetchSkuBatch }
