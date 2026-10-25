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

## ★ 取数方式：必须 hook 页面自己的响应

千川接口带 **verifyFp / fp 签名参数**，手工 `fetch` 会撞
「路径权限校验失败」(`status_code 40002`)。

**所以必须「打开页面 → hook 页面自己发的响应」**，不能主动 fetch。

## 用法

```bash
node scripts/uni-prom.mjs --mode overview                          # 投放总览
node scripts/uni-prom.mjs --mode report --start 2026-10-01 --end 2026-10-24
node scripts/uni-prom.mjs --mode report --dimensions stat_time_day,marketing_goal
node scripts/uni-prom.mjs --mode plans                             # 计划列表
node scripts/uni-prom.mjs --mode materials                         # 素材来源
node scripts/uni-prom.mjs --mode awemes                            # 已授权抖音号
node scripts/uni-prom.mjs --mode perm                              # 写权限自检
node scripts/uni-prom.mjs --mode material-report                   # 素材分析报表
node scripts/uni-prom.mjs --mode material-report --material_type 3 --limit 20
```

### 参数

| 参数 | 说明 |
|---|---|
| `--mode` | `overview`（默认）/ `report` / `plans` / `materials` / `awemes` / `perm` / `material-report` |
| `--start` / `--end` | `YYYY-MM-DD`，默认今天 |
| `--mar_goal` | `1`=推商品（默认）/ `2`=推直播间 |
| `--material_type` | material-report 专用：`3`=视频素材（默认）/ `1`=直播间画面 / `2`=图片 / `4`=图文 / `5`=标题 |
| `--dimensions` | report 维度，逗号分隔，如 `stat_time_day,marketing_goal` |
| `--metrics` | report 指标，逗号分隔 |
| `--offset` | material-report 分页偏移，默认 0 |
| `--limit` | 条数上限，默认 20，最大 100 |
| `--account` | 账号 shopKey（可选） |

## 能力清单

| mode | 产出 |
|---|---|
| `overview` | 投放总览：余额 + 账户 + 今日/昨日核心指标 |
| `report` | 报表：消耗/GMV/订单/ROI，按维度汇总，支持自定义日期 |
| `plans` | 计划列表与汇总 |
| `materials` | 素材列表（抖音号视频，即「视频推广」的素材面） |
| `awemes` | 已授权抖音号列表 |
| `perm` | 写权限自检（能否上传/启停/新建） |
| `material-report` | 素材分析报表（数据-全域数据-素材数据-视频素材） |

## 已知踩坑（2026-10-24 实测）

```
★ 必须复用正式 profile 目录，不能用独立临时目录
★ 不要 setCookie 注入账号 cookies
★ 不带 aavid：账号的 account_id 是本地 hash（如 7592d93b...），
  不是千川广告主 ID
★ 入口 URL 实测见脚本头部
★ CDP 必须在 goto 之后挂：SPA 会重定向 /uni-prom → /home，
  goto 前挂的 session 会失效
⚠️ 金额单位见脚本注释（已实测确认）
```

## 写操作未实现（平台权限，非技术问题）

```
上传视频 / 启停 / 新建 —— 当前账户为「仅观察」权限
（createAuthEnable=false），点击会弹「没有操作权限」。

这与接口可用性无关，是平台侧账号权限。
用 --mode perm 自查权限状态。
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
