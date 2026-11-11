/**
 * product-schema.mjs — 统一商品数据校验 + 归一化
 *
 * 目标：上架前在入口一次性把问题说清楚，不要跑到 step12 才炸。
 *
 * 返回：
 *   {
 *     ok: boolean,
 *     errors: string[],      致命 → 不继续
 *     warnings: string[],    警告 → 继续但提示
 *     normalized: object     补完默认值后的标准对象
 *   }
 */
import fs from 'node:fs'
import path from 'node:path'

const MAX_TITLE = 60
const MAX_MAIN_IMAGES = 5
const MAX_DETAIL_IMAGES = 50
const MAX_IMAGE_MB = 3

function fileInfo(p) {
  try {
    const st = fs.statSync(p)
    return { exists: st.isFile(), sizeMB: st.size / 1024 / 1024, size: st.size }
  } catch { return { exists: false, sizeMB: 0, size: 0 } }
}

function isImagePath(p) {
  return /\.(jpe?g|png|webp|bmp)$/i.test(String(p || ''))
}

/**
 * @param {object} product 原始 product
 * @param {object|null} tpl 类目模板（可为 null）
 * @param {object} opts { checkFiles?: boolean }
 */
export function validateProduct(product, tpl = null, opts = {}) {
  const errors = []
  const warnings = []
  const checkFiles = opts.checkFiles !== false
  const p = { ...(product || {}) }

  // ══ 1 标题 ══
  const title = String(p.title || '').trim()
  if (!title) errors.push('title（标题）必填')
  else if (title.length > MAX_TITLE) errors.push(`title 超过 ${MAX_TITLE} 字（当前 ${title.length}）`)
  p.title = title

  // ══ 2 主图 ══
  let images = Array.isArray(p.images) ? p.images.filter(Boolean) : []
  if (!images.length) errors.push('images（主图）至少 1 张')
  if (images.length > MAX_MAIN_IMAGES) {
    warnings.push(`主图 ${images.length} 张，超过 ${MAX_MAIN_IMAGES} 张上限，只取前 ${MAX_MAIN_IMAGES} 张`)
    images = images.slice(0, MAX_MAIN_IMAGES)
  }
  if (checkFiles) {
    images.forEach((f, i) => {
      if (!isImagePath(f)) errors.push(`images[${i}] 不是图片: ${path.basename(f)}`)
      const fi = fileInfo(f)
      if (!fi.exists) errors.push(`images[${i}] 文件不存在: ${f}`)
      else if (fi.sizeMB > MAX_IMAGE_MB) errors.push(`images[${i}] 超过 ${MAX_IMAGE_MB}MB（${fi.sizeMB.toFixed(1)}MB）`)
    })
  }
  p.images = images

  // ══ 3 详情图 ══
  let details = Array.isArray(p.detailImages) ? p.detailImages.filter(Boolean) : []
  if (details.length > MAX_DETAIL_IMAGES) {
    warnings.push(`详情图 ${details.length} 张，超过 ${MAX_DETAIL_IMAGES} 张，只取前 ${MAX_DETAIL_IMAGES} 张`)
    details = details.slice(0, MAX_DETAIL_IMAGES)
  }
  if (checkFiles) {
    details.forEach((f, i) => {
      if (!isImagePath(f)) warnings.push(`detailImages[${i}] 不是图片: ${path.basename(f)}`)
      const fi = fileInfo(f)
      if (!fi.exists) errors.push(`detailImages[${i}] 文件不存在: ${f}`)
      else if (fi.sizeMB > MAX_IMAGE_MB) warnings.push(`detailImages[${i}] 超过 ${MAX_IMAGE_MB}MB（${fi.sizeMB.toFixed(1)}MB）`)
    })
  }
  p.detailImages = details

  // ══ 4 类目 ══
  const catId = Number(p.catId || p.category_id || tpl?.category?.catId || 0)
  if (!catId && !p.category) errors.push('catId 或 category 至少填一个')
  if (!catId && !tpl) errors.push('无法确定类目模板（模板目录里没有匹配项）')
  p.catId = catId || undefined

  // ══ 5 规格 ══
  let specs = Array.isArray(p.specs) ? p.specs : []
  if (specs.length > 2) errors.push(`规格最多 2 维（当前 ${specs.length} 维）`)
  const dimNames = new Set()
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i] || {}
    const nm = String(s.name || '').trim()
    const vs = Array.isArray(s.values) ? s.values.map(v => String(v ?? '').trim()).filter(Boolean) : []
    if (!nm) errors.push(`specs[${i}].name 为空`)
    if (!vs.length) errors.push(`specs[${i}]（${nm || i}）values 为空`)
    if (dimNames.has(nm)) errors.push(`规格维度重名: ${nm}`)
    dimNames.add(nm)
    // 模板校验：维度名是否在模板里
    if (tpl?.specs?.dimensions?.length) {
      const hit = tpl.specs.dimensions.find(d => d.name === nm || d.name.includes(nm) || nm.includes(d.name))
      if (!hit) warnings.push(`规格维度「${nm}」不在模板里（模板有：${tpl.specs.dimensions.map(d => d.name).join('/')}）`)
    }
    specs[i] = { name: nm, values: [...new Set(vs)] }
  }
  p.specs = specs

  // ══ 6 SKU ══
  let skus = Array.isArray(p.skus) ? p.skus : []
  const expected = specs.length ? specs.reduce((n, s) => n * s.values.length, 1) : 1

  if (!skus.length) {
    errors.push('skus 为空')
  } else {
    if (skus.length !== expected) {
      errors.push(`skus 行数 ${skus.length} ≠ 规格组合数 ${expected}（${specs.map(s => `${s.name}×${s.values.length}`).join(' × ')}）`)
    }

    // 顶层默认值兜底
    const topStock = p.stock
    const topItemNo = p.itemNo
    const topPrice = p.price

    const normSkus = skus.map((s, i) => {
      const o = { ...s }
      // 库存
      const stock = o.stock ?? o.quantity ?? topStock
      if (stock === undefined || stock === null || stock === '') errors.push(`skus[${i}].stock 缺失`)
      else if (!Number.isFinite(Number(stock)) || Number(stock) < 0) errors.push(`skus[${i}].stock 非法: ${stock}`)
      o.stock = stock === undefined || stock === null || stock === '' ? undefined : Number(stock)

      // 单买价
      const price = o.price ?? o.singlePrice ?? topPrice
      if (price === undefined || price === null || price === '') errors.push(`skus[${i}].price（单买价）缺失`)
      else if (!Number.isFinite(Number(price)) || Number(price) <= 0) errors.push(`skus[${i}].price 非法: ${price}`)
      o.price = price === undefined || price === null || price === '' ? undefined : Number(price)

      // 拼单价
      const multi = o.multiPrice ?? o.groupPrice ?? topPrice
      if (multi === undefined || multi === null || multi === '') warnings.push(`skus[${i}].multiPrice（拼单价）缺失，将用单买价`)
      else if (!Number.isFinite(Number(multi)) || Number(multi) <= 0) errors.push(`skus[${i}].multiPrice 非法: ${multi}`)
      o.multiPrice = multi === undefined || multi === null || multi === '' ? undefined : Number(multi)

      // 拼单价 < 单买价（至少差 1）
      if (Number.isFinite(o.multiPrice) && Number.isFinite(o.price)) {
        if (o.multiPrice >= o.price) errors.push(`skus[${i}] 拼单价 ${o.multiPrice} 必须小于单买价 ${o.price}`)
        else if (o.price - o.multiPrice < 1) warnings.push(`skus[${i}] 单买价仅比拼单价高 ${(o.price - o.multiPrice).toFixed(2)}，平台要求至少 1 元`)
      }

      // 货号
      o.itemNo = o.itemNo || o.skuSn || topItemNo || ''
      return o
    })

    // 规格覆盖检查
    if (specs.length) {
      for (let i = 0; i < normSkus.length; i++) {
        const sp = normSkus[i].specs || {}
        for (const dim of specs) {
          if (!(dim.name in sp)) errors.push(`skus[${i}] 缺少规格维度「${dim.name}」`)
          else if (!dim.values.includes(String(sp[dim.name]))) {
            errors.push(`skus[${i}] 的「${dim.name}」= ${sp[dim.name]} 不在可选值 [${dim.values.join(',')}]`)
          }
        }
      }
    }
    p.skus = normSkus
  }

  // ══ 7 参考价 ══
  if (p.price !== undefined && p.price !== null && p.price !== '') {
    const ref = Number(p.price)
    const maxPrice = Math.max(...(p.skus || []).map(s => Number(s.price) || 0))
    if (!Number.isFinite(ref) || ref <= 0) errors.push(`price（参考价）非法: ${p.price}`)
    else if (maxPrice > 0 && ref > maxPrice * 5) {
      errors.push(`参考价 ${ref} 超过最高单买价 ${maxPrice} 的 5 倍（上限 ${(maxPrice * 5).toFixed(2)}）`)
    }
    p.price = ref
  } else {
    // 不传 → 自动算，删除字段让 step13 自己算
    delete p.price
    warnings.push('未传 price（参考价），将由 step13 自动 = 最大单买价 + 1')
  }

  // ══ 8 其他 ══
  if (p.discount !== undefined) {
    const d = Number(p.discount)
    if (!Number.isFinite(d) || d < 5 || d > 9.9) errors.push(`discount（满件折扣）需在 5.0~9.9，当前 ${p.discount}`)
    else p.discount = d
  }
  p.shipTime = p.shipTime || '48小时'
  p.whiteBg = p.whiteBg || p.white_bg || ''

  // ══ 9 属性 ══
  if (p.attributes && typeof p.attributes !== 'object') errors.push('attributes 必须是对象 { 属性名: 值 }')

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalized: p,
  }
}

/** 人话摘要 */
export function summarize(v) {
  const lines = []
  if (v.ok) lines.push('✅ 校验通过')
  else lines.push(`❌ 校验失败（${v.errors.length} 项）`)
  if (v.errors.length) {
    lines.push('')
    lines.push('【错误】')
    v.errors.slice(0, 30).forEach(e => lines.push('  • ' + e))
    if (v.errors.length > 30) lines.push(`  … 还有 ${v.errors.length - 30} 条`)
  }
  if (v.warnings.length) {
    lines.push('')
    lines.push('【警告】')
    v.warnings.slice(0, 20).forEach(w => lines.push('  • ' + w))
    if (v.warnings.length > 20) lines.push(`  … 还有 ${v.warnings.length - 20} 条`)
  }
  return lines.join('\n')
}

export default validateProduct
