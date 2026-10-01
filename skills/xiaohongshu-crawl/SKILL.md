---
name: xiaohongshu-crawl
description: "小红书数据采集：按关键词搜索笔记、采集笔记详情与评论、用户主页数据，导出 CSV / JSON。触发：小红书、xhs、笔记采集、小红书评论、小红书博主、小红书搜索。排除：小红书内容排版（用 smart-compose）、抖音/知乎数据采集。需绑定 xhs 账号。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "小红书·数据采集"
    emoji: "📕"
    requires:
      xhs: "小红书账号"
---

# 小红书数据采集

## 概述

本技能用于采集小红书平台的内容数据，包括：
- **搜索笔记**：按关键词搜索笔记列表
- **笔记详情**：获取指定笔记的详细信息（标题、正文、图片、互动数据）
- **评论采集**：采集笔记的评论数据
- **用户主页**：采集用户公开主页信息与笔记列表

## 前置条件

- 必须先在「账号连接」页面绑定小红书账号（xhs 平台）
- 登录态有效期较短（约 1-3 天），过期后需重新登录
- Cookie 中的 `web_session` 是判定登录成功的关键凭证

## 使用方法

直接说你想搜什么就行：
- `搜索小红书 手机壳`
- `小红书搜 穿搭`
- `采集小红书关键词 护肤`

技能会自动提取关键词，搜索笔记并返回结果。

## 采集能力

### 1. 关键词搜索

搜索小红书笔记：

> `cd "{this_skill_dir}" && python scripts/search_notes.py "关键词"`

- 接口：`https://edith.xiaohongshu.com/api/sns/web/v1/search/notes`
- 返回：笔记 ID、标题、描述、点赞数、用户信息
- 支持翻页（page 参数）

### 2. 笔记详情

获取指定笔记详情：

> `cd "{this_skill_dir}" && python scripts/note_detail.py "笔记ID"`

- 接口：`https://edith.xiaohongshu.com/api/sns/web/v1/feed`
- 返回：笔记正文、图片列表、标签、互动数据

### 3. 评论采集

采集笔记评论：

> `cd "{this_skill_dir}" && python scripts/note_comments.py "笔记ID"`

- 接口：`https://edith.xiaohongshu.com/api/sns/web/v1/comments`
- 返回：评论内容、用户、点赞数、二级评论

## 风控注意事项

- 小红书风控等级最高（L3），请求间隔必须 ≥ 3 秒
- 频繁请求会迅速触发风控，导致 Cookie 失效
- 建议使用小号登录
- 采集内容仅供数据分析，不得用于商业用途

## 环境变量

技能执行时，以下环境变量由 DSAgent 插件自动注入：

| 变量 | 说明 |
|------|------|
| `DSAGENT_COOKIE` | 小红书登录 Cookie 字符串 |
| `DSAGENT_PLATFORM` | 平台 ID（xhs） |
| `DSAGENT_ACCOUNT_ID` | 账号 ID |
| `DSAGENT_WORKSPACE` | 工作目录 |
| `DSAGENT_SKILL_ROOT` | 技能根目录 |
| `DSCONNECT_URL` | 本地代理网关地址 |
| `DSCONNECT_TOKEN` | 网关令牌（占位） |
| `DSCONNECT_AGENT_ID` | 智能体 ID |

## 输出格式

采集完成后，通过 stdout 输出 `__DSAGENT_RESULT__` 行，JSON 格式：

```json
{
  "ok": true,
  "data": [
    {
      "note_id": "abc123",
      "title": "超好看的手机壳分享",
      "desc": "...",
      "user": "小红书用户",
      "liked_count": 1234
    }
  ],
  "total": 20,
  "keyword": "手机壳"
}
```
