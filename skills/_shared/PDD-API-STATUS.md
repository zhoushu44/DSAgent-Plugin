# 拼多多接口能力清单

> 最后更新：2026-11-09
> 来源：`audit-all-api.mjs` 全量实测 **89 个接口**（基座默认 body + Cookie 自愈 + 混合通道全开）
> 产物：`skills/_shared/.audit-all.json`

---

## 一、结论先行

| 指标 | 2026-11-08 | **2026-11-09** |
|---|---|---|
| 接口总数 | 80 | 89 |
| **实测可用** | 13 | **42** |
| 可用率 | 16% | **47%** |
| A 传输层已通·只缺业务参数 | 10 | **18** |
| B 限流/冷却 | 17（污染误判） | **9**（其中 5 个是账号级接口族限制） |
| C 无登录态/权限（要人操作） | 26 | **15**（全是 live 域） |
| D 平台侧错误 | 2 | 1 |
| E 连接失败 | 4 | 4 |

**可用率翻近 3 倍，靠的是 4 件事**（都不需要改单个 skill）：
① 基座默认 body 表 ② Cookie 自愈 ③ 混合签名通道 ④ 默认 body 键匹配修正。

---

## 二、按域统计

| 域 | 通过/总数 | 状态 |
|---|---|---|
| `shop` 经营域 | **11/12** | ✅ 几乎全通 |
| `chance` 机会商品 | **9/11** | ✅ 几乎全通 |
| `promo` 推广域 | **14/21** | ✅ 读全通，差的全是要参数 |
| `goods` 商品域 | 5/18 | ⚠️ 见下 |
| `act` 活动域 | 2/7 | ⚠️ 2 小时频控 |
| `common` | 1/1 | ✅ |
| `video` 视频域 | 0/15 | ❌ 账号无创作者登录态 |
| `aivideo` AI 素材域 | 0/4 | ❌ 独立鉴权 |

---

## 三、✅ 已通（42 个）

### 经营域 shop（11/12）

| 接口 | 路径 | body |
|---|---|---|
| `shop.info` | `/earth/api/mallInfo/commonMallInfo` | `{}` GET |
| `shop.flow` / `shop.legacyFlow` | `/sydney/api/mallScore/queryMallFlowData` | 基座默认 |
| `shop.flowOverview` | `/sydney/api/mallFlow/queryMallFlowOverView` | 基座默认 |
| `shop.score` / `shop.legacyScore` | `/sydney/api/mallScore/queryMallScoreOverView` | 基座默认 |
| `shop.dsr` | `/sydney/api/mallDsr/dsrResult` | `{}` |
| `shop.goodsOverview` / `shop.legacyGoodsOverview` | `/sydney/api/goodsDataShow/queryGoodsPageOverviewForMms` | 基座默认 |
| `shop.goodsDetailVO` | `/sydney/api/goodsDataShow/queryGoodsDetailVOList` | `{startDate,endDate,queryType:6,sortCol:0,sortType:1,pageNum,pageSize,actVs:1}` |
| `shop.goodsSpanDate` | `/sydney/api/goodsDataShow/queryGoodsSpanDateList` | `{}` |

### 机会商品 chance（9/11）

`home` / `my` / `cateInfo` / `keywordsRecommend` / **`getHotSearchGoods`** / `collection` /
`missionInfo` / `filters` / `defaultCategory` —— 全部 ✅

**关键修复**：`get_hot_search_goods` 缺 `statistic_type` → http 500（从 chunk 挖出来的）。

### 推广域 promo（14/21 读接口全通）

`userInfo` / `accountAll` / `dailyCost` / `list` / `adGroups` / `scenes` / `goodsUpgrade` /
**`entityReport`** / **`rangeReport`** / `reportConfig` / `maxCostInfo` / `autoCharge` /
`assistInfo` / `chargeSuggest`

详情见 [[PDD-PROMO-STATUS]]。

### 商品域 goods（5/18）

| 接口 | 备注 |
|---|---|
| `goods.listGlide` | `/glide/v2/mms/addProperties/goodsList` → total=180（**列表主力**） |
| `goods.count` | 在售/下架/售罄数 |
| `goods.skuInfo` | 完整 SKU |
| `goods.copyedExist` / `goods.newStyleGray` | — |

### 活动域 act（2/7）

`act.statics` / `act.effectData` ✅（另外 3 个在 2 小时冷却里）

---

## 四、A 类：传输层已通，只缺业务参数（18 个）

**这类报 `3000000 参数校验失败` / `ec=1`，说明签名和鉴权都过了。**

| 接口 | 需要什么 |
|---|---|
| `goods.batchOnSale` | `{goodsIds:[id]}` |
| `goods.batchStock` | `{sourceId, quantity}` |
| `goods.commitEdit` / `commitUpdate` | `{goods_commit_id}` |
| `goods.commitCreateBySn` | `{goodsId}` |
| `goods.commitSubmit` | `{goodsId, commitId, version}` |
| `goods.commitDelete` / `commitOnShop` | 真实 goods_id |
| `promo.detail` | `{adId}` |
| `promo.updateMaxCost` | `{adId, maxCost:{value,unitCode}}` |
| `promo.updateBid` | `{updateBidList:[...]}` |
| `promo.batchCreate` | `{adInfoList:[{goodsId,maxCost,bidType:1,targetRoi,...}]}` |
| `promo.updateStatus` | `{adIdList:[], dataOperateStatus:1\|2}` |
| `promo.delete` | `{goodsId, adId, planId}` |
| `promo.adDiagnosis` | `{adId, 平台类型}` |
| `act.enrollPopups` | `{activityId}` |
| `act.lowPriceCheck` | `{goodsList:[...]}` |
| `shop.legacyGoodsDetailVO` | ForMMS 版要 `startDate/endDate` + `queryType:6`（已知，可能是账号无该权限） |

**推广域这 6 个写接口的 body 已经在 `promo.mjs` 里，Node 通道也通 —— 只差接业务逻辑。**

---

## 五、B 类：限流 / 冷却（9 个）

| 接口 | 性质 |
|---|---|
| `goods.list` / `onSale` / `offSale` / `batchOffSale` / `resourceValidate` | ⚠️ **服务端对该账号的接口族限制** —— 隔离测试（间隔 2.5s、健康分 100、无冷却）**仍全部 54001**，浏览器也一样。已用 `goods.listGlide` 替代列表功能，skill 不受影响。**换账号可解** |
| `act.list` / `cancelEnroll` / `enroll` | `100001` 2 小时频控（审计连打写接口触发），等冷却 |
| `chance.quickRelease` | 写接口连打触发，冷却后会恢复 |

---

## 六、C 类：无登录态 / 权限（15 个）—— 需要用户操作一次

```
live.pinduoduo.com/n-creator/video/home → 302 到 /login
Profile 里没有 msfe-pc-cookie-captcha-token → 拿不到 VerifyAuthToken
```

**基座已就位**：live 域的 Node 通道已经写好了（Chrome 取票 + Node 发请求），
只要该 Profile 登录过一次 live.pinduoduo.com，**基座自动接管，不用改任何 skill**。

**现在**：live 域返回 40001 时会明确提示「该 Profile 需先登录 live.pinduoduo.com」。

接口：`video.list / query / publish / publishPage / publishQualification / signedContract /
topicList / prePublishDelete / videoFlowCard / replayPromotionCfg / anchorInfo /
statsOverview / statsTrend / weeklyReport / mallDiagnosis`

### AI 素材域（4 个）—— E 类：连接层失败

`aivideo.genVideo / getResult / available / getStatus` —— `ec=0`（连接层就失败），需要独立鉴权（`ptj_token`）。

### 平台侧错误（1 个）—— D 类

`chance.total_info` → http 500（**拼多多服务端问题**，页面自己也是 500）。

---

## 六、「接口不行」分五种

| 类型 | 表现 | 谁能解 | 数量 |
|---|---|---|---|
| **A 缺业务参数** | 3000000 / ec=1 + 字段名提示 | ✅ 补参数（多数已抓） | 18 |
| **B 限流 / 账号族限制** | 54001 / 100001 | 冷却 / 换账号 | 9 |
| **C 无登录态** | live 域 40001（基座有明确提示） | ❌ **用户登录一次** | 15 |
| **D 平台错误** | 500 / 未知URL | ❌ 等平台 | 1 |
| **E 连接失败** | ec=0 | 需单独打通鉴权 | 4 |

**真正需要人介入的只剩 2 类**：live 域登录（15）+ AI 素材域鉴权（4）= **19 个**。
其余 28 个要么等冷却，要么补参数（body 已经抓到了）。

---

## 七、审计方法（重要）

**审计本身会触发限流**，把「限流」误判成「不可用」。

| 做法 | 说明 |
|---|---|
| ✅ 读接口连打 | 安全（重接口零间隔 × 30 全过） |
| ❌ 写接口连打 | 会触发 `100001` 2 小时冷却 |
| ⚠️ 审计结论 | 必须**隔离复测**才可信（间隔 ≥ 2.5s，单独跑） |

**限流真正的诱因**：60 秒内访问 > 13 个**不同**接口 —— 平台拦的是扫描式探测。

---

## 八、复现

```bash
node skills/_shared/audit-all-api.mjs      # 全量审计 → .audit-all.json
node skills/_shared/test-suite.mjs          # 22/22
node skills/_shared/test-node-capability.mjs # 纯 Node 能力
```

---

## 相关

- [[PDD-KNOWLEDGE]] — 基座知识库（架构 / 签名 / 限流 / 踩坑）
- [[PDD-PROMO-STATUS]] — 推广域专项
