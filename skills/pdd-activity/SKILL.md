---
name: pdd-activity
description: "拼多多活动报名（营销活动）：查活动总览（54 种活动类型/大类分组/推荐活动/快速报名）、活动列表、活动类型清单、禁止报名原因、活动商品统计；报名（L2）。数据源：营销活动子应用 /act/* + /leekmms/* + /lakemms/*。读操作全部 HTTP 无副作用。触发：拼多多活动、营销活动、活动报名、大促报名、百亿补贴报名、限时秒杀报名、活动列表、pdd activity。排除：拼多多商品上架（用 pdd-publish-http）、商品查询（用 pdd-works）、推广数据（用 pdd-promo）、店铺经营（用 pdd-shop）。需绑定「拼多多商家后台」账号。"
metadata:
  builtin_skill_version: "1.3"
  dsagent:
    display_name: "拼多多·活动报名"
    emoji: "🎯"
    requires: {}
---

# 拼多多 · 活动报名

> **读模式**（overview/list/types/forbid/stats）无任何平台副作用。
> **写模式**（enroll）是不可撤销的真实操作（L2）：先预览给用户看，同意后才执行。

## 何时使用

- 用户说「有哪些活动能报」「拼多多活动」「大促报名」→ 用本技能
- 要看**活动类型**（限时秒杀/百亿补贴/九块九…）→ `types` 模式
- 要查**为什么报不了** → `forbid` 模式
- 要**报名** → `enroll` 模式（L2）

## 能力

| 模式 | 类型 | 说明 |
|------|------|------|
| `overview` | 只读 | 活动总览：类型数 + 大类分组 + 推荐活动 + 快速报名（默认） |
| `list` | 只读 | 活动列表（按大类分组，含 type_list + 标签） |
| `types` | 只读 | 活动类型清单（54 种，含关键词说明） |
| `forbid` | 只读 | 禁止报名原因（哪些活动报不了 + 原因） |
| `stats` | 只读 | 活动商品统计（历史/进行中/待审核/已结束 + 待处理资源位 + 价格屏蔽） |
| `effect` | 只读 | **活动效果看板**：资源位商品数/支付金额/访客/订单/收藏 + 24h 逐时趋势 + 昨日环比 |
| `records` | 只读 | 报名记录列表（含 `activityGoodsId`、销量、价格、状态——取消操作的参数来源） |
| `advice` | 只读 | 活动分析与建议（统计 + 禁止原因 + 按平台预估转化率降序推荐） |
| `enroll` | **L2** | 报名（`enrollPopups` → `lowPriceCheckV3` → `enrollV2`） |
| `quit` | **L2** | 取消报名（`cancelEnroll`，需 `activity_goods_id`） |

## 前置条件

1. **账号已绑定**：「账号连接」页已绑定**拼多多商家后台**（mms.pinduoduo.com）。
2. **登录态有效**：失效时返回 `token_expired`，引导重新登录。
3. **Chrome 可用**（活动子应用需页面环境取数）。

## 输入

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `--mode` | string | 否 | overview(默认) / list / types / forbid / stats / enroll |
| `--activity-id` | number | 条件 | enroll 模式必填 |
| `--goods-id` | number | 条件 | enroll 模式必填 |
| `--confirm` | flag | 条件 | enroll 必须带 true；省略只返回预览 |
| `--account` | string | 否 | 账号 shopKey |

## 输出

| 字段 | 含义 |
|------|------|
| `activityTypes` | 活动类型数组（typeId/name/keywords） |
| `activityGroups` | 活动大类（id/name/types/tags/hot） |
| `recommended` | 推荐活动（scene/majorActivityId/title/benefits） |
| `quickEnroll` | 快速报名活动（activityId/name/type/scene） |
| `forbid` | 禁止报名原因 |
| `stats` | 活动商品统计 |
| `text` | 面向用户的中文文案 |

## 用法

```bash
# 活动总览 / 列表 / 类型 / 禁止原因 / 统计
node {baseDir}/scripts/activity.mjs --mode overview
node {baseDir}/scripts/activity.mjs --mode list
node {baseDir}/scripts/activity.mjs --mode types
node {baseDir}/scripts/activity.mjs --mode forbid
node {baseDir}/scripts/activity.mjs --mode stats

# 活动效果看板（16 项指标 + 24h 趋势 + 昨日环比）
node {baseDir}/scripts/activity.mjs --mode effect

# 报名记录（拿 activityGoodsId）
node {baseDir}/scripts/activity.mjs --mode records

# 活动分析与建议（按平台预估转化率降序）
node {baseDir}/scripts/activity.mjs --mode advice

# 报名（L2）
node {baseDir}/scripts/activity.mjs --mode enroll --activity-id 22296 --goods-id 1018993401073

# 取消报名（L2）
node {baseDir}/scripts/activity.mjs --mode records            # 先拿 activityGoodsId
node {baseDir}/scripts/activity.mjs --mode quit --activity-goods-id 11285731860550
```

## 工作流

### W1：看有哪些活动能报

```
① 调 activity.mjs --mode overview       → 推荐活动 + 快速报名 + 活动大类
② 用户想看全部类型 → --mode types
③ 想知为何报不了 → --mode forbid
```

### W2：报名一个活动

```
① 调 --mode overview 拿 activity_id（或从后台活动页看 URL）
② 调 --mode enroll --activity-id X --goods-id Y  → 拿预览
③ 用户同意后带 --confirm true 执行
④ ⚠️ 报名 body 结构已从页面 chunk 提取但未实测校准，首次可能失败——
   失败时看 raw 字段的错误码，再到后台手动报名一次抓包对齐
```

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定商家后台账号 | `not_bound` | 引导到「账号连接」添加 |
| 登录态失效 | `token_expired` | 引导到「账号连接」重新登录 |
| 未知 mode | `api_error` | 用 overview/list/types/forbid/stats/enroll 之一 |
| enroll 缺参数 | `api_error` | 补 --activity-id 和 --goods-id |
| enroll 未带 confirm | `needConfirm` | L2 门禁，把 text 给用户看并征得同意 |

## 技术说明

活动是**独立子应用**（`mms.pinduoduo.com/act/*`），接口前缀分散：

| 前缀 | 用途 |
|------|------|
| `/leekmms/activityLabelAudit/query/activityListV3` | 活动列表（大类分组） |
| `/leekmms/activityLabelAudit/query/labelList` | 活动标签 |
| `/cambridge/api/announce/getActivityTypeDescriptions` | 活动类型说明（54 种） |
| `/leekmms/activity/query/forbidEnroll/reason` | 禁止报名原因 |
| `/lakemms/activityGoods/statics` | 活动商品统计 |
| `/lakemms/data_board/query/activity_effect_data` | **活动效果看板**（效果卡 + 24h 趋势 + 昨日环比） |
| `/lakemms/activityGoods/list` | 报名记录（含 `activity_goods_id`） |
| `/leekmms/theme/activity/recommend/theme` | 主题推荐 |
| `/leekmms/quick_enroll/recommended_module` | 推荐模块（百亿补贴等，含预估转化率） |
| `/leekmms/activity/query/recommend/list` | 推荐活动列表（含倒计时/已报名数） |
| `/tianmenmms-slave/quick_enroll/quickmultigoodscard` | 快速报名卡片 |
| `/tianmenmms/invite/activity_batch_tab_v2` | 平台邀请报名的活动 + 指定商品 |
| `/api/wizard/wolfsburg/brand_subsidy/merchant/query` | 品牌补贴文案（"N 个商品可报名"） |
| `/tianmenmms/price_calculation/batch_calculate` | 活动价试算（逐 SKU 折后价） |
| `/lakemms/activityGoods/lowPriceCheckV3` | 低价校验（报名前置） |
| `/lakemms/enrollV2` | **报名提交** |
| `/lakemms/activityGoods/cancelEnroll` | **取消报名**（body 必带 `activity_goods_id`） |

### 活动效果卡字段（effect 模式）

`activity_effect_data_volist[]` 按资源位（大促活动/全部）分组，每个资源位下有多张卡：

| 卡片 | 含义 |
|------|------|
| `act_goods_data_card` | 资源位商品数 |
| `pay_price_data_card` | 支付金额（**单位分**，需 /100） |
| `ag_visitor_data_card` / `goods_visitor_data_card` | 商品访客 |
| `activity_order_data_card` | 活动订单 |
| `goods_collection_data_card` | 商品收藏 |
| `visited_goods_data_card` / `customer_data_card` | 被访商品数 / 客户数（可能为 null） |

每张卡结构：`{value, extra_value(昨日同期值，字符串), card_specification_text, trend_value:{current_data:[{time:"01".."24", value}], history_data}}`。

**`extra_value` 是昨日同期值，不是比率**——环比要自己算 `(value - extra_value) / extra_value`。

### 报名 body 结构（2026-10-21 实测校准）

```json
{
  "activity_id": 21374,
  "goods_volist": [{
    "goods_id": 824693746830,
    "create_material_vo": { "create_goods_image_vo": {} },
    "view_confirmed_goods_protocol_vo": { "confirm_hit_cut_price": true },
    "create_activity_price_vo": {
      "create_quantity_vo": {},
      "create_sku_vos": [{
        "sku_front_ctx_vo": { "filling_sku_price": 485, "gear_rule": 100, "require_price": 485 },
        "sku_activity_price": 485, "sku_id": 1829109516151
      }]
    }
  }],
  "create_protocol_vo": {},
  "create_outer_activity_price_ratio_vo": { "merchant_confirm_outer_activity_price_ratio": true },
  "enroll_source_ctx": {
    "enroll_type": 26,
    "scene_type": "PROMO-OwnHome_SpecificMallRecommendMMS",
    "scene_full_coverage": "mmsActHomeSimpleMultiQuickEnrollV1",
    "source_type": "MMS_SpecificMallRecommend"
  },
  "behavior_collection_v1_cas_boost_factor": "base64(uyrhleur-<mallId>-<ms时间戳>)"
}
```

**报名三步链路**（缺一不可）：

```text
① POST /leekmms/activity/query/enrollPopups   {activity_id, goods_id_list, query_dimension:2}
② POST /lakemms/activityGoods/lowPriceCheckV3 {activity_id, goods_list:[{sku_activity_price_list:[{sku_id, sku_activity_price}]}]}
③ POST /lakemms/enrollV2                      ↑ 上面的完整 body
```

**boost_factor 可 Node 侧计算**：`btoa("uyrhleur-" + mallId + "-" + Date.now())`，不是浏览器指纹。

**`sku_activity_price` 来源**：`/tianmenmms/price_calculation/batch_calculate`（活动价试算，
`{tool_type, goods_price_item_list:[{goods_id, supply_tool_type_info:{percent_discount}, sku_price_item_list:[{before_discount_price, sku_id}]}]}`）。

**易错点**：
- `sku_front_ctx_vo` 是 `{filling_sku_price, gear_rule, require_price}`（不是 group_price）
- 协议确认字段是 `view_confirmed_goods_protocol_vo`（不是 create_protocol_vo）
- 低价校验不过会直接拒绝报名
