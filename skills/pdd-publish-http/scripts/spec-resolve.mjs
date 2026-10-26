/**
 * 规格解析 v2 —— 支持「自由维度」，值写什么就是什么。
 *
 * ★ 关键事实（2026-10-26 实测确认）
 *
 *   拼多多的规格维度分两类：
 *
 *   ① 字典维度 —— 颜色分类 / 参考分类
 *      值必须来自平台字典，提交 spec_id。你写「清紫梅花」但 spec_id 是
 *      「格蕾灰」的，平台就会按 id 还原成「格蕾灰」。**做不到自定义。**
 *
 *   ② 自由维度 —— 款式 / 型号 / 规格 / 自定义
 *      值是纯文本，**不依赖字典**。写「14盎司小熊咖啡杯」就原样保留。
 *      这才是「我要什么就写什么」的正确入口。
 *
 *   所以本模块的职责：
 *     · 自由维度 → 值原样提交（spec_id 留 0，由平台按文本建）
 *     · 字典维度 → 必须查到真实 spec_id，查不到就明确报错（绝不借位）
 */

/** 字典维度（值不可自定义，必须命中库） */
const DICT_DIM_RE = /^颜色分类$|^参考分类$|^颜色$|^尺码$|^尺寸$/i

/** 自由维度（值可自定义） */
const FREE_DIM_RE = /款式|型号|规格|自定义|图案|样式|版型|风格|系列|口味|容量|净含量/i

/**
 * 判断维度类型
 * @returns 'free' | 'dict'
 */
export function dimKind(name) {
  const n = String(name || '').trim()
  if (!n) return 'dict'
  // 自由维度优先判定（款式既像颜色又该自由，必须走 free）
  if (FREE_DIM_RE.test(n)) return 'free'
  if (DICT_DIM_RE.test(n)) return 'dict'
  // 其余一律按自由处理（自定义维度名必然是自由）
  return 'free'
}

/** 去 cm / 厘米后缀，做宽松匹配 */
const stripUnit = (s) => String(s || '').replace(/(cm|厘米|CM)$/i, '').trim()

/** 在字典里查值（仅用于字典维度） */
export function lookupDict(pool, value) {
  const want = String(value || '').trim()
  if (!want) return null
  const all = []
  for (const vals of Object.values(pool || {})) {
    for (const [v, rec] of Object.entries(vals || {})) {
      if (!rec?.spec_id) continue
      all.push({
        value: v, spec_id: rec.spec_id,
        parent_id: rec.parent_spec_id ?? rec.parent_id ?? 0,
      })
    }
  }
  return all.find(c => c.value === want)
    || all.find(c => stripUnit(c.value) === stripUnit(want))
    || all.find(c => c.value.toLowerCase() === want.toLowerCase())
    || null
}

/**
 * 解析整份商品的规格。
 *
 * 自由维度 → 直接放行（spec_id=0，平台按文本建）
 * 字典维度 → 必须查到，查不到进 missing
 *
 * @returns {{
 *   specIds: Record<string,{spec_id,parent_id}>,
 *   freeValues: string[],
 *   resolved: Array<{dim,value,kind,spec_id}>,
 *   missing: Array<{dim,value,reason}>,
 *   dims: Array<{name,kind,count}>,
 *   notes: string[],
 *   ok: boolean,
 * }}
 */
export function resolveSpecs(product, pool) {
  const specIds = {}
  const freeValues = []
  const resolved = []
  const missing = []
  const dims = []
  const notes = []

  const specs = Array.isArray(product?.specs) ? product.specs : []

  for (const dim of specs) {
    const kind = dimKind(dim.name)
    const values = (dim.values || [])
      .map(v => (v && typeof v === 'object') ? String(v.value ?? '').trim() : String(v ?? '').trim())
      .filter(Boolean)
    dims.push({ name: dim.name, kind, count: values.length })

    for (const val of values) {
      if (kind === 'free') {
        // 自由维度：原样放行，不查库
        freeValues.push(val)
        resolved.push({ dim: dim.name, value: val, kind, spec_id: 0 })
        notes.push(`「${dim.name}=${val}」自由维度，原样提交`)
      } else {
        const hit = lookupDict(pool, val)
        if (hit) {
          specIds[val] = { spec_id: hit.spec_id, parent_id: hit.parent_id }
          resolved.push({ dim: dim.name, value: val, kind, spec_id: hit.spec_id })
        } else {
          missing.push({
            dim: dim.name, value: val,
            reason: `字典维度「${dim.name}」里没有「${val}」，且此维度不支持自定义`,
          })
        }
      }
    }
  }

  // 字典维度的 id 不能重复
  const ids = Object.values(specIds).map(x => x.spec_id)
  const dup = ids.length - new Set(ids).size
  if (dup > 0) notes.push(`⚠ 字典维度有 ${dup} 个重复 spec_id，平台会判「重复的规格Id」`)

  const ok = missing.length === 0 && dup === 0

  if (missing.length) {
    notes.push(`❌ ${missing.length} 个值无法解析：`)
    for (const m of missing) notes.push(`   · ${m.dim} = ${m.value}`)
    notes.push('   解决：改用自由维度（款式/型号），或在后台新增该字典值')
  }

  return { specIds, freeValues, resolved, missing, dims, notes, ok }
}

/** 兼容旧接口 */
export function borrowSpecIds(product, pool) {
  const r = resolveSpecs(product, pool)
  return { product, specIds: r.specIds, notes: r.notes, missing: r.missing, ok: r.ok }
}

/**
 * SKU 矩阵生成：支持任意维度 + 行级价格/库存
 *
 * ★ 2026-10-26 修复三个缺陷：
 *   ① 原来只支持 1~2 维，第 3 维及以后被**静默丢弃** → 现在笛卡尔积任意维
 *   ② 原来所有行都用同一个 price/stock → 现在支持 product.skus 行级覆盖
 *   ③ 原来不校验行数与维度组合数是否一致 → 现在报告 mismatch
 *
 * @param dims   规格维度 [{name, values:[{value}|string]}]
 * @param price  默认拼单价
 * @param stock  默认库存
 * @param rows   可选：行级覆盖 [{specs:{维度:值}, price, stock, itemNo?}]
 * @returns {Array<{specs, price, stock}>}
 */
export function buildSkuMatrix(dims, price, stock, rows = null) {
  const valOf = (v) => (v && typeof v === 'object')
    ? String(v.value ?? '').trim()
    : String(v ?? '').trim()

  const ds = (dims || [])
    .map(d => ({ name: d?.name, values: (d?.values || []).map(valOf).filter(Boolean) }))
    .filter(d => d.name && d.values.length)

  if (!ds.length) return []

  // ① 笛卡尔积（任意维度）
  let combos = [{}]
  for (const d of ds) {
    const next = []
    for (const c of combos) {
      for (const v of d.values) next.push({ ...c, [d.name]: v })
    }
    combos = next
  }

  // ② 行级覆盖索引：用「维度值按维度名排序后拼接」做 key
  const keyOf = (specsObj, dimNames) =>
    dimNames.map(n => String(specsObj?.[n] ?? '').trim()).join('\u0001')

  const dimNames = ds.map(d => d.name)
  const rowMap = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const sp = r?.specs || r || {}
    rowMap.set(keyOf(sp, dimNames), r)
  }

  // ③ 生成，价格/库存按行覆盖优先
  return combos.map(c => {
    const hit = rowMap.get(keyOf(c, dimNames))
    return {
      specs: c,
      price: String(hit?.price ?? price ?? ''),
      stock: String(hit?.stock ?? stock ?? ''),
      ...(hit?.itemNo ? { itemNo: hit.itemNo } : {}),
    }
  })
}

/**
 * 校验 skus 行是否覆盖全部维度组合
 * @returns {{ok:boolean, expected:number, actual:number, missing:string[], extra:string[]}}
 */
export function lintSkuMatrix(dims, rows) {
  const valOf = (v) => (v && typeof v === 'object') ? String(v.value ?? '').trim() : String(v ?? '').trim()
  const ds = (dims || [])
    .map(d => ({ name: d?.name, values: (d?.values || []).map(valOf).filter(Boolean) }))
    .filter(d => d.name && d.values.length)
  if (!ds.length) return { ok: true, expected: 0, actual: 0, missing: [], extra: [] }

  let expected = 1
  for (const d of ds) expected *= d.values.length

  const dimNames = ds.map(d => d.name)
  const keyOf = (o) => dimNames.map(n => String(o?.[n] ?? '').trim()).join('\u0001')

  const want = new Set()
  let combos = [{}]
  for (const d of ds) {
    const next = []
    for (const c of combos) for (const v of d.values) next.push({ ...c, [d.name]: v })
    combos = next
  }
  for (const c of combos) want.add(keyOf(c))

  const got = new Set()
  for (const r of Array.isArray(rows) ? rows : []) got.add(keyOf(r?.specs || r))

  const missing = [...want].filter(k => !got.has(k)).map(k => k.split('\u0001').join(' / '))
  const extra = [...got].filter(k => !want.has(k)).map(k => k.split('\u0001').join(' / '))

  return { ok: missing.length === 0 && extra.length === 0, expected, actual: got.size, missing, extra }
}
