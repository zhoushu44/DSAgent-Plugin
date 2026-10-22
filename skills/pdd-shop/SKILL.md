---
name: pdd-shop
description: "拼多多店铺经营数据（只读）：店铺经营总览（等级/访客/浏览量/粉丝/今日昨日商品数据）、店铺流量（uv/pv/搜索指数/交易指数/粉丝）、店铺评分（服务数据：退款率/平台介入率/退款处理时长）、商品数据明细（每商品 访客/浏览量/支付金额/支付订单/转化率/收藏）。数据源：生意参谋 sycm。全部 HTTP，无平台副作用。触发：拼多多店铺数据、经营总览、店铺流量、访客数、拼多多评分、商品数据、哪个商品卖得好、生意参谋、pdd shop。排除：拼多多商品上架（用 pdd-publish-http）、商品查询/下架（用 pdd-works）、推广数据（用 pdd-promo）、公开采集（用 pdd-crawl）。需绑定「拼多多商家后台」账号。"
metadata:
  builtin_skill_version: "1.1"
  dsagent:
    display_name: "拼多多·店铺经营数据"
    emoji: "🏪"
    requires: {}
---

# 拼多多 · 店铺经营数据

> **只读技能**：所有操作均为查询，**不产生任何平台写操作**，无需 L2 确认。

## 何时使用

- 用户说「店铺今天怎么样」「访客多少」「哪个商品卖得好」→ 用本技能
- 要看**店铺流量**（访客/浏览量/粉丝）→ `flow` 模式
- 要看**店铺评分**（退款率/介入率）→ `score` 模式
- 要看**每商品数据**（访客/支付/转化率）→ `goods` 模式
- 要**一眼看全店** → `overview` 模式

## 能力

| 模式 | 说明 |
|------|------|
| `overview` | 店铺经营总览：等级 + 流量 + 今日/昨日商品数据 + 支付金额最高商品（默认） |
| `flow` | 店铺流量：访客 uv / 浏览量 pv / 搜索指数 / 交易指数 / 粉丝数 |
| `score` | 店铺评分（服务数据）：退款率 / 平台介入率 / 成功退款金额 / 退款处理时长 |
| `goods` | 商品数据明细：每商品 访客/浏览量/收藏/支付金额/订单/件数/人数/转化率/支付率/下单访客率/类目转化率对比 |

## 前置条件

1. **账号已绑定**：「账号连接」页已绑定**拼多多商家后台**（mms.pinduoduo.com）。
2. **登录态有效**：失效时技能会返回 `token_expired`，引导用户重新登录。
3. **Chrome 可用**（sycm 生意参谋需要页面环境取数）。

## 输入

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `--mode` | string | 否 | overview(默认) / flow / score / goods |
| `--limit` | number | 否 | goods 模式返回条数上限，默认 20，上限 100 |
| `--account` | string | 否 | 账号 shopKey；多账号未绑定时先向用户确认 |

## 输出

| 字段 | 含义 |
|------|------|
| `flow` | `{uv, pv, uvPct, pvPct, srchIndex, orderIndex, totalFans, weekFans}` |
| `score` | 店铺评分原始结构（`serviceDataVO`） |
| `goodsOverview` | `{today, yesterday}` 今日/昨日商品数据 |
| `goods` / `items` | 商品明细数组（goodsId/name/date/uv/pv/fav/payAmt/payCnt/payQty/payUsers/vcr/payOrdrRto/ordrVstrRto/cate3Vcr/cate3AvgVcr + uvRef/pvRef/payAmtRef 等参考值） |
| `mallLevel` | `{level, gmv, restGmv}` 店铺等级 |
| `text` | 面向用户的中文文案，原样转述 |

## 用法

```bash
# 店铺经营总览
node {baseDir}/scripts/shop.mjs --mode overview

# 店铺流量
node {baseDir}/scripts/shop.mjs --mode flow

# 店铺评分
node {baseDir}/scripts/shop.mjs --mode score

# 商品数据明细（按支付金额排序看哪个卖得好）
node {baseDir}/scripts/shop.mjs --mode goods --limit 30
```

## 工作流

### W1：看今天店铺怎么样

```
① 调 shop.mjs --mode overview        → 等级 + 访客 + 今日/昨日支付
② 把 text 原样转述用户
③ 用户想看流量细节 → --mode flow；想看哪个商品卖得好 → --mode goods
```

### W2：找出该推的商品

```
① 调 shop.mjs --mode goods           → 每商品 访客/支付/转化率
② 按支付金额降序 = 当前主力款
③ 按转化率降序 = 有潜力但流量少的款（适合投推广）
④ 结合 pdd-promo --mode goods 看推广花费/GMV，算真实 ROI
```

### W3：店铺健康度巡检

```
① 调 shop.mjs --mode score           → 退款率/介入率（高了要优化服务）
② 调 shop.mjs --mode flow            → 访客趋势（跌了要引流）
③ 调 pdd-works --mode overview       → 在售商品数（少了要补品）
④ 调 pdd-promo --mode overview       → 推广状态/余额（停了要恢复）
```

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定商家后台账号 | `not_bound` | 引导到「账号连接」添加**拼多多商家后台**账号 |
| 登录态失效 | `token_expired` | 引导到「账号连接」重新登录 |
| 未知 mode | `api_error` | 用 overview/flow/score/goods 之一 |
| 返回空数据 | — | 新店无流量属正常（不是故障） |

## 技术说明

### sycm PUA 数字混淆破解（重要）

拼多多生意参谋对**商品明细接口**（`queryGoodsDetailVOListForMMS`）的数字字段用
**PUA 私用区字符**（U+E000~U+F8FF）做混淆反采集：

```text
goodsUv = "\uE447\uEC31"      ← 混淆（两个 PUA 字符 = 两位数）
goodsUvPpr = "53"             ← 明文（同一响应里）
```

**破解方法**（已实装，52/52 字段验证通过）：

1. 同一响应里 `*Ppr` 字段是**明文**，与被混淆字段**等长同构**
2. 用 12 组 `(字段, 字段Ppr)` 逐字符对齐，反推 PUA → 数字映射
3. 全表统一用该映射解码

**码点每次动态变化**（不能硬编码），所以每次都要现场解。

```js
// 覆盖字段对
['goodsUv','goodsUvPpr'], ['goodsPv','goodsPvPpr'], ['payOrdrCnt','payOrdrCntPpr'],
['goodsFavCnt','goodsFavCntPpr'], ['payOrdrAmt','payOrdrAmtPpr'], ['cfmOrdrCnt','cfmOrdrCntPpr'],
['imprUsrCnt','imprUsrCntPpr'], ['ordrCrtUsrCnt','ordrCrtUsrCntPpr'], ['cnsltUsrQty','cnsltUsrQtyPpr'],
['payOrdrGoodsQty','payOrdrGoodsQtyPpr'], ['payOrdrUsrCnt','payOrdrUsrCntPpr'], ['cfmOrdrGoodsQty','cfmOrdrGoodsQtyPpr']
```

### `*Ppr` 字段语义

`*Ppr`（明文）在不同账号返回的可能是「较上周期差值」也可能是「当前值」——
**不要用它算环比**，只作参考值输出（`uvRef`/`pvRef`/`payAmtRef`）。

### 接口分工

| 接口 | 数字形态 |
|------|---------|
| `queryGoodsPageOverviewForMms` | 明文（店铺商品总览，今日/昨日/逐时） |
| `queryGoodsDetailVOListForMMS` | **PUA 混淆**（商品明细，需解码） |
| `queryGoodsPageOverView` | PUA 混淆（旧版总览） |
| `mallScore/queryMallFlowData` | 明文（店铺流量） |
| `mallScore/queryMallScoreOverView` | 明文（店铺评分） |

### 数据源

取数用「打开 sycm 页面 → hook 页面自己发的响应」（`Network.responseReceived` +
`Network.getResponseBody`），规避该子应用风控。

数据源是**生意参谋**（`mms.pinduoduo.com/sycm/*`），接口统一 `/sydney/api/*` 前缀：

| 接口 | 用途 |
|------|------|
| `sydney/api/mallScore/queryMallFlowData` | 店铺流量（uv/pv/搜索指数/粉丝） |
| `sydney/api/mallScore/queryMallScoreOverView` | 店铺评分（服务数据） |
| `sydney/api/goodsDataShow/queryGoodsPageOverviewForMms` | 商品数据总览（今日/昨日） |
| `sydney/api/goodsDataShow/queryGoodsDetailVOListForMMS` | 商品明细列表 |
| `rivendell/api/mallLevel/getEntranceInfo` | 店铺等级 |

本技能用「打开经营页 → hook 页面自己发的响应」取数——sycm 的风控签名（与 yingxiao/mms 各自独立）
自己发请求会被拦，页面会话内的响应最可靠。这与 `pdd-promo` 是同源思路。
