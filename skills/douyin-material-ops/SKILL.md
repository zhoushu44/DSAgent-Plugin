---
name: douyin-material-ops
description: "抖音·千川素材管理：素材清单（含12项投放指标）、按 vid 查素材元信息、添加素材到计划、从计划移除素材、素材审核状态。纯 Node HTTP 直连（千川只读/写接口均免签），零浏览器。逆向自 2026-11-12 真实点击抓包。触发：千川素材、素材列表、加素材、删素材、移除素材、素材暂停、素材审核状态、douyin material ops。排除：素材分析报表（用 douyin-material-report）、计划启停（用 douyin-plan-ops）、投放数据（用 douyin-uni-prom）。需绑定「抖音小店」账号。"
version: 1.0
risk: L2
platform: douyin_shop
---

# 抖音·千川素材管理（douyin-material-ops）

> 2026-11-12 从**真实人工点击抓包**逆向，全部接口实测通过。
> **纯 Node HTTP 直连，零浏览器**——已实测在浏览器完全关闭时跑通全流程。

## 用途

回答「我计划里挂了哪些素材 / 每条素材跑得怎么样 / 怎么加一条 / 怎么删一条」。

对应后台：千川「全域投放」→ 计划详情 → **素材 tab**

## ★ 先说清楚：千川没有「素材暂停」

扫了 617 个 JS chunk 后确认：

```
AdDisableMaterials（暂停素材，枚举值 13）  → 只存在于「批量任务类型」字典
                                           → 前端没有任何调用点
set-opt 的 optType 只用了 "delete"
```

**素材维度只能「删除」，不能「暂停」。** 想停某条素材的投放只有两条路：

1. 从计划里删掉它（`--mode remove`）
2. 暂停整个计划（用 `douyin-plan-ops --mode stop`）

## 用法

```bash
# 素材清单（只读）
node scripts/material-ops.mjs --mode list
node scripts/material-ops.mjs --mode list --status 1     # 只看投放中
node scripts/material-ops.mjs --mode list --status 2     # 只看已删除

# 按 vid 查元信息（只读）
node scripts/material-ops.mjs --mode video --vid v03c8eg10000dbqlgv7og65rhjvpf390

# 审核状态（只读，需 mid）
node scripts/material-ops.mjs --mode status --mid 7707163602037260307

# 添加素材（L2 两步）
node scripts/material-ops.mjs --mode add --vid v03c8eg10000dbqlgv7og65rhjvpf390 --name "纸杯实拍.mp4"
# 确认后
node scripts/material-ops.mjs --mode add --vid v03c8eg10000dbqlgv7oghjvpf390 --name "纸杯实拍.mp4" --confirm true

# 移除素材（L2 两步）
node scripts/material-ops.mjs --mode remove --vid v03c8eg10000dbqlgv7og65rhjvpf390 --mid 7707163602037260307
# 确认后
node scripts/material-ops.mjs --mode remove --vid v03c8eg10000dbqlgv7og65rhjvpf390 --mid 7707163602037260307 --confirm true
```

### 参数

| 参数 | 说明 |
|---|---|
| `--mode` | `list`(默认) / `video` / `status` / `add`(L2) / `remove`(L2) |
| `--vid` | 视频 ID，video/add/remove 必填 |
| `--mid` | 素材 ID，remove/status 建议传 |
| `--name` | 素材显示名（add 用，建议带 `.mp4`） |
| `--status` | list 过滤：`1`投放中 / `2`已删除 / `all` |
| `--confirm` | L2 门禁：add/remove 必须 `true`，省略只出预览 |
| `--account` | 账号 shopKey（多账号时必填） |

## 接口清单（实测）

| 用途 | 接口 |
|---|---|
| 素材清单 + 12指标 | `POST /ad/api/pmc/v1/uni-promotion/material/list-required` |
| 素材元信息（封面/时长） | `GET /ad/api/creation/v1/material/get-video-play-info?vid=` |
| 绑定视频到 owner（拿 mid） | `POST /ad/api/creation/material/bind-video-to-owner` |
| 添加素材到计划 | `POST /ad/api/pmc/v1/uni-promotion/material/add-uni-prom-materials` |
| 移除素材 | `POST /ad/api/pmc/v1/uni-promotion/material/set-opt` (`optType:"delete"`) |
| 素材审核状态 | `POST /ad/api/pmc/v1/uni-promotion/material/list-optional` |
| 计划列表（取 adId/productId） | `POST /ad/api/pmc/v1/uni-promotion/ad/list-required` |

## 素材清单返回的 12 项指标

```
展现 / 点击 / 点击率 / 转化率 / 消耗 / 订单
成交GMV / GMV / ROI / 单均成本 / CPM / CPC
```

外加：`mid`（素材ID）、`vid`（视频ID）、`name`、`status`（1投放中/2已删除）、`videoType`、`uploadTime`、`cover`、`duration`、`tags`

## ★ 三个必须知道的坑

### 1. 删最后一条素材必报 4065

```
{"code":4065,"message":"操作失败，至少需要一个视频/图文用于投放"}
```

**必现，不是偶发。** 计划里只剩一条素材时，正常删一定被拦。
解法：同一个 body 加 `ForceDelete: true` 重试。**脚本已自动处理。**

### 2. 素材显示名由 `bind-video-to-owner` 的 `file_name` 决定

不传 `file_name` 或传 vid，UI 上素材名就显示成一串 vid，很难认。
**解法**：`--name "xxx.mp4"` 显式指定。脚本会把 `file_name` 传进去。

### 3. `list-optional` 的 audit 字段与 UI 不一致

```
接口 materialAuditStatus = 1（未审核）
UI 显示 = 审核通过
```

该接口的 `materialId` 也返回 `"0"`（占位值），说明它不是审核状态的权威来源。
**以浏览器页面显示为准**，接口值仅供参考。

## 其他已知点

| 坑 | 说明 |
|---|---|
| 素材清单 body 结构特殊 | 不是 `Params/AdFilter`，是 `Filters.Conditions` + `DataSetKey=site_promotion_product_post_data_video` + 9 个 Dimensions，少字段返回空 |
| 封面 URL 有时效 | `get-video-play-info` 返回的封面是带签名的私有 CDN URL，约 24h 过期 |
| 素材状态只有 2 个值 | `1=投放中` / `2=已删除`，**没有「已暂停」** |
| 加素材要商品 ID | 从 `ad/list-required` 的 `adGoodsMap[adId]` 取，脚本会自动探查 |

## 工作流

### W1：看计划里有哪些素材、哪条跑得好

```
① material-ops --mode list --status 1        → 投放中的素材 + 12 指标
② 看「消耗 / 成交GMV / ROI / 点击率」
③ 消耗高但 ROI 低的 → 考虑删掉它（--mode remove）
④ 想看更细的播放率/完播率 → 用 douyin-material-report --mode report
```

### W2：把一条视频加进计划

```
① 先拿 vid（视频库或已有素材的 vid）
② material-ops --mode video --vid xxx    → 确认 vid 有效、看时长和封面
③ material-ops --mode add --vid xxx --name "xxx.mp4"           → 预览
④ 确认后加 --confirm true                                       → 真提交
⑤ material-ops --mode list --status 1     → 回读确认「投放中」
```

### W3：删一条素材

```
① material-ops --mode list                → 拿 mid 和 vid
② material-ops --mode remove --vid xxx --mid xxx   → 预览
③ 确认后加 --confirm true                           → 真提交（自动 ForceDelete）
④ material-ops --mode list --status 1     → 回读确认已不在
```

## 错误处理

| 场景 | failureKind | 引导 |
|---|---|---|
| 未绑定账号 | `not_bound` | 去「账号连接」添加抖音小店账号 |
| 多账号未指定 | `need_account_choice` | 从 `candidates` 选一个填 `--account` |
| `4065 至少需要一个视频` | — | **正常现象**，脚本自动 ForceDelete 重试 |
| `3001 / code=2` | `bad_input` | body 字段缺了，检查 Filters/Conditions |
| `video` 报「视频Meta字段缺失」 | — | 该 vid 不是自己的素材，或已失效 |
| 账户下没有计划 | `bad_input` | 先在千川后台建计划 |

## 风控与权限

| 项 | 状态 |
|---|---|
| 读（list/video/status） | 纯 HTTP，无副作用 |
| 写（add/remove） | L2 两步预览门禁 |
| 浏览器 | **不需要**，实测浏览器全关也能跑通 |
| 签名 | 不需要 a_bogus/verifyFp（实测带与不带都 code=0） |
| 账号权限 | `createAuthEnable=false` 不影响素材增删（实测可写） |

## 相关文档

- [[抖音计划管理逆向]] — 计划启停（douyin-plan-ops）
- [[抖音素材分析]] — 素材维度 35 项报表（douyin-material-report）
- [[抖音全域投放逆向]] — 投放数据（douyin-uni-prom）
