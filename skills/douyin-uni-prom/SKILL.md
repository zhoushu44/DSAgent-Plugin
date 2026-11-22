---
name: douyin-uni-prom
description: "抖音·全域投放数据（千川新版）：投放总览/报表/计划列表/素材来源/授权抖音号/写权限自检/素材分析报表。逆向自千川「全域投放」页（/uni-prom）。触发：千川、全域投放、抖音推广数据、推广报表、今天花了多少钱、推广计划、ROI、消耗、douyin uni prom、全域数据。排除：计划启停（用 douyin-plan-ops）、商品查询（用 douyin-goods）、订单查询（用 douyin-order）、店铺经营（用 douyin-shop）。需绑定「抖音小店」账号。"
metadata:
  builtin_skill_version: "1.1"
  dsagent:
    display_name: "抖音·全域投放"
    emoji: "📊"
    requires: {}
---

# 抖音 · 全域投放数据（douyin-uni-prom）

> 千川新版「视频推广」替代品。全部只读，无平台副作用。

## 何时使用

- 用户说「今天花了多少钱」「ROI 多少」→ `--mode overview`
- 用户说「拉个投放报表」→ `--mode report`
- 用户说「看我有哪些计划」→ `--mode plans`
- 用户要**暂停/开启计划** → 用 `douyin-plan-ops`（本技能只读）

## 背景：千川改版（2026-10 逆向实证）

```
旧版菜单「视频推广 / 直播推广 / 商品推广」已全部下线，
合并为「全域投放」，页面路由 /uni-prom，内部按 MarGoal 区分：
  1 = 推商品
  2 = 推直播间
```

**视频不再是推广对象，而是投放素材**（抖音号视频 / 本地上传 / 直播剪辑）。

## ★ 取数方式：纯 Node 直连（2026-11-11 改造）

> ### ⚠️ 本节推翻旧结论
>
> ~~「千川接口带 verifyFp/fp 签名，手工 fetch 会撞 40002，必须 hook 页面」~~
>
> **这个结论是错的。** 实测同一接口三种方式：
> ```
> 带 a_bogus+verifyFp+fp+msToken  → code=0  789B  ✅
> 剥净签名                        → code=0  789B  ✅
> 完全手工零参数                  → code=0  789B  ✅
> ```
> 旧文档说的「40002」实际是 **`code=2` 业务参数缺失**，不是签名问题。
>
> **现在走纯 Node**：`overview` 16~20s → **1.9s**，`balance` → **584ms**。
> 依据见 `_shared/DOUYIN-KNOWLEDGE.md` 与 `_douyin_node_probe/REPORT.md`。

**唯一真缺口：POST 接口的 body 必须带业务参数。**

| 接口 | body 要求 |
|---|---|
| `list-summary` | `{DiscardTotalNum, AdFilter:{MarGoal,AdlabMode,CustomFilterType,UniPromShopFilter,StartTime,EndTime}, Metrics:[]}`；空 `{}` → `code=2` |
| `statQuery` | `{StartTime,EndTime,ComparisonParams,DataSetKey,Dimensions,Metrics,Filters}` |
| `getAnalysisReport` | `{}` 即可 |

## 用法

```bash
node scripts/uni-prom.mjs --mode overview                 # 投放总览（余额+账户+计划数+分析）
node scripts/uni-prom.mjs --mode balance                  # 余额明细（按 advBalanceType 分组）
node scripts/uni-prom.mjs --mode perm                     # 权限自检
node scripts/uni-prom.mjs --mode plans                    # 计划列表汇总
node scripts/uni-prom.mjs --mode report --start 2026-11-01 --end 2026-11-12
node scripts/uni-prom.mjs --mode analysis                 # 经营分析报告

# ── 利润与涨价建议（只读，纯本地计算，零平台副作用）──
node scripts/uni-prom.mjs --mode margin --price 39.9 --cost 33
```

### `margin` 模式：什么时候用、怎么算

规则见 [_shared/margin-price-advice.md](../_shared/margin-price-advice.md)，计算器
`_shared/margin_price.mjs`，与 `pdd-promo` / `taobao-promo` **三平台同口径**。

**触发时机（商品后期 + 在做提高利润 / 优化）**：

| # | 条件 | 判定 |
|---|---|---|
| ① | 商品后期 | 连续 ≥7 天有消耗且累计订单 ≥30（或日均 ≥3 单） |
| ② | 优化诉求 | 用户在提利润 / 优化价格 / 优化投产（`--want_profit false` 可关） |
| ③ | 非商品承接问题 | 转化率、素材质量无异常 |

> ⚠️ **利润低不是门槛，只决定优先级**：🔴 高 = 毛利率 ≤20% 或 净ROI < 保本线；
> 🟡 常规 = 利润尚可，但**安全垫更小（掉量容忍度低）**，要更小步、观察更密。

**计算口径**（`m` = 毛利率，`k` = 涨价幅度）：

```
利润变化倍数     = 1 + k/m
等效营业额增幅   = k/m
最多可掉销量     = k/(m+k)
保本投产比       = 1/m          ← 注意：不是 1/(1-m)（那是成本加成率）
```

**实跑样例**（单价 ¥39.9、成本 ¥33 → 毛利率 17.29%）：

```
【利润与涨价建议】

触发条件自检：
  商品后期：是
  利润低：是（毛利率 17.29% ≤ 20%）
  商品侧异常阻断：否
  → ✅ 满足触发条件，可给涨价建议

建议动作：先涨 +1%~+2% 小步试涨，观察 3~5 个自然日
观察指标：转化率、净ROI、订单数
回滚条件：掉量 > 该幅度对应的安全垫 → 调回原价
假设：单位成本不变、成本随销量等比例变动；掉量还受客户流失与竞品比价影响

单价 ¥39.9｜单位成本 ¥33
毛利率 17.29%｜单件利润 ¥6.9｜保本投产比 5.78

涨价幅度   新单价   单件利润   利润变化   等效营业额/销量   最多可掉销量
+1%       ¥40.3     ¥7.3      +5.8%     +5.8%           5.5%
+2%       ¥40.7     ¥7.7      +11.6%    +11.6%          10.4%
+3%       ¥41.1     ¥8.1      +17.3%    +17.3%          14.8%
+5%       ¥41.9     ¥8.9      +28.9%    +28.9%          22.4%
```

**三条边界**：

1. **单位成本平台取不到**（`douyin-shop` 只有售价），必须商家提供；缺成本时只提示去取数，**不得**默认毛利率下结论。
2. `margin` 模式在账号校验后、浏览器启动前就返回，**不占 profile、不开浏览器、无任何平台副作用**。
3. 素材维度问题走 `douyin-material-report`；计划启停走 `douyin-plan-ops`；本模式只回答「该不该动价格」。

### 参数

| 参数 | 说明 |
|---|---|
| `--mode` | `overview`（默认）/ `report` / `plans` / `materials` / `awemes` / `perm` / `material-report` / `margin` |
| `--start` / `--end` | `YYYY-MM-DD`，默认今天 |
| `--mar_goal` | `1`=推商品（默认）/ `2`=推直播间 |
| `--material_type` | material-report 专用：`3`=视频素材（默认）/ `1`=直播间画面 / `2`=图片 / `4`=图文 / `5`=标题 |
| `--dimensions` | report 维度，逗号分隔，如 `stat_time_day,marketing_goal` |
| `--metrics` | report 指标，逗号分隔 |
| `--offset` | material-report 专用分页偏移，默认 0 |
| `--limit` | 条数上限，默认 20，最大 100 |
| `--price` | **margin 专用**：商品单价（元，必填） |
| `--cost` | **margin 专用**：单位成本（元，必填，商家提供） |
| `--net-roi` | margin 专用：当前净ROI，用于和保本线 `1/毛利率` 对比 |
| `--steps` | margin 专用：自定义涨价幅度，逗号分隔，如 `0.01,0.02,0.05` |
| `--days` / `--orders` | margin 专用：商品已投产天数 / 累计订单（触发条件自检） |
| `--error-label` | margin 专用：`true` 表示有异常标签（命中则不触发涨价建议） |
| `--want-profit` | margin 专用：`false` 关闭（默认 true，即后期 + 优化诉求即触发） |
| `--account` | 账号 shopKey（可选） |

## 能力清单

| mode | 产出 |
|---|---|
| `overview` | 投放总览：余额 + 账户 + 权限 + 计划数 + 分析报告 |
| `balance` | 广告余额明细（按 `advBalanceType` 分组，单位分→元） |
| `perm` | 权限自检（`createAuthEnable` / `uniPromVisible` / 白名单） |
| `plans` | 计划列表汇总（`totalNum` + `totalMetrics`） |
| `report` | 报表查询（`statQuery`，DataSetKey/Dimensions/Metrics） |
| `analysis` | 经营分析报告（`report_text`） |
| `margin` | ★ 利润率 → 涨价安全垫（纯本地计算，零副作用，三平台同口径） |

## 已知踩坑

```
★ 不能用 method==='POST' 判读写：千川只读查询全是 POST。
  按 POST 判写 → 每次白等 3s → overview 从 1.9s 拖到 7s。
★ list-summary 空 body 报 code=2（业务参数），不是签名问题。
★ 权限用 /account/user/get-whitelist（19.4KB，稳定）；
  /uni_prom/get_uni_prom_config 会偶发 status_code=2「获取全域推广计划配置报错」。
★ 金额单位是「分」，显示前 /100。
★ aavid 不是必需（不带也能查计划列表）。
★ 旧笔记「必须复用正式 profile / 不要 setCookie」是 DOM 路线时代的约束，
  纯 Node 后已不适用；但 cookie 合并仍须「只补缺失、不覆盖」。
```

## 写操作未实现（平台权限，非技术问题）

```
上传视频 / 启停 / 新建 —— 当前账户为「仅观察」权限
（createAuthEnable=false），点击会弹「没有操作权限」。

这与接口可用性无关，是平台侧账号权限。
用 --mode perm 自查权限状态（实测本账号：可创建计划 = false）。
```

## 风控

| 项 | 状态 |
|---|---|
| 全部 mode | 只读，无副作用 |
| 取数 | 被动 hook 页面响应（避免主动 fetch 撞 40002） |
| 账号要求 | 需绑定「抖音小店」（`douyin_shop`） |

## 相关文档

- [[抖音计划管理逆向]] — 计划启停（douyin-plan-ops）
- [[抖音素材分析]] — 素材维度报表（douyin-material-report）
- [[抖音小店经营数据]] — 店铺侧数据（douyin-shop）
- [[拼多多推广平衡算法使用指南]] — 拼多多侧的同类能力
