# 单选框

**元素**：`label[class*="RD_radio"] > svg[data-testid*="radio"]`

## 定位方式

| 定位方式 | 参数 | 示例 |
|---|---|---|
| 表单项 id | `formItemId` | `{ formItemId: 'basic.propertys.4.value' }` |
| 分组标题 | `nearText` | `{ nearText: '是否支持定制' }` |
| XPath | `xpath` | `{ xpath: '//div[@id="..."]' }` |

## 用法

```js
import { selectRadio, readRadio, listRadios } from './05-radio/index.mjs'

// 按文字选
await selectRadio(page, { formItemId: 'basic.propertys.4.value', label: '不支持' })

// 按序号选（0 开始）
await selectRadio(page, { formItemId: 'basic.propertys.4.value', index: 1 })

// 读当前选中
await readRadio(page, { formItemId: 'basic.propertys.4.value' })

// 列所有选项
await listRadios(page, { formItemId: 'basic.propertys.4.value' })
```

## 输入要求

### 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `label` | string | ⬜ | 选项文字（归一化匹配）|
| `index` | number | ⬜ | 选项序号（0 开始）|
| `formItemId` | string | ⬜ | 表单项 id |
| `nearText` | string | ⬜ | 分组标题文字 |
| `xpath` | string | ⬜ | 组容器 XPath |
| `verify` | boolean | ❌ | 点完读回校验，默认 true |

**`label` 和 `index` 必须给一个**（label 优先）。
**定位参数至少给一个**（formItemId / nearText / xpath）。

### label 的要求

| 项 | 要求 |
|---|---|
| 匹配 | 归一化后完全匹配 → 包含匹配 |
| 内容 | 必须是选项的**显示文字**，不是 value |
| 来源 | 先用 `listRadios()` 探测 |

```js
// 先看有什么选项
const r = await listRadios(page, { formItemId: 'basic.propertys.4.value' })
// → { found:true, options:[{index:0,text:'支持定制',checked:false},{index:1,text:'不支持',checked:true}] }
```

### 已知单选属性（纸杯类目）

| 属性 | 常见选项 |
|---|---|
| 是否支持定制 | 支持定制 / 不支持 |
| 是否接触食品 | 是 / 否 |

### 校验（组件内部已做）

| 检查 | 行为 |
|---|---|
| 已选中 | 跳过，不重复点 |
| 禁用 | 报「已禁用」 |
| 读回不一致 | `ok:false`，说明期望 vs 实际 |

## 注意事项

- **判定选中**：看 svg 的 `data-testid` 是否含 `_filled`
  - `radio-normal` 未选 / `radio-filled` 已选
  - `radio-disable` 未选+禁用 / `radio-disable_filled` 已选+禁用
- **点 label 不点 input**（input 通常 display:none）
- **已选中自动跳过**，不会重复点
