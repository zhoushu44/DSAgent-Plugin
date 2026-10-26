---
name: pdd-publish-http
description: "拼多多商品上架（HTTP 逆向模式）：统一 JSON 描述商品，图片全部 HTTP 上传到 CDN，提交体在浏览器层拦截改包后以页面身份（带 Anti-Content 签名）HTTP 重放，并调 commit/submit 确认上架。数据传输 100% HTTP，浏览器只做「签名生成+会话注册+最小石填」。支持颜色×尺码矩阵、SKU 预览图、属性显式指定。触发：拼多多上架、拼多多发布、拼多多HTTP上架、改包上架、拼多多批量上架准备。排除：采集比价（pdd-crawl）、订单/库存/客服/分析、淘宝/闲鱼发布。需绑定拼多多商家后台账号；上架为 L2，须先给预览并获同意。"
metadata:
  builtin_skill_version: "1.1"
  dsagent:
    display_name: "拼多多·HTTP上架"
    emoji: "🚀"
    requires: {}
---

# 拼多多 · HTTP 逆向上架

> **重要:** 上架是**不可撤销的真实操作（L2）**。必须两步走：先拿「上架预览」给用户看，用户**明确同意**后才真正提交。
> 绝不要在一次调用里直接传 `--confirm true`。

## 何时使用

- 用户说「拼多多上架」「拼多多发布」「拼多多HTTP上架」→ 用本技能
- 用户给出一件商品的**统一 JSON**（标题 + 图片 + 规格 + SKU 行）要求发到拼多多 → 用本技能
- 商品规格是**二维**（颜色 × 尺码）→ 用本技能（原生支持矩阵）
- 想让**图片/价格/SKU 全部走 HTTP**（不依赖 DOM 逐格填表，快且抗页面结构变动）→ 用本技能
- 用户明确要求「逆向」「改包」「HTTP 提交」→ 用本技能

## 前置条件

调用本技能前必须满足：

1. **账号已绑定**：「账号连接」页已绑定**拼多多商家后台**（mms.pinduoduo.com）。
   ★ 它与买家端拼多多是两套完全独立的登录态，买家账号不能用于上架。
2. **登录态有效**：`dsagent_check_account_health(platform=pdd_mms)` 返回 valid；
   失效时引导用户到「账号连接」重新登录（需商家版 App 扫码）。
3. **图片就绪**：主图 1~10 张（单张 ≤3MB、JPG/PNG）；如发带规格商品，第 1 维每个规格值
   都要有预览图（宽高比 1:1、宽高 >480px）——否则 submit 报「请上传规格缩略图」。
4. **规格池就绪**（可选但推荐）：`assets/spec-pool.json` 或 workspace 的
   `artifacts/pdd-re/spec-pool.json`。没有也能发（平台按 spec_value 自解析），但规格 ID
   可能与店铺历史不一致。
5. **Chrome 可用**：本机装有 Chrome/Edge（浏览器驱动用）。
6. **无并发**：同一时刻不要跑两个拼多多发布任务（浏览器 Profile 独占锁会互斥）。

## 能力

| 项 | 说明 |
|---|---|
| 图片上传 | **纯 HTTP**：`get_signature` → `file.pinduoduo.com/v3/store_image` → `garner/mms/file/create` → `queryFileDetail`，主图/详情图/SKU 预览图全走 CDN |
| 规格矩阵 | 颜色×尺码二维，`skus[]` 按 `sku_key` **行数重建**（页面只建 1 行空壳也能改成 8 行） |
| spec_id | **规格池**（`assets/spec-pool.json`，店铺历史商品采集）本地查表，含 cm 归一匹配 |
| SKU 预览图 | `upload_spec_img_map`（颜色值 → CDN URL+fileId）→ 写入 `skus[].thumb_url` |
| 商品属性 | `draco-ms` 模板查询 + 改包写 `goods_properties[]`（vid/content） |
| 提交 | 拦截 `goodsCommit/action/edit` → 改包 → **abort 原请求** → 页面 fetch 带签名重放 |
| 确认上架 | `POST /glide/v2/mms/edit/commit/submit`（6 字段：commit_id/goods_id/is_onsale/third_type/if_allow_submit_mall_checking/crawlerInfo） |

## 边界

- **不做商品采集与比价** → 用 `pdd-crawl`
- **不做订单 / 售后 / 库存 / 客服 / 数据分析** → 用对应平台技能
- **不做淘宝 / 天猫 / 闲鱼发布** → 用 `taobao-publish` / `xianyu-publish`
- ★ **Anti-Content 签名必须由页面生成**（风控 SDK 采集浏览器行为，Node 算不出）——这是唯一必须开浏览器的原因
- ★ **提交会话必须由页面注册**（点「发布新商品」→ URL 分配 commit_id/goods_id）
- ★ **品牌默认填「无」**：商品 JSON 未给 `attributes` 里的品牌时，自动补 `品牌=无`（DEFAULT_BRAND 可改）。
  若某类目要求真实品牌资质，「无」可能仍被审核拦，需人工补品牌授权
- ★ **图片会自动规整**（`scripts/imgprep.py`，Python+PIL）：
  详情图超长（高>1500 且高/宽>2）→ **切分成多张**（切线落在平坦行，不切断文字/人脸），不硬压；
  偏长（高≤2倍宽）→ 等比缩到 1500；太宽（>1200）→ 等比缩到 1200；
  主图/规格图 → 补白成 1:1（不裁切商品）；>3MB → 质量阶梯压缩
- ★ **spec_id 会自动借位**（`scripts/preflight.mjs → borrowSpecIds`）：
  新规格值在店铺里没出现过时，同维度内按顺序借池里现成的 `spec_id`，
  **显示名保持你自己的**。约束：值数 > 池内该维度 id 数 会被平台判重复，需先建新规格
- ★ **商品资质**仍需人工补全（平台因类目而异）

## 输入

脚本入口 `{baseDir}/scripts/publish.mjs`，对话内也可直接调 host 工具 `dsagent_pdd_publish2` 加 `mode2=true`。

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `--product-file` | string | 是* | 统一商品数据 JSON 文件路径（*与 `--product` 二选一） |
| `--product` | string | 是* | 统一商品数据 JSON 字符串 |
| `--confirm` | flag | 否 | 省略 → **只返回预览，不产生任何写操作**；带 `true` → 真正上架 |
| `--account` | string | 否 | 账号 shopKey；多账号未绑定时先向用户确认 |

### `product` 统一结构

```jsonc
{
  "title": "儿童摇粒绒家居服套装 男童女童加厚保暖睡衣",   // 必填，≤60 字符
  "images": ["D:\\imgs\\main1.jpg", "D:\\imgs\\main2.jpg"], // 必填，本地绝对路径，1~10 张，单张 ≤3MB
  "detailImages": ["D:\\imgs\\d1.jpg"],                  // 选填，详情图，≤50 张，单张 ≤3MB
                                                        // ★ 平台硬规则：宽 480~1200px，高 ≤1500px
                                                        // ★ 逐张单图按顺序传，不要拼长图
  "category": "儿童家居服 家居服套装",                    // 选填，类目关键词；不传从标题推断
  "price": "69.9",                                        // 选填，参考价
  "stock": "1000",                                        // 选填，默认库存（SKU 行缺项回落）

  // ── 规格维度（选填，≤2 维；与 skus 配合）──
  "specs": [
    { "name": "颜色", "values": [
        { "value": "格蕾灰", "image": "D:\\imgs\\c1.jpg" },  // 第1维可带预览图（宽高比1:1、>480px、JPG/PNG）
        { "value": "银河蓝", "image": "D:\\imgs\\c2.jpg" }
    ] },
    { "name": "尺码", "values": [ { "value": "110cm" }, { "value": "120cm" } ] }
  ],

  // ── SKU 行（每行 specs 覆盖全部维度）──
  "skus": [
    { "specs": { "颜色": "格蕾灰", "尺码": "110cm" }, "price": "69.9", "stock": "200" },
    { "specs": { "颜色": "格蕾灰", "尺码": "120cm" }, "price": "69.9", "stock": "200" }
  ],

  // ── 商品属性（显式 name→value；命中页面选项才生效）──
  "attributes": [ { "name": "主面料成分", "value": "棉" } ],

  "account": "pdd_mms_xxxx"                              // 选填，指定账号 shopKey
}
```

**字段规则**

- `title` 必填 ≤60 字符；`images` 必填 1~10 张、单张 ≤3MB、本机绝对路径且真实存在
- `specs` ≤2 维；仅第 1 维的值可带 `image`（SKU 预览图）
- `skus` 每行 `specs` 覆盖全部维度；`price` 正数、`stock` 非负整数
- 兼容富格式：`colors[]` + `sizes[]` 会自动合成两维

**默认值**（用户没提就照此，不要追问）：库存省略 → 1000；单买价 → 拼单价 +1 元；货号 → 不写。

## 输出

| 字段 | 类型 | 含义 |
|------|------|------|
| `ok` | boolean | 业务是否成功。★ **预览时是 `ok=false` + `needConfirm=true`，正常流程不是报错** |
| `needConfirm` | boolean? | `true` 表示等用户确认 |
| `text` | string | 面向用户的中文文案（预览/成功详情/失败原因），原样转述 |
| `failureKind` | string? | `not_bound` / `need_account_choice` / `token_expired` / `risk_control` / `api_error` |
| `accounts` | array? | 仅 `need_account_choice` 时出现 |
| `shopKey` / `finalUrl` | string? | 实际账号 / 当时页面 URL |

三种典型返回：**① 预览**（无 `--confirm`）→ `ok=false` + `needConfirm=true`；**② 成功** → `ok=true` + text 含「已确认上架」；**③ 失败** → `ok=false` + `failureKind`。

## 工作流

### W1：上架一个新商品（标准链路）

```
① 从用户话提取商品信息，组装 product JSON
   （title + images 必需；缺 title 或 images 要主动问，不要猜）
② 先取预览：不带 --confirm
   → 返回 ok=false + needConfirm=true + 预览文案（不启浏览器、零写操作）
③ 把预览完整展示给用户，征求明确同意（L2 门禁，不可跳过、不可自行假设同意）
   同时提醒：品牌已自动填「无」；商品资质（如 3C/A类检测报告）仍需在弹出窗口内人工补全
④ 用户明确同意后，带 --confirm true 重新调用
⑤ 报告结果：ok=true → 告知已上架 + 商品 ID + 平台仍会审核；
   failureKind → 按「错误处理」表走
```

### W2：批量上架同款多链接

```
① 为每个链接准备独立 product JSON（标题/主图差异化，避免被判重复铺货）
② 逐个走 W1（每次都要单独拿用户同意，不要一次同意批量执行）
③ 或改用 pdd-link-matrix 技能（一图多发主图变体）
```

### W3：规格/价格与历史商品对齐（省事路径）

```
① 有同类历史商品 → 走「三层查一复用」L2：拉 on_shop/detail 拿规格池，改 values 后提交
② 没有历史商品 → 走 L3：draco-ms 属性树 + cabernet 尺码树
③ 类目已知 → L1 直接命中 cat-memory.json
```

## 执行流程

```
① 组装 product JSON（从用户话提取；title + images 必需，缺了主动问）
② 先取预览：不带 --confirm          → ok=false + needConfirm=true（不启浏览器、零写操作）
③ 把预览完整展示给用户，征求明确同意（L2 门禁，不可跳过、不可自行假设同意）
   同时提醒：品牌已自动填「无」；商品资质（如 3C/A类检测报告）仍需在弹出窗口内人工补全
④ 用户同意后带 --confirm true 重新调用
⑤ 报告结果：ok=true → 告知已上架 + 商品 ID + 平台仍会审核；
   failureKind → 按「错误处理」走
```

### 内部执行链（`--confirm true` 时，约 60~90 秒）

```
① HTTP  图片预上传      主图/详情图/预览图 → CDN URL（0.8s/张）
② 本地 规格池查表       规格值 → spec_id（assets/spec-pool.json）
③ 页面 点「发布新商品」  → URL 拿 goods_commit_id / goods_id
④ 页面 选类目并确认     （会话注册）
⑤ 页面 DOM 石填         标题 + 1 张主图（过「轮播图不能为空」校验）
⑥ 页面 点提交 → 拦截    abort 原请求 → 改包（gallery/skus/spec_id/预览图/价格/属性）
                        → 页面 fetch 带 Anti-Content 重放（HTTP）
⑦ 页面 fetch 调 commit/submit → 确认上架（HTTP）
```

## 平台硬规则（实测踩坑记录，回答用户时可引用）

| 规则 | 说明 |
|------|------|
| `goodsCommit/action/edit` 只**暂存** | 返回 success 但**不落库**；必须再调 `commit/submit` 才上架 |
| 提交前页面校验轮播图非空 | 「商品轮播图不能为空」→ 必须 DOM 传至少 1 张主图 |
| 标题必须进提交体 | DOM `fillTitle` 偶发不被 React 受理 → 改包时按 `detail.title` **强制写** `goods_name` |
| SKU 预览图提交必填 | 「请上传规格缩略图」→ 第 1 维每个值的 `image` 都要提供（宽高比 1:1、>480px、<3MB、JPG/PNG） |
| 单买价 ≥ 拼单价 +1 元 | 两列同值必被拦；工具自动按拼单价 +1 填 |
| `upload_sign` 一次性 | 每张图都要重新 `get_signature`（第 2 张起复用会 48005「签名已过期」） |
| anti_content 会失效 | 连续复用同一签名后续请求被拒；每次请求前重新生成 |
| 两种签名不可混用 | `upload_sign`（~620字符）只给 `store_image` 表单字段；`Anti-Content`（~500字符）只给请求头 |
| **详情图尺寸** | **宽 480~1200px，高 ≤1500px，逐张单图按顺序传**。**绝对不要自己拼长图** —— 把 9 屏拼成 750×9240 再传必被驳回「请重新上传第1张详情图」 |
| **新规格值必须借 spec_id** | 值在店铺没出现过 → 无 spec_id → 全写 0 → 报「存在重复的规格Id」。不是 bug，是平台要求先「登记」 |
| **同维度 spec_id 不能重复** | 借用时值数超过池内 id 数会被判重复，必须先建新规格 |

## 详情图正确做法

**拼多多详情图 = 多张独立单图，按顺序上传。** 不要拼长图。

```jsonc
"detailImages": [
  "D:\\imgs\\01-首屏.jpg",     // 750×960
  "D:\\imgs\\02-卖点.jpg",     // 750×900
  "D:\\imgs\\03-面料.jpg",     // 750×960
  "D:\\imgs\\04-花色.jpg"      // 750×1340
]
```

| 做法 | 结果 |
|------|------|
| ✅ 每屏单独出图，逐张按顺序传 | 合规，一次过 |
| ❌ 先拼成一张长图再传 | 驳回：高度超 1500px 上限 |

> 长图只在**淘宝详情 / 小红书**用，拼多多不吃。

## 图片规整（imgprep.py，自动执行）

`publish.mjs` 上传前自动调用 `scripts/imgprep.py`，无需手工处理。
**它的定位是「兜底」而不是「主流程」** —— 主流程应该是你直接出合规单图。

### 详情图处理顺序（固定，不跳步）

```
① 宽度统一到 750
   超宽（>750）→ 等比压到 750
   过窄（<750）→ 等比放大到 750
② 再看高度：高 > 1500 → 切分（宽度始终 750，绝不缩窄）
③ 高 ≤ 1500 → 直接用
```

**为什么不「压缩高度」**：750×1800 若按高缩到 1500，宽度会跟着变成 625 —— 竖版图被压窄、比例失真。平台要的是**宽度保持 750**，超高的唯一正确解法是切分。

### 切分规则：均分

`n = ceil(高 / 1500)`，每段高 ≈ 高/n。

| 输入 | 输出 |
|------|------|
| 750×1800 | 2 张（824 / 976） |
| 750×6000 | 4 张（1500 × 4） |
| 750×1501 | 2 张（660 / 841） |
| 1500×3000 | 先压 750×1500 → 正好合规，不切 |
| 1500×6000 | 先压 750×3000 → 切 2 张（1500 × 2） |

**均分而非「找平坦行切」**：均分后每段高度接近、没有碎片，切点固定不漂移。实测拼回原图逐像素比对，均值差仅 1.1（JPEG 重编码误差），**上下完全连贯**。

> 仅在均分点 ±12% 段高的小窗口内微调以避开切断文字/人脸，且强制每段 ≤1500。

### 其他图片

| 情况 | 处理 |
|------|------|
| 主图非 1:1 或边长 < 800 | **补白成正方形**（不裁切，避免切掉商品） |
| 规格图非 1:1 或边长 < 480 | 补白 + 放大到 480 |
| 体积 > 3MB | JPEG 质量阶梯压缩，必要时降分辨率 |

## 规格池维护

规格池是「规格值 → spec_id」映射（店铺内稳定复用），位于：
1. `<workspace>/artifacts/pdd-re/spec-pool.json`（优先）
2. `{baseDir}/assets/spec-pool.json`（技能自带兜底）

**采集方式**（推荐，一条命令）：

```bash
node {baseDir}/../pdd-works/scripts/query.mjs --mode spec-pool
```

它遍历店铺全部历史商品，拉 SKU 详情抽出 `{颜色分类: {格蕾灰: {spec_id, parent_spec_id}}, 参考分类: {110: {...}}}`。
**新增颜色/尺码时**：先把带新规格的商品发布一次，再重跑采集，池子就更新了。

### spec_id 借位（新规格值没 id 时）

**实测结论：查不到 spec_id 留 0 会被平台判「存在重复的规格Id」，上架必失败。** 走借位：

```
同一维度内，把池里已有的 spec_id 按顺序借给我们的规格值，显示名保持自己的
```

例（实测通过）：

| 显示名（买家看到） | 借用的 spec_id | 借自池里的 |
|---|---|---|
| 清紫梅花 | 7470835633 | 格蕾灰 |
| 紫格彩花 | 71504023 | 奶油黄 |
| 满紫嫣然 | 91380611 | 迷雾紫 |

**硬约束**：某维度的值数 **不能超过** 池里该维度的 spec_id 个数。
池里只有 6 个颜色 id → 最多上 6 个花色；要上 13 个花色，必须先在后台建出 7 个新颜色规格再采集。

`scripts/preflight.mjs → borrowSpecIds()` 已自动实现，并在预览里打印借位明细。

## 三层查一复用（发布加速）

同类目重复发布时，可跳过「选类目 + 建规格」：

```bash
node {baseDir}/scripts/reuse.mjs --category "儿童家居服 家居服套装"
```

- **L1** 类目记忆（`artifacts/pdd-re/cat-memory.json`）→ 直接用该类目
- **L2** 存量商品（`/glide/v2/mms/query/commit/on_shop/detail`）→ 170 字段完整提交体 + 规格池提取
- **L3** 新类目 → 拉属性树（`draco-ms` 模板 + `cabernet` 尺码树）

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定拼多多商家后台账号 | `not_bound` | 引导到「账号连接」添加**拼多多商家后台**（mms.pinduoduo.com）；★ 买家端拼多多账号不能用于发布 |
| 平台多账号且会话未绑定 | `need_account_choice` | **把候选列表给用户选**，把选定 shopKey 填 `--account` 重调；★ 绝不要自己挑 |
| 登录态失效 | `token_expired` | 引导到「账号连接」重新登录拼多多商家后台 |
| 命中滑块 | `risk_control` | 调用 `dsagent_risk_verify(platform=pdd_mms)` 拉验证页，用户拖完滑块后重试 |
| product 非法 / 缺 title/images / 图超 3MB | `api_error` | 按文案修正后重试（校验在浏览器启动前，零写操作） |
| 提交被拦（校验错误） | `api_error` | text 里有平台原文（如「商品标题必须填写」「请上传规格缩略图」）；按提示补 product 字段重试 |
| commit/submit 失败 | `api_error` | text 含 error_code + error_msg；常见 100027（标题空，已自动强制写）/100055（缩略图缺） |
| 页面结构变更导致找不到入口 | `api_error` | 让用户在窗口内手动点「发布新商品」后重试；或检查插件 `lib/pdd-publish.js` 的锚点配置是否需更新 |

## 已知稳定现象（不要当故障）

- 发布全程约 60~90 秒（图片 HTTP 上传 ~22s + 页面链路 ~40s）
- 提交后跳转 `goods_add/success?...&wait_audit=false` 表示**免审直接上架**；`wait_audit=true` 则等平台审核
- 商品列表接口有索引延迟，发完立刻查可能查不到，等 1~2 分钟
- 「SKU 预览图上传未确认」是 DOM 回读探测的误报，提交体里 thumb_url 实际已注入（以 submit 结果为准）

## 技术背景

本技能是拼多多发布链路的 HTTP 化重构（原 DOM 逐格填表方案已废弃）。核心实现位于插件 lib：

| 模块 | 职责 |
|------|------|
| `lib/pdd-image-preupload.js` | 图片批量预上传编排（去重/校验/回填 URL） |
| `lib/pdd-image-space.js` | `store_image` 四步链（照抄觅千手原文） |
| `lib/pdd-mode2.js` | 改包引擎（行数重建/规格池/预览图/价格匹配/submit） |
| `lib/pdd-publish.js` | 页面链路（会话注册/最小石填/拦截/兜底） |

## 知识库

完整逆向笔记（含全部踩坑记录、接口清单、错误码攻关录）：
`E:\360MoveData\Users\Administrator\Documents\Obsidian Vault\逆向\平台\拼多多商品提交HTTP逆向.md`
