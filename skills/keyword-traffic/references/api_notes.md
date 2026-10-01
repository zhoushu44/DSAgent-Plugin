# 万相台无界版 流量解析 API 接口说明

> 通过 Chrome DevTools 网络抓包获取，2026-04-10

## 认证

### POST /member/checkAccess.json

获取 csrfId 和 loginPointId，所有后续请求都需要这两个值。

- Body: `{"bizCode": "universalBP"}`
- 返回: `data.accessInfo.csrfId` + `data.loginPointId`
- 平台请求：经 Connect `POST /api/v1/proxy`（`kind=http_post`，cookie 留在 Connect）
- 店铺绑定：`GET /api/v1/accounts?platform=sycm&include_cookie=false`（仅 shop_key）

## 核心接口

所有洞察数据通过统一端点获取，通过 `moduleId` 区分功能：

### POST /cube/triggerDynamicModule.json

Query params: `csrfId=<token>&bizCode=universalBP`

通用请求 Body:
```json
{
  "moduleId": <int>,
  "params": { ... },
  "csrfId": "<token>",
  "bizCode": "universalBP",
  "loginPointId": "<token>"
}
```

---

### moduleId=1571 -- 关键词类目匹配

获取关键词对应的行业类目列表。

params:
```json
{
  "bizCode": "onebpSearch",
  "originalWordList": ["充电宝"],
  "adgroupIds": "",
  "needGray": true
}
```

返回示例:
- `201272600` = "3C数码配件 便携电源"
- `201687701` = "汽车用品/电子/清洗/改装 汽车电子防盗安防"
- `50024094` = "3C数码配件 手机配件"
- `-999` = "全部"

---

### moduleId=1541 -- 市场趋势时间序列

获取关键词在指定时间范围内的每日趋势数据。支持最多13个月。

params:
```json
{
  "wordCategoryList": [{"word": "充电宝", "cateId": 201272600}],
  "startTime": "2025-03-10",
  "endTime": "2026-04-09",
  "isShowWordVs": 1,
  "isShowAdgroupVs": 0,
  "isShowShopVs": 0,
  "wordList": "充电宝",
  "strategyBidwordNameEqual": "充电宝",
  "vsName": "",
  "campaignAdgroupText": "&nbsp;",
  "needGray": true
}
```

返回数据:
- `chartGroup` 数组，每个元素代表一个指标的图表
- 每个 chartGroup 中有 `dataList`，每项为一天的数据点
- 数据字段（注意：字段名带关键词前缀）:
  - `theDate`: 日期
  - `{keyword}impressionIndex`: 展现指数
  - `{keyword}clickIndex`: 点击指数
  - `{keyword}ctr`: 点击率
  - `{keyword}cvr`: 点击转化率
  - `{keyword}competitionIndex`: 竞争指数
  - `{keyword}avgPrice`: 市场均价

6个指标:
1. impressionIndex（展现指数）-- 格式: 整数
2. clickIndex（点击指数）-- 格式: 整数
3. ctr（点击率）-- 格式: 百分比
4. cvr（点击转化率）-- 格式: 百分比
5. competitionIndex（竞争指数）-- 格式: 整数
6. avgPrice（市场均价）-- 格式: 金额

---

### moduleId=1465 -- 市场数据总结

获取 AI 生成的关键词市场分析总结。

params:
```json
{
  "originalWord": "充电宝",
  "categoryId": 201272600,
  "startTime": "2026-03-11",
  "endTime": "2026-04-09",
  "needGray": true
}
```

返回 5+1 个总结卡片:
1. 流量趋势: 7天展现指数、周环比、平均CVR
2. 竞争情况: 竞争指数、最优出价区间
3. 人群特征: 性别和消费层级
4. 地域特征: 高曝光地域和高转化地域
5. 时间特征: 流量高峰时段和高CTR时段
6. 词的特性: 搜索指数、竞争指数、均价、CVR、展现指数

---

## 请求头

```
Content-Type: application/json;charset=UTF-8
X-Requested-With: XMLHttpRequest
Origin: https://one.alimama.com
Referer: https://one.alimama.com/index.html
Accept: application/json, text/javascript, */*; q=0.01
```

## 限流

建议请求间隔 >= 1.2 秒，与推广管理助手一致。
