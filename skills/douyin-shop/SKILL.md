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
| `overview` | 店铺经营总览：等级 + 流量 + 今日/昨日商品数据 + 成交金额最高商品（默认） |
| `flow` | 店铺流量：访客 uv / 浏览量 pv / 成交金额 / 成交订单 |
| `score` | 店铺体验分（服务数据）：商品体验 / 物流体验 / 服务体验 / 综合体验分 |
| `goods` | 商品数据明细：每商品 访客/成交金额/成交订单/转化率 |

## 前置条件

1. **账号已绑定**：「账号连接」页已绑定**抖音小店**账号（抖店后台 `fxg.jinritemai.com`）。
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
| `shop` | 店铺基础信息（名称/等级）——**待探测回填** |
| `flow` | `{uv, pv, payAmt, payCnt}` 店铺流量结构——**待探测回填** |
| `score` | 体验分原始结构（`{product, logistics, service, total}`）——**待探测回填** |
| `goodsOverview` | 今日/昨日商品数据总览——**待探测回填** |
| `goods` / `items` | 商品明细数组（id/name/uv/payAmt/payCnt/vcr）——**待探测回填** |
| `text` | 面向用户的中文文案，原样转述 |

## 用法

```bash
# 店铺经营总览
node {baseDir}/scripts/shop.mjs --mode overview

# 店铺流量
node {baseDir}/scripts/shop.mjs --mode flow

# 店铺体验分
node {baseDir}/scripts/shop.mjs --mode score

# 商品数据明细（按成交金额排序看哪个卖得好）
node {baseDir}/scripts/shop.mjs --mode goods --limit 30
```

## 工作流

### W1：看今天店铺怎么样

```
① 调 shop.mjs --mode overview        → 等级 + 访客 + 今日/昨日成交
② 把 text 原样转述用户
③ 用户想看流量细节 → --mode flow；想看哪个商品卖得好 → --mode goods
```

### W2：找出该推的商品

```
① 调 shop.mjs --mode goods           → 每商品 访客/成交金额/转化率
② 按成交金额降序 = 当前主力款
③ 按转化率降序 = 有潜力但流量少的款（适合投千川）
④ 结合 douyin-promo --mode goods 看推广花费/GMV，算真实 ROI
```

### W3：店铺健康度巡检

```
① 调 shop.mjs --mode score           → 体验分（低了会影响流量与活动报名）
② 调 shop.mjs --mode flow            → 访客趋势（跌了要引流）
③ 调 douyin-goods --mode overview    → 在售商品数（少了要补品）
④ 调 douyin-promo --mode overview    → 推广状态/余额（停了要恢复）
```

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定抖音小店账号 | `not_bound` | 引导到「账号连接」添加**抖音小店**账号 |
| 平台有多个账号且未指定 | `need_account_choice` | 把候选账号列表给用户选，把选定 shopKey 填进 `--account` 重调；★ 不要自己挑一个 |
| 登录态失效 | `token_expired` | 引导到「账号连接」重新登录 |
| 浏览器 profile 被占用 | `api_error` | 稍后重试，或先关闭已弹出的抖店后台窗口 |
| 接口未回填（当前为桩） | `api_error` | 先跑 `_douyin_probe` 探测脚本，把真实接口回填进 APIS 常量 |
| 未知 mode | `api_error` | 用 overview/flow/score/goods 之一 |
| 返回空数据 | — | 新店无流量属正常（不是故障） |

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
| 店铺经营总览 | **待探测回填** | ⏳ 未回填 |
| 店铺流量（访客/浏览/成交） | **待探测回填** | ⏳ 未回填 |
| 店铺体验分 | **待探测回填** | ⏳ 未回填 |
| 商品数据明细 | **待探测回填** | ⏳ 未回填 |

> ⚠️ **当前是桩实现**：`scripts/shop.mjs` 里的 `APIS` 常量只有占位 key，
> 尚未回填真实接口 path。在回填前，脚本会明确返回
> `{ok:false, failureKind:'api_error', text:'接口待回填：先跑探测脚本'}`，
> **不会伪造成功数据**。

### 回填方法

1. 跑 `node skills/_douyin_probe/probe.mjs`，打开抖店后台各页面采集接口；
2. 从 `probe-out/hits-*.json` 里按响应内容定位目标接口；
3. 把接口 path 片段填进 `scripts/shop.mjs` 的 `APIS` 常量，并删掉桩判断。

### 浏览器环境

- `profileDir('douyin', shopKey)` 定位账号独立 profile；
- `tryAcquireProfile` / `releaseProfile` / `clearProfileLocks` 保证同一账号
  不会并发起两个浏览器；
- `headless: false` + `--no-sandbox --disable-blink-features=AutomationControlled`
  保持与 `douyin-works` 一致的反检测配置。
