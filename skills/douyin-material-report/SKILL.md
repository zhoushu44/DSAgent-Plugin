---
name: douyin-material-report
description: "抖音·素材分析报表（只读）：按素材维度拉取消耗、成交、结算、退款、视频质量（2s/3s/5s/10s播放率、完播率、播放数、点赞、评论、涨粉、平均观看时长）等 35 项指标；素材来源清单（抖音号主页/本地上传/直播剪辑/AI成片等）。数据源：千川后台 qianchuan.jinritemai.com，DataSetKey=roi2_video_material_analysis。纯 Node 直连（千川只读免签），无平台副作用。触发：素材分析、素材报表、视频素材数据、素材跑量、素材诊断、2s播放率、3s播放率、完播率、千川素材、素材来源、douyin material report。排除：全域投放报表（用 douyin-uni-prom）、计划启停（用 douyin-plan-ops）、商品（douyin-goods）、订单（douyin-order）。需绑定「抖音小店」账号。"
version: 2.0
risk: L1
platform: douyin_shop
---

# 抖音·素材分析报表（douyin-material-report）

## 用途

拉取千川**素材维度**的投放报表，回答「哪条视频跑得好、开头留不留人、退款多不多」。

对应后台页面：`数据 → 全域数据 → 素材数据 → 素材分析`
（路由 `/dataV3/roi2-material-analysis`）

## ★ 2026-11-11 改造：纯 Node 直连

| 模式 | 改造前 | 改造后 |
|---|---|---|
| `overview` | ~16~20s | **1.2s** |
| `source` | ~16~20s | **0.8s** |
| `report` | ~16~20s | **1.1s** |

### ⚠️ 关键坑：素材报表的 Filters 只有 4 条，字段名与通投报表不同

```
素材报表（roi2_video_material_analysis）：
  advertiser_id / marketing_goal / adlab_mode_fork / material_type          ← 4 条

通投报表（overall_home_cost_total_prom）：
  advertiser_id / ecp_app_id / query_self_data / adlab_mode_fork / adlab_scene_fork  ← 5 条
```

**照搬通投那套会返回「网络请求超时」** —— 那是 `ecp_app_id` + `query_self_data`
与素材数据集冲突，**不是真超时**。已固化成基座 `materialReportBody()`。

### ⚠️ 指标名不能猜

原脚本 47 个指标里有一个是猜的：
```
video_play_over_rate_for_roi2   ← 不在数据集里
服务端报：[check] 指标：video_play_over_rate_for_roi2不在数据集配置中
```
真实完播率字段是 **`video_play_finish_rate_for_roi2_v2`**。

现在指标表全部来自 probe-19 抓到的**真实 100 指标**，取 35 个有效常用项。

## 触发词

素材分析、素材报表、视频素材数据、素材跑量、素材诊断、2s播放率、3s播放率、完播率、千川素材、素材来源、douyin material report

## 能力

| 模式 | 类型 | 说明 |
|---|---|---|
| `overview` | 只读 | 素材来源数 + 报表汇总 + 核心指标（默认） |
| `report` | 只读 | 素材分析报表（35 指标 + 11 维度） |
| `source` | 只读 | 素材来源清单（18 视频源 / 5 图片源 / 3 轮播源） |

## 输入

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `--mode` | string | 否 | overview(默认) / report / source |
| `--material_type` | number | 否 | `3`=视频素材(默认) / `1`=直播间画面 / `2`=图片 / `4`=图文 / `5`=标题 |
| `--mar_goal` | number | 否 | `2`=推直播间(默认) / `1`=推商品 |
| `--days` | number | 否 | 统计窗口天数，默认 7，上限 90 |
| `--start` / `--end` | string | 否 | 显式日期 `YYYY-MM-DD`，优先于 `--days` |
| `--advertiser-id` | string | 否 | 千川账户 ID；不传则自动从 `get-customer-id` 的 `accountId` 取 |
| `--limit` | number | 否 | `source` 返回条数，默认 20 |
| `--account` | string | 否 | 账号 shopKey |

## 输出

| 字段 | 含义 |
|---|---|
| `advertiserId` | 千川账户 ID（`accountId`，不是 `customerId`） |
| `source` / `sourceCount` | 素材来源清单与计数 |
| `metricCount` | 可用指标数（实测 35） |
| `totalRows` | 报表数据行数（0 = 该窗口无消耗） |
| `keyMetrics` | 核心指标中文映射（消耗/GMV/ROI/播放率/完播率/互动） |
| `allMetrics` | 全部指标原始值 |
| `perf` | 各接口耗时（ms） |
| `text` | 面向用户的中文文案 |

## 用法

```bash
node {baseDir}/scripts/material-report.mjs --mode overview
node {baseDir}/scripts/material-report.mjs --mode source
node {baseDir}/scripts/material-report.mjs --mode report --days 30
node {baseDir}/scripts/material-report.mjs --mode report --material_type 3 --mar_goal 1
```

## 工作流

### W1：哪个视频素材跑得好

```
① material-report --mode report --days 30   → 按素材维度的 35 项指标
② 看 keyMetrics：消耗 / GMV / ROI / 完播率 / 2s播放率
③ 完播率低但消耗高 → 素材前 3 秒留不住人，建议换开头
④ 结合 douyin-uni-prom --mode overview 看账户整体 ROI 是否达标
```

### W2：素材从哪来

```
① material-report --mode source
② 18 个视频来源里，看「抖音号主页素材 / 本地上传 / 直播剪辑」各占多少
③ 「AI成片（source=160/161）」出现说明用了平台 AI 生成
```

## 错误处理

| 场景 | failureKind | 引导动作 |
|---|---|---|
| 未绑定账号 | `not_bound` | 引导到「账号连接」添加抖音小店账号 |
| 多账号未指定 | `need_account_choice` | 把候选给用户选，不要自己挑 |
| 登录态失效 | `token_expired` | 引导重新登录 |
| `code=3001`「filter必须存在」 | `bad_input` | 素材数据集要 4 条 Filters，用 `materialReportBody()` |
| `code=3001`「XX不在数据集配置中」 | `bad_input` | **指标名猜错了**，从真实 100 指标里选 |
| 返回「网络请求超时」 | `bad_input` | 多半是条件冲突（照搬了通投的 5 条 Filters） |
| `totalRows=0` | — | 该窗口无消耗，属正常 |

## 技术说明

### 取数方式

**纯 Node 直连**。千川只读接口免签（见 `_shared/DOUYIN-KNOWLEDGE.md`）。

### 接口

| 用途 | 接口 |
|---|---|
| 素材报表 | `POST /ad/api/data/v1/common/statQuery`（DataSetKey=`roi2_video_material_analysis`） |
| 素材来源 | `GET /ad/api/data/v1/material/get_source_list_new` |
| 账户 ID | `GET /ad/api/v1/account/account-info/get-customer-id`（取 `detail[].accountId`） |

基座：`skills/_shared/douyin-registry.mjs` 的 `promo.materialReport` / `promo.materialSource`，
构造器 `materialReportBody()`，指标表 `MATERIAL_REPORT_METRICS`，维度表 `MATERIAL_DIMENSIONS_FULL`。

### 已知坑

| 坑 | 现象 | 处置 |
|---|---|---|
| Filters 用错套 | 「网络请求超时」 | 素材 4 条 / 通投 5 条，别串 |
| 指标名猜 | `[check] 指标：xxx不在数据集配置中` | 从真实 100 指标里选 |
| `accountId` vs `customerId` | 填错 → 0 条 | 素材报表用 `accountId` |
| `material_type` 传数组 | 「只能传入一个数字」 | 单值，不是数组 |
| 本店当前无投放 | `totalRows=0`，指标全 `-` | 正常，不是故障 |
| 原脚本硬编码 47 指标 | 含 1 个不存在的，会让整个请求失败 | 已换成 35 个真实有效的 |
