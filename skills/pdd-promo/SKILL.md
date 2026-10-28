---
name: pdd-promo
description: "拼多多推广数据、诊断与操作：推广总览（资金/日消耗/广告组）、商品维度报表（花费/GMV/ROI/CTR）、推广单元列表、推广诊断（出价竞争力/排名/建议出价/创意素材/异常标签）、推广平衡分析（该加价/该降价/该停投 + 预算重分配）；写（L2）——创建/暂停/开启/删除推广、改日限额、改投产比。触发：拼多多推广、推广数据、推广报表、推广计划、消耗、ROI、推广诊断、优化建议、出价建议、竞争力、排名、推广平衡、预算分配、投产比、pdd promo。排除：商品上架（pdd-publish-http）、商品查询（pdd-works）、商品采集（pdd-crawl）。需绑定「拼多多商家后台」账号。"
metadata:
  builtin_skill_version: "1.6"
  dsagent:
    display_name: "拼多多·推广数据与诊断"
    emoji: "📊"
    requires: {}
---

# 拼多多 · 推广数据与操作

<!-- RISK-CHEATSHEET:START（由 dev/inject-risk-cheatsheet.mjs 注入，请勿手改） -->

## ⚠ 风控速查（先读这里再排查）

> 完整机制与历史踩坑记录在**知识库**，遇到风控问题**先查库**：
> ```
> dsagent_wiki_search(keyword="风控")            # 两页都列出来
> dsagent_wiki_search(path="平台/entities/拼多多风控机制与应对.md")
> ```

### 错误码 → 处置

| 错误码 | failureKind | 含义 | 正确处置 |
|---|---|---|---|
| `54001` | `risk_control` | 操作太过频繁（风控） | **可自愈**：清旧 token → 提新票 → 重放。失败则人工过一次滑块，通过后有 10 分钟通行证。**不要**重新登录 |
| `40002` | `rate_limit` | 高频限流（**接口级**） | **不可本地修复**，重试无效、只会延长封禁。等待冷却，或降级（如 search → feed） |
| `100001` | `rate_limit` | 活动写操作频控（请 2 小时后重试） | **不可本地修复**。等待 2 小时或换时间段 |
| `43001` | `token_expired` | 会话过期（**不是风控**） | 重新扫码登录。注意凭证库快照可能是旧票，优先用浏览器当前 Cookie |
| `40001` | `token_expired` | 未登录 | 重新扫码登录 |
| `40010` | `no_permission` | 无权限 | 可能是账号类型不对（需诚信通/实力商家），或换主店号 |
| `2000000` | `no_permission` | 账号不适合发布 | 权限问题，换号或到后台查违规记录 |
| `48143` | `api_error` | 非法请求 | 该接口依赖页面 SDK 的请求上下文，需让页面自己发请求（DOM 触发） |
| `3000000` | `api_error` | 参数错误或灰度未开放 | 检查入参（日期/页码/queryType 等） |
| HTTP `430` | `rate_limit` | 网关级频率惩罚（Cookie 有效） | 等 15~30s 重试。**不要**误判成 session_expired |
| `detached Frame` / `Target closed` | `risk_control` | 平台主动关掉页面 | 等 3~5 分钟再试，别连续重试 |

### 三条铁律

1. **不要把 54001 当 token_expired** —— 前者需要过一次滑块，后者才需要重新登录。误判会让用户反复登录，每次登录还刷新一次风控基线。
2. **不要重试 40002** —— 它是接口级持久限流，实测冷却 240s 零请求后仍空。
3. **不要在冷却期内连续调用** —— 拼多多按「累计行为分数」延长封禁，越打越久。

### 其他已知坑

- **两个登录态不通用**：`pdd`（H5 买家态，`.yangkeduo.com`）与 `pdd_mms`（商家后台态，`mms.pinduoduo.com`）是两套独立账号，各跑一套风控评分。
- **`Failed to launch the browser process!`** 大概率是 Profile 被孤儿 Chrome 占用（SingletonLock 残留），不是 Chrome 坏了。清理：`~/.dsh/pdd-account-locks` 无关，要杀占用该 Profile 的 chrome 进程 + 删 `SingletonLock`。
- **账号级并发**：两个任务同时打同一个号会显著提高被封概率，`_shared/pdd-risk.mjs` 的账号锁会拦住，看到「正被其他任务占用」就等等。

<!-- RISK-CHEATSHEET:END -->



> **读模式**（overview/groups/cost/goods/units）无任何平台副作用。
> **写模式**（pause/resume/delete/create）是**不可撤销的真实操作（L2）**：必须两步走——
> 先不带 `--confirm` 拿预览给用户看，用户**明确同意**后才真正执行。

## 何时使用

- 用户说「拼多多推广数据」「推广报表」「今天花了多少钱」→ 用本技能
- 要看**推广计划**（广告组）表现 → `groups` 模式
- 要看**账户余额/日消耗** → `overview` 模式
- 要看**每个商品的推广数据**（花费/GMV/ROI/点击）→ **`goods` 模式**
- 要判断「哪个商品投得值」→ `goods` 模式 + 按 ROI 排序
- 用户问「**平台建议**」「平台怎么说」「诊断异常」「转化过低」「曝光过低」→ `diagnose` / `balance` 模式（含 labelType 官方枚举）
- 要判断「**该加价还是降价还是停**」→ `balance` 模式（有 error 级标签会直接建议停投整改）

## 能力

| 模式 | 类型 | 说明 |
|------|------|------|
| `overview` | 只读 | 推广总览：资金账户（余额/可用）+ 近几日消耗 + 广告组 + 场景投放（默认） |
| `groups` | 只读 | 广告组（推广计划）列表 |
| `cost` | 只读 | 每日消耗明细（`getAdvertiserDailyCosts`） |
| `goods` | 只读 | **商品维度报表**（`poseidon/api/report/queryEntityReport`）：每商品 花费/GMV/订单/ROI/点击/CTR/收藏 |
| `units` | 只读 | 推广单元列表（`goods/promotion/v3/list`：adInfos + totalAdNum） |
| **`auto`** | **L2 写** | **★ 自动化调参**：按速率倍数 + 保本线分阶段调整。默认 dry-run 只出计划，`--confirm true` 才执行。前期（倍数≥1.2→限额×1.2/投产+0.2/5次/90分间隔）、后期（倍数≥1.2→限额×1.1/投产+0.1/1次）+ 4 条刹车 |
| **`rates`** | **只读** | **全店速率表**：所有在投单元的 设置速率/真实速率/倍数/今日花费/日限额 |
| **`item`** | **只读** | **★ 单品推广诊断**（2026-10-28 新增）：一屏结论 + 商品数据 + 单元配置 + **烧钱速率（当天速率/速率比/预计烧完时间/近 7 天柱状图）** + 平台 labelType 标签 + 提醒 + 调参命令。入参 `--goods-id` 或 `--ad-id` |
| **`diagnose`** | **只读** | **★ 推广诊断**（`smartTool/diagnosis/queryStableCostAdDiagnosis`）：5 类诊断模块 — 出价竞争力/投放状态/竞争力下滑/创意素材/排名过低；含竞争等级、排名、建议出价、效果预估；**+ 平台 labelType 异常标签（10 种官方枚举，1/4/7 为 error 级）+ 平台官方原文** |
| **`balance`** | **只读** | **★ 推广平衡分析**：一屏结论（健康度 + 最该做什么）+ 诊断打分（0~100）+ 「该加价/该降价/**该停投整改**」+ 预算重分配 + 平台建议汇总 |
| `pause` | **L2 写** | 暂停推广单元（`venus/api/global/unit/batchUpdateStatus`，`adStatus:2`） |
| `resume` | **L2 写** | 开启推广单元（同接口，`adStatus:1`） |
| `delete` | **L2 写** | 删除商品推广（`venus/api/goods/promotion/virtual/delete`） |
| `create` | **L2 写** | 创建商品推广（`venus/api/promotion/batchCreate`，稳定成本推广） |
| `maxcost` | **L2 写** | 改日限额（`venus/api/goods/promotion/update/max/cost`，`{adId, maxCost}`，分；0=不限） |
| `roi` | **L2 写** | 改投产比/出价（`venus/api/promotion/batchUpdateBid`，`{adIdList, bid, bidType}`） |

## `goods-images` / `creative`（2026-10-24 逆向）

### goods-images：商品图 + 推广数据

**单接口拿全部**：hook 页面的 `POST /mms-gateway/venus/api/goods/promotion/v3/list`，
`result.adInfos[]` 每条已内嵌：

```
goodsInfo   → thumbUrl / goodsId / goodsName / catId / minOnSaleGroupPrice
reportInfo  → impression / click / ctr / cvr / spend / gmv / roi / orderNum ...（★ 指标在这里，不在顶层）
maxCostSuggestVO / suggestLimitInfo / bidAlertInfo → 出价建议
```

```bash
node scripts/images.mjs --mode goods-images --limit 20
```

### creative：创意图（多图）数据

**需要权限**：`hasCustomCreativePrivilege` / `hasMallCustomCreativePrivilege` 为 `true`。

实测爱绿森店铺：40 个推广单元这两个字段**全为 null**（稳定成本推广，
平台自动选素材，没有手动创意图）。

```bash
node scripts/images.mjs --mode creative
# 无权限时明确提示 + 列出接口清单
```

### 已定位的创意图接口（权限开通后可用）

```
/mms-gateway/star/promotion/unitCreative/list                       ★ 单元创意列表
/mms-gateway/goodsPromotionQuery/list/v3/creativeJoinReportRefined  ★ 创意加入报表
/mms-gateway/goodsPromotionQuery/queryCustomCreativeImage           ★ 自定义创意图
/mms-gateway/venus/api/raw/material/list                            ★ 素材列表
/mms-gateway/venus/api/raw/material/create                          创建素材
/mms-gateway/venus/api/raw/material/delete                          删除素材
/mms-gateway/ryze/creative/queryAvailableCreativeTitles             可用创意标题
/mms-gateway/venus/api/goods/promotion/query/availableCreativeTitle 可用创意标题
/mms-gateway/star/unitCreative/create                               建创意
/mms-gateway/star/unitCreative/creative/create                      创意内建
/mms-gateway/star/unitCreative/creative/edit                        创意编辑
/mms-gateway/star/unitCreative/edit                                 编辑
/mms-gateway/starmall/unitCreative/delete                           删创意
/mms-gateway/starmall/creative/delete                               删创意
/mms-gateway/starmall/unit/editCreativeSmartChoice                  智能优选切换
/mms-gateway/venus/api/goods/promotion/update/creativeV2            更新创意
/mms-gateway/audit/appeal/queryAuditRejectedCreative                审核驳回创意
```

**这些接口主动 fetch 全部 54001**（要签名），只能被动 hook 页面自己发的请求。

详见知识库「拼多多推广创意图逆向」。

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

> ⚠️ **moduleType 3/5 的名字有误导性**。它们不是「模块名」那种分类，而是**平台异常标签的挂载点**：
> `mt=3` 挂的是**曝光**类标签，`mt=5` 挂的是**转化**类标签。详见下面 labelType 一节。

### ★ labelType 官方枚举（2026-10-27 从前端 bundle 实证）

**来源**：`yingxiao.pinduoduo.com/goods/promotion/list` 页面
`static.pddpic.com/ad-static/mains/_next/static/chunks/pages/goods/promotion/list-*.js`
（枚举对象 `eO` + 中文映射表 `sB` + 各 labelType 的渲染文案）

| labelType | key | 中文名 | 级别 | 平台官方文案 |
|---|---|---|---|---|
| 1 | `tooLow` | 出价过低 | 🔴 error | 当前推广近 {days} 天综合出价设置过低，低于 {rank}% 相似推广 |
| 2 | `bidDecline` | 近期降价 | 🟡 warning | 近期推广存在降低出价操作，不利于稳定投放 |
| 3 | `bidCompetitionDecline` | 出价竞争力下滑 | 🟡 warning | 近期推广出价竞争力下滑，不利于流量竞争 |
| 4 | `impressionLow` | 曝光过低 | 🔴 error | 当前推广近 {days} 天综合曝光量过低，低于 {rank}% 相似推广 |
| 5 | `impressionDecline` | 曝光掉量 | 🟡 warning | 近期推广曝光下滑 |
| 6 | `impressionCompetitionDecline` | 曝光竞争力下滑 | 🟡 warning | 近期推广曝光竞争力下滑 |
| 7 | `conversionLow` | 转化过低 | 🔴 error | 当前推广近 {days} 天综合订单获取能力过差，低于 {rank}% 相似推广 |
| 8 | `conversionDecline` | 转化掉量 | 🟡 warning | 近期推广存在成交下滑趋势 |
| 9 | `conversionCompetitionDecline` | 转化竞争力下滑 | 🟡 warning | 近期推广转化竞争力下滑 |
| 10 | `stage2Difficult` | 进入二阶段困难 | 🟡 warning | 推广长期在一阶段，进入二阶段存在困难 |

**两组规律**：
- **「过低」= 1/4/7** —— 当期**绝对水平**不达标，error 级
- **「下滑」= 3/6/9** —— 相对同行在**退步**，warning 级

**`referenceDays` 是统计窗口（回看 N 天），不是「已连续低 N 天」**（实测 8 单元全部为 3）。

#### ⚠️ labelType 的读取路径（踩过坑）

labelType **不在诊断模块顶层**，`m.exceptionLabelList` 实测 8 单元 35 模块**全是空数组**。
真实位置在**第三层竞争力 VO 内部**，绑定关系零例外：

```
moduleType=1（出价竞争力） → bidCompetitiveness.exceptionLabelList[]
moduleType=3（竞争力下滑） → exposureCompetitiveness.exceptionLabelList[]
moduleType=5（排名过低）   → conversionCompetitive.exceptionLabelList[]
```

#### ⚠️ 平台诊断的盲区（重要）

平台只看**竞价维度**，看不到商品详情页承接能力：

| 平台说 | 实际含义 | 正确处置 |
|---|---|---|
| 「排名低」→ 喊提价 | 可能商品转化率根本不达标 | 先查 `pdd-shop --mode goods` 的转化率 vs 类目均值 |
| 「转化过低(7) error」 | 根因通常在商品侧（详情页/价格/规格/评价） | **提价治不了**，先停投或整改商品 |
| 「转化竞争力下滑(9) warning」 | 相对同行退步，可能是同行在优化 | 可观察，改素材/出价 |

**实测案例**：爱绿森单元 `9451903287` 出价竞争力 9/10、创意素材 8/10（双优），
但转化过低 rank 100（低于 100% 相似推广）。平台自己的打分体系仍可能给高分，
所以**必须交叉商品侧转化率**再决定动不动。

### balance 打分算法（2026-10-27 修正）

```
基础分（缺失项权重并入其它）：
  出价竞争力 45%   competitionLevel 1~10 → 0~100
  排名       35%   rank 1~100 → 反向 0~100
  损失       15%   trafficLoss/orderLoss（越小越好）
  素材        5%   creativeLabelType

扣分项（按平台 level 分级，2026-10-27 改）：
  error 级 label（1 出价过低 / 4 曝光过低 / 7 转化过低）  −30 / 个
  warning 级 label（2/3/5/6/8/9/10）                      −12 / 个

动作判定（fix 优先级最高）：
  有 error 级 label          ⛔ 停投/整改（加钱治不了，先停或改商品）
  ≥70 且无 error 级          ✅ 保持现状
  50~69                      ⚠️ 微调（有建议价则给出，小步 5~10%）
  <50 + alertType=21 + 有建议价  🔼 加价到建议价
  <50 + 有 warning           🔽 降价/止损
  无投放                      ➕ 可开新推广
```

> **为什么把 error 级扣分从 20/15 提到 30**：
> 旧算法下 `9451903287`（出价 9/10 + 素材 8/10，转化 rank 100）得 **88 分判「✅保持」**，
> 实际它是全店转化垫底的单元。高分模块不能掩盖 error 级异常。

### 用法示例

```bash
# ★ 单品推广诊断（最常用，配合「一个品一个店一起跑」打法）
node scripts/promo.mjs --mode item --goods-id 816543902441
node scripts/promo.mjs --mode item --ad-id 8391433818

# 换目标烧完时间（默认 18:00）
node scripts/promo.mjs --mode item --ad-id 8391433818 --target-hour 20

# 诊断全部（默认最多 10 个）
node scripts/promo.mjs --mode diagnose

# 只诊断指定推广单元
node scripts/promo.mjs --mode diagnose --ad-id 9451903287

# 平衡分析（一屏结论 + 健康度 + 平台建议汇总）
node scripts/promo.mjs --mode balance --limit 20
```
### item 模式输出结构（2026-10-28 新增）

```
单品推广诊断：<商品名>

⛔ / ✅  一屏结论（平台 error 标签 + 动态速率结论）

┌─ 商品数据 ─  花费/GMV/净GMV/订单/点击/曝光/ROI/CTR/每笔净成交花费 + 全店均值
┌─ 单元配置 ─  adId/状态/日限额（含平台建议上限）/出价区间/平台建议出价
┌─ 烧钱速率 ─  时段 + 今日已花 + 当前速率 + 正常速率 + 判定
│              全店参考（已花/单元数/速率）
┌─ 全店速率表  ★ 本单品排名 + 全店所有有消耗单元的表格
⚠️ 提醒      速率/限额/CTR/花费暴涨
平台异常标签  labelType 官方名 + 维度 + 平台原文
调参命令    提日限额 / 提投产比（error 级时给暂停命令）
```

## `auto` 自动化调参（2026-10-28 新增）

### 核心逻辑

```
阶段判定：
  前期 = 净实际投产比 < 保本线（该商品）
  后期 = 连续 2 天 净实际投产比 >= 保本线

前期：倍数 >= 1.2× → 日限额 × 1.2 + 净目标投产比 + 0.2
      一天最多 5 次，最小间隔 90 分钟

后期：倍数 >= 1.2× → 日限额 × 1.1 + 净目标投产比 + 0.1
      一天最多 1 次

倍数 = 真实速率 / 设置速率 = 消耗进度 / 时间进度（两者等价）
```

### 四条刹车

| # | 条件 | 处置 |
|---|---|---|
| ① | 连续 3 次调整后倍数仍 < 1.0× | 停调参，转商品侧 |
| ② | 倍数 ≥ 1.2× 但净ROI 连续 2 天下降 | 回滚 |
| ③ | 平台 error 级标签（1/4/7） | 停投整改 |
| ④ | 当天达频率上限 | 次日再调 |

### 用法

```bash
# 预览（默认 dry-run，只出计划不执行）
node scripts/promo.mjs --mode auto --breakeven "824693746830:2.5,930630868294:2.8"

# 全店统一保本线
node scripts/promo.mjs --mode auto --breakeven-all 2.5

# 用 JSON 文件
node scripts/promo.mjs --mode auto --breakeven-file ./breakeven.json

# 真正执行（L2）
node scripts/promo.mjs --mode auto --breakeven "824693746830:2.5" --confirm true

# 自定义时段
node scripts/promo.mjs --mode auto --start-hour 8 --target-hour 18 --breakeven "..."
```

### 输出

```
自动化调参（预览模式）
时段 8:00-18:00｜已过 4.4h｜在投 27 个
可调整 2 个｜受控 1 个｜不动 24 个

═══ 待执行 ═══
adId        倍数   净ROI  保本线  阶段  限额        投产         原因
🟡1.36×    8412766219      2.10   2.50   前期  ¥100→¥120    +0.2→2.30   倍数 1.36× ≥1.2×｜前期

═══ 受控（不执行）═══
  [limit] 7746631196 爱绿森茶叶杯 — 今日已调 1 次，达上限
```

### 调整日志

落盘到 `artifacts/pdd-promo-auto/adjust-log.jsonl`，每次调整一行：

```json
{"ts":"2026-10-27T10:00:00+08:00","adId":"8412766219","phase":"early","trigger":{"ratio":1.32,"netRoi":2.1,"breakeven":2.5},"before":{"maxCost":100},"after":{"maxCost":120,"targetRoi":2.3},"afterRatio":1.32,"roi":2.1,"seqToday":1,"result":null}
```

用于：判断连续无效次数（刹车①）、连续过保本线天数（阶段判定）、回滚依据。

### 三个注意

1. **默认 dry-run**，必须 `--confirm true` 才真调
2. **保本线按商品分开配**（不同品类毛利不同），用 `--breakeven "goodsId:roi,..."`
3. **时段未开始/已结束会提示跳过**，倍数只在时段内有意义

---

### ★ 速率表（goods / item / rates 共用）

**公式**（2026-10-28 对齐运营口径）：

```
时段     = start-hour ~ target-hour（默认 8:00-18:00 = 10 小时）
设置速率 = 日限额 / 时段小时数
真实速率 = 单品今日已花 / 已过小时数（从 start-hour 起算）
倍数     = 真实速率 / 设置速率
```

**数据源**：`adInfos[].dailyCost.value` = 单品当天已花（真实值，不是分摊）

**输出格式**：

```
全店速率表（时段 8:00-18:00 = 10h｜已过 15.5h｜27 个在投）

倍数    产品ID        设置速率   真实速率  今日花费  日限额  名称
────────────────────────────────────────────────────────────────────
🟡0.53× 8412766219      10.00/h     5.33/h     ¥82.64     ¥100  家用一次性纸杯加厚...
🟡0.41× 9352844370      10.00/h     4.06/h     ¥62.99     ¥100  春天高级感奶茶杯...
🟡0.25× 9451903289      10.00/h     2.51/h     ¥38.93     ¥100  一次性纸杯带盖咖啡...
🟡0.12× 7746631196      20.00/h     2.30/h     ¥35.69     ¥200  爱绿森多层密封茶叶杯
────────────────────────────────────────────────────────────────────
合计：设置 280.00/h｜真实 15.91/h｜倍数 0.06×｜今日已花 ¥246.85
🔴 ≥1.2× 烧得快该提 ｜ 🟢 1~1.2× 正常 ｜ 🟡 <1× 偏慢
```

**倍数判读**：

| 倍数 | 含义 | 动作 |
|---|---|---|
| ≥ 1.2× | 🔴 烧得快 | 提日限额 + 提净目标投产比 |
| 1.0 ~ 1.2× | 🟢 正常 | 可以提，幅度别大 |
| < 1.0× | 🟡 偏慢 | 不提，等它跑 |

**超时后（已过 target-hour）切换口径**：

```
已烧 ≥ 95% → 🔴 已烧完 → 铁定该提
已烧 70~95% → 🟠 差一点
已烧 < 70% → 🟡 没烧完 → 别提，先查为什么烧不动
```

> 超时后速率比没意义（分母漂移），改看「烧完没烧完」。

**三个模式都会带上这张表**：

| mode | 表格位置 | 说明 |
|---|---|---|
| `goods` | 商品报表后 | 付费分析的一部分 |
| `item` | 单品诊断末尾 | 含「本单品排名 N/M」 |
| `rates` | 独立输出 | 只看速率表 |

### 实跑输出样例

**单单元 diagnose**（一屏结论 + 维度明细）：

```
推广诊断（1 个推广单元）：
┌─ 一屏结论 ────────────────────────────────────────────────────
│ ⛔ 停投/整改（转化过低）（总分 88）
│ 平台原文：当前推广近 3 天综合订单获取能力过差，低于 100% 相似推广
│ 处置：根因在商品侧（详情页/价格/规格），提价治不了，先暂停
└─────────────────────────────────────────────────────────────

  维度明细（补充一屏结论没覆盖的）：
     出价竞争力：rank 13/100 · 竞争等级 9/10
     投放状态：rank 46/100 · 竞争等级 6/10
     创意素材：rank 25/100 · 竞争等级 8/10
  执行命令：--mode pause --ad-id 9451903287 --confirm true
```

**单品诊断 item**（含速率图 + 7 天柱状图 + 提醒）：

```
单品推广诊断：杯子一次性ins批发纸杯可爱水杯家用加厚商用热饮50整箱定制

⛔ 先停投/整改，别调参
   平台判：曝光过低（曝光），低于 96% 相似推广
   根因大概率在商品侧（详情页/价格/规格/评价），加钱治不了

┌─ 商品数据 ────────────────────────────────────────────────────────
│ （商品维度无数据——可能尚未产生推广成交）
│ 全店均值：CTR 5.89%｜ROI 3.03
└─────────────────────────────────────────────────────────────────

┌─ 单元配置 ────────────────────────────────────────────────────────
│ adId 8391433818｜状态 推广中
│ 日限额 ¥100（平台建议上限 ¥200）
│ 出价区间 1 ~ 4.86｜平台建议出价 ¥3.1（alert 21 出价偏低）
└─────────────────────────────────────────────────────────────────

┌─ 烧钱速率 ────────────────────────────────────────────────────────
│ 今天已花 ¥183.47｜已过 17.1 小时
│ 当前速率 ¥10.70/小时
│ 正常速率 ¥5.56/小时（日限额 ¥100 ÷ 目标 18:00 烧完）
│ 速率比 1.93×  🔴 偏高｜按此速率 9.3 小时烧完
│
│ 近 7 天日消耗：
│   2026-10-20 ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇      ¥   423  ROI 3.16
│   2026-10-21 ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇  ¥   538  ROI 2.52
│   2026-10-24 ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇ ¥   577  ROI 2.76
│   2026-10-26 ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇      ¥   445  ROI 3.04
│   日均 ¥408
└─────────────────────────────────────────────────────────────────

⚠️ 提醒：
  ⛔ 平台有 error 级标签 → 别调参，先停投/整改商品

平台异常标签：
  🔴曝光过低(4)｜曝光｜当前推广近 3 天综合曝光量过低，低于 96% 相似推广
  🔴转化过低(7)｜转化｜当前推广近 3 天综合订单获取能力过差，低于 96% 相似推广
  🔴出价过低(1)｜出价｜当前推广近 3 天综合出价设置过低，低于 89% 相似推广

处置命令：
  暂停：--mode pause --ad-id 8391433818 --confirm true
```

**多单元 balance**（健康度总判 + 按 labelType 聚类）：

```
┌─ 一屏结论 ─────────────────────────────────────────────────────
│ 🔴 健康度：差（8 个单元：⛔停投 5 · 🔽降 1 · 🔼加 0 · ⚠️微调 1 · ✅保持 1）
│ ⛔ 最该做：停投 5 个被平台标 error 级的单元（近 7 天白花 ¥189.54）
│    头号问题：[9451903287] 咖啡杯纸杯一次性带盖卡 → 转化过低（低于 100% 相似推广）
│    原因：转化/曝光是平台 error 级，加钱治不了，根因在商品侧
└──────────────────────────────────────────────────────────────

📢 平台异常标签汇总（拼多多官方，仅竞价维度）
   5/8 个单元有标签：🔴error 7 个 · 🟡warning 2 个
   🔴转化过低(7) × 5 个：9451903287, 9361514620, 9451903289, 8391433818, 7746631195
   🔴曝光过低(4) × 4 个：9451903287, 8412766219, 8391433818, 7746631195
   🟡近期降价(2) × 1 个：9352844370
   ⚠️ 平台只看竞价，看不到详情页承接：转化过低(7)的根因在商品侧，提价治不了
```

> **输出设计原则（2026-10-28）**：先给人话判断和动作，细节沉到最后。
> 单单元时一屏结论已说清，明细只补「平台没说的」维度，不重复。
> 多单元时按 labelType 聚类，不逐单元刷屏。

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

## 输出字段（balance 模式，2026-10-28 新增）

| 字段 | 含义 |
|------|------|
| `balance.byAction` | 按动作分组：`fix`（停投整改）/ `raise` / `cut` / `tune` / `healthy` / `open` / `unknown` |
| `balance.totalSpend` | 本轮诊断单元的总花费 |
| **`platformAdvice`** | **平台建议汇总**：`{total, flagged, items[]}`，每个 item 含 `adId / adName / goodsId / labels[]`，label 含 `labelType / name / level(error\|warning) / rank / referenceDays` |

## 跨技能交叉验证（重要）

平台诊断（本技能）只看**竞价维度**，必须配合商品侧数据才能下结论：

```bash
# 1. 平台说这个单元有问题
node scripts/promo.mjs --mode diagnose --ad-id <ID>

# 2. 交叉商品侧转化率 vs 类目均值
node ../pdd-shop/scripts/shop.mjs --mode goods --shop-name <店铺名>

# 3. 判断矩阵
#    平台 labelType=7(转化过低) + 商品转化率 < 类目均值  → 停投，改商品
#    平台 labelType=7(转化过低) + 商品转化率 > 类目均值  → 样本太小，观察或加量
#    平台 labelType=1(出价过低) + 无转化问题              → 才考虑提价
#    平台 healthy + 商品转化率 > 类目均值                 → 可加预算放量
```

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
