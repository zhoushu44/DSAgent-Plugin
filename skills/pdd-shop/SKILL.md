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

<!-- RISK-CHEATSHEET:START（由 dev/inject-risk-cheatsheet.mjs 注入，请勿手改） -->

## ⚠ 风控速查（先读这里再排查）

> 完整机制与历史踩坑记录在**知识库**，遇到风控问题**先查库**：
> ```
> dsagent_wiki_search(keyword="风控")                                     # 全部风控页
> dsagent_wiki_search(path="平台/entities/拼多多风控机制与应对.md")        # 机制总览
> dsagent_wiki_search(path="平台/entities/拼多多签名注入范围（Anti-Content vs crawlerInfo）.md") # 该不该带签名
> ```

### 错误码 → 处置

| 错误码 | failureKind | 含义 | 正确处置 |
|---|---|---|---|
| `54001` | `risk_control` | 操作太过频繁（风控） | **可自愈**：清旧 token → 提新票 → 重放。失败则人工过一次滑块，通过后有 10 分钟通行证。**不要**重新登录 |
| `40002` | `rate_limit` | 高频限流（**接口级**） | **不可本地修复**，重试无效、只会延长封禁。等待冷却，或降级（如 search → feed） |
| `100001` | `rate_limit` | 活动写操作频控（请 2 小时后重试） | **不可本地修复**。等待 2 小时或换时间段 |
| `43001` | `token_expired` | 会话过期（**不是风控**） | 重新扫码登录。注意凭证库快照可能是旧票，优先用浏览器当前 Cookie |
| `40001` | `token_expired` | 未登录 | 重新扫码登录 |
| `310120000` | `reload_required` | **页面上下文失效**（403 专用码） | 官方处置是 `window.location.reload()`：重开/刷新页面后重试。**不是登录失效，不要跳登录页** |
| `40010` | `no_permission` | 无权限 | 可能是账号类型不对（需诚信通/实力商家），或换主店号 |
| `2000000` | `no_permission` | 账号不适合发布 | 权限问题，换号或到后台查违规记录 |
| `48143` | `api_error` | 非法请求 | 该接口依赖页面 SDK 的请求上下文，需让页面自己发请求（DOM 触发） |
| `3000000` | `api_error` | 参数错误或灰度未开放 | 检查入参（日期/页码/queryType 等） |
| HTTP `430` | `rate_limit` | 网关级频率惩罚（Cookie 有效） | 等 15~30s 重试。**不要**误判成 session_expired |
| `detached Frame` / `Target closed` | `risk_control` | 平台主动关掉页面 | 等 3~5 分钟再试，别连续重试 |

### 四条铁律

1. **不要把 54001 当 token_expired** —— 前者需要过一次滑块，后者才需要重新登录。误判会让用户反复登录，每次登录还刷新一次风控基线。
2. **不要重试 40002** —— 它是接口级持久限流，实测冷却 240s 零请求后仍空。
3. **不要在冷却期内连续调用** —— 拼多多按「累计行为分数」延长封禁，越打越久。
4. **分清两个签名条件，别合并** —— 平台有两套独立判断：**域名正则**（mms/ims/... 命中就带 `header Anti-Content`）+ **162 条路径白名单**（命中才在 body 里塞 `crawlerInfo`）。只要域名是 `mms.pinduoduo.com`，**头就必须带**；把「不在 162 名单」当成「不用签名」会稳定打出 54001（我已真机踩过）。判据统一用 `_shared/pdd-sign-scope.mjs` 的 `signPlan(url)`。

### 其他已知坑

- **两个登录态不通用**：`pdd`（H5 买家态，`.yangkeduo.com`）与 `pdd_mms`（商家后台态，`mms.pinduoduo.com`）是两套独立账号，各跑一套风控评分。
- **`Failed to launch the browser process!`** 大概率是 Profile 被孤儿 Chrome 占用（SingletonLock 残留），不是 Chrome 坏了。清理：`~/.dsh/pdd-account-locks` 无关，要杀占用该 Profile 的 chrome 进程 + 删 `SingletonLock`。
- **账号级并发**：两个任务同时打同一个号会显著提高被封概率，`_shared/pdd-risk.mjs` 的账号锁会拦住，看到「正被其他任务占用」就等等。
- **签名兜底字面量**：平台自己的兜底值是 `"getRisckInfoError"`（注意 `Risck` 是平台拼写）。带它发请求 = 自报「我拿不到环境指纹」，比不带更可疑。

<!-- RISK-CHEATSHEET:END -->



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
