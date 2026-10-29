/**
 * 发布组件 · 发货与售后 + 运费模板
 *
 * ★ 设计原则：只 re-export lib 里已验证的函数，不改逻辑。
 *
 *   lib 的 fillShippingAndFreight 已实现：
 *     · 发货方式（非预售）
 *     · 发货时间（当日发货及揽收）
 *     · 运费模板（「其他模板」单选 → .template-box-select 下拉 → 精确/首个）
 *     · 店铺级缓存（attrCache）
 */
export {
  fillShippingAndFreight,  // 发货方式 + 发货时间 + 运费模板
  disableSizeChart,        // 停用尺码表（服装类目才有，其他类目自动跳过）
} from '../../../lib/pdd-publish.js'
