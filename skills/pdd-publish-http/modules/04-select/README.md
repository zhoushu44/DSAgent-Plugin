# 下拉选择（单选/多选/只读）

**元素**：`div[data-testid="beast-core-select"]`

## 定位方式

| 定位方式 | 参数 | 示例 |
|---|---|---|
| 表单项 id | `formItemId` | `{ formItemId: 'basic.propertys.0.value' }` |
| placeholder | `placeholderText` | `{ placeholderText: '规格类型1' }` |
| XPath | `selectXpath` | `{ selectXpath: '//div[...]' }` |
| CSS | `selector` | `{ selector: '#xxx' }` |

## 用法

```js
import { selectOptions, readSelected, probeSelect, closeAllSelects } from './04-select/index.mjs'

// 单选（品牌，可搜索）
await selectOptions(page, { formItemId: 'basic.propertys.0.value', values: ['无品牌/无注册商标'] })

// 多选（适用场景）
await selectOptions(page, { formItemId: 'basic.propertys.2.value', values: ['家用', '办公'] })

// 只读规格下拉
await selectOptions(page, { placeholderText: '规格类型1', values: ['口味'] })

// 读已选
await readSelected(page, { formItemId: 'basic.propertys.2.value' })
```

## 输入要求

### 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `values` | string[] | ✅ | 要选的值（单选传 1 个，多选可多个）|
| `formItemId` | string | ⬜ | 表单项 id |
| `placeholderText` | string | ⬜ | 下拉框 placeholder（规格下拉用）|
| `selectXpath` | string | ⬜ | select 容器 XPath |
| `selector` | string | ⬜ | CSS 选择器 |
| `search` | boolean | ❌ | 强制先输入关键字再选 |
| `timeoutMs` | number | ❌ | 等选项出现超时，默认 10000 |

**定位参数至少给一个**，按「selectXpath → formItemId → placeholderText → selector」顺序。

### values 的要求

| 项 | 要求 | 说明 |
|---|---|---|
| 类型 | `string[]` | 单选也只传数组，如 `['爱绿森']` |
| 匹配 | **归一化后完全匹配 → 包含匹配** | 去空格、去标点后对比 |
| 多选 | 可传多个值 | 已选过的自动跳过 |
| 单选 | 只取第 1 个 | 后面的值会被忽略 |

### 值的来源（必须先探测）

**不能瞎填**，必须先从页面拿到真实可选值：

```js
// ① 展开看有什么选项
await openSelect(page, { formItemId: 'basic.propertys.0.value' })
const opts = await listOptions(page)
console.log(opts.options.map(o => o.text))
// → ['无品牌/无注册商标', 'DAISO/大创', 'BIALETTI/比乐蒂', ...]
```

### 三种下拉类型

| 类型 | 特征 | 输入要求 |
|---|---|---|
| 单选可搜索 | `placeholder="请输入品牌名称搜索"` | values 可任意文字，会自动搜索 |
| 多选 | `ST_selectValueMultiple` | values 必须是列表里已有的选项 |
| 只读单选 | `input readonly` | values 必须是列表里已有的选项 |

### 校验（组件内部已做）

| 检查 | 行为 |
|---|---|
| 面板叠加 | 打开前先 `closeAllSelects()` |
| 已选值 | 跳过，不重复点（避免取消勾选）|
| 选项不存在 | 报错并列出可选值前 10 个 |
| 选完读回 | 校验是否真的选上了 |

## 注意事项

- **面板会叠加** → 打开前先 `closeAllSelects()` 关掉所有已开面板
- **单选选完自动关**，多选选完需要手动关（组件自动处理）
- **已选值自动跳过**（重复点同一项 = 取消勾选）
- **只读下拉**（`input readonly`）不能输入，只能展开后点选项
