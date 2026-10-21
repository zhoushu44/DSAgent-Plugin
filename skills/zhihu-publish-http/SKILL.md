---
name: zhihu-publish-http
description: "知乎专栏文章发布（RE HTTP 三步链路）：把 Markdown 文章发布为知乎专栏文章，不走 DOM 逐格填写，直接由页面会话发出真实的 HTTP 请求。触发：发布知乎文章、写知乎专栏、发知乎、投稿知乎专栏、把文章发到知乎、知乎HTTP发布。排除：知乎数据采集（用 zhihu-works）、知乎搜索/评论/热榜采集（用 zhihu-crawl）、DOM 路线发布（用 zhihu-publish）。需绑定 zhihu 账号；发布为 L2 操作，必须先给用户看预览并获明确同意。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "知乎·文章发布(HTTP)"
    emoji: "⚡"
    requires:
      zhihu: "知乎账号"
      bins: [node]
---

# 知乎专栏文章发布（RE HTTP）

不起 DOM 输入、不模拟键盘，直接由页面会话发出三个真实的 HTTP 请求把文章发出去。
`zhuanlan.zhihu.com` 域下整套发布流程**不需要 `x-zse-96` 签名**，只要 `x-xsrftoken`。

> **重要:** 发布是**不可撤销的真实操作（L2）**。必须两步走：先拿「发布预览」给用户看，
> 用户**明确同意**后才真正提交。绝不要在一次调用里直接传 `--confirm true`。

## 何时使用

- 用户说「把这篇发到知乎」「发布知乎专栏文章」→ 本技能
- 用户给出 Markdown 文件路径 + 要求发知乎 → 本技能
- 用户明确要求「HTTP 直连」「不要模拟点击」「rea http」→ 本技能（而非 DOM 路线）

## 与 zhihu-publish（DOM 路线）的区别

| | `zhihu-publish`（DOM） | **本技能（HTTP）** |
|---|---|---|
| 输入方式 | 模拟键盘逐格填标题/正文 | 直接 POST/PATCH/PUT 真实接口 |
| Markdown 支持 | ❌ 需页面富文本 | ✅ 内置转 HTML |
| 失败点 | 页面结构变更、输入被吞 | 端点变更、登录态失效 |
| 可控性 | 低（靠页面状态） | 高（每步有状态码） |

## 前置条件 / Preconditions

| # | 条件 | 不满足时的现象 | 处置 |
|---|------|---------------|------|
| 1 | 「账号连接」已绑定 **zhihu** 账号 | `failure_kind=not_bound` | 引导到「账号连接」页面绑定知乎账号 |
| 2 | 该知乎账号登录态有效 | `failure_kind=token_expired` | 引导到「账号连接」对该知乎账号「重新登录」，**不要重试** |
| 3 | 本机已装 Node.js | 提示未找到 node | 安装 Node.js 或设 `DSAGENT_NODE_BIN` |
| 4 | 本机有 Chrome/Edge | `未找到 Chrome 或 Edge` | 安装浏览器 |
| 5 | 文章内容就绪 | `缺少标题` / `缺少正文` | 提供 `--file` 或 `--title` + `--content` |

## 边界

- **只发专栏文章**，不发回答、想法、视频
- **不支持自定义封面、话题、专栏选择、定时发布**
- 标题上限 **100 字**，超限调用前被拦下
- 正文中的图片语法 `![]()` **不在支持范围**，要插图需走图片上传接口
- 每次运行都会**建一个新草稿并发布**，不幂等 —— 别对同一篇重复调用
- 发布过程会弹出可见浏览器窗口（约 6 秒，用于建立会话环境）

## 执行流程

### 1. 收集参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `--file` | 二选一 | Markdown 文件绝对路径。首行 `# ` 后是标题，第一个 `## ` 起是正文 |
| `--content` | 二选一 | 正文 Markdown（与 file 二选一，同时传 file 优先）|
| `--title` | 否 | 标题，≤100 字。传 file 时可省略，自动提取 |
| `--account` | 否 | 账号 shopKey；多账号时必须指定 |
| `--dry` | 否 | `true` 只建草稿 + 写正文，不发布 |
| `--confirm` | 否 | `true` 才真正提交；省略只返回预览 |

### 2. 先取「发布预览」（不带 confirm）

```bash
python3 {baseDir}/scripts/run.py --file "D:/notes/article.md"
```

此时**不启动浏览器、不产生任何写操作**，只返回预览（标题、字数、正文开头），
并以 `__DSAGENT_RESULT__` 协议输出 `needConfirm: true`。

### 3. 把预览完整展示给用户并征求明确同意

把预览原样呈现，明确问「确认要发布吗？」。**这一步不可跳过**（L2 风险门禁）。

### 4. 用户同意后带 `--confirm true` 重新调用

```bash
python3 {baseDir}/scripts/run.py --file "D:/notes/article.md" --confirm true
```

依次完成：起 Chrome → 登录态预检（www 域）→ 建草稿 → 写正文 → PUT 发布 → 返回文章 URL。

### 5. 报告结果

- 成功：给出 `articleId` 与 URL，并说明**平台可能仍在审核**，以「创作中心 → 内容管理」为准
- 失败：按 `failure_kind` 走下方「错误处理」

## 已对接接口（全部实测 200）

| 步骤 | 方法 | 端点 | body |
|------|------|------|------|
| 建草稿 | POST | `https://zhuanlan.zhihu.com/api/articles/drafts` | `{title, delta_time, can_reward}` |
| 写正文 | PATCH | `https://zhuanlan.zhihu.com/api/articles/{id}/draft` | `{title, content, table_of_contents, delta_time, can_reward}` |
| 发布 | **PUT** | `https://zhuanlan.zhihu.com/api/articles/{id}/publish` | `{}` |

鉴权：仅需 `x-xsrftoken`（取自 `_xsrf` cookie）。Cookie 由浏览器自动带。

> 发布是 **PUT 不是 POST** —— `POST /publish` 返 405，这条是穷举 11 个候选才定位到的。
> `PATCH /api/articles/{id}` 也是 405，必须带 `/draft` 后缀。

## 错误处理

| 场景 | failure_kind | 引导动作 |
|------|-------------|---------|
| 未绑定知乎账号 | `not_bound` | 引导到「账号连接」页面绑定知乎账号 |
| 平台有多个可用账号且未指定 | `need_account_choice` | **把候选列表给用户选**，把选定的 shopKey 填进 `--account` 重调；★ 绝不要自己挑一个 |
| 登录态失效 | `token_expired` | 引导到「账号连接」对该知乎账号「重新登录」 |
| 文件不存在 / 缺标题 / 缺正文 / 标题超 100 字 | `api_error` | 按提示修正参数后重试 |
| 建草稿或写正文非 200 | `api_error` | 看 artifacts 里的原始响应 |
| 发布非 200 | `api_error` | 同上；响应体超限时文章可能已发出，用 `--mode` 无关的 verify 手段确认 |
| 命中风控（403） | `risk_control` | 调 `dsagent_risk_verify(platform="zhihu")` 拉验证页，用户完成后重试 |

## 已知限制

- **图片不支持** —— 正文 Markdown 里的 `![]()` 不会被转成 `<img>`，插图需另走上传接口
- **Markdown 转换是自写极简版** —— 支持标题层级、表格、列表、引用、加粗、行内代码、分割线；
  嵌套列表、代码高亮、脚注不支持
- **发布响应体可能超过 60000 字符**导致 JSON 解析失败，但文章**已经发布成功** —— 所以必须
  以线上 URL 可访问为最终判据，不能只信发布响应
- **不幂等** —— 每次运行建新草稿并发布，重复调用会发出多篇

## 环境变量

| 变量 | 用途 |
|------|------|
| `DSAGENT_PLUGIN_ROOT` | 插件根目录（默认按技能目录上推三级）|
| `DSAGENT_NODE_BIN` | node 可执行文件路径（一般无需设置）|
