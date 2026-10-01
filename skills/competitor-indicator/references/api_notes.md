# 达摩盘竞品分析 API 接口说明

> 通过 Chrome DevTools 网络抓包获取，2026-06-12

## 认证

与万相台/生意参谋共用 SSO 会话（`platform=sycm`），由 Connect Gateway 代理。

- 凭证与 `csrfId`：在「平台连接」登录生意参谋时由 Connect 探测并缓存（阿里妈妈 `checkAccess`）
- 技能侧：`GET /api/v1/accounts?platform=sycm` 读取 `tb_token`、`alimama_csrf_id`（及万相台用的 `alimama_login_point_id`）
- 平台请求：经 Connect `POST /api/v1/proxy`（cookie 留在 Connect，技能内不调登录接口）

## 核心接口

本 Skill 按 **三个原子** 拉取数据（CLI：`overall` / `flow` / `audience`；一键 `analyze` 依次执行三者）：

| 原子 | 接口 | 主要指标 |
|------|------|----------|
| 整体分析 | `POST .../base/shop/indicator` + `POST .../base/indicator` | 整体 IPV、加购率、成交转化率、成交笔数、笔单价、单次点击成本 |
| 流量分析 | `POST .../flow/indicator` | 广告流量：点击量、引导成交/加购/转化、点击率、引导 ROI |
| 人群画像 | `POST .../insight/tag/chart` | 性别、年龄、消费能力等级（按行为+天数筛选） |

Base URL: `https://dmp.advgateway.taobao.com`

Query params（三个接口相同）:

| 参数 | 说明 |
|------|------|
| bizCode | 固定 `dmp` |
| _tb_token_ | `/accounts` 绑定上下文 |
| _csrf / csrfId | `/accounts` 的 `alimama_csrf_id`（与万相台共用） |

Request Body（三个接口相同）:

```json
{
  "competitorIds": [957464759999],
  "endDate": "2026-06-11",
  "peerBeginDate": "2026-05-29",
  "peerEndDate": "2026-06-04",
  "competitionType": "2",
  "entityId": 1004290388819,
  "beginDate": "2026-06-05"
}
```

## 响应指标

| 展示名 | API 字段 | 来源 | 备注 |
|--------|----------|------|------|
| 整体IPV | pv → click | shop | shop 的 `click` = 整体点击量 |
| 整体加购率 | cartRate | shop | |
| 整体成交转化率 | alipayConversion | shop | |
| 整体成交笔数 | alipayCnt | shop | |
| 整体笔单价 | averageOrderValue | shop | |
| 付费点击量 | clickAd → click | base | 顶部卡片读 base；与 shop.click（整体IPV）不同 |
| 单次点击成本 | clickCost | base | |
| 当天引导成交笔数 | alipayCnt1d | base | 顶部卡片读 base |
| 当天引导加购率 | cartRate1d | flow | 仅渠道树 |
| 当天引导成交转化率 | alipayConversion1d | flow | 仅渠道树 |
| 广告点击率 | clickRate | flow | 仅渠道树 |
| 点击量（渠道） | clickAd → click | flow | 仅渠道树 |
| 广告当天引导ROI | roi1d | base（整体卡片）/ flow（渠道树） | 整体核心指标读 base |

### flow/indicator 结构

`data.list` 为流量渠道数组（淘宝私域、淘宝搜索、关键词推广等），每项含指标块与可选 `subChannels`（可多层级，如「淘宝私域 → 我的淘宝 → …」）。解析时保留完整渠道树，报告按商品 → 渠道 → 子渠道折叠展示；汇总指标仍从各层级中选取竞品覆盖最全的块。

**注意**：`click` 在 shop / base / flow 中同名但语义不同，必须分源读取。

每个 competitorList 项：

- `competitorId` — 商品 ID
- `base` — 分析周期值（输出字段）
- `growthRate` — 增速（输出为 `growth_rate`）

API 另有 `basePeriod`（对比周期值），解析时仅用于判断是否有数据，**不写入 JSON**。

本 Skill 仅输出 `competitorIds` 中的竞品数据，排除 `entityId` 本店条目及 `strategyMap` 诊断。

## 人群画像（insight tag/chart）

参考线上服务 `dmp_jzfx.py` 的 `/getdata` 逻辑。

- **Endpoint**: `POST https://dmp.advgateway.taobao.com/api/dmp/insight/tag/chart`
- **Query**: `bizCode=dmp`, `moduleInstanceId=102`, `_tb_token_`, `_csrf`, `csrfId`
- **人群圈选**: 同行宝贝行为人群（tagId `283736`），按竞品商品 ID + 行为 + 天数筛选
- **默认**: 行为=搜索+购买(`2`,`4`)，天数=最近30天(`30`)
- **行为码**（竞争分析页 `optionGroupId=303280`）：`1`浏览 `2`搜索 `3`收藏 **`4`购买** **`5`加购**（与 `dmp_jzfx.py` insight 那套 `4`加购/`5`购买 不同，须按竞争分析页为准）
- **标签**: 用户性别(114554)、用户年龄(114555)、消费能力等级(163535)
- **响应**: `data.result.chartDataFull[]`，含 `optionId`、`optionName`、`rate`

每个竞品单独请求（item_id = 该竞品 ID）。

## 限流

竞争分析三个接口 + 人群画像（竞品数 × 3 标签）串行调用，建议单次请求间隔 >= 1.2 秒。
