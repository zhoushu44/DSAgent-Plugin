---
name: xiaohongshu-analytics
description: "小红书创作数据查询与分析：拉取自己账号下全部笔记的发布状态、时间与互动数据，输出指标汇总与可执行结论。触发：小红书数据、笔记数据、内容分析、小红书后台数据、阅读量、曝光、哪篇笔记好、笔记表现、小红书复盘、xiaohongshu analytics、我的笔记表现。排除：小红书内容发布（用 xhs-publish-re / xiaohongshu-publish）、关键词搜索采集（用 xiaohongshu-crawl）。需绑定 xhs 账号；只读、无平台副作用。"
metadata:
  builtin_skill_version: "3.0"
  dsagent:
    display_name: "小红书·数据分析"
    emoji: "📊"
    requires:
      xhs: "小红书账号"
      bins: [node]
---

# 小红书·数据分析（HTTP 主链路 + 页面兜底）

> **重要:** 只统计**当前登录账号自己**的笔记数据，不涉及他人内容或竞品。

## 两条通道

| 通道 | 实现 | 何时用 | 特点 |
|---|---|---|---|
| **① HTTP 主链路**（默认） | 纯 HTTP + 自算签名 | 默认 | 不开浏览器、秒级 |
| **② 页面兜底** | 真 Chrome 读「笔记管理」DOM | `fallback=page`，或主链路报 `sign_rejected` / `risk_control` / `api_error` / `parse_error` | 慢，但抗改版 |

## 何时使用

- 「分析一下我的小红书数据」→ `overview`
- 「我发了哪些笔记、都什么状态」→ `list`
- 「哪篇笔记表现好」→ `overview`（看互动数）
- 「把笔记数据导出来」→ `overview --csv`

## 边界

- **不做内容发布** —— 用 `xhs-publish-re` 或 `xiaohongshu-publish`
- **不做关键词搜索/评论采集** —— 用 `xiaohongshu-crawl`
- **只读** —— 不产生任何平台写操作
- 只统计当前登录账号自己的笔记

## 前置条件

| # | 条件 | 不满足时的现象 | 处置 |
|---|------|---------------|------|
| 1 | 「账号连接」已绑定 **xhs** 账号 | `failure_kind=not_bound` | 引导用户到「账号连接」绑定小红书 |
| 2 | xhs 账号登录态有效 | `failure_kind=token_expired` | 引导用户对该账号「重新登录」，**不要重试原请求** |
| 3 | 本机有 Node（兜底还需 Chrome/Edge） | `failure_kind=skill_error` | 安装后重试 |
| 4 | 账号下至少有 1 篇笔记 | 返回 `total: 0` | 正常空结果，提示暂无笔记 |

## 参数

| 参数 | 必需 | 说明 |
|------|:----:|------|
| `mode` | 否 | `overview`（默认）/ `list` / `detail` / `trend` |
| `note_id` | 视模式 | 笔记 ID，`detail` / `trend` 必填 |
| `limit` | 否 | 条数上限，默认 50 |
| `csv` | 否 | 同时导出 CSV 到 `artifacts/xhs-analytics/` |
| `fallback` | 否 | `auto`（默认）/ `http` / `page` |
| `account` | 否 | 账号 shopKey；多账号且未绑定时先问用户 |

## 模式

| mode | 用途 | 状态 |
|------|------|------|
| `overview` | 笔记列表 + 指标汇总（默认） | ✅ |
| `list` | 仅笔记列表 | ✅ |
| `detail` | 单篇详情 | **预留**：降级为列表内定位，返回 `degraded: true` |
| `trend` | 单篇日趋势 | **预留**：需单篇数据接口 |

## 执行流程

### 1. 确认账号

多账号且会话未绑定时，先把候选给用户选，不要自己挑。

### 2. 调用脚本

```bash
node {baseDir}/scripts/fetch.mjs --mode overview --limit 50 [--csv]
node {baseDir}/scripts/fetch.mjs --mode list --limit 100
```

### 3. 解读结果

关注 `channel`（走的是哪条通道）与 `summary`：

```json
{
  "channel": "http",
  "total": "3",
  "summary": {
    "total": 3,
    "byStatus": { "审核中": 1, "已发布": 2 },
    "latest": "2026-10-21 01:56",
    "oldest": "2026-08-03 18:04",
    "interactions": [ { "title": "...", "date": "...", "vals": ["67","2","0","0","0"] } ]
  }
}
```

- `byStatus` 用来看发布成功率与审核情况
- `interactions` 的 `vals` 依次是 点赞 / 收藏 / 评论 / 分享（缺字段会省略）
- 若出现 `statusNote`，说明列表页不显示单条状态，状态由 tab 决定

### 4. 输出结论

基于 `summary` 给可执行结论：
- 审核中占比高 → 内容合规性需注意
- 某篇互动数明显高于其他 → 该选题/封面可复制
- 长时间未发 → 更新频率建议

## 错误处理

| 场景 | failure_kind | 自动兜底 | 引导动作 |
|------|-------------|:---:|---------|
| 未绑定小红书账号 | `not_bound` | ✗ | 引导到「账号连接」绑定 xhs 账号 |
| 多账号且未绑定具体账号 | `need_account_choice` | ✗ | 候选列表给用户选；★ 绝不要自己挑 |
| 登录态过期 | `token_expired` | ✗ | 引导重新登录，不要重试原请求 |
| 签名被拒 / 风控 | `sign_rejected` / `risk_control` | ✓ | 自动切页面兜底 |
| 接口返回 HTML / 改版 | `api_error` / `parse_error` | ✓ | 自动切页面读 DOM |
| Node/Chrome 缺失 | `skill_error` | — | 安装后重试 |
| 账号下无笔记 | 正常空结果 | — | 提示暂无笔记 |

## 相关技能

- 发布笔记：`xhs-publish-re` / `xiaohongshu-publish`
- 关键词采集：`xiaohongshu-crawl`
- 同平台参考：`xianyu-analytics` / `zhihu-analytics`
