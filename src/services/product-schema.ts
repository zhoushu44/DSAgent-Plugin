/**
 * 统一商品数据格式（ProductData）—— 发布类技能（拼多多 / 淘宝 / 闲鱼 …）共用的商品描述。
 *
 * 设计目标（用户诉求「商品数据要统一一点」）：
 *   1. **一个 JSON 描述一件商品**，替代各平台各写一套扁平字符串参数；
 *   2. 规格用**维度数组**表达（颜色 / 尺码 …，最多 2 维），SKU 用**维度名 → 规格值**的
 *      组合表达，天然支持「颜色 × 尺码」二维矩阵；
 *   3. 商品属性用**显式 name→value**表达（可选），比「靠模型从页面选项里猜」可控；
 *   4. 解析器兼容既有富格式（如 skills/pdd-link-matrix 产出的
 *      `{ colors[], sizes[], skus[{颜色,尺码,折后价(元),可订库存}], attributes[{name,value,group}] }`），
 *      让老数据零改造即可喂进新工具。
 *
 * 本模块**只做**「解析 / 归一化 / 校验」，不含任何平台细节；
 * 平台映射（→ 各平台发布选项）放在各平台自己的模块里（如 pdd-publish2.ts 的 toPddOptions）。
 */

/** 一个规格值（如「奶油黄」），可选带该值的预览图（拼多多 SKU 预览图按规格值上传） */
export interface ProductSpecValue {
  value: string
  /** 该规格值的预览图本地绝对路径（选填；拼多多按「颜色」上传预览图） */
  image?: string
}

/** 一个规格维度（如「颜色」「尺码」）。平台普遍最多支持 2 个维度 */
export interface ProductSpecDimension {
  name: string
  values: ProductSpecValue[]
}

/** 一行 SKU：规格组合 + 该行的价格 / 库存 / 编码（缺项回落到顶层值） */
export interface ProductSku {
  /** 规格组合：维度名 → 规格值，如 { 颜色: '奶油黄', 尺码: '110cm' } */
  specs: Record<string, string>
  /** 该 SKU 的拼单价（元，字符串数字） */
  price?: string
  /** 该 SKU 的库存（件，字符串数字） */
  stock?: string
  /** 该 SKU 的商家编码 / 货号 */
  itemNo?: string
}

/** 一项商品属性（显式指定，命中页面下拉选项才生效） */
export interface ProductAttribute {
  name: string
  value: string
}

/** 统一商品数据 */
export interface ProductData {
  /** 商品标题（必填） */
  title: string
  /** 主图本地绝对路径列表（至少 1 张） */
  images: string[]
  /** 详情图本地绝对路径列表（选填） */
  detailImages?: string[]
  /** 类目关键词或完整路径（选填；不传由平台从标题推断） */
  category?: string
  /** 商品参考价（元，字符串数字，选填） */
  price?: string
  /** 默认库存（件，字符串数字，选填；SKU 行未给库存时回落） */
  stock?: string
  /** 商家编码 / 货号（选填） */
  itemNo?: string
  /** 规格维度（选填，最多 2 维）；提供后 SKU 用维度组合表达 */
  specs?: ProductSpecDimension[]
  /** 逐行 SKU（选填，与 specs 配合） */
  skus?: ProductSku[]
  /** 商品属性（选填，显式 name→value） */
  attributes?: ProductAttribute[]
  /** 指定账号 shopKey（选填） */
  account?: string
}

/** 解析结果 */
export interface ParseProductResult {
  product?: ProductData
  error?: string
}

const str = (v: unknown): string => (v == null ? '' : String(v)).trim()

/** 把「数组 | 逗号分隔字符串 | JSON 数组字符串」统一成字符串数组 */
function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter(Boolean)
  const s = str(v)
  if (!s) return []
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s)
      if (Array.isArray(parsed)) return parsed.map(str).filter(Boolean)
    } catch { /* 落到逗号分隔 */ }
  }
  return s.split(',').map(t => t.trim()).filter(Boolean)
}

/** 从任意对象里取一个字段（忽略大小写与首尾空白） */
function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] != null) return obj[k]
    const lower = k.toLowerCase()
    for (const kk of Object.keys(obj)) {
      if (kk.toLowerCase() === lower) return obj[kk]
    }
  }
  return undefined
}

/** 归一化规格维度数组 */
function normalizeSpecs(raw: unknown): ProductSpecDimension[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: ProductSpecDimension[] = []
  for (const d of raw) {
    if (!d || typeof d !== 'object') continue
    const o = d as Record<string, unknown>
    const name = str(pick(o, 'name', '维度', '维度名', '规格名'))
    if (!name) continue
    const rawVals = pick(o, 'values', '值', '规格值')
    const values: ProductSpecValue[] = []
    if (Array.isArray(rawVals)) {
      for (const v of rawVals) {
        if (v && typeof v === 'object') {
          const vo = v as Record<string, unknown>
          const val = str(pick(vo, 'value', '值', 'name'))
          if (val) values.push({ value: val, image: str(pick(vo, 'image', '图', '预览图')) || undefined })
        } else {
          const val = str(v)
          if (val) values.push({ value: val })
        }
      }
    }
    if (values.length) out.push({ name, values })
  }
  return out.length ? out : undefined
}

/** 归一化 SKU 数组 */
function normalizeSkus(raw: unknown, specNames: string[]): ProductSku[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: ProductSku[] = []
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue
    const o = s as Record<string, unknown>
    // 规格组合：优先取 `specs` 对象；否则用维度名做扁平键（兼容富格式）
    let specs: Record<string, string> = {}
    const rawSpecs = pick(o, 'specs', 'spec', '规格')
    if (rawSpecs && typeof rawSpecs === 'object' && !Array.isArray(rawSpecs)) {
      for (const [k, v] of Object.entries(rawSpecs as Record<string, unknown>)) {
        const val = str(v)
        if (val) specs[k] = val
      }
    }
    for (const n of specNames) {
      if (!specs[n]) {
        const val = str(pick(o, n))
        if (val) specs[n] = val
      }
    }
    if (!Object.keys(specs).length) continue
    out.push({
      specs,
      price: str(pick(o, 'price', '拼单价', '折后价(元)', '折后价', '原价(元)', '原价', '价格')) || undefined,
      stock: str(pick(o, 'stock', '库存', '可订库存')) || undefined,
      itemNo: str(pick(o, 'itemNo', '货号', '商家编码', '规格编码')) || undefined,
    })
  }
  return out.length ? out : undefined
}

/** 归一化属性数组（兼容 {name,value,group} 富格式） */
function normalizeAttributes(raw: unknown): ProductAttribute[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: ProductAttribute[] = []
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue
    const o = a as Record<string, unknown>
    const name = str(pick(o, 'name', '属性名', '名'))
    const value = str(pick(o, 'value', '属性值', '值'))
    if (name && value) out.push({ name, value })
  }
  return out.length ? out : undefined
}

/**
 * 解析统一商品数据。接受：
 *   - 对象（已解析的 ProductData / 富格式）
 *   - JSON 字符串
 * 返回 { product } 或 { error }。
 */
export function parseProduct(raw: unknown): ParseProductResult {
  let obj: Record<string, unknown> | null = null
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>
  } else if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return { error: '商品数据为空（product 必填）' }
    try {
      const parsed = JSON.parse(s)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: '商品数据必须是一个 JSON 对象' }
      }
      obj = parsed as Record<string, unknown>
    } catch (e) {
      return { error: `商品数据不是合法 JSON：${e instanceof Error ? e.message : String(e)}` }
    }
  } else {
    return { error: '商品数据格式不支持（应为对象或 JSON 字符串）' }
  }

  const title = str(pick(obj, 'title', '标题', '商品标题'))
  const images = toStringArray(pick(obj, 'images', '主图', '图片'))
  const detailImages = toStringArray(pick(obj, 'detailImages', 'detail_images', '详情图', '详情图片'))
  const category = str(pick(obj, 'category', 'categoryKeyword', '类目'))
  const price = str(pick(obj, 'price', '参考价', '商品参考价'))
  const stock = str(pick(obj, 'stock', '库存'))
  const itemNo = str(pick(obj, 'itemNo', '货号', '商家编码'))
  const account = str(pick(obj, 'account', 'shopKey', '账号'))

  // ── 规格维度：优先 specs；否则从富格式的 colors[] / sizes[] 合成 ──
  let specs = normalizeSpecs(pick(obj, 'specs', '规格', '规格维度'))
  if (!specs) {
    const colors = toStringArray(pick(obj, 'colors', '颜色'))
    const sizes = toStringArray(pick(obj, 'sizes', '尺码'))
    const synth: ProductSpecDimension[] = []
    if (colors.length) synth.push({ name: '颜色', values: colors.map(v => ({ value: v })) })
    if (sizes.length) synth.push({ name: '尺码', values: sizes.map(v => ({ value: v })) })
    if (synth.length) specs = synth
  }
  const specNames = (specs || []).map(d => d.name)
  const skus = normalizeSkus(pick(obj, 'skus', 'sku', 'SKU'), specNames)
  const attributes = normalizeAttributes(pick(obj, 'attributes', '属性', 'params'))

  // ── price 兜底：从富格式 price_range「34.00 ~ 42.00」或首个 SKU 价推断 ──
  let resolvedPrice = price
  if (!resolvedPrice) {
    const range = str(pick(obj, 'price_range', 'priceRange'))
    if (range) resolvedPrice = str(range.split('~')[0])
  }
  if (!resolvedPrice && skus?.length) resolvedPrice = skus.find(s => s.price)?.price || ''

  return {
    product: {
      title,
      images,
      detailImages: detailImages.length ? detailImages : undefined,
      category: category || undefined,
      price: resolvedPrice || undefined,
      stock: stock || undefined,
      itemNo: itemNo || undefined,
      specs,
      skus,
      attributes,
      account: account || undefined,
    },
  }
}

/** 数字校验：返回错误文案或 null */
function checkNum(label: string, v: string | undefined, integer: boolean): string | null {
  const s = str(v)
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return `${label}不是合法数字：${s}`
  if (integer) {
    if (!Number.isInteger(n) || n < 0) return `${label}应为非负整数：${s}`
  } else if (n <= 0) {
    return `${label}应为正数：${s}`
  }
  if (n > 100_000_000) return `${label}过大（上限 1 亿）：${s}`
  return null
}

/**
 * 校验统一商品数据。返回错误文案（首条）或 null（通过）。
 * 只做本地可判定的校验；宽高比 / 分辨率 / 文件大小等平台规则交由各平台 mapper 复核。
 */
export function validateProduct(p: ProductData): string | null {
  if (!str(p.title)) return '缺少 title（商品标题必填）'
  if (str(p.title).length > 60) return `商品标题超过 60 个字符（当前 ${str(p.title).length} 个）`
  if (!p.images?.length) return '缺少 images（主图，至少 1 张）'
  const ePrice = checkNum('商品参考价', p.price, false)
  if (ePrice) return ePrice
  const eStock = checkNum('库存', p.stock, true)
  if (eStock) return eStock

  const specs = p.specs || []
  if (specs.length > 2) return `规格维度最多 2 个（当前 ${specs.length} 个）`
  const seenDim = new Set<string>()
  for (const d of specs) {
    if (!str(d.name)) return '存在规格维度缺少 name'
    if (seenDim.has(d.name)) return `规格维度名重复：${d.name}`
    seenDim.add(d.name)
    if (!d.values?.length) return `规格维度「${d.name}」没有任何规格值`
    if (d.values.length > 20) return `规格维度「${d.name}」的规格值超过 20 个（当前 ${d.values.length} 个）`
    const seenVal = new Set<string>()
    for (const v of d.values) {
      if (!str(v.value)) return `规格维度「${d.name}」存在空规格值`
      if (seenVal.has(v.value)) return `规格维度「${d.name}」的规格值重复：${v.value}`
      seenVal.add(v.value)
    }
  }

  const skus = p.skus || []
  if (skus.length > 200) return `SKU 组合数过多（当前 ${skus.length} 个，上限 200）`
  for (let i = 0; i < skus.length; i++) {
    const s = skus[i]
    if (!s.specs || !Object.keys(s.specs).length) return `第 ${i + 1} 个 SKU 缺少规格组合（specs）`
    for (const d of specs) {
      if (!str(s.specs[d.name])) {
        return `第 ${i + 1} 个 SKU 缺少规格维度「${d.name}」的值`
      }
    }
    const ep = checkNum(`SKU「${Object.values(s.specs).join('/')}」拼单价`, s.price, false)
    if (ep) return ep
    const es = checkNum(`SKU「${Object.values(s.specs).join('/')}」库存`, s.stock, true)
    if (es) return es
  }
  return null
}

/** 展开 SKU 矩阵：specs 全组合（仅用于预览展示，不改变用户数据） */
export function expandSpecMatrix(specs: ProductSpecDimension[]): string[][] {
  let rows: string[][] = [[]]
  for (const d of specs) {
    const next: string[][] = []
    for (const r of rows) for (const v of d.values) next.push([...r, v.value])
    rows = next
  }
  return rows
}
