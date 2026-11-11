/**
 * 发布组件 · 规格维度（specs）
 *
 * ★ 规格 ≠ SKU：
 *   · 规格（specs）= 维度名 + 维度值，决定 SKU 表有几行几列
 *   · SKU（skus）  = 每个组合的 价格/库存/预览图
 *   两者是不同东西，组件也分开。
 *
 * ★ 设计原则（2026-10-29 定稿）：
 *   组件化 = **结构化拆分，不是重写逻辑**。
 *   填规格的主逻辑只 re-export `lib/pdd-publish.js` 里已验证的函数，一行不改。
 *   本文件只额外提供 **只读** 的页面结构探测（scanDims），供模板沉淀使用。
 *
 *   教训：之前把 fillAttributes / fillSkuSpecMulti / fillPriceTable 全部重写成
 *   新实现，材质成分连续坏 3 次，上架直接失败。
 */
export {
  fillSkuSpecMulti,  // 多维规格（推荐入口）
  fillSkuSpec,       // 单维规格
} from '../../../lib/pdd-publish.js'

const SPEC_ROOT = '#goods-spec-sku'

/**
 * 扫描规格区：读出**页面真实**的维度结构（只读，不填任何东西）
 *
 * 用于：
 *   · 上架成功后沉淀类目模板（记录真实维度名 + 填写类型）
 *   · 排查「这个类目的规格区长什么样」
 *
 * @returns { dims: [{ idx, dim, type, checkboxCount, inputCount }] }
 *   type: color-input | custom-input | checkbox | spec-type
 */
export async function scanDims(page) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) return { dims: [] }

    const containers = [
      ...root.querySelectorAll('.property-container-v2'),
      ...root.querySelectorAll('.goods-spec-row'),
    ]

    const dims = containers.map((c, idx) => {
      // 维度名：4 级兜底（与 detectColorRow 一致）
      let dim = ''
      const typeInp = c.querySelector('input[placeholder^="规格类型"]')
      if (typeInp && typeInp.value) dim = String(typeInp.value).trim()
      if (!dim) dim = String(c.querySelector('.property-name-title')?.textContent || '').trim()
      if (!dim) dim = String(c.querySelector('[class*="sizeStandardWrapper_title"]')?.textContent || '').trim()
      if (!dim) {
        dim = String(c.innerText || '')
          .replace(/添加图片|删除规格类型|添加定制规格|本地上传/g, '')
          .replace(/\s+/g, '')
          .slice(0, 8)
      }

      // 类型判定（顺序即优先级）
      const hasColorInput = !!c.querySelector('input[placeholder*="主色"]')
      const checkboxes = [...c.querySelectorAll('.package-item-container')]
        .filter(it => (it.querySelector('.check-wrapper')?.textContent?.trim() || '').length > 0)
      const hasCustomSize = !!c.querySelector('input[placeholder="自定义尺码"]')
      const customInputs = [...c.querySelectorAll('input')].filter(e => {
        const p = e.placeholder || ''
        const r = e.getBoundingClientRect()
        return p.includes('自定义') && !p.includes('排序') && r.width > 30
      })
      const allInputs = [...c.querySelectorAll('input')].filter(e => {
        const p = e.placeholder || ''
        return !p.startsWith('规格类型') && (e.type === 'text' || !e.type)
      })

      let type = 'spec-type'
      if (hasColorInput) type = 'color-input'
      else if (hasCustomSize) type = 'custom-size'
      else if (checkboxes.length) type = 'checkbox'
      else if (customInputs.length || allInputs.length) type = 'custom-input'

      return {
        idx,
        dim: dim.replace(/[*＊]/g, ''),
        type,
        checkboxCount: checkboxes.length,
        inputCount: allInputs.length,
      }
    })

    return { dims }
  }, SPEC_ROOT).catch(() => ({ dims: [] }))
}

/**
 * 把页面维度与用户维度对齐（同名优先，否则按顺序）
 * @param pageDims scanDims 的结果
 * @param userSpecs 商品 JSON 的 specs
 * @returns [{ user, page, type, checkboxCount }]
 */
export function alignDims(pageDims, userSpecs) {
  const out = []
  const used = new Set()

  for (let i = 0; i < (userSpecs || []).length; i++) {
    const us = userSpecs[i]
    const uname = String(us?.name || '').trim()
    // ① 同名匹配
    let pd = (pageDims || []).find((d, j) => !used.has(j) && d.dim && (d.dim === uname || d.dim.includes(uname) || uname.includes(d.dim)))
    // ② 按顺序
    if (!pd) {
      for (let j = 0; j < (pageDims || []).length; j++) {
        if (!used.has(j)) { pd = pageDims[j]; used.add(j); break }
      }
    } else {
      used.add((pageDims || []).indexOf(pd))
    }
    out.push({
      user: uname,
      page: pd?.dim || uname,
      type: pd?.type || '',
      checkboxCount: pd?.checkboxCount || 0,
    })
  }
  return out
}

/* ══════════════ 基础工具（供其他组件复用） ══════════════ */

/**
 * JS 点击（elementFromPoint + .click()）
 * ★ 比 page.mouse.click 稳定：不依赖坐标精度
 *   注意：规格值输入仍必须用真实键盘（平台只认键盘事件注册 spec_id）
 */
export async function jsClick(page, x, y) {
  await page.evaluate((px, py) => {
    const el = document.elementFromPoint(px, py)
    if (!el) return false
    let t = el
    for (let i = 0; i < 5 && t; i++) {
      const tag = t.tagName
      if (tag === 'INPUT' || tag === 'LABEL' || tag === 'BUTTON' || tag === 'A') break
      t = t.parentElement
    }
    ;(t || el).click()
    try { (t || el).focus?.() } catch { /* ignore */ }
    return true
  }, x, y).catch(() => {})
}

/**
 * 失焦（blur 当前焦点元素 + 点 body 空白）
 */
export async function jsBlur(page) {
  await page.evaluate(() => {
    const el = document.activeElement
    if (el && typeof el.blur === 'function') el.blur()
    document.body.click()
  }).catch(() => {})
}

/** sleep 透传（方便其他组件统一 import） */
export const sleep = ms => new Promise(r => setTimeout(r, ms))