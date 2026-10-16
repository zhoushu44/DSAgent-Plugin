/**
 * 拼多多发布 —— 基于**统一商品数据格式**（ProductData）的拼多多发布入口。
 *
 * 入参只有 `product`（一个统一 JSON，见 services/product-schema.ts）：
 *   - 规格用**维度数组**（颜色/尺码…，≤2 维），SKU 用**维度名→规格值**组合表达，
 *     天然支持二维矩阵（颜色×尺码）；属性可显式指定 name→value。
 *
 * 本模块**不复制**发布引擎：解析/校验统一数据后，把 ProductData 映射成
 * `PddPublishOptions`，再原样交给 `pddPublish` 执行（浏览器驱动、confirm 门禁、
 * 账号选择、风控等待等全部行为在引擎内实现）。
 */
import { CredentialStore } from './services/credential-store.js'
import { parseProduct, validateProduct, type ProductData } from './services/product-schema.js'
import {
  pddPublish,
  type AttrModelHandle,
  type PddPublishOptions,
  type PddPublishResult,
} from './pdd-publish.js'

/** 「上架 2」入参：统一商品数据 + 发布控制项 */
export interface PddPublish2Options {
  /** 统一商品数据：对象或 JSON 字符串（见 services/product-schema.ts 的 ProductData） */
  product: unknown
  /** 是否已获用户确认；为 false 时只返回预览，不执行任何写操作 */
  confirm?: boolean
  /** 指定账号 shopKey（选填；也接受 product.account） */
  account?: string
  /** 当前会话（智能体）ID，用于账号选择链 */
  agentId?: string
  /** 「商品属性」自动选值用的宿主聊天模型句柄（选填） */
  attrModel?: AttrModelHandle
  /** 运费模板名（选填）。传入后自动选「其他模板」→ 搜索该模板名 */
  costTemplate?: string
  /** 发货时间（选填）：1=当日发货、2=24小时发货、3=48小时发货；默认1 */
  deliveryTime?: number
}

/**
 * 把统一商品数据映射为拼多多发布选项。
 * 导出以便单测：映射是纯函数，不触碰浏览器/网络。
 */
export function toPddOptions(p: ProductData, extra: PddPublish2Options): PddPublishOptions {
  const opts: PddPublishOptions = {
    title: p.title,
    images: p.images,
  }
  if (p.detailImages?.length) opts.detailImages = p.detailImages
  if (p.category) opts.category = p.category
  if (p.price) opts.price = p.price
  if (p.stock) opts.stock = p.stock
  if (p.itemNo) opts.itemNo = p.itemNo
  if (p.specs?.length) {
    opts.specs = p.specs.map(d => ({
      name: d.name,
      values: d.values.map(v => ({ value: v.value, image: v.image })),
    }))
  }
  if (p.skus?.length) {
    opts.skuRows = p.skus.map(s => ({
      specs: s.specs,
      price: s.price,
      stock: s.stock,
      itemNo: s.itemNo,
    }))
  }
  if (p.attributes?.length) {
    opts.attributes = p.attributes.map(a => ({ name: a.name, value: a.value }))
  }
  const account = String(extra.account ?? '').trim() || p.account
  if (account) opts.account = account
  if (extra.agentId) opts.agentId = extra.agentId
  if (extra.attrModel) opts.attrModel = extra.attrModel
  if (extra.costTemplate) opts.costTemplate = extra.costTemplate
  if (extra.deliveryTime != null) opts.deliveryTime = extra.deliveryTime
  if (extra.confirm === true) opts.confirm = true
  return opts
}

/**
 * 发布拼多多商品（统一数据入口）。
 * 流程：解析统一数据 → 本地校验 → 映射为发布选项 → 交给 pddPublish 执行。
 */
export async function pddPublish2(
  store: CredentialStore,
  opts: PddPublish2Options,
): Promise<PddPublishResult> {
  const parsed = parseProduct(opts.product)
  if (parsed.error || !parsed.product) {
    return { ok: false, failureKind: 'api_error', text: parsed.error || '商品数据解析失败。' }
  }
  const invalid = validateProduct(parsed.product)
  if (invalid) {
    return { ok: false, failureKind: 'api_error', text: `商品数据校验未通过：${invalid}` }
  }
  return pddPublish(store, toPddOptions(parsed.product, opts))
}
