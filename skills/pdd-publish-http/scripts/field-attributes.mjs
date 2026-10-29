/**
 * 发布组件 · 类目属性（唯一随类目变化的模块）
 *
 * ★ 设计原则：只 re-export lib 里已验证的 fillAttributes，不改逻辑。
 *
 *   lib 的 fillAttributes 已经处理了全部实测踩坑：
 *     · 材质成分 IngredientList 弹窗：滚动 → 鼠标点按钮 → 鼠标点候选 → 鼠标点确定
 *       （★ 必须真实鼠标，JS click 是 untrusted，计数一直 0/7）
 *     · 下拉型属性：openAttrDropdown → readOpenOptions → clickOpenOption
 *     · 1688 → 拼多多 属性名别名映射（ATTR_ALIAS）
 *     · 无真实值时留空不猜
 *
 *   ★ 教训：我重写的版本「限定 searchPanel 内查找」+「先输入搜索词」反而坏了，
 *     因为实体候选默认就在页面上，不需要搜索。
 */
export {
  fillAttributes,   // 全部类目属性（材质成分 + 所有下拉）
} from '../../../lib/pdd-publish.js'
