/**
 * 拼多多上架前置处理（imgprep + 品牌默认）
 *
 * 本模块被 publish.mjs 在主流程前调用，解决两类实测踩过的坑：
 *   ① 详情图尺寸不合规 → 自动压缩；外部来源的超长整图 → 拆成合规单图
 *   ② 品牌未指定时不填 → 自动补「无」
 *
 * ★ 2026-10-28 删：原第 ③ 项 borrowSpecIds（spec_id 借位）已整段移除。
 *   DOM 填规格路线实测「值写什么就是什么」，借位会让平台按 id 还原成别人的
 *   名字，且该函数自 2026-10-27 起已无任何调用方（SKILL.md 121 行早标注废弃）。
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
  } else {
    const b = attrs.find(a => a && String(a.name || '').includes('品牌'))
    console.log(`[pdd-publish-http] 品牌已指定 → 保留「${b.value}」`)
  }
  return { ...product, attributes: attrs }
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
