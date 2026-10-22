# pdd-chance — 拼多多机会商品

采集拼多多商家后台**机会商品**（原蓝海商机）数据：平台按你店铺类目推荐的**潜力爆款线索**，含推荐关键词、参考价、热度/潜力指数、流量标签。

## 触发场景

- 看机会商品 / 蓝海商机 / 平台推荐卖什么
- 选品参考：平台认为有商机的品
- 看机会商品任务（礼物/考试/图片任务奖励）
- 看机会商品筛选项和类目树

排除：自己店铺商品数据（用 `pdd-shop`）、竞品对比（用 `pdd-promo`）。

## 入口

商家后台 → 商品管理 → 机会商品（`/goods/goods_list/chance`）

## 模式

| mode | 作用 | 关键字段 |
|------|------|---------|
| `list` | 机会商品主列表（默认） | `keywords` 推荐关键词 / `refer_price` 参考价 / `hot_index` 热度 / `potential_index` 潜力 / `labels` 流量标签 |
| `mine` | 我的机会商品（已跟款） | 同上 |
| `collection` | 收藏的机会商品 | 同上 |
| `mission` | 机会商品任务 | 礼物/考试/图片任务进度与奖励 |
| `filters` | 筛选项 | 页面所有可筛维度 |
| `cates` | 机会类目树 | 一级类目 + 机会商品数 |

## 用法

```bash
# 机会商品主列表（默认 35 条/页）
node scripts/chance.mjs --mode list

# 翻页 / 改每页条数
node scripts/chance.mjs --mode list --page 2 --size 50

# 我的机会商品 / 收藏
node scripts/chance.mjs --mode mine
node scripts/chance.mjs --mode collection

# 任务进度
node scripts/chance.mjs --mode mission

# 筛选项 / 类目树
node scripts/chance.mjs --mode filters
node scripts/chance.mjs --mode cates

# 多账号指定
node scripts/chance.mjs --mode list --account pdd_mms_xxxx
```

## 数据字段（list/mine/collection）

| 字段 | 含义 |
|------|------|
| `chanceId` | 机会商品 ID |
| `keywords` | **推荐关键词**（平台给的选品线索） |
| `referPrice` | 参考价（单位：分） |
| `priceLabel` | 价格标签（如 `1`/`2` = 价格档位） |
| `hotIndex` | 热度指数 |
| `mmsHotIndex` | mms 热度指数 |
| `oprtyIndex` | 商机指数（部分账号为 null） |
| `indexTarget` | 指数目标值 |
| `potentialIndex` | 潜力指数（如 8500） |
| `labels` | 流量标签数组：`首页流量` / `热门跟款` / `当季新品` / `潜力商品` / `全网热销` |
| `cats` | 三级类目 ID |
| `pics` | 图集张数 |
| `collected` | 是否已收藏 |
| `pic` | 主图 URL |

## 逆向要点

### 接口域（全新，风控宽松）

```
POST /opportunity-goods/chance-goods/home_list     {size, page, banner_type}
POST /opportunity-goods/chance-goods/my_list       {size, page}
POST /opportunity-goods/chance-goods/collection/list {size, page}
POST /opportunity-goods/chance-goods/mission_info  {}
POST /opportunity-goods/chance-goods/get_filters   {}
POST /opportunity-goods/chance-goods/cate_info     {}
POST /opportunity-goods/chance-goods/default_category        {}
POST /opportunity-goods/chance-goods/default_category_general {type:2}
POST /opportunity-goods/chance-goods/mall_gray     {}
POST /opportunity-goods/chance-goods/oversea       {}
```

**`/opportunity-goods/*` 不在官方风控 SDK 的 `antiCrawlerApiList` 白名单里**（163 个接口中无此域），
所以风控比商品域（`/vodka` `/glide`）宽松很多。

### 会话要求

机会商品页需要 **mms 主应用会话**，直接 `goto /goods/goods_list/chance` 会得空壳页。
流程：先 `goto /goods/goods_list` 建立会话 → 再 `goto /goods/goods_list/chance`。

### 风控防护（已接入）

- L4 冷却检查（命中频控直接拒绝）
- L3 滑块自动过（yydsocr + 人类化轨迹，实测 5 次通过）
- 两个页面都检测滑块（商品列表 + 机会商品页）

## 输出

单行 JSON `__DSAGENT_RESULT__`，含 `items` 数组 + 可读 `text`。
明细存 `artifacts/pdd-chance/<mode>-p<page>.json`。

## 关联技能

- `pdd-shop` — 自己店铺商品数据（曝光/访客/转化 + PUA 解码）
- `pdd-works` — 商品查询/上下架/删除
- `pdd-publish-http` — 商品上架（看中机会商品后直接上架）
