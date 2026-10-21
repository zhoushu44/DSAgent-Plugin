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

## 与其他技能配合

- **上架前**：`spec-pool` 采集规格 → `pdd-publish-http` 上架（自动读 `artifacts/pdd-re/spec-pool.json`）
- **上架后**：`detail` 验证 SKU/预览图是否落地
- **复用**：`commit` 拿 170 字段 body → 改 values → 快速发相似商品（三层查一复用的 L2）
