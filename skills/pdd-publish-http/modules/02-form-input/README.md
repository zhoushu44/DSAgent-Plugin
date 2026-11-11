# 输入框（含 SKU 表格）

**元素**：`input[data-testid="beast-core-input-htmlInput"] / inputNumber-htmlInput`

## 定位方式

| 定位方式 | 参数 | 示例 |
|---|---|---|
| 表单项 id | `formItemId` | `{ formItemId: 'goods_name' }` |
| placeholder | `placeholder` | `{ placeholder: '自定义容量' }` |
| tracking | `trackingId` | `{ trackingId: 'goods_advice_price' }` |
| testid+序号 | `testId`+`testIdIndex` | `{ testId: 'beast-core-inputNumber-htmlInput', testIdIndex: 0 }` |
| SKU 表格 | `skuRow`+`skuCol` | `{ skuRow: 0, skuCol: 'price', priceIndex: 0 }` |

## 用法

```js
import { fillInput, readInput, countLimit, fillSkuTable, fillCustomSpecValues } from './02-form-input/index.mjs'

// 普通输入
await fillInput(page, { formItemId: 'goods_name', value: '双层中空纸杯' })

// 数字输入（自动按 min/max 夹取）
await fillInput(page, { trackingId: 'goods_advice_price', value: '29.9' })

// SKU 表格批量
await fillSkuTable(page, [
  { quantity: 100, groupPrice: 19.9, singlePrice: 20.9, outSkuSn: 'T01' },
])

// 规格自定义值
await fillCustomSpecValues(page, { placeholder: '自定义容量', values: ['250ml','350ml'] })

// 读值 / 字数
await readInput(page, { formItemId: 'goods_name' })
await countLimit(page, { formItemId: 'goods_name' })   // → { current:38, max:60 }
```

## 输入要求

### 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `value` | string \| number | ✅ | 要填的值。`''` 表示清空 |
| `formItemId` | string | ⬜ | 表单项 id |
| `placeholder` | string | ⬜ | placeholder 模糊匹配 |
| `selector` | string | ⬜ | CSS 选择器 |
| `nearText` | string | ⬜ | 附近文案 |
| `trackingId` | string | ⬜ | data-tracking-viewid |
| `testId` + `testIdIndex` | string + number | ⬜ | data-testid + 序号 |
| `skuRow` + `skuCol` | number + string | ⬜ | SKU 表格行 + 列 |
| `verify` | boolean | ❌ | 填完读回校验，默认 true |
| `timeoutMs` | number | ❌ | 等元素出现超时，默认 5000 |

**定位参数至少给一个**，多个同时给时按「selector → trackingId → testId → formItemId → skuRow → placeholder → nearText」顺序优先。

### 各字段的值要求

| 字段 | 类型 | 要求 | 示例 |
|---|---|---|---|
| 商品标题 | string | **≤ 30 汉字**（60 字符）| `双层中空纸杯一次性咖啡杯加厚防烫热饮杯`（19 字）|
| 商品参考价 | number | **> 最大 SKU 单买价**，≤ 10000000 | `29.9` |
| 库存 | number | 0 ~ 999999 整数 | `100` |
| 拼单价 | number | 两位小数，单位**元** | `19.90` |
| 单买价 | number | 两位小数，**> 拼单价** | `20.90` |
| 商品编码 | string | 字母数字，建议 ≤ 20 位 | `T01` |
| 折扣 | number | 5.0 ~ 9.9 | `9.5` |
| 自定义容量 | string | ≤ 20 字符 | `350ml` |
| 自定义尺寸 | string | ≤ 20 字符 | `30*60cm` |

### SKU 表格列序（`fillSkuTable`）

| 位置 | 列名 | skuCol 参数 | 类型 |
|---|---|---|---|
| 第 1 列 | 库存 | `'quantity'` | 整数 |
| 第 2 列 | 拼单价 | `'price'` + `priceIndex:0` | 两位小数 |
| 第 3 列 | 单买价 | `'price'` + `priceIndex:1` | 两位小数 |
| 第 4 列 | 商品编码 | `skuColIndex:3` | 字符串 |

### fillSkuTable 的 rows 格式

```js
[
  {
    quantity: 100,        // 库存（整数）
    groupPrice: 19.9,     // 拼单价（元，两位小数）
    singlePrice: 20.9,    // 单买价（元，必须 > groupPrice）
    outSkuSn: 'T01',      // 商品编码
  }
]
```

### 校验规则（组件内部已做）

| 检查 | 行为 |
|---|---|
| inputNumber 超 `min`/`max` | 自动夹取到边界 |
| 填完读回不一致 | `ok:false`，`error` 说明期望 vs 实际 |
| 元素不存在 | 重试 5 秒，仍无则 `NOT_FOUND` |

## 注意事项

- **React 受控组件**：`input.value='x'` 无效，必须 native setter + `dispatchEvent('input')`
- **字数统计**：计数 span 是 `visibility:hidden`，`innerText` 读不到，必须用 `textContent`
- **inputNumber**：自动识别并按 `min`/`max` 夹取，先 `blur()` 再派发 blur 事件
- **SKU 表格列序**：库存 → 拼单价 → 单买价 → 编码 → 其他
