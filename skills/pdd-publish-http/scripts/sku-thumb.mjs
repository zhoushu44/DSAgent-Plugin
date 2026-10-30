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
    // ★ 2026-10-30 真机 dump：SKU 表可能分**多个 table**（或行分散在不同 table），
    //   不能只取第一个。要**合并所有含「拼单价」表头的 table** 的 tbody tr。
    const tables = [...document.querySelectorAll('table')].filter(t => /拼单价/.test(t.innerText || ''))
    const allRows = []
    for (const tb of tables) {
      const heads = [...tb.querySelectorAll('thead th')].map(th => th.textContent.trim())
      const col = heads.findIndex(h => /预览图/.test(h))
      for (const tr of tb.querySelectorAll('tbody tr')) {
        allRows.push({ tr, heads, col })
      }
    }

    return allRows.map(({ tr, heads, col }, ri) => {
      const tds = [...tr.querySelectorAll('td')]
      let thumbTd = tds.find(td => td.querySelector('input[type="file"]'))
      if (!thumbTd && col >= 0) {
        const rowspanOffset = tds.length < heads.length ? heads.length - tds.length : 0
        const idx = col - rowspanOffset
        thumbTd = idx >= 0 ? tds[idx] : null
      }

      // 完成判据：格子内出现真实背景图或 img
      let hasThumb = false
      if (thumbTd) {
        hasThumb = [...thumbTd.querySelectorAll('*')].some(e => {
          const r = e.getBoundingClientRect()
          if (r.width < 20 || r.height < 20 || r.width > 300) return false
          const bg = window.getComputedStyle(e).backgroundImage || ''
          if (/url\(/.test(bg) && bg !== 'none') return true
          if (e.tagName === 'IMG') {
            const src = e.getAttribute('src') || ''
            if (/^https?:\/\//.test(src) || src.startsWith('data:')) return true
          }
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

  // ★ 2026-10-30：等 SKU 表**所有行**都出现再读（规格填完后表格是异步生成的）
  //   真机实测：规格填完后 SKU 表只有 2 行，但**滚动到底部后第 3 行才出现**。
  //   所以先滚动到 SKU 表底部，触发行生成，再读。
  await page.evaluate(() => {
    const tb = [...document.querySelectorAll('table')].find(t => /拼单价/.test(t.innerText || ''))
    if (tb) {
      tb.scrollIntoView({ block: 'end' })
      window.scrollBy(0, 500)   // 再往下滚一点，触发懒加载
    }
  }).catch(() => {})
  await sleep(1000)

  let slots = []
  const expectRows = rowFiles.length
  for (let w = 0; w < 30; w++) {
    await sleep(500)
    slots = await readThumbSlots(page)
    if (slots.length >= expectRows && slots.length > 0) {
      log(`[sku-thumb] 行数已稳定：${slots.length} 行（预期 ${expectRows}）`)
      break
    }
  }
  if (!slots.length) {
    return { filled: [], missed: ['SKU 预览图（找不到 SKU 表）'] }
  }
  if (slots.length < expectRows) {
    log(`[sku-thumb] ⚠ 实际行数 ${slots.length} < 预期 ${expectRows}（可能平台合并了同单位行）`)
  }
  log(`[sku-thumb] 表格 ${slots.length} 行，其中 ${slots.filter(s => s.hasFile).length} 行有上传入口`)
  slots.forEach((s, i) => {
    log(`[sku-thumb]   第${i+1}行：hasThumb=${s.hasThumb} hasFile=${s.hasFile}`)
  })

  // ★ 2026-10-30：先上传前 N 行，然后**重新读行数**（可能触发生成新行）
  //   真机实测：上传前 2 行后，第 3 行才出现（异步生成）。
  let uploaded = 0
  for (let round = 0; round < 3; round++) {
    const fileInputs = await page.$$('table tbody tr input[type="file"]').catch(() => [])
    if (!fileInputs.length) break

    log(`[sku-thumb] 第 ${round + 1} 轮：找到 ${fileInputs.length} 个 file input`)

    for (let ri = uploaded; ri < fileInputs.length; ri++) {
      const file = String(rowFiles[ri] || '').trim()
      if (!file) {
        missed.push(`SKU 预览图（第${ri + 1}行，未提供图片）`)
        continue
      }
      if (!fs.existsSync(file)) {
        missed.push(`SKU 预览图（第${ri + 1}行，文件不存在）`)
        continue
      }

      const el = fileInputs[ri]
      await el.uploadFile(file).catch(() => {})
      await sleep(800)

      // 校验：该 input 是否消失（上传成功后 file input 会被替换为缩略图）
      const stillThere = await page.evaluate((idx) => {
        const inputs = [...document.querySelectorAll('table tbody tr input[type="file"]')]
        return inputs.length > idx
      }, ri).catch(() => true)

      if (!stillThere) {
        filled.push(`SKU 预览图（第${ri + 1}行）`)
        uploaded++
      } else {
        // 再校验：是否有背景图
        const hasThumb = await page.evaluate((idx) => {
          const trs = [...document.querySelectorAll('table tbody tr')]
          const tr = trs[idx]
          if (!tr) return false
          const tds = [...tr.querySelectorAll('td')]
          const thumbTd = tds.find(td => td.querySelector('input[type="file"]')) || tds[4]
          if (!thumbTd) return false
          return [...thumbTd.querySelectorAll('*')].some(e => {
            const bg = window.getComputedStyle(e).backgroundImage || ''
            if (/url\(/.test(bg) && bg !== 'none') return true
            if (e.tagName === 'IMG') {
              const src = e.getAttribute('src') || ''
              if (/^https?:\/\//.test(src) || src.startsWith('data:')) return true
            }
            return false
          })
        }, ri).catch(() => false)

        if (hasThumb) {
          filled.push(`SKU 预览图（第${ri + 1}行）`)
          uploaded++
        } else {
          missed.push(`SKU 预览图（第${ri + 1}行，上传后未出现缩略图）`)
        }
      }
    }

    // 等 1 秒，看是否生成新行
    await sleep(1000)
    const newInputs = await page.$$('table tbody tr input[type="file"]').catch(() => [])
    if (newInputs.length <= uploaded) break   // 没有新行，结束
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
