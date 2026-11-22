# 抖音（抖店）基座 · 知识库

> 最后更新：2026-11-11
> 本文是抖音基座的**唯一权威版本**。拼多多基座见 `PDD-KNOWLEDGE.md`。

---

## 目录

1. [核心事实](#一核心事实)
2. [架构](#二架构)
3. [接口注册表](#三接口注册表)
4. [签名：抖店不要，内容平台要](#四签名抖店不要内容平台要)
5. [Cookie 规则](#五cookie-规则)
6. [错误分级](#六错误分级)
7. [闸门与节流](#七闸门与节流)
8. [实测性能](#八实测性能)
9. [踩坑记录](#九踩坑记录)
10. [能力边界](#十能力边界)

---

## 一、核心事实

### ★ 抖店只读接口不需要 a_bogus

**2026-11-11 实测，3 轮稳定复现：**

```
订单 searchlist，同一 URL、同一 cookie：
  带 a_bogus + verifyFp + fp + msToken  →  10001010A「当前环境存在风险」  43B
  剥掉以上全部                          →  st=0，539,152 字节，10 条订单
```

**结论：抖店（`fxg.jinritemai.com`）只读接口免签。带签名反而被判环境风险。**

这条推翻了「抖音必须先逆 a_bogus」的假设。`a_bogus` 是 `creator.douyin.com`（内容平台）的问题，**不是抖店的问题**。

完整证据见 `_douyin_node_probe/REPORT.md`。

### 签名在 query string，不在 header

与拼多多（header `Anti-Content`）相反：

```
抖店：业务参数 + __token + _bid + _lid + msToken + a_bogus + verifyFp + fp
      └──────────── 全在 URL 里 ────────────────┘
```

所以「按 header 找签名」的思路对抖音从一开始就是错的。

---

## 二、架构

```
skill → douyin-guard.openTask()      （账号锁 + 冷却 + 健康分 + 节流）
           ↓
      douyin-request.request()       （统一请求入口）
           ├─ 自动剥离签名字段（抖店带了会挂）
           ├─ cookie 合并：只补缺失，绝不覆盖
           ├─ 错误分级（10001010A / session / rate_limit / server）
           └─ 假成功检测（st=0 但 success=false）
           ↓
      douyin-registry.resolve()      （接口表：域名/方法/路径/参数/判据）
```

### 模块清单（`skills/_shared/`）

| 模块 | 行数 | 关键导出 |
|---|---|---|
| `douyin-registry.mjs` | ~230 | `API`、`PAGES`、`DOMAINS`、`resolve`、`buildUrl`、`listApis`、`validateTable` |
| `douyin-request.mjs` | ~400 | `request`、`paginate`、`pickList`、`loadAccount`、`mergeCookies`、`classify`、`readProfileCookies` |
| `douyin-guard.mjs` | ~380 | `openTask`、`withDouyinGuard`、`getAccountState`、`clearCooldown`、`guardHealth`、`THROTTLE` |
| `douyin-risk-bypass.mjs` | 218 | `injectRiskBypass`（DOM 路线才需要，纯 Node 不用） |

### 三条必须遵守的规则

**① 请求走 `request()`，不要裸 fetch**

```js
import { request } from '../../_shared/douyin-request.mjs'

const r = await request('goods.list', { pageSize: 20 }, { account })
// → { ok, st, data, errorKind, ms, cookiesFilledFromProfile, strippedParams }
```

**② 不要传签名字段**

```js
// ❌ 错：带了会被判环境风险
request('order.list', { a_bogus: sig, verifyFp: fp }, { account })

// ✅ 对：什么都不带
request('order.list', { pageSize: 10 }, { account })
```
`request()` 会自动剥离 `a_bogus/verifyFp/fp/msToken/__token/_bid/_lid/aid` 并打 warning。

**③ 列表用 `pickList()`，不要 `|| []`**

```js
// ❌ 错：接口失败会被伪装成「0 条」
const items = r.data?.items || []

// ✅ 对：失败直接抛错
const items = pickList(r, 'items', '商品列表')
```

---

## 三、接口注册表

### 已验证（21 个，`verified: '20261111'`）

| 注册名 | 方法 | 路径 | 备注 |
|---|---|---|---|
| `goods.count` | GET | `/product/tproduct/aggsProductCount` | 各状态计数 |
| `goods.list` | GET | `/product/tproduct/list` | **商品列表 163KB** ★主力 |
| `goods.categoryOptions` | GET | `/product/tproduct/categoryOptionsN` | 类目选项树 |
| `goods.rectifyInfo` | GET | `/product/tproduct/rectifyInfo` | 整改信息 |
| `goods.groupList` | GET | `/product/tproduct/getProductGroupList` | 商品分组 |
| `goods.shipDelayRule` | GET | `/product/tproduct/getShopShipDelayRule` | 发货延迟规则 |
| `goods.banner` | GET | `/product/tproduct/listBanner` | 横幅提示 |
| `goods.excitation` | GET | `/product/tproduct/queryExcitation` | 激励查询 |
| `goods.freightTemplates` | GET | `/freight/template/getFreightTemplateList` | 运费模板 |
| `order.list` | GET | `/api/order/searchlist` | **订单列表 533KB** ★主力 |
| `order.count` | GET | `/api/order/tabcnt` | 订单状态计数 |
| `order.notice` | GET | `/api/order/getNotice` | 订单通知 |
| `shop.homepage` | GET | `/pc/api/home/homepage` | 店铺首页 117KB |
| `shop.expScore` | GET | `/governance/shop/experiencescore/getOverviewV10` | 体验分（`exp_version=v10`） |
| `shop.expScoreSub` | GET | `/governance/shop/experiencescore/getSubScoreMetricsV10` | 体验分子项（12 项指标） |
| `shop.expScoreTrend` | GET | `/governance/shop/experiencescore/getTrendByVersion` | 体验分趋势（`trend_type/time/exp_version`） |
| `shop.metrics` | GET | `/byteshop/shop_util/mertrics` | 店铺指标（**注意拼写就是 mertrics**） |
| `marketing.tools` | POST | `/marketing/pc/v1/common/get_marketing_homepage_tools` | 营销工具 24 个 |
| `marketing.fullDiscount` | GET | `/marketing/activity/v1/query_full_discount_activity` | 满减活动列表 |
| `marketing.promoData` | GET | `/marketing/marketing_data/v1/query_promotion_data` | 营销推广数据 |
| `marketing.activityGray` | GET | `/marketing/activity/v1/get_activity_gray` | ★权限探针 |

### 待验证（1 个，`verified: null`，调用会被拒）

| 注册名 | 路径 | 缺什么 |
|---|---|---|
| `order.afterSale` | `/api/order/searchlist` (tab=aftersale) | 返回 723KB 但响应结构待确认 |

### ★ 千川域（13 个，已验证 2026-11-11）

**推翻了旧结论：千川只读接口一样免签。**

同一接口三种方式实测（`get-adv-balance`）：
```
带 a_bogus+verifyFp+fp+msToken  → code=0  789B
剥净签名                        → code=0  789B
完全手工零参数                  → code=0  789B
```

旧文档「手工 fetch 一律 40002」= **业务参数缺失**（`code=2` / `status_code=-1`），不是签名问题。

| 注册名 | 方法 | 路径 | 备注 |
|---|---|---|---|
| `promo.balance` | GET | `/ad/api/v1/account/finance/get-adv-balance` | ★余额，零参数可用 |
| `promo.userInfo` | GET | `/ad/api/v1/account/user/info` | 账户信息 8.3KB |
| `promo.customerId` | GET | `/ad/api/v1/account/account-info/get-customer-id` | ★客户主体（含 accountId + customerId） |
| `promo.chargeInfo` | GET | `/ad/api/promotion/v1/activity/get_charge_info` | 充值信息 |
| `promo.uniPromConfig` | GET | `/ad/api/v1/account/user/get-whitelist` | ★权限（19.4KB） |
| `promo.planSummary` | POST | `/ad/api/pmc/v1/uni-promotion/ad/list-summary` | ★计划汇总（必须带 body） |
| `promo.statQuery` | POST | `/ad/api/data/v1/common/statQuery` | ★报表（`Filters.Conditions` 必需） |
| `promo.analysisReport` | POST | `/ad/api/data/v1/overview/getAnalysisReport` | 经营分析 |
| `promo.ongoingList` | GET | `/ad/ocean/api/v1/promotion/getOngoingPromotionList` | ★在投计划 |
| `promo.costLevel` | GET | `/ad/api/v1/account/agw/finance/GetAdvCostLevelInfo` | 消耗层级 |
| `promo.forbidRoi` | GET | `/ad/api/v1/account/getForbidRoi1AdInfo` | ROI1 限制 |
| `promo.materialSource` | GET | `/ad/api/data/v1/material/get_source_list_new` | 素材来源 |
| `promo.materialReport` | POST | `/ad/api/data/v1/common/statQuery` | ★素材报表（DataSetKey=`roi2_video_material_analysis`） |
| `promo.recentDate` | GET | `/ad/api/data/agw/getReportRecentDate` | ⏳ 返回空 body，未确认 |

**实测数据（杯中茶）**：余额 **23400.00 元**，`createAuthEnable: false`（仅观察权限），
千川账户 `accountId=1781536544329804`，客户主体「温州鼎昊包装有限公司」。

**★ 两个 ID 别混用**：
- `accountId` = `1781536544329804` → 报表 `Filters.advertiser_id` **用这个**
- `customerId` = `659089484` → 公司主体 ID

**设计约束**：`resolve()` 对 `verified: null` 的接口**直接抛错**，逼调用方要么先实测、要么显式传 `allowUnverified: true`。绝不让技能拿一个「猜的」接口去发请求。

---

## 四、签名：抖店不要，内容平台要

| 域 | 需不需要 a_bogus | 传输方式 | 状态 |
|---|---|---|---|
| `fxg.jinritemai.com`（抖店后台） | **不需要** | 纯 Node | ✅ 已验证 22 接口 |
| `qianchuan.jinritemai.com` **只读** `/ad/api/*` | **不需要** | 纯 Node | ✅ 已验证 14 接口 |
| `qianchuan.jinritemai.com` **写** `/ad/ecom/marketing/*` | 未验证（CSRF 先挡） | **只能真实 XHR / 点击** | ❌ 不可 Node 化 |
| `creator.douyin.com`（内容创作） | **需要** | 页面内 fetch（secsdk 自动补签） | ⚠️ 现有技能用 11~13s 浏览器 |

### ★★ 只读 ≠ 写：千川两个域是分开鉴权的

```
只读域  /ad/api/*                    → 免签，Node 直连 ✅
写域    /ad/ecom/marketing/api/*     → 403 missing csrf token ❌
```

详细证据见 `_douyin_node_probe/WRITE-VERDICT.md`。要点：

1. 猜的启停路径（`batch-update-status` 等）返回 **40002「路径权限校验失败」**
   —— **页面内 fetch 也是 40002** → 说明 40002 = **路径不存在**，不是签名问题
2. 真实写路径从 JS 挖出来在 `/ad/ecom/marketing/api/v1/ad/*`，全部 **403 CSRF**
3. 真实 header 名是 **`X-CSRFToken`**
4. ★ **`page.evaluate(fetch)` 也过不去**（`invalid csrf token`）
   —— hook 验证：fetch 只带 Content-Type，**CSRF 由 XHR 拦截器注入，fetch 拿不到**

**结论：千川写操作不能纯 Node 化，`douyin-plan-ops` 保持真实点击路线。**
（原文档说「因为 a_bogus 签名」——理由错了，应是「CSRF 由 XHR 拦截器注入」）

**内容平台的正确做法**：不是逆 a_bogus，而是「借用浏览器里已 patch 的 `window.fetch`」。
证据：`_re_douyin/capture/_sig-proof.json` —— 业务代码传裸 URL（`hasBogus: false`），最外层 hook 看到时已补签（`hasBogus: true`）。

---

## 五、Cookie 规则

### ★ 只补缺失，绝不覆盖

```js
mergeCookies(凭证库cookies, Profile实时cookies)
// → 凭证库为主；Profile 只补凭证库没有的键
```

**为什么**：凭证库的 `sessionid` 是**占位值** ——

```
douyin       sessionid = 56b6...1d2f   (32 字符) = account_id 前 32 位
douyin_shop  sessionid = bf90...ba5b   (32 字符) = account_id 前 32 位
```

旧代码 `page.setCookie(全量)` 会把这个占位值写进 Profile，**覆盖真实会话**。这是 `_re_douyin/README.md` §8 记录过的真实故障。

**实测结论**：只读场景下占位 `sessionid` **无害**（服务端认 `sid_guard` / `sid_tt`），8/8 接口照常通过。但写操作场景仍需警惕。

### 平台 key 分离

| platform | 域 | 用途 |
|---|---|---|
| `douyin` | `.douyin.com` | 内容创作（creator） |
| `douyin_shop` | `.jinritemai.com` | 抖店 / 千川 |

两套登录态**不通用**。抖音账号 cookie 进不了抖店后台（实测跳登录页）。

---

## 六、错误分级

`classify()` 只对**实测见过**的码归类，其余归 `unknown` 并原样带回：

| 判据 | errorKind | 要不要重试 | 处置 |
|---|---|---|---|
| `st === 0` / `code === 0` | `ok` | — | — |
| `code === '10001010A'` 或 msg 含「当前环境存在风险」 | `risk_control` | **绝不重试** | 冷却 5 分钟；先查是否误带签名 |
| msg 含「未登录 / 登录态 / session」 | `session` | 不重试 | 引导重新登录；`needRelogin` 只锁 15 分钟 |
| msg 含「频繁 / 稍后重试 / 限流」 | `rate_limit` | 重试 | 冷却 90s |
| msg 含「参数 / invalid」 | `bad_input` | 不重试 | 补参数 |
| HTTP 5xx | `server` | 重试 | 退避 1.5s×n |
| `st=0` 但 `success === false` | `fake_success` | 不重试 | ★ 不当成成功 |

**为什么不猜**：抖音 `40002` 同时表示「签名错 / 无权限 / 频控」三种语义。乱归类会导致「以为签名不行 → 反复折腾签名」——这正是 2026-11 上一轮踩过的坑。

---

## 七、闸门与节流

```js
export const THROTTLE = {
  readGapMs: 250,           // 读接口最小间隔
  writeGapMs: 3000,         // 写接口间隔
  perEndpointGapMs: 800,    // 同接口最小间隔
  scanWindowMs: 60000,      // 扫描检测窗口
  scanDistinctLimit: 25,    // 60s 内不同接口上限
  scanCooldownMs: 120000,   // 触发扫描冷却 2 分钟
  riskCooldownMs: 300000,   // 10001010A 冷却 5 分钟
  rateCooldownMs: 90000,    // 频控冷却 90s
}
```

### 状态文件

```
~/.dsh/douyin-guard/state.json    冷却 / 健康分 / 记账
```

**为什么必须有**：旧技能每次 `goto + sleep(12000)`，天然就是低频 —— 那层「意外的节流」在改成纯 Node 后会消失。**必须显式补回来**，否则从 15s/次 变成 200ms/次，等于提速 75 倍的同时把请求密度也提高了 75 倍。

### 健康分

- 成功 +1，上限 100
- `risk_control` −25，`session` −20，`rate_limit` −10
- `clearCooldown()` 可清冷却 +20

---

## 八、实测性能

| 路径 | 改造前 | 改造后 | 倍率 |
|---|---|---|---|
| `douyin-order --mode overview` | ~12~15s | **1048ms** | ~13x |
| `douyin-goods --mode list` | ~12~15s | **904ms** | ~14x |
| `douyin-goods --mode config` | 不支持 | **680ms** | 新增能力 |
| `douyin-shop --mode overview` | **~36~45s**（3 页 × 12s） | **1503ms** | ~27x |
| `douyin-shop --mode score` | ~36~45s | **945ms** | ~42x |
| `douyin-activity --mode overview` | 永远失败（4 个 TODO 桩） | **1174ms** | 从不可用到可用 |
| `douyin-uni-prom --mode overview` | ~16~20s | **1791ms** | ~10x |
| `douyin-uni-prom --mode balance` | ~16~20s | **524ms** | ~35x |
| `douyin-promo --mode overview` | ~15~20s | **1641ms** | ~11x |
| `douyin-promo --mode balance` | ~15~20s | **645ms** | ~27x |
| `douyin-material-report --mode overview` | ~16~20s | **1.0s** | ~17x |
| `douyin-material-report --mode report` | ~16~20s | **0.9s** | ~19x |
| 单接口平均（抖店 8 个） | — | **236ms** | vs 12000ms ≈ 51x |
| 单接口平均（千川 162 个） | — | **259ms** | 最快 104ms |

### 七个技能改造汇总

| 技能 | 状态 | 模式 |
|---|---|---|
| `douyin-order` | ✅ 纯 Node | overview / list |
| `douyin-goods` | ✅ 纯 Node | overview / list / config |
| `douyin-shop` | ✅ 纯 Node | overview / score / goods |
| `douyin-activity` | ✅ 纯 Node + 重新定位 | overview / tools / list / data / perm |
| `douyin-uni-prom` | ✅ 纯 Node | overview / balance / perm / plans / analysis / report / margin |
| `douyin-promo` | ✅ 纯 Node | overview / balance / plans / cost / report |
| `douyin-material-report` | ✅ 纯 Node | overview / source / report（35 指标） |

---

## 九、踩坑记录

### ① 抓包抓的是「已签名 URL」，直接重放会得出错误结论

第一轮 `probe-01` 8/8 全过，看着像「免签」——但抓的是页面已经签好名的完整 URL，`a_bogus` 还在 query 里。
**教训**：验证「免不免签」必须**逐级剥离**（L0→L4），不能只做「原样重放」。

### ② 带着签名重放 → 10001010A

同一订单 URL，带签名挂、剥干净过。3 轮稳定。
**教训**：`a_bogus` 一次性且强绑定上下文，重放必然判环境风险。**不要试图复用签名。**

### ③ 页面内 fetch 自己也会挂

`probe-04` 里 `page.evaluate(fetch)` 打订单接口同样返回 `10001010A`。
**教训**：看到环境风险，先怀疑「签名是否过期/不匹配」，而不是「cookie 不对」。

### ④ 商品列表是 GET，不是 POST

`/product/tproduct/list` 实测是 GET + query，没有 body。
**教训**：抖音的方法不能按「列表就是 POST」的直觉假设。

### ⑤ URL 匹配 `includes('/list')` 会命中 `listBanner`

`probe-03` 第一次跑，`findCap('/product/tproduct/list')` 命中了 `listBanner`，用错 URL 测出 500。
**教训**：接口 path 匹配必须**精确相等**，不能用 includes。

### ⑥ `sessionid` 是占位值，但只读不校验它

`probe-00` 证实两个账号 `sessionid` 都等于 `account_id` 前 32 位，`probe-06` 用这份 cookie 8/8 通过。
**教训**：占位值不代表「完全无效」，服务端认的是另一组（`sid_guard` / `sid_tt`）。但**写操作必须重新验证**。

### ⑦ `L4_-ctx_all` 这种带 `-` 的属性名不能当对象 key 用点号访问

`probe-02` 第一次跑在 `r.levels.L4_-ctx_all` 上崩了，`-` 被解析成减号。
**教训**：动态 key 一律用 `r.levels[prop]`。

### ⑧ 体验分 `exp_version` 是字符串 `v10`，不是数字 10

注册表第一版写 `exp_version: 10` → 接口返回「参数错误」。
**教训**：从抓包里抄参数值时，**连类型一起抄**（`v10` 是字符串，裸数字会挂）。

### ⑨ 体验分趋势 `recent_*_avg_score` 恒为 0

服务端返回 `recent_7_avg_score: 0`、`recent_14/30` 也是 0，但 `experience_score` 数组里 30 天全是 70。
**教训**：**不要盲信汇总字段**。有明细数组时以明细为准自己算，原值保留到 `serverAvgRaw` 备查。
（这类「汇总字段错、明细对」的坑不抓到就发现不了，因为 0 看起来很正常。）

### ⑩ 营销活动子应用 goto 会重定向，菜单里也没有活动入口

`/ffa/marketing/activity`、`/activity/list`、`/activity/center` **全部 200 但重定向到 `/ffa/marketing/home`**；
`byteshop/menu/navigate`（15KB、21 个节点）里**没有任何营销活动入口**。
**教训**：活动类功能不要靠 goto 页面 + hook 响应，**直接查权限探针接口**（`get_activity_gray`）判断账号有没有。

### ⑪ `get_activity_gray.enable=false` 意味着「这个账号没有该功能」

返回 `{"enable":false,"extra_param":{},"membership":false}`，`msg="无该配置"`。
这时候正确做法是**如实报告没有权限**，而不是继续找接口、或把空列表当「没有活动」。
**这是「能力边界」类问题，不是「接口没找到」类问题。**

### ⑫ 测试脚本自己会过时

`verify-base.mjs` 里原本拿 `shop.expScore` 当「未验证接口」样本，等它被回填成 `verified` 之后，这项测试就假失败了。
**教训**：测「未验证接口被拒」要**动态取** `listApis().filter(a => !a.verified)[0]`，不能写死名字。

### ⑬ ★ 不能用 `method === 'POST'` 判断读写

千川的只读查询（`list-summary` / `statQuery` / `getAnalysisReport`）**全是 POST**。
按 POST 判「写操作」→ 每次查询白等 3 秒 → `uni-prom overview`（5 个接口）从 1.8s 拖到 **7 秒**。
**修正**：注册表显式标 `isWrite: true`，没标的一律按读处理。
**教训**：REST 语义（GET 读 / POST 写）在字节系后台**不成立**，读接口大量用 POST。

### ⑭ 三个域的成功判据不一样

| 域 | 成功响应 |
|---|---|
| 抖店 `fxg` | `{ st: 0, code: 0, msg: "" }` |
| 千川 `qianchuan` | `{ code: 0, msg: "success" }` ← **没有 st** |
| 营销 `activity` | `{ st: 0, msg: "success" }` |

`classify()` 第一版只认 `st === 0 || code === 0`，千川其实能过；但 `fakeSuccess` 判断把 `msg:"success"` 误当失败。
**修正**：`st / code / status_code` 三个都认，`success === false` 才算假成功。
**教训**：一个基座要接三个域时，**成功判据必须取并集**。

### ⑮ `get_uni_prom_config` 会偶发报错，权限要用 `get-whitelist`

```
GET /ad/api/v1/account/uni_prom/get_uni_prom_config
→ { "status_code": 2, "message": "网络请求超时，请您检查网络后再次尝试" }   ← 服务端偶发

GET /ad/api/v1/account/user/get-whitelist
→ { "status_code": 0, "data": { "uniPromVisible": true, "createAuthEnable": false, ... } }   ← 19.4KB，稳定
```
**教训**：同一个语义有多个接口时，**选数据量大、字段全的那个**；名字更像的那个反而可能是坏的。

### ⑯ 千川 `list-summary` 空 body 报 `code=2`，是缺业务参数不是签名

```
POST /ad/api/pmc/v1/uni-promotion/ad/list-summary
body {}                          → code=2
body {"page":1,"pageSize":20}    → code=2
body {AdFilter:{MarGoal,StartTime,EndTime,...},DiscardTotalNum,Metrics:[]} → code=0 ✅
```
`aavid` 可选（不带也能过）。
**教训**：`code=2` 一律先查 body，不要怀疑签名 —— 这与抖店 `10001010A` 的处置完全相反。

### ⑰ PowerShell 的 `if` 不能当表达式，`$var:` 会被当作用域

排查时连续踩两次：
- `"{0}" -f (if($x){...}else{...})` → `if: The term 'if' is not recognized`
- `"第$_次: $($sw.ElapsedMilliseconds)"` → 中文全角冒号后跟变量被解析失败

**教训**：PowerShell 里复杂逻辑写成 `.mjs` 用 node 跑，别在命令行里硬拗；字符串拼接用 `-f` 而不是模板。

### ⑱ `accountId` ≠ `customerId`，报表填错会 0 条

千川 `get-customer-id` 返回的 `detail` 里有**两个 ID**：
```
accountId  1781536544329804   ← 千川账户 ID，报表 Filters.advertiser_id 用这个
customerId 659089484          ← 客户 ID（公司主体「温州鼎昊包装有限公司」）
```
第一版代码取了 `customerId` 当 `advertiserId`，报表口径就错了。
**教训**：字段名带 `account` / `customer` / `adv` 前缀时，先看清哪个是「投放账户」维度。

### ⑲ `isForbid: true` 不代表当前受限

`getForbidRoi1AdInfo` 返回 `{isForbid: true, bannerStartTime: 1746460801, bannerEndTime: 1747843199}`，
转成日期是 **2025-05-05 ~ 2025-05-21** —— 早过期了，但 `isForbid` 仍是 `true`。
**教训**：布尔标志 + 时间窗的接口，必须**同时判断窗是否覆盖今天**（`activeInWindow`），否则会误报「ROI 受限」。

### ⑳ `statQuery` 成功响应只有 `status_code`，没有 `code`/`st`

```
{"data":{"StatsData":{...}},"status_code":0,"message":"success"}
```
而同一个千川域，`get-adv-balance` 返回的是 `{"code":0,"msg":"success"}`。
**教训**：同一平台不同接口的响应信封可以不一样，`classify()` 必须三码并认。

### ㉑ `statQuery` 缺 `Filters.Conditions` 报 `status_code:-1`

实测逐步剥离：
```
抓包原样                  → status_code=0  ✅
去 ComparisonParams       → status_code=0  ✅（可选）
去 Filters                → status_code=-1 ❌
最简(空 Conditions)       → status_code=-1 ❌
```
5 条 Conditions 必需：`advertiser_id` / `ecp_app_id` / `query_self_data` / `adlab_mode_fork` / `adlab_scene_fork`。
**教训**：已固化成基座 `statQueryBody()`，技能层不要自己拼。

### ㉒ 测试阈值要跟配置联动，别写死

把 `perEndpointGapMs` 从 800ms 调到 500ms 后，`verify-base.mjs` 里写死的 `t2 > 500` 卡在边界（实测 491ms）假失败。
**教训**：断言里的魔法数字要读配置（`G.THROTTLE.perEndpointGapMs * 0.7`）。

### ㉓ ★ 素材报表和通投报表的 Filters 不是一套

```
通投报表 overall_home_cost_total_prom：5 条
  advertiser_id / ecp_app_id / query_self_data / adlab_mode_fork / adlab_scene_fork

素材报表 roi2_video_material_analysis：4 条（字段名不同！）
  advertiser_id / marketing_goal / adlab_mode_fork / material_type
```
照搬通投那套 → 服务端返回 **「网络请求超时」**，看起来像网络问题，实际是**条件冲突**。
**教训**：同一接口（`statQuery`）不同 `DataSetKey` 有不同 Filters 契约，必须分别固化。

### ㉔ 指标名不能猜，服务端会明确告诉你

```
写的：video_play_over_rate_for_roi2
报错：[check] 指标：video_play_over_rate_for_roi2不在数据集配置中
真实：video_play_finish_rate_for_roi2_v2
```
原脚本硬编码 47 指标，里面混了 1 个猜的 → **整个请求失败**（不是只丢那个指标）。
**教训**：宁可少要几个指标，也不要用猜的名字；从抓包的真实 body 里抄。

### ㉕ `material_type` 是单值不是数组

```
["1","2","3"] → roi2_material_type_v3 filter 只能传入一个数字
["1"]         → 通过（但 roi2_material_type_v3 这个名字本身在素材报表里也不对）
```
**教训**：字段名带 `_type` 的多半是枚举单值，先按单值试。

### ㉖ PowerShell 循环里别用 `$O` 当变量名

```
foreach ($c in $cases) { $o = & node $c.s ... }   # $O 被 PowerShell 当成了 foreach 的迭代变量
→ run2/run3 报 MODULE_NOT_FOUND（79ms 瞬间失败）
```
**教训**：PowerShell 变量名不区分大小写，`$O` 与循环里的 `$o` 是同一个。用 `$script` / `$out` 这类名字。

### ㉗ ★ 告警类功能：过滤条件写错比没有功能更糟

`douyin-order` 加「待发货超时提醒」时，第一版忘了过滤订单状态，
把**已完成的 92 天前订单**也算成「待发货超时」，一次报了 **10 笔假告警**。

修复：加 `o.status === 2` 过滤后正确报 2 笔。
**教训**：告警的假阳性会训练用户忽略所有告警。加告警必须同时验证「该报的报了 + 不该报的没报」。

### ㉗b ★★ 告警的第二个坑：只扫当前页会「漏报」

修完误报后还有漏报：`shipAlert` 基于 `orderItems`（`oArr.slice(0, LIMIT)`），
而 `tab=all` 前 10 条里只有 **2** 笔待发货，平台说 `stock_up=3` ——
**漏掉的那笔已超时 106 天**（占 33%）。

修复：overview 模式**额外查一次 `tab=stock_up` 全量**（pageSize=100），
`shipAlert` 基于该全量列表，并在输出里标注 `source: 'stock_up_full'`。

```
❌ 错：shipAlert 基于 orderItems（当前页）
✅ 对：shipAlert 基于单独查的 stock_up 全量
```

**教训**：「汇总/告警类」数字**永远不能来自被分页截断的列表**。
判断方法：把平台计数（`tabcnt.stock_up`）和实际取到的条数比，不等就是漏了。

### ㉗c 断言要能抓到 bug（负向测试）

写完 `verify-invariants.mjs` 后，**故意把 bug 改回去**跑一遍，确认断言会 FAIL：
```
改回「用 orderItems」→ 断言报：技能=2 自算=3  ❌
恢复修复版          → 14/14 ✅
```
**教训**：只验证「不误报」不够，必须验证「真能抓到」。否则是个永远 pass 的摆设。
（这条与 `PDD-KNOWLEDGE` 里「检查项 [10] 的设计要点」是同一个教训。）

### ㉘ 「空壳提示字段」不能当风险报

```
grow_shop_decrease_prompt: {
  showPrompt: true,          ← 看着像「有降分风险」
  showDecreaseInfos: false,  ← 但实际没有明细
  subTitle: "", desc: ""     ← 内容全空
}
```
第一版只看 `showPrompt` 就报「平台提示存在分数下降风险」—— **假告警**。
**教训**：布尔开关 + 空字符串内容的组合，通常表示「功能位存在但未启用」，必须判 `showDecreaseInfos===true && desc非空`。

### ㉙ 平台不公开的总分构成，不要猜

体验分 70，12 项子指标全是 0（均低于标准）→ 用户会问「没扣分为什么只有 70」。
`grow_score_info` 里**只有 `grow_shop_score` 一个分值**，没有任何满分/扣分说明。
**处置**：如实说「平台不公开总分构成，70 可能是类目基准分」，并强调「子项全绿 = 健康」。
**教训**：宁可说「不知道」，也不要编一个总分公式。

### ㉚ 交叉验证是发现「接错字段」的唯一有效方法

单技能跑通不代表数据对。试用时用「同一事实不同来源」交叉验：
- 商品在售数：`goods.count.onsale` vs `goods.list` 实际条数
- 订单总数：`tabcnt.all` vs `order.list` 条数
- 各状态加总 vs `all`
- 体验分总览 vs 趋势最后一天
→ 10/10 一致才敢说管线没错。

**教训**：写完基座，一定要做一次交叉验证。这类错误在单技能测试里永远发现不了。

---

## 十、能力边界

### ✅ 已落地（4 个技能纯 Node 化）

| 技能 | 模式 | 状态 |
|---|---|---|
| `douyin-order` | overview / list | ✅ 812ms |
| `douyin-goods` | overview / list / config | ✅ 687~927ms |
| `douyin-shop` | overview / score / goods | ✅ 917~1465ms |
| `douyin-activity` | overview / tools / list / data / perm | ✅ 480~3891ms |

### ⏳ 待改造（仍是 DOM 路线 / 写操作）

| 技能 | 现状 | 障碍 |
|---|---|---|
| `douyin-plan-ops` | 真实点击 `.ovui-switch` | **写操作**，需保持 DOM 路线 |
| `douyin-publish` | DOM 上传 + 填表 | **写操作** |
| `douyin-publish-http` | 浏览器代签 + Node 上传 | **写操作**（a_bogus 内容域） |
| `douyin-publish-full` / `-ai` / `-mqs` | DOM 8 步 / AI 发品 | **写操作** |

> **只读域已全部 Node 化（7 个技能）**。剩下的都是写操作，风险性质不同，不能沿用只读结论（免签 ≠ 写操作也免签，需单独验证）。

### ❌ 明确不做

- **逆向 `a_bogus`**：CDN 带版本的混淆运行时，逆一次活不过两三个月，而「借用已 patch 的 fetch」零维护
- **对 `creator.douyin.com` 用纯 Node**：必须页面内 fetch

### ⚠️ 未验证区域（不能沿用只读结论）

- 抖店**写操作**（发布 / 改价 / 上下架）
- 千川域（`qianchuan.jinritemai.com`）
- 售后列表响应结构

---

## 附：验证与复现

```bash
set DSAGENT_PLUGIN_ROOT=E:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin

# ★ 不变量回归（每次改代码必跑，14 项）
node skills/_shared/verify-invariants.mjs

# 基座自检（22 项）
node _douyin_node_probe/verify-base.mjs

# 交叉验证（10 项）
node _douyin_node_probe/trial-01-crosscheck.mjs

# 探针
node _douyin_node_probe/probe-02-strip.mjs    # 阶梯剥离
node _douyin_node_probe/probe-06-pure.mjs     # 纯 Node 端到端

# 技能
node skills/douyin-order/scripts/order.mjs --mode overview
node skills/douyin-goods/scripts/goods.mjs --mode config
```

### 三层验证体系

| 层 | 脚本 | 检查什么 | 项数 |
|---|---|---|---|
| 基座 | `verify-base.mjs` | 表结构 / cookie 合并 / 错误分级 / 节流 | 22 |
| **不变量** | `verify-invariants.mjs` | **计数一致性 / 告警正确性 / 交叉验证 / 假成功** | **14** |
| 业务 | `trial-01-crosscheck.mjs` | 同事实多来源对比 | 10 |

**不变量回归是关键**：它专门抓「不抛异常、但数字是错的」这类静默 bug ——
误报和漏报都不会让技能失败，只会悄悄给出错数字。没有断言就永远发现不了。

产物：`_douyin_node_probe/out/*.json`、`REPORT.md`、`TRIAL-REPORT.md`、`WRITE-VERDICT.md`
