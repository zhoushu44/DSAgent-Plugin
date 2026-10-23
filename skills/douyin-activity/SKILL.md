---
name: douyin-activity
description: "抖音小店·活动报名查询（只读）：活动总览（可报名活动/类型数）、可报名活动列表、活动类型清单、报名记录列表。数据源：抖店后台 fxg.jinritemai.com 营销活动子应用。全部只读，HTTP + 浏览器 hook 页面响应取数，无平台副作用。触发：抖音活动、抖店活动、抖店报名、大促报名、秒杀报名、活动列表、活动类型、报名记录、douyin activity。排除：商品查询（用 douyin-goods）、订单查询（用 douyin-order）、推广数据（用 douyin-promo）、店铺经营数据（用 douyin-shop）。需绑定「抖音小店」账号。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "抖音小店·活动报名"
    emoji: "🎯"
    requires: {}
---

# 抖音小店 · 活动报名

> **只读技能**：本版本所有操作均为查询，**不产生任何平台写操作**，无需 L2 确认。
>
> **规划中（L2，本版不实现）**：报名 / 取消报名。
> contract 已预留 `--confirm` 参数位，写模式落地时按两步走门禁接入。

## 何时使用

- 用户说「有哪些活动能报」「抖店活动」「大促报名」→ 用本技能
- 要看**可报名活动**列表（含活动时间/报名截止）→ `list` 模式
- 要看**活动类型**（秒杀/满减/多件优惠…）→ `types` 模式
- 要查**报名记录**（报了哪些/审核状态）→ `records` 模式
- 要**一眼看活动全貌** → `overview` 模式

## 能力

| 模式 | 类型 | 说明 |
|------|------|------|
| `overview` | 只读 | 活动总览：类型数 + 可报名活动数 + 推荐活动（默认） |
| `list` | 只读 | 可报名活动列表（活动ID/名称/类型/时间/报名截止） |
| `types` | 只读 | 活动类型清单（含关键词说明） |
| `records` | 只读 | 报名记录列表（含活动ID、商品、状态——取消操作的参数来源） |
| `enroll` | **规划中** | 报名（L2，本版不实现） |
| `quit` | **规划中** | 取消报名（L2，本版不实现） |

## 前置条件

1. **账号已绑定**：「账号连接」页已绑定**抖音小店（抖店）**账号（platform=`douyin_shop`，抖店后台 `fxg.jinritemai.com`）。★ 与内容平台 `douyin` 是**两套独立登录态**：抖音账号的 Cookie 进不了抖店后台（实测跳登录页），必须单独扫码登录一次抖店。
2. **登录态有效**：失效时技能会返回 `token_expired`，引导用户重新登录。
3. **Chrome 可用**（活动子应用需要页面环境取数）。

## 输入

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `--mode` | string | 否 | overview(默认) / list / types / records |
| `--limit` | number | 否 | 返回条数上限，默认 20，上限 100 |
| `--confirm` | flag | 预留 | 写操作确认门禁；本版无写操作，预留参数位 |
| `--account` | string | 否 | 账号 shopKey；多账号未绑定时先向用户确认 |

## 输出

| 字段 | 含义 |
|------|------|
| `ok` | 是否成功 |
| `mode` | 实际执行的模式 |
| `activityTypes` | 活动类型数组——**待探测回填** |
| `activities` | 可报名活动数组——**待探测回填** |
| `recommended` | 推荐活动——**待探测回填** |
| `records` | 报名记录数组——**待探测回填** |
| `text` | 面向用户的中文文案，原样转述 |

## 用法

```bash
# 活动总览 / 列表 / 类型 / 报名记录
node {baseDir}/scripts/activity.mjs --mode overview
node {baseDir}/scripts/activity.mjs --mode list
node {baseDir}/scripts/activity.mjs --mode types
node {baseDir}/scripts/activity.mjs --mode records

# ── 写操作（L2，规划中，本版不实现）──
# 落地后按两步走：先不带 --confirm 拿预览 → 用户同意 → 带 --confirm true 执行
```

## 工作流

### W1：看有哪些活动能报

```
① 调 activity.mjs --mode overview       → 推荐活动 + 可报名活动数 + 活动类型
② 用户想看全部 → --mode list
③ 想知活动类型含义 → --mode types
```

### W2：报名一个活动（规划中）

```
① 调 --mode list 拿 activity_id（或从后台活动页看 URL）
② 调 --mode enroll --activity-id X --goods-id Y  → 拿预览（落地后）
③ 用户同意后带 --confirm true 执行
④ ⚠️ 本版未实现 enroll，当前只能查；报名需到抖店后台手动操作
```

### W3：查我报过哪些活动

```
① 调 activity.mjs --mode records        → 报名记录（活动ID/商品/状态）
② 需要看商品规格 → 取商品 ID 后调 douyin-goods --mode sku
③ 需要看活动效果 → 结合 douyin-shop --mode goods 对比数据
```

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定抖音小店账号 | `not_bound` | 引导到「账号连接」添加**抖音小店**账号 |
| 平台有多个账号且未指定 | `need_account_choice` | 把候选账号列表给用户选，把选定 shopKey 填进 `--account` 重调；★ 不要自己挑一个 |
| 登录态失效 | `token_expired` | 引导到「账号连接」重新登录 |
| 浏览器 profile 被占用 | `api_error` | 稍后重试，或先关闭已弹出的后台窗口 |
| 接口未回填（当前为桩） | `api_error` | 先跑 `_douyin_probe` 探测脚本，把真实接口回填进 APIS 常量 |
| 未知 mode | `api_error` | 用 overview/list/types/records 之一 |
| 返回空列表 | — | 当前没有可报名活动/报名记录，属正常（不是故障） |

## 技术说明

### 取数方式

营销活动是抖店后台内的子应用（`fxg.jinritemai.com`），接口前缀分散
（探测已见 `/byteshop/*`、`/b/a/api/*`），响应体统一为 `{st, code, msg, data}`。
风控签名由页面 JS 运行时生成（`verifyFp` / `msToken` / `_bid` / `_lid` 等），
纯 HTTP 请求恒被拒，故采用「**打开页面 → hook 页面自己发的响应**」
（`Network.responseReceived` + `Network.getResponseBody`）取数，
与 `pdd-activity` 同源思路。

### 接口（待探测回填）

| 用途 | 接口 path 片段 | 状态 |
|------|----------------|------|
| 活动总览 / 推荐 | **待探测回填** | ⏳ 未回填 |
| 可报名活动列表 | **待探测回填** | ⏳ 未回填 |
| 活动类型清单 | **待探测回填** | ⏳ 未回填 |
| 报名记录 | **待探测回填** | ⏳ 未回填 |

> ⚠️ **当前是桩实现**：`scripts/activity.mjs` 里的 `APIS` 常量只有占位 key，
> 尚未回填真实接口 path。在回填前，脚本会明确返回
> `{ok:false, failureKind:'api_error', text:'接口待回填：先跑探测脚本'}`，
> **不会伪造成功数据**。

### 回填方法

1. 跑 `node skills/_douyin_probe/probe.mjs`，打开抖店后台活动页采集接口；
2. 从 `probe-out/hits-*.json` 里按响应内容定位目标接口；
3. 把接口 path 片段填进 `scripts/activity.mjs` 的 `APIS` 常量，并删掉桩判断。

### 浏览器环境

- `profileDir('douyin_shop', shopKey)` 定位账号独立 profile（与内容平台 `douyin` 分开）；
- `tryAcquireProfile` / `releaseProfile` / `clearProfileLocks` 保证同一账号
  不会并发起两个浏览器；
- `headless: false` + `--no-sandbox --disable-blink-features=AutomationControlled`
  保持与 `douyin-works` 一致的反检测配置。
