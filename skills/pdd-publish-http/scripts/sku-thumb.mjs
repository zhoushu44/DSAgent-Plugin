/**
 * SKU 组件 · ③ 预览图上传
 *
 * 职责：给 #sku 表每一行的「预览图」列上传缩略图。
 *
 * ★ 2026-10-29 真机踩坑定论：
 *   1. **行定位必须用 rowspan 继承的 key**（见 sku-rows.mjs）——
 *      颜色列合并单元格导致同色后续行缺颜色 td。
 *   2. **预览图必须在价格表之后补一次**——价格表填充会重建行 DOM，清掉已传的图。
 *   3. **完成判定看 `<img>` 出现**，不是看文字（文字可能是「本地上传」残留）。
 */
import * as fs from 'node:fs'
import { sleep } from './spec-dims.mjs'
import { readRowKeys } from './sku-rows.mjs'

/**
 * 读 SKU 表所有行：key + 预览图状态（一次 evaluate 拿全，不重复计算）
 */
async function readRows(page) {
  return page.evaluate(() => {
    const trs = [...document.querySelectorAll('#sku table tbody tr')]
    const out = []
    let carriedColor = ''
    trs.forEach((tr, ri) => {
      const tds = [...tr.querySelectorAll('td')]
      const dimVals = []
      for (const td of tds) {
        if (td.querySelector('input')) continue
        const t = (td.textContent || '').trim()
        if (!t) continue
        if (/本地上传|已启用|已停用|至少比|不能为空|请输入|点击上传/.test(t)) continue
        if (t.length > 12) continue
        if (dimVals.length === 0 && td.rowSpan > 1) { carriedColor = t; dimVals.push(t); continue }
        dimVals.push(t)
        if (dimVals.length >= 2) break
      }
      if (dimVals.length === 1 && carriedColor) dimVals.unshift(carriedColor)

      const thumbTd = tds.find(td => td.querySelector('input[type="file"]'))
      const hasImg = !!thumbTd?.querySelector('img')
      const thumbText = (thumbTd?.textContent || '').trim()
      const done = !!thumbTd && (hasImg || !/本地上传/.test(thumbText))
      out.push({ row: ri, key: dimVals.join(' '), done, hasImg })
    })
    return out
  }).catch(() => [])
}

/**
 * 给一行找图
 * @param rowKey 行标识（维度值拼接，如「黄色 100」）
 */
function findImg(rowKey, colorMap, valMap, skuMap, fallback) {
  // ① SKU 级（所有维度值都含）
  for (const [key, img] of Object.entries(skuMap || {})) {
    const vals = key.split('|').map(kv => kv.split('=')[1]).filter(Boolean)
    if (vals.length && vals.every(v => rowKey.includes(v))) return img
  }
  // ② 颜色名匹配（推荐）
  for (const [color, img] of Object.entries(colorMap || {})) {
    if (color && rowKey.includes(color)) return img
  }
  // ③ 值级（含任一值）
  for (const [val, img] of Object.entries(valMap || {})) {
    if (val && rowKey.includes(val)) return img
  }
  return fallback || null
}

/**
 * 填 SKU 预览图
 * @param opts {
 *   thumbMap?:    { 规格值: 图路径 },
 *   thumbMapSku?: { '颜色分类=黄色|参考分类=100': 图 },
 *   colorMap?:    { 颜色名: 图路径 },     ← 推荐
 *   fallback?:    兜底图,
 *   maxRounds?:   补全轮次（默认 3）
 * }
 */
export async function fillSkuThumbs(page, opts = {}) {
  const valMap = opts.thumbMap || {}
  const skuMap = opts.thumbMapSku || {}
  const colorMap = opts.colorMap || {}
  const fallback = opts.fallback || Object.values(colorMap)[0] || Object.values(valMap)[0] || null
  const maxRounds = opts.maxRounds || 3

  if (!Object.keys(valMap).length && !Object.keys(skuMap).length && !Object.keys(colorMap).length) {
    return { filled: 0, total: 0, message: '无预览图映射' }
  }

  let total = 0
  for (let round = 0; round < maxRounds; round++) {
    const rows = await readRows(page)
    total = rows.length
    const pending = rows.filter(r => !r.done)
    if (!pending.length) break

    for (const r of pending) {
      const imgPath = findImg(r.key, colorMap, valMap, skuMap, fallback)
      if (!imgPath || !fs.existsSync(imgPath)) continue

      // ★ 2026-10-29：用**行索引**直接取 file input handle
      //   （行索引在同一时刻可靠；rowspan 只影响维度值读取，不影响 tr 顺序）
      const el = await page.evaluateHandle((ri) => {
        const tr = [...document.querySelectorAll('#sku table tbody tr')][ri]
        if (!tr) return null
        tr.scrollIntoView({ block: 'center' })
        return tr.querySelector('input[type="file"]') || null
      }, r.row).then(h => h.asElement()).catch(() => null)
      if (!el) continue

      await sleep(300)
      await el.uploadFile(imgPath).catch(() => {})

      // 等完成（该行出现 img，最多 12 秒）
      for (let w = 0; w < 12; w++) {
        await sleep(1000)
        const done = await page.evaluate((ri) => {
          const tr = [...document.querySelectorAll('#sku table tbody tr')][ri]
          if (!tr) return false
          const thumbTd = [...tr.querySelectorAll('td')].find(td => td.querySelector('input[type="file"]'))
          if (!thumbTd) return false
          return !!thumbTd.querySelector('img') || !/本地上传/.test((thumbTd.textContent || '').trim())
        }, r.row).catch(() => false)
        if (done) break
      }
    }
    await sleep(1200)
  }

  const final = await readRows(page)
  return { filled: final.filter(r => r.done).length, total }
}

/**
 * 从商品 JSON 构建三套映射（值级 / SKU 级 / 颜色级）
 */
export function buildThumbMaps(product) {
  const thumbMap = {}
  const thumbMapSku = {}
  const colorMap = {}
  let fallback = null

  // 值级 + 颜色级
  for (const sp of (product.specs || [])) {
    const dimName = String(sp.name || '').trim()
    const isColorDim = /颜色|色号|花色|配色/.test(dimName)
    for (const v of (sp.values || [])) {
      const val = (v && typeof v === 'object') ? String(v.value ?? '').trim() : String(v ?? '').trim()
      const img = (v && typeof v === 'object') ? v.image : null
      if (!val || !img || typeof img !== 'string' || !fs.existsSync(img)) continue
      thumbMap[val] = img
      if (isColorDim) colorMap[val] = img
      if (!fallback) fallback = img
    }
  }

  // SKU 级
  for (const s of (product.skus || [])) {
    if (!s?.specs || !s?.image || !fs.existsSync(s.image)) continue
    const key = Object.keys(s.specs).sort().map(k => `${k}=${String(s.specs[k]).trim()}`).join('|')
    if (key) thumbMapSku[key] = s.image
    if (!fallback) fallback = s.image
  }

  return { thumbMap, thumbMapSku, colorMap, fallback }
}
