/**
 * 维度 parent_id 缓存与解析。
 *
 * 背景：拼多多提交 SKU 时每个规格值需要 parent_id（维度编号）。
 *   · 字典维度（颜色分类 / 参考分类）→ 从 spec-pool 拿
 *   · 自由维度（款式 / 型号 / 容量…）→ parent_id 也是平台固定值，
 *     但 spec-pool 里没有，需要一次性采集后缓存
 *
 * 缓存文件：assets/dim-parent.json
 *   { "款式": 123456789, "容量": 987654321, "颜色分类": 8640, "参考分类": 1445193069 }
 *
 * 采集途径（任一成功即可，之后永久复用）：
 *   ① 从商品编辑页响应里抓 spec_key + parent_spec_id
 *   ② 用户手工加一次该维度并保存，脚本从提交包里读到
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const DICT_DIM_RE = /^颜色分类$|^参考分类$|^颜色$|^尺码$|^尺寸$/i
const FREE_DIM_RE = /款式|型号|规格|自定义|图案|样式|版型|风格|系列|口味|容量|净含量/i

export function dimKind(name) {
  const n = String(name || '').trim()
  if (!n) return 'dict'
  if (FREE_DIM_RE.test(n)) return 'free'
  if (DICT_DIM_RE.test(n)) return 'dict'
  return 'free'
}

/** 读维度缓存 */
export function loadDimCache(file) {
  try {
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'))
      return (j && typeof j === 'object') ? j : {}
    }
  } catch { /* ignore */ }
  return {}
}

/** 写维度缓存（合并） */
export function saveDimCache(file, dims) {
  const cur = loadDimCache(file)
  let changed = false
  for (const [name, pid] of Object.entries(dims || {})) {
    if (!name || !pid) continue
    if (cur[name] !== pid) { cur[name] = pid; changed = true }
  }
  if (changed) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(cur, null, 2), 'utf8')
    } catch { /* ignore */ }
  }
  return cur
}

/**
 * 从 spec-pool 推导维度 parent_id（字典维度天然有）。
 * 取该维度下任一值的 parent_spec_id 即可（同维度内一致）。
 */
export function dimParentsFromPool(pool) {
  const out = {}
  for (const [dim, vals] of Object.entries(pool || {})) {
    for (const rec of Object.values(vals || {})) {
      const pid = rec?.parent_spec_id ?? rec?.parent_id
      if (pid) { out[dim] = pid; break }
    }
  }
  return out
}

/**
 * 为一次发布解析每个维度的 parent_id。
 *
 * @returns {{
 *   parents: Record<string, number>,
 *   missing: string[],
 *   notes: string[],
 * }}
 */
export function resolveDimParents(specs, pool, cache) {
  const fromPool = dimParentsFromPool(pool)
  const parents = {}
  const missing = []
  const notes = []

  for (const dim of specs || []) {
    const name = String(dim?.name || '').trim()
    if (!name) continue
    const kind = dimKind(name)
    const pid = cache?.[name] || fromPool[name]
    if (pid) {
      parents[name] = pid
      notes.push(`维度「${name}」(${kind}) parent_id=${pid}`
        + (cache?.[name] ? '（缓存）' : '（规格池）'))
    } else {
      missing.push(name)
      notes.push(`维度「${name}」(${kind}) 缺少 parent_id`)
    }
  }
  return { parents, missing, notes }
}
