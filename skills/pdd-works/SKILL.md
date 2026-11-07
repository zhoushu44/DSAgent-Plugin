---
name: pdd-works
description: "拼多多商品管理：查商品列表/总览、单商品 SKU 全量（规格/价格/库存/预览图）、提交体快照（170 字段）、规格池采集；以及下架/上架/删除（L2，接口直调，需确认）。读操作全部 HTTP 无副作用。触发：拼多多商品列表、查拼多多商品、拼多多SKU、拼多多商品详情、拼多多规格池、拼多多下架、拼多多上架、拼多多删除商品、pdd works。排除：拼多多上架发布（用 pdd-publish-http）、采集比价（用 pdd-crawl）。需绑定「拼多多商家后台」账号。"
metadata:
  builtin_skill_version: "1.2"
  dsagent:
    display_name: "拼多多·商品查询"
    emoji: "🔍"
    requires: {}
---

# 拼多多 · 商品查询

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



> **只读模式**（overview/list/detail/sku/commit/spec-pool）无任何平台副作用。
> **写模式**（offsale/onsale/delete）是**不可撤销的真实操作（L2）**：必须两步走——
> 先不带 `--confirm` 拿预览给用户看，用户**明确同意**后才真正执行。

## 何时使用

- 用户说「查拼多多商品」「拼多多商品列表」「我上了哪些商品」→ 用本技能
- 要查**单商品 SKU**（规格组合/价格/库存/预览图）→ `detail` 模式
- 要拿**提交体快照**（170 字段完整 body，供复用/分析）→ `commit` 模式
- 要**采集规格池**（规格值→spec_id，上架前的准备）→ `spec-pool` 模式

## 能力

| 模式 | 类型 | 说明 |
|------|------|------|
| `overview` | 只读 | 商品总览：在售/未在售计数 + 前 N 条明细（默认） |
| `list` | 只读 | 商品列表：goods_id/标题/类目/SKU数/价格带/在售状态 |
| `detail` / `sku` | 只读 | 单商品 SKU 全量：spec/spec_id/拼单价/单买价/库存/预览图 |
| `commit` | 只读 | 单商品提交体快照（`on_shop/detail`，170 字段），三层复用的数据源 |
| `spec-pool` | 只读 | 全店规格池采集：遍历商品拉 SKU，抽 规格值→spec_id |
| `offsale` | **L2 写** | 下架商品（接口直调，100% 可靠，实测生效） |
| `onsale` | **L2 写** | 上架商品（接口直调；平台可能要求审核） |
| `delete` | **L2 写** | 彻底删除（接口返回 success 但受服务端会话绑定，可能不落库；稳妥路径：先 offsale 再页面删） |

## 前置条件

1. **账号已绑定**：「账号连接」页已绑定**拼多多商家后台**（mms.pinduoduo.com）。
2. **登录态有效**：失效时技能会返回 `token_expired`，引导用户重新登录。
3. **Chrome 可用**（签名注入需要页面环境，与 pdd-publish-http 同一机制）。

## 输入

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `--mode` | string | 否 | overview(默认) / list / detail / sku / commit / spec-pool |
| `--goods-id` | number | 条件 | detail / sku / commit 模式必填 |
| `--limit` | number | 否 | 返回条数上限，默认 20，上限 100 |
| `--csv` | flag | 否 | 同时导出 CSV 到 `artifacts/pdd-works/` |
| `--account` | string | 否 | 账号 shopKey；多账号未绑定时先向用户确认 |

## 输出

| 字段 | 含义 |
|------|------|
| `ok` | 是否成功 |
| `mode` | 实际执行的模式 |
| `summary` | overview 模式：`{on_sale, not_on_sale, total_shown}` |
| `items` | 明细数组（结构随 mode 变化） |
| `text` | 面向用户的中文文案，原样转述 |

## 用法

```bash
# 商品总览
node {baseDir}/scripts/query.mjs --mode overview

# 商品列表（导 CSV）
node {baseDir}/scripts/query.mjs --mode list --limit 50 --csv

# 单商品 SKU
node {baseDir}/scripts/query.mjs --mode detail --goods-id 1018993401073

# 提交体快照（三层复用数据源）
node {baseDir}/scripts/query.mjs --mode commit --goods-id 1018993401073

# 规格池采集（上架前准备）
node {baseDir}/scripts/query.mjs --mode spec-pool

# ── 写操作（L2，两步走）──
# 第一步：预览（不执行）
node {baseDir}/scripts/query.mjs --mode offsale --goods-id 1018993401073
# 第二步：用户同意后执行
node {baseDir}/scripts/query.mjs --mode offsale --goods-id 1018993401073 --confirm true
```

## 下架/上架/删除（L2）

| 模式 | 接口 | 可靠性 |
|------|------|--------|
| `offsale` | `POST /vodka/v2/mms/pc/offSale` `{goodsId}`（前置 `pc/resourceValidate`） | ✅ 实测生效 |
| `onsale` | `POST /vodka/v2/mms/pc/onSale` `{goodsId}` | ✅ 接口通（平台可能要求审核） |
| `delete` | `create_by_sn` 拿 commit_id → `POST /glide/v2/mms/edit/commit/delete` `{goods_id, goods_commit_id}` | ⚠️ 返回 success 但受服务端会话绑定，可能不落库 |

**删除的稳妥路径**：先 `offsale` 下架 → 到商家后台「已下架」列表点删除（UI 自动化稳定性差，暂未脚本化）。
**下架是删除的前置**：拼多多设计——在售商品只能下架，下架后才能删。

## 工作流

### W1：查「我上了哪些商品」

```
① 调 query.mjs --mode overview        → 在售/未在售计数 + 前 N 条
② 把 text 原样转述用户（含商品ID/标题/SKU数/价格带）
③ 用户想看某条明细 → --mode detail --goods-id <id>
```

### W2：上架后验证（配合 pdd-publish-http）

```
① pdd-publish-http 发布成功 → 拿到 goods_id
② 调 query.mjs --mode detail --goods-id <id>
③ 核对：SKU 数 / 规格值 / 拼单价 / 库存 / 预览图(✅) 是否与 product JSON 一致
④ 列表有索引延迟（1~2 分钟），查不到就等一会再查，不要当故障
```

### W3：上架前准备规格池

```
① 调 query.mjs --mode spec-pool       → 扫全店商品，抽 规格值→spec_id
② 产物落在 <workspace>/artifacts/pdd-re/spec-pool.json
③ 之后 pdd-publish-http 上架会自动读它（行数重建写 spec_id）
④ 新增颜色/尺码后重跑一次即可更新
```

### W4：下架/上架商品（L2）

```
① 调 query.mjs --mode offsale --goods-id <id>     → 拿预览（零写操作）
② 把预览展示给用户，征求明确同意（L2 门禁，不可跳过）
③ 用户同意后带 --confirm true 重新调用
④ 报告结果：ok=true → 已下架；平台可能提示「需审核」（onsale 时正常）
```

### W5：复用老商品快速发新品（配合三层查一复用）

```
① 调 query.mjs --mode commit --goods-id <老商品ID>
   → 170 字段提交体快照（artifacts/pdd-works/commit-<id>.json）
② pdd-publish-http 的 scripts/reuse.mjs --category "<类目>"
   → L1 类目记忆 / L2 存量商品（自动提取规格池）/ L3 属性树
③ 用快照当基底改 values（标题/图片/价格）→ 提交
```

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定商家后台账号 | `not_bound` | 引导到「账号连接」添加**拼多多商家后台**账号 |
| 登录态失效 | `token_expired` | 引导到「账号连接」重新登录 |
| detail/sku/commit 缺 goods-id | `api_error` | 补 `--goods-id` 重试 |
| 未知 mode | `api_error` | 用 overview/list/detail/sku/commit/spec-pool/offsale/onsale/delete 之一 |
| offsale/onsale/delete 未带 confirm | `needConfirm` | 这是 L2 预览门禁，把 text 给用户看并征得同意后带 `--confirm true` 重试 |
| **54001 风控（操作太过频繁）** | `risk_control` | ★ **不是登录态失效，不要重新登录**（只会刷新风控基线）。★ 也不要在冷却期内反复调用（会延长封禁）。引导用户打开浏览器窗口**人工过滑块/拼图**；通过后拿到 10 分钟通行证，届时重试即可 |
| **40002 高频限流** | `rate_limit` | ★ 官方实测**无法本地修复**，重试无效、只会延长封禁。等待冷却结束，或换用其他数据来源 |
| **43001 会话过期** | `token_expired` | 到「账号连接」重新扫码登录（凭证库 Cookie 快照可能是旧的） |
| 页面被关闭 / detached Frame | `risk_control` | 平台主动关页面 = 临时风控。等 3~5 分钟再试（别连续重试），或打开后台看是否要求验证 |

> **★ 三条铁律**（违反任意一条都会让风控更严重）：
> 1. **不要把 54001 当 token_expired** —— 前者需要过一次滑块，后者才需要重新登录。
> 2. **不要重试 40002** —— 它是接口级持久限流，实测冷却 240s 零请求后仍空。
> 3. **不要在冷却期内连续调用** —— 拼多多按累计行为分数延长封禁。

## 与其他技能配合

- **上架前**：`spec-pool` 采集规格 → `pdd-publish-http` 上架（自动读 `artifacts/pdd-re/spec-pool.json`）
- **上架后**：`detail` 验证 SKU/预览图是否落地
- **复用**：`commit` 拿 170 字段 body → 改 values → 快速发相似商品（三层查一复用的 L2）
