---
name: douyin-order
description: "抖音小店·订单查询（只读）：订单总览（待发货/已发货/已完成计数）、订单列表（订单号/商品/金额/收件人/状态/下单时间，支持按状态筛选）、单笔订单详情。数据源：抖店后台 fxg.jinritemai.com。全部只读，HTTP + 浏览器 hook 页面响应取数，无平台副作用。触发：抖店订单、抖音小店订单、待发货订单、查抖音订单、订单列表、订单详情、douyin order。排除：商品查询（用 douyin-goods）、推广数据（用 douyin-promo）、活动报名（用 douyin-activity）、店铺经营数据（用 douyin-shop）。需绑定「抖音小店」账号。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "抖音小店·订单查询"
    emoji: "📦"
    requires: {}
---

# 抖音小店 · 订单查询

> **只读技能**：所有操作均为查询，**不产生任何平台写操作**，无需 L2 确认。
> 发货、改价、备注、取消订单等写操作留待后续版本。

## 何时使用

- 用户说「抖店订单」「待发货有哪些」「查一下订单」→ 用本技能
- 要按**状态**筛选订单（待支付/待发货/已发货/已完成）→ `list` 模式 + `--status`
- 要**一眼看订单分布** → `overview` 模式

## 能力

| 模式 | 说明 |
|------|------|
| `overview` | 订单总览：各状态计数 + 当前页前 10 笔（默认） |
| `list` | 订单列表：订单号/状态/金额/件数/收件人/地域/时间，支持 `--status` 筛选 |

**本版未实现**（调用会明确返回 `api_error`，不假装支持）：

| 模式 | 缺什么 |
|------|--------|
| `detail` | 单笔订单详情接口未确认（需打开 `/ffa/morder/order/detail-v2` 单独抓包） |

发货、改价、备注、取消订单等写操作同样留待后续版本。

## 前置条件

1. **账号已绑定**：「账号连接」页已绑定**抖音小店（抖店）**账号（platform=`douyin_shop`，抖店后台 `fxg.jinritemai.com`）。★ 与内容平台 `douyin` 是**两套独立登录态**：抖音账号的 Cookie 进不了抖店后台（实测跳登录页），必须单独扫码登录一次抖店。
2. **登录态有效**：失效时技能会返回 `token_expired`，引导用户重新登录。
3. **Chrome 可用**（抖店后台接口需要页面环境取数）。

## 输入

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `--mode` | string | 否 | overview(默认) / list |
| `--status` | string | 否 | all=全部(默认) / topay=待支付 / stock_up=待发货 / on_delivery=已发货 / received=已完成 |
| `--limit` | number | 否 | 返回条数上限，默认 20，上限 100 |
| `--account` | string | 否 | 账号 shopKey；多账号未绑定时先向用户确认 |

## 输出

| 字段 | 含义 |
|------|------|
| `ok` | 是否成功 |
| `mode` | 实际执行的模式 |
| `counts` | overview 模式：`{all, unpaid, stockUp, expShip, shipDelay, onDelivery, received, closed, outOfStock, inAftersale, haveAftersale, handling}` |
| `items` | 订单数组 |
| `total` | 当前页订单数 |
| `text` | 面向用户的中文文案，原样转述 |

`items[]` 字段：

```
id                 店铺订单号（shop_order_id，19 位字符串）
status / statusDesc  抖店 order_status 数字 / 中文（1待支付 2待发货 3已发货 4已完成 5已关闭）
productCount       商品件数
payAmount          用户实付（元，已由分换算）
actualPayAmount    实付金额（元）
receiveAmount      商家实收（元）
payTypeDesc        支付方式（如「抖音月付」）
createTime / payTime / expShipTime / logisticsTime / receiptTime   本地化时间
buyerNickname      买家昵称（脱敏）
receiver / receiverTel   收件人 / 电话（**平台已脱敏**，如「牛*」「1**********」）
province / city / town / addressDetail   地域（detail 平台已打码）
waitShipCount / shippedCount   待发货 / 已发货件数
remark / buyerWords   备注 / 买家留言
```

> ⚠️ 收件人电话与详细地址由平台脱敏后下发，**无法**从接口拿到完整值。

### tabcnt 的嵌套陷阱（重要）

`/api/order/tabcnt` 的响应是**两层**结构：

```
data.stock_up / data.all / data.on_delivery ...          ← 顶层：当前 tab 的快照
data.sub_tab_count_map.all.closed / .received / ...      ← 「全部」tab 的完整分解
```

**顶层 `received: 0` 不代表没有已完成订单**——它是「已签收」的严格口径，
而 `closed` 是「已完结」口径（含已完成）。实测该店 34 单 = `closed 33 + stock_up 1`，
其中 19 笔 `order_status=4`（已完成）。两套口径不可混为一谈。

### order_status 实测枚举（2026-10 验证）

| 值 | 含义 | 判据 |
|---|---|---|
| `2` | 待发货 | `wait_ship_count > 0` |
| `4` | 已完成 | 已签收，无待发件 |

其余值（待支付/已发货/售后中/已关闭）尚未在该店样本中出现，
映射表按抖音电商通用语义预留，**未经验证不应直接信任**。

页面 tab 权威文案（来自 DOM，非接口）：
`全部订单 / 待支付 / 待发货 / 24h需发货及揽收 / 超时未发货及揽收 / 已发货 / 售后中 / 已完成 / 已关闭`

对应的 tabcnt key：`all / unpaid / stock_up / exp_ship / ship_delay / on_delivery / in_aftersale / received / closed`

## 用法

```bash
# 订单总览（各状态计数）
node {baseDir}/scripts/order.mjs --mode overview

# 待发货订单
node {baseDir}/scripts/order.mjs --mode list --status stock_up

# 已发货 / 已完成 / 全部
node {baseDir}/scripts/order.mjs --mode list --status on_delivery
node {baseDir}/scripts/order.mjs --mode list --status received
node {baseDir}/scripts/order.mjs --mode list --status all --limit 50
```

## 工作流

### W1：看今天要发多少货

```
① 调 order.mjs --mode overview        → 各状态订单计数
② 用户要看具体单 → --mode list --status tosend
③ 把 text 原样转述用户（订单号/商品/金额/收件人）
```

### W2：查某笔订单的来龙去脉

```
① 调 order.mjs --mode detail --order-id <id>  → 商品明细/收件信息/物流/金额拆分
② 需要看商品规格 → 取商品 ID 后调 douyin-goods --mode sku
③ 需要看是不是推广带来的 → 结合 douyin-promo --mode goods 交叉
```

### W3：每日经营复盘

```
① 调 order.mjs --mode list --status done --limit 100 → 已完成订单
② 按商品汇总成交金额与件数 = 当日实际产出
③ 调 douyin-shop --mode goods 对比商品维度数据
④ 调 douyin-promo --mode goods 看推广 ROI
```

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定抖音小店账号 | `not_bound` | 引导到「账号连接」添加**抖音小店**账号 |
| 平台有多个账号且未指定 | `need_account_choice` | 把候选账号列表给用户选，把选定 shopKey 填进 `--account` 重调；★ 不要自己挑一个 |
| 登录态失效 | `token_expired` | 引导到「账号连接」重新登录 |
| 浏览器 profile 被占用 | `api_error` | 稍后重试，或先关闭已弹出的抖店后台窗口 |
| detail 缺 order-id | `api_error` | 补 `--order-id` 重试 |
| 接口未回填（当前为桩） | `api_error` | 先跑 `_douyin_probe` 探测脚本，把真实接口回填进 APIS 常量 |
| 未知 mode / status | `api_error` | mode 用 overview/list/detail；status 用 all/topay/tosend/sent/done/closed |
| 返回空列表 | — | 该状态下没有订单属正常（不是故障） |

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
| 订单总览（各状态计数） | **待探测回填** | ⏳ 未回填 |
| 订单列表（按状态筛选） | **待探测回填** | ⏳ 未回填 |
| 单笔订单详情 | **待探测回填** | ⏳ 未回填 |

> ⚠️ **当前是桩实现**：`scripts/order.mjs` 里的 `APIS` 常量只有占位 key，
> 尚未回填真实接口 path。在回填前，脚本会明确返回
> `{ok:false, failureKind:'api_error', text:'接口待回填：先跑探测脚本'}`，
> **不会伪造成功数据**。

### 回填方法

1. 跑 `node skills/_douyin_probe/probe.mjs`，打开抖店后台订单页采集接口；
2. 从 `probe-out/hits-order_list.json` 里按响应内容定位目标接口；
3. 把接口 path 片段填进 `scripts/order.mjs` 的 `APIS` 常量，并删掉桩判断。

### 浏览器环境

- `profileDir('douyin_shop', shopKey)` 定位账号独立 profile（与内容平台 `douyin` 分开）；
- `tryAcquireProfile` / `releaseProfile` / `clearProfileLocks` 保证同一账号
  不会并发起两个浏览器；
- `headless: false` + `--no-sandbox --disable-blink-features=AutomationControlled`
  保持与 `douyin-works` 一致的反检测配置。
