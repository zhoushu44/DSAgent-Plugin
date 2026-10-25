---
name: douyin-plan-ops
description: "抖音·全域投放计划管理：千川计划列表/暂停/开启。逆向自千川「全域投放」计划管理页（/uni-prom）。list 只读；stop/start 为 L2 写操作（先预览后执行）。计划状态看 adDeliveryType，启停走「真实浏览器点击 .ovui-switch」路线（接口有 verifyFp/a_bogus 签名，手工 fetch 一律 40002）。触发：抖音计划管理、暂停推广计划、开启推广计划、全域投放计划、千川计划列表、douyin plan ops。排除：投放数据报表（用 douyin-uni-prom）、素材分析（用 douyin-material-report）、商品/订单查询（用 douyin-goods/douyin-order）。需绑定「抖音小店」账号。"
metadata:
  builtin_skill_version: "1.1"
  dsagent:
    display_name: "抖音·计划管理"
    emoji: "⏯️"
    requires: {}
---

# 抖音 · 全域投放计划管理（douyin-plan-ops）

> 逆向自千川「全域投放」计划管理页（路由 `/uni-prom`）
> 数据源实测 2026-10-25，均可用。

## 何时使用

- 用户说「暂停某个推广计划」「开启计划」→ 本技能
- 用户说「看我有哪些投放计划」→ 本技能 `--mode list`
- 用户要看**投放数据/报表** → 用 `douyin-uni-prom`（本技能只管启停）
- 用户要看**素材分析** → 用 `douyin-material-report`

## 背景：千川菜单已改版

```
旧版菜单「视频推广 / 直播推广 / 商品推广」已全部下线，
合并为「全域投放」，页面路由 /uni-prom，内部按 MarGoal 区分：
  1 = 推商品
  2 = 推直播间
```

视频不再是推广对象，而是**投放素材**（抖音号视频 / 本地上传 / 直播剪辑）。

## 用法

```bash
# 计划列表（只读）
node scripts/plan-ops.mjs --mode list

# 暂停计划（L2，两步）
node scripts/plan-ops.mjs --mode stop  --ad_id 1835712799161914
# 确认后
node scripts/plan-ops.mjs --mode stop  --ad_id 1835712799161914 --confirm true

# 开启计划（L2，两步）
node scripts/plan-ops.mjs --mode start --ad_id 1835712799161914 --confirm true
```

### 参数

| 参数 | 说明 |
|---|---|
| `--mode` | `list`（默认，只读）/ `stop`（L2）/ `start`（L2） |
| `--ad_id` | 计划 ID，stop/start 必填，从 `--mode list` 拿 |
| `--confirm` | L2 门禁：必须带 `true` 才真正执行；省略只出预览 |
| `--mar_goal` | `1`=推商品（默认）/ `2`=推直播间 |
| `--start` / `--end` | 统计日期 `YYYY-MM-DD`，默认今天 |
| `--limit` | 条数上限，默认 20，最大 100 |
| `--account` | 账号 shopKey（可选） |

## 数据源接口（实测可用）

```
POST /ad/api/pmc/v1/uni-promotion/ad/list-required   计划列表（含权限）
POST /ad/api/pmc/v1/uni-promotion/ad/list-summary    计划汇总数
POST /ad/api/pmc/v1/uni-promotion/ad/list-optional   计划附加模块
```

## 计划状态判定

```js
adDeliveryType === 0   → 投放中
adDeliveryType !== 0   → 已暂停 / 停投

operation.optStatusOperation.editable   → 是否允许启停
```

## ★ 启停实现路线（核心踩坑）

千川启停接口有 **verifyFp / a_bogus 签名**，手工 `fetch` 一律返回 `40002`。

**唯一可靠路线是「真实浏览器 + 点击页面开关」**，脚本会：

```
1. 打开计划管理页，切到「推商品 → 商品自选」
2. 定位计划行的 .ovui-switch（--checked = 投放中）
3. 点击并等待请求完成，再回读开关状态验证
```

### 已知坑

```
· 不要调用 applyAccountEnv：它会把视口压回 1440x900，破坏指纹自洽
```

## 风控与权限

| 项 | 状态 |
|---|---|
| 读（list） | HTTP + 浏览器 hook 页面响应，无副作用 |
| 写（stop/start） | **L2 两步预览门禁** —— 省略 `--confirm` 只出预览 |
| 账号要求 | 需绑定「抖音小店」（`douyin_shop`） |
| 无写权限时 | 会明确提示，不会静默失败 |

## 写操作未覆盖的情况

若账号是「仅观察」权限（`createAuthEnable=false`），点击上传/新建会弹「没有操作权限」。
这**与接口可用性无关**，是平台侧账号权限。用 `douyin-uni-prom --mode perm` 自查。

## 相关文档

- [[抖音全域投放逆向]] — 数据报表与总览（douyin-uni-prom）
- [[抖音素材分析]] — 素材维度报表（douyin-material-report）
- [[拼多多推广平衡算法使用指南]] — 拼多多侧的同类能力
