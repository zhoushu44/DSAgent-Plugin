/**
 * 发布组件 · SKU 表（库存 / 拼单价 / 单买价 / 参考价）
 *
 * ★ SKU ≠ 规格：
 *   规格决定表结构，SKU 填表格里的价格库存。
 *
 * ★ 设计原则：只 re-export lib 里已验证的 fillPriceTable，不改逻辑。
 *
 *   lib 的 fillPriceTable 已实现：
 *     · 按「拼单价」表头定位 table
 *     · 逐行填 库存 / 拼单价 / 单买价
 *     · JS setter 优先 + 键盘兜底 + 回读验证
 *
 *   注意：lib 版是按**行索引**逐行填，实测能成功上架。
 *   我另写的 sku-table.mjs（按 rowspan 继承 key 定位）留作实验版，
 *   待对比验证通过后再替换。
 */
export {
  fillPriceTable,  // 填 SKU 表价格/库存
} from '../../../lib/pdd-publish.js'
