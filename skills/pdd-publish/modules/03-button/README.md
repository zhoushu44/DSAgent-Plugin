# 按钮

**元素**：`button[data-testid="beast-core-button"]`

## 定位方式

| 定位方式 | 参数 | 示例 |
|---|---|---|
| XPath | `xpath` | `{ xpath: '//button[@id="bottomSubmitBtnId"]' }` |
| id | `id` | `{ id: 'bottomSubmitBtnId' }` |
| tracking | `trackingId` | `{ trackingId: 'confirm_publish_this_type_product' }` |
| 文字 | `text` | `{ text: '下一步 完善商品信息' }` |
| volta | `volta` | `{ volta: '43c6e0ba-...' }` |
| 图标 | `icon` | `{ icon: 'beast-core-icon-plus' }` |

## 用法

```js
import { clickButton, findButton, waitButtonReady, listButtons } from './03-button/index.mjs'

// 下一步
await clickButton(page, { id: 'bottomSubmitBtnId', waitNavigation: true })

// 添加规格类型（带 svg 图标，自动匹配 span 文字）
await clickButton(page, { text: '添加规格类型' })

// 按图标找（页面有多个 + 按钮时）
await clickButton(page, { icon: 'beast-core-icon-plus' })

// 列所有按钮
await listButtons(page)   // → [{ id, trackingId, text, disabled, visible, xpath }]
```

## 输入要求

### 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `xpath` | string | ⬜ | 直接给 XPath（优先级最高）|
| `id` | string | ⬜ | 按钮 id |
| `trackingId` | string | ⬜ | data-tracking-*-viewid |
| `text` | string | ⬜ | 按钮文字（自动归一化：去空格去标点）|
| `volta` | string | ⬜ | data-volta |
| `icon` | string | ⬜ | 图标 data-testid，如 `beast-core-icon-plus` |
| `waitNavigation` | boolean | ❌ | 点完等 URL 变化，默认 false |
| `timeoutMs` | number | ❌ | 等可点 / 等跳转超时，默认 30000 |
| `force` | boolean | ❌ | 禁用也点（不推荐）|

**定位参数至少给一个**，多个同时给时按「xpath → id → volta → trackingId → text → icon」顺序。

### 文字归一化规则

`text` 参数会自动去掉空格和标点，所以以下都能匹配同一个按钮：

```
'下一步, 完善商品信息'
'下一步 完善商品信息'
'下一步完善商品信息'
```

### 可点击条件（组件内部检查）

| 条件 | 判定 | 不满足时 |
|---|---|---|
| **可见** | `getBoundingClientRect().width/height > 0` | 报「按钮不可见」 |
| **非禁用** | 无 `disabled` 属性、class 不含 `disabled` | 报「按钮禁用」 |
| **非加载** | 文字不含「加载中/提交中」、无 spin 元素 | 继续等，最多 timeoutMs |

### 常用按钮参数速查

| 按钮 | 定位参数 |
|---|---|
| 下一步，完善商品信息 | `{ id: 'bottomSubmitBtnId' }` |
| 提交并上架 | `{ text: '提交并上架' }` 或 `{ trackingId: 'confirm_publish_this_type_product' }` |
| 保存草稿 | `{ text: '保存草稿' }` |
| 添加规格类型 | `{ text: '添加规格类型' }` 或 `{ icon: 'beast-core-icon-plus' }` |
| 选择分类 | `{ text: '选择分类' }` |
| 图片空间上传 | `{ trackingId: 'image_space_upload' }` |

## 注意事项

- **纯 XPath + `el.click()`，不用鼠标坐标**（坐标会因页面滚动失效）
- 带 svg 图标的按钮：`textContent` 含图标空白 → 生成 XPath 时同时匹配 `.//span`
- 点击前自动检查：可见 / 非禁用 / 非加载中
- `waitNavigation: true` 时等 URL 变化，未变则报错（说明有校验拦截）
