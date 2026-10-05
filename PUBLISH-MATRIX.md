# 新平台上架接入规范

> 参照实现：`taobao-publish.ts` / `pdd-publish.ts`
> 适用范围：**有强制类目树 + 类目属性表**的平台上架（淘宝、拼多多、抖音小店、快手小店、1688、TikTok Shop 等）
> **不适用**：内容发布（bilibili/douyin/xiaohongshu/zhihu——发视频/笔记/文章，无类目属性）；闲鱼（无强制类目树，自由填）

---

## 一、为什么必须走浏览器

发布的核心动作是**图片文件上传（multipart 二进制）**，网关只支持字符串 body（http_get/http_post/mtop_jsonp），没有 multipart 能力。且发布页的类目属性与提交接口都要求页面 JS 运行时生成的签名与真实会话票据，纯 HTTP 复刻不可行。所以**一律 puppeteer 驱动网页版发布页**。

---

## 二、上架的两步结构（顺序不能反）

### 第一步：类目匹配

类目不是"填一个值"，是"选对一个已存在的叶子节点"。平台不允许随便写类目名，必须命中类目树里的叶子节点 ID。匹配方式三选一：

| 做法 | 适用 | 实现要点 |
|---|---|---|
| **手动选** | 平台后台原生流程 | 等用户在窗口内选好，`waitForPublishTab` 等新页 |
| **关键词匹配** | 有类目搜索框的平台（淘宝） | `selectCategory`：搜关键词 → 回车 → 选第一个候选 → 等提交按钮可用 |
| **按发布入口自动推荐** | 拼多多等无搜索框的平台 | 平台按入口 URL 自动带出类目，不需要主动选 |

> ⚠️ **填太宽的类目**（如"杯子"而非"马克杯"）会导致属性表整张错位——后面的属性字段全是别的类目的，全白填。

### 第二步：属性填值（类目定了才做）

类目定后，平台带出该类目的**属性表**（哪些必填、枚举值、校验规则）。按字段类型分两种填法：

| 字段类型 | 填法 | 实现 |
|---|---|---|
| **枚举/下拉型** | 拉表 → 读真实选项 → AI 选值 → 点选 → 回读校验 | `readCatPropItems` → `openPropDropdown` → `readPropOptions` → `pickPropValue` → `clickPropOption` → `verifyPropValue` |
| **文本型** | AI 生成文本，按 DOM 的 maxlength 截断 | `fillField`（读 maxlength 超了截断） |

---

## 三、属性拉表的标准函数链（7 个函数，顺序固定）

新平台照这 7 个函数实现，命名只换平台前缀：

```
1. readXxxAttrItems    — 扫页面 DOM 拉出全部属性项（id/name/required/filled/kind/maxlength/hint）
2. openXxxDropdown     — 展开某属性的下拉面板（★ 淘宝用 JS 原生 .click()，拼多多用 mousedown——每平台不同，实测）
3. readXxxOptions      — 读已展开下拉的真实候选选项
4. pickXxxValue        — 调文本模型从候选里选（只返回候选里的值，不创造新值）
5. clickXxxOption      — 点中选中的选项
6. verifyXxxValue      — 回读确认值是否真的填上了
7. fillXxxAttrs        — 循环调用 1-6，返回 { filled, missed }
```

### 每个函数的关键约束

| 函数 | 关键约束 |
|---|---|
| `readAttrItems` | 从 DOM 读 `maxlength`（类目规则优先）、`required`（必填标记）、`hint`（校验提示）；kind 分 combobox/select/text |
| `openDropdown` | ★ **展开方式每平台不同**，必须实测：淘宝只有 `element.click()` 能展开（mouse 事件全无效），拼多多靠 header 上的 mousedown/click |
| `readOptions` | 等下拉展开动画（`ATTR_DROPDOWN_WAIT_MS = 800`）再读 |
| `pickValue` | 返回 `{ value, hesitated, candidates }`——值不在候选里 = 犹豫信号，判放弃；只返回候选里的值 |
| `clickOption` | 真实鼠标点击坐标（`page.mouse.click(x, y)`），部分节点 `element.click()` 无效 |
| `verifyValue` | 回读 input.value 或 `.next-select-values` 的 innerText，确认值真的在 |
| `fillAttrs` | 填失败不阻断发布，只记 `missed`；品牌一律跳过（`ATTR_SKIP_RE = /^品牌$/`，授权风险） |

---

## 四、缓存层（省模型 API 调用）

同类目发相似商品时，上次成功填的属性值直接复用，不调模型：

```
填属性循环：
  1. 展开下拉 → 读当前真实选项
  2. 查缓存（平台+类目+属性名）→ 有上次成功填的值？
     ├─ 有且值在当前选项里 → 直接用，标"缓存命中"（不调模型）
     └─ 无 / 不在选项里 → fallback 到模型选
  3. 点选 → 回读校验
  4. 成功：模型选的记进缓存；缓存命中的不重复记
```

**接入方式**（每个新平台加 3 行）：

```typescript
import { createAttrCache, type AttrCache } from './services/attr-cache.js'

const attrCache: AttrCache = createAttrCache(
  (() => {
    const p = require('node:path')
    return p.join(require('node:os').homedir(), '.dsh', '.attr-cache.json')
  })()
)
```

然后在 `fillXxxAttrs` 循环里加缓存查询/验证/记录（照 taobao-publish 的 `fillCategoryAttrs` 循环体抄）。

**关键安全设计**：
- 只缓存成功且经页面验证的值（confirmed=true 才记）
- 命中后仍读当前下拉选项做验证——选项变了就 fallback，不硬塞旧值
- 只缓存枚举型（下拉选值），不缓存文本型
- 写串行化 + 原子写（tmp+rename），失败不影响发布

---

## 五、类目规则优先（从 DOM 读，不查文档）

不同类目的标题字符上限、必填项、校验规则不同——**不能一套默认值打天下**。

在国内平台，类目规则**就在 DOM 里**，不用查文档：
- `maxlength` 属性 → 文本型字段的字符上限
- `.required` / `*` → 必填标记
- 字段下方的红色文案 → 校验提示

`readAttrItems` 把这三个都读出来，`fillField` 按 maxlength 截断——这就是"类目规则优先"在国内平台的落地版。

---

## 六、选值证据（filled 项标来源）

每个成功填的属性项不只是 `属性名=值`，还要标**来源**：
- `（候选N项）` — 模型从 N 个候选里选的
- `（缓存命中）` — 复用上次成功值，没调模型

用户事后能查"这个属性为什么选了陶瓷不选玻璃"，出问题时能复盘。

---

## 六·补 A：SKU 规格填写（销售属性，不是类目属性）

SKU 规格是上架里仅次于类目属性的第二大填值环节。它和类目属性一样是"读候选→选值→填表"，但来源是**销售属性**（颜色/尺码），不是类目属性。每个平台的实现差异较大：

| 平台 | 函数 | 关键差异 |
|---|---|---|
| 淘宝 | `fillSkus` | 销售属性 ID 是类目决定的（如 1627207=颜色分类）；规格值逐个键入 + **Tab 提交**（唯一能提交到 React state 的方式）；回读 SKU 表行填价格/数量/编码 |
| 拼多多 | `fillSkuSpec` | 规格值填入后自动展开 SKU 表；**单买价 = 拼单价 + 1**（自动计算，不用传）；填预览图（平台必填，1:1 宽高 >480px） |

**关键约束**：
- 销售属性 ID 每类目不同，不能硬编码（淘宝实测"AI软件订阅"类目颜色分类 = 1627207）
- 拼多多的单买价自动 = 拼单价 + 1，传参时只传拼单价
- 淘宝 Tab 键是唯一能提交规格值到 React state 的方式（回车不行）

---

## 六·补 B：详情图上传

详情图是一组图片上传到详情编辑器，方式每平台不同：

| 平台 | 函数 | 方式 |
|---|---|---|
| 淘宝 | `fillDetailImages` | 打开详情编辑器（iframe `#desc-editor`）→ 逐张上传到素材库 → 插入编辑器 |
| 拼多多 | `uploadDetailImages` | 直接 `input[type=file]` 批量上传（最多 50 张、单张 ≤3MB） |

**关键约束**：
- 淘宝详情编辑器是 iframe，需要在 iframe 上下文里操作（`page.frames()` 切换）
- 拼多多单张 ≤3MB、最多 50 张
- 上传失败不阻断发布，只记 `missed`

---

## 六·补 C：运费模板选择（通用字段里藏必填项）

淘宝的"提取方式"是通用字段里**藏必填项**的典型坑：

```
表面看：勾一个 checkbox（"使用物流配送"）
实测发现：★ 只勾 checkbox 校验仍不通过（提示「提取方式为必填项，不能为空」）
          勾选后必须再选一个运费模板（next-select-trigger），否则提交被拦
```

运费模板是**店铺真实数据**，不能硬编码：展开下拉读真实候选，优先取含"默认模板"的一项，取不到取第一项；一项都没有（店铺未配置）时只勾选并记 missed，交人工。

> 这条教训适用于所有"看似简单的通用字段"——**勾选/填值后可能还藏着级联必填项**，实测才能发现。

---

## 六·补 D：提交后错误回读（三路精准诊断）

提交被拦时，**不能靠整页文本正则匹配**——覆盖面窄，180s 空转后只能报"未检测到成功标志"。拼多多的 `readSubmitErrors` 用三路诊断，淘宝已吸收同名函数：

| 诊断路 | 读什么 | 怎么读 |
|---|---|---|
| ① toast | next 组件 toast 文案（排除成功文案） | `.next-message-notice` / `.next-toast` |
| ② 字段级红字 | 每个字段下方的红色校验文案 | `.sell-component-info-wrapper-explain` / `[class*="Form_itemError"]` |
| ③ 填写建议面板 | "商品填写建议"面板的错误 tab（数量+文案）+ 建议项 | `.sell-optimization-container` / `[class*="optimization-container"]` |

返回 `{ hard, panel }`：
- `hard` = 硬拦因（有它就不必再等，直接 break 循环）
- `panel` = 面板全文（诊断用，加进失败返回文案给用户看）

**接入方式**：在提交后的判定循环里，先做原来的正则兜底匹配（不立即中断），再调 `readSubmitErrors`，hard 命中才 break。失败返回里把 `errText`（硬拦因）+ `errPanel`（面板全文）都带给用户。

> ★ 这条是拼多多有、淘宝原来没有的——现在两边对齐了。

---

## 七、新平台接入检查清单

接一个新的有类目树的上架平台时，照这张清单走：

### 页面锚点实测（最耗时，必须真机）
- [ ] 发布入口 URL（发布页/类目页/表单页分别是什么）
- [ ] 类目选择方式（搜索框？自动推荐？手动树？）
- [ ] 属性区根容器选择器（淘宝 `#struct-catProp`，拼多多 `.goods-propertys .property-item`）
- [ ] 属性项的 id/label/required/kind 怎么读
- [ ] 下拉展开方式（`.click()`？`mousedown`？`ArrowDown`？—— **每平台不同，实测**）
- [ ] 下拉选项选择器（淘宝 `.options-item`，拼多多 `[class*="options"]`）
- [ ] 提交按钮选择器
- [ ] 成功标志（URL 跳转？`#success-container`？文字匹配？）
- [ ] 风控检测（滑块？验证页？—— 有则接 `dsagent_risk_verify`）
- [ ] **提交后错误回读**：toast 选择器？字段级红字选择器？填写建议面板选择器？（见六·补 D）
- [ ] **SKU 规格区**：销售属性 ID 怎么读？规格值怎么提交（Tab？回车？）？SKU 表行怎么回读？
- [ ] **详情图上传**：是 iframe 编辑器还是直接 input[type=file]？批量还是逐张？大小/数量限制？
- [ ] **运费模板**：勾选后是否还有级联必填项（如运费模板选择）？

### 函数实现（照 7 函数链 + 3 补）
- [ ] `readXxxAttrItems` — 拉 DOM 属性表（含 maxlength/required/hint）
- [ ] `openXxxDropdown` — 实测的展开方式
- [ ] `readXxxOptions` — 读候选
- [ ] `pickXxxValue` — 模型选值，返回 { value, hesitated, candidates }
- [ ] `clickXxxOption` — 真实点击
- [ ] `verifyXxxValue` — 回读校验
- [ ] `fillXxxAttrs` — 循环 + 缓存 + 证据记录
- [ ] `readXxxSubmitErrors` — 提交后三路诊断（toast + 字段红字 + 建议面板）
- [ ] `fillXxxSkus` — SKU 规格填写（销售属性 ID + 规格值提交 + SKU 表回读）
- [ ] `fillXxxDetailImages` — 详情图上传（iframe 或直接上传）

### 通用字段
- [ ] `fillField` — 文本型按 maxlength 截断
- [ ] 主图上传（`uploadImages`）
- [ ] 标题/价格/库存/货号（通用字段）

### 缓存
- [ ] import `createAttrCache`，创建实例
- [ ] `fillXxxAttrs` 循环里加缓存查询/验证/记录

### 安全
- [ ] 品牌 `ATTR_SKIP_RE` 跳过（授权风险）
- [ ] 填失败不阻断，记 `missed`
- [ ] 两步走（预览 → confirm=true 才真正提交）
- [ ] L2 风险标注

---

## 八、各平台现状对照

| 平台 | 类目树 | 属性表 | 缓存 | 现状 |
|---|---|---|---|---|
| 淘宝/天猫 | ✅ 搜索选第一个 | ✅ 7 函数链 | ✅ attrCache | **完整** |
| 拼多多 | ✅ 入口自动推荐 | ✅ 7 函数链 | ✅ attrCache | **完整** |
| 闲鱼 | ❌ 无强制树 | ❌ | — | 不适用（自由填） |
| bilibili/douyin/xiaohongshu/zhihu | ❌ 内容发布 | ❌ | — | 不适用（无商品类目） |

**待接（按此规范）**：抖音小店、快手小店、1688 商家后台、TikTok Shop 等有类目树+属性表的平台。
