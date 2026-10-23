---
name: douyin-publish-full
description: "抖音小店·完整发布链路：从上传主图到进入第二级商品信息页的全流程自动化——返回旧版表单、上传图片、填标题、跑 AI 预测任务拿推荐标题、结构化选叶子类目（searchCategoryN）、进第二级。类目查询可独立使用。触发：抖店发布、抖店上架、抖店发品、抖音小店发布、选类目、查类目、douyin publish full。排除：AI 物料准备（用 douyin-publish-ai）、纯商品/订单查询（用 douyin-goods/douyin-order）。需绑定「抖音小店」账号（platform=douyin_shop）。发布为 L2，须先给预览并获同意。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "抖音小店·完整发布"
    emoji: "📤"
    requires: {}
---

# 抖音小店 · 完整发布链路

> **重要：** 发布是**不可撤销的真实操作（L2）**。必须两步走：先拿「发布预览」给用户看，
> 用户**明确同意**后才带 `--confirm true` 真正执行。绝不要一次调用直接传 `confirm=true`。

> **分工**：本技能打通到「第二级商品信息页」；SKU/属性/运费模板/最终提交
> 因涉及品牌授权与资质，**留给用户在弹出窗口内人工确认**（不假装全自动）。

## 何时使用

- 用户说「抖店发布」「抖店上架」「发品」「把这个发到抖店」→ 用本技能
- 给了统一商品 JSON（标题 + 主图 + 规格 + SKU）要求发到抖店 → 用本技能
- **只想查类目**（这个品类该挂哪个叶子类目、有没有开通资质）→ `--mode cate`
- 想做 AI 物料准备但不提交 → 用 `douyin-publish-ai`

## 能力

| 模式 | 类型 | 说明 |
|------|------|------|
| `preview` | 零写操作 | 校验商品数据 + 输出发布预览（**默认**） |
| `publish` | **L2 写** | 走完整链路进第二级；必须带 `--confirm true` |
| `cate` | 只读 | 类目查询：关键词 → 叶子类目候选 + 资质状态 |

## 实现方式：混合模式（HTTP 为主 + 2 个必要 DOM 点击）

**先说结论**：抖音**不适合纯 HTTP 改包**（对标 `pdd-publish-http`），但也不该纯 DOM。实测出混合方案性价比最高：

| 环节 | 方式 | 实测状态 |
|---|---|---|
| 上传图片 | DOM（file input） | ✅ 唯一上传入口，FormData 直传会被拦 |
| 拿主图 CDN URL | hook `batchupload` 响应 | ✅ |
| 拿 `publish_id` | 从页面自发 `notify_material_change` 请求体提取 | ✅ **唯一来源**（不在 URL/全局/HTML） |
| 拿 `trace_id` | HTTP `generateMaterialTraceId` | ✅ |
| 材料上报 | HTTP `notify_material_change` | ✅ `st=0` |
| AI 预测 | HTTP `submitPredictTask` + `getPredictTask` 轮询 | ✅ 稳定拿标题候选 |
| 类目**搜索** | HTTP `searchCategoryN` | ✅ 结构化候选（24 个） |
| 类目**选中** | **DOM 点 `.style_resultItem__m_ro6`** | ⚠️ **无接口**——纯前端状态变更，实测 4 个候选路径全 404 |
| 进第二级 | **DOM 点「确认信息，继续生成」** | ⚠️ **无接口** |

**为什么能 HTTP 化**：页面内 `fetch` 会被 secsdk 自动附加 `a_bogus`/`msToken` 签名
（实测 `searchCategoryN`/`notify_material_change`/`submitPredictTask` 全部 `st=0`）。
Node 侧算不出 `a_bogus`，所以必须在页面上下文里发——这是「页面内 fetch」而非「Node 直连」。

### 收益

比纯 DOM 少一半以上脆弱点：页面改版只影响那 2 个点击，类目搜索/材料上报/AI 预测全部走接口，
不受 DOM 结构变动影响，且更快（省掉等页面渲染）。

## 发布链路（2026-10 真机实测，8 步）

```
① openEntry        /ffa/g/create
                   ⚠️ 默认是「AI 识别发品」新版，页面 0 个 input
② backToOldVersion 点「返回旧版」→ 切到表单流程
③ uploadImages     上传主图 + 详情图（input[type=file]，一次多文件）
④ fillTitle        填标题（input[placeholder*="请输入2-60个字符"]）
⑤ aiPredict        点「下一步，生成商品」→ submitPredictTask/getPredictTask
                   → 拿到 AI 推荐标题候选（product_info.title_candidates[]）
⑥ selectCategory   点「手动选择类目」→ 商品搜索框输关键词 → 选叶子候选 → 确认
                   （候选来自 /product/tproduct/searchCategoryN 结构化数据）
⑦ confirmMaterial  类目选完后「确认信息，继续生成」才可用 → 点它进第二级
⑧ level2           第二级：SKU / 属性 / 详情图 / 运费模板 / 提交
                   → 截图 + DOM 盘点交给用户人工收尾
```

### 三道门禁（实测，缺一不可）

| 门禁 | 现象 |
|---|---|
| ① 主图必须 **1:1 且 ≥600×600** | 否则页面出「长宽比需为1:1」，AI 流程**静默卡死**（不报错、不返回标题）。技能在上传前本地拦截 |
| ② 「手动选择类目」要**有图 + 有标题**后才出现 | 只传图时页面只有「换一批」，没有类目入口 |
| ③ 必须选**叶子类目**（`is_leaf=true`，如「餐饮厨具/茶具/茶杯」） | 选一级类目会弹「当前类目未开通，需前往资质中心开通资质」，确认按钮保持 disabled |

### ⚠️ 第四道门禁：类目资质（已解决——逐个试）

`searchCategoryN` 的 `industry_status === 2` **不代表真能发布**。
实测该店从 52 个 `status=2` 候选里逐个点，前 16 个全弹「当前类目未开通」。

**但确实存在可发布的类目**——只是不在接口的 status 列表里。
实测：搜「隐茶杯」后面板第 1 个候选「餐饮厨具/水具/玻璃杯」**确认按钮能亮**。

**唯一可靠判据：点了候选后，「确认」按钮是否亮。**

所以本技能的策略是：**开面板 → 搜词 → 从第一个候选开始逐个点，确认亮了就用它**
（最多试 6 个），而不是信接口的 status。实测这条策略一次成功进入第二级。

> 2026-10 实测：`--category 隐茶杯` → 第 1 个候选即通过 → 成功进入第二级
> （`stage: level2`，类目 `餐饮厨具/水具/玻璃杯`）。

### ★ 新旧类目 ID 体系不一致

| 来源 | ID 形态 | 示例 |
|---|---|---|
| 商品列表 `/product/tproduct/list` | 旧体系（短 ID） | `cates: [2, 33, 233]` |
| 发布页 `searchCategoryN` | 新体系（10 位） | `1000010148` |

同一个业务类目两套体系 ID 不同，**发布只认新体系**。
`--cate-id` 只接受新体系 ID；传旧 cid 会找不到。

## 输入

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `--mode` | string | 否 | preview(默认) / publish / cate |
| `--product-file` | string | preview/publish 必填 | 统一商品 JSON 路径 |
| `--product` | string | 同上二选一 | 统一商品 JSON 字符串 |
| `--category` | string | 否 | 类目关键词；不传用 `product.category`，再没有用标题前 10 字 |
| `--cate-id` | string | 否 | 直接指定叶子类目 ID，跳过搜索 |
| `--cate-query` | string | cate 模式必填 | 类目查询词 |
| `--confirm` | flag | L2 | 必须 `true` 才真正发布；省略只返回预览 |
| `--account` | string | 否 | 账号 shopKey；多账号未绑定时先向用户确认 |

### `product` 统一结构

```jsonc
{
  "title": "红茶一次性茶杯自带茶叶杯中茶送礼隐茶杯",     // 必填，≤60 字符
  "images": ["D:\\imgs\\main1.jpg"],                      // 必填，1~9 张，单张 ≤5MB，**1:1 且 ≥600×600**
  "detailImages": ["D:\\imgs\\d1.jpg"],                   // 选填，详情图
  "category": "茶杯",                                      // 选填，类目关键词
  "price": "12",                                           // 选填
  "stock": "1000",                                         // 选填
  "itemNo": "SPU001",                                      // 选填，货号
  "specs": [                                               // 选填，≤2 维
    { "name": "颜色", "values": [{ "value": "红茶" }, { "value": "白茶" }] },
    { "name": "规格", "values": [{ "value": "50只" }, { "value": "100只" }] }
  ],
  "skus": [                                                // 每行覆盖全部维度
    { "specs": { "颜色": "红茶", "规格": "50只" }, "price": "12", "stock": "500" }
  ],
  "attributes": [ { "name": "主面料成分", "value": "纸" } ], // 选填
  "account": "douyin_shop_xxxx"                            // 选填
}
```

## 输出

| 字段 | 含义 |
|------|------|
| `ok` | 是否成功。★ **预览时是 `ok=false` + `needConfirm=true`，正常流程不是报错** |
| `needConfirm` | `true` 表示等用户确认 |
| `stage` | publish 模式：`level2`（已进第二级）/ `material`（卡在材料页） |
| `cateId` | 选中的叶子类目 ID |
| `candidates` | cate 模式：可用叶子类目数组 `[{id, path, cids}]` |
| `level2` | 第二级 DOM 盘点（inputs/buttons/url） |
| `screenshot` | 第二级截图路径 |
| `text` | 面向用户的中文文案，原样转述 |

## 用法

```bash
# ① 查类目（只读，推荐发布前先查）
node {baseDir}/scripts/publish-full.mjs --mode cate --cate-query 茶杯

# ② 发布预览（零写操作）
node {baseDir}/scripts/publish-full.mjs --mode preview --product-file ./p.json

# ③ 真正发布（L2，先给用户看预览并获同意）
node {baseDir}/scripts/publish-full.mjs --mode publish --product-file ./p.json --confirm true

# 指定类目跳过搜索
node {baseDir}/scripts/publish-full.mjs --mode publish --product-file ./p.json --cate-id 1000010148 --confirm true
```

## 工作流

### W1：标准发布（推荐）

```
① 先查类目      --mode cate --cate-query <品类词>
               → 确认有 industry_status=2 的叶子类目，记下 id
② 取预览        --mode preview --product-file ./p.json
               → ok=false + needConfirm=true + 预览文案
③ 把预览完整展示给用户，征求明确同意（L2 门禁，不可跳过、不可自行假设）
               ★ 必须提醒：品牌与部分资质不会自动填，需在窗口内人工补全
④ 用户同意后    --mode publish --product-file ./p.json --cate-id <id> --confirm true
⑤ 报告：ok=true → 已进第二级，把截图路径和待办清单给用户；
              ok=false → 按 failureKind 走
```

### W2：批量发同款多规格

```
① 每个 SKU 组合一个 product JSON（标题差异化，避免判重复铺货）
② 逐个走 W1（每次都要单独拿用户同意，不要一次同意批量执行）
```

### W3：先备料再发布（AI 加持）

```
① douyin-publish-ai --mode material --images <图>
   → 拿 AI 推荐标题 / 主图 CDN / trace_id
② 用推荐标题组装 product JSON
③ 回到 W1 走本技能
```

## 平台硬规则

| 规则 | 说明 |
|---|---|
| 新版发布页要「返回旧版」 | `/ffa/g/create` 默认「AI 识别发品」新版，0 个 input；不切旧版后续锚点全落空 |
| 两级流程 | 第一级材料页（图+标题+类目）→ 第二级才是 SKU/属性/提交 |
| 类目是门禁 | 类目没选，「确认信息，继续生成」一直是 disabled |
| 必须叶子类目 | 选一级类目弹「未开通资质」，确认不可用 |
| React 受控输入 | 直接设 `value` 不生效；必须逐字符派发 `input`/`compositionend`/`keyup` 等事件序列（实测） |
| 品牌不自动填 | 涉及授权，一律留给用户人工选 |
| 图片去重 | 平台对已上传过的图复用 CDN URL 且不重跑 AI；测试要换新图 |
| 登录态两层 | 本技能走 profile 真实会话，不吃脚本 Cookie 注入；账号显示有效也可能跳登录页，重登一次修好两层 |

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定抖店账号 | `not_bound` | 引导到「账号连接」添加抖店账号（platform=`douyin_shop`） |
| 平台多账号且未指定 | `need_account_choice` | 把候选列表给用户选，把选定 shopKey 填 `--account` 重调；★ 不要自己挑 |
| 登录态失效（跳 `/login/common`） | `token_expired` | 引导重新登录抖店 |
| 图片非 1:1 / <600×600 | `api_error` | 文案列出具体图片尺寸；裁成正方形高清图再试 |
| 图片 >5MB / >9 张 / 不存在 | `api_error` | 按文案修正 |
| specs >2 维 / SKU 行缺维度 | `api_error` | 补齐后重试 |
| 类目面板打不开 | `api_error` | 已知门禁：需先有图 + 有标题。已传仍打不开 → 页面可能改版，跑 `probe-cate-api.mjs` 重认 |
| 搜索无可用叶子类目 | `api_error` | 换关键词，或去资质中心开通对应类目 |
| 卡在材料页进不了第二级 | `api_error`（`stage=material`） | 类目没选上；看截图，可在窗口内手动选 |
| 浏览器 profile 被占用 | `api_error` | 稍后重试，或先关闭已弹出的抖店窗口 |

## 与其他技能的分工

| 技能 | 职责 |
|---|---|
| `douyin-publish-ai` | AI 物料准备（上传 + 拿推荐标题），不提交 |
| **`douyin-publish-full`** | **完整发布链路**（本技能），到第二级为止 |
| `douyin-publish-mqs` | 同引擎旧入口（纯 DOM 驱动），锚点配置在 `publish-config/douyin_shop.json` |
| `douyin-goods` / `douyin-order` / `douyin-shop` / `douyin-promo` | 发布后的查询与经营分析 |

## 技术说明

### 类目接口（别再猜 DOM）

`GET /product/tproduct/searchCategoryN?key=<词>&search_type=1` 返回结构化候选：

```jsonc
{ "id": 1000010148, "name": "茶杯", "level": 3, "is_leaf": true,
  "first_name": "餐饮厨具", "second_name": "茶具", "third_name": "茶杯",
  "first_cid": ..., "second_cid": ..., "third_cid": ...,
  "industry_status": 2 }        // 2 = 已开通可发
```

选类目时**优先用接口数据**定位候选，DOM 点击只作执行手段——
纯 DOM 匹配会误点导航栏/图片说明（实测踩坑多次）。

### 取数方式

与 `douyin-shop` / `douyin-publish-ai` 同源：打开发布页 → CDP
`Network.responseReceived` hook 页面自己发的响应。不自己 fetch（`a_bogus` 签名 Node 侧算不出）。

完整接口清单与踩坑记录见 `skills/_douyin_probe/API-FINDINGS.md`。
