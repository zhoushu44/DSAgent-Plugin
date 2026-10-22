---
name: douyin-goods
description: "抖音小店·商品查询（只读）：商品总览（在售/未在售计数）、商品列表（商品ID/标题/类目/SKU数/价格带/在售状态）、单商品详情、单商品 SKU 全量（规格/价格/库存/预览图）、全店规格池采集。数据源：抖店后台 fxg.jinritemai.com。全部只读，HTTP + 浏览器 hook 页面响应取数，无平台副作用。触发：抖店商品列表、查抖音商品、抖音小店商品、抖店SKU、抖店商品详情、抖店规格池、douyin goods。排除：商品上架发布（用 douyin-publish）、订单查询（用 douyin-order）、推广数据（用 douyin-promo）、活动报名（用 douyin-activity）、店铺经营数据（用 douyin-shop）。需绑定「抖音小店」账号。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "抖音小店·商品查询"
    emoji: "🔍"
    requires: {}
---

# 抖音小店 · 商品查询

> **只读技能**：本版本所有操作均为查询，**不产生任何平台写操作**，无需 L2 确认。
>
> **规划中（未实现）**：下架 / 上架 / 删除商品（L2 写操作）留待后续版本，
> 落地前会在 contract 中补充 `--confirm` 门禁参数。

## 何时使用

- 用户说「查抖店商品」「抖音小店商品列表」「我上了哪些商品」→ 用本技能
- 要查**单商品 SKU**（规格组合/价格/库存/预览图）→ `sku` 模式
- 要拿**单商品详情**（标题/类目/价格带/状态）→ `detail` 模式
- 要**采集规格池**（规格值 → spec_id，上架前的准备）→ `spec-pool` 模式

## 能力

| 模式 | 类型 | 说明 |
|------|------|------|
| `overview` | 只读 | 商品总览：在售/未在售计数 + 前 N 条明细（默认） |
| `list` | 只读 | 商品列表：商品ID/标题/类目/SKU数/价格带/在售状态 |
| `detail` | 只读 | 单商品详情：标题/类目/主图/价格带/状态 |
| `sku` | 只读 | 单商品 SKU 全量：规格/价格/库存/预览图 |
| `spec-pool` | 只读 | 全店规格池采集：遍历商品抽 规格值→spec_id |
| `offsale` / `onsale` / `delete` | **规划中** | 下架/上架/删除商品（L2，本版不实现） |

## 前置条件

1. **账号已绑定**：「账号连接」页已绑定**抖音小店**账号（抖店后台 `fxg.jinritemai.com`）。
2. **登录态有效**：失效时技能会返回 `token_expired`，引导用户重新登录。
3. **Chrome 可用**（抖店后台接口需要页面环境取数）。

## 输入

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `--mode` | string | 否 | overview(默认) / list / detail / sku / spec-pool |
| `--product-id` | string | 条件 | detail / sku 模式必填 |
| `--limit` | number | 否 | 返回条数上限，默认 20，上限 100 |
| `--account` | string | 否 | 账号 shopKey；多账号未绑定时先向用户确认 |

## 输出

| 字段 | 含义 |
|------|------|
| `ok` | 是否成功 |
| `mode` | 实际执行的模式 |
| `summary` | overview 模式：`{onSale, notOnSale, totalShown}` |
| `items` | 商品明细数组（结构随 mode 变化） |
| `sku` | sku 模式：规格/价格/库存/预览图数组 |
| `text` | 面向用户的中文文案，原样转述 |

## 用法

```bash
# 商品总览
node {baseDir}/scripts/goods.mjs --mode overview

# 商品列表
node {baseDir}/scripts/goods.mjs --mode list --limit 50

# 单商品详情 / SKU
node {baseDir}/scripts/goods.mjs --mode detail --product-id 3700000000000001
node {baseDir}/scripts/goods.mjs --mode sku --product-id 3700000000000001

# 规格池采集（上架前准备）
node {baseDir}/scripts/goods.mjs --mode spec-pool
```

## 工作流

### W1：查「我上了哪些商品」

```
① 调 goods.mjs --mode overview        → 在售/未在售计数 + 前 N 条
② 把 text 原样转述用户（含商品ID/标题/SKU数/价格带）
③ 用户想看某条明细 → --mode detail --product-id <id>
```

### W2：上架后验证

```
① douyin-publish 发布成功 → 拿到 product_id
② 调 goods.mjs --mode sku --product-id <id>
③ 核对：SKU 数 / 规格值 / 价格 / 库存 / 预览图 是否与 product JSON 一致
④ 列表有索引延迟（1~2 分钟），查不到就等一会再查，不要当故障
```

### W3：上架前准备规格池

```
① 调 goods.mjs --mode spec-pool       → 扫全店商品，抽 规格值→spec_id
② 产物落在 <workspace>/artifacts/douyin-goods/spec-pool.json
③ 之后 douyin-publish 上架会自动读它
④ 新增颜色/尺码后重跑一次即可更新
```

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定抖音小店账号 | `not_bound` | 引导到「账号连接」添加**抖音小店**账号 |
| 平台有多个账号且未指定 | `need_account_choice` | 把候选账号列表给用户选，把选定 shopKey 填进 `--account` 重调；★ 不要自己挑一个 |
| 登录态失效 | `token_expired` | 引导到「账号连接」重新登录 |
| 浏览器 profile 被占用 | `api_error` | 稍后重试，或先关闭已弹出的抖店后台窗口 |
| detail/sku 缺 product-id | `api_error` | 补 `--product-id` 重试 |
| 接口未回填（当前为桩） | `api_error` | 先跑 `_douyin_probe` 探测脚本，把真实接口回填进 APIS 常量 |
| 未知 mode | `api_error` | 用 overview/list/detail/sku/spec-pool 之一 |
| 返回空列表 | — | 新店无商品属正常（不是故障） |

## 技术说明

### 取数方式

抖店后台在 `fxg.jinritemai.com`，接口前缀分散（探测已见 `/byteshop/*`、`/b/a/api/*`），
响应体统一为 `{st, code, msg, data}`。风控签名由页面 JS 运行时生成
（`verifyFp` / `msToken` / `_bid` / `_lid` 等），纯 HTTP 请求恒被拒，
故采用「**打开页面 → hook 页面自己发的响应**」（`Network.responseReceived` +
`Network.getResponseBody`）取数，与 `douyin-works` 同源思路。

### 接口（待探测回填）

| 用途 | 接口 path 片段 | 状态 |
|------|----------------|------|
| 商品总览 / 列表 | **待探测回填** | ⏳ 未回填 |
| 单商品详情 | **待探测回填** | ⏳ 未回填 |
| 单商品 SKU 全量 | **待探测回填** | ⏳ 未回填 |
| 规格池 | **待探测回填** | ⏳ 未回填 |

> ⚠️ **当前是桩实现**：`scripts/goods.mjs` 里的 `APIS` 常量只有占位 key，
> 尚未回填真实接口 path。在回填前，脚本会明确返回
> `{ok:false, failureKind:'api_error', text:'接口待回填：先跑探测脚本'}`，
> **不会伪造成功数据**。

### 回填方法

1. 跑 `node skills/_douyin_probe/probe.mjs`，打开抖店后台商品列表页采集接口；
2. 从 `probe-out/hits-goods_list.json` 里按响应内容定位目标接口；
3. 把接口 path 片段填进 `scripts/goods.mjs` 的 `APIS` 常量，并删掉桩判断。

### 浏览器环境

- `profileDir('douyin', shopKey)` 定位账号独立 profile；
- `tryAcquireProfile` / `releaseProfile` / `clearProfileLocks` 保证同一账号
  不会并发起两个浏览器；
- `headless: false` + `--no-sandbox --disable-blink-features=AutomationControlled`
  保持与 `douyin-works` 一致的反检测配置。
