---
name: pdd-video
description: "拼多多·多多视频：读——我的视频列表、主播信息、发布资格、话题列表。数据源 live.pinduoduo.com/n-creator/video/home（独立域，mms SSO 打通）。触发：多多视频、拼多多视频、商家视频、带货视频、视频列表、发布视频、内容管理、pdd video。排除：多多直播（未覆盖）、商品上架（用 pdd-publish-http）。需绑定「拼多多商家后台」账号。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "拼多多·多多视频"
    emoji: "🎬"
    requires: {}
---

# 拼多多 · 多多视频

> 只读技能。数据源 `live.pinduoduo.com`（**独立域**，从 mms 扫码后 SSO 自动打通）。

## 何时使用

- 用户说「多多视频」「我的视频」「发了什么视频」→ `list`
- 要看主播/达人身份信息 → `anchor`
- 要确认能不能发视频 → `qualify`
- 要找话题标签 → `topics`

## 能力

| 模式 | 类型 | 接口 | 说明 |
|------|------|------|------|
| `list` | 只读 | `POST /mms/amco/prePublish/query` | 我的视频列表（视频 ID/标题/封面/时长/状态/播放/商品数） |
| `anchor` | 只读 | `GET /kiwi/obs/anchor/info` · `POST /api/backbone/anchor/query` | 主播信息 |
| `qualify` | 只读 | `POST /api/backbone/video/publish_qualification` | 发布资格 |
| `topics` | 只读 | `POST /api/orpheus-obs/topic/list` | 话题列表 |

## 入口与域

```
入口：https://live.pinduoduo.com/n-creator/video/home?from=mms
菜单：mms.pinduoduo.com 左侧「多多视频」

登录打通链路（自动，无需单独扫码）：
  ① mms 已登录 → 访问 live 域
  ② POST /janus/api/subSystem/generateAccessToken  {redirectUrl}
  ③ GET  /login/checker
  ④ POST /calpis/mms/user/login  {token_type:1, out_token}
  ⑤ 进入 n-creator/video/home
```

## 已知坑

| 坑 | 说明 |
|---|---|
| `live.pinduoduo.com` 是独立域 | 但通过 `generateAccessToken` + `calpis/mms/user/login` 打通，**不用单独扫码** |
| 接口不在 mms 域 | 所以 `pdd-client` 的三通道签名用不上，走浏览器页面上下文 |
| `prePublish/query` 的返回结构 | 实测返回可能是数组或 `{list/videos/items}`，脚本已做多形态兼容 |
| 埋点接口噪声 | `/api/pmm/*` `/xg/pfb/*` 是埋点，已排除 |

## 待挖（下一版）

- 上传视频（`发布视频` 按钮链路）
- 删除视频
- 内容数据 / 带货数据
- 视频流量卡 / 历史推广记录

## 用法

```bash
node scripts/video.mjs --mode list
node scripts/video.mjs --mode list --limit 50
node scripts/video.mjs --mode anchor
node scripts/video.mjs --mode qualify
node scripts/video.mjs --mode topics
```
