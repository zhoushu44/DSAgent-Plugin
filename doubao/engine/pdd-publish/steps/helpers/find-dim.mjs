/**
 * find-dim.mjs — 通用维度块定位（供 step11 / fill-by-group / size-table-fill 共用）
 *
 * 三层定位，逐级兜底：
 *   ① .property-name-title 精确等于维度名        ← 最标准
 *   ② 内层标题（wrapperTitle 等）等于维度名       ← 尺码表型（标题不在外层）
 *   ③ 内容特征（全选以下规格值 / 尺码表 / 标签页） ← 标题完全没渲染
 *
 * ★ 只在页面内执行，返回块索引，不做任何写操作
 */

/**
 * 在页面里执行，返回 { ok, idx, why, titleAttr, innerTitle }
 * @param {string} name 维度名（模板里的 name）
 */
export function findDimInPage(name) {
  return (function (dimName) {
    const norm = s => String(s || '').replace(/[\s\u3000]/g, '').trim()
    const target = norm(dimName)
    const dims = [...document.querySelectorAll('.property-container-v2')]
    if (!dims.length) return { ok: false, reason: '页面没有维度块', count: 0 }

    const info = (d, i) => ({
      i,
      titleAttr: norm(d.querySelector('.property-name-title')?.innerText),
      innerTitle: norm(
        d.querySelector('[class*="wrapperTitle"]')?.innerText ||
        d.querySelector('[class*="WrapperTitle"]')?.innerText ||
        ''
      ),
      hasSizeWrapper: !!d.querySelector('[class*="sizeStandardWrapper"]'),
      hasQuanxuan: /全选以下规格值/.test(d.innerText || ''),
      hasChima: /尺码表|身高|国际标准|中国码|欧码/.test(d.innerText || ''),
      cbCount: d.querySelectorAll('input[type="checkbox"]').length,
    })

    // ① 外层标题精确匹配
    for (let i = 0; i < dims.length; i++) {
      if (info(dims[i], i).titleAttr === target) {
        return { ok: true, idx: i, why: 'title' }
      }
    }

    // ② 内层标题（wrapperTitle 等）以目标名开头
    for (let i = 0; i < dims.length; i++) {
      const it = info(dims[i], i).innerTitle
      if (it && (it === target || it.startsWith(target))) {
        return { ok: true, idx: i, why: 'inner-title', innerTitle: it.slice(0, 40) }
      }
    }

    // ③ 内容特征兜底：尺码表组件 + 「全选以下规格值」
    const cands = dims.map((d, i) => info(d, i)).filter(x =>
      x.titleAttr === '' && (x.hasSizeWrapper || x.hasQuanxuan)
    )
    if (cands.length === 1) {
      return { ok: true, idx: cands[0].i, why: 'content', detail: cands[0] }
    }
    if (cands.length > 1) {
      // 多个时，优先有 checkbox 的
      const withCb = cands.filter(x => x.cbCount > 0)
      if (withCb.length === 1) return { ok: true, idx: withCb[0].i, why: 'content-cb', detail: withCb[0] }
      return { ok: false, reason: '多个候选无法确定', candidates: cands }
    }

    return {
      ok: false,
      reason: `找不到维度「${dimName}」`,
      all: dims.map((d, i) => info(d, i)),
    }
  })(name)
}

/** 在 page 上调用 */
export async function findDim(page, name) {
  return page.evaluate(findDimInPage, name).catch(e => ({ ok: false, reason: String(e.message).slice(0, 120) }))
}

export default findDim
