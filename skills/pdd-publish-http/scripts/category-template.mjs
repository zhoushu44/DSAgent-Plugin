/**
 * 类目发布模板库 —— 成功上架后沉淀，下次同目录直接复用。
 *
 * 存什么（按类目关键词）：
 *   · catId / 类目路径      —— 下次不用重新猜类目
 *   · 维度映射（用户维度 → 页面实际维度 + 类型） —— 下次知道该填哪个框
 *   · 必填属性（材质成分等）  —— 下次直接带值
 *   · 价格/库存             —— 同品类参考
 *
 * 存哪：skills/pdd-publish-http/assets/category-template.json（跟 dim-parent.json 同级）
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const STORE = path.join(PLUGIN_ROOT, 'skills', 'pdd-publish-http', 'assets', 'category-template.json')

/** 读全部模板 */
export function loadTemplates() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'))
  } catch {
    return {}
  }
}

/** 按类目关键词找模板（支持「童装」命中「儿童睡衣」记录） */
export function findTemplate(categoryKeyword) {
  const all = loadTemplates()
  const kw = String(categoryKeyword || '').trim()
  if (!kw) return null
  if (all[kw]) return all[kw]
  // 模糊：记录的 key 包含关键词 或 关键词包含 key
  for (const [k, v] of Object.entries(all)) {
    if (k.includes(kw) || kw.includes(k)) return v
    if ((v.catePath || '').includes(kw)) return v
  }
  return null
}

/**
 * 保存/更新一个类目模板。
 * @param categoryKeyword 类目关键词（如「连衣裙」）
 * @param info {
 *   catId, catePath,          —— 平台类目
 *   dims: [{user, page, type}], —— 维度映射（user=用户写的维度名，page=页面实际维度名，type=color-input/checkbox/spec-type）
 *   requiredAttrs: [{name, value}], —— 必填属性及可用值
 *   price, stock,
 *   goodsId                   —— 首次成功的商品
 * }
 */
export function saveTemplate(categoryKeyword, info) {
  const all = loadTemplates()
  const kw = String(categoryKeyword || '').trim()
  if (!kw) return false
  const prev = all[kw] || {}
  all[kw] = {
    ...prev,
    ...info,
    // 维度映射：新老合并（同名覆盖，新的保留）
    dims: mergeDims(prev.dims, info.dims),
    requiredAttrs: mergeAttrs(prev.requiredAttrs, info.requiredAttrs),
    updatedAt: new Date().toISOString(),
    successCount: (prev.successCount || 0) + 1,
  }
  fs.mkdirSync(path.dirname(STORE), { recursive: true })
  fs.writeFileSync(STORE, JSON.stringify(all, null, 2), 'utf8')
  console.log(`[template] 已沉淀类目模板「${kw}」→ ${path.relative(PLUGIN_ROOT, STORE)}`)
  return true
}

function mergeDims(prev = [], next = []) {
  const out = [...prev]
  for (const d of (next || [])) {
    const i = out.findIndex(x => x.user === d.user)
    if (i >= 0) out[i] = d
    else out.push(d)
  }
  return out
}

function mergeAttrs(prev = [], next = []) {
  const out = [...prev]
  for (const a of (next || [])) {
    const i = out.findIndex(x => x.name === a.name)
    if (i >= 0) out[i] = a
    else out.push(a)
  }
  return out
}

/** 把模板转成给 dom-fill-spec 的提示（下次直接用记录过的页面维度名） */
export function templateHints(t) {
  if (!t) return null
  return {
    dimMap: (t.dims || []).map(d => ({ user: d.user, page: d.page, type: d.type })),
    requiredAttrs: t.requiredAttrs || [],
    catePath: t.catePath || '',
    catId: t.catId || '',
  }
}
