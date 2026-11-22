---
name: douyin-promo
description: "抖音·千川推广数据（只读）：推广总览（余额/在投计划/千川账户/ROI限制）、余额明细（按账户类型分组）、在投计划列表、消耗层级、推广报表（statQuery）。数据源：千川后台 qianchuan.jinritemai.com。纯 Node 直连（千川只读免签），无平台副作用。触发：千川、巨量千川、抖音推广、推广数据、推广报表、推广余额、推广计划、ROI、douyin promo。排除：全域投放报表/素材分析（用 douyin-uni-prom）、计划启停（用 douyin-plan-ops）、商品（douyin-goods）、订单（douyin-order）、店铺经营（douyin-shop）。需绑定「抖音小店」账号。"
metadata:
  builtin_skill_version: "2.0"
  dsagent:
    display_name: "抖音·千川推广"
    emoji: "📣"
    requires: {}
---

# 抖音 · 千川推广数据

> **只读技能**：所有操作均为查询，**不产生任何平台写操作**，无需 L2 确认。
>
> **写操作不实现**：暂停/开启/改日限额/改投产比/建计划/删除，调用会明确拒绝。

## ★ 2026-11-11 改造

> ### ⚠️ 推翻旧结论
>
> ~~「千川接口带 verifyFp/fp 签名，手工 fetch 必被拒，必须 hook 页面响应」~~
>
> **错的。** 同一接口三种方式实测：
> ```
> 带 a_bogus+verifyFp+fp+msToken  → code=0  789B  ✅
> 剥净签名                        → code=0  789B  ✅
> 完全手工零参数                  → code=0  789B  ✅
> ```
> 旧文档说的「40002」实际是**业务参数缺失**，不是签名问题。
>
> **现在纯 Node**：`overview` 15~20s → **1.8s**，`balance` → **542ms**。

### 与 douyin-uni-prom 的分工

| 技能 | 侧重 | 主要接口 |
|---|---|---|
| **douyin-promo**（本技能） | **账户侧**：还能不能投 | 余额 / 消耗层级 / 客户主体 / ROI限制 / 在投计划（`/ad/ocean/*`） |
| `douyin-uni-prom` | **投放侧**：投得怎么样 | 全域投放计划汇总 / 报表 / 分析报告 / 素材 |

两者都能查余额，但 `promo` 答「账户能不能继续投」，`uni-prom` 答「投放效果如何」。

## 何时使用

- 「推广账户还有多少钱」→ `balance`
- 「有没有在投放」→ `plans`（或在 `overview` 看 `ongoingCount`）
- 「推广报表 / 花了多少」→ `report`
- 一眼看账户全貌 → `overview`

## 能力

| 模式 | 类型 | 说明 |
|------|------|------|
| `overview` | 只读 | 余额 + 在投计划数 + 千川账户 + 客户主体 + ROI限制 + 消耗层级（默认） |
| `balance` | 只读 | 余额明细，按 `advBalanceType` 分组（1/9/10/11 现金/预付/返还等） |
| `plans` | 只读 | 在投计划列表（`getOngoingPromotionList`） |
| `cost` | 只读 | 消耗层级（`GetAdvCostLevelInfo`） |
| `report` | 只读 | 报表查询（`statQuery`，需要 `advertiserId`） |
| `pause`/`resume`/`maxcost`/`roi`/`create`/`delete` | **不实现** | L2 写操作，明确拒绝 |

## 前置条件

1. **账号已绑定**：「账号连接」页已绑定**抖音小店**账号（platform=`douyin_shop`）。
2. **登录态有效**：失效返回 `token_expired`。
3. **无需 Chrome**：纯 Node 直连。
4. **有推广才有数据**：没开推广的店铺 `ongoingCount=0`、报表 0 条，属正常。

## 输入

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `--mode` | string | 否 | overview(默认) / balance / plans / cost / report |
| `--days` | number | 否 | `report` 统计窗口天数，默认 7，上限 90 |
| `--start` / `--end` | string | 否 | `report` 显式日期 `YYYY-MM-DD`，优先于 `--days` |
| `--advertiser-id` | string | 否 | `report` 用的广告主 ID；不传则自动从 customerId 接口取 `accountId` |
| `--limit` | number | 否 | 返回条数上限，默认 20，上限 100 |
| `--account` | string | 否 | 账号 shopKey |

## 输出

| 字段 | 含义 |
|------|------|
| `balance` | 主账户 `{type,total,valid,frozen}`，**已由分换算为元** |
| `balanceAll` | 全部账户类型余额数组 |
| `ongoingCount` | 在投计划数（0 = 当前没有投放，属正常） |
| `accountId` | 千川账户 ID（`1781536544329804` 这类），**报表口径用这个** |
| `customerId` | 客户 ID（`659089484` 这类，公司主体） |
| `companyName` / `companyStatus` | 客户主体名称 / 审批状态 |
| `forbidRoi` | `{isForbid,startDate,endDate,activeInWindow,note}` |
| `costLevel` | 消耗层级信息 |
| `report` | `StatsData.Totals` + `TotalCount` |
| `perf` | 各接口耗时（ms） |
| `text` | 面向用户的中文文案 |

> ⚠️ **两个 ID 别混用**：
> - `accountId` = 千川账户 ID ← **报表 `Filters.advertiser_id` 用这个**
> - `customerId` = 客户 ID（公司主体）
>
> 第一版代码把 `customerId` 当 `advertiserId`，报表口径会错。

## 用法

```bash
node {baseDir}/scripts/promo.mjs --mode overview
node {baseDir}/scripts/promo.mjs --mode balance
node {baseDir}/scripts/promo.mjs --mode plans
node {baseDir}/scripts/promo.mjs --mode cost
node {baseDir}/scripts/promo.mjs --mode report --days 30
node {baseDir}/scripts/promo.mjs --mode report --start 2026-11-01 --end 2026-11-12
```

## 工作流

### W1：账户还能不能继续投

```
① promo --mode overview   → 余额 / 在投计划数 / ROI限制是否生效
② 余额不足 → 提醒充值（`chargeInfo` 可查充值方式，见 uni-prom）
③ ROI限制生效中 → 先解决限制再建计划
④ 在投计划 0 个 → 明确告诉用户「当前没有在投放」，不要说「接口失败」
```

### W2：复盘消耗

```
① promo --mode report --days 7    → 消耗总额
② uni-prom --mode overview        → 投放效果（GMV/ROI 维度）
③ promo --mode cost               → 消耗层级是否正常
```

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定账号 | `not_bound` | 引导到「账号连接」添加抖音小店账号 |
| 多账号未指定 | `need_account_choice` | 把候选给用户选，不要自己挑 |
| 登录态失效 | `token_expired` | 引导重新登录 |
| `report` 缺 advertiserId | `bad_input` | 传 `--advertiser-id`，或先跑 `overview` |
| `code=40002` | `bad_input` | **body 缺业务参数**，不是签名问题 |
| `code=-1` / `status_code:-1` | `bad_input` | body 字段不全（如 `statQuery` 缺 `Filters.Conditions`） |
| 在投计划 0 个 / 报表 0 条 | — | 店铺未开推广，属正常 |

## 技术说明

### 取数方式

**纯 Node 直连**（2026-11-11 起）。千川只读接口免签。

### 接口

| 用途 | 接口 |
|------|------|
| 余额 | `GET /ad/api/v1/account/finance/get-adv-balance` |
| 在投计划 | `GET /ad/ocean/api/v1/promotion/getOngoingPromotionList` |
| 消耗层级 | `GET /ad/api/v1/account/agw/finance/GetAdvCostLevelInfo` |
| 客户主体 | `GET /ad/api/v1/account/account-info/get-customer-id` |
| ROI 限制 | `GET /ad/api/v1/account/getForbidRoi1AdInfo` |
| 报表 | `POST /ad/api/data/v1/common/statQuery` |

全部登记在基座 `skills/_shared/douyin-registry.mjs`（`promo.*`）。

### 已知坑

| 坑 | 现象 | 处置 |
|---|---|---|
| `isForbid:true` 不等于当前受限 | 本店横幅 2025-05 就结束了，仍返回 `true` | 比 `endDate` 与今天，或看 `activeInWindow` |
| `bannerStartTime/EndTime` 是秒级 Unix | 直接显示会变成 `1746460801` | `/1000` 后转 ISO |
| `accountId` ≠ `customerId` | 报表 `advertiser_id` 填错会返回 0 条 | 用 `accountId` |
| `statQuery` 只返回 `status_code` | 没有 `code`/`st`，按老判据会误判失败 | 基座 `classify()` 已三码并认 |
| `statQuery` 缺 `Filters.Conditions` | `status_code:-1`「请求未成功」 | 用基座 `statQueryBody()` 构造 |
| `getOngoingPromotionList` 返回 `{}` | `activitiesOfPromotion:{}` = 无在投计划 | 正常，不是故障 |
