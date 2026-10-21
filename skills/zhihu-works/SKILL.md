---
name: zhihu-works
description: "知乎创作数据查询与分析：拉自己账号下全部创作（文章/回答/想法）的阅读、赞同、评论、收藏、分享、涨粉UV、涨粉率、平均阅读时长、折叠状态，以及单篇的汇总与日趋势，按六条口径输出可执行结论。触发：知乎数据、创作数据、文章数据、内容分析、知乎后台数据、阅读量、赞同数、涨粉、创作者中心、zhihu analytics、我的文章表现、哪篇文章好。排除：知乎内容发布（用 zhihu-publish-http 或 zhihu-publish）、知乎搜索/评论/热榜采集（用 zhihu-crawl）。需绑定 zhihu 账号。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "知乎·创作数据"
    emoji: "📊"
    requires:
      zhihu: "知乎账号"
      bins: [node]
---

# 知乎创作数据查询与分析

拉**自己账号**的内容表现数据，输出可执行的结论。本技能与 `zhihu-analytics`（Python 版）
接口完全一致，差异只在语言（Node）与产物路径（技能目录下 `artifacts/`）。

> **重要:** 只读，零写操作 —— 不发布、不点赞、不删改任何内容。

## 何时使用

- 用户说「我知乎文章数据怎么样」「哪篇阅读高」→ `overview`
- 用户说「我知乎发了哪些内容」→ `list`
- 用户说「这篇知乎文章的具体数据」→ `article` + `--content-id`
- 用户说「这篇发布后每天多少阅读」→ `trend` + `--content-id`
- 用户说「帮我分析知乎涨粉」「哪篇引流好」→ `overview`（含涨粉率）

## 前置条件 / Preconditions

| # | 条件 | 不满足时的现象 | 处置 |
|---|------|---------------|------|
| 1 | 「账号连接」已绑定 **zhihu** 账号 | `failure_kind=not_bound` | 引导到「账号连接」页面绑定知乎账号 |
| 2 | 该知乎账号登录态有效 | `failure_kind=token_expired` | 引导到「账号连接」对该知乎账号「重新登录」，**不要重试** |
| 3 | 本机已装 Node.js | 提示未找到 node | 安装 Node.js 或设 `DSAGENT_NODE_BIN` |
| 4 | 本机有 Chrome/Edge | `未找到 Chrome 或 Edge` | 安装浏览器 |
| 5 | 账号下至少有 1 篇内容 | 返回 `{ok:true, total:0, data:[]}` | 正常空结果 |

## 边界

- **只读，零写操作**
- **只查自己的数据** —— 没有竞品/全站内容数据
- **不做公开数据采集** —— 搜索/热榜/评论请用 `zhihu-crawl`
- **不发布内容** —— 发布请用 `zhihu-publish-http`
- 查询会弹出可见浏览器窗口（约 9 秒，用于建立 `x-zse-96` 签名环境）
- 登录态失效直接报错退出，不重试

## 执行流程

### 1. 选模式

| 模式 | 命令 | 用途 |
|------|------|------|
| 汇总排名（默认） | `python3 {baseDir}/scripts/run.py --mode overview --limit 20` | 全部指标 + 六条结论 |
| 创作列表 | `python3 {baseDir}/scripts/run.py --mode list --limit 50` | 标题/ID/时间 |
| 单篇汇总 | `python3 {baseDir}/scripts/run.py --mode article --content-id <id> --days 30` | 近 N 天指标 + 画像 |
| 单篇日趋势 | `python3 {baseDir}/scripts/run.py --mode trend --content-id <id> --days 30` | 逐日衰减 |

### 2. 按需补参数

| 参数 | 说明 |
|------|------|
| `--mode` | overview(默认) / list / article / trend |
| `--content-id` | 内容 ID（article / trend 必填，从 list 的 `data[].id` 取）|
| `--type` | article(默认) / answer / pin。**禁止 all**（返回 `error type`）|
| `--days` | 统计窗口，默认 30，上限 365 |
| `--limit` | 条数上限，默认 20，上限 50 |
| `--csv` | `true` 时同时导出 CSV 到技能目录 `artifacts/` |
| `--account` | 账号 shopKey；多账号时必须指定 |

### 3. 报告结果

- overview：排名表 + `report` 字段的六条口径结论 + `top` 头马篇
- article：该篇全字段指标 + `visitor_portrait` + `article` 元信息
- trend：逐日扁平数据（已把 `new_upvote`/`new_like` 归一成 `upvote`/`like`）

## 已对接接口（全部实测 200）

| 维度 | 端点 |
|------|------|
| 创作列表 | `GET /api/v4/creators/creations/v2/all?start=0&end=0&limit=N&offset=0&need_co_creation=1&sort_type=created` |
| 实时内容指标 | `GET /api/v4/creators/analysis/realtime/content/list?type=article&offset=0&limit=N` |
| 单篇汇总 | `GET /api/v4/creators/analysis/realtime/content/aggr?type=article&token={id}&start=&end=` |
| 单篇日趋势 | `GET /api/v4/creators/analysis/realtime/content/daily?type=article&token={id}&start=&end=` |
| 读者画像 | `GET /api/v4/creators/analysis/realtime/content/visitor_portrait?type=article&token={id}` |
| 草稿数 | `GET /api/v4/articles/my_drafts/count` |

> 全部需要 `x-zse-96` 签名，由页面 JS 自动生成 —— 所以必须在 `www.zhihu.com` 域下
> `page.goto` 并等 9 秒，然后在页面上下文内 fetch。

## 指标字段

| 字段 | 说明 |
|------|------|
| `pv` | 阅读量（核心）|
| `pageshow_uv` | 曝光 UV |
| `upvote` / `comment` | 赞同 / 评论 |
| `like` / `collect` | 喜欢 / 收藏 |
| `share` | 分享 |
| `new_follow_uv` | 带来的新关注 UV |
| `follower_conversion_rate` | 涨粉转化率 |
| `positive_interact_rate` | 正向互动率 |
| `avg_read_duration` | 平均阅读时长 |
| `content_mark` | `{is_normal, is_collapsed, is_suggest}` |

## 六条分析口径

不许只罗列数字，必须回答这六个问题：

1. **头马篇** —— `pv` 最高的一篇，占总阅读多少？是选题赢还是标题赢
2. **阅读/互动匹配度** —— 互动率 =（赞同+评论+收藏+分享）÷ 阅读。<1% 说明正文没接住流量
3. **涨粉效率** —— 新关注 UV ÷ 阅读。>1% 强，0.1%~1% 一般，<0.1% 缺关注理由
4. **折叠/限流** —— `content_mark.is_collapsed`，折叠直接压阅读
5. **时间衰减** —— `daily` 看第 1/3/7 天。第 1 天占比 >80% 说明只有首推没长尾
6. **下一步动作** —— 具体到「换标题结构 / 换发布时间 / 前 300 字加结论清单 / 复制某篇选题」，
   禁止写「继续优化内容质量」这类空话

## 错误处理

| 场景 | failure_kind | 引导动作 |
|------|-------------|---------|
| 未绑定知乎账号 | `not_bound` | 引导到「账号连接」页面绑定知乎账号 |
| 平台有多个可用账号且未指定 | `need_account_choice` | **把候选列表给用户选**，把选定的 shopKey 填进 `--account` 重调；★ 绝不要自己挑一个 |
| 登录态失效 | `token_expired` | 引导到「账号连接」对该知乎账号「重新登录」 |
| `type` 传了 `all` | `api_error` | 改用 `article`/`answer`/`pin` |
| article/trend 缺 `--content-id` | `skill_error` | 先跑 `--mode list` 取 ID |
| 命中风控（403） | `risk_control` | 调 `dsagent_risk_verify(platform="zhihu")`，完成后重试 |
| 结果为空（非风控） | — | 返回 `{ok:true, data:[], total:0}`，提示账号下暂无内容 |

## 已知限制

- **`content/list` 无标题字段** —— 靠下标与 `creations/v2/all` 对齐；两份排序不一致时，
  单篇数据一律以 `--mode article --content-id` 为准
- **读者画像依赖 DMP 开通** —— 未开通时返 `status: updating`，该维度不可用（正常降级）
- **响应体截断上限 60000 字符** —— `daily` 拉满 365 天时建议改用 `--days 90` 分段
- **`/api/v4/me` 在 zhuanlan 域 404** —— 探登录态必须回 `www.zhihu.com`

## 环境变量

| 变量 | 用途 |
|------|------|
| `DSAGENT_PLUGIN_ROOT` | 插件根目录（默认按技能目录上推三级）|
| `DSAGENT_NODE_BIN` | node 可执行文件路径（一般无需设置）|
