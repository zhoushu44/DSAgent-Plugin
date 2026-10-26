/**
 * 拼多多上架前置处理（imgprep + 品牌默认 + spec_id 借位）
 *
 * 本模块被 publish.mjs 在主流程前调用，解决三类实测踩过的坑：
 *   ① 详情图尺寸不合规 → 自动压缩；外部来源的超长整图 → 拆成合规单图
 *   ② 品牌未指定时不填 → 自动补「无」
 *   ③ 规格值缺 spec_id（重复的规格Id）→ 用池里现成值借位，保留我们的显示名
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

const DEFAULT_BRAND = '无'
// 拼多多硬规则
export const DETAIL_W_MIN = 480
export const DETAIL_W_MAX = 1200
export const DETAIL_H_MAX = 1500
export const MAX_BYTES = 3 * 1024 * 1024

/**
 * ① 图片规整：调用 Python imgprep.py
 *
 * 详情图本来就该是**一张张单图按顺序传**，不要拼长图。
 * 这里只做保底：太宽→压缩、偏长→缩放、外部超长整图→拆成合规单图、
 * 主图/规格图→补白成 1:1、>3MB→压质量。
 * @returns {{main:string[],detail:string[],spec:string[],actions:object[]}}
 */
export function prepImages(product, { scriptDir, workDir } = {}) {
  const dir = scriptDir || path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const py = path.join(dir, 'imgprep.py')
  const main = Array.isArray(product.images) ? product.images.slice() : []
  const detail = Array.isArray(product.detailImages) ? product.detailImages.slice() : []
  const spec = []
  for (const d of product.specs || []) {
    for (const v of d.values || []) {
      if (v && typeof v.image === 'string' && /^([a-zA-Z]:[\\/]|\/)/.test(v.image)) spec.push(v.image)
    }
  }
  if (!main.length && !detail.length && !spec.length) return { main, detail, spec, actions: [] }
  if (!fs.existsSync(py)) {
    console.log('[pdd-publish-http] 未找到 imgprep.py，跳过图片规整')
    return { main, detail, spec, actions: [] }
  }

  const tmp = workDir || process.cwd()
  const jobFile = path.join(tmp, `.pdd-imgprep-${process.pid}.json`)
  const repFile = path.join(tmp, `.pdd-imgprep-${process.pid}-report.json`)
  try {
    fs.writeFileSync(jobFile, JSON.stringify({ main, detail, spec, maxBytes: MAX_BYTES }), 'utf8')
    const out = execFileSync('python', [py, '--job', jobFile, '--report', repFile], {
      encoding: 'utf8', timeout: 600000,
    })
    if (out) process.stdout.write(out)
    const rep = JSON.parse(fs.readFileSync(repFile, 'utf8'))
    return {
      main: rep.main?.length ? rep.main : main,
      detail: rep.detail?.length ? rep.detail : detail,
      spec: rep.spec?.length ? rep.spec : spec,
      actions: rep.actions || [],
    }
  } catch (e) {
    console.log(`[pdd-publish-http] 图片规整失败（按原图继续）：${e?.message || e}`)
    return { main, detail, spec, actions: [] }
  } finally {
    for (const f of [jobFile, repFile]) {
      try { fs.unlinkSync(f) } catch { /* ignore */ }
    }
  }
}

/**
 * ② 品牌：未指定时补「无」
 * 用户明确说了「品牌没有就填无」，所以这是默认值而不是询问项。
 */
export function ensureBrand(product) {
  const attrs = Array.isArray(product.attributes) ? product.attributes.slice() : []
  const has = attrs.some(a => a && String(a.name || '').includes('品牌'))
  if (!has) {
    attrs.unshift({ name: '品牌', value: DEFAULT_BRAND })
    console.log(`[pdd-publish-http] 品牌未指定 → 自动填「${DEFAULT_BRAND}」`)
  }
  return { ...product, attributes: attrs }
}

/**
 * ③ spec_id 借位
 *
 * 拼多多 SKU 提交的是 spec_id（数字），规格名只是显示文字。
 * 新花色名在店铺里没出现过 → 没有 spec_id → 全写 0 → 平台判「存在重复的规格Id」。
 *
 * 做法：同一个维度内，按顺序把「池里已有的 spec_id」借给我们的规格值，
 *      显示名保持我们的真实花色名。约束：借位数 ≤ 池内该维度的值个数。
 *
 * @param {object} product 统一商品 JSON
 * @param {object} pool    spec-pool.json 的 pool 字段（{维度名: {值: {spec_id, parent_spec_id}}})
 * @returns {{product:object, specIds:object, notes:string[]}}
 */
export function borrowSpecIds(product, pool) {
  const notes = []
  const specIds = {}
  if (!pool || !Object.keys(pool).length) return { product, specIds, notes: ['规格池为空，未做借位'] }

  // 池里可借的 id 池（按维度展开，去重）
  const donors = {}
  for (const [dimName, vals] of Object.entries(pool)) {
    const seen = new Set()
    donors[dimName] = []
    for (const [, rec] of Object.entries(vals || {})) {
      const id = rec?.spec_id
      if (!id || seen.has(id)) continue
      seen.add(id)
      donors[dimName].push({ spec_id: id, parent_id: rec.parent_spec_id })
    }
  }

  // 维度名映射：我们的维度 → 池里哪个维度可借
  const aliasOf = (name) => {
    const n = String(name || '')
    const keys = Object.keys(donors)
    if (keys.includes(n)) return n
    const re = /颜色|色|花色|款式|图案/
    if (re.test(n)) return keys.find(k => re.test(k)) || keys[0]
    const re2 = /尺码|尺寸|身高|码|规格/
    if (re2.test(n)) return keys.find(k => re2.test(k)) || keys[keys.length - 1]
    return keys[0]
  }

  const nextProduct = JSON.parse(JSON.stringify(product))
  for (const dim of nextProduct.specs || []) {
    const donorKey = aliasOf(dim.name)
    const list = donors[donorKey] || []
    if (!list.length) {
      notes.push(`维度「${dim.name}」无可用 spec_id（池里无对应维度）`)
      continue
    }
    let i = 0
    for (const v of dim.values || []) {
      const val = String(v.value || '').trim()
      if (!val) continue
      const d = list[i % list.length]
      i++
      // 记录映射：我们的显示名 → 借来的 spec_id
      specIds[val] = { spec_id: d.spec_id, parent_id: d.parent_id }
      if (i > list.length) {
        notes.push(`维度「${dim.name}」值数 ${dim.values.length} 超过可借 id 数 ${list.length}，已循环复用（会被平台判重复，需先建新规格）`)
      }
    }
    notes.push(`维度「${dim.name}」借 ${Math.min(i, list.length)} 个 spec_id（源维度：${donorKey}）`)
  }
  return { product: nextProduct, specIds, notes }
}

/** 详情图合规自检（不改图，只报告） */
export function lintDetailSizes(paths) {
  const bad = []
  for (const p of paths || []) {
    if (!fs.existsSync(p)) continue
    const st = fs.statSync(p)
    if (st.size > MAX_BYTES) bad.push({ file: p, reason: `体积 ${(st.size / 1048576).toFixed(2)}MB > 3MB` })
  }
  return bad
}
