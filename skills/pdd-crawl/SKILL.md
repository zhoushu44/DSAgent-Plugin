---
name: pdd-crawl
description: "拼多多数据采集：拉取首页推荐流商品、按关键词搜索商品、或按商品 ID 拉取单品详情，返回商品名、价格、销量、店铺、链接等结构化字段。触发：采集拼多多商品、拼多多搜索商品、拼多多商品列表、拼多多比价、查拼多多商品价格、拼多多商品详情、抓取拼多多数据。排除：拼多多商品发布（用 pdd-publish）、订单（用 pdd-order）、库存（用 pdd-stock）、客服消息（用 pdd-im）、数据分析（用 pdd-analytics）。需绑定 pdd 账号。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "拼多多·数据采集"
    emoji: "🔌"
    requires: {}
---

# 拼多多数据采集

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



## 前置条件

> **★ 最容易踩的一点：`pdd`（H5 买家态）与 `pdd_mms`（商家后台）是两套完全独立的账号。**

| 平台 ID | 是什么 | 用在哪 | 当前是否已绑定 |
|---|---|---|---|
| `pdd` | 拼多多 **H5 买家态**，Cookie 域 `.yangkeduo.com` | **本技能（pdd-crawl）** | 见下 |
| `pdd_mms` | 拼多多 **商家后台态**，Cookie 域 `mms.pinduoduo.com` | `pdd-works` / `pdd-shop` / `pdd-promo` / `pdd-publish` | — |

**调用本技能前必须确认**：

1. **「账号连接」页面已绑定 `pdd` 账号**（扫码登录 mobile.yangkeduo.com）。
   拼多多对未登录访客强制跳转登录页，匿名无法采集 → 未绑定时返回 `not_bound`。
   ★ 只绑了 `pdd_mms`（商家后台）**不能**用于本技能，两套登录态不通用。
2. **多账号时必须由用户选定**：`pdd` 平台有多个可用账号且当前会话未绑定时，返回 `need_account_choice`，把候选给用户选后回传 `shopKey`。★ 绝不要自己挑一个——错号会静默影响所有用该平台的技能。
3. **Chrome 或 Edge 可用**：本技能靠 puppeteer 驱动真实浏览器（页面 JS 运行时生成 `anti_content` 签名，纯 HTTP 恒被拒）。

> 查询绑定状态：`dsagent_list_accounts(platform="pdd")`。

## 何时使用

- 用户说"拼多多上有什么好卖的"、"给我看看拼多多商品" → 首页推荐流（`mode=feed`）
- 用户说"搜一下拼多多上的手机壳"、"拼多多有哪些卖 XX 的" → 关键词搜索
- 用户说"这个拼多多商品多少钱"、"帮我看看这个商品" → 单品详情
- 用户说"对比一下拼多多上这几家的价格" → 多次搜索 / 详情后汇总

## 边界

- **不做商品发布** —— 上架 / 改价 / 改库存请用 `pdd-publish-2`
- **不做订单与售后** —— 请用 `pdd-order`
- **不做客服消息** —— 请用 `pdd-im`
- **不做深度数据分析** —— 报表与趋势请用 `pdd-analytics`；本技能只负责把原始商品数据取回来
- 只读操作，**不产生任何平台副作用**
- **必须已绑定拼多多账号**：拼多多对未登录访客强制跳转登录页，匿名无法采集
- 拼多多风控较严，单次采集会打开可见浏览器窗口；出现滑块 / 安全验证时需用户人工完成

## 执行流程

本技能**没有脚本入口**，执行方式是**直接调用 host 工具** `dsagent_pdd_crawl`。

> 为什么不是 Python 脚本：拼多多 H5 业务接口（`/proxy/api/**`）要求 `anti_content` 签名参数，
> 该值由页面 JS 在运行时生成，Cookie 注入式纯 HTTP 请求恒被拒（实测 `54001` / `403 error_code=40003`）。
> 因此由 host 工具用 puppeteer 打开页面、注入账号 Cookie 取数，取数分两路：
> ① 拦截**页面自身发出**的接口响应（`mode=feed` 走这条路）；
> ② 解析页面 **SSR 内联数据** `window.rawData.stores.store.data.ssrListData.list`
> （搜索页首屏不发搜索 XHR，商品直接内联在此，`mode=search` 依赖这条）。

### 1. 收集参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `mode` | 否 | `feed`（首页推荐流，**推荐**）/ `search`（关键词搜索）/ `goods`（单品详情）。省略时自动推断：有 `goodsId` → `goods`，有 `keyword` → `search`，都没有 → `feed` |
| `keyword` | `mode=search` 时必填 | 搜索关键词，如 `手机壳` |
| `goodsId` | `mode=goods` 时必填 | 拼多多商品 ID（纯数字） |
| `limit` | 否 | 返回条数上限，默认 20，最大 100 |
| `account` | 否 | 指定账号 `shopKey`；多账号待选时回传用户选择 |

> **★ 取数路径选择（实测结论）**：拼多多对 `search` / `goods` 接口有较强的账号级频控，
> 常返回 `429 error_code=40002`（「系统繁忙」）或页面不发出搜索请求。
> `mode=feed`（首页推荐流，接口 `/proxy/api/api/alexa/cells/hub/v3`）实测**稳定可用**，
> 字段完整（商品名 / 价格 / 销量 / 缩略图 / 商品 ID），是当前最可靠的取数路径。
> **用户没有明确指定关键词或商品 ID 时，优先用 `mode=feed`。**

### 2. 调用工具

首页推荐流（推荐）：

```
dsagent_pdd_crawl(mode="feed", limit="20")
```

关键词搜索：

```
dsagent_pdd_crawl(keyword="手机壳", limit="20")
```

单品详情：

```
dsagent_pdd_crawl(mode="goods", goodsId="123456789")
```

### 3. 报告结果

- 成功：把返回的商品列表整理给用户（商品名 / 价格 / 销量 / 店铺 / 链接），必要时做价格排序或汇总
- 失败：按返回的 `failureKind` 走下方「错误处理」
- 工具会返回 `sourceUrls`（本次实际命中的接口），排查"没有数据"时把它一并展示

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定拼多多账号 | `not_bound` | 引导用户到「账号连接」页面扫码登录拼多多账号（未登录无法采集） |
| 平台有多个可用账号且当前会话未绑定 | `need_account_choice` | **把候选列表给用户选**，把选定的 `shopKey` 填进 `account` 参数重调；★ 绝不要自己挑一个 |
| 真的登录态失效（跳登录页**且**无滑块遮罩、无业务错误码） | `token_expired` | 引导用户到「账号连接」页面**重新登录**拼多多 |
| 被风控打到登录页（跳登录页**但**有滑块遮罩或业务错误码） | `risk_control` | ★ **不要引导用户重新登录**（那只会刷新风控基线，问题依旧）。引导用户打开浏览器窗口人工完成滑块/安全验证，完成后重试 |
| 搜索接口被平台限流（`error_code=40002`「系统繁忙」，SSR `hasError=true`） | `risk_control` | ★ **不要反复重试 search**：`40002` 是接口级**持久**限流，实测冷却 240s 零请求后仍空，重试无法解除、只会延长封禁。直接改用 `mode=feed` 取数，或告知用户稍后再试 |
| 拦截到接口但无商品字段 / 接口全 403 | `parse_error` | 打开浏览器窗口确认是否出现滑块或安全验证，人工完成后重试；若已登录仍无数据，可能是平台接口调整，把 `sourceUrls` 反馈给用户 |
| 缺少 `keyword` 或 `goodsId` | `api_error` | 按 `mode` 补齐必填参数 |
| 已有采集窗口在进行中 | `api_error` | 提示先等待或关闭已弹出的浏览器窗口 |
| 未找到 Chrome / Edge | `api_error` | 提示用户安装 Chrome 或 Edge |

### ★ 风控判别决策树（2026-10-27 起）

```
页面跳到了 login.html？
├─ 有滑块/安全验证遮罩，或已见到业务错误码（54001/40002/...）
│    → risk_control：账号被风控，Cookie 可能仍有效
│      · 不要重新登录（会刷新风控基线）
│      · 人工过滑块 → 完成后重试
└─ 两者都没有
     → token_expired：真的登录态失效，重新登录

拿到了 0 条商品？
├─ 业务错误码含 40002（「系统繁忙」）
│    → 接口级持久限流，重试无效
│      · 改走 mode=feed（首页推荐流，实测稳定可用）
│      · 告知用户稍后再试
└─ 其他
     → parse_error：把 sourceUrls 反馈给用户
```

**为什么必须区分**：拼多多的风控会把页面踢到登录页，但此时账号并未过期。若一律判为 `token_expired` 并引导重新登录，用户会反复登录而问题依旧——每次登录还刷新一次风控基线。

## 环境变量

本技能为纯指令型，不执行脚本，无环境变量依赖。
账号凭证由 host 工具从凭证库读取并**在浏览器内注入 Cookie**，日志与返回值均已脱敏，**技能侧不接触 Cookie**。
