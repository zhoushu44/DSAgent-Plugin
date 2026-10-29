/**
 * 发布组件 · 总编排（publish-flow.mjs）
 *
 * ★★ 核心原则（2026-10-29 定稿，血泪教训）★★
 *
 *   组件化 = **把已验证能跑通的东西拆成模块**，不是重写逻辑。
 *
 *   之前我犯的错：把 lib/pdd-publish.js 里已经上架成功过的
 *   fillAttributes / fillSkuSpecMulti / fillPriceTable 全部重写成
 *   新的纯 JS 实现，结果材质成分连续坏 3 次，上架直接失败。
 *
 *   现在的做法：所有子组件只 **re-export lib 的已验证函数**，
 *   本文件只负责「按 lib 内部相同的顺序和参数调用」，一行业务逻辑都不新写。
 *
 * ── 调用顺序（与 lib 段3/段4 完全一致，实测能上架）──
 *   段3：标题 → 参考价 → 主图（全部）→ 详情图
 *   段4：规格 → SKU价格库存 → 商品属性 → 发货与售后
 *
 *   ★ 注意属性在价格表**之后**，这个顺序不能改：
 *     属性下拉重渲染会冲掉前面填的东西，放最后最安全。
 */
import { fillTitle, fillField } from './field-basic.mjs'
import { uploadImages, uploadDetailImages } from './field-images.mjs'
import { fillSkuSpecMulti, fillSkuSpec } from './spec-dims.mjs'
import { fillPriceTable } from './sku-table.mjs'
import { fillAttributes } from './field-attributes.mjs'
import { fillShippingAndFreight, disableSizeChart } from './field-shipping.mjs'

/** 主图 file input 锚点（与 lib 内一致） */
const MAIN_IMAGE_INPUT = 'input[data-tracking-click-viewid="carousel_img_localfile_upload"]'

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 跑完整段3 + 段4
 *
 * @param page   表单页（goods_add/index）
 * @param product 统一商品 JSON
 * @param opts {
 *   log?: (msg) => void,
 *   costTemplate?: string,
 *   deliveryTime?: string,
 *   attrModel?: any,
 * }
 * @returns { filled: string[], missed: string[] }
 */
export async function publishFlow(page, product, opts = {}) {
  const log = opts.log || (() => {})
  const filled = []
  const missed = []

  const title = String(product.title || '').trim()
  const price = String(product.price || '').trim()
  const stock = String(product.stock || '999')
  const itemNo = String(product.itemNo || '').trim()
  const category = String(product.category || '').trim()
  const images = product.images || []
  const detailImages = product.detailImages || []
  const attributes = product.attributes || []

  // 规格 / SKU 行（★ 形状必须与 lib 内部一致：values 是对象数组 {value, image}，
  //   不是字符串数组。lib 用 `String(v?.value||'')` 取值，传字符串会全部被过滤 → 0 项）
  const specs = (product.specs || [])
    .filter(d => d && d.name && Array.isArray(d.values) && d.values.length)
    .map(d => ({
      name: String(d.name).trim(),
      values: d.values
        .map(v => (v && typeof v === 'object')
          ? { value: String(v.value ?? '').trim(), image: v.image ? String(v.image).trim() : undefined }
          : { value: String(v ?? '').trim(), image: undefined })
        .filter(v => v.value),
    }))
    .filter(d => d.values.length)

  const skuRows = (product.skus || []).map(s => ({
    specs: s.specs || {},
    price: String(s.price || price),
    stock: String(s.stock || stock),
    itemNo: s.itemNo,
    image: s.image,
  }))

  // ══════════════ 段3：标题 / 参考价 / 主图 / 详情图 ══════════════
  log('【段3】标题 / 参考价 / 主图 / 详情图')

  if (title) {
    const ok = await fillTitle(page, title)
    if (ok) filled.push(`标题=${title}`)
    else missed.push('标题')
    log(`  标题 → ${ok ? 'OK' : '失败'}`)
  }

  if (price) {
    const ok = await fillField(page, /商品参考价|参考价|应大于商品最大单买价/, price)
    if (ok) filled.push(`参考价=${price}`)
    else missed.push('参考价')
    log(`  参考价 ${price} → ${ok ? 'OK' : '未找到'}`)
  }

  if (images.length) {
    const r = await uploadImages(page, images, MAIN_IMAGE_INPUT, '主图')
    if (r?.ok) filled.push(`主图（${r.note || images.length + ' 张'}）`)
    else missed.push(`主图（${r?.note || '上传未完成'}）`)
    log(`  主图 → ${r?.note || (r?.ok ? 'OK' : '未完成')}`)
  }

  if (detailImages.length) {
    const r = await uploadDetailImages(page, detailImages)
    if (r?.ok) filled.push(`详情图（${r.note}）`)
    else missed.push(`详情图（${r?.note || '上传未完成'}）`)
    log(`  详情图 → ${r?.note}`)
  }

  // ══════════════ 段4：规格 → 价格库存 → 属性 → 发货 ══════════════
  log('【段4】规格 / 价格库存 / 属性 / 发货')

  // ① 尺码表停用（服装类目才有，其他类目自动 false）
  if (await disableSizeChart(page)) log('  已停用尺码表')

  // ② 规格
  if (specs.length) {
    const r = await fillSkuSpecMulti(page, specs, skuRows, category)
    filled.push(...(r.filled || []))
    missed.push(...(r.missed || []))
    log(`  规格 → 已填 ${r.filled?.length || 0} 项，未填 ${r.missed?.length || 0} 项`)
    await sleep(1500)
  } else if (skuRows.length) {
    const r = await fillSkuSpec(page, skuRows, { category })
    filled.push(...(r.filled || []))
    missed.push(...(r.missed || []))
    log(`  单维规格 → 已填 ${r.filled?.length || 0} 项`)
    await sleep(1500)
  }

  // ③ 价格及库存
  {
    const priceRows = specs.length
      ? skuRows.map(r => ({ price: r.price, stock: r.stock, specs: r.specs }))
      : skuRows.map(s => ({ price: s.price, stock: s.stock }))
    const r = await fillPriceTable(page, { price, stock, itemNo, rows: priceRows })
    filled.push(...(r.filled || []))
    missed.push(...(r.missed || []))
    log(`  价格库存 → 已填 ${r.filled?.length || 0} 项，未填 ${r.missed?.length || 0} 项`)
    await sleep(1500)
  }

  // ④ 商品属性（★ 必须在价格表之后，属性下拉重渲染会冲掉前面的填写）
  try {
    const r = await fillAttributes(page, { title, category, model: opts.attrModel, values: attributes })
    filled.push(...(r.filled || []))
    missed.push(...(r.missed || []))
    log(`  属性 → 已填 ${r.filled?.length || 0} 项，未填 ${r.missed?.length || 0} 项`)
  } catch (e) {
    missed.push(`商品属性（异常：${e.message}）`)
  }

  // ⑤ 发货与售后
  try {
    const r = await fillShippingAndFreight(page, {
      costTemplate: opts.costTemplate,
      deliveryTime: opts.deliveryTime,
    })
    filled.push(...(r.filled || []))
    missed.push(...(r.missed || []))
    log(`  发货售后 → 已填 ${r.filled?.length || 0} 项`)
  } catch (e) {
    missed.push(`发货与售后（异常：${e.message}）`)
  }

  return { filled, missed }
}
