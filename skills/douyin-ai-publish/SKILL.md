---
name: douyin-ai-publish
description: "抖音小店·AI 智能发布：上传商品图 + SKU Excel，让平台 AI 自动识别并填入标题/类目/SKU 表格/属性，人工只做最后确认。支持查类目必填属性清单。触发：抖店AI发布、AI发品、智能发布、Excel发品、表格批量上架、抖店AI上架、douyin ai publish。排除：通用发布链路（用 douyin-publish-full）、商品/订单查询（用 douyin-goods/douyin-order）。需绑定「抖音小店」账号（platform=douyin_shop）。提交为 L2，须先给预览并获同意。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "抖音小店·AI智能发布"
    emoji: "🧠"
    requires: {}
---

# 抖音小店 · AI 智能发布

> **提交是不可撤销的真实操作（L2）**：`--mode submit` 必须两步走——
> 先不带 `--confirm` 拿预览给用户看，用户**明确同意**后才带 `--confirm true` 真正点发布。

## 核心思路：能用 AI/HTTP 的绝不用 DOM 点

实测抖店 AI 发品**能吃图 + Excel**，自动填标题/类目/SKU 表/属性。所以：

| 环节 | 方式 | 说明 |
|---|---|---|
| 上传图 + Excel | DOM（file input） | 唯一上传入口 |
| AI 识别（标题/材料分类） | hook `submitPredictTask`/`getPredictTask` | 拿推荐标题候选 |
| 类目搜索 | **HTTP** `searchCategoryN` | 结构化候选 |
| **SKU/价格/库存** | **平台 AI 从 Excel 识别填入** | 实测输入框被自动填值 |
| 选类目 | DOM 逐个试到「确认」亮 | `industry_status` 不可信 |
| **必填属性** | **DOM 自动填** `.ecom-g-select` | 适用温度/材质/容量/数量/款式，各选第一个选项 |
| 点发布 | DOM 点「发布商品」 | 提交是整套校验流程，非单一接口 |

**属性自动填实测**（2026-10）：

```
⑦b 适用温度 → 「-10℃~20℃」
⑦b 已处理 4 个必填属性
⑦ 未填属性：16 → 5
```

剩下的 5 项全是**非必填**（产地/型号/购买规格/商品规格/批量上传规格图）。
品牌跳过（涉及授权，留人工）。

**页面原文**：「Excel 表格 用于识别规格/价格库存等信息」「任意截图 用于识别SKU/属性规格等信息」

## 何时使用

- 用户有商品图 + SKU 表格，想快速上架 → `--mode submit`
- 想先看 AI 识别出什么 → `--mode material`
- 想知道某个类目要填哪些必填属性 → `--mode props`
- 通用/手动发布链路 → 用 `douyin-publish-full`

## 三种模式

| 模式 | 类型 | 说明 |
|---|---|---|
| `material` | 上传 + 只读 | 上传图/Excel → AI 识别 → 产出物料包（推荐标题/主图/材料分类） |
| `props` | 只读 | 走完选类目 → 读该类目必填属性清单 + 已填状态 |
| `submit` | **L2 写** | 完整链路 + AI 填表 → 预览 →（`--confirm true`）点发布 |

## 输入

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `--mode` | string | 否 | material(默认) / props / submit |
| `--images` | string | 是 | 本地图片路径，英文逗号分隔。**主图必须 1:1 且 ≥600×600**（本地前置校验） |
| `--excel` | string | 否 | SKU Excel（.xlsx/.xls/.csv，≤1MB）。表头建议 `颜色/规格/价格/库存` |
| `--title` | string | 否 | 指定标题；不传用 AI 推荐候选 |
| `--category` | string | 否 | 类目搜索词；不传用标题前 10 字 |
| `--confirm` | flag | L2 | `submit` 模式必须 `true` 才真正发布 |
| `--account` | string | 否 | 账号 shopKey；多账号未绑定时先向用户确认 |

### Excel 表头建议

```csv
颜色,规格,价格,库存
红茶,50只,12,500
白茶,50只,12,500
红茶,100只,20,300
```

AI 会自动识别列含义并填入第二级 SKU 表（实测价格/库存输入框被自动填值）。

## 输出

| 字段 | 含义 |
|---|---|
| `ok` | 是否成功 |
| `needConfirm` | `true` 表示等用户确认（预览态） |
| `stage` | `submitted`（已提交）/ `unknown` / `material` |
| `title` / `cateId` / `catePath` | 标题 / 类目 ID / 类目路径 |
| `titleCandidates` | AI 推荐标题候选 |
| `level2` | 第二级盘点（`todoCount`/`props`/`tables`） |
| `missingProps` | 未填必填属性数组 |
| `screenshot` | 第二级截图路径 |
| `materialFile` | 物料包 JSON 路径 |
| `text` | 面向用户的中文文案 |

## 用法

```bash
# ① 备料（只上传 + AI 识别，不发布）
node {baseDir}/scripts/ai-publish.mjs --mode material --images D:\main.jpg --excel D:\sku.xlsx

# ② 查类目必填属性
node {baseDir}/scripts/ai-publish.mjs --mode props --images D:\main.jpg --category 隐茶杯

# ③ 完整发布预览（零写操作）
node {baseDir}/scripts/ai-publish.mjs --mode submit --images D:\main.jpg --excel D:\sku.xlsx --title "红茶隐茶杯定制"

# ④ 确认后真正发布（L2）
node {baseDir}/scripts/ai-publish.mjs --mode submit --images D:\main.jpg --excel D:\sku.xlsx --title "红茶隐茶杯定制" --confirm true
```

## 工作流

### W1：图 + Excel 快速上架（推荐）

```
① --mode material         → 看 AI 识别的标题/材料，确认没跑偏
② --mode props            → 查该类目要填哪些必填属性（材质/容量/数量…）
③ --mode submit           → 拿到预览（含待完善项、SKU 填入情况、截图）
④ 把预览给用户看，征得明确同意
⑤ --mode submit --confirm true
⑥ 报告：ok=true → 已提交，平台仍会审核；否则按页面状态提示补项
```

### W2：只有图，没有 Excel

```
① --mode material --images <图>     → AI 会从图里识别标题/类目
② --mode submit 后在弹出窗口内手工加 SKU（AI 填不了它没有的信息）
```

### W3：批量发同款多规格

```
① 每个规格组合一个 Excel（或一个 Excel 多行）
② 逐个走 W1（每次都要单独拿用户同意，不要一次同意批量执行）
```

## 平台硬规则（实测）

| 规则 | 说明 |
|---|---|
| 主图必须 **1:1 且 ≥600×600** | 否则页面出「长宽比需为1:1」，AI 流程**静默卡死**。技能上传前本地拦截 |
| **`industry_status` 不可信** | 接口说 `status=2` 也可能弹「当前类目未开通」。实测 16 个候选全废。唯一判据是「点了确认按钮是否亮」，所以逐个试 |
| 属性控件是 `ecom-g-select` | Ant Design Select，**不是 semi-select**。点 `.ecom-g-select-selector` 才展开 |
| 规格值控件是 `ecom-g-cascader-picker` | Ant Design Cascader。`style_skuValueBox` 里多个 cascader，**最后一个空的是新增入口**。★ 点 **picker 本体**，因为 `.ecom-g-cascader-picker-arrow` 的 `onClick` 是 **null**（React props 实证） |
| 规格值是 153 个标准色 | 输入「红茶」匹配不到 → 返回「暂无相似选项」。要选标准色（红/白/黑…），且要排除空态项 |
| 改规格后要 `refetchSchema` | schema 的 `spec_detail.actions` 声明：`POST /product/tproduct/refetchSchema?action=spec_detail_refresh`。**规格改动后必须调它让服务端重算 sku 结构**，否则前端 state 不生成 SKU 行 |
| 规格有多个维度 | 「餐饮厨具/水具/玻璃杯」有 2 个：`cp_id=2752` 颜色分类（选项）+ `cp_id=3163` 总容量（measure 数值+单位） |
| 必填属性自动填 | 适用温度/材质/容量/数量/款式各选第一个选项。品牌跳过（授权） |
| **addWithSchema 已封禁** | 直调 `POST /product/tproduct/addWithSchema` 会返回「疑似通过非官方途径操作」，**平台风控会降速发布页到 10 分钟级**。不要走这条路 |
| **SKU 表格行生成未验证完** | cascader 能选中（「红色系/红色」）但 React state 不更新、表格不生成行。已加 `refetchSchema` 猜测修复，因风控降速未实测 |
| 图片去重 | 同一张图重复上传，平台复用 CDN URL 且**不重跑 AI**。测试要换新图 |
| 新旧类目 ID | 商品列表是旧体系（`2/33/233`），发布页是新体系（`1000010148`），不通用 |
| Excel 只能填 SKU 不能填属性 | 实测带「属性」sheet 的 Excel，5 个必填属性仍「请选择」 |
| Excel 必须先传 | 图先 Excel 后 → Excel 的 DOM 上传触发整页 reload → 连环 detached |
| 登录态两层 | 本技能走 profile 真实会话，不吃脚本 Cookie 注入；账号显示有效也可能跳登录页，重登一次修好 |
| 页面 10 分钟载不完 | 说明店铺已被风控标记（因之前的直调尝试）。**停手 1-2 天冷却**，期间不碰 `/ffa/g/create` |

## 错误处理

| 场景 | failureKind | 引导动作 |
|---|---|---|
| 未绑定抖店账号 | `not_bound` | 引导到「账号连接」添加抖店账号（platform=`douyin_shop`） |
| 平台多账号且未指定 | `need_account_choice` | 把候选列表给用户选，把选定 shopKey 填 `--account` 重调 |
| 登录态失效 | `token_expired` | 引导重新登录抖店 |
| 图片非 1:1 / <600×600 / >5MB | `api_error` | 文案列出具体尺寸；裁成正方形高清图 |
| Excel >1MB / 不存在 | `api_error` | 按文案修正 |
| 6 个类目候选全部未开通 | `api_error` | 店铺资质问题，去抖店「资质中心」开通；或换更具体的搜索词 |
| 必填属性未填全 | `needConfirm`（预览里标注） | 在弹出窗口内补齐后再确认，或直接同意让技能尝试 |
| 点了发布但没成功 | `ok=false` + 页面状态 | 看 `finalText` 里的平台提示 |

## 与其他技能的分工

| 技能 | 定位 |
|---|---|
| **`douyin-ai-publish`**（本技能） | **AI 智能发布**：图 + Excel → AI 填表 → 人工确认 |
| `douyin-publish-full` | 通用发布链路（8 步全打通，含 publish_id/HTTP 混合） |
| `douyin-publish-ai` | 早期物料准备版（只到材料页） |
| `douyin-publish-mqs` | 同引擎旧入口（纯 DOM） |

## 技术说明

### AI 预测接口

```
submitPredictTask { publish_id, scene:5, files:[{url, type}] }
  → data.async_options { task_id, interval:1000, timeout:30000 }
getPredictTask { taskId, scene:5, publish_id }
  → data.product_info {
       main_pics[], title_candidates[],
       main_pic_materials[], detail_materials[], more_materials[]
     }
```

`more_materials` 里 `material_type: 2` 的就是 Excel——它在第一级只做登记，
**真正的 SKU 解析发生在第二级**（实测第二级输入框被自动填入 Excel 的价格/库存）。

### `publish_id` 唯一来源

不在 URL、不在 `window` 全局、不在 HTML。唯一来源是**页面自己发的
`notify_material_change` 请求体**——要等图片上传后才会发。
所以顺序必须是：先 DOM 上传 → 从抓包取 publish_id → 才能 HTTP 调用。

### 取数方式

hook 页面自己发的响应 + 页面内 `fetch`（secsdk 自动附加 `a_bogus` 签名，Node 侧算不出）。
完整接口清单见 `skills/_douyin_probe/API-FINDINGS.md`。
