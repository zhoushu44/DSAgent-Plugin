---
name: douyin-plan-ops
description: "抖音·全域投放计划管理：千川计划列表/暂停/开启。逆向自千川「全域投放」计划管理页（/uni-prom）。纯 Node HTTP 直连（免签名、免浏览器），v2.0 已把浏览器链路全部替换为 HTTP。list 只读；stop/start 为 L2 写操作（先预览后执行）。触发：抖音计划管理、暂停推广计划、开启推广计划、全域投放计划、千川计划列表、douyin plan ops。排除：投放数据报表（用 douyin-uni-prom）、素材增删（用 douyin-material-ops）、素材分析（用 douyin-material-report）、商品/订单查询（用 douyin-goods/douyin-order）。需绑定「抖音小店」账号。"
metadata:
  builtin_skill_version: "2.0"
  dsagent:
    display_name: "抖音·计划管理"
    emoji: "⏯️"
    requires: {}
---

# 抖音 · 全域投放计划管理（douyin-plan-ops）v2.0

## ★ v2.0 重写：浏览器 → 纯 Node HTTP

| | v1.x（旧） | v2.0（本版） |
|---|---|---|
| 计划列表 | 起 Chrome → `safeEval` 调接口 | **纯 HTTP**，~1s |
| 启停 | 找 `.ovui-switch` 点击 | **纯 HTTP** `batch_update_operation` |
| 浏览器 | 必需（15~20s） | **完全不需要** |
| 列表可靠性 | ⚠️ 浏览器链路失败会**静默返回 0 条** | 接口失败直接报错，不静默 |

### 旧版踩过的坑（已修）

```
① list 走浏览器 safeEval 包 fetch，任何异常都被 catch 吞掉 → 返回 []
   现象：明明有 1 条计划，却报「计划数：0」，而且不报错
   实测：同一份 body 直接 HTTP 调用 → adInfos=1，正常

② 启停依赖 .ovui-switch DOM 结构，页面改版就废
   实测：batch_update_operation 纯 HTTP 就能调通，code=0 flag=true

③ 旧版 L2 预览门禁在某些分支后没 return，可能继续往下执行
   本版每个提前返回点都显式 process.exit(0)
```

## 用法

```bash
# 计划列表（只读）
node scripts/plan-ops.mjs --mode list
node scripts/plan-ops.mjs --mode list --start 2026-08-01 --end 2026-11-12

# 暂停计划（L2 两步）
node scripts/plan-ops.mjs --mode stop --ad_id 1835712799161914
# 确认后
node scripts/plan-ops.mjs --mode stop --ad_id 1835712799161914 --confirm true

# 开启计划（L2 两步）
node scripts/plan-ops.mjs --mode start --ad_id 1835712799161914 --confirm true
```

### 参数

| 参数 | 说明 |
|---|---|
| `--mode` | `list`(默认，只读) / `stop`(L2) / `start`(L2) |
| `--ad_id` | 计划 ID，stop/start 必填，从 `--mode list` 拿 |
| `--confirm` | L2 门禁：必须 `true` 才真正执行；省略只出预览 |
| `--mar_goal` | `1`=推商品（默认）/ `2`=推直播间 |
| `--start` / `--end` | 统计日期 `YYYY-MM-DD`，默认今天 |
| `--limit` | 条数上限，默认 20，最大 100 |
| `--account` | 账号 shopKey（多账号时必填） |

## 接口（全部实测）

| 用途 | 接口 |
|---|---|
| 账户 ID | `GET /ad/api/v1/account/account-info/get-customer-id` |
| 计划列表 | `POST /ad/api/pmc/v1/uni-promotion/ad/list-required` |
| **计划启停** | `POST /ad/api/pmc/v1/batch_update_operation` |

### 启停接口体

```json
{
  "objects": [{ "objectID": "1835712799161914", "type": 1 }],
  "optType": 2
}
```

| optType | 含义 |
|---|---|
| `1` | 开启（Enable） |
| `2` | 暂停（Pause） |

返回：`{"status_code":0,"message":"success","data":{"results":[{"flag":true,...}]}}`

### 计划状态判定

```
adDeliveryType === 0  → 投放中
adDeliveryType !== 0  → 已暂停 / 停投
operation.optStatusOperation.editable → 是否允许启停
```

## 已知限制

| 项 | 说明 |
|---|---|
| `list-summary` 接口 | **没实现**。旧文档说有这个接口，但它需要特定 body，且返回的是汇总数不是列表，本版直接不用它 |
| 时间跨度 | 部分接口限制 180 天，超出会报 `code=3000 距今跨度时间不能超过「180」天` |
| 金额单位 | `budget="30000000"` → 页面 300 元，换算 `/100000` |
| 权限 | 本账号 `createAuthEnable=false`（仅观察）**不影响**计划启停，实测可停可开 |

## 工作流

### W1：看有哪些计划

```
① plan-ops --mode list
② 读 text：计划名/ID/状态/预算/ROI/消耗/权限
③ 想看投放数据 → douyin-uni-prom --mode overview
```

### W2：暂停某个计划

```
① plan-ops --mode list                    → 拿 ad_id
② plan-ops --mode stop --ad_id xxx        → 预览（只出文本，不动）
③ 确认后加 --confirm true                  → 真执行 + 自动回读校验
④ 看返回的 verified: true 才算成功
```

### W3：开启计划

同上，`--mode start`。

## 错误处理

| 场景 | failureKind | 引导 |
|---|---|---|
| 未绑定账号 | `not_bound` | 去「账号连接」添加抖音小店账号 |
| 多账号未指定 | `need_account_choice` | 从 `candidates` 选一个填 `--account` |
| 缺 `--ad_id` | `bad_input` | 先 `--mode list` 拿 ID |
| 计划不存在 | `bad_input` | 返回 `available` 列表 |
| 无启停权限 | `permission_denied` | 平台侧权限限制 |
| 已是目标状态 | 无错 | `noop: true`，不会重复执行 |

## 风控与安全

| 项 | 状态 |
|---|---|
| 读（list） | 纯 HTTP，无副作用 |
| 写（stop/start） | **L2 两步预览门禁**，必须在 `--confirm true` 下才执行 |
| 浏览器 | 不需要（实测浏览器全关可跑） |
| 签名 | 不需要 a_bogus/verifyFp（实测带与不带都 code=0） |
| 回读校验 | 执行后自动重新拉列表核对，返回 `verified` |

## 相关文档

- [[抖音素材管理]] — 素材增删查（douyin-material-ops）
- [[抖音素材分析]] — 素材维度报表（douyin-material-report）
- [[抖音全域投放逆向]] — 投放数据（douyin-uni-prom）
