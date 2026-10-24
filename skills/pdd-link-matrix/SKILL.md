---
name: pdd-link-matrix
description: "拼多多·一款多链接批量铺货：一个款铺 N 条链接、主图分裂（同一 product 换 title+主图多次发布）、批量主图+详情页。风控：每条间隔 30~40s、每条前检查账号冷却、命中风控立即停止（不继续铺）。触发：一个款铺N条链接、主图分裂、批量主图、批量铺货、多条链接、一货多卖、pdd link matrix。排除：单条发布（用 pdd-publish-http）、商品查询（用 pdd-works）。需绑定「拼多多商家后台」账号。"
metadata:
  builtin_skill_version: "1.1"
  dsagent:
    display_name: "拼多多·一款多链接"
    emoji: "🔗"
    requires: {}
---

# 拼多多 · 一款多链接批量铺

> 写操作（L2）：必须两步走——先不带 `--confirm` 拿预览，用户**明确同意**后才真正执行。
> **遇到风控立即停止**，不继续铺（越铺越封）。

## 何时使用

- 用户说「一个款铺 N 条链接」「主图分裂」→ 本技能
- 用户给一批关键词，要求每个关键词配一套主图与详情页 → 本技能
- 单条发布 → 用 `pdd-publish-http`

## 用法

```bash
# 1. 预览（不执行）
node scripts/matrix.mjs \
  --product-file base.json \
  --variants '[{"title":"A款 大容量","images":["/img/a1.jpg","/img/a2.jpg"]},{"title":"B款 加厚","images":["/img/b1.jpg"]}]'

# 2. 确认执行（带 --confirm true）
node scripts/matrix.mjs --product-file base.json --variants '[...]' --confirm true
```

### 变体字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | ✅ | 该条链接的标题 |
| `images` | ✅ | 该条链接的主图（本地绝对路径数组，1~5 张） |
| `desc` | | 描述（省略用基础商品的） |
| `detailImages` | | 详情图（省略用基础商品的） |

其余字段（规格/SKU/价格/库存/类目）全部沿用基础商品。

## 风控策略（核心）

```
① 每条间隔 30s + 随机 0~10s（最后一次不等）
② 每条发布前 checkAccountUsable —— 冷却中立即停
③ 每条发布后 recordToAntiban —— 健康分累积
④ 命中 risk_control / token_expired / rate_limit → 立即停止后续
⑤ 批量前一次总检查
```

**为什么要「风控即停」**：批量铺货是最容易触发风控的操作，
继续铺只会把账号打到重量级（拖动即关页面），恢复要几小时。

## 输出

```
一款多链接铺货结果：成功 3/5

  ✅ 1. A款 大容量
     https://mms.pinduoduo.com/goods/goods_list
  ✅ 2. B款 加厚
  ❌ 3. C款 薄款
     54001 平台风控
  ⚠️ 因风控/会话问题提前停止，剩余 2 条未发布。
```

## 规格池

自动从全店采集（`pdd-works --mode spec-pool` 的产物），
保证同一款的多条链接 spec_id 一致。未找到也能发（平台按 spec_value 自解析）。

## 相关

- [[拼多多全部技能清单]]
- [[拼多多商品上架实战]] — 单条发布七步链路
- [[拼多多防风控完整方案]] — 五层防护
