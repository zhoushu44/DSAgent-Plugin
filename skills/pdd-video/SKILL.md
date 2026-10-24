---
name: pdd-video
description: "拼多多·多多视频：读——我的视频列表、主播信息、发布资格、话题列表；写（L2）——上传视频、删除视频。数据源 live.pinduoduo.com/n-creator/video/home（独立域，mms SSO 打通）。触发：多多视频、拼多多视频、商家视频、带货视频、视频列表、发布视频、上传视频、删除视频、内容管理、pdd video。排除：多多直播（未覆盖）、商品上架（用 pdd-publish-http）。需绑定「拼多多商家后台」账号。"
metadata:
  builtin_skill_version: "1.1"
  dsagent:
    display_name: "拼多多·多多视频"
    emoji: "🎬"
    requires: {}
---

# 拼多多 · 多多视频

> 入口 `live.pinduoduo.com/n-creator/video/home?from=mms`（**独立域**，mms 扫码后 SSO 自动打通）。
> 写模式（upload/delete）是**不可撤销的真实操作（L2）**：先给预览，用户明确同意后才执行。

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
| `upload` | **L2 写** | 见下方链路 | 上传视频 + 加入待发布队列 |
| `delete` | **L2 写** | `/mms/amco/prePublish/delete` | 删除视频 |

## 上传完整链路（2026-10-24 逆向）

```
① POST /mms/amco/prePublish/clear              清空待发布队列
② POST /api/backbone/video/publish/page/query  拿发布页配置
③ POST /live/galerie/signature                 ★ 拿视频上传票据
   body: {"bucket_tag":"backbone-video-sign"}
④ POST /api/galerie/large_file/v1/video/upload_init     拿 uploadId + partSize
⑤ POST /api/galerie/large_file/v1/video/upload_part     分片（二进制 body）
⑥ POST /api/galerie/large_file/v1/video/upload_complete 合并
⑦ POST /api/backbone/video/meta/query           拿 vid
⑧ POST /live/galerie/signature                 ★ 封面票据（bucket_tag=backbone-cover-b）
⑨ POST /v3/store_image                          封面上传
⑩ POST /mms/amco/prePublish/add                 加入待发布 ★
```

### ★ 关键坑：不拿签名票据 → upload_init 直接 403

```
实测：跳过 ③ 直接调 ④ upload_init → {"error_code":40003}
     先调 ③ galerie/signature 再调 ④ → success
```

`/api/galerie/*` 与 `/live/galerie/signature` 是**两个不同前缀**：
```
/live/galerie/signature   ← 票据（在 live 域）
/api/galerie/...          ← 上传（也在 live 域，但要票据）
```

### prePublish/add body

```json
{
  "prePublishFeedVOList": [{
    "title": "视频标题",
    "desc": "描述",
    "coverUrl": "https://pfs01.pinduoduo.com/...",
    "goodsList": [{"goodsId": 123}],
    "vid": "backbone-video-sign-b#xxxx"
  }]
}
```

### 其他已挖接口

```
/api/backbone/goods/check                      商品校验
/carllive/replay/query_publish_feed_earn_stream  收益流
/api/orpheus-obs/official/topic/list            官方话题
/api/backbone/video/pictures/publish            图文发布
/api/backbone/video/promotion_goods/bind        绑商品
/api/backbone/video/promotion_goods/wait_list_v2  待绑列表
/api/backbone/video/allow_sync                  允许同步
/api/backbone/video/signed_contract/query       签约查询
```

### 上传要求（页面提示）

- 格式：`.mp4 .wmv .mov .avi .m4v`，支持批量
- 内容：有真人、商品稳定出镜、有人声介绍、**竖版视频** → 更容易拿流量
- 快捷发布：**用商品 id 命名视频文件**，上传后平台自动匹配商品
- 激励：上传成功 + 添加有流量奖励的商品 + 审核通过 → 得大额流量卡

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
| `prePublish/query` 的返回结构 | **双层 result**：`{result:{result:{list,total,hasMore}}}`，已做多形态兼容 |
| 埋点接口噪声 | `/api/pmm/*` `/xg/pfb/*` 是埋点，已排除 |
| **不拿签名票据 → upload_init 403** | 必须先调 `/live/galerie/signature`（`bucket_tag=backbone-video-sign`），再调 `/api/galerie/...` |

## 待挖（下一版）

- 已发布视频的列表接口（`prePublish/query` 只返回待发布队列）
- 内容数据 / 带货数据
- 视频流量卡 / 历史推广记录
- 图文发布（`/api/backbone/video/pictures/publish`）

## 用法

```bash
# 读
node scripts/video.mjs --mode list
node scripts/video.mjs --mode list --limit 50
node scripts/video.mjs --mode anchor
node scripts/video.mjs --mode qualify
node scripts/video.mjs --mode topics

# 写（L2，两步：先预览，后 --confirm true）
node scripts/video.mjs --mode upload --file /path/video.mp4 [--title 标题] [--desc 描述] [--goods-id 123]
node scripts/video.mjs --mode upload --file /path/video.mp4 --confirm true
node scripts/video.mjs --mode delete --video-id 123
node scripts/video.mjs --mode delete --video-id 123 --confirm true
```

```bash
node scripts/video.mjs --mode list
node scripts/video.mjs --mode list --limit 50
node scripts/video.mjs --mode anchor
node scripts/video.mjs --mode qualify
node scripts/video.mjs --mode topics
```
