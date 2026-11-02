/**
 * 发布组件 · 类目模板 v2（带完整候选）
 *
 * ★ 为什么改（2026-11-02）
 *   v1 模板只存 {name, value}，没存 options。
 *   导致第二次发布时：
 *     · 用户值不在候选里 → 不知道能改成什么 → 必须重新扫描读候选
 *     · 每次扫描 3-6 秒 × 3 次 ≈ 10-18 秒（占单商品耗时 30%+）
 *
 * ★ v2 结构
 *   {
 *     catId, catePath, dims, updatedAt, successCount,
 *     attrs: [
 *       { name, value, required, kind, options: [...], optionCount }
 *     ]
 *   }
 *
 * ★ 收益
 *   第二次发布：属性环节从 ~15 秒 → ~2 秒（纯点击，0 扫描）
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.join(__dirname, '..', 'assets', 'category-template.json')

const VERSION = 2

/** 读全部模板 */
export function loadTemplates() {
  try {
    if (!fs.existsSync(FILE)) return {}
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}
  } catch {
    return {}
  }
}

/** 写全部模板 */
function saveAll(all) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf8')
}

/** 归一化类目名（去空格） */
const norm = s => String(s || '').replace(/\s+/g, '').trim()

/**
 * 找模板（支持模糊匹配类目名）
 */
export function findTemplate(categoryKeyword) {
  const all = loadTemplates()
  const want = norm(categoryKeyword)
  if (!want) return null

  // ① 精确
  if (all[categoryKeyword]) return all[categoryKeyword]
  for (const k of Object.keys(all)) {
    if (norm(k) === want) return all[k]
  }
  // ② 包含
  for (const k of Object.keys(all)) {
    const kn = norm(k)
    if (kn.includes(want) || want.includes(kn)) return all[k]
  }
  return null
}

/**
 * 保存模板（v2 结构，带 options）
 *
 * @param categoryKeyword 类目关键词
 * @param info { catId, catePath, dims, attrs, price, stock, goodsId }
 *   attrs: [{ name, value, required, kind, options }]
 */
export function saveTemplate(categoryKeyword, info) {
  const all = loadTemplates()
  const key = categoryKeyword || info.catId || 'unknown'
  const prev = all[key] || {}

  // 合并 attrs：保留旧值，新值覆盖
  const oldAttrs = Array.isArray(prev.attrs) ? prev.attrs : []
  const newAttrs = Array.isArray(info.attrs) ? info.attrs : []

  // ★ 2026-11-02 防污染：若本次传入了 pageFields（页面上真实存在的字段），
  //   只保留这些字段 —— 避免把其他类目的属性累积进来。
  //   实测毛巾：模板累积到 33 个属性，其中 20 个是睡衣的（袖长/下装长/衣门襟/领型...）
  let allowed = null
  const pageFieldNames = Array.isArray(info.pageFields)
    ? info.pageFields.map(f => norm(f.name || f)).filter(Boolean)
    : []
  if (pageFieldNames.length) {
    allowed = new Set(pageFieldNames)
    const dropped = newAttrs
      .map(a => norm(a.name))
      .filter(n => n && !allowed.has(n) && ![...allowed].some(an => an.includes(n) || n.includes(an)))
    if (dropped.length) {
      console.log(`[template] 过滤 ${dropped.length} 个非本类目字段：${dropped.slice(0, 5).join('、')}${dropped.length > 5 ? ' 等' : ''}`)
    }
  }

  // ★ 若页面字段数远少于已有 attrs（<50%），判定为「类目结构变了」，重建而非合并
  if (allowed && oldAttrs.length && allowed.size < oldAttrs.length * 0.5) {
    console.log(`[template] 页面字段 ${allowed.size} 远少于模板 ${oldAttrs.length}，判定类目结构变化，重建`)
    oldAttrs.length = 0
  }

  const map = new Map()
  for (const a of oldAttrs) {
    const n = norm(a.name)
    if (!n) continue
    if (allowed && ![...allowed].some(an => an === n || an.includes(n) || n.includes(an))) continue
    map.set(n, a)
  }
  for (const a of newAttrs) {
    const n = norm(a.name)
    if (!n) continue
    if (allowed && ![...allowed].some(an => an === n || an.includes(n) || n.includes(an))) continue
    const prevA = map.get(n) || {}
    map.set(n, {
      name: a.name || prevA.name,
      value: a.value != null && a.value !== '' ? a.value : (prevA.value || ''),
      required: a.required != null ? a.required : (prevA.required || false),
      kind: a.kind || prevA.kind || 'select',
      // ★ 关键：options 取并集，保留下所有候选
      options: Array.isArray(a.options) && a.options.length
        ? a.options
        : (Array.isArray(prevA.options) ? prevA.options : []),
      optionCount: Array.isArray(a.options) && a.options.length
        ? a.options.length
        : (prevA.optionCount || 0),
    })
  }

  const attrs = [...map.values()].filter(a => a.name)

  all[key] = {
    version: VERSION,
    catId: info.catId || prev.catId || '',
    catePath: info.catePath || prev.catePath || '',
    dims: Array.isArray(info.dims) && info.dims.length ? info.dims : (prev.dims || []),
    attrs,                                   // ★ v2 主字段
    requiredAttrs: attrs,                    // ★ 兼容旧字段名（内容同 attrs）
    price: info.price || prev.price || '',
    stock: info.stock || prev.stock || '',
    goodsId: info.goodsId || prev.goodsId || '',
    updatedAt: new Date().toISOString(),
    successCount: (prev.successCount || 0) + 1,
    _schema: 'v2',                           // 标记版本
  }

  saveAll(all)
  return all[key]
}

/**
 * 把 v1 模板升级到 v2（把 requiredAttrs 复制到 attrs，options 留空待补）
 */
export function upgradeTemplates() {
  const all = loadTemplates()
  let upgraded = 0
  for (const k of Object.keys(all)) {
    const t = all[k]
    if (t._schema === 'v2' || (Array.isArray(t.attrs) && t.attrs.length)) continue
    const from = Array.isArray(t.requiredAttrs) ? t.requiredAttrs : []
    t.attrs = from.map(a => ({
      name: a.name,
      value: a.value || '',
      required: a.required != null ? a.required : true,
      kind: a.kind || 'select',
      options: Array.isArray(a.options) ? a.options : [],
      optionCount: Array.isArray(a.options) ? a.options.length : 0,
    }))
    t.requiredAttrs = t.attrs
    t._schema = 'v2'
    t.version = VERSION
    upgraded++
  }
  if (upgraded) saveAll(all)
  return upgraded
}

/**
 * 取模板的 attrs（兼容 v1/v2）
 */
export function templateAttrs(t) {
  if (!t) return []
  if (Array.isArray(t.attrs) && t.attrs.length) return t.attrs
  if (Array.isArray(t.requiredAttrs) && t.requiredAttrs.length) return t.requiredAttrs
  return []
}

/**
 * 给模板补 options（发布后回写）
 *
 * @param categoryKeyword
 * @param pageFields  harvestAttributes 拿到的字段（含 options）
 */
export function enrichTemplateOptions(categoryKeyword, pageFields) {
  const all = loadTemplates()
  const key = Object.keys(all).find(k => norm(k) === norm(categoryKeyword))
    || Object.keys(all).find(k => norm(k).includes(norm(categoryKeyword)) || norm(categoryKeyword).includes(norm(k)))
  if (!key) return { updated: 0 }

  const t = all[key]
  const attrs = templateAttrs(t)
  let updated = 0

  for (const pf of pageFields || []) {
    const pn = norm(pf.name)
    if (!pn) continue
    const target = attrs.find(a => norm(a.name) === pn)
    if (!target) continue
    if (Array.isArray(pf.options) && pf.options.length) {
      target.options = pf.options
      target.optionCount = pf.options.length
      target.required = pf.required != null ? pf.required : target.required
      target.kind = pf.kind || target.kind || 'select'
      updated++
    }
  }

  if (updated) {
    t.attrs = attrs
    t.requiredAttrs = attrs
    t._schema = 'v2'
    t.updatedAt = new Date().toISOString()
    all[key] = t
    saveAll(all)
  }
  return { updated, key }
}


/**
 * 清理模板里的过期属性（页面上已不存在的）
 * @param categoryKeyword
 * @param pageFieldNames 当前页面上真实存在的字段名数组
 */
export function pruneStaleAttrs(categoryKeyword, pageFieldNames) {
  const all = loadTemplates()
  const key = Object.keys(all).find(k => norm(k) === norm(categoryKeyword))
  if (!key) return { pruned: 0, left: 0 }
  const t = all[key]
  const attrs = templateAttrs(t)
  const allowed = new Set((pageFieldNames || []).map(n => norm(n)).filter(Boolean))
  if (!allowed.size) return { pruned: 0, left: attrs.length }

  const kept = []
  const dropped = []
  for (const a of attrs) {
    const n = norm(a.name)
    if (allowed.has(n) || [...allowed].some(an => an.includes(n) || n.includes(an))) kept.push(a)
    else dropped.push(a.name)
  }
  t.attrs = kept
  t.requiredAttrs = kept
  t._schema = 'v2'
  t.updatedAt = new Date().toISOString()
  all[key] = t
  saveAll(all)
  return { pruned: dropped.length, left: kept.length, dropped: dropped.slice(0, 10) }
}
