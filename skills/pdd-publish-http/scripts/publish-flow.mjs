/**
 * 发布组件 · 总编排（publish-flow.mjs）
 *
 * 一条标准流程，全类目通用：
 *
 *   段1  打开商品列表 → 点「发布新商品」
 *   段2  选类目（搜索 → 点结果 → 确认）
 *   段3  表单页：标题 → 主图（全部）→ 详情图
 *   段4  类目属性（唯一随类目变化）
 *   段5  发货与售后 + 运费模板
 *   段6  SKU（规格 + 价格 + 预览图）
 *   段7  提交
 *
 * 每个段落都是可替换的组件；类目差异只在「段2 类目关键词」和「段4 属性」。
 *
 * 用法：
 *   import { publishFlow } from './publish-flow.mjs'
 *   const r = await publishFlow(page, product, { account, log })
 */
import { sleep } from './spec-dims.mjs'
import { fillTitle, fillItemNo, fillField, readCategory } from './field-basic.mjs'
import { uploadMainImages, uploadDetailImages } from './field-images.mjs'
import { fillAttributes } from './field-attributes.mjs'
import { fillShippingAndFreight, disableSizeChart } from './field-shipping.mjs'
import { fillSku } from './sku-component.mjs'

/**
 * @param page 表单页（goods_add/index）
 * @param product 统一商品 JSON
 * @param opts {
 *   log?: (msg) => void,
 *   costTemplate?: string,
 *   deliveryMethod?: string,
 *   deliveryTime?: string,
 *   fillSku?: bool（默认 true）
 * }
 * @returns { filled: string[], missed: string[], skuRows: number }
 */
export async function publishFlow(page, product, opts = {}) {
  const log = opts.log || (() => {})
  const filled = []
  const missed = []

  // ══════ 段3：标题 + 主图 + 详情图 ══════
  log('【段3】标题 / 主图 / 详情图')

  const titleOk = await fillTitle(page, product.title)
  if (titleOk) filled.push(`标题=${product.title}`)
  else missed.push('标题')
  log(`  标题 → ${titleOk ? 'OK' : '失败'}`)

  // 参考价（在 SKU 之前填，避免被 SKU 表填充重渲染冲掉）
  if (product.price) {
    const refOk = await fillField(page, /应大于商品最大单买价|商品参考价|参考价/, String(product.price))
    if (refOk) filled.push(`参考价=${product.price}`)
    else missed.push('参考价')
    log(`  参考价 ${product.price} → ${refOk ? 'OK' : '未找到'}`)
  }

  if (product.itemNo) {
    const noOk = await fillItemNo(page, product.itemNo)
    if (noOk) filled.push(`货号=${product.itemNo}`)
    log(`  货号 → ${noOk ? 'OK' : '未找到'}`)
  }

  // 主图（全部，最多 5 张）
  if (product.images?.length) {
    const r = await uploadMainImages(page, product.images, {
      maxCount: 5,
      onProgress: (i, total, cnt) => log(`  主图 ${i}/${total} → ${cnt.cur}/${cnt.max}`),
    })
    if (r.ok) filled.push(`主图 ${r.uploaded}/${r.total}`)
    else missed.push(`主图（${r.uploaded}/${r.total}）`)
  }

  // 详情图
  if (product.detailImages?.length) {
    const r = await uploadDetailImages(page, product.detailImages)
    if (r.ok) filled.push(`详情图（${r.note}）`)
    else missed.push(`详情图（${r.note}）`)
    log(`  详情图 → ${r.note}`)
  }

  // ══════ 段4：类目属性（唯一随类目变化） ══════
  log('【段4】类目属性')
  try {
    const r = await fillAttributes(page, product.attributes || [], { title: product.title })
    filled.push(...r.filled)
    missed.push(...r.missed)
    log(`  已填 ${r.filled.length} 项，未填 ${r.missed.length} 项`)
  } catch (e) {
    missed.push(`属性（异常：${e.message}）`)
  }

  // ══════ 段5：发货与售后 ══════
  log('【段5】发货与售后')
  try {
    const r = await fillShippingAndFreight(page, {
      costTemplate: opts.costTemplate,
      deliveryMethod: opts.deliveryMethod,
      deliveryTime: opts.deliveryTime,
    })
    filled.push(...r.filled)
    missed.push(...r.missed)
    log(`  已填 ${r.filled.length} 项，未填 ${r.missed.length} 项`)
  } catch (e) {
    missed.push(`发货售后（异常：${e.message}）`)
  }

  // ══════ 段6：SKU（规格 + 价格 + 预览图） ══════
  let skuRows = 0
  if (opts.fillSku !== false && product.specs?.length) {
    log('【段6】SKU')
    try {
      const r = await fillSku(page, product, {
        price: product.price,
        stock: product.stock,
        onLog: (m) => log('  ' + m),
      })
      skuRows = r.skuRows || 0
      if (r.ok) filled.push(`SKU ${skuRows} 行`)
      else missed.push(`SKU（${r.message}）`)
    } catch (e) {
      missed.push(`SKU（异常：${e.message}）`)
    }
  }

  return { filled, missed, skuRows }
}
