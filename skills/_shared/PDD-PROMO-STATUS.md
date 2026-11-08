# 推广域剩余 10 个接口 · 攻坚结果

> 2026-11-08
> 结论：**抓到 1 个新接口参数，其余仍卡在推广域限流**

---

## 一、本轮新增

### ✅ 抓到 `queryRangeReport` 完整参数

```json
{
  "clientType": 1,
  "entityId": 800050996,
  "queryDimensionType": 0,
  "endDayHour": 9,
  "endDate": "2026-11-08",
  "startDate": "2026-11-01",
  "returnLastUpdateTime": true,
  "reportPromotionType": 9,
  "blockTypes": [1]
}
```

**这是推广报表的核心接口**（`/mms-gateway/poseidon/api/report/queryRangeReport`）。

### ✅ 确认 `accountAll` 参数为空

```json
{}
```
只需 `crawlerInfo`。

### ✅ 新增混合模式模块

`pdd-promo-hybrid.mjs` —— 浏览器签名 + Node 请求

```
初始化浏览器   13615ms（一次性）
每次签名          37ms
每次请求        84~201ms
```

**好处：签名质量 = 真实浏览器级别，请求走 Node。**

---

## 二、未抓到的 8 个

| 接口 | 为什么没抓到 |
|---|---|
| `promotion/v3/list` | 推广列表页需开通推广账户才加载 |
| `promotion/detail` | 同上（需点击计划行） |
| `updateMaxCost` | 需点「修改预算」弹窗并提交 |
| `batchUpdateBid` | 需点「批量改价」 |
| `batchCreate` | 需走完建计划流程 |
| `batchUpdateStatus` | 需点「批量启停」 |
| `virtual/delete` | 需点「删除」 |
| `listAdGroupInfo` | 需展开计划详情 |

**共同点：都需要真实点击交互，无法只靠打开页面触发。**

---

## 三、当前卡点：推广域限流

### 证据

```
checkToken（免签名）  → ✅ 1000  账号完全正常
accountAll（带签名）   → ❌ 54001
dailyCost（带签名）    → ❌ 54001  ← 之前成功过的也失败了
```

### 判断

**推广域有独立的接口级限流，比商品域严格得多。**

本轮为了抓参数，打开了 3 个推广页面 + 多次重放，触发限流。

### 恢复时间

未知。可能需要几小时。

---

## 四、推广域能力现状

### ✅ 已确认可用（历史上成功过）

| 接口 | 参数 | 备注 |
|---|---|---|
| `promo.dailyCost` | `{}` | 需浏览器签名 |
| `promo.checkToken` | `{}` | **免签名**，纯 Node 可通 |

### ⚠️ 参数已抓但未验证

| 接口 | 参数 |
|---|---|
| `queryRangeReport` | 见上（9 个字段） |
| `accountAll` | `{}` |

### ❌ 参数未抓

8 个写操作/列表接口（见上表）

---

## 五、正确的推广域调用方式

### 推荐：混合模式

```js
import { initPromoBrowser, callPromoHybrid, closePromoBrowser }
  from './skills/_shared/pdd-promo-hybrid.mjs'

await initPromoBrowser()          // 13615ms，一次性
const r = await callPromoHybrid(
  '/mms-gateway/reinhardt/invoice/getAdvertiserDailyCosts',
  {}
)
await closePromoBrowser()
```

**优势：**
- 签名质量与真实浏览器一致
- 请求走 Node（可并发、可拦截）
- 不用每次跳页面

### 不推荐：纯 Node jsdom

```js
// pdd-promo-signer.mjs
// 问题：jsdom 环境采集项不足，签名质量不稳定
```

**实测：同样的代码，第一次成功，之后全部失败。**

---

## 六、下一步建议

### 如果想继续攻推广域

**必须解决限流**：
1. 等足够长时间（几小时）
2. 用另一个账号
3. 严格控制调用频率（每次间隔 ≥ 30 秒）

**抓写操作参数**：
- 需要真实点击 UI（修改预算、批量操作）
- 风险：可能真的提交
- 建议：在测试账号上做，或抓住请求后立即取消

### 如果接受现状

**推广域只用 `dailyCost` + `checkToken`**，其他走浏览器。

---

## 七、诚实评估

| 项 | 状态 |
|---|---|
| 推广域 SDK 提取 | ✅ 完成（100KB 源码） |
| 签名机制逆向 | ✅ 完成 |
| 纯 Node 签名 | ⚠️ 不稳定（时好时坏） |
| 混合模式 | ✅ 可用（浏览器签名） |
| 参数抓取 | ⚠️ 2/10 |
| 写操作验证 | ❌ 未做 |

**投入产出比已明显下降。**

推广域接口数量少（10 个）、调用频率低（一天几次），**用浏览器成本可接受**。

---

## 相关

- [[PDD-API-STATUS]] — 全接口能力清单
- [[PDD-KNOWLEDGE]] — 基座知识库
- `skills/_shared/pdd-promo-hybrid.mjs` — 混合模式模块
