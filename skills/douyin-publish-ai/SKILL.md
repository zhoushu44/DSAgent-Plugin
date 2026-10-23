---
name: douyin-publish-ai
description: "抖音小店·AI 发品物料准备：上传商品图/Excel 到抖店发布页，跑通平台「AI 识别发品」链路，产出物料包（主图 CDN URL、材料追踪 ID、AI 推荐标题/类目），交给 douyin-publish-mqs 做真实提交。触发：抖店AI发品、抖音智能发品、上传图片生成商品、AI上架、抖店物料准备、douyin publish ai。排除：真实提交上架（用 douyin-publish-mqs，L2 门禁）、商品/订单查询（用 douyin-goods/douyin-order）。需绑定「抖音小店」账号（platform=douyin_shop）。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "抖音小店·AI发品物料"
    emoji: "🤖"
    requires: {}
---

# 抖音小店 · AI 发品物料准备

> **只产出物料，不提交上架。** 真实提交走 `douyin-publish-mqs`（L2 门禁在那个技能）。
> 本技能是**只读 + 上传**：上传图片到发布页让平台 AI 识别，把结果打包成物料包。
> 不会创建商品、不会提交审核。

## 何时使用

- 用户说「抖店 AI 发品」「智能发品」「上传图片生成商品」→ 用本技能
- 手里只有商品图，想让它自动生成标题/类目 → 用本技能
- 有规格价格库存的 Excel，想让平台识别 SKU → 用本技能（`--excel`）
- 要查平台当前的 AI 发品上传限制 → `--mode config`

## 能力

| 模式 | 类型 | 说明 |
|------|------|------|
| `material` | 上传 + 只读 | 上传图片/Excel → 等 AI 识别 → 产出物料包（默认） |
| `config` | 只读 | AI 发品上传配置：支持文件类型、数量/体积上限、能否发品 |
| `check` | 只读 | 发品资格检查：`can_create` + 平台提示横幅 |

## 为什么不做 HTTP 改包（对标 pdd-publish-http）

拼多多那套是「拦截 `goodsCommit` → 改包 → 带签名重放」。抖店**不适用**：

| 维度 | 拼多多 | 抖店 |
|---|---|---|
| 会话模型 | 一次提交体成型 | `publish_id` **有状态链路**，材料变更要 `notify_material_change` 上报 |
| 字段来源 | 人给全字段打包 | **AI 从图片提取**标题/类目 |
| 类目 | 必选叶子类目才进表单 | AI 推荐 + 手动兜底 |
| 逆向成本 | 纯签名（Anti-Content） | 签名 + AI 状态机 + 材料协议 |

强行走 HTTP 要同时逆 `a_bogus` + AI 协议，维护成本远高于收益。
**正确姿势是「AI 生成物料 + 人工确认」**，这也是抖店的设计意图。

## 前置条件

1. **账号已绑定**：「账号连接」页已绑定**抖音小店**账号（platform=`douyin_shop`）。
   ★ 与内容平台 `douyin` 是两套独立登录态，抖音 Cookie 进不了抖店后台。
2. **登录态有效**：失效时返回 `token_expired`，引导重新登录。
3. **图片合规**（**上传前本地校验，不过不起浏览器**）：

| 约束 | 值 | 依据 |
|---|---|---|
| 宽高比 | **必须 1:1**（容差 2%） | 实测非 1:1 上传后页面出「长宽比需为1:1」，AI 流程直接卡死 |
| 最小尺寸 | **≥600×600** | 平台原文「至少包含一张不小于600\*600的商品图」 |
| 单张体积 | ≤5MB | `ai_publish/get_config` |
| 文件类型 | jpg / png / jpeg / csv / xls / xlsx | 同上 |
| 数量 | ≤50 个文件 | 同上 |
| Excel 体积 | ≤1MB | 同上 |

## 输入

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `--mode` | string | 否 | material(默认) / config / check |
| `--images` | string | material 必填 | 本地图片路径，英文逗号分隔 |
| `--excel` | string | 否 | 规格/价格库存 Excel 路径（.csv/.xls/.xlsx，≤1MB） |
| `--title` | string | 否 | 指定标题（不传则用 AI 推荐） |
| `--out` | string | 否 | 物料包输出目录，默认 `<cwd>/artifacts/douyin-publish-ai/` |
| `--account` | string | 否 | 账号 shopKey；多账号未绑定时先向用户确认 |

## 输出

| 字段 | 含义 |
|------|------|
| `ok` | 是否成功 |
| `mode` | 实际执行的模式 |
| `material.finalTitle` | 最终标题（`--title` 覆盖 > AI 推荐 > 候选第一个） |
| `material.titleCandidates` | AI 推荐标题候选数组 |
| `material.aiCategory` | AI 推荐类目（从页面提取） |
| `material.uploadedUrls` | 主图 CDN URL 数组 |
| `material.traceId` | 材料追踪 ID（`generateMaterialTraceId` 返回） |
| `materialFile` | 物料包 JSON 文件路径（含 rawApis 全量响应，供二次分析） |
| `text` | 面向用户的中文文案，原样转述 |

## 用法

```bash
# 上传图片跑 AI 识别，产出物料包
node {baseDir}/scripts/ai-publish.mjs --mode material --images D:\main1.jpg,D:\main2.jpg

# 带规格 Excel（平台会从中识别 SKU/价格/库存）
node {baseDir}/scripts/ai-publish.mjs --mode material --images D:\main1.jpg --excel D:\sku.xlsx

# 指定标题（不用 AI 推荐的）
node {baseDir}/scripts/ai-publish.mjs --mode material --images D:\main1.jpg --title "儿童摇粒绒家居服套装"

# 查上传配置 / 发品资格
node {baseDir}/scripts/ai-publish.mjs --mode config
node {baseDir}/scripts/ai-publish.mjs --mode check
```

## 工作流

### W1：只有图片，快速备料

```
① 调 --mode material --images <图>       → 拿到 uploadedUrls / traceId / AI 推荐标题
② 把 text 给用户看，确认标题（或让用户指定）
③ 用 douyin-publish-mqs 提交：
    product.title = material.finalTitle
    product.images = material.localImages（本地路径）
④ L2 门禁：先给预览，用户同意后才 confirm=true
```

### W2：图 + Excel 全自动备料

```
① 调 --mode material --images <图> --excel <sku.xlsx>
② 物料包里会有平台识别到的 SKU 线索（在 rawApis.notifyChange 里）
③ 交 douyin-publish-mqs，SKU 在弹出窗口内确认/微调
```

### W3：先查限制再备料（避免白跑）

```
① 调 --mode config                       → 数量/体积/类型上限
② 调 --mode check                        → 能否发品（can_create）
③ 本地按上限裁图（1:1、≥600×600、≤5MB）
④ 再调 --mode material
```

## 平台链路（2026-10 深挖实测）

```
/ffa/g/create
  ↓ 上传图片/Excel（input[type=file]，一次可多文件）
/product/img/batchupload                            → CDN URL[]
/product/tproduct/material/generateMaterialTraceId → trace_id
/product/tproduct/ai_publish/notify_material_change → 上报材料（submit_type=1, classify_source=1, publish_id）
  ↓ 点「下一步，生成商品」
/product/tproduct/submitPredictTask  (scene=5)      → { task_id, interval:1000, timeout:30000 }
/product/tproduct/getPredictTask     (轮询)         → task_status: running → success
      └ data.product_info.title_candidates[]        ★ AI 推荐标题的真正来源
      └ data.product_info.main_pics[] / detail_materials[]
      └ data.loading_info.nodes[]                   进度节点（主图/详情图/素材/标题）
  ↓
商品材料页（主图/辅助图/详情图 + 标题 + AI 推荐类目）
```

### ★ 关键结论：推荐标题来自「预测任务」，不是 getRecommendTitle

这是本次深挖最重要的发现（此前完全找错了方向）：

| 接口 | 角色 |
|---|---|
| `submitPredictTask` + `getPredictTask` | **主路径**。点「下一步」后由页面发起，轮询到 `task_status=success` 时，`product_info.title_candidates[]` 就是推荐标题 |
| `getRecommendTitle` | **辅助**。只有用户点页面上的「AI 推荐」/「换一批」按钮才触发，`action_type:"manual"`；自动流程不调它 |

早期误判：曾抓到一次 `action_type:"auto"` 的 `getRecommendTitle`，据此以为它是自动路径——**错了**，那条不返回数据。真正的自动路径是预测任务。

## 已知限制（诚实声明）

| 项 | 状态 |
|---|---|
| AI 推荐标题 | ✅ **已稳定复现**。走 `getPredictTask` → `product_info.title_candidates[]`，实测多次成功 |
| 标题输入框自动填入 | ⚠️ 页面不会自动把候选填进输入框（`input.value` 为空），候选在页面「AI 推荐」区块展示，需用户点选或我们指定 |
| AI 推荐类目 | ⚠️ 预测任务的 `product_info` 里没有类目字段；类目在第二级页面才选。返回 null 是正常的 |
| 图片去重 | 平台对**已上传过的图**直接复用 CDN URL，不重跑 AI。同一张图反复传，第二次起推荐标题大概率不返回 |
| 真实提交 | 不在本技能，走 `douyin-publish-mqs` |

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定抖店账号 | `not_bound` | 引导到「账号连接」添加抖店账号（platform=`douyin_shop`） |
| 平台多账号且未指定 | `need_account_choice` | 把候选列表给用户选，把选定 shopKey 填 `--account` 重调；★ 不要自己挑 |
| 登录态失效（跳 `/login/common`） | `token_expired` | 引导重新登录抖店 |
| 图片非 1:1 | `api_error` | 文案列出具体图片尺寸；裁成正方形再试 |
| 图片 <600×600 | `api_error` | 文案列出具体尺寸；换高清图 |
| 图片 >5MB / 超 50 张 / Excel >1MB | `api_error` | 按文案压缩或减少数量 |
| 文件不存在 | `api_error` | 检查路径 |
| 上传控件找不到 | `api_error` | 页面可能已改版，跑 `dsagent_douyin_shop_publish_mqs(diagDom=true)` 看当前 DOM |
| 浏览器 profile 被占用 | `api_error` | 稍后重试，或先关闭已弹出的抖店窗口 |

## 技术说明

### 取数方式

与 `douyin-shop` / `douyin-goods` 等同源：打开发布页 → CDP
`Network.responseReceived` hook **页面自己发的响应**（不自己 fetch，
`a_bogus` 签名 Node 侧算不出）。

### 响应体判据

抖店域：`st === 0 || code === 0`。响应体 `{st, msg, code, data, page, size, total}`。

### 与 douyin-publish-mqs 的分工

| 项 | douyin-publish-ai | douyin-publish-mqs |
|---|---|---|
| 职责 | 备料（上传 + AI 识别） | 真实提交（DOM 驱动点击） |
| 写操作 | 无 | 有（L2，两步门禁） |
| 产出 | 物料包 JSON | 已提交商品 |
| 依赖 | — | 可消费本技能的物料包 |

完整接口清单见 `skills/_douyin_probe/API-FINDINGS.md`。
