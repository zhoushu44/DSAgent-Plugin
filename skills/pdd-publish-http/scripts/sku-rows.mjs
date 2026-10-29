/**
 * SKU 行定位辅助（供 sku-table.mjs / sku-thumb.mjs 共用）
 *
 * ★ 核心难点（2026-10-29 真机 dump 定论）：
 *   SKU 表颜色列用 **rowspan=N 合并单元格**，导致：
 *     行0（该色首行）: td 数=8  [黄色][100][库存][拼单价][单买价][预览图][编码][状态]
 *     行1/2（同色后续）: td 数=7  [110][库存][拼单价][单买价][预览图][编码][状态]  ← 缺颜色！
 *   → 列索引错位、行 key 冲突。必须**向上继承** rowspan 覆盖的值。
 *
 *   另外：行文本会被校验提示污染（「单买价至少比拼单价高1元」被塞进 td），
 *   维度值 td 必须排除这类文字。
 */

/** 注入到 page 里跑的取行标识函数源码（字符串形式，供 page.evaluate 用） */
export const READ_ROW_KEYS_SRC = `
  (() => {
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
        if (dimVals.length === 0 && td.rowSpan > 1) {
          carriedColor = t
          dimVals.push(t)
          continue
        }
        dimVals.push(t)
        if (dimVals.length >= 2) break
      }
      if (dimVals.length === 1 && carriedColor) dimVals.unshift(carriedColor)
      out.push({ ri, key: dimVals.join(' '), dims: dimVals })
    })
    return out
  })()
`

/**
 * 读所有 SKU 行标识 [{ ri, key, dims }]
 * key = 维度值拼接（如「黄色 100」），已处理 rowspan 继承
 */
export async function readRowKeys(page) {
  return page.evaluate(READ_ROW_KEYS_SRC).catch(() => [])
}

/**
 * 在 page 上下文里按 key 找行的源码片段（返回 tr 或 null）
 * 用法：把 ROW_FINDER_SRC 拼进 evaluate 的字符串里
 */
export const ROW_FINDER_SRC = `
  (key) => {
    const trs = [...document.querySelectorAll('#sku table tbody tr')]
    let carriedColor = ''
    for (const tr of trs) {
      const tds = [...tr.querySelectorAll('td')]
      const dimVals = []
      for (const td of tds) {
        if (td.querySelector('input')) continue
        const t = (td.textContent || '').trim()
        if (!t) continue
        if (/本地上传|已启用|已停用|至少比|不能为空|请输入|点击上传/.test(t)) continue
        if (t.length > 12) continue
        if (dimVals.length === 0 && td.rowSpan > 1) {
          carriedColor = t
          dimVals.push(t)
          continue
        }
        dimVals.push(t)
        if (dimVals.length >= 2) break
      }
      if (dimVals.length === 1 && carriedColor) dimVals.unshift(carriedColor)
      if (dimVals.join(' ') === key) return tr
    }
    return null
  }
`

/**
 * 取该行所有 text input（排除 file），序号：0=库存 1=拼单价 2=单买价 3=规格编码
 */
export const ROW_TEXT_INPUTS_SRC = `
  (tr) => [...tr.querySelectorAll('input')].filter(i => i.type !== 'file')
`
