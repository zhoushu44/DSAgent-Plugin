/**
 * 发布组件 · 规格维度（specs）
 *
 * ★ 规格 ≠ SKU：
 *   · 规格（specs）= 维度名 + 维度值，决定 SKU 表有几行几列
 *   · SKU（skus）  = 每个组合的 价格/库存/预览图
 *   两者是不同东西，组件也分开。
 *
 * ★ 设计原则：只 re-export lib 里已验证的函数，不改逻辑。
 *
 *   lib 的 fillSkuSpecMulti 已实现四类页面结构自适应：
 *     · input[placeholder*="主色"]       颜色输入框
 *     · input[placeholder="自定义尺码"]   自定义尺码（不勾预设）
 *     · .package-item-container checkbox 预设值（精确/语义/自定义添加）
 *     · 都没有                            点「添加规格类型」新建维度
 *   并且处理了尺码表 chips、规格类型下拉等实测坑。
 */
export {
  fillSkuSpecMulti,  // 多维规格（推荐入口）
  fillSkuSpec,       // 单维规格
} from '../../../lib/pdd-publish.js'
