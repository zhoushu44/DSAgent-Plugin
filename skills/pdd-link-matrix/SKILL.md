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

- **账号已绑定**：「账号连接」页已绑定**拼多多商家后台**。
- **登录态有效 + 账号健康分足够**：批量前会做一次总检查，冷却中/健康分过低直接拒绝。
- **主图文件就绪**：本地绝对路径，单张 ≤3MB，最多 5 张。
- **★ 批量铺货是高风险操作**：一次铺 N 条会显著提高风控概率，务必让用户知道将要铺多少条。
- **Chrome 可用**。

<!-- PRECONDITIONS:END -->



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

## 工作流

### W1：一款多链接批量铺货（主流程）

```
① 解析入参：product JSON + --count N（要铺几条）
② 规格池：读 artifacts/pdd-re/spec-pool.json，保证同一款多条链接 spec_id 一致
   （没有也能发，平台按 spec_value 自解析；先用 pdd-works --mode spec-pool 生成更稳）
③ 总检查：checkAccountUsable(SHOP) —— 冷却中/健康分过低直接拒绝，不发第一条
④ 循环 N 次，每次：
     a. checkAccountUsable —— 冷却中立即停（不铺这条）
     b. 组装该条的 title + 主图（同款不同标题/主图）
     c. 调 pdd-publish-http 的发布链路（单条）
     d. recordToAntiban(SHOP, ok?1000000:null, ...) —— 累积健康分
     e. 失败且是 risk_control / token_expired / rate_limit → 立即停止后续
     f. 成功且不是最后一条 → sleep 30s + random(0,10s)
⑤ 汇总：成功 x/N，失败的要带错误码，提前停止要说明原因
```

### W2：主图分裂（同一 product 换主图多次发布）

```
① 准备 N 张主图（本地路径，单张 ≤3MB）
② 复用 W1 的循环，只替换 images 字段，title/price/specs 保持不变
③ 其余步骤同 W1
```

**★ 为什么必须「风控即停」**：批量铺货是最容易触发风控的操作。
命中后继续铺只会把账号打到重量级（表现是页面被直接关掉），恢复要几小时。
早停一条，比晚停十条划算。

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
