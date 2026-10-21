---
name: zhihu-analytics
description: "知乎创作数据采集与分析：拉取自己账号下全部创作（文章/回答/想法）的阅读、赞同、评论、收藏、分享、涨粉UV、涨粉率、平均阅读时长、折叠状态，以及单篇的汇总与日趋势，输出可直接执行的结论。触发：知乎数据、创作数据、文章数据、内容分析、知乎后台数据、阅读量、赞同数、涨粉、创作者中心、zhihu analytics、我的文章表现、哪篇文章好。排除：知乎内容发布（用 zhihu-publish）、知乎搜索/评论/热榜采集（用 zhihu-crawl）。需绑定 zhihu 账号。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "知乎·创作数据分析"
    emoji: "📊"
    requires:
      zhihu: "知乎账号"
      bins: [python3]
---

# 知乎创作数据分析

> **重要:** 只采集**当前登录账号自己**的内容数据，不涉及他人内容或竞品。
> 请求间隔 ≥ 2 秒（网关另有账号级节流），避免触发风控。
> 本技能走 **RE HTTP 链路**：起本地 Chrome（CDP + 已登录 zhihu profile），在页面上下文内
> `fetch` 真实接口，让浏览器自动带上 Cookie 与 `x-zse-96` 签名 —— 技能不接触 Cookie。

## 前置条件 / Preconditions

调用前必须全部满足，缺一项就会失败：

| # | 条件 | 不满足时的现象 | 处置 |
|---|------|---------------|------|
| 1 | 「账号连接」已绑定 **zhihu** 账号 | `failure_kind=not_bound` | 引导用户到「账号连接」页面绑定知乎账号 |
| 2 | 该 zhihu 账号登录态有效 | `failure_kind=token_expired` | 引导用户到「账号连接」对该知乎账号「重新登录」，**不要重试原请求** |
| 3 | 本机已装 Chrome | `failure_kind=skill_error`，提示 Chrome 不存在 | 安装 Chrome，或用 `ZHIHU_CHROME_PATH` 指向其他 Chrome/Chromium |
| 4 | 存在已登录的 zhihu browser profile | `failure_kind=skill_error`，提示 profile 不存在 | 先用 `dsagent_browser_login` 登录一次知乎生成 profile，或改 `ZHIHU_PROFILE_DIR` |
| 5 | Python 环境有 `playwright` | `failure_kind=skill_error`，提示缺少 playwright | `pip install playwright` |
| 6 | CDP 端口未被占用（默认 9471） | 脚本会先杀占用该端口的 Chrome 再重起 | 正常无需处理；被其他程序强占时改 `ZHIHU_CDP_PORT` |
| 7 | 账号下至少有 1 篇内容 | 返回 `{ok:true, data:[], total:0}` | 正常空结果，提示账号下暂无内容 |

环境变量覆盖（均有默认值，一般不用设）：

| 变量 | 默认值 |
|------|--------|
| `ZHIHU_CHROME_PATH` | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| `ZHIHU_PROFILE_DIR` | `C:\Users\Administrator\.dsh\browser-profiles\accounts\zhihu_b6e693fd522a184552486607f38126dd` |
| `ZHIHU_CDP_PORT` | `9471` |

> 前置条件 2 是最高频失败原因。知乎 `z_c0` 过期后所有接口都会失败，且重试无用，必须重新登录。

## 何时使用

- 用户说「我知乎文章数据怎么样」「哪篇阅读高」→ `overview`
- 用户说「我知乎发了哪些内容」→ `list`
- 用户说「这篇知乎文章的具体数据」→ `article` + `--content-id`
- 用户说「这篇发布后每天多少阅读」→ `trend` + `--content-id`
- 用户说「帮我分析知乎涨粉」「哪篇引流好」→ `overview`（含涨粉率字段）

## 边界

- **只读**，不发布、不点赞、不删改任何内容
- **只覆盖自己的内容**，没有全站/竞品内容数据
- 读者画像依赖知乎 DMP 开通，未开通时该维度降级（返回 `status: updating`），属正常
- 不做批量历史回溯：单次窗口默认 30 天，`--days` 上限 365
- 内容条数单次上限 50（`--limit`）

## 执行流程

### 1. 运行脚本

```bash
python3 {baseDir}/scripts/fetch_data.py --mode overview --days 30 --limit 20 [--csv]
```

| mode | 用途 | 关键参数 |
|------|------|----------|
| `overview` | 创作列表 + 实时指标合并排名（默认） | `--limit` `--csv` |
| `list` | 仅创作列表（标题/ID/时间） | `--limit` |
| `article` | 单篇近 N 天汇总 | `--content-id` `--days` |
| `trend` | 单篇逐日趋势 | `--content-id` `--days` |

`--type` 取值 `article`（专栏文章，默认）/ `answer`（回答）/ `pin`（想法）。
**禁止 `all`** —— 实测返回 `{"msg":"error type","code":"10002"}`。

### 2. 已对接接口（全部实测 200）

| 维度 | 端点 |
|------|------|
| 创作列表 | `GET /api/v4/creators/creations/v2/all?start=0&end=0&limit=N&offset=0&need_co_creation=1&sort_type=created` |
| 实时内容指标 | `GET /api/v4/creators/analysis/realtime/content/list?type=article&offset=0&limit=N` |
| 单篇汇总 | `GET /api/v4/creators/analysis/realtime/content/aggr?type=article&token={ID}&start=&end=` |
| 单篇日趋势 | `GET /api/v4/creators/analysis/realtime/content/daily?type=article&token={ID}&start=&end=` |
| 读者画像 | `GET /api/v4/creators/analysis/realtime/content/visitor_portrait?type=article&token={ID}` |

> `content/list` 返回的 `data[]` **不带标题**，脚本按**下标**与 `creations/v2/all` 对齐。
> 若两份列表排序不一致（知乎偶发展示排序变化），单篇数据一律以 `--mode article --content-id` 为准。

### 3. 指标字段说明

| 字段 | 说明 |
|------|------|
| `pv` | 阅读量（核心） |
| `pageshow_uv` | 曝光 UV |
| `upvote` | 赞同 |
| `comment` | 评论 |
| `like` / `collect` | 喜欢 / 收藏 |
| `share` | 分享 |
| `new_follow_uv` | 带来的新关注 UV |
| `follower_conversion_rate` | 涨粉转化率 |
| `positive_interact_rate` | 正向互动率 |
| `avg_read_duration` | 平均阅读时长（秒） |
| `rec_click_rate` | 推荐点击率 |
| `content_mark` | `{is_normal, is_collapsed, is_suggest}` 折叠/推荐状态 |
| `yesterday` | 昨日同期快照（嵌套同结构） |

### 4. 分析口径（报告必须回答的六条）

拿到数据后按这六条出结论，**不许只罗列数字**：

1. **头马篇**：`pv` 最高的一篇，占总阅读多少？它是选题赢还是标题赢？
2. **阅读/互动匹配度**：互动率 =（赞同+评论+收藏+分享）÷ 阅读。
   <1% 说明正文没接住流量，问题在正文结构不在选题。
3. **涨粉效率**：新关注 UV ÷ 阅读。>1% 强，0.1%~1% 一般，<0.1% 缺「关注理由」。
4. **折叠/限流**：查 `content_mark.is_collapsed`，折叠会直接压掉阅读。
5. **时间衰减**：用 `daily` 看发布后第 1/3/7 天阅读。第 1 天占比 >80% 说明只有首推没有长尾。
6. **下一步动作**：具体到「换标题结构 / 换发布时间 / 前 300 字加结论清单 / 复制某篇选题角度」，
   禁止写「继续优化内容质量」这类空话。

## 环境变量

技能执行时由 DSAgent 插件自动注入：

| 变量 | 说明 |
|------|------|
| `DSCONNECT_URL` | 本地代理网关地址（用于校验 zhihu 账号绑定态） |
| `DSCONNECT_TOKEN` | 网关认证令牌 |
| `DSAGENT_REQUEST` | 用户原始请求文本 |
| `DSAGENT_WORKSPACE` | 工作目录（CSV/报告落到其 `artifacts/` 下） |
| `DSAGENT_SKILL_ROOT` | 技能根目录 |

浏览器相关（脚本内置默认值，可用环境变量覆盖）：

| 变量 | 默认值 |
|------|--------|
| `ZHIHU_CHROME_PATH` | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| `ZHIHU_PROFILE_DIR` | `C:\Users\Administrator\.dsh\browser-profiles\accounts\zhihu_b6e693fd522a184552486607f38126dd` |
| `ZHIHU_CDP_PORT` | `9471` |

## 输出格式

stdout 输出 `__DSAGENT_RESULT__` 行：

```json
{
  "ok": true,
  "mode": "overview",
  "total": 6,
  "days": 30,
  "data": [
    {
      "id": "2096024293196953340",
      "type": "article",
      "title": "2026 童装选品实录",
      "created": "2026-10-20",
      "pv": 2, "upvote": 0, "comment": 0, "like": 0, "collect": 0, "share": 0,
      "follow_uv": 0, "fcr": 0.0, "interact_rate": 0.0,
      "is_collapsed": false
    }
  ],
  "top": {"id": "...", "title": "...", "pv": 2},
  "csv_path": "E:/.../artifacts/zhihu_analytics_20261021_001500.csv",
  "fetch_time": "2026-10-21 00:15:00"
}
```

`article` / `trend` 模式的 `data` 为该篇的汇总对象或逐日数组，另带 `content_id` 字段。

## 错误处理

| 错误场景 | failure_kind | 处理方式 |
|---------|-------------|---------|
| 未绑定 zhihu 账号 / 网关不可达 | `not_bound` | 引导用户到「账号连接」页面绑定知乎账号 |
| `/api/v4/me` 非 200 | `token_expired` | 知乎登录态失效，引导对该 zhihu 账号「重新登录」，**不要重试原请求** |
| 命中风控（403） | `risk_control` | 调 `dsagent_risk_verify(platform="zhihu")` 拉验证页，用户完成后重试 |
| 接口返回 `{"msg":"error type","code":"10002"}` | `skill_error` | `--type` 传了非法值，改用 `article`/`answer`/`pin` |
| `article`/`trend` 模式缺 `--content-id` | `skill_error` | 先用 `--mode list` 取 ID |
| 接口 404 | `api_error` | 端点变更，回报并停止 |
| Chrome/profile 不可用 | `skill_error` | 检查 `ZHIHU_CHROME_PATH` 与 `ZHIHU_PROFILE_DIR` |
| 结果为空（非风控） | — | 返回 `{ok:true, data:[], total:0}`，提示账号下暂无内容 |

## 已知限制

- `visitor_portrait` 未开通 DMP 时返回 `status: updating`，画像维度不可用（正常降级）
- `content/list` 无标题字段，靠下标对齐；篇数多时以单篇 `aggr` 为准
- 单次 `page.evaluate` 只发一个 URL —— 长循环会让 evaluate 挂死不返回（实测踩过）
- 响应体截断上限 60000 字符，`daily` 拉满 365 天时建议改用 `--days 90` 分段
- 本技能不发布内容，发文章用 `zhihu-publish`
