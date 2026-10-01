---
name: bilibili-download
description: "B站视频下载：把 B站 视频、番剧、合集或收藏夹下载到本地，自动完成拉流与 ffmpeg 合流，可指定清晰度、音质、输出格式与选集范围。触发：下载B站视频、B站视频下载、下载哔哩哔哩、把B站视频保存到本地、下载B站番剧、下载B站合集、B站视频转音频、下载B站音频。排除：B站数据采集（用 bilibili-crawl）、B站内容发布（用 bilibili-publish）。需绑定 bilibili 账号。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "B站·视频下载"
    emoji: "🔌"
    requires: {}
---

# B站视频下载

> **重要:** 下载仅用于个人学习与备份，不得用于二次分发或商业用途。请尊重 UP 主版权。

## 何时使用

- 用户说"把这条 B站 视频下载下来"、"下载这个 BV 号" → 下载视频
- 用户说"下载这个 B站 番剧"、"下载这个合集" → 批量下载
- 用户说"把 B站 视频转成音频"、"只要音频" → 仅音频下载
- 用户说"下载 4K / 1080P 版本" → 指定清晰度下载

## 边界

- **不做数据采集** —— 视频详情 / 搜索 / 排行榜 / 评论请用 `bilibili-crawl`
- **不做内容发布** —— 投稿视频请用 `bilibili-publish`
- **不做弹幕文件后处理** —— 弹幕可下载（默认开），但不做弹幕转字幕等加工
- 只能下载**当前账号有权访问**的内容（大会员专享 / 付费内容需要对应账号权限）
- 大文件不走代理网关，由 host 工具直接调本地 `yutto` CLI 完成；**需要本机已装 yutto 与 FFmpeg**
- 高清（1080P 及以上）通常需要登录态；未绑定账号时只能拿到低清
- 同一时间可并发，但建议控制频率，避免触发 B站 风控

## 执行流程

本技能**没有脚本入口**，执行方式是**直接调用 host 工具** `dsagent_bilibili_download`。

### 1. 收集参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `url` | 是 | B站 视频/番剧/合集链接，支持 `b23.tv` 短链 |
| `dir` | 否 | 输出目录，默认 `~/.dsh/downloads/bilibili` |
| `quality` | 否 | 清晰度：数字码或名称（见下表） |
| `audioQuality` | 否 | 音质：数字码或名称 |
| `outputFormat` | 否 | `infer`（默认）/ `mp4` / `mkv` / `mov` |
| `batch` | 否 | 番剧 / 合集 / 多 P 批量下载时传 `true` |
| `episodes` | 否 | 选集范围，如 `1~-1`（全部）、`1,3,5`、`2~6` |
| `videoOnly` / `audioOnly` | 否 | 只保留单轨（二者互斥） |
| `noDanmaku` / `noSubtitle` | 否 | 不要弹幕 / 字幕 |
| `withMetadata` / `saveCover` | 否 | 附带 nfo 元数据 / 保存封面 |

清晰度取值：

| 名称 | 数字码 | 名称 | 数字码 |
|------|--------|------|--------|
| `8K` | 127 | `1080P60` | 116 |
| `4K` | 120 | `1080P` | 80 |
| `720P60` | 74 | `720P` | 64 |
| `480P` | 32 | `360P` | 16 |

音质取值：`Hi-Res`=30251、`320kbps`=30280、`128kbps`=30232、`64kbps`=30216。

### 2. 调用工具

```
dsagent_bilibili_download(url="https://www.bilibili.com/video/BV1xx411c7mD")
```

指定清晰度与输出目录：

```
dsagent_bilibili_download(url="https://www.bilibili.com/video/BV1xx411c7mD", quality="1080P", dir="D:\videos")
```

番剧批量下载全集：

```
dsagent_bilibili_download(url="https://www.bilibili.com/bangumi/play/ss12345", batch=true, episodes="1~-1")
```

### 3. 报告结果

- 成功：把返回的**新文件绝对路径**列表告知用户（工具按「下载前后目录快照差集」计算，只列本次真实产出的文件）
- 失败：按返回的 `failureKind` 走下方「错误处理」

> 下载耗时取决于文件大小与清晰度，工具总超时 30 分钟。若被超时中断，返回值里会带上已产出的**不完整文件**路径，可提示用户重试。

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定 B站 账号 | `not_bound` | 引导用户到「账号连接」页面扫码登录 B站 账号（不登录只能拿低清） |
| 平台有多个可用账号且当前会话未绑定 | `need_account_choice` | **把候选列表给用户选**，把选定的 `shopKey` 填进 `account` 参数重调；★ 绝不要自己挑一个 |
| 日志出现 SESSDATA / 未登录 / 401 / 403 | `token_expired` | 引导用户到「账号连接」页面**重新登录** B站 |
| 日志出现风控 / `-352` / 请求过于频繁 | `risk_control` | 提示稍后重试，降低频率；必要时先在浏览器正常浏览 B站 页面 |
| URL 不含 `bilibili.com` / `b23.tv` | `api_error` | 让用户确认链接；短链 `b23.tv` 是支持的 |
| 找不到 yutto 可执行文件 | `api_error` | 提示用户安装：`uv tool install yutto`（需 Python 3.11+ 与 FFmpeg） |
| 清晰度 / 音质取值无法识别 | `api_error` | 按返回值里给出的可用取值列表重新指定 |
| `videoOnly` 与 `audioOnly` 同时为 true | `api_error` | 二选一 |
| 下载超时（30 分钟） | `api_error` | 告知已产出的不完整文件，建议改低清晰度或指定选集后重试 |

## 环境变量

本技能为纯指令型，不执行脚本，无环境变量依赖。
账号凭证由 host 工具从凭证库读取并**内联传给 yutto 的 `--auth` 参数**，日志与返回值均已脱敏，**技能侧不接触 Cookie**。

## 依赖

| 依赖 | 说明 |
|------|------|
| `yutto` | B站 视频下载器 CLI（v2.3.1+）。安装：`uv tool install yutto`（需 Python 3.11+） |
| `ffmpeg` | B站 音视频分离（DASH），必须合流。默认探测 `C:\Program Files (x86)\FFmpeg\bin\ffmpeg.exe` 等常见路径，找不到时回退到 PATH |

> 调用方式为**子进程**（`yutto download ...`），不链接其代码；yutto 为 GPL-3.0，以 CLI 方式调用不构成衍生作品。
