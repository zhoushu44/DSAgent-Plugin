# 推广域（yingxiao）能力现状

> 最后更新：2026-11-09
> 结论：**读接口 14/14 全通（混合通道），写接口 body 已全部拿到，只差接业务参数**

---

## 一、结论先行

| 项 | 2026-11-08 | **2026-11-09（现在）** |
|---|---|---|
| 纯 Node 签名 | ⚠️ 不稳定（jsdom 复刻失败） | ❌ **实测不可能**，放弃 |
| **混合通道**（Chrome 签名 + Node 发） | ✅ 可用 | ✅ **基座默认通道** |
| 读接口 | 2/10 | **14/14 全通** |
| 写接口 body | 未抓 | **6/6 已抓到** |
| 报表接口 | 500 | ✅ entityReport / rangeReport 已通 |
| 限流 | 怀疑是根因 | **不是根因** —— 根因是 body 字段缺失 |

> **限流从来不是推广域不通的原因。** 11 个接口全 40001，根因是
> ①签名只注入 body 没注入 header ②body 缺拼多多自有字段（`scenesMode`/`clientType`/`blockType`…）。
> 补齐后同一个账号一次通过。

---

## 二、混合通道怎么工作

```
skill → request('/mms-gateway/...', body)
           ↓
      自动选域 = yingxiao
           ↓
      自动合并默认 body（API_BODY_DEFAULTS）
           ↓
      Chrome（账号自己的 Profile）跑 SDK 生成 crawlerInfo
           ↓
      Node 带 crawlerInfo(body) + anti-content(header) 发 HTTP
           ↓
      成功码 = 1000（不是 1000000！）
```

### 两个必须同时满足的条件

| 条件 | 说明 |
|---|---|
| **签名两处都放** | body `crawlerInfo` + header `anti-content`，**同一个字符串** |
| **成功码是 1000** | 推广域不是 1000000，判错会全部误判为失败 |

### 为什么不能纯 Node

推广签名器是普通 JS 混淆（不是 JVM2 虚拟机），但它采集的运行时特征（`navigator`/时序/环境对象图）
**jsdom 复刻不出来** —— 实测 jsdom 签名「第一次成功，之后全失败」。
真实 Chrome 签名 + Node 发请求，是唯一稳的组合。

---

## 三、接口清单（审计：14/21 通）

### ✅ 读接口 —— 全通

| 接口 | 说明 |
|---|---|
| `promo.userInfo` | 用户信息，**基座用它解析 mallId** |
| `promo.accountAll` | 广告账户列表 |
| `promo.dailyCost` | 日消耗（`{}` 即可） |
| `promo.list` | 推广单元列表 |
| `promo.adGroups` | 广告组 |
| `promo.scenes` | 场景推广 |
| `promo.goodsUpgrade` | 商品推广升级版状态 |
| `promo.entityReport` | 实体报表（挖 bundle 才通） |
| `promo.rangeReport` | 区间报表 |
| `promo.reportConfig` | 报表自定义配置 |
| `promo.maxCostInfo` | 预算附加信息 |
| `promo.autoCharge` | 自动出价 |
| `promo.assistInfo` | 推广引导 |
| `promo.chargeSuggest` | 充值建议 |

### ⚠️ 写接口 —— body 已抓到，审计里报「参数为空」是**正常的**

| 接口 | 审计报错 | 实际 body |
|---|---|---|
| `promo.detail` | adId 不能为空 | `{adId}` |
| `promo.updateMaxCost` | maxCost 不能为空 | `{adId, maxCost:{value,unitCode}}` |
| `promo.updateBid` | 不能为空 | `{updateBidList:[{adId,targetRoi:{value,unitCode},isAdvertiserEnableAdvanced,optionalOptimizationMessageInfoList:[{optimizationGoal:3\|4\|5,dataOperateStatus:2}]}]}` |
| `promo.batchCreate` | 单元信息不能为空 | `{adInfoList:[{goodsId,maxCost,bidType:1,targetRoi,isAdvertiserEnableAdvanced:true}]}` |
| `promo.updateStatus` | operateStatus 错误 | `{adIdList:[], dataOperateStatus:2}`（暂停）/ `1`（开启） |
| `promo.delete` | 删除参数不可为空 | `{goodsId, adId, planId}` |
| `promo.adDiagnosis` | adId 不能为空 | `{adId, 平台类型}` |

**常量**：`UNLIMITED = {value:'1000000.00', unitCode:1}`

**注入方式**（混合通道下自动生效）：
```
body  = { ...body, crawlerInfo: sig }
header['Anti-Content'] = sig
header['VerifyAuthToken'] = vtk
```

---

## 四、报表接口的 body（挖出来的，别再猜）

### `queryEntityReport`

```js
{
  clientType: 1,              // PC
  entityId: '{{mallId}}',      // ← 基座自动解析
  entityDimensionType: 0,     // MALL
  queryDimensionType: 2,      // UNIT
  reportPromotionType: 9,     // Goods
  blockTypes: [6],            // ReportTable
  startDate: '{{today}}', endDate: '{{today}}',
  queryRange: { pageNumber: 1, pageSize: 50 },   // ★ 嵌套对象
  orderBy: 9999, orderType: 1,                   // ★ orderType 必须为 1
  returnTotalSumReport: true,
}
```

### `queryRangeReport`

```js
{
  clientType: 1, entityId: '{{mallId}}',
  entityDimensionType: 0, queryDimensionType: 2,
  reportPromotionType: 9, blockTypes: [6],
  startDate: '{{yesterday}}', endDate: '{{today}}', endDayHour: 23,
}
```

### 枚举（从 chunk 挖）

| 枚举 | 值 |
|---|---|
| MALL / PLAN / UNIT / CREATIVE | 0 / 1 / 2 / 4 |
| AD_CREATIVE / SHOW / SHOW_TOTAL | 11 / 13 / 14 |
| MALL_PRODUCT_TYPE / MALL_ENTRUST / BRAND_KEYWORD / MALL_AllLine | 15 / 16 / 17 / 18 |
| Goods（报表维度） | 9 |
| ReportTable（blockType） | 6 |
| PC（clientType） | 1 |

---

## 五、采集模式 → 接口计划（省时间的关键）

`promo.mjs` 按模式只调需要的接口，别每次全量拉：

| 模式 | 调用的接口 | 实测耗时 |
|---|---|---|
| `overview` / `goods` | userInfo, accountAll, dailyCost, adGroups, list, scenes, goodsUpgrade, entityReport（8 个） | 47~61s |
| `rates` | userInfo, accountAll, list, entityReport（4 个） | 62s |
| `units` | userInfo, list（2 个） | 49s |
| `daily` | userInfo, dailyCost, rangeReport | — |
| 默认 | 全部 11 个 | 51597ms，收集 11 失败 0 |

**现状**：`overview` / `goods` / `rates` / `units` 四个模式已 **纯 Node 化**
（`NODE_ONLY_MODES`），不再开浏览器页面（只开签名器）。

**还走浏览器的**：`daily` / `item` / `diagnose` / `balance` / `auto`
+ 6 个写操作（pause/resume/delete/create/maxcost/roi）。

---

## 六、限流与间隔

```js
domainGapMs: { yingxiao: 6000, live: 5000, mms: 0 }
```

推广域**同域请求最小间隔 6 秒**（2026-11-09 从 15s 调到 6s，实测稳定）。
再快会 54001。

**读接口本身没有速率限制** —— 实测重接口零间隔 × 30 全过。
真正的限流诱因是 **60 秒内访问 > 13 个不同接口**（平台拦的是扫描式探测）。

---

## 七、相关文件

| 文件 | 作用 |
|---|---|
| `skills/_shared/pdd-promo-signer-hybrid.mjs` | 混合签名器 + Cookie 桥（`healCookiesFromProfile`） |
| `skills/_shared/pdd-request.mjs` | 基座：选域 / 合并 body / 解 mallId / 自愈 / 降级 |
| `skills/_shared/pdd-api.mjs` | 接口注册表 + 默认 body 表 + 枚举 |
| `skills/pdd-promo/scripts/promo.mjs` | 推广域 skill 主程序（Node/浏览器双通道） |
| `skills/pdd-promo/scripts/promo-node.mjs` | 纯 Node 采集器 |
| `skills/_shared/pdd-api.mjs` → `PROMO_BODY_DEFAULTS` | 默认 body（已升级为基座级 `API_BODY_DEFAULTS`） |

---

## 相关

- [[PDD-KNOWLEDGE]] — 基座知识库（架构 / 签名 / 限流 / 踩坑）
- [[PDD-API-STATUS]] — 全接口能力清单
