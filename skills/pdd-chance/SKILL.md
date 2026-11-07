---
name: pdd-chance
description: "拼多多机会商品（蓝海商机）选品与发布：按标签筛选商机（当季新品/热门跟款/全网热销/首页流量/潜力商品/热门收藏）、商机详情、发布同款（L2 两步门禁），以及主列表/我的机会/收藏/跟款验证/任务/筛选项/类目树。数据源 /opportunity-goods/*。触发：机会商品、蓝海商机、按标签选品、平台推荐卖什么、潜力爆款、跟款、发布同款、pdd chance。排除：普通商品上架（pdd-publish-http）、商品查询（pdd-works）、店铺经营（pdd-shop）。需绑定「拼多多商家后台」账号。"
metadata:
  builtin_skill_version: "1.0.0"
  dsagent:
    display_name: "拼多多·机会商品"
    emoji: "🎯"
    requires: {}
---

# pdd-chance — 拼多多机会商品

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
| **`quick_release` 返 54001** | `risk_control` | **写接口独立频控**（比查询严得多） | **停手 2~4 小时**。实测 4 轮×30s 重试全失败，越试越久。只读接口同时段正常 |

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

<!-- PITFALLS:START（由 dev/inject-skill-sections.mjs 注入） -->

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定拼多多商家后台账号 | `not_bound` | 引导到「账号连接」添加账号 |
| 登录态失效（跳登录页**且**无滑块遮罩、无业务错误码） | `token_expired` | 引导重新扫码登录 |
| 被风控打到登录页（跳登录页**但**有滑块遮罩或业务错误码） | `risk_control` | ★ **不要引导重新登录**（只会刷新风控基线）。引导人工过滑块，完成后重试 |
| `54001` 操作太过频繁 | `risk_control` | 可自愈（清 token→提新票→重放）；失败则人工过一次滑块，之后 10 分钟有通行证 |
| `40002` 高频限流 | `rate_limit` | ★ **重试无效**（接口级持久限流），只会延长封禁。等待冷却或降级 |
| HTTP `430` 网关级频率惩罚 | `rate_limit` | 等 15~30s 重试，**不要**误判成 session_expired |
| 页面被关闭 / `detached Frame` | `risk_control` | 平台主动关页面 = 临时风控。等 3~5 分钟再试，别连续重试 |
| 账号正被其他任务占用 | `rate_limit` | 账号锁生效中，等待当前任务结束 |
| `Failed to launch the browser process!` | `api_error` | 大概率是 Profile 被孤儿 Chrome 占用（SingletonLock 残留），不是 Chrome 坏了。杀占用该 Profile 的 chrome 进程后重试 |
| L2 写操作未带 `--confirm` | `needConfirm` | 这是预览门禁，把 text 给用户看并征得同意后带 `--confirm` 重试 |

> 完整机制与历史踩坑记录在知识库：`dsagent_wiki_search(keyword="风控")`

<!-- PITFALLS:END -->

<!-- PRECONDITIONS:START（由 dev/inject-skill-sections.mjs 注入） -->

## 前置条件

- **账号已绑定**：「账号连接」页已绑定**拼多多商家后台**（`mms.pinduoduo.com`）。
- **登录态有效**：失效时返回 `token_expired`，引导重新扫码登录。
- **Chrome 可用**：接口虽不在官方风控 SDK 白名单（较宽松），但仍需页面上下文发请求。
- **`--cat-id` 跨类目查询**需先知道类目 ID（可用 `cate` 模式拿全树）。

<!-- PRECONDITIONS:END -->



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
| **`labels`** | **★ 查本店铺可用标签 + 实时商机数（新增）** | `value` / `title` / `total` / `essay` |
| **`pick`** | **★ 按标签选商机（新增）** | `labels` 数组 / `referPriceYuan` 建议价 / 热度 / 潜力 |
| `list` | 机会商品主列表（默认） | `keywords` 推荐关键词 / `refer_price` 参考价 / `hot_index` 热度 / `potential_index` 潜力 / `labels` 流量标签 |
| **`detail`** | **★ 单商机详情（新增，只读）** | 参考商品名(限60字) / 建议价 / 热词推荐 / 标签 / 类目 |
| **`publish`** | **★ 发布同款（新增，L2 写）** | 两步门禁：预览 → `--confirm true` 建草稿 |
| `mine` | 我的机会商品（已跟款） | 同上 |
| `collection` | 收藏的机会商品 | 同上 |
| **`follow-check`** | **★ 一键验证跟款是否成功** | `my_total` / `follow_cnt` / `follow_1m` |
| `mission` | 机会商品任务 | 礼物/考试/图片任务进度与奖励 |
| `filters` | 筛选项 + **51 个站内热搜/缺货词** | `mall_chance_words` 是选品金矿 |
| `cates` | 机会类目树 | 看哪些一级类目开了机会池（当前 19 个） |

## 用法

```bash
# 机会商品主列表（默认 = 店铺主营类目，35 条/页）
node scripts/chance.mjs --mode list

# ★ 按一级类目跨类目查（如书籍类目 15543）
node scripts/chance.mjs --mode list --cat-id 15543

# 翻页 / 改每页条数
node scripts/chance.mjs --mode list --page 2 --size 50
node scripts/chance.mjs --mode list --cat-id 15543 --page 3

# ★ 跟款后验证（my_list + follow_goods_cnt 一键判定）
node scripts/chance.mjs --mode follow-check

# 我的机会商品 / 收藏
node scripts/chance.mjs --mode mine
node scripts/chance.mjs --mode collection

# 任务进度
node scripts/chance.mjs --mode mission

# 站内热搜/缺货词（选品金矿）
node scripts/chance.mjs --mode filters

# 机会类目树（看哪些类目开了机会池）
node scripts/chance.mjs --mode cates

# 多账号指定
node scripts/chance.mjs --mode list --account pdd_mms_xxxx
```

## ★ 按标签选商机（`--mode pick --labels`）

### 第一步：先查自己有哪些标签

```bash
node scripts/chance.mjs --mode labels
```

输出（实测两个店铺对比）：

```
本店铺可用标签（6 个，含实时商机数）：
  1. 当季新品（newinfashion_new） — 83 条商机
     可获新品标
  2. 热门跟款（hot_follow） — 11 条商机
  3. 全网热销（wide_popular） — 58 条商机
  4. 首页流量（home_page_new） — 161 条商机
     入选首页
  5. 潜力商品（thousand_rec） — 35 条商机
  6. 热门收藏（hot_favorites_goods） — 38 条商机
```

### ⚠️ 标签池是店铺级的，不是全局固定

实测同一天、平台同一版本：

| 店铺 | 主营类目 | 可用标签数 | 缺少 |
|------|---------|-----------|------|
| 爱绿森居家日用旗舰店 | 餐饮具 | **6 个（全）** | — |
| 空空商行 | 家居饰品 | **5 个** | ❌ 无「首页流量」 |

**所以必须先用 `--mode labels` 查自己店铺实际能用什么**，不要照抄文档里的标签名。

### 可用标签（平台全量 6 个）

| 传值 | 中文名 | 含义 | 提示语 |
|------|--------|------|--------|
| `newinfashion_new` | 当季新品 | 应季新款 | 可获新品标 |
| `hot_follow` | 热门跟款 | 已被验证、跟的人多 | — |
| `wide_popular` | 全网热销 | 站内外销量起势 | — |
| `home_page_new` | 首页流量 | 发布同款可入选首页 | 入选首页 |
| `thousand_rec` | 潜力商品 | 小二甄选潜力品 | — |
| `hot_favorites_goods` | 热门收藏 | 点击转化好的款 | — |

### 参数规则（血泪教训）

```bash
# ✅ 单标签
node scripts/chance.mjs --mode pick --labels home_page_new

# ✅ 多标签 = OR 并集（不是交集）
node scripts/chance.mjs --mode pick --labels home_page_new,thousand_rec

# ✅ 中文名也行（内置别名映射）
node scripts/chance.mjs --mode pick --labels "当季新品,首页流量"

# ✅ 配合类目
node scripts/chance.mjs --mode pick --labels home_page_new --cat-id 16548

# ✅ 看某标签下有多少条（size=1 只要总数）
node scripts/chance.mjs --mode pick --labels home_page_new --size 1

# ❌ 不要传 low_price（低价跟款）—— 它只在 hide_labels 组，传了返回 0
# ❌ 不要传字符串形式的 JSON —— 必须逗号分隔
```

**三条必须知道的限制：**

1. **`labels` 必须是数组**（脚本已帮你转），传字符串给平台会报 `4000000 请求method,argument,body错误`
2. **多标签是 OR 不是 AND** —— 实测单标签 161 → 双标签 208，是并集
3. **不能与 `cat_id_1: -1` 共存** —— 会返回 0 条。不传 `--cat-id` 时平台自动用主营类目

### `labels` 组 vs `hide_labels` 组（别搞混）

`get_filters` 返回两个组，长得很像但用途相反：

| 组 | 用途 | 含 `low_price`？ |
|---|---|---|
| `labels` | **可筛选**（传给 `--labels`） | ❌ 不含 |
| `hide_labels` | **排除项**（不能用于筛选） | ✅ 含「低价跟款」 |

`hide_labels` 组的完整内容：当季新品 `newinfashion`、网红潮流 `red_man`、**低价跟款 `low_price`**、流量精选 `flow_selected`、今日上新 `new_create`、首页流量 `home_page`、海淘热品 `oversea`

> 同一个中文名（如「当季新品」）在两个组里对应**不同的英文值**：labels 组是 `newinfashion_new`，hide_labels 组是 `newinfashion`。传错组的值会返回 0 条。

### ⚠️ 标签 ≠ 你能挂的标

这是最容易误解的一点：

| 能做的 | 不能做的 |
|--------|---------|
| 筛选「首页流量」标签的商机，跟这些款 | 给自己的商品**指定**挂哪个标 |
| 跟款后间接提高入选首页概率 | 直接申请「当季新品」标 |

**标签是筛选条件，不是授予。** 平台按你的商品和价格判定，不给申请。

**实测数据**：550 条样本中，商机卡片最多挂 **2 个**标签（占 8.2%），60% 的卡片**一个标签都没有**。前端渲染还有硬截断 `if(t>1) return null`。

## ★ 商机详情（`--mode detail`）

```bash
node scripts/chance.mjs --mode detail --chance-id 5c80862f9578b82516c7456c701d2c8c
```

输出：

```
商机详情 [5c80862f9578]
  参考商品名：特厚新款卡通纸杯咖啡水杯一次性杯子办公加厚食品级家用商用整箱（限 60 字）
  建议价：¥5.6（引流档）
  热度：100 | 潜力：8500
  标签：首页流量(入选首页) / 热门收藏
  类目：16548>16663>16675 | 图片：9 张
  热词推荐（7）：户外、一次性杯子、把手、秒杀、食品级、加厚、儿童水杯
  其中热门词：一次性杯子、秒杀
```

**数据源**：`get_keywords_recommend` —— 这个接口本身就是**商机详情接口**，返回 `goods_name` / `group_price` / `hot_keywords[]`。不要试图用 `home_list` 回捞（那个池子有分页排序漂移，目标可能在第 6 页之后）。

## ★ 发布同款（`--mode publish`，L2）

### 两步门禁

```bash
# 第 1 步：预览（零写操作）
node scripts/chance.mjs --mode publish \
  --chance-id <chance_id> \
  --product-file ./my-product.json

# 第 2 步：确认后建草稿（★ L2 写操作）
node scripts/chance.mjs --mode publish \
  --chance-id <chance_id> \
  --product-file ./my-product.json \
  --confirm true
```

`my-product.json` 格式：

```json
{
  "title": "商品标题",
  "images": ["E:\\path\\to\\main1.jpg"],
  "detailImages": ["E:\\path\\to\\detail1.jpg"],
  "price": "5.60",
  "stock": "300",
  "specs": [{ "name": "颜色", "values": [{ "value": "红色" }] }],
  "skus": [{ "specs": { "颜色": "红色" }, "price": "5.60", "stock": "300" }]
}
```

### 发布链路

```
① POST /opportunity-goods/chance-goods/quick_release { chance_id }
   → 返回 draft_id / goods_commit_id / is_home_page
② 跳 /goods/goods_add/index?type=add&from=chance&homePage=&id=<draft_id>
③ 填表提交（交给 pdd-publish-http）
```

### ⚠️ 已知限制（必读）

**`quick_release` 在 2026-11-05 测试时被 `54001 操作太过频繁` 拦住，4 轮重试（每轮间隔 30s）全部失败。只读接口同时段完全正常。**

这意味着：
- `quick_release` 的风控等级远高于查询接口
- 该接口**尚未真机验证成功过**
- 如果遇到 54001：**停手 2-4 小时**，不要连续重试（会延长冷却）

**放弃草稿的后果**：`quick_release` 一返回就已在平台创建草稿。若中断，须到「草稿箱」手动删除，否则留下脏数据。


## 跟款流程与判定（重要）

**「商品发布成功」≠「跟款成功」**。平台三层判定：

```
① 商品发布成功      → goodsCommit/action/edit + commit/submit 都成功
② 平台认定「跟款」   → 提交体带 chance_id（必须从机会商品页「发布同款」入口进）
③ 跟款成功（官方标记）→ 以下任一变化：
   - my_list 里出现该 chance_id          ← 最直接
   - mission_info.follow_goods_cnt +1    ← 任务计数
```

**正确流程**：

```bash
# 1. 选机会商品（看 labels / refer_price）
node scripts/chance.mjs --mode list

# 2. 后台 → 商品管理 → 机会商品 → 点该商品「发布同款」
#    ★ 必须从这个入口进！直接走「发布新商品」提交体不带 chance_id，不算跟款

# 3. 表单页会自动带出类目/关键词/参考价/素材
#    标题/主图保持与原款相似（平台会比对）
#    定价 ≤ refer_price 可吃「低价跟款」搜索流量倾斜

# 4. 提交发布后验证
node scripts/chance.mjs --mode follow-check
```

**流量机制（labels 决定）**：

| 标签 | 流量机制 | 操作要点 |
|------|---------|---------|
| 首页流量 | 发布同款可入选拼多多首页，大幅流量加成 | 主图/标题贴近原款 |
| 当季新品 | 可获新品标，新品流量先机 | 赶应季窗口发布 |
| 热门跟款 | 平台正在推的热门款 | 立即发，越快越好 |
| 潜力商品 | 入选首页 + 长尾推荐 | 保持关键词一致 |
| 全网热销 | 需求已验证，竞争也大 | 拼价格/差异化 |
| 低价跟款 | 不高于建议价 → 搜索流量倾斜 | 定价 ≤ `refer_price` |
| 热门收藏 | 收藏加购加权 | — |

> `refer_price` 单位是**分**。

## `--cat-id` 跨类目查询

| 项 | 说明 |
|---|---|
| 参数名 | **`cat_id_1`**（一级类目 ID） |
| 空值 | 返回店铺主营类目的机会商品（平台推荐，如餐饮具店 total=455） |
| 传值 | 返回该类目的机会商品（如书籍 total=1500） |
| **未开放类目** | 返回 `total=0` + 提示「该类目未开放机会池」 |

**实测**：拼多多机会商品池**当前只开放 19 个一级类目**（餐饮具/厨房/收纳/清洁/居家/节庆/饰品/珠宝/园艺/乐器/书籍/宠物/农资/古董/烟品/洗护/音乐/农用/畜牧），
**童装/母婴/女装/男装等服饰类目未开放**——传这些类目的 `cat-id` 会返回 `total=0`。

> ⚠️ **只有 `cat_id_1` 参数生效**。实测 `cate_id_1` / `category_id` / `opt_id` 都被忽略，会返回默认池（455 条）。

## 数据字段（list/mine/collection）

| 字段 | 含义 |
|------|------|
| `chanceId` | 机会商品 ID |
| `keywords` | **推荐关键词**（平台给的选品线索） |
| `referPrice` | 建议价（**单位：分**，如 9499 = 94.99 元） |
| `referPriceYuan` | 建议价（**元**，已换算） |
| `priceLabel` | 平台价格档位（0/1/2） |
| `priceLabelName` | 档位名：`品质档` / `主流档` / `引流档` |
| `hotIndex` | 热度指数 |
| `mmsHotIndex` | mms 热度指数 |
| `oprtyIndex` | 商机指数（部分账号为 null） |
| `indexTarget` | 指数目标值 |
| `potentialIndex` | 潜力指数（如 8500） |
| `labels` | 流量标签数组：`首页流量` / `热门跟款` / `当季新品` / `潜力商品` / `全网热销` / `热门收藏` |
| `cats` | 三级类目 ID |
| `pics` | 图集张数 |
| `collected` | 是否已收藏 |
| `pic` | 主图 URL |

### `price_label` 价格档位（2026-10-23 实测算出）

平台把机会商品分三档，**价格带几乎不重叠**（样本：餐饮具 35 条）：

| price_label | 档位名 | 价格范围 | 中位数 |
|-------------|--------|---------|--------|
| `0` | 品质档 | 10.70 ~ 257.45 元 | 83.50 元 |
| `1` | 主流档 | 5.90 ~ 79.63 元 | 14.47 元 |
| `2` | 引流档 | 1.01 ~ 12.50 元 | 5.58 元 |

> ⚠️ 阈值**按类目动态调整**——童装类目 ¥47.4 也可能被判「引流档」，
> 不要跨类目套用上表，只看同店铺同类目的分布。

### `refer_price` 与流量（关键）

官方定义（`get_filters` 里挖到的原文）：

> **低价跟款（low_price）**——「不高于建议价跟款机会商品，可以获得**搜索流量倾斜**」

| 你的定价 | 结果 |
|---------|------|
| `price ≤ refer_price` | ✅ 打上 `low_price` 标签 → 搜索流量倾斜 |
| `price > refer_price` | ❌ 拿不到该倾斜 |

**实战定价**：

```bash
# 想吃低价跟款流量
price = refer_price × 0.95        # 留 5% 余量防比价踩线

# 但别盲目低价——price_label=0 的品质档商品定价远低于建议价，
# 可能被平台判「低价劣质」反降权。档位要匹配。
```

`low_price` 是**隐藏标签**（在 `hide_labels`，不在正向 `labels`），
列表页看不到——它是你上架后平台给你打的。

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



