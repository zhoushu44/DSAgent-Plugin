---
name: douyin-promo
description: "抖音·千川推广数据（只读）：推广总览（资金账户/日消耗/计划数）、推广计划列表、推广单元列表、商品维度报表（每商品花费/GMV/订单/ROI/点击/CTR）、每日消耗明细。数据源：千川后台 fxg.jinritemai.com 推广域。全部只读，HTTP + 浏览器 hook 页面响应取数，无平台副作用。触发：千川、巨量千川、抖音推广、推广数据、推广报表、今天花了多少钱、推广计划、推广单元、ROI、douyin promo。排除：商品查询（用 douyin-goods）、订单查询（用 douyin-order）、活动报名（用 douyin-activity）、店铺经营数据（用 douyin-shop）。需绑定「抖音小店」账号。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "抖音·千川推广"
    emoji: "📣"
    requires: {}
---

# 抖音 · 千川推广数据

> **只读技能**：本版本所有操作均为查询，**不产生任何平台写操作**，无需 L2 确认。
>
> **规划中（L2，本版不实现）**：暂停/开启推广、改日限额、改投产比/出价、创建/删除推广。
> contract 已预留 `--confirm` 参数位，写模式落地时按两步走门禁接入。

## 何时使用

- 用户说「千川数据」「推广账户还有多少钱」「抖音推广余额」→ 用本技能
- 要看**账户余额 / 在投计划数** → `overview` 模式
- 要判断「有没有在投放」→ `overview` 模式（`ongoingCount`）

## 能力

| 模式 | 类型 | 说明 |
|------|------|------|
| `overview` | 只读 | 推广总览：广告余额（多账户类型）+ 在投计划数 + 千川账户名（默认） |
| `plans` / `units` | **未实现** | 见下方说明 |
| `goods` | **未实现** | 商品维度报表，见下方说明 |
| `cost` | **未实现** | 每日消耗明细，见下方说明 |
| `pause` / `resume` / `maxcost` / `roi` / `create` / `delete` | **规划中** | L2 写操作，本版不实现 |

### 为什么 plans/units/goods/cost 未实现

千川在**独立域** `qianchuan.jinritemai.com`，接口已全部定位（213 个请求），
但**该店铺当前没有在投计划**——`getOngoingPromotionList` 返回
`{"activitiesOfPromotion":{}}`，列表类接口只验证了「能通、返回空」，
拿不到有数据的响应样本，**字段映射无法确认**。

与其编一套字段映射猜，不如等店铺有在投计划后重跑
`skills/_douyin_probe/probe-qc.mjs` 一次性补齐。当前调用会明确返回
`api_error` 并说明缺什么，**不伪造数据**。

## 前置条件

1. **账号已绑定**：「账号连接」页已绑定**抖音小店（抖店）**账号（platform=`douyin_shop`，抖店后台 / 千川后台同登录态）。★ 与内容平台 `douyin` 是**两套独立登录态**：抖音账号的 Cookie 进不了抖店后台（实测跳登录页），必须单独扫码登录一次抖店。
2. **登录态有效**：失效时技能会返回 `token_expired`，引导用户重新登录。
3. **Chrome 可用**（千川接口需要页面环境取数）。
4. **有推广才有数据**：没开推广的店铺接口返回空列表，属正常。

## 输入

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `--mode` | string | 否 | overview(默认) / plans / units / goods / cost |
| `--goods-id` | string | 否 | goods 模式可选；从商品报表中筛选单商品 |
| `--days` | number | 否 | 统计窗口天数，默认 7，上限 90 |
| `--limit` | number | 否 | 返回条数上限，默认 20，上限 100 |
| `--confirm` | flag | 预留 | 写操作确认门禁；本版无写操作，预留参数位 |
| `--account` | string | 否 | 账号 shopKey；多账号未绑定时先向用户确认 |

## 输出

| 字段 | 含义 |
|------|------|
| `ok` | 是否成功 |
| `mode` | 实际执行的模式 |
| `balance` | 主账户余额：`{type, total, valid, frozen}`，**已由分换算为元** |
| `balanceAll` | 全部账户类型余额数组（现金/预付/返还等） |
| `ongoingCount` | 在投计划数（0 = 当前没有投放） |
| `costLevel` | 消耗层级信息（有则返回） |
| `text` | 面向用户的中文文案，原样转述 |

> ⚠️ **不要用 `/ad/api/v1/account/user/info` 取账户名**——实测它返回的是
> AB 实验配置（`data.abInfo`），不是账户信息。该接口已在代码中弃用并注释。

## 用法

```bash
# 推广总览
node {baseDir}/scripts/promo.mjs --mode overview

# 推广计划 / 单元
node {baseDir}/scripts/promo.mjs --mode plans
node {baseDir}/scripts/promo.mjs --mode units

# 商品推广报表
node {baseDir}/scripts/promo.mjs --mode goods
node {baseDir}/scripts/promo.mjs --mode goods --goods-id 3700000000000001

# 日消耗
node {baseDir}/scripts/promo.mjs --mode cost --days 7

# ── 写操作（L2，规划中，本版不实现）──
# 落地后按两步走：先不带 --confirm 拿预览 → 用户同意 → 带 --confirm true 执行
```

## 工作流

### W1：看每个商品的推广数据（最常用）

```
① 调 promo.mjs --mode goods           → 商品维度报表
② 每个商品：花费 / GMV / 订单 / ROI / 点击 / 展现 / CTR
③ 按 ROI 降序找高效商品，按花费降序找烧钱商品
④ 结合 douyin-goods --mode sku 看该商品 SKU，判断是否继续投
```

### W2：看今天推广花了多少钱

```
① 调 promo.mjs --mode overview        → 资金账户 + 日消耗 + 计划数
② 把 text 原样转述用户（余额/消耗/计划数）
③ 用户想看某个计划明细 → --mode plans 看展现/点击/ROI
```

### W3：复盘推广效果

```
① 调 promo.mjs --mode goods           → 商品维度全量数据
② 调 promo.mjs --mode plans           → 计划维度
③ 调 promo.mjs --mode cost --days 7   → 7 日消耗趋势
④ 三个维度交叉：钱花在哪个计划 → 计划推哪个商品 → 商品产出多少 GMV
⑤ 结合 douyin-order --mode list --status done 核对真实成交
```

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定抖音小店账号 | `not_bound` | 引导到「账号连接」添加**抖音小店**账号 |
| 平台有多个账号且未指定 | `need_account_choice` | 把候选账号列表给用户选，把选定 shopKey 填进 `--account` 重调；★ 不要自己挑一个 |
| 登录态失效 | `token_expired` | 引导到「账号连接」重新登录 |
| 浏览器 profile 被占用 | `api_error` | 稍后重试，或先关闭已弹出的后台窗口 |
| 接口未回填（当前为桩） | `api_error` | 先跑 `_douyin_probe` 探测脚本，把真实接口回填进 APIS 常量 |
| 未知 mode | `api_error` | 用 overview/plans/units/goods/cost 之一 |
| 返回空列表 | — | 店铺未开推广，属正常（不是故障） |

## 技术说明

### 取数方式

千川推广在抖店/千川后台（`fxg.jinritemai.com`），接口前缀分散
（探测已见 `/byteshop/*`、`/b/a/api/*`），响应体统一为 `{st, code, msg, data}`。
风控签名由页面 JS 运行时生成（`verifyFp` / `msToken` / `_bid` / `_lid` 等），
纯 HTTP 请求恒被拒，故采用「**打开页面 → hook 页面自己发的响应**」
（`Network.responseReceived` + `Network.getResponseBody`）取数，
与 `pdd-promo` 同源思路。

### 接口（待探测回填）

| 用途 | 接口 path 片段 | 状态 |
|------|----------------|------|
| 推广总览（账户/消耗/计划数） | **待探测回填** | ⏳ 未回填 |
| 推广计划列表 | **待探测回填** | ⏳ 未回填 |
| 推广单元列表 | **待探测回填** | ⏳ 未回填 |
| 商品维度报表 | **待探测回填** | ⏳ 未回填 |
| 每日消耗 | **待探测回填** | ⏳ 未回填 |

> ⚠️ **当前是桩实现**：`scripts/promo.mjs` 里的 `APIS` 常量只有占位 key，
> 尚未回填真实接口 path。在回填前，脚本会明确返回
> `{ok:false, failureKind:'api_error', text:'接口待回填：先跑探测脚本'}`，
> **不会伪造成功数据**。

### 回填方法

1. 跑 `node skills/_douyin_probe/probe.mjs`，打开千川后台推广页采集接口；
2. 从 `probe-out/hits-promo.json` 里按响应内容定位目标接口；
3. 把接口 path 片段填进 `scripts/promo.mjs` 的 `APIS` 常量，并删掉桩判断。

### 浏览器环境

- `profileDir('douyin_shop', shopKey)` 定位账号独立 profile（与内容平台 `douyin` 分开）；
- `tryAcquireProfile` / `releaseProfile` / `clearProfileLocks` 保证同一账号
  不会并发起两个浏览器；
- `headless: false` + `--no-sandbox --disable-blink-features=AutomationControlled`
  保持与 `douyin-works` 一致的反检测配置。
