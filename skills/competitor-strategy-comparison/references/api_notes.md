# DMP 竞品策略对比接口与字段说明

域名：`https://dmp.advgateway.taobao.com`。公共参数为 `bizCode=dmp`、`_tb_token_`、`_csrf`、`csrfId`，由 `get_dmp_client()` 从当前智能体的 `sycm` 绑定中取得；Cookie 由 QiWorkConnect Gateway 携带。

## 选品与竞品校验

- `GET /api/goods/shop/dateRange`：店铺可查日期。
- `GET /api/goods/analysis/item/list`：本店可分析商品列表。
- `GET /api/goods/item/info?scene=1&itemId=...`：本品信息及叶子类目。
- `GET /api/goods/grow/define/success/load?itemId=...`：读取当前本品已经设置的成功品。已选成功品可能被弹窗候选搜索排除，因此必须先检查这里。
- `GET /api/goods/grow/define/success/item/list/condition?itemId=...`：同类目候选竞品的页面默认筛选条件。
- `GET /api/latestDay?sceneCode=goodsGrowPathSuccItemList`：竞品列表最新数据日。
- `GET /api/goods/grow/define/success/item/list`：按本品叶子类目与竞品 ID 搜索。默认且始终放开全部筛选，不传 `growthStage`、`sellerLevel`、`gmvRankRateLevel`、`priceLevel` 等限制项，也不能传这些字段的空字符串。不得使用固定筛选组合做兜底，只接受与用户输入完全一致的 `itemId`。

## 关键指标

`POST /dataplatform/dataset/report/query.json`，`datasetId=156`，`type=INDEX_CARD`。

| fieldId | 指标 |
|---|---|
| 6813 | IPV |
| 8291 | 营销推广点击量 |
| 8290 | 自然点击量 |
| 6986 | 成交笔数 |
| 6896 | 支付转化率 |
| 6895 | 笔单价 |
| 6897 | 加购率 |

维度字段：6794=日期，6797=宝贝 ID。先请求 `getField.json` 取得字段定义，再分别写入本品与竞品的 `values`。

## 人群对比

`POST /dataplatform/dataset/report/query.json`，`datasetId=175`，`type=TABLE`。维度字段 7460=商品 ID，7463=日期；行字段 7459。指标字段为 7469、7468、7465、7464。保留接口返回的人群名称和模糊化值。

## 推广策略

- `GET /api/goods/grow/comparison/scene`：一级场景的消耗、消耗占比、展现、点击、CTR、CPC、直接成交金额和直接 ROI。
- 同一接口追加 `sceneLevel1Id`：查询“场景投放策略明细”的二级投放方案。常见值：371=关键词推广，372=人群推广，395=线索推广。不要只查询这三个固定值：先从一级场景响应收集所有 `sceneId`，再逐个请求；页面七类场景中本品或竞品任一侧有数据的都必须覆盖。
- `GET /api/goods/grow/comparison/scene/keyword`：同行/本品 TOP 关键词。响应 `data.item[]` 为本品、`data.succItem[]` 为竞品；常用字段为 `keywordName`、`keywordType`，以及 `impression/click/ctr/conversionRate.indicatorValue`。

对比日期使用本品同期，不做 365 天偏移。

二级方案响应中的 `itemValue` 属于本品，`succItemValue` 属于竞品。判断“开了哪些计划”必须按每条方案两侧分别判断，不能仅凭 `sceneName` 把同一方案同时归给本品和竞品。

关键词推广（371）、人群推广（372）、货品全站推（435）必须强制查询计划明细，不能依赖一级概览是否返回；线索推广（395）保留兜底查询。一级概览出现的其他 `sceneId` 也要全部下钻。

本技能只分析用户所选周期的累计推广情况，不查询逐日趋势，也不输出投放天数。
