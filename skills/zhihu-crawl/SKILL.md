---
name: zhihu-crawl
description: "知乎数据采集：按关键词搜索回答/文章/问题/用户，采集问题下回答列表、回答详情、评论（含二级）、用户主页与回答/文章列表、热榜，可导出 CSV。触发：知乎、zhihu、知乎回答/文章/热榜采集、知乎评论、知乎用户主页。排除：抖音/小红书/闲鱼数据采集（用对应平台技能）。需绑定 zhihu 账号。"
metadata:
  builtin_skill_version: "1.1"
  dsagent:
    display_name: "知乎·数据采集"
    emoji: "🔌"
    requires:
      zhihu: "知乎账号"
      bins: [python3]
---

# 知乎数据采集

> **重要:** 采集结果仅供数据分析参考，不得用于商业用途。请求间隔 ≥ 2 秒（网关另有账号级节流），避免触发风控。

## 何时使用

- 用户说"搜一下知乎上的 xxx"、"知乎搜索 xxx" → 关键词搜索
- 用户说"这个问题下有哪些回答"、"看看知乎问题 xxx" → 问题回答列表
- 用户说"这条回答的内容"、"分析这条知乎回答" → 回答详情
- 用户说"这条回答的评论"、"采集知乎评论" → 评论采集
- 用户说"知乎用户 xxx 的主页"、"xxx 有多少粉丝" → 用户主页
- 用户说"xxx 在知乎写过什么"、"这个博主的回答/文章" → 用户回答列表 / 文章列表
- 用户说"知乎热榜"、"知乎今天有什么热点" → 热榜
- 用户说"我的知乎账号数据"、"我知乎有多少粉丝" → 当前账号资料

## 边界

- **不采集问题详情**（`questions/{id}` 详情端点实测 HTTP 403 / `error.code=10003`）——问题标题改从 `questions/{id}/answers` 的 `item.question.title` 间接取得
- **不采集单篇文章详情**（`articles/{id}` 详情同样 403）——文章能力降级为「用户文章列表」
- 不做批量爬取（单页 ≤ 20 条，热榜 ≤ 50 条）
- 不发布内容、不点赞、不关注（只读采集）
- 知乎对 API 频率限制较严，命中风控时需用户去知乎完成安全验证后重试
- 如 Cookie 失效（`z_c0` 过期）需重新登录

## 执行流程

### 1. 数据采集

运行采集脚本：

```bash
python3 {baseDir}/scripts/fetch_data.py --mode search --keyword "关键词" [--count 20] [--offset 0] [--csv]
```

按场景选择 `--mode`：

| mode | 用途 | 关键参数 |
|------|------|----------|
| `search` | 关键词搜索回答/文章/问题/用户 | `--keyword` `--search-type` `--offset` `--count` |
| `answers` | 指定问题下的回答列表 | `--question-id` `--sort-by` `--offset` `--count` |
| `answer` | 单条回答详情（含正文） | `--answer-id` |
| `comments` | 回答的一级评论（可含二级） | `--answer-id` `--order` `--with-child` `--offset` `--count` |
| `member` | 用户主页信息 | `--url-token` 或 `--keyword`（昵称） |
| `member-answers` | 用户的回答列表 | `--url-token` 或 `--keyword` `--offset` `--count` |
| `member-articles` | 用户的文章列表 | `--url-token` 或 `--keyword` `--offset` `--count` |
| `hot` | 知乎热榜 | `--count`（最大 50） |
| `profile` | 当前登录账号资料 | — |

不传 `--mode` 时自动判定：有 `--answer-id` → `comments`；有 `--question-id` → `answers`；有 `--keyword`（或能从 `DSAGENT_REQUEST` 提取出关键词）→ `search`；否则 → `hot`。

> `member` 系模式可只给昵称（`--keyword`），脚本会先调 `search_v3?t=people` 解析出 `url_token`；已知道 `url_token` 时直接传 `--url-token` 可省一次请求。
> `--search-type` 取值：`general`（综合，默认）/ `question`（只搜问题）/ `content`（实测常返回 0 条）。
> `--sort-by` 取值：`default` / `hot`；`--order` 取值：`normal` / `score`。

脚本自动完成：
- 从 `DSCONNECT_URL` 读取本地代理网关地址
- 通过网关代理发请求（网关自动注入 Cookie，技能不接触 Cookie）
- 按 mode 调用对应知乎接口并归一化字段（去 HTML 标签、时间戳转北京时间）
- 输出 `__DSAGENT_RESULT__` JSON；加 `--csv` 时另导出 CSV 到 `workspace/artifacts/`

### 2. 结果说明

搜索（`search`）数据项：

| 字段 | 说明 |
|------|------|
| `type` | 条目类型（`answer` / `article` / `question` / `people` / `topic`） |
| `id` | 对象 ID |
| `title` | 标题（回答取所属问题标题） |
| `excerpt` | 摘要 |
| `voteup_count` | 赞同数 |
| `comment_count` | 评论数 |
| `author_name` / `author_token` | 作者昵称 / url_token |
| `question_id` | 所属问题 ID |
| `created_time` | 创建时间（北京时间） |
| `url` | 网页链接 |

回答（`answers` / `answer` / `member-answers`）数据项：`id` / `question_id` / `question_title` / `author_name` / `author_token` / `author_headline` / `voteup_count` / `comment_count` / `created_time` / `updated_time` / `excerpt` / `content` / `url`。
> `member-answers` 端点不返回 `voteup_count`，脚本回退取 `reaction.statistics.like_count`；`answers` / `answer` 通过 `include` 拿到正文 `content`。

文章（`member-articles`）数据项：`id` / `title` / `author_name` / `author_token` / `voteup_count` / `comment_count` / `created_time` / `excerpt` / `content` / `url`。

评论（`comments`）数据项：`level`（1 一级 / 2 二级）/ `id` / `content` / `vote_count` / `author_name` / `author_token` / `is_author` / `reply_to` / `child_count` / `created_time`。
> 顶层另返回 `common_counts`（该回答评论总数）。子评论内联字段实测为空，脚本在 `--with-child` 时逐条调 `comments/{id}/child_comments` 补齐。

用户（`member` / `profile`）数据项：`id` / `url_token` / `name` / `headline` / `description` / `answer_count` / `articles_count` / `follower_count` / `following_count` / `voteup_count` / `url`。

热榜（`hot`）数据项：`rank` / `title` / `heat_text`（如"513 万热度"）/ `heat_value` / `question_id` / `answer_count` / `follower_count` / `excerpt` / `url`。

> `search` / `answers` / `comments` / `member-answers` / `member-articles` 支持翻页：把响应里的 `next_offset` 传给下一轮的 `--offset`，`has_more` 为 `false` 时停止。

## 环境变量

技能执行时，以下环境变量由 DSAgent 插件自动注入：

| 变量 | 说明 |
|------|------|
| `DSCONNECT_URL` | 本地代理网关地址（脚本通过网关代理发请求，Cookie 不出网关） |
| `DSCONNECT_TOKEN` | 网关认证令牌（占位值，本地网关不验签） |
| `DSCONNECT_AGENT_ID` | 智能体 ID（本地网关用 platform 匹配账号） |
| `DSAGENT_REQUEST` | 用户原始请求文本（未传 `--keyword` 时用于提取关键词） |
| `DSAGENT_WORKSPACE` | 工作目录（`--csv` 时 CSV 落到其 `artifacts/` 下） |
| `DSAGENT_SKILL_ROOT` | 技能根目录 |

## 输出格式

采集完成后，通过 stdout 输出 `__DSAGENT_RESULT__` 行，JSON 格式：

```json
{
  "ok": true,
  "mode": "search",
  "keyword": "手机壳",
  "total": 20,
  "offset": 0,
  "next_offset": 20,
  "has_more": true,
  "data": [
    {
      "type": "answer",
      "id": "2062335143101064594",
      "title": "有哪些颜值高的手机壳？",
      "excerpt": "……",
      "voteup_count": 128,
      "comment_count": 12,
      "author_name": "某某",
      "author_token": "xxxx",
      "question_id": "12345678",
      "created_time": "2026-08-01 12:30:00",
      "url": "https://www.zhihu.com/answer/2062335143101064594"
    }
  ],
  "csv_path": "E:/.../artifacts/zhihu_search_20260922_101530.csv",
  "fetch_time": "2026-09-22 10:15:30"
}
```

> `csv_path` 仅在传 `--csv` 时出现；同时通过 stderr 的 `---[OUTPUT_FILES]` 行上报，插件会回填到模型文本。

## 错误处理

| 错误场景 | failure_kind | 处理方式 |
|---------|-------------|---------|
| DSCONNECT_URL 未设置 | `not_bound` | 引导用户到「账号连接」页面绑定知乎账号 |
| 拿不到当前账号资料（`/api/v4/me` 无 url_token） | `token_expired` | 提示知乎登录态可能失效，需重新登录 |
| 命中风控（403 / 文案含未登录） | `risk_control` | 提示用户去知乎完成安全验证后重试，勿当作 0 条结果 |
| 接口返回 `error.code=4041` | `api_error` | 资源不存在（问题/回答/用户不存在），展示 message |
| 接口返回其他 `error` 信封 | `api_error` | 展示 `error.message` |
| 响应解析失败 | `parse_error` | 展示原始返回 |
| 结果为空（非风控） | — | 返回 `{ ok: true, data: [], total: 0 }` |
