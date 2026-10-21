---
name: douyin-publish-http
description: "抖音内容发布（HTTP 直连）：把本地视频或多张图片投稿到抖音，上传三步走 Node 原生 fetch（VOD/ImageX SigV4 + TOS 直传），不起 DOM、不等转码跳转，比 DOM 路线快 5 倍。触发：发布抖音、发抖音视频、投稿抖音、上传视频到抖音、抖音发布作品、发抖音图文、抖音多图发布、抖音HTTP发布。排除：抖音数据采集（用 douyin-crawl）、抖音作品数据查询与分析（用 douyin-works）、DOM 路线发布（用 douyin-publish）。需绑定 douyin 账号；发布为 L2 操作，必须先给用户看预览并获明确同意。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "抖音·内容发布(HTTP)"
    emoji: "⚡"
    requires:
      douyin: "抖音账号"
      bins: [node]
---

# 抖音内容发布（HTTP 直连）

> **重要:** 发布是**不可撤销的真实操作（L2）**。必须两步走：先拿「发布预览」给用户看，用户**明确同意**后才真正提交。
> 绝不要在一次调用里直接传 `--confirm true`。

## 何时使用

- 用户说"把这段视频发到抖音"、"发布抖音作品"、"投稿到抖音" → 视频投稿
- 用户说"发抖音图文"、"这几张图发抖音"、"抖音多图发布" → 图文投稿
- 用户给出本地文件路径 + 标题（可选描述），要求发到抖音 → 对应类型投稿
- 用户明确要求"HTTP 直连"、"快一点发"、"不要等转码" → 本技能（而非 DOM 路线）

## 与 douyin-publish（DOM 路线）的区别

| | `douyin-publish`（DOM） | **本技能（HTTP）** |
|---|---|---|
| 上传方式 | `input[type=file].uploadFile()` | Node 原生 `fetch` 直传 TOS |
| 等转码跳转 | 要（约 60s） | 不要 |
| 图文支持 | ❌ 只支持视频 | ✅ 视频 + 图文 |
| 封面 | 页面默认 | 不传，平台取视频首帧 |
| 实测耗时 | ~60s | 视频 ~10s / 图文 ~15s |
| 失败点 | 页面结构变更、转码超时 | SigV4 签名、CRC32 |

**两条路线的 a_bogus 处理一致**：都借用浏览器里已 patch 的 `window.fetch`。
差别只在上传那三步——DOM 路线让页面自己传，本技能让 Node 传。

## 边界

- **不做数据采集** —— 采集作品列表 / 视频详情 / 搜索请用 `douyin-crawl`
- **不做作品数据查询与分析** —— 播放量、完播率、metrics 30 项请用 `douyin-works`
- **不生成文案** —— 标题与描述由用户提供（或先用通用文案技能生成，再回到本技能发布）
- **不支持定时发布、自定义封面、合集/位置/话题选择**
- 文件必须是**本机绝对路径**且真实存在；技能不做下载
- 标题**限 30 字**、描述**限 1000 字**，超限会在调用前被拦下
- 图文张数无硬上限，但建议 ≤ 18（平台体验）
- 发布过程会**弹出可见浏览器窗口**（约 11 秒，用于建立签名环境）；若出现滑块需人工完成
- 同一时间只能有一个抖音发布窗口

## 执行流程

### 1. 收集参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `--videoPath` | 二选一 | 本地视频文件**绝对路径**，走视频投稿 |
| `--images` | 二选一 | 本地图片**绝对路径**，多张用英文逗号分隔，走图文投稿 |
| `--title` | 是 | 作品标题，**≤ 30 字** |
| `--description` | 否 | 作品描述/文案，可含 `#话题`，**≤ 1000 字** |
| `--account` | 否 | 账号 shopKey；多账号时必须指定 |
| `--confirm` | 否 | `true` 才真正提交；省略只返回预览 |

`--videoPath` 与 `--images` **只能二选一**，同时传会被拦下。

### 2. 先取「发布预览」（不带 confirm）

```bash
python3 {baseDir}/scripts/run.py --videoPath "D:/v/1.mp4" --title "标题" --description "文案"
```

> 入口是 `scripts/run.py`（Python 包装），由它转调 `scripts/publish.mjs`（Node 主逻辑）。
> 这样做是因为技能宿主的入口探测只认 `.py` 脚本；参数原样透传，两种写法等价。

脚本此时**不会启动浏览器、不产生任何写操作**，只返回一段「发布预览」（含类型、账号、文件、标题、描述），
并以 `__DSAGENT_RESULT__` 协议输出 `needConfirm: true`。

### 3. 把预览完整展示给用户并征求明确同意

把预览内容原样呈现给用户，并明确问一句"确认要发布吗？"。
**这一步不可跳过、不可自行假设用户同意**（L2 风险门禁）。

### 4. 用户同意后带 `--confirm true` 重新调用

```bash
python3 {baseDir}/scripts/run.py --videoPath "D:/v/1.mp4" --title "标题" --description "文案" --confirm true
```

依次完成：起 Chrome → 注入登录态 → 等 secsdk 装签名（11s）→ 登录态预检 →
auth/v5 拿 STS → ApplyUpload（SigV4）→ TOS 直传（JWT+CRC32）→ CommitUpload → create_v2 → 判定结果。

### 5. 报告结果

- 成功：告知 `item_id` 与分享链接，并说明**平台可能仍在审核**，最终状态以「作品管理」为准
- 失败：按返回的 `failure_kind` 走下方「错误处理」

## 错误处理

| 场景 | failure_kind | 引导动作 |
|------|-------------|---------|
| 未绑定抖音账号 | `not_bound` | 引导用户到「账号连接」页面扫码登录抖音账号 |
| 平台有多个可用账号且未指定 | `need_account_choice` | **把候选列表给用户选**，把选定的 `shopKey` 填进 `--account` 重调；★ 绝不要自己挑一个 |
| 登录态失效（`status_code:8`）| `token_expired` | 引导用户到「账号连接」页面对该抖音账号**重新登录** |
| 文件不存在 / 标题超 30 字 / 描述超 1000 字 / videoPath 与 images 同传 | `api_error` | 按提示修正参数后重试 |
| `auth/v5` 未返回凭证 | `api_error` | 登录态或平台策略变更，重试；持续失败请上报 |
| SigV4 返回 `InvalidAuthorization` | `api_error` | 签名参数错，检查 `user_id` 是否为真实 uid |
| TOS 直传非 200 | `api_error` | 通常是 `Content-CRC32` 或 StoreUri 问题，重试；持续失败请上报 |
| create_v2 未返回 `status_code:0` | `api_error` | 查看 `artifacts/publish-*.json` 里的原始响应 |

## 环境变量

| 变量 | 用途 |
|------|------|
| `DSAGENT_PLUGIN_ROOT` | 插件根目录（默认按技能目录上推三级，一般无需设置）|

账号凭证由脚本从凭证库（`~/.dsh/dsagent-accounts.json`）读取，**不接触明文 Cookie 输出**。

## 已知限制

- **封面不可自定义** —— 不传封面，平台自动取视频首帧（`GetPosterMode: "sync"`）
- **`a_bogus` 必须借浏览器** —— 该签名由 secsdk 在 fetch 内部附加，且与 URL 强绑定，Node 侧无法独立复现。所以仍会弹一次浏览器窗口（约 11 秒）
- **登录态失效不会自愈** —— 凭证库里的 `sessionid` 可能是占位值，脚本已内置预检，失效时直接报错退出，不会白跑五步
