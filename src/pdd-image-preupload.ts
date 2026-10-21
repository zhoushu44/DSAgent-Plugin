/**
 * 图片预上传编排层 —— 把本地图片批量传成拼多多 CDN URL。
 *
 * 严格对齐觅千手：图片**先上传拿 URL，再进 gallery**，全程不碰页面文件控件。
 *
 * 顺序（不可颠倒）：
 *   ① 本地图 → HTTP 上传 → img.pddpic.com URL
 *   ② URL 回填进 ProductData（images / detailImages / specs[].values[].image）
 *   ③ 交给 buildGoodsDetailFromProduct → isRemoteImg 门禁放行 → gallery 有值
 *   ④ 提交时 fillImageData 用 `e.gallery = t.gallery` **整组替换**
 *
 * ★ buildGoodsDetailFromProduct 只放行 `http(s)://` 的图片；
 *   本地路径（e:\...）一律丢弃（否则会覆盖掉 CDN url，提交报「图片url不能为空」）。
 */

import { readFileSync, existsSync, statSync } from 'node:fs'
import {
  ensurePddAntiContent,
  uploadPddImages,
  type PddImageUploadResult,
} from './pdd-image-space.js'
import type { ProductData } from './services/product-schema.js'

/** 单张上限（发布页 3MB；上传接口放宽到 10MB，平台会压缩） */
const MAX_BYTES = 10 * 1024 * 1024

export interface PreuploadSummary {
  ok: boolean
  uploaded: number
  total: number
  ms: number
  /** 本地路径 → CDN URL（兼容旧调用方） */
  map: Record<string, string>
  /** 本地路径 → 完整上传结果（含 fileId，SKU 预览图注入需要） */
  detail: Record<string, { url: string; fileId?: number; width?: number; height?: number }>
  failed: Array<{ path: string; error: string }>
  fatal?: string
}

function isRemote(v: unknown): boolean {
  return typeof v === 'string' && /^https?:\/\//i.test(v)
}

/** 收集所有需要上传的本地图片（去重、保序） */
export function collectLocalImages(p: ProductData): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (v: unknown) => {
    if (typeof v !== 'string' || !v.trim()) return
    if (isRemote(v)) return
    const k = v.toLowerCase()
    if (seen.has(k)) return
    seen.add(k)
    out.push(v)
  }
  for (const x of Array.isArray(p.images) ? p.images : []) add(x)
  for (const x of Array.isArray(p.detailImages) ? p.detailImages : []) add(x)
  for (const d of Array.isArray(p.specs) ? p.specs : []) {
    for (const v of Array.isArray(d?.values) ? d.values : []) add(v?.image)
  }
  return out
}

/** 前置校验：存在、非空、不超限 */
export function precheckImages(paths: string[]): { ok: boolean; error?: string } {
  for (const p of paths) {
    if (!existsSync(p)) return { ok: false, error: `图片不存在：${p}` }
    let size = 0
    try { size = statSync(p).size } catch { return { ok: false, error: `无法读取：${p}` } }
    if (size <= 0) return { ok: false, error: `图片为空：${p}` }
    if (size > MAX_BYTES) {
      return { ok: false, error: `图片超限（${(size / 1024 / 1024).toFixed(1)}MB > 10MB）：${p}` }
    }
  }
  return { ok: true }
}

/**
 * 批量预上传并把 URL 回填到 ProductData 副本。
 *
 * @param page    主应用页面（/goods/goods_list，已登录）
 * @param product 统一商品数据
 */
export async function preuploadProductImages(
  page: any,
  product: ProductData,
  opts: { onProgress?: (done: number, total: number, last: PddImageUploadResult) => void } = {},
): Promise<{ product: ProductData; summary: PreuploadSummary }> {
  const t0 = Date.now()
  const locals = collectLocalImages(product)
  const summary: PreuploadSummary = {
    ok: true, uploaded: 0, total: locals.length, ms: 0, map: {}, detail: {}, failed: [],
  }

  if (!locals.length) {
    summary.ms = Date.now() - t0
    return { product: { ...product }, summary }
  }

  const pre = precheckImages(locals)
  if (!pre.ok) {
    summary.ok = false
    summary.fatal = pre.error
    summary.ms = Date.now() - t0
    return { product: { ...product }, summary }
  }

  // Anti-Content 必须可用，否则 create 必报 40002
  const anti = await ensurePddAntiContent(page)
  if (!anti.ok) {
    summary.ok = false
    summary.fatal = `Anti-Content 不可用：${anti.error}`
    summary.ms = Date.now() - t0
    return { product: { ...product }, summary }
  }

  const items = locals.map(p => ({
    path: p,
    b64: readFileSync(p).toString('base64'),
    mime: /\.png$/i.test(p) ? 'image/png' : 'image/jpeg',
  }))
  const results = await uploadPddImages(page, items, opts.onProgress)

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const local = locals[i]
    if (r.ok && r.url) {
      summary.map[local] = r.url
      summary.detail[local] = { url: r.url, fileId: r.fileId, width: r.width, height: r.height }
      summary.uploaded++
    } else {
      summary.failed.push({ path: local, error: r.error || '未知错误' })
    }
  }
  summary.ok = summary.failed.length === 0

  const swap = (v: unknown): unknown => (typeof v === 'string' ? (summary.map[v] || v) : v)
  const out: ProductData = {
    ...product,
    images: (product.images || []).map(x => swap(x) as string),
  }
  if (Array.isArray(product.detailImages)) {
    out.detailImages = product.detailImages.map(x => swap(x) as string)
  }
  if (Array.isArray(product.specs)) {
    out.specs = product.specs.map(d => ({
      ...d,
      values: (d.values || []).map(v => ({
        ...v,
        image: v.image ? (swap(v.image) as string) : v.image,
      })),
    }))
  }

  summary.ms = Date.now() - t0
  return { product: out, summary }
}
