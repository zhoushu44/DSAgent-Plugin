---
name: xhs-publish-re
description: "小红书图文/视频笔记发布（逆向复现版，支持定时发布）：把本地图片或视频发布为小红书笔记，自动上传素材、填写标题正文、可选定时发布并提交。触发：发布小红书、发小红书笔记、发红书、上传图文到小红书、小红书定时发布、定时发小红书、投稿小红书。排除：小红书数据采集（用 xiaohongshu-crawl）、数据分析（用 xiaohongshu-analytics）。需绑定 xhs 账号；发布为 L2 操作，必须先给用户看预览并获明确同意。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "小红书·发布(逆向)"
    emoji: "📤"
    requires:
      xhs: "小红书账号"
      bins: [node, python3]
---

# 小红书·发布（逆向复现版）

> **重要:** 发布是**不可撤销的真实操作（L2）**。必须两步走：先拿「发布预览」给用户看，
> 用户**明确同意**后才真正提交。绝不要在一次调用里直接传 `confirm=true`。

## 何时使用

- 「把这个视频发到小红书」→ 视频笔记
- 「这 3 张图发小红书，标题 XXX」→ 图文笔记
- 「定时到明天晚上 8 点发这篇」→ 带 `--timer`
- 「先自检一下发布链路通不通」→ 带 `--dry true`（不发布）

## 与 xiaohongshu-publish 的差异

| 能力 | xiaohongshu-publish | xhs-publish-re（本技能） |
|---|---|---|
| 图文发布 | ✅ | ✅ |
| 视频发布 | ✅ | ✅ |
| **定时发布** | ❌ | ✅ `--timer "YYYY-MM-DD HH:mm"` |
| **dry-run 自检** | ❌ | ✅ `--dry true` |
| Vue3 表单同步 | ⚠️ 标题可能丢失 | ✅ 原生 setter |
| 发布按钮触发 | DOM 点击（closed shadow 下失效） | ✅ CustomEvent 穿透 |

## 前置条件

| # | 条件 | 不满足时的现象 | 处置 |
|---|------|---------------|------|
| 1 | 「账号连接」已绑定 **xhs** 账号 | `failure_kind=not_bound` | 引导用户到「账号连接」绑定小红书 |
| 2 | xhs 账号登录态有效 | `failure_kind=token_expired` | 引导用户对该账号「重新登录」 |
| 3 | 本机有 Node.js + Chrome | `failure_kind=skill_error` | 安装 Node 与 Chrome |
| 4 | sign_service 可启动 | `failure_kind=skill_error` | 技能会自动拉起；失败看 `sign_service.log` |

## 参数

| 参数 | 必需 | 说明 |
|------|:----:|------|
| `--type` | 是 | `image`（默认）= 图文；`video` = 视频 |
| `--title` | 是 | 标题，**≤ 20 字** |
| `--images` | 二选一 | 图片绝对路径，英文逗号分隔，**≤ 18 张**，仅 jpg/jpeg/png/webp |
| `--video` | 二选一 | 视频绝对路径，仅 mp4/mov/mkv/webm/flv/f4v/m4v/ts |
| `--desc` | 否 | 正文，可含 `#话题`，**≤ 1000 字** |
| `--timer` | 否 | 定时发布，格式 `"YYYY-MM-DD HH:mm"`；省略 = 立即发布 |
| `--dry` | 否 | `true` = 只填表不发布（链路自检） |
| `--confirm` | 是（L2） | `true` 才真正提交；省略 = 只出预览 |
| `--port` | 否 | sign_service 端口，默认 8787 |
| `--account` | 否 | 账号 shopKey；多账号且未绑定时先问用户 |

## 执行流程

### 1. 收集参数

从用户话里提取，缺项主动问。`--images` 与 `--video` 按 `--type` 二选一。

### 2. 先取「发布预览」（不带 --confirm）

```bash
python3 {baseDir}/scripts/publish.py --type image --title "秋天穿搭分享" --images "D:\img\1.jpg,D:\img\2.jpg"
```

此时**不启动浏览器、不产生任何写操作**，只返回预览 JSON（`needConfirm: true`）。

### 3. 把预览完整展示给用户并征求明确同意

**不可跳过、不可自行假设用户同意。**

### 4. 用户同意后带 --confirm true 重新调用

```bash
# 立即发布
python3 {baseDir}/scripts/publish.py --type image --title "秋天穿搭分享" --images "D:\img\1.jpg" --confirm true

# 定时发布
python3 {baseDir}/scripts/publish.py --type video --title "新品实测" --video "D:\v\demo.mp4" --timer "2026-10-25 20:00" --confirm true
```

### 5. dry-run 自检（可选，先于正式发布）

```bash
python3 {baseDir}/scripts/publish.py --type video --title "test" --video "D:\v\demo.mp4" --dry true
```

返回 `mediaReady / fill / btn.submitDisabled` 等链路状态，用于确认发布前各环节就绪。

### 6. 报告结果

- 成功：告知已提交，说明平台可能仍在审核，最终状态以创作平台「笔记管理」为准
- 失败：按 `failure_kind` 走下方「错误处理」

## 底层实现（逆向成果）

发布走 **UI 驱动 + closed Shadow DOM 事件穿透**：

```
sign_service.cjs（Node + puppeteer-core，常驻真实 Chrome + 登录态）
  → xhs_publish.cjs 打开发布页 → 切 tab → DataTransfer 挂载媒体
  → 等上传完成（图文：出现「图片编辑 N/18」；视频：出现「重新上传」+ 播放器无错误）
  → 原生 setter 填标题/正文（Vue3 v-model 必须）
  → 定时：input[type=checkbox].click() 开开关 + 填 DatePicker
  → document.querySelector('xhs-publish-btn')
        .dispatchEvent(new CustomEvent('publish', {bubbles:true, composed:true}))
  → 跳转 /publish/success 即成功
```

### 关键坑（均已绕过，勿改）

1. **closed Shadow DOM**：发布按钮在 `attachShadow({mode:"closed"})` 内，
   `querySelector` 与 `shadowRoot` 均不可见 → 必须派发 `CustomEvent('publish', {composed:true})`
2. **Vue3 v-model**：`el.value = x` 不生效 → 必须走 `HTMLInputElement.prototype` 原生 setter
3. **d-switch 合成事件无效**：定时开关必须用 `input[type=checkbox].click()`
4. **不能用测试 payload PUT 到真实 fileId**：会污染文件导致播放器「请刷新试试」
5. **不能 location.href 跳转**：会丢表单状态，发布按钮不渲染

## 错误处理

| 场景 | failure_kind | 引导动作 |
|------|-------------|---------|
| 未绑定小红书账号 | `not_bound` | 引导到「账号连接」绑定 xhs 账号 |
| 多账号且未绑定具体账号 | `need_account_choice` | 把候选列表给用户选，把选定 `shopKey` 填 `--account` 重调；★ 绝不要自己挑 |
| 登录态过期 | `token_expired` | 引导到「账号连接」对该 xhs 账号「重新登录」，不要重试原请求 |
| 参数不合法（标题超 20 字/素材不存在/格式不符/ images 与 video 混用） | `api_error` | 按提示修正后重试 |
| sign_service 起不来 | `skill_error` | 看技能目录下 `sign_service.log`；确认 Node/Chrome 已装 || 媒体未就绪 | `api_error` | 播放器报「请刷新试试」= 文件被污染或格式问题，换素材重试 |
| `xhs-publish-btn` 不存在 | `api_error` | 表单未渲染，多为媒体未过校验；换合规素材 |
| `submit-disabled=true` | `api_error` | 表单校验未过（标题/正文/封面缺失），补齐后重试 |
| 点击后未跳 success | `api_error` | 查看弹出的浏览器窗口内提示；有滑块需人工完成 |
| 输出无法解析 | `parse_error` | 上报，附带 `stdout` 尾部 |

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `XHS_PUPPETEER` | DSAgent-Plugin 内 puppeteer-core | puppeteer-core ESM 路径 |
| `XHS_CHROME` | `C:\Program Files\Google\Chrome\Application\chrome.exe` | Chrome 可执行路径 |
