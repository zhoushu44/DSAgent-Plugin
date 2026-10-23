---
name: douyin-shop
description: "抖音小店·店铺经营数据（只读）：店铺经营总览（等级/访客/浏览量/成交金额）、店铺流量（访客 uv/浏览量 pv/成交）、店铺体验分（服务数据：体验分/物流/客服/商品/售后）、商品数据明细（每商品 访客/成交金额/转化率）。数据源：抖店后台 fxg.jinritemai.com。全部只读，HTTP + 浏览器 hook 页面响应取数，无平台副作用。触发：抖音店铺数据、抖店经营数据、抖店总览、抖店流量、抖店访客、抖店体验分、店铺评分、抖店商品数据、哪个商品卖得好、douyin shop。排除：商品查询/下架（用 douyin-goods）、订单查询（用 douyin-order）、千川推广（用 douyin-promo）、活动报名（用 douyin-activity）、抖音内容/作品数据（用 douyin-works）。需绑定「抖音小店」账号。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "抖音小店·店铺经营数据"
    emoji: "🏪"
    requires: {}
---

# 抖音小店 · 店铺经营数据

> **只读技能**：所有操作均为查询，**不产生任何平台写操作**，无需 L2 确认。

## 何时使用

- 用户说「抖店今天怎么样」「访客多少」「哪个商品卖得好」→ 用本技能
- 要看**店铺流量**（访客/浏览量/成交）→ `flow` 模式
- 要看**店铺体验分**（服务数据）→ `score` 模式
- 要看**每商品数据**（访客/成交金额/转化率）→ `goods` 模式
- 要**一眼看全店** → `overview` 模式

## 能力

| 模式 | 说明 |
|------|------|
| `overview` | 店铺经营总览：店铺名 + 体验分 + 商品各状态计数 + 销量最高商品（默认） |
| `score` | 店铺体验分：当前分/昨日分/开店天数 + 子项指标（差评数、揽收时长、配送时效等） |
| `goods` | 商品数据明细：每商品 销量/价格带/状态/审核/类目 |

> ⚠️ **没有 `flow` 模式**：抖店**不提供**「店铺访客 uv / 浏览量 pv」这种单一接口，
> 经营流量数据散在罗盘（`mcompass`）域，需按搜索/推荐等维度分别取。
> 本技能聚焦体验分与商品供给，流量分析后续单独做 `douyin-compass`。

## 前置条件

1. **账号已绑定**：「账号连接」页已绑定**抖音小店（抖店）**账号（platform=`douyin_shop`，抖店后台 `fxg.jinritemai.com`）。★ 与内容平台 `douyin` 是**两套独立登录态**：抖音账号的 Cookie 进不了抖店后台（实测跳登录页），必须单独扫码登录一次抖店。
2. **登录态有效**：失效时技能会返回 `token_expired`，引导用户重新登录。
3. **Chrome 可用**（抖店后台接口需要页面环境取数）。

## 输入

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `--mode` | string | 否 | overview(默认) / flow / score / goods |
| `--limit` | number | 否 | goods 模式返回条数上限，默认 20，上限 100 |
| `--account` | string | 否 | 账号 shopKey；多账号未绑定时先向用户确认 |

## 输出

| 字段 | 含义 |
|------|------|
| `score` | `{shopName, category, score, yesterday, scoreType, doneDate, shopOpenDays, isStandardOut, subMetrics[]}` |
| `score.subMetrics[]` | `{node, title, value, valueType, decimal, outStandard}` 子项指标 |
| `goodsCount` | `{onsale, draft, audit, forbidden, unpass, sellOut}` 商品各状态计数 |
| `goods` / `items` | 商品明细数组（`product_id`/`name`/`sellNum`/`priceLower`/`priceHigher`/`status`/`checkStatus`/`cates`） |
| `text` | 面向用户的中文文案，原样转述 |

> 金额字段（`priceLower`/`priceHigher`）已由**分换算为元**。
> `product_id` 是 19 位**字符串**（不是数字）。

## 用法

```bash
# 店铺经营总览
node {baseDir}/scripts/shop.mjs --mode overview

# 店铺体验分（含子项指标）
node {baseDir}/scripts/shop.mjs --mode score

# 商品数据明细
node {baseDir}/scripts/shop.mjs --mode goods --limit 30
```

## 工作流

### W1：看今天店铺怎么样

```
① 调 shop.mjs --mode overview        → 店铺名 + 体验分 + 商品供给 + 销量最高商品
② 把 text 原样转述用户
③ 用户想看体验分子项 → --mode score；想看商品明细 → --mode goods
```

### W2：找出该推的商品

```
① 调 shop.mjs --mode goods           → 每商品 销量/价格带/状态
② 按销量降序 = 当前主力款
③ 结合 douyin-promo --mode goods 看推广花费/GMV，算真实 ROI
```

### W3：店铺健康度巡检

```
① 调 shop.mjs --mode score           → 体验分（低了会影响流量与活动报名）
② 调 shop.mjs --mode overview        → 商品供给（在售少了要补品）
③ 调 douyin-goods --mode overview    → 商品总览交叉验证
④ 调 douyin-promo --mode overview    → 推广状态/余额（停了要恢复）
```

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定抖音小店账号 | `not_bound` | 引导到「账号连接」添加**抖店**账号（platform=`douyin_shop`） |
| 平台有多个账号且未指定 | `need_account_choice` | 把候选账号列表给用户选，把选定 shopKey 填进 `--account` 重调；★ 不要自己挑一个 |
| 登录态失效（跳 `/login/common`） | `token_expired` | 引导到「账号连接」重新登录抖店 |
| 浏览器 profile 被占用 | `api_error` | 稍后重试，或先关闭已弹出的抖店后台窗口 |
| 未知 mode | `api_error` | 用 overview/score/goods 之一 |
| 返回空数据 | — | 新店无数据属正常（不是故障） |

## 技术说明

### 取数方式

抖店后台在 `fxg.jinritemai.com`，接口签名由页面 JS 运行时生成
（`a_bogus` / `msToken` / `verifyFp` / `_bid` / `_lid`），纯 HTTP 请求恒被拒，
故采用「**打开页面 → hook 页面自己发的响应**」（`Network.responseReceived` +
`Network.getResponseBody`）取数，与 `douyin-works` 同源思路。

**不要试图自己在页面里 fetch 这些接口**——实测 `/product/tproduct/list`
直接 fetch 返回 `st=10031`（签名/参数不匹配），只有页面自身发出的请求才带正确签名。

### 接口（已实测回填）

| 用途 | 接口 path | 页面路由 |
|------|-----------|----------|
| 经营首页 | `/pc/api/home/homepage` | `/ffa/mshop/homepage/index` |
| 店铺指标 | `/byteshop/shop_util/mertrics` | 同上 |
| **体验分总览** | `/governance/shop/experiencescore/getOverviewV10` | `/ffa/eco/experience-score` |
| 体验分趋势 | `/governance/shop/experiencescore/getTrendByVersion` | 同上 |
| 体验分子项 | `/governance/shop/experiencescore/getSubScoreMetricsV10` | 同上 |
| 商品列表 | `/product/tproduct/list` | `/ffa/g/list` |
| 商品计数 | `/product/tproduct/aggsProductCount` | 同上 |

### 抖店响应体与判据

```json
{ "st": 0, "msg": "", "code": 0, "data": { } }
```

**成功判据 `st === 0`**（抖店域）。千川域（`qianchuan.jinritemai.com`）判据是
`status_code === 0`，两套不同，代码里已分别处理。

### 关键字段结构

体验分（`getOverviewV10`）：

```
data.grow_score_info.grow_shop_score                        当前体验分
data.grow_score_info.grow_score_yesterday_info.grow_score_yesterday   昨日分
data.grow_score_info.shop_open_days                         开店天数
data.category                                              经营类目
data.done_info.done_date                                    数据日期
```

体验分子项（`getSubScoreMetricsV10`）：

```
data.shop_name / data.category / data.shop_order_latest_30_cnt
data.grow_score_metric_info.grow_score_metrics[]
  ├ experience_node        指标节点 ID
  ├ title                  指标名（如「商品差评数」「平均揽收时长」）
  ├ value.value_figure     数值
  ├ value.value_type       数值类型（3=小数，7=整数…）
  ├ value.decimal_places   小数位
  └ metric_out_standard    达标标准
```

商品（`/product/tproduct/list` 的 `data[]`）：

```
product_id       19 位字符串 ID
name / img       标题 / 主图
sell_num         销量
price_lower / price_higher   SKU 价格带，**单位是分**
status / check_status       商品状态 / 审核状态
first_cid / second_cid / third_cid   类目
```

商品计数（`aggsProductCount` 的 `data`）：

```
{ onsale, draft, audit, forbidden, unpass, sell_out_new }
```

### 与拼多多那套的差异

| 维度 | 拼多多 sycm | 抖店 |
|---|---|---|
| 成功判据 | `errorCode===1000000 \|\| success===true` | `st===0`（千川 `status_code===0`） |
| 数字混淆 | 有 PUA 私用区字符，需现场解码 | **无混淆** |
| 金额单位 | 元 | **分**（已换算为元输出） |
| 商品 ID | 数字 | 字符串 |
| 分页 | `page` 从 1 起 | `page` 从 0 起 + `pageSize` |
| 取数域 | 单一 `mms.pinduoduo.com` | 抖店 `fxg.` + 千川 `qianchuan.` 两域 |

完整探测记录见 `skills/_douyin_probe/API-FINDINGS.md`。

### 浏览器环境

- `profileDir('douyin_shop', shopKey)` 定位账号独立 profile（与内容平台 `douyin` 分开）；
- `tryAcquireProfile` / `releaseProfile` / `clearProfileLocks` 保证同一账号
  不会并发起两个浏览器；
- `headless: false` + `--no-sandbox --disable-blink-features=AutomationControlled`
  保持与 `douyin-works` 一致的反检测配置。
