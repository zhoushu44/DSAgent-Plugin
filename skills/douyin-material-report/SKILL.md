---
name: douyin-material-report
description: 抖音千川素材分析报表。按素材维度拉取消耗、成交、结算、效率、视频质量（2s/3s/5s/10s播放率、完播率）等 47 项指标。对应千川后台「数据 → 全域数据 → 素材数据 → 素材分析」。支持视频/图片/图文/直播间画面/标题五类素材，推商品与推直播两个维度，自定义时间范围。只读，无平台副作用。需绑定「抖音小店」账号。
version: 1.0
risk: L1
platform: douyin_shop
---

# 抖音·素材分析报表（douyin-material-report）

## 用途

拉取千川**素材维度**的投放报表，回答「哪条视频跑得好、开头留不留人、退款多不多」。

对应后台页面：`数据 → 全域数据 → 素材数据 → 素材分析`
（路由 `/dataV3/roi2-material-analysis`）

## 触发词

素材分析、素材报表、视频素材数据、素材跑量、素材诊断、2s播放率、3s播放率、完播率、千川素材、douyin material report

## 排除

- 投放总览/计划列表 → 用 `douyin-uni-prom`
- 商品/订单/店铺经营 → 用 `douyin-goods` / `douyin-order` / `douyin-shop`
- 抖音作品自然流量数据 → 用 `douyin-works`

## 参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `--start` | 开始日期 `YYYY-MM-DD` | 今天 |
| `--end` | 结束日期 `YYYY-MM-DD` | 同 start |
| `--material_type` | 3=视频素材 / 1=直播间画面 / 2=图片 / 4=图文 / 5=标题 | 3 |
| `--mar_goal` | 1=推商品 / 2=推直播间 | 1 |
| `--offset` | 分页偏移 | 0 |
| `--limit` | 条数上限（≤100） | 20 |
| `--account` | 账号 shopKey | 单账号时自动 |

## 返回字段

### summary（汇总）

| 分组 | 字段 |
|---|---|
| 消耗 | `cost` `overallCost` `basicCost` |
| 成交 | `gmv` `orders` `costPerOrder` `roi` `couponAmount` `platformSubsidy` |
| 结算 | `settleAmount` `refundRate` |
| 效率 | `cpc`（点击单价） `ecpm`（千次展现费用） |
| 视频质量 | `play2sRate` `play3sRate` `play5sRate` `play10sRate` `finishRate` `playCount` `avgWatchDuration` |

### rows[]（素材明细）

上方全部字段 + 素材属性：

| 字段 | 说明 |
|---|---|
| `materialId` | 素材 ID |
| `name` | 素材名称 |
| `duration` | 时长（如 `00:21`） |
| `createTime` | 创建时间 |
| `source` | 来源（抖音号主页素材 / 本地上传 / 直播剪辑 / AIGC动态创意 等 18 种） |
| `tags` `suggest` `suggestReason` | 标签与平台建议 |
| `content` | 原始 JSON，内含 `video_id` / `video_url` / 封面 / 宽高 / 码率 |
| `liveShowCount` `liveWatchCount` | 直播场景指标（视频素材为 null） |

## 前置条件

- 已绑定「抖音小店」账号（`platform=douyin_shop`），且该账号有千川后台权限
- 本机已安装 Chrome 或 Edge
- 浏览器 profile 未被其他任务占用（发布商品等操作会占用同一个 profile）

## 工作流

### 1. 查视频素材报表（最常用）

```bash
node skills/douyin-material-report/scripts/material-report.mjs \
  --account douyin_shop_<shopKey> \
  --start 2026-07-26 --end 2026-10-24
```

时间范围**至少给 90 天**。素材报表只统计统计周期内有投放行为的素材，近 30 天经常是空的。

### 2. 查其他素材类型

```bash
--material_type 2   # 图片素材
--material_type 1   # 直播间画面
--material_type 4   # 图文素材
--material_type 5   # 标题素材
```

### 3. 切换推广目标

```bash
--mar_goal 2   # 推直播间（默认 1 = 推商品）
```

### 4. 空结果的排查顺序

1. 放宽时间范围到 90 天
2. 换 `--material_type`（1/2/4/5）试
3. 用 `douyin-uni-prom --mode overview` 查账户消耗——如果消耗为 0，说明没投过，报表必然空
4. 用 `douyin-uni-prom --mode perm` 确认账号未被限制

### 5. 结果解读

读 `summary` 看整体，读 `rows[]` 看单条素材。重点看三处：

- **2s/3s 播放率**：开头吸引力。低于 30% 要重做封面和前 3 秒
- **5s→10s 衰减**：中段留存。掉幅超过一半说明节奏或信息密度有问题
- **1小时退款率**：商品与素材承诺是否一致，退款高说明货不对板

## 使用建议

**1. 时间范围要给足。** 素材报表只统计**参与过投放**的素材。近 30 天查不到，试着放宽到 90 天——实测某条素材的数据就落在 7-8 月。

**2. 空结果先查余额。** 如果所有范围都是 0 条，大概率是账户无消耗（可用 `douyin-uni-prom --mode overview` 看余额与消耗）。起投门槛通常 300 元。

**3. 播放率怎么读。**

| 指标 | 健康参考 |
|---|---|
| 2s/3s 播放率 | 越高越好，低于 30% 说明开头不吸引人 |
| 5s→10s 衰减 | 掉幅超过一半，说明中段节奏或信息密度有问题 |
| 完播率 | 短视频 15%+ 尚可，0% 需重做结构 |

**4. 与自然流量对照。** 千川的 `play2sRate`（正向）和 `douyin-works` 的 `bounce_rate_2s`（2秒跳出率，负向）口径不同、流量来源不同（付费 vs 自然），可以并排看开头吸引力在两种流量下的差异。

## 已知限制

- **只读**。上传素材、启停计划等写操作未实现——平台侧账号为「仅观察」权限时会被拒。可用 `douyin-uni-prom --mode perm` 自查。
- 报表**不含创建时间早于统计周期的历史素材**，只返回统计周期内有投放行为的素材。
- `'-'` 与 `'0.00'` 已区分：前者无数据（返回 `null`），后者真的是 0。

## 实现备注

入口路由必须是 `/dataV3/roi2-material-analysis`，其他路由不放行 `roi2_video_material_analysis` 这个 DataSetKey。复用正式浏览器 profile（不能注入账号 cookies，否则会被判未登录）。详见脚本内注释。
