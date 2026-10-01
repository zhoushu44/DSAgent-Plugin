---
name: douyin-crawl
description: "抖音数据采集：采集账号作品列表、视频详情、关键词搜索、用户搜索、热搜榜、喜欢列表、账号资料、话题详情与话题作品、相关推荐。触发：抖音、douyin、抖音数据采集、抓抖音数据、抖音视频/账号/热搜、抖音评论、抖音话题。排除：小红书/知乎/闲鱼数据采集（用对应平台技能）、抖音内容发布。需绑定 douyin 账号。"
metadata:
  builtin_skill_version: "1.1"
  dsagent:
    display_name: "抖音·数据采集"
    emoji: "🔌"
    requires:
      bins: [python3]
---

# 抖音数据采集

> **重要:** 采集结果仅供数据分析参考，不得用于商业用途。请求间隔 ≥ 6 秒，避免触发风控。

## 何时使用

- 用户说"采集我的抖音作品"、"看看我抖音发了什么" → 作品列表
- 用户说"这个抖音视频的数据"、"分析抖音视频 xxx" → 视频详情
- 用户说"搜一下抖音上的 xxx"、"抖音搜索 xxx" → 关键词搜索
- 用户说"抖音上有哪些做 xxx 的博主" → 用户搜索
- 用户说"抖音热搜"、"抖音热点榜" → 热搜榜
- 用户说"我抖音喜欢过的视频" → 喜欢列表
- 用户说"我的抖音账号数据"、"抖音粉丝数" → 账号资料
- 用户说"#xxx 这个话题怎么样"、"抖音话题 xxx 的数据"、"话题下的爆款" → 话题详情 + 话题作品
- 用户说"有哪些话题在火"、"搜一下话题 xxx" → 话题搜索
- 用户说"跟这个视频类似的还有哪些"、"这个爆款同类的" → 相关推荐

## 边界

- 不采集评论（抖音评论接口需 `a_bogus` 签名，当前链路不可用）
- 不采集合集作品、关注/粉丝列表（前者需签名，后两者抖音已下线该接口）
- 不做批量爬取（单次 ≤ 50 条）
- 不发布内容、不点赞、不关注（只读采集）
- 搜索类接口风控较严，可能返回 `verify_check`，需用户去抖音完成安全验证后重试
- 如 Cookie 失效需重新登录

## 执行流程

### 1. 数据采集

运行采集脚本：

```bash
python3 {baseDir}/scripts/fetch_data.py --mode user [--count 18] [--max-cursor 0]
```

按场景选择 `--mode`：

| mode | 用途 | 关键参数 |
|------|------|----------|
| `user` | 当前登录账号的作品列表（默认） | `--count` `--max-cursor` |
| `detail` | 单条视频详情 | `--aweme-id` |
| `search` | 关键词综合搜索 | `--keyword` `--offset` `--count` |
| `user-search` | 按关键词搜用户 | `--keyword` `--offset` `--count` |
| `hot` | 抖音热搜榜 | — |
| `favorite` | 当前账号的喜欢列表 | `--count` `--max-cursor` |
| `profile` | 当前登录账号资料 | — |
| `topic` | 话题详情 + 话题下的作品列表 | `--keyword`（话题名）或 `--ch-id` `--count` `--cursor` |
| `topic-search` | 按关键词搜话题 | `--keyword` `--count` |
| `related` | 某条视频的相关推荐（同题材爆款） | `--aweme-id` `--count` |

不传 `--mode` 时自动判定：有 `--aweme-id` → `detail`；有 `--keyword`（或能从 `DSAGENT_REQUEST` 提取出关键词）→ `search`；请求含「热榜 / 热搜 / 热门榜」→ `hot`；请求含「我的 / 自己 / 本人」→ `user`（本人作品）；否则 → `user`。

> `topic` 模式可只给话题名（`--keyword`），脚本会先调 `challenge/search` 解析出 `ch_id` 再取详情与作品；已知道 `ch_id` 时直接传 `--ch-id` 可省一次请求。

脚本自动完成：
- 从 `DSCONNECT_URL` 读取本地代理网关地址
- 通过网关代理 `POST /api/v1/proxy` 发请求（网关自动注入 Cookie，技能不接触 Cookie）
- **前置解析真实身份**：调 `user/profile/self/` 拿真实 `sec_uid` / `uid`（凭证库 `account_id` 是派生哈希值，**不能**当 `sec_user_id` 用，否则接口返回 `status_code=5`）
- 按 mode 调用对应抖音 Web 接口并归一化字段
- 输出 `__DSAGENT_RESULT__` JSON

### 2. 结果说明

作品/详情/搜索/喜欢列表/话题作品/相关推荐的数据项字段一致：

| 字段 | 说明 |
|------|------|
| `aweme_id` | 视频 ID |
| `desc` | 视频文案 |
| `create_time` | 发布时间（北京时间 `YYYY-MM-DD HH:MM:SS`） |
| `duration_ms` | 时长（毫秒） |
| `author_nick` | 作者昵称 |
| `author_uid` | 作者 uid |
| `author_sec_uid` | 作者 sec_uid |
| `digg_count` | 点赞数 |
| `comment_count` | 评论数 |
| `share_count` | 分享数 |
| `collect_count` | 收藏数 |
| `play_count` | 播放数 |
| `video_url` | 无水印播放地址（`video.play_addr`） |
| `cover_url` | 封面图地址 |
| `share_url` | 视频分享链接 |

`detail` 额外返回 `music_title`（原声标题）与 `text_extra`（话题标签列表）。

热搜榜数据项：`rank` / `word` / `hot_value` / `sentence_id`。
用户搜索结果项：`nickname` / `uid` / `sec_uid` / `signature` / `follower_count` / `aweme_count`。

话题数据项（`topic` / `topic-search`）：`ch_id` / `cha_name` / `desc` / `view_count`（累计播放）/ `user_count`（参与人数）/ `create_time` / `share_url`。
`topic` 模式额外在顶层返回 `challenge` 字段（该话题的详情）。

> `user` / `favorite` / `topic` 支持翻页：响应里的 `max_cursor` 传给下一轮的 `--max-cursor`（`topic` 用 `--cursor`），`has_more` 为 `false` 时停止。
> `related` 不支持翻页（平台一次性返回相关推荐集合）。

## 环境变量

技能执行时，以下环境变量由 DSAgent 插件自动注入：

| 变量 | 说明 |
|------|------|
| `DSCONNECT_URL` | 本地代理网关地址（脚本通过网关代理发请求，Cookie 不出网关） |
| `DSCONNECT_TOKEN` | 网关认证令牌（占位值，本地网关不验签） |
| `DSCONNECT_AGENT_ID` | 智能体 ID（本地网关用 platform 匹配账号） |
| `DSAGENT_REQUEST` | 用户原始请求文本（未传 `--keyword` 时用于提取关键词） |
| `DSAGENT_WORKSPACE` | 工作目录 |
| `DSAGENT_SKILL_ROOT` | 技能根目录 |

## 输出格式

采集完成后，通过 stdout 输出 `__DSAGENT_RESULT__` 行，JSON 格式：

```json
{
  "ok": true,
  "mode": "user",
  "account": { "nickname": "抖音用户", "uid": "84915906365", "sec_uid": "MS4wLjABAAAA..." },
  "total": 8,
  "has_more": false,
  "max_cursor": 1589122806000,
  "data": [
    {
      "aweme_id": "7319745453610913076",
      "desc": "1月3日(1)",
      "create_time": "2024-01-03 14:31:05",
      "digg_count": 5,
      "comment_count": 1,
      "share_count": 0,
      "collect_count": 2,
      "play_count": 903,
      "author_nick": "抖音用户",
      "video_url": "https://...",
      "cover_url": "https://..."
    }
  ]
}
```

## 错误处理

| 错误场景 | failure_kind | 处理方式 |
|---------|-------------|---------|
| DSCONNECT_URL 未设置 | `not_bound` | 引导用户到「账号连接」页面绑定抖音账号 |
| 拿不到账号真实身份（sec_uid 为空） | `token_expired` | 提示抖音登录态可能失效，需重新登录 |
| 搜索返回 `search_nil_type=verify_check` | `risk_control` | 提示用户去抖音完成安全验证后重试，勿当作 0 条结果 |
| 接口返回非 0 `status_code` | `api_error` | 展示 `status_msg`（如 `status_code=5` 表示参数不合法） |
| 响应解析失败 | `parse_error` | 展示原始返回 |
| 结果为空（非风控） | — | 返回 `{ ok: true, data: [], total: 0 }` |
