# 商品属性批量填写

**元素**：`div[data-testid="beast-core-form-item"][id^="basic.propertys."]`

## 定位方式

**按属性名称填，不写死序号**（序号随类目变）。

纸杯类目实测属性：品牌 / 重要产地 / 适用场景 / 功能特点 / 是否支持定制 / 重要材质 / 使用对象 / 是否接触食品 / 商品资质

## 用法

```js
import { fillAttributesByName, listAttributes, checkRequiredAttributes } from './07-attributes/index.mjs'

// 先看页面有哪些属性
const attrs = await listAttributes(page)

// 按名称批量填
await fillAttributesByName(page, {
  '品牌': ['无品牌/无注册商标'],
  '适用场景': ['家用', '办公'],
  '重要材质': ['原木浆纸'],
  '是否支持定制': ['支持定制'],
})

// 检查必填
await checkRequiredAttributes(page)   // → { ok:false, missing:[{label,formItemId}] }
```

## 输入要求

### 参数（fillAttributesByName）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `byName` | object | ✅ | `{ 属性名: 值 或 值数组 }` |
| `stopOnError` | boolean | ❌ | 失败是否中断，默认 true |
| `timeoutMs` | number | ❌ | 每项超时，默认 12000 |

### byName 的格式

```js
{
  '品牌': ['无品牌/无注册商标'],       // 单选传数组
  '适用场景': ['家用', '办公'],        // 多选传多个
  '重要材质': '原木浆纸',              // 单个值也可传字符串
  '是否支持定制': ['支持定制'],
}
```

### 属性名要求

| 项 | 要求 | 说明 |
|---|---|---|
| **名称** | 必须是页面上**显示的名称** | 先用 `listAttributes()` 探测 |
| **匹配** | 完全相等 → 页面名包含目标 → 目标包含页面名 | 忽略空格和星号 |
| **不要写死序号** | 序号随类目变，必须按名称 | ❌ `basic.propertys.0.value` |

### 属性值要求（必须先探测）

**不同类目的可选值完全不同**，必须从页面拿：

```js
// 对每个属性先看有哪些可选值
import { openSelect, listOptions, closeAllSelects } from '../04-select/index.mjs'

await openSelect(page, { formItemId: 'basic.propertys.2.value' })
const opts = await listOptions(page)
console.log(opts.options.map(o => o.text))
// → ['婚礼', '办公', '家用', '聚会', ...]
await closeAllSelects(page)
```

### 纸杯类目属性清单（实测）

| 属性 | 必填 | 类型 | 实测可选值示例 |
|---|---|---|---|
| 品牌 | ✅ | 单选可搜索 | 无品牌/无注册商标、爱绿森、DAISO/大创… |
| 重要产地 | ❌ | 单选 | 中国大陆、日本… |
| 适用场景 | ❌ | **多选** | 家用、办公、婚礼、聚会… |
| 功能特点 | ❌ | **多选** | 防烫、密封防漏… |
| 是否支持定制 | ❌ | 单选 | 支持定制、不支持 |
| 重要材质 | ❌ | 单选 | 原木浆纸+PE淋膜、毛毡… |
| 使用对象 | ❌ | **多选** | 茶水、咖啡、冰淇淋… |
| 是否接触食品 | ❌ | 单选 | 是、否 |
| 商品资质 | ❌ | **多选** | 依店铺资质而定 |

### 校验（组件内部已做）

| 检查 | 行为 |
|---|---|
| 属性名不存在 | 报错并列出页面所有属性名 |
| 值不存在 | 报错并列出该属性可选值前 10 个 |
| 必填未填 | `checkRequiredAttributes` 可查 |

## 注意事项

- 依赖 `../04-select/index.mjs`
- 名称匹配：完全相等 → 页面名包含目标 → 目标包含页面名
- 找不到时报错会列出页面所有可用属性名
- 内部自动 `closeAllSelects()` 收尾
