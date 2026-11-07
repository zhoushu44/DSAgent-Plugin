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

<!-- RISK-CHEATSHEET:START（由 dev/inject-risk-cheatsheet.mjs 注入，请勿手改） -->

## ⚠ 风控速查（先读这里再排查）

> 完整机制与历史踩坑记录在**知识库**，遇到风控问题**先查库**：
> ```
> dsagent_wiki_search(keyword="风控")                                     # 全部风控页
> dsagent_wiki_search(path="平台/entities/拼多多风控机制与应对.md")        # 机制总览
> dsagent_wiki_search(path="平台/entities/拼多多签名注入范围（Anti-Content vs crawlerInfo）.md") # 该不该带签名
> ```

### 错误码 → 处置

| 错误码 | failureKind | 含义 | 正确处置 |
|---|---|---|---|
| `54001` | `risk_control` | 操作太过频繁（风控） | **可自愈**：清旧 token → 提新票 → 重放。失败则人工过一次滑块，通过后有 10 分钟通行证。**不要**重新登录 |
| `40002` | `rate_limit` | 高频限流（**接口级**） | **不可本地修复**，重试无效、只会延长封禁。等待冷却，或降级（如 search → feed） |
| `100001` | `rate_limit` | 活动写操作频控（请 2 小时后重试） | **不可本地修复**。等待 2 小时或换时间段 |
| `43001` | `token_expired` | 会话过期（**不是风控**） | 重新扫码登录。注意凭证库快照可能是旧票，优先用浏览器当前 Cookie |
| `40001` | `token_expired` | 未登录 | 重新扫码登录 |
| `310120000` | `reload_required` | **页面上下文失效**（403 专用码） | 官方处置是 `window.location.reload()`：重开/刷新页面后重试。**不是登录失效，不要跳登录页** |
| `40010` | `no_permission` | 无权限 | 可能是账号类型不对（需诚信通/实力商家），或换主店号 |
| `2000000` | `no_permission` | 账号不适合发布 | 权限问题，换号或到后台查违规记录 |
| `48143` | `api_error` | 非法请求 | 该接口依赖页面 SDK 的请求上下文，需让页面自己发请求（DOM 触发） |
| `3000000` | `api_error` | 参数错误或灰度未开放 | 检查入参（日期/页码/queryType 等） |
| HTTP `430` | `rate_limit` | 网关级频率惩罚（Cookie 有效） | 等 15~30s 重试。**不要**误判成 session_expired |
| `detached Frame` / `Target closed` | `risk_control` | 平台主动关掉页面 | 等 3~5 分钟再试，别连续重试 |

### 四条铁律

1. **不要把 54001 当 token_expired** —— 前者需要过一次滑块，后者才需要重新登录。误判会让用户反复登录，每次登录还刷新一次风控基线。
2. **不要重试 40002** —— 它是接口级持久限流，实测冷却 240s 零请求后仍空。
3. **不要在冷却期内连续调用** —— 拼多多按「累计行为分数」延长封禁，越打越久。
4. **分清两个签名条件，别合并** —— 平台有两套独立判断：**域名正则**（mms/ims/... 命中就带 `header Anti-Content`）+ **162 条路径白名单**（命中才在 body 里塞 `crawlerInfo`）。只要域名是 `mms.pinduoduo.com`，**头就必须带**；把「不在 162 名单」当成「不用签名」会稳定打出 54001（我已真机踩过）。判据统一用 `_shared/pdd-sign-scope.mjs` 的 `signPlan(url)`。

### 其他已知坑

- **两个登录态不通用**：`pdd`（H5 买家态，`.yangkeduo.com`）与 `pdd_mms`（商家后台态，`mms.pinduoduo.com`）是两套独立账号，各跑一套风控评分。
- **`Failed to launch the browser process!`** 大概率是 Profile 被孤儿 Chrome 占用（SingletonLock 残留），不是 Chrome 坏了。清理：`~/.dsh/pdd-account-locks` 无关，要杀占用该 Profile 的 chrome 进程 + 删 `SingletonLock`。
- **账号级并发**：两个任务同时打同一个号会显著提高被封概率，`_shared/pdd-risk.mjs` 的账号锁会拦住，看到「正被其他任务占用」就等等。
- **签名兜底字面量**：平台自己的兜底值是 `"getRisckInfoError"`（注意 `Risck` 是平台拼写）。带它发请求 = 自报「我拿不到环境指纹」，比不带更可疑。

<!-- RISK-CHEATSHEET:END -->



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
