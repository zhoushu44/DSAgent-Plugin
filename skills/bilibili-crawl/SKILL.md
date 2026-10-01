---
name: bilibili-crawl
description: "B站数据采集：采集视频详情、UP 主投稿列表、账号资料、关键词搜索、用户搜索、排行榜、热门视频、相关推荐与评论。触发：B站、哔哩哔哩、bilibili、小破站、B站数据采集、抓B站数据、B站视频/UP主/排行榜、B站评论、B站搜索。排除：抖音/小红书/知乎/闲鱼数据采集（用对应平台技能）、B站内容发布与下载。需绑定 bilibili 账号。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "B站·数据采集"
    emoji: "🔌"
    requires:
      bins: [python3]
---

# B站数据采集

> **重要:** 采集结果仅供数据分析参考，不得用于商业用途。请求间隔 ≥ 6 秒，避免触发风控。

## 何时使用

- 用户说"这个 B站 视频的数据"、"分析这个 BV 号" → 视频详情
- 用户说"采集 UP 主 xxx 的投稿"、"看看这个 UP 主发了什么" → UP 主投稿列表
- 用户说"我的 B站 账号数据"、"我的 B站 投稿"、"B站 粉丝数" → 账号资料 / 本人投稿
- 用户说"搜一下 B站 上的 xxx"、"B站 搜索 xxx" → 关键词搜索
- 用户说"B站 上有哪些做 xxx 的 UP 主" → 用户搜索
- 用户说"B站 排行榜"、"B站 全站排行" → 排行榜
- 用户说"B站 热门视频"、"B站 现在什么火" → 热门视频
- 用户说"跟这个视频类似的还有哪些" → 相关推荐
- 用户说"这个视频的评论"、"B站 评论采集" → 评论

## 边界

- 不下载视频/音频文件（大文件不走代理网关，需专用下载链路）
- 不采集弹幕（接口返回 deflate 压缩的二进制 XML，当前链路不支持二进制）
- 不做批量爬取（单次 ≤ 50 条）
- 不发布内容、不点赞、不投币、不收藏（只读采集）
- 搜索与空间类接口风控较严，可能返回 `-412` / `-352`，需用户完成安全验证后重试
- 如 Cookie 失效需重新登录

## 执行流程

### 1. 数据采集

运行采集脚本：

```bash
python3 {baseDir}/scripts/fetch_data.py --mode video [--bvid BV1uv411q7Mv]
```

按场景选择 `--mode`：

| mode | 用途 | 关键参数 |
|------|------|----------|
| `video` | 单条视频详情 | `--bvid` 或 `--aid` |
| `user` | 当前登录账号的投稿列表（默认） | `--count` `--page` |
| `up` | 指定 UP 主的投稿列表 | `--mid` `--count` `--page` |
| `profile` | 当前登录账号资料 | — |
| `search` | 关键词搜索视频 | `--keyword` `--page` `--count` |
| `user-search` | 按关键词搜 UP 主 | `--keyword` `--page` |
| `ranking` | 全站排行榜 | `--count` |
| `hot` | 热门视频 | `--count` `--page` |
| `related` | 某条视频的相关推荐 | `--bvid` 或 `--aid` `--count` |
| `comment` | 视频评论 | `--bvid` 或 `--aid` `--page` `--count` |

不传 `--mode` 时自动判定：有 `--bvid` / `--aid` → `video`；有 `--mid` → `up`；有 `--keyword`（或能从 `DSAGENT_REQUEST` 提取出关键词）→ `search`；请求含「排行 / 榜单」→ `ranking`；请求含「热门 / 什么火」→ `hot`；请求含「评论」→ `comment`；请求含「我的 / 自己 / 本人」→ `user`；否则 → `user`。

脚本自动完成：
- 从 `DSCONNECT_URL` 读取本地代理网关地址
- 通过网关代理 `POST /api/v1/proxy` 发请求（网关自动注入 Cookie，技能不接触 Cookie）
- **自实现 WBI 签名**：调 `x/web-interface/nav` 取实时 `img_key` / `sub_key`，重排得 `mixin_key`，对参数排序编码后算 MD5 得 `w_rid`
- 按 mode 调用对应 B站 Web 接口并归一化字段
- 输出 `__DSAGENT_RESULT__` JSON

> `related` 模式需要先拿 `aid`：脚本会用 `--bvid` 调一次 `view` 接口解析出 `aid` 再取相关推荐。

### 2. 结果说明

视频类数据项（`video` / `user` / `up` / `search` / `ranking` / `hot` / `related`）字段一致：

| 字段 | 说明 |
|------|------|
| `bvid` | 视频 BV 号 |
| `aid` | 视频 av 号 |
| `title` | 标题 |
| `desc` | 简介 |
| `create_time` | 发布时间（北京时间 `YYYY-MM-DD HH:MM:SS`） |
| `duration_sec` | 时长（秒） |
| `author_name` | UP 主昵称 |
| `author_mid` | UP 主 mid |
| `play_count` | 播放数 |
| `danmaku_count` | 弹幕数 |
| `comment_count` | 评论数 |
| `like_count` | 点赞数 |
| `coin_count` | 投币数 |
| `favorite_count` | 收藏数 |
| `share_count` | 分享数 |
| `cover_url` | 封面图地址 |
| `video_url` | 视频页面地址 |

`video` 额外返回 `cid`（弹幕/评论用）、`pages`（分 P 数）、`tname`（分区名）。

UP 主搜索结果项：`mid` / `uname` / `sign` / `fans` / `videos` / `level` / `avatar`。
评论数据项：`rpid` / `content` / `like_count` / `reply_count` / `create_time` / `author_name` / `author_mid` / `is_up`（是否 UP 主本人）。
排行榜数据项：`rank` / `bvid` / `title` / `score` / `author_name` / `play_count`。

> `user` / `up` / `search` / `comment` / `hot` 支持翻页：把当前页号 +1 传给下一轮的 `--page`，`has_more` 为 `false` 时停止。
> `ranking` / `related` 不支持翻页（平台一次性返回）。

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
  "mode": "search",
  "keyword": "token",
  "account": { "nickname": "周大dodo", "mid": 37463766 },
  "total": 20,
  "has_more": true,
  "page": 1,
  "data": [
    {
      "bvid": "BV1uv411q7Mv",
      "aid": 243922477,
      "title": "【硬核】十分钟看懂 token",
      "create_time": "2024-01-03 14:31:05",
      "duration_sec": 615,
      "author_name": "某某UP主",
      "author_mid": 946974,
      "play_count": 1234567,
      "danmaku_count": 8901,
      "like_count": 23456,
      "cover_url": "https://i0.hdslb.com/bfs/archive/xxx.jpg",
      "video_url": "https://www.bilibili.com/video/BV1uv411q7Mv"
    }
  ]
}
```

## 错误处理

| 错误场景 | failure_kind | 处理方式 |
|---------|-------------|---------|
| DSCONNECT_URL 未设置 | `not_bound` | 引导用户到「账号连接」页面绑定 B站 账号 |
| 账号资料返回 `code=-101`（账号未登录） | `token_expired` | 提示 B站 登录态已失效，需重新登录 |
| 接口返回 `code=-412`（request was banned） | `risk_control` | 提示用户去 B站 完成安全验证后重试，勿当作 0 条结果 |
| 接口返回 `code=-352`（风控校验失败） | `risk_control` | 同上，稍后重试或降低请求频率 |
| 接口返回其他非 0 `code` | `api_error` | 展示 `message`（如 `-404` 表示视频不存在） |
| 响应解析失败 | `parse_error` | 展示原始返回 |
| 结果为空（非风控） | — | 返回 `{ ok: true, data: [], total: 0 }` |
