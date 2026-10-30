/**
 * SKU 组件 · ③ 预览图（极简通用版）
 *
 * ★★ 核心洞察（2026-10-30，用户点醒）★★
 *   SKU 预览图是**最简单**的一件事：
 *     表格每行有一个「预览图」单元格，格子里有一个 input[type=file]，
 *     按行顺序给它 uploadFile 就完了。
 *
 *   不需要：
 *     ✗ 算「预览图是第几列」（列索引会因 rowspan 合并单元格错位）
 *     ✗ 依赖 window.__pddSkuLocate / __pddSkuCols 注入的 helper
 *     ✗ 处理 rowspan 继承
 *
 *   只需要：
 *     ✓ 每行找 input[type=file]
 *     ✓ 按行顺序上传
 *     ✓ 校验（格子内出现 background-image / img）
 *
 *   之前 lib 版失败原因：skuImgCellExpr 依赖 installSkuTableHelper 注入的全局变量，
 *   在新维度类目（手机壳）上没装 helper → locate 返回 null → 0/6 全失败。
 */
import * as fs from 'node:fs'

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 读取 SKU 表所有行的预览图状态
 *
 * ★ 2026-10-30 真机截图定论（关键）：
 *   预览图列的表现形式随**状态**变化：
 *     · 还没图 → 有 input[type=file]（上传入口）
 *     · 已经有图 → **file input 消失**，只显示缩略图 + × 删除按钮
 *   所以「有没有 file input」不能当完成判据！
 *   完成判据 = **格子内出现真实尺寸的背景图或 img**。
 *
 *   而且实测：多维场景下，规格值配了 image 后平台会**自动下发**预览图到各行
 *   （睡衣 9 行全部自动有图，根本不需要再传）。
 */
async function readThumbSlots(page) {
  return page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')].filter(t => /拼单价/.test(t.innerText || ''))
    const tb = tables[0]
    if (!tb) return []
    return [...tb.querySelectorAll('tbody tr')].map((tr, ri) => {
      // 预览图单元格：包含 file input 的 td，或表头「预览图」对应的列
      const tds = [...tr.querySelectorAll('td')]
      let thumbTd = tds.find(td => td.querySelector('input[type="file"]'))
      if (!thumbTd) {
        // 没有 file input → 按表头索引找预览图列
        const heads = [...tb.querySelectorAll('thead th')].map(th => th.textContent.trim())
        const col = heads.findIndex(h => /预览图/.test(h))
        const rowspanOffset = tds.length < heads.length ? heads.length - tds.length : 0
        const idx = col >= 0 ? col - rowspanOffset : -1
        thumbTd = idx >= 0 ? tds[idx] : null
      }
      // 完成判据：格子内出现真实背景图或 img
      let hasThumb = false
      if (thumbTd) {
        hasThumb = [...thumbTd.querySelectorAll('*')].some(e => {
          const r = e.getBoundingClientRect()
          if (r.width < 20 || r.height < 20 || r.width > 300) return false
          const bg = getComputedStyle(e).backgroundImage || ''
          if (/url\(/.test(bg)) return true
          if (e.tagName === 'IMG' && (e.src || '').startsWith('http')) return true
          return false
        })
      }
      return {
        row: ri,
        hasFile: tds.some(td => td.querySelector('input[type="file"]')),
        hasThumb,
      }
    })
  }).catch(() => [])
}

/**
 * 给 SKU 表逐行上传预览图
 *
 * @param page
 * @param rowFiles string[] 每行的图片路径（长度应 >= 行数）
 * @param opts { log?, maxWaitMs? }
 * @returns { filled: string[], missed: string[] }
 */
export async function fillSkuRowImagesSimple(page, rowFiles, opts = {}) {
  const log = opts.log || (() => {})
  const filled = []
  const missed = []

  const slots = await readThumbSlots(page)
  if (!slots.length) {
    return { filled: [], missed: ['SKU 预览图（找不到 SKU 表）'] }
  }
  log(`[sku-thumb] 表格 ${slots.length} 行，其中 ${slots.filter(s => s.hasFile).length} 行有上传入口`)

  for (let ri = 0; ri < slots.length; ri++) {
    const slot = slots[ri]
    const file = String(rowFiles[ri] || '').trim()

    // 已上传 → 跳过（多维场景颜色图会自动下发到同色各行）
    if (slot.hasThumb) {
      filled.push(`SKU 预览图（第${ri + 1}行，已有）`)
      continue
    }
    if (!file) {
      missed.push(`SKU 预览图（第${ri + 1}行，未提供图片）`)
      continue
    }
    if (!fs.existsSync(file)) {
      missed.push(`SKU 预览图（第${ri + 1}行，文件不存在）`)
      continue
    }

    // 拿该行的第一个 file input handle
    const el = await page.evaluateHandle((ri) => {
      const tables = [...document.querySelectorAll('table')].filter(t => /拼单价/.test(t.innerText || ''))
      const tb = tables[0]
      if (!tb) return null
      const tr = [...tb.querySelectorAll('tbody tr')][ri]
      if (!tr) return null
      tr.scrollIntoView({ block: 'center' })
      return tr.querySelector('input[type="file"]') || null
    }, ri).then(h => h.asElement()).catch(() => null)

    if (!el) {
      missed.push(`SKU 预览图（第${ri + 1}行，无上传入口）`)
      continue
    }

    await sleep(300)
    await el.uploadFile(file).catch(() => {})

    // 等缩略图出现（最多 8 秒）
    let ok = false
    for (let w = 0; w < 16; w++) {
      await sleep(500)
      ok = await page.evaluate((ri) => {
        const tb = [...document.querySelectorAll('table')].find(t => /拼单价/.test(t.innerText || ''))
        const tr = [...(tb?.querySelectorAll('tbody tr') || [])][ri]
        if (!tr) return false
        const tds = [...tr.querySelectorAll('td')]
        // 找到预览图单元格（有 file input 的，或按表头索引）
        let td = tds.find(x => x.querySelector('input[type="file"]'))
        if (!td) {
          const heads = [...tb.querySelectorAll('thead th')].map(th => th.textContent.trim())
          const col = heads.findIndex(h => /预览图/.test(h))
          const offset = tds.length < heads.length ? heads.length - tds.length : 0
          td = col >= 0 ? tds[col - offset] : null
        }
        if (!td) return false
        return [...td.querySelectorAll('*')].some(e => {
          const r = e.getBoundingClientRect()
          if (r.width < 20 || r.height < 20 || r.width > 300) return false
          if (/url\(/.test(getComputedStyle(e).backgroundImage || '')) return true
          if (e.tagName === 'IMG' && (e.src || '').startsWith('http')) return true
          return false
        })
      }, ri).catch(() => false)
      if (ok) break
    }

    if (ok) filled.push(`SKU 预览图（第${ri + 1}行）`)
    else missed.push(`SKU 预览图（第${ri + 1}行，上传后未出现缩略图）`)
  }

  log(`[sku-thumb] 已填 ${filled.length} 项，未填 ${missed.length} 项`)
  return { filled, missed }
}

/**
 * 从商品 JSON 推导每行该用哪张图
 *
 * 规则：
 *   · 每个 SKU 自带 image → 直接按 SKU 顺序（build_product.py 会按颜色分配）
 *   · 二维：按「第1维优先」展开（同色若干行复用同图）
 *   · 一维：按维度值顺序
 *   · 兜底：全部用第一张主图
 */
export function buildRowImageFiles(product) {
  const specs = (product.specs || []).filter(d => d && Array.isArray(d.values) && d.values.length)
  const skus = product.skus || []
  const fallback = (product.images || [])[0] || ''

  const valOf = v => (v && typeof v === 'object') ? String(v.value ?? '').trim() : String(v ?? '').trim()
  const imgOf = v => (v && typeof v === 'object' && v.image) ? String(v.image).trim() : ''

  // ① 每 SKU 自带图（最准）
  const skuImgs = skus.map(s => String(s?.image || '').trim())
  if (skuImgs.length && skuImgs.every(Boolean)) {
    return { rowFiles: skuImgs, source: 'sku', note: `每 SKU 自带图（${skuImgs.length} 行）` }
  }

  // ② 二维：第1维优先展开
  if (specs.length >= 2) {
    const d1 = specs[0].values || []
    const d2Count = (specs[1].values || []).length || 1
    const rowFiles = []
    for (const v of d1) {
      const img = imgOf(v) || fallback
      for (let j = 0; j < d2Count; j++) rowFiles.push(img)
    }
    if (rowFiles.some(Boolean)) {
      return { rowFiles, source: 'dim1', note: `第1维「${specs[0].name}」×${d2Count} → ${rowFiles.length} 行` }
    }
  }

  // ③ 一维
  if (specs.length === 1) {
    const rowFiles = (specs[0].values || []).map(v => imgOf(v) || fallback)
    if (rowFiles.some(Boolean)) {
      return { rowFiles, source: 'dim1', note: `第1维「${specs[0].name}」→ ${rowFiles.length} 行` }
    }
  }

  // ④ 兜底
  const n = Math.max(skus.length, 1)
  return { rowFiles: Array(n).fill(fallback), source: 'fallback', note: `兜底用主图1（${n} 行）` }
}

/**
 * 统一入口：推导行图 → 逐行上传
 */
export async function fillSkuThumbs(page, product, opts = {}) {
  const log = opts.log || (() => {})
  const { rowFiles, source, note } = buildRowImageFiles(product)
  if (!rowFiles.length || !rowFiles.some(Boolean)) {
    log('[sku-thumb] 没有可用的预览图路径')
    return { filled: [], missed: ['SKU 预览图（无可用图片）'], note }
  }
  log(`[sku-thumb] 行图推导：${note}（来源 ${source}）`)
  const r = await fillSkuRowImagesSimple(page, rowFiles, { log })
  return { ...r, note }
}
