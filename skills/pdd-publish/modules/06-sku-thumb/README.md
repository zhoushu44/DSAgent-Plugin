# SKU 预览图

**元素**：`span.sku-preview-img`

## 定位方式

每个 `.sku-preview-img` 对应一行 SKU，点击弹出选图窗口。

## 用法

```js
import { setSkuThumbs, probeSkuThumbs } from './06-sku-thumb/index.mjs'

// 探测现状
await probeSkuThumbs(page)   // → { count: 6, cells: [{ index, hasImg, src }] }

// 按顺序配图（循环使用）
await setSkuThumbs(page, { urls: ['https://a.png','https://b.png'] })

// 指定行配图
await setSkuThumbs(page, { map: { 0: 'https://a.png', 3: 'https://d.png' } })
```

## 输入要求

### 参数（setSkuThumbs）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `urls` | string[] | ⬜ | 按行顺序配图（第 i 行用 urls[i % len]）|
| `map` | object | ⬜ | 指定行 → 图片 URL，如 `{0:'https://...'}` |
| `maxRows` | number | ❌ | 最多处理几行，默认全部 |

**`urls` 和 `map` 至少给一个**。

### 图片 URL 要求

| 项 | 要求 | 说明 |
|---|---|---|
| **来源** | **必须是本店图片空间或已上传的商品图** | 外部 URL 会被拒 |
| **格式** | 平台 CDN 地址 | `https://img.pddpic.com/...` |
| **尺寸** | 建议 ≥ 200×200 | 预览图显示 32×32，但源图要清晰 |
| **数量** | 每个 SKU 1 张 | 可循环复用 |

### url 从哪来

```js
// ① 从商品主图里拿（推荐）
const probe = await probeImageRegion(page, 'carousel')   // 组件 01
// 或者直接从 commit/detail 读 gallery

// ② 从图片空间读
POST /garner/mms/file/dir_list
// → { result: { file_list: [{ name, url, id }] } }
```

### 校验（组件内部已做）

| 检查 | 行为 |
|---|---|
| 行不存在 | 报「第 N 行不存在（共 M 行）」|
| 弹窗未出现 | 报「弹窗未出现」，点空白关掉遮罩继续 |
| 图片匹配 | 按 URL 片段匹配，匹配不到用第 1 张 |
| 单行失败 | 不中断，继续下一行 |

## 注意事项

- 未设图时格子内是 `svg[data-testid="beast-core-icon-picture"]`，设了图是 `img`
- 弹窗里图片按 URL 片段匹配，匹配不到用第 1 张
- 有「确定/确认/完成/保存」按钮就点，没有则认为选完自动关
- 单行失败不中断，继续下一行
