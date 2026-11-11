/**
 * 发布组件 · 基础字段（标题 / 通用字段 / 类目读回）
 *
 * ★ 设计原则（2026-10-29 定稿）：
 *   组件化 = **结构化拆分，不是重写逻辑**。
 *   本文件只 re-export `lib/pdd-publish.js` 里**已经上架成功过**的函数，
 *   一行逻辑都不改。这样既有清晰边界，又不引入回归风险。
 *
 *   教训：之前我把 fillAttributes 重写成 field-attributes.mjs 的新实现，
 *   材质成分连续坏 3 次（滚动/弹窗定位/搜索框），直接导致上架失败。
 */
export {
  fillTitle,   // 商品标题：input[placeholder*="商品标题组成"]
  fillField,   // 通用「按 label 关键词找 input 填值」（参考价/货号等）
} from '../../../lib/pdd-publish.js'

/**
 * 读回表单页类目（校验用）
 * 实现在 lib 内部，这里做一层稳定封装。
 */
export async function readCategory(page) {
  const txt = await page.evaluate(() => {
    const el = document.querySelector('#goods-category')
    return (el?.innerText || '').replace(/\s+/g, ' ').trim()
  }).catch(() => '')
  return txt && txt !== '商品分类' ? txt : ''
}
