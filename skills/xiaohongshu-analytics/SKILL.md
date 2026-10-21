---
name: xiaohongshu-analytics
description: "小红书创作数据查询与分析：拉取自己账号下全部笔记的发布状态、时间与互动数据，输出指标汇总与可执行结论。触发：小红书数据、笔记数据、内容分析、小红书后台数据、阅读量、曝光、哪篇笔记好、笔记表现、小红书复盘、xiaohongshu analytics、我的笔记表现。排除：小红书内容发布（用 xhs-publish-re / xiaohongshu-publish）、关键词搜索采集（用 xiaohongshu-crawl）。需绑定 xhs 账号；只读、无平台副作用。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "小红书·数据分析"
    emoji: "📊"
    requires:
      xhs: "小红书账号"
      bins: [python3]
---

# 小红书·数据分析

> **重要:** 只统计**当前登录账号自己**的笔记数据，不涉及他人内容或竞品。
> 本技能走 **RE HTTP 链路**：起本地 Chrome（CDP + 已登录 xhs profile），在页面上下文内
> `fetch` 创作平台接口，让浏览器自动带上 Cookie 与 `x-s` / `x-t` / `x-s-common` 签名
> —— 技能侧不接触 Cookie。

## 何时使用

- 「分析一下我的小红书数据」→ `overview`
- 「我发了哪些笔记、都什么状态」→ `list`
- 「哪篇笔记表现好」→ `overview`（看互动数）
- 「把笔记数据导出来」→ `overview --csv`

## 边界

- **不做内容发布** —— 发布笔记请用 `xhs-publish-re` 或 `xiaohongshu-publish`
- **不做关键词搜索/评论采集** —— 请用 `xiaohongshu-crawl`
- **只读** —— 不产生任何平台写操作
- 只统计当前登录账号自己的笔记

## 前置条件

| # | 条件 | 不满足时的现象 | 处置 |
|---|------|---------------|------|
| 1 | 「账号连接」已绑定 **xhs** 账号 | `failure_kind=not_bound` | 引导用户到「账号连接」绑定小红书 |
| 2 | xhs 账号登录态有效 | `failure_kind=token_expired` | 引导用户对该账号「重新登录」，**不要重试原请求** |
| 3 | 本机有 Node.js + Chrome | `failure_kind=skill_error` | 安装 Node 与 Chrome |
| 4 | sign_service 可启动 | `failure_kind=skill_error` | 脚本会自动拉起；失败看技能目录 `sign_service.log` || 5 | 账号下至少有 1 篇笔记 | 返回 `total: 0` | 正常空结果，提示账号下暂无笔记 |

环境变量覆盖：

| 变量 | 默认 |
|------|------|
| `XHS_PUPPETEER` | DSAgent-Plugin 内 puppeteer-core ESM 路径 |
| `XHS_CHROME` | `C:\Program Files\Google\Chrome\Application\chrome.exe` |

## 参数

| 参数 | 必需 | 说明 |
|------|:----:|------|
| `--mode` | 否 | `overview`（默认）/ `list` / `detail` / `trend` |
| `--note-id` | 视模式 | 笔记 ID，`detail` / `trend` 必填 |
| `--limit` | 否 | 条数上限，默认 50 |
| `--port` | 否 | sign_service 端口，默认 8787 |
| `--csv` | 否 | 同时导出 CSV 到 `artifacts/xhs-analytics/` |

## 模式

| mode | 用途 | 输出 |
|------|------|------|
| `overview` | 笔记列表 + 指标汇总（默认） | `total` / `tabs` / `summary`（按状态分布、最新最晚、互动数）/ `notes[]` |
| `list` | 仅笔记列表 | `notes[]`（标题/状态/日期/互动数） |
| `detail` | 单篇详情 | 预留，当前回退为列表内定位 |
| `trend` | 单篇日趋势 | 预留，需创作平台单篇数据接口 |

## 执行流程

### 1. 确认账号

多账号且会话未绑定时，先把候选给用户选，不要自己挑。

### 2. 调用脚本

```bash
# 汇总
python3 {baseDir}/scripts/fetch_data.py --mode overview --limit 50 [--csv]

# 仅列表
python3 {baseDir}/scripts/fetch_data.py --mode list --limit 100
```

### 3. 解读结果

`summary` 字段已做好基础分析：

```json
{
  "total": 3,
  "byStatus": { "审核中": 1, "已发布": 2 },
  "latest": "2026-10-21 01:56",
  "oldest": "2026-08-03 18:04",
  "interactions": [ { "title": "...", "date": "...", "vals": ["67","2","0","0","0"] } ]
}
```

`byStatus` 用来看发布成功率与审核情况；`interactions` 的行尾数字是创作平台列表的互动列
（阅读/点赞/收藏/评论/分享等，具体列序以页面为准）。

### 4. 输出结论

基于 `summary` 给可执行结论，例如：
- 审核中占比高 → 内容合规性需注意
- 某篇互动数明显高于其他 → 该选题/封面可复制
- 长时间未发 → 更新频率建议

## 错误处理

| 场景 | failure_kind | 引导动作 |
|------|-------------|---------|
| 未绑定小红书账号 | `not_bound` | 引导到「账号连接」绑定 xhs 账号 |
| 多账号且未绑定具体账号 | `need_account_choice` | 把候选列表给用户选，把选定 `shopKey` 填 `--account` 重调；★ 绝不要自己挑 |
| 登录态过期 | `token_expired` | 引导到「账号连接」对该 xhs 账号「重新登录」，不要重试原请求 |
| Node/Chrome 缺失 | `skill_error` | 安装后重试 |
| sign_service 启动超时 | `skill_error` | 看技能目录 `sign_service.log` |
| 页面解析异常 | `parse_error` | 上报，附带返回的 `stdout` 尾部 |
| 账号下无笔记 | 正常空结果 | 提示暂无笔记 |

## 相关技能

- 发布笔记：`xhs-publish-re` / `xiaohongshu-publish`
- 关键词采集：`xiaohongshu-crawl`
- 同平台参考：`xianyu-analytics` / `zhihu-analytics`
