---
name: xhs-publish-re
description: "小红书图文/视频笔记发布（逆向复现版，支持定时发布）：把本地图片或视频发布为小红书笔记，自动上传素材、填写标题正文、可选定时发布并提交。触发：发布小红书、发小红书笔记、发红书、上传图文到小红书、小红书定时发布、定时发小红书、投稿小红书。排除：小红书数据采集（用 xiaohongshu-crawl）、数据分析（用 xiaohongshu-analytics）。需绑定 xhs 账号；发布为 L2 操作，必须先给用户看预览并获明确同意。"
metadata:
  builtin_skill_version: "3.0"
  dsagent:
    display_name: "小红书·发布(逆向)"
    emoji: "📤"
    requires:
      xhs: "小红书账号"
      bins: [node]
---

# 小红书·发布（逆向复现版 · HTTP 主链路 + 页面兜底）

> **重要:** 发布是**不可撤销的真实操作（L2）**。必须两步走：先拿「发布预览」给用户看，
> 用户**明确同意**后才真正提交。绝不要在一次调用里直接传 `confirm=true`。

## 两条通道（先主链路，失败才兜底）

| 通道 | 实现 | 何时用 | 特点 |
|---|---|---|---|
| **① HTTP 主链路**（默认） | 自算签名 `_shared/xhs-sign.mjs` + 直连接口 | 默认 | 不开浏览器（图文）、秒级、不占 Profile |
| **② 页面兜底** | 真 Chrome + 页面代签名 `_shared/xhs-browser.mjs` | `fallback=page`，或主链路报 `sign_rejected` / `risk_control` / `api_error` / `parse_error` | 慢（要开浏览器等渲染），但签名由页面自己算，抗改版 |

### 各素材类型的真实边界（重要）

| 场景 | 链路 | 说明 |
|---|---|---|
| **图文发布** | **全 HTTP** | 传图 + 提交都是普通 `/api/sns/web/v1/*`，签名自算即可 |
| **视频发布** | 浏览器拿 permit → 纯 HTTP 直传 + 提交 | ⚠️ **permit 拿不到纯 HTTP**：它走上「上传 SDK 私有实例通道」，见下 |
| **笔记分析** | 全 HTTP | `GET /api/sns/web/v1/note_list` |

> **permit 为什么必须借浏览器**（逆向报告 §3.3 实测）：
> 拿旧的 `x-s` 打新的 permit 请求 → **406 `{"code":-1}`**，即使补上
> `x-xray-traceid` 关联头也无效。它不走普通 axios/fetch 层，服务端对「签名 + 请求」
> 做了强绑定。所以视频发布的第①段只能让页面自己发，再从 hook 里读响应；
> 拿到 permit 后，COS PUT（自算 COS v5 签名）与提交笔记都回到纯 HTTP。

## 何时使用

- 「把这个视频发到小红书」→ 视频笔记
- 「这 3 张图发小红书，标题 XXX」→ 图文笔记
- 「定时到明天晚上 8 点发这篇」→ 带 `timer`
- 「先自检一下发布链路通不通」→ 带 `dry: true`

## 前置条件

| # | 条件 | 不满足时的现象 | 处置 |
|---|------|---------------|------|
| 1 | 「账号连接」已绑定 **xhs** 账号 | `failure_kind=not_bound` | 引导用户到「账号连接」绑定小红书 |
| 2 | xhs 账号登录态有效 | `failure_kind=token_expired` | 引导用户对该账号「重新登录」 |
| 3 | 本机有 Node（页面兜底还需 Chrome/Edge） | `failure_kind=skill_error` | 安装 Node 与 Chrome |
| 4 | 该账号的浏览器 Profile 没被占用（仅兜底通道需要） | `failure_kind=api_error`（提示占用者） | 关掉已弹出的浏览器窗口后重试 |

## 参数

| 参数 | 必需 | 说明 |
|------|:----:|------|
| `type` | 是 | `image`（默认）= 图文；`video` = 视频 |
| `title` | 是 | 标题，**≤ 20 字** |
| `images` | 二选一 | 图片绝对路径，英文逗号分隔，**≤ 18 张**，仅 jpg/jpeg/png/webp |
| `video` | 二选一 | 视频绝对路径，仅 mp4/mov/mkv/webm/flv/f4v/m4v/ts |
| `desc` | 否 | 正文，可含 `#话题`，**≤ 1000 字** |
| `timer` | 否 | 定时发布，格式 `"YYYY-MM-DD HH:mm"`；省略 = 立即发布 |
| `dry` | 否 | `true` = 只验证不发布（见下） |
| `confirm` | 是（L2） | `true` 才真正提交；省略 = 只出预览 |
| `fallback` | 否 | `auto`（默认）/ `http` / `page` |
| `account` | 否 | 账号 shopKey；多账号且未绑定时先问用户 |

## 执行流程

### 1. 收集参数

从用户话里提取，缺项主动问。`images` 与 `video` 按 `type` 二选一。

### 2. 先取「发布预览」（不带 confirm）

```bash
node {baseDir}/scripts/publish.mjs --type image --title "秋天穿搭分享" --images "D:\img\1.jpg,D:\img\2.jpg"
```

此时**不发任何请求、不开浏览器**，只返回预览 JSON（`needConfirm: true`）。

### 3. 把预览完整展示给用户并征求明确同意

**不可跳过、不可自行假设用户同意。**

### 4. 用户同意后带 confirm=true 重新调用

```bash
# 立即发布
node {baseDir}/scripts/publish.mjs --type image --title "秋天穿搭分享" --images "D:\img\1.jpg" --confirm true

# 定时发布
node {baseDir}/scripts/publish.mjs --type video --title "新品实测" --video "D:\v\demo.mp4" --timer "2026-10-25 20:00" --confirm true
```

### 5. dry-run 自检（强烈建议先跑）

```bash
node {baseDir}/scripts/publish.mjs --type video --title "test" --video "D:\v\demo.mp4" --dry true
```

`dry` 会做三件**真实**校验，并给出 `publishable` 结论：

| 检查 | 做法 | 判据 |
|---|---|---|
| 签名有效性 | 拿免登录接口 homefeed 做「正确签名 vs 篡改签名」对照 | 正确 200 且篡改 ≠200 → `sign.valid=true` |
| 登录态 | `GET /api/sns/web/v2/user/me` | `code=0` 才算有效 |
| 素材 | 逐张/逐条检查存在性、大小、扩展名 | 全部就绪 |

> `dry` 是唯一**允许过期账号执行**的路径（否则连签名对不对都验不了）。

### 6. 报告结果

- 成功：`channel` 会告诉你走的是 `http` 还是 `page`；平台可能仍在审核，以创作平台「笔记管理」为准
- 失败：按 `failure_kind` 走下方「错误处理」

## 底层实现

### HTTP 主链路（默认）

```
_shared/xhs-sign.mjs  → x-s / x-t / x-s-common（逐字节对齐 xiaohongshu-crawl/scripts/xhs_sign.py）
_shared/xhs-api.mjs   → 图文：POST /api/sns/web/v1/upload → POST /api/sns/web/v1/note
                        视频：GET  /api/media/v1/upload/creator/permit   ← 借浏览器（grabPermitViaPage）
                              → PUT https://<uploadAddr>/<fileId>        ← COS v5 自算签名，ak=sk="null"
                              → POST /api/sns/web/v1/note               ← 回纯 HTTP
```

★ **POST body 必须用 `signHeaders` 返回的 `bodyStr` 原样发送**。x-s 是按 content_string
算的，里面内嵌了 body 的 JSON 文本；重新 `JSON.stringify` 一次（键序/空格不同）就会 461。

### 页面兜底

```
lib/browser-login.profileDir('xhs', shopKey) → 账号级 Chrome Profile（与登录/风控验证同一把锁）
  → CredentialStore 取 cookie，只看 .xiaohongshu.com 一条域注入
  → 打开发布页 → 切 tab → DataTransfer 挂载媒体 → 等上传完成
  → 原生 setter 填标题/正文（Vue3 v-model 必须）
  → 定时：input[type=checkbox].click() 开开关 + 填 DatePicker
  → xhs-publish-btn.dispatchEvent(new CustomEvent('publish', {bubbles:true, composed:true}))
```

### 关键坑（均已绕过，勿改）

1. **closed Shadow DOM**：发布按钮在 `attachShadow({mode:"closed"})` 内 → 必须派发 `CustomEvent`
2. **Vue3 v-model**：`el.value = x` 不生效 → 必须走 `HTMLInputElement.prototype` 原生 setter
3. **d-switch 合成事件无效**：定时开关必须用 `input[type=checkbox].click()`
4. **COS key 必须精确等于 fileId**：加任何后缀都会 `401 upload token deny`
5. **不能用测试 payload PUT 到真实 fileId**：会污染文件导致播放器「请刷新试试」
6. **Cookie 只注 `.xiaohongshu.com` 一个域**：同时注 www/creator 会让同名 Cookie 冲突

## 错误处理

| 场景 | failure_kind | 自动兜底 | 引导动作 |
|------|-------------|:---:|---------|
| 未绑定小红书账号 | `not_bound` | ✗ | 引导到「账号连接」绑定 xhs 账号 |
| 多账号且未绑定具体账号 | `need_account_choice` | ✗ | 候选列表给用户选，选定 `shopKey` 填 `account` 重调；★ 绝不要自己挑 |
| 登录态过期 | `token_expired` | ✗ | 引导到「账号连接」重新登录，**不要重试**（开浏览器也是白开） |
| 签名被拒（-104） | `sign_rejected` | ✓ | 自动切页面代签名 |
| 风控（461/471） | `risk_control` | ✓ | 自动切页面（有完整浏览器指纹） |
| 接口返回 HTML / 路径变动 | `api_error` / `parse_error` | ✓ | 自动切页面读 DOM |
| 参数不合法 | `api_error` | ✗ | 按提示修正后重试（发生在开浏览器之前） |
| 浏览器 Profile 被占用 | `api_error` | — | 关掉弹出的浏览器窗口后重试 |
| 媒体未就绪 | `api_error` | — | 播放器报「请刷新试试」= 素材被污染，换素材 |
| `submit-disabled=true` | `api_error` | — | 表单校验未过（标题/正文/封面缺失） |

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `DSAGENT_PLUGIN_ROOT` | 技能目录上两级 | 插件根（定位 `lib/` 与 `node_modules/puppeteer-core`） |

## 自检工具（开发用）

```bash
# 签名与 Python 版逐字节一致性（离线·单场景）
node {baseDir}/../_shared/verify-xhs-sign-parity.mjs

# 签名全场景矩阵：POST/GET/中文/emoji/数组/空体/超长正文（离线·8 用例）
node {baseDir}/../_shared/verify-xhs-sign-matrix.mjs

# 签名是否被平台接受（在线·对照实验）
node {baseDir}/../_shared/verify-xhs-sign-live.mjs
```

## 迁移对照（v1 → v3）

| 旧文件 | 处理 |
|---|---|
| `scripts/publish.py` | 已删除，逻辑并入 `scripts/publish.mjs` |
| `sign_service.cjs` | 已删除，PAGE_HOOK 迁到 `_shared/xhs-browser.mjs`（仅兜底用） |
| `xhs_publish.cjs` | 已删除，UI 流程并入 `publish.mjs` 的 `publishViaPage()` |
| `cos_sign.cjs` | **保留**，`xhs-api.mjs` 的 `uploadVideoToCos()` 通过 `createRequire` 复用它 |
