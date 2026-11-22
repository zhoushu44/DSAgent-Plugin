---
name: douyin-activity
description: "抖音小店·营销活动查询（只读）：营销工具清单（24 个：单品直降/优惠券/满减/赠品/裂变等，含入口URL与适用场景）、营销总览（权限+工具数+活动数+推广数据）、满减多件优惠活动列表、营销推广数据、活动报名权限自检。数据源：抖店后台 fxg.jinritemai.com marketing 域，纯 Node 直连（抖店只读免签）。全部只读，无平台副作用。触发：抖音活动、抖店活动、营销工具、优惠券、满减、单品直降、活动列表、报名权限、douyin activity。排除：商品查询（douyin-goods）、订单查询（douyin-order）、推广数据用 douyin-uni-prom、店铺经营用 douyin-shop。需绑定「抖音小店」账号。"
metadata:
  builtin_skill_version: "2.0"
  dsagent:
    display_name: "抖音小店·营销活动"
    emoji: "🎯"
    requires: {}
---

# 抖音小店 · 营销活动

> **只读技能**：所有操作均为查询，**不产生任何平台写操作**，无需 L2 确认。
>
> **本版不实现写操作**：报名 / 取消报名（`enroll` / `quit`）会明确返回错误，不假装支持。

## ★ 2026-11-11 重要变更

**本技能从「平台活动报名」重新定位为「营销活动 & 工具」。**

实测发现：本账号 `get_activity_gray = { enable: false, membership: false, msg: "无该配置" }`
→ 该店铺**没有平台活动报名权限**（抖音大促 / 秒杀等官方活动）

但有**自建营销工具**权限，共 **24 个**（单品直降 / 优惠券 / 满减 / 赠品 / 裂变 / 搭配购…）。

所以现在能查的是「营销工具 + 满减活动 + 营销数据」，不是「官方活动报名」。
如果将来账号拿到平台活动权限（`enable=true`），再补报名类接口。

**性能**：改造前 goto 页面 + sleep(12000)；现在纯 Node，`overview` 约 4s、单模式 0.5~1s。

## 何时使用

- 「我有哪些营销工具能用」→ `tools`
- 「优惠券 / 满减 / 单品直降怎么开」→ `tools`（拿入口 URL）
- 「我的满减活动有哪些」→ `list`
- 「营销效果怎么样」→ `data`
- 「我能不能报平台活动」→ `perm`
- 一眼看营销全貌 → `overview`

## 能力

| 模式 | 类型 | 说明 |
|------|------|------|
| `overview` | 只读 | 营销总览：权限 + 工具数 + 满减活动数 + 推广数据字段（默认） |
| `tools` | 只读 | 营销工具清单（24 个，含名称/描述/标签/入口 URL/适用场景） |
| `list` | 只读 | 满减/多件优惠活动列表（`--status` 筛选） |
| `data` | 只读 | 营销推广数据（近 7 天：券领取/使用、营销优惠额、转化率、支付金额） |
| `perm` | 只读 | 活动报名权限自检（`enable` / `membership`） |
| `enroll` / `quit` | **不实现** | L2 写操作，明确拒绝 |

## 前置条件

1. **账号已绑定**：「账号连接」页已绑定**抖音小店（抖店）**账号（platform=`douyin_shop`）。
   ★ 与内容平台 `douyin` 是**两套独立登录态**，必须单独扫码登录一次抖店。
2. **登录态有效**：失效返回 `token_expired`，引导重新登录。
3. **无需 Chrome**：纯 Node 直连（抖店只读接口免签，实测见 `_douyin_node_probe/REPORT.md`）。

## 输入

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `--mode` | string | 否 | overview(默认) / tools / list / data / perm |
| `--limit` | number | 否 | `list` 返回条数上限，默认 20，上限 100 |
| `--status` | number | 否 | `list` 的活动状态筛选，默认 0 |
| `--account` | string | 否 | 账号 shopKey；多账号未绑定时先向用户确认 |

## 输出

| 字段 | 含义 |
|------|------|
| `ok` | 是否成功 |
| `mode` | 实际执行的模式 |
| `activityPermission` | `{enable, membership, note}` 平台活动权限 |
| `tools` | 营销工具数组（`name`/`desc`/`listUrl`/`tags`/`scenes`） |
| `toolCount` | 工具数量 |
| `total` / `activities` | 满减活动总数 / 活动列表 |
| `promoData` | 营销推广数据（`stats_data` 含券/优惠/转化指标） |
| `perf` | 各接口耗时（ms），用于验证纯 Node 收益 |
| `text` | 面向用户的中文文案，原样转述 |

## 用法

```bash
# 营销总览
node {baseDir}/scripts/activity.mjs --mode overview

# 24 个营销工具清单（含入口 URL）
node {baseDir}/scripts/activity.mjs --mode tools

# 满减活动列表
node {baseDir}/scripts/activity.mjs --mode list --status 0 --limit 20

# 营销推广数据
node {baseDir}/scripts/activity.mjs --mode data

# 权限自检
node {baseDir}/scripts/activity.mjs --mode perm
```

## 工作流

### W1：用户问「我能搞什么促销」

```
① activity.mjs --mode overview   → 权限 + 工具数 + 活动数
② 若用户要具体入口 → --mode tools → 给出 listUrl
③ 用户想开某个工具 → 把 listUrl 拼 https://fxg.jinritemai.com 交给用户在浏览器操作
   （★ 本技能只读，不代用户创建活动）
```

### W2：用户问「我报了哪些活动」

```
① activity.mjs --mode perm   → enable=false 说明没有平台活动权限
② 若 enable=false → 明确告诉用户「该店无平台活动报名权限」，
   不要硬找报名记录（接口不存在，硬查会返回空）
③ 若 enable=true → 用 --mode list 查满减活动
```

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定抖音小店账号 | `not_bound` | 引导到「账号连接」添加**抖音小店**账号 |
| 多账号未指定 | `need_account_choice` | 把候选列表给用户选，不要自己挑 |
| 登录态失效 | `token_expired` | 引导重新登录 |
| 环境风险 `10001010A` | `api_error` | 冷却 5 分钟；检查是否误带签名字段 |
| 调 `enroll` / `quit` | `api_error` | 明确说明本版不实现写操作 |

## 技术说明

### 取数方式

**纯 Node 直连**（2026-11-11 起）。抖店 `marketing` 域只读接口免签 ——
剥掉 `a_bogus/verifyFp/fp/msToken/__token/_bid/_lid` 后仍返回 `st=0`。

### 接口

| 用途 | 接口 | 参数 |
|------|------|------|
| 营销工具清单 | `POST /marketing/pc/v1/common/get_marketing_homepage_tools` | `from_platform=1&appid=1`，body `{}` |
| 满减活动列表 | `GET /marketing/activity/v1/query_full_discount_activity` | `activity_status&page&pageSize&appid` |
| 营销推广数据 | `GET /marketing/marketing_data/v1/query_promotion_data` | `source_type&date_type&from_platform&appid` |
| 活动权限 | `GET /marketing/activity/v1/get_activity_gray` | `from_platform&appid` |

全部登记在基座 `skills/_shared/douyin-registry.mjs`（`marketing.*`）。

### 已知坑

| 坑 | 现象 | 说明 |
|---|---|---|
| 活动子应用路由会重定向 | `/ffa/marketing/activity` → `/ffa/marketing/home` | 直接 goto 子页面拿不到数据，改走接口 |
| 菜单树里没有活动入口 | `byteshop/menu/navigate` 只返回 21 个节点，无营销项 | 活动权限由 `get_activity_gray` 决定，不由菜单决定 |
| `tool_cates[].label` 可能为空 | 前 5 个分类 label 是空串 | 用 `strategy_tools` 数组长度判断 |
| 卡片字段名是 `strategy_name` | 不是 `name`/`title` | 字段口径见 `probe-12-marketing.json` |
