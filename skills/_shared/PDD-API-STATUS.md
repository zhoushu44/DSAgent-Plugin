# 拼多多接口能力清单（准确版）

> 2026-11-08
> 来源：80 个接口全量实测 + 限流排除验证

---

## 一、重要前提：审计方法

### 第一次审计（不可信）

连测 80 个接口 → 触发限流 → **17 个报 54001**

**这些 54001 全部是限流，不是接口不可用。**

### 验证方式

冷却 100 秒后重测 3 个报 54001 的接口：
```
✅ promo.dailyCost    恢复
✅ goods.list         恢复
✅ chance.quickRelease 恢复
```

### 正确审计方法

**每测 5~8 个接口，冷却 60 秒。**

否则会把「限流」误判成「不可用」。

---

## 二、可用接口（确认可用）

### 商品域

| 接口 | 路径 | 参数 | 备注 |
|---|---|---|---|
| `goods.listGlide` | `/glide/v2/mms/addProperties/goodsList` | `{page_num, page_size, only_query_no_props_goods:false, only_query_un_auth_brand:false}` | **total=180** |
| `goods.list` | `/vodka/v2/mms/query/display/mall/goodsList` | `{pre_sale_type:4, page:1, out_goods_sn_gray_flag:true, shipment_time_type:3, is_onsale:1, sold_out:0, size:N}` | ✅ 可用（需完整 body） |
| `goods.skuInfo` | `/vodka/v2/mms/query/sku/info` | `{goodsId}` | 完整 SKU |
| `goods.count` | `/vodka/v2/mms/query/display/mall_goods/count` | `{}` | 在售/下架/售罄数 |
| `goods.copyedExist` | `/vodka/v2/mms/query/display/goods_copyed/is_exist` | `{}` | |
| `goods.newStyleGray` | `/vodka/v2/mms/newStyleGoods/gray/queryNewStyleGoodsGray` | `{}` | |
| `common.status` | `/vodka/v2/mms/common/query/status` | `{}` | |
| `goods.batchOnSale` | `/vodka/v2/mms/batchOnSale` | `{goodsIds:[id]}` | ✅ 已验证 |

### 经营域

| 接口 | 路径 | 参数 |
|---|---|---|
| `shop.info` | `/earth/api/mallInfo/commonMallInfo` | `{}` **GET** |
| `shop.flow` | `/sydney/api/mallFlow/getMallFlowData` | `{}` |

### 机会商品

| 接口 | 路径 | 参数 |
|---|---|---|
| `chance.home` | `/opportunity-goods/chance-goods/home_list` | `{}` |
| `chance.quickRelease` | `/opportunity-goods/chance-goods/quick_release` | `{}` |

### 推广域

| 接口 | 路径 | 参数 | 备注 |
|---|---|---|---|
| `promo.dailyCost` | `/mms-gateway/reinhardt/invoice/getAdvertiserDailyCosts` | `{}` | ✅ 成功码 **1000** |

---

## 三、需要补参数（签名已通过）

这些接口返回 `3000000 参数校验失败`，说明**签名和鉴权都通过了**，只缺业务参数：

| 接口 | 报错 | 需要什么 |
|---|---|---|
| `goods.batchStock` | `sourceId 不能为空` | `{sourceId, quantity}` |
| `goods.commitEdit` | `goods_commit_id 不能为空` | `{goods_commit_id}` |
| `goods.commitUpdate` | `goods_commit_id 不能为空` | `{goodsId, goods_commit_id}` |
| `shop.goodsDetailVO` | `开始结束时间不能为空` | `{startTime, endTime}` |
| `shop.legacyGoodsDetailVO` | 同上 | 同上 |
| `shop.flowOverview` | `开始结束时间不为空` | `{startTime, endTime}` |
| `act.enrollPopups` | `活动id不能为空` | `{activityId}` |
| `act.lowPriceCheck` | `商品列表不能为空` | `{goodsList:[...]}` |
| `goods.commitCreateBySn` | `goodsId 不能为 null` | `{goodsId}` |
| `goods.commitSubmit` | `商品编辑版本号为空` | `{goodsId, commitId, version}` |

**这类接口的「不可用」只是缺参数，不是权限问题。**

---

## 四、真正不可用

### 视频域（15 个接口）

**原因：账号无创作者权限**

```
live.pinduoduo.com → 302 重定向到 mms 登录页 → SSO 失败
浏览器访问也一样
```

需要先在商家后台**开通视频创作者权限**。

涉及接口：
```
video.list / video.query / video.publish / video.publishPage
video.publishQualification / video.signedContract / video.topicList
video.prePublishDelete / video.videoFlowCard / video.replayPromotionCfg
video.anchorInfo / video.statsOverview / video.statsTrend
video.weeklyReport / video.mallDiagnosis
```

### 活动域（3 个）

**原因：`100001` 独立频控，2 小时冷却**

```
act.list / act.cancelEnroll / act.enroll
```

这个频控跟主站限流是分开的，触发后要等 2 小时。

### 推广域其余接口（10 个）

**原因：参数未抓全**

```
promo.list / promo.detail / promo.updateMaxCost / promo.updateBid
promo.batchCreate / promo.updateStatus / promo.delete
promo.accountAll / promo.entityReport / promo.adGroups
```

签名机制已攻克，但请求体结构需要真实抓包（要点击推广页面）。

### ai-video（4 个）

**原因：`ec=0`，需要 `ptj_token`**

```
aivideo.genVideo / aivideo.getResult / aivideo.available / aivideo.getStatus
```

这个 token 需要浏览器获取（24h 有效）。

### 其他

| 接口 | 问题 |
|---|---|
| `chance.getHotSearchGoods` | `http error:500`（平台侧错误） |
| `chance.totalInfo` | 同上 |
| `chance.base` | `40010 未知URL`（路径猜测错误） |
| `goods.commitDelete` | `600001 该编辑不存在` |
| `goods.commitOnShop` | `600009 商品不存在` |

---

## 五、汇总

| 类别 | 数量 | 占比 |
|---|---|---|
| ✅ **确认可用** | **13** | 16% |
| ⚠️ 需补参数 | 10 | 13% |
| ❌ 视频域（无权限） | 15 | 19% |
| ❌ 活动域（2h 频控） | 3 | 4% |
| ❌ 推广域（参数未抓） | 10 | 13% |
| ❌ ai-video（需 token） | 4 | 5% |
| ❌ 其他 | 5 | 6% |
| ⚠️ 限流污染（需重测） | 17 | 21% |
| 合计 | 80 | |

---

## 六、结论

### 「接口不行」分四种

| 类型 | 表现 | 能否解决 |
|---|---|---|
| **限流** | 54001 + "操作太过频繁" | ✅ 等 60~90 秒 |
| **缺参数** | 3000000 + 字段名提示 | ✅ 补参数 |
| **无权限** | 40001 / 302 跳登录 | ❌ 需开通权限 |
| **平台错误** | 500 / 未知URL | ❌ 等平台修复 |

**真正「做不了」的只有：视频域（15 个）+ 活动域频控（3 个）。**

**其余都是「还没做」，不是「做不了」。**

---

## 相关

- [[PDD-KNOWLEDGE]] — 基座知识库
- `skills/_shared/audit-all-api.mjs` — 审计脚本
