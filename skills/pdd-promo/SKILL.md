---
name: pdd-promo
description: "拼多多推广数据、推广诊断与推广操作：读——推广总览（资金账户/日消耗/广告组/场景）、商品维度报表（每商品花费/GMV/订单/ROI/点击/CTR/收藏）、推广单元列表、**推广诊断（出价竞争力/排名/建议出价/竞争力下滑/创意素材/排名过低）**、**推广平衡分析（打分 + 该加价/该降价/该保持 + 预算重分配）**；写（L2）——创建推广、暂停/开启推广、删除推广、改日限额、改投产比。触发：拼多多推广、推广数据、推广报表、商品推广数据、广告组、推广单元、推广计划、消耗、ROI、**推广诊断、优化建议、出价建议、竞争力、排名、推广平衡、该加价还是降价、预算分配**、开启推广、暂停推广、删除推广、创建推广、投产比、拼多多招财、pdd promo。排除：拼多多商品上架（用 pdd-publish-http）、商品查询/下架（用 pdd-works）、商品采集（用 pdd-crawl）。需绑定「拼多多商家后台」账号。"
metadata:
  builtin_skill_version: "1.5"
  dsagent:
    display_name: "拼多多·推广数据与诊断"
    emoji: "📊"
    requires: {}
---

# 拼多多 · 推广数据与操作

> **读模式**（overview/groups/cost/goods/units）无任何平台副作用。
> **写模式**（pause/resume/delete/create）是**不可撤销的真实操作（L2）**：必须两步走——
> 先不带 `--confirm` 拿预览给用户看，用户**明确同意**后才真正执行。

## 何时使用

- 用户说「拼多多推广数据」「推广报表」「今天花了多少钱」→ 用本技能
- 要看**推广计划**（广告组）表现 → `groups` 模式
- 要看**账户余额/日消耗** → `overview` 模式
- 要看**每个商品的推广数据**（花费/GMV/ROI/点击）→ **`goods` 模式**
- 要判断「哪个商品投得值」→ `goods` 模式 + 按 ROI 排序

## 能力

| 模式 | 类型 | 说明 |
|------|------|------|
| `overview` | 只读 | 推广总览：资金账户（余额/可用）+ 近几日消耗 + 广告组 + 场景投放（默认） |
| `groups` | 只读 | 广告组（推广计划）列表 |
| `cost` | 只读 | 每日消耗明细（`getAdvertiserDailyCosts`） |
| `goods` | 只读 | **商品维度报表**（`poseidon/api/report/queryEntityReport`）：每商品 花费/GMV/订单/ROI/点击/CTR/收藏 |
| `units` | 只读 | 推广单元列表（`goods/promotion/v3/list`：adInfos + totalAdNum） |
| **`diagnose`** | **只读** | **★ 推广诊断**（`smartTool/diagnosis/queryStableCostAdDiagnosis`）：5 类诊断模块 — 出价竞争力/投放状态/竞争力下滑/创意素材/排名过低；含竞争等级、排名、建议出价、效果预估 |
| **`balance`** | **只读** | **★ 推广平衡分析**：用诊断数据打分（0~100），输出「该加价/该降价/该保持」+ 预算重分配建议 |
| `pause` | **L2 写** | 暂停推广单元（`venus/api/global/unit/batchUpdateStatus`，`adStatus:2`） |
| `resume` | **L2 写** | 开启推广单元（同接口，`adStatus:1`） |
| `delete` | **L2 写** | 删除商品推广（`venus/api/goods/promotion/virtual/delete`） |
| `create` | **L2 写** | 创建商品推广（`venus/api/promotion/batchCreate`，稳定成本推广） |
| `maxcost` | **L2 写** | 改日限额（`venus/api/goods/promotion/update/max/cost`，`{adId, maxCost}`，分；0=不限） |
| `roi` | **L2 写** | 改投产比/出价（`venus/api/promotion/batchUpdateBid`，`{adIdList, bid, bidType}`） |

## `diagnose` / `balance` 详解（2026-10-23 逆向）

### 入口机制（关键）

诊断接口**只在打开抽屉时才发**：

```
https://yingxiao.pinduoduo.com/goods/promotion/list?adId=<推广ID>&drawerTab=promoteDiagnosis
```

所以 `diagnose` / `balance` 模式会：
1. 先从 `goods/promotion/v3/list` 拿全部 `adId`
2. 逐个打开诊断抽屉 URL（受 `--limit` 限制，默认 10）
3. 从页面内 hook 的 XHR 缓冲里捞 `queryStableCostAdDiagnosis` 响应

> ⚠️ **绝不能主动 fetch 调接口** —— 实测主动补发全部返回 `54001` + `verifyAuthToken`。
> 只能被动截获页面自己发的请求（hook `XMLHttpRequest` 的 `load` 事件）。

### 5 类诊断模块（moduleType）

| moduleType | 模块 | 关键字段 |
|-----------|------|---------|
| 1 | 出价竞争力 | `competitionLevel` `rank` `suggestBid` `alertType` `effectPredict` |
| 2 | 投放状态 | `rank` `competitionLevel` `suggestionType` |
| 3 | 竞争力下滑 | `rank` `labelType=4` `referenceDays` |
| 4 | 创意素材 | `creativeLabelType` |
| 5 | 排名过低 | `rank` `labelType=7` |

### balance 打分算法

```
基础分（缺失项权重并入其它）：
  出价竞争力 45%   competitionLevel 1~10 → 0~100
  排名       35%   rank 1~100 → 反向 0~100
  损失       15%   trafficLoss/orderLoss（越小越好）
  素材        5%   creativeLabelType

扣分项（直接减）：
  labelType=4（竞争力下滑）  −20
  labelType=7（排名过低）    −15

动作判定：
  ≥70       ✅ 保持现状
  50~69     ⚠️ 微调（有建议价则给出）
  <50 + alertType=21 + 有建议价  🔼 加价到建议价
  <50 + 有 labelType 4/7         🔽 降价/止损
  无投放                          ➕ 可开新推广
```

### 用法示例

```bash
# 诊断全部（默认最多 10 个）
node scripts/promo.mjs --mode diagnose

# 只诊断指定推广单元
node scripts/promo.mjs --mode diagnose --ad-id 9451903287

# 平衡分析（按动作分组 + 预算重分配建议）
node scripts/promo.mjs --mode balance --limit 20
```

### 实跑输出样例

```
推广诊断（2 个推广单元）：
  1. [9451903289] 一次性纸杯带盖咖啡纸杯子 | ⚠️ 微调 总分64
     依据：竞争等级 7/10；排名 31/100
  2. [9451903287] 咖啡杯纸杯一次性带盖卡通 | ✅ 保持 总分73
     依据：竞争等级 10/10；排名 10/100

推广平衡分析（4 个推广单元）：
⚠️ 建议微调（1 个）
  · [9451903289] 一次性纸杯带盖咖啡纸杯子 | 总分68
      竞争等级 7/10；排名 31/100
✅ 保持现状（3 个）
  · [9451903287] 咖啡杯纸杯一次性带盖卡通 | 总分96
      竞争等级 10/10；排名 10/100
💡 当前推广结构健康，无需大调整
```

## 前置条件

1. **账号已绑定**：「账号连接」页已绑定**拼多多商家后台**（mms.pinduoduo.com）。
2. **登录态有效**：失效时技能会返回 `token_expired`，引导用户重新登录。
3. **Chrome 可用**（推广域 `yingxiao.pinduoduo.com` 的签名模块需要页面环境）。
4. **有推广才有数据**：没开推广的店铺接口返回空列表，属正常。

## 输入

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `--mode` | string | 否 | overview(默认) / groups / cost / goods / units / pause / resume / delete / create |
| `--goods-id` | number | 条件 | goods/delete/create 模式必填 |
| `--unit-id` | number | 条件 | pause/resume 模式必填（从 `units` 模式的 `adId` 取） |
| `--unit-id` | number | 条件 | pause/resume/maxcost/roi 模式必填（从 `units` 模式的 `adId` 取） |
| `--max-cost` | string | 条件 | maxcost 模式必填：日限额（元），或 `unlimited`/`0` = 不限 |
| `--roi` | number | 条件 | roi 模式必填：投产比（如 3 = 投 1 元赚 3 元） |
| `--days` | number | 否 | 统计窗口天数，默认 7，上限 90 |
| `--confirm` | flag | 条件 | **写操作必须带 true**；省略只返回预览（L2 门禁） |
| `--account` | string | 否 | 账号 shopKey；多账号未绑定时先向用户确认 |

## 输出

| 字段 | 含义 |
|------|------|
| `ok` | 是否成功 |
| `mode` | 实际执行的模式 |
| `groups` | 广告组数组（id/name/展现/点击/消耗/ROI） |
| `account` | overview 模式：`{balance, dailyCost}` |
| `dailyCost` | 日消耗明细 |
| `text` | 面向用户的中文文案，原样转述 |

## 用法

```bash
# 推广总览
node {baseDir}/scripts/promo.mjs --mode overview

# 广告组列表
node {baseDir}/scripts/promo.mjs --mode groups

# 日消耗
node {baseDir}/scripts/promo.mjs --mode cost --days 7

# 商品推广报表
node {baseDir}/scripts/promo.mjs --mode goods

# 推广单元列表
node {baseDir}/scripts/promo.mjs --mode units

# ── 写操作（L2，两步走）──
# 第一步：预览（不执行）
node {baseDir}/scripts/promo.mjs --mode pause --unit-id 123456
# 第二步：用户同意后执行
node {baseDir}/scripts/promo.mjs --mode pause --unit-id 123456 --confirm true

# 改日限额 / 改投产比
node {baseDir}/scripts/promo.mjs --mode maxcost --unit-id 123456 --max-cost 200 --confirm true
node {baseDir}/scripts/promo.mjs --mode maxcost --unit-id 123456 --max-cost unlimited --confirm true
node {baseDir}/scripts/promo.mjs --mode roi --unit-id 123456 --roi 3 --confirm true

# 创建推广 / 删除推广
node {baseDir}/scripts/promo.mjs --mode create --goods-id 1018993401073 --confirm true
node {baseDir}/scripts/promo.mjs --mode delete --goods-id 1018993401073 --confirm true
```

## 推广操作（L2）—— 实测状态

| 模式 | 接口 | Body | 实测 |
|------|------|------|------|
| `maxcost` | `POST venus/api/goods/promotion/update/max/cost` | `{adId, maxCost:{value, unitCode:1}}` | ✅ **成功**（改 300 元已验证，detail 回查生效） |
| `pause` | `POST venus/api/global/unit/batchUpdateStatus` | `{adIdList:[id], dataOperateStatus:2}` | ✅ **成功**（successList 返回 adId） |
| `resume` | 同上 | `{adIdList:[id], dataOperateStatus:1}` | ✅ **成功** |
| `create` | `POST venus/api/promotion/batchCreate` | `{adInfoList:[{goodsId, maxCost:{...}, bidType:1, targetRoi:{...}}]}` | ✅ 接口通（本店每商品已有推广，返回"已达系统上限"） |
| `roi` | `POST venus/api/promotion/batchUpdateBid` | `{adIdList:[id], targetRoi:{...}, bidType:1}` | ⚠️ 签名过但参数未定（返回"不能为空"） |
| `delete` | `POST venus/api/goods/promotion/virtual/delete` | `{goodsId, adId, planId}` | ⚠️ 参数结构对（返回"不支持删除广告"——稳定成本推广不可删） |

**踩坑记录**（都已修正进代码）：
- `unit/batchUpdateStatus` 的参数字段名是 **`dataOperateStatus`**（不是 operateStatus/adStatus）
- `update/max/cost` 的 `maxCost` 是 **对象** `{value, unitCode}`（元），不是分
- `virtual/delete` 需 **三参** `{goodsId, adId, planId}`
- `batchCreate` 的 body 是 **`adInfoList` 数组**（不是扁平 goodsId）
- ROI 的合法区间在 `detail/query` 的 `suggestLimitInfo.minValue~maxValue`（本店 1.00~3.65）
- 本店推广类型是「稳定成本推广」：**只能暂停，不能删除**（平台设计）
- **签名机制**：yingxiao 要 `Anti-Content` 请求头，且值 == `body.crawlerInfo`（同一个 token）；
  导航前注入 XHR hook 捕获页面自己发的配对，复用自己的请求即可过风控

## 工作流

### W1：看每个商品的推广数据（最常用）

```
① 调 promo.mjs --mode goods           → 商品维度报表（entityReportList）
② 每个商品：花费 / GMV / 订单 / ROI / 点击 / 展现 / CTR / 收藏
③ 按 ROI 降序找高效商品，按花费降序找烧钱商品
④ 结合 pdd-works 的 detail 看该商品 SKU，判断是否继续投
```

### W2：看今天推广花了多少钱

```
① 调 promo.mjs --mode overview        → 资金账户 + 日消耗 + 广告组概览
② 把 text 原样转述用户（余额/消耗/组数）
③ 用户想看某个组明细 → --mode groups 看展现/点击/ROI
```

### W3：复盘推广效果

```
① 调 promo.mjs --mode goods           → 商品维度全量数据
② 调 promo.mjs --mode groups          → 广告组维度
③ 调 promo.mjs --mode cost --days 7   → 7 日消耗趋势
④ 三个维度交叉：钱花在哪个组 → 组推哪个商品 → 商品产出多少 GMV
```

## 输出字段（goods 模式）

| 字段 | 含义 |
|------|------|
| `goodsReport.total` | 有推广数据的商品总数 |
| `goodsReport.items[]` | 每商品：`goodsId / goodsName / spend(花费) / gmv / orderNum(订单) / roi / click / impression / ctr` |
| `goodsReport.sum` | 周期汇总：`spend / gmv / netGmv(净GMV) / orderNum / roi / click / impression / ctr / fav(收藏)` |

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定商家后台账号 | `not_bound` | 引导到「账号连接」添加**拼多多商家后台**账号 |
| 登录态失效 | `token_expired` | 引导到「账号连接」重新登录 |
| 未知 mode | `api_error` | 用 overview/groups/cost/goods/units/pause/resume/delete/create/maxcost/roi 之一 |
| 返回空列表 | — | 店铺未开推广，属正常（不是故障） |
| 写操作未带 confirm | `needConfirm` | L2 门禁：把 text 给用户看并征得同意后带 `--confirm true` 重试 |
| 写操作失败 | `api_error` | 看返回的错误码；54001=会话绑定被拦，引导后台手动操作 |

## 技术说明

推广在独立子域 `yingxiao.pinduoduo.com`，接口统一走 `/mms-gateway/` 前缀。

**关键发现**：该域的风控签名（`Anti-Content` 头）与 mms 域**不同源**——
自己发 `fetch` 即使带上 mms 的 Anti-Content + 真 `crawlerInfo`，仍返回 `54001`。
故本技能采用「**hook 页面自己发的响应**」模式：依次打开推广各页 → 页面自己发数据请求 →
CDP 拦响应 → 解析。这与 `pdd-publish-http` 的「页面会话 + 拦截改包」是同源思路。

**商品维度核心接口**：

| 接口 | 用途 |
|------|------|
| `poseidon/api/report/queryEntityReport` | **商品维度报表**（entityReportList：每商品花费/GMV/ROI/点击…） |
| `poseidon/api/report/queryRangeReport` | 周期汇总（sumReport） |
| `poseidon/report/queryReportCustomConfig` | 报表列配置（可选指标全集） |
