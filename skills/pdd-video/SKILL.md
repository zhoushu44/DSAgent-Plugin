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

<!-- RISK-CHEATSHEET:START（由 dev/inject-risk-cheatsheet.mjs 注入，请勿手改） -->

## ⚠ 风控速查（先读这里再排查）

> 完整机制与历史踩坑记录在**知识库**，遇到风控问题**先查库**：
> ```
> dsagent_wiki_search(keyword="风控")                                     # 全部风控页
> dsagent_wiki_search(path="平台/entities/拼多多风控机制与应对.md")        # 机制总览
> dsagent_wiki_search(path="平台/entities/拼多多签名注入范围（Anti-Content vs crawlerInfo）.md") # 该不该带签名
> ```

### 错误码 → 处置

| 错误码 | failureKind | 含义 | 正确处置 |
|---|---|---|---|
| `54001` | `risk_control` | 操作太过频繁（风控） | **可自愈**：清旧 token → 提新票 → 重放。失败则人工过一次滑块，通过后有 10 分钟通行证。**不要**重新登录 |
| `40002` | `rate_limit` | 高频限流（**接口级**） | **不可本地修复**，重试无效、只会延长封禁。等待冷却，或降级（如 search → feed） |
| `100001` | `rate_limit` | 活动写操作频控（请 2 小时后重试） | **不可本地修复**。等待 2 小时或换时间段 |
| `43001` | `token_expired` | 会话过期（**不是风控**） | 重新扫码登录。注意凭证库快照可能是旧票，优先用浏览器当前 Cookie |
| `40001` | `token_expired` | 未登录 | 重新扫码登录 |
| `310120000` | `reload_required` | **页面上下文失效**（403 专用码） | 官方处置是 `window.location.reload()`：重开/刷新页面后重试。**不是登录失效，不要跳登录页** |
| `40010` | `no_permission` | 无权限 | 可能是账号类型不对（需诚信通/实力商家），或换主店号 |
| `2000000` | `no_permission` | 账号不适合发布 | 权限问题，换号或到后台查违规记录 |
| `48143` | `api_error` | 非法请求 | 该接口依赖页面 SDK 的请求上下文，需让页面自己发请求（DOM 触发） |
| `3000000` | `api_error` | 参数错误或灰度未开放 | 检查入参（日期/页码/queryType 等） |
| HTTP `430` | `rate_limit` | 网关级频率惩罚（Cookie 有效） | 等 15~30s 重试。**不要**误判成 session_expired |
| `detached Frame` / `Target closed` | `risk_control` | 平台主动关掉页面 | 等 3~5 分钟再试，别连续重试 |

### 四条铁律

1. **不要把 54001 当 token_expired** —— 前者需要过一次滑块，后者才需要重新登录。误判会让用户反复登录，每次登录还刷新一次风控基线。
2. **不要重试 40002** —— 它是接口级持久限流，实测冷却 240s 零请求后仍空。
3. **不要在冷却期内连续调用** —— 拼多多按「累计行为分数」延长封禁，越打越久。
4. **分清两个签名条件，别合并** —— 平台有两套独立判断：**域名正则**（mms/ims/... 命中就带 `header Anti-Content`）+ **162 条路径白名单**（命中才在 body 里塞 `crawlerInfo`）。只要域名是 `mms.pinduoduo.com`，**头就必须带**；把「不在 162 名单」当成「不用签名」会稳定打出 54001（我已真机踩过）。判据统一用 `_shared/pdd-sign-scope.mjs` 的 `signPlan(url)`。

### 其他已知坑

- **两个登录态不通用**：`pdd`（H5 买家态，`.yangkeduo.com`）与 `pdd_mms`（商家后台态，`mms.pinduoduo.com`）是两套独立账号，各跑一套风控评分。
- **`Failed to launch the browser process!`** 大概率是 Profile 被孤儿 Chrome 占用（SingletonLock 残留），不是 Chrome 坏了。清理：`~/.dsh/pdd-account-locks` 无关，要杀占用该 Profile 的 chrome 进程 + 删 `SingletonLock`。
- **账号级并发**：两个任务同时打同一个号会显著提高被封概率，`_shared/pdd-risk.mjs` 的账号锁会拦住，看到「正被其他任务占用」就等等。
- **签名兜底字面量**：平台自己的兜底值是 `"getRisckInfoError"`（注意 `Risck` 是平台拼写）。带它发请求 = 自报「我拿不到环境指纹」，比不带更可疑。

<!-- RISK-CHEATSHEET:END -->

<!-- PITFALLS:START（由 dev/inject-skill-sections.mjs 注入） -->

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定拼多多商家后台账号 | `not_bound` | 引导到「账号连接」添加账号 |
| 登录态失效（跳登录页**且**无滑块遮罩、无业务错误码） | `token_expired` | 引导重新扫码登录 |
| 被风控打到登录页（跳登录页**但**有滑块遮罩或业务错误码） | `risk_control` | ★ **不要引导重新登录**（只会刷新风控基线）。引导人工过滑块，完成后重试 |
| `54001` 操作太过频繁 | `risk_control` | 可自愈（清 token→提新票→重放）；失败则人工过一次滑块，之后 10 分钟有通行证 |
| `40002` 高频限流 | `rate_limit` | ★ **重试无效**（接口级持久限流），只会延长封禁。等待冷却或降级 |
| HTTP `430` 网关级频率惩罚 | `rate_limit` | 等 15~30s 重试，**不要**误判成 session_expired |
| 页面被关闭 / `detached Frame` | `risk_control` | 平台主动关页面 = 临时风控。等 3~5 分钟再试，别连续重试 |
| 账号正被其他任务占用 | `rate_limit` | 账号锁生效中，等待当前任务结束 |
| `Failed to launch the browser process!` | `api_error` | 大概率是 Profile 被孤儿 Chrome 占用（SingletonLock 残留），不是 Chrome 坏了。杀占用该 Profile 的 chrome 进程后重试 |
| L2 写操作未带 `--confirm` | `needConfirm` | 这是预览门禁，把 text 给用户看并征得同意后带 `--confirm` 重试 |

> 完整机制与历史踩坑记录在知识库：`dsagent_wiki_search(keyword="风控")`

<!-- PITFALLS:END -->

<!-- PRECONDITIONS:START（由 dev/inject-skill-sections.mjs 注入） -->

## 前置条件

- **账号已绑定**：「账号连接」页已绑定**拼多多商家后台**（`live.pinduoduo.com` 走 mms SSO）。
- **登录态有效**：失效时返回 `token_expired`。
- **上传/删除是 L2 写操作**：必须两步走——先不带 `--confirm` 拿预览给用户看，**明确同意后**才带 `--confirm` 执行。
- **视频文件要求**：本地绝对路径，`.mp4/.wmv/.mov/.avi/.m4v`，单文件 ≤500MB。
- **Chrome 可用**（签名与上传需要页面环境）。

<!-- PRECONDITIONS:END -->




> 入口 `live.pinduoduo.com/n-creator/video/home?from=mms`（**独立域**，mms 扫码后 SSO 自动打通）。
> 写模式（upload/delete）是**不可撤销的真实操作（L2）**：先给预览，用户明确同意后才执行。

## 工作流

### W1：查询类（只读，无副作用）

```
① 确认模式：list（我的视频）/ detail（单个视频数据）/ data（带货数据）
   / anchor（主播信息）/ qualify（发布资格）/ topics（话题列表）
② 调 node scripts/video.mjs --mode <模式> [--limit N]
③ 把 text 原样转述用户；明细类可让用户指定某条再看 detail
```

### W2：上传视频（L2 写，两步走）

```
① 第一步：不带 --confirm 拿「发布预览」给用户看
   node scripts/video.mjs --mode upload --file <本地视频绝对路径>
        [--title 标题] [--desc 描述] [--cover 封面] [--goods-id 带货商品ID]
② 用户明确同意后，第二步才带 --confirm 真正上传
   node scripts/video.mjs --mode upload --file ... --confirm true
③ 报告结果：ok=true → 已上传；平台可能要求审核（正常）
```

### W3：删除视频（L2 写，两步走）

```
① 先 list 拿到 video_id，确认要删哪条
② 不带 --confirm 拿预览 → 给用户确认 → 带 --confirm 执行
③ ★ 删除不可撤销，务必让用户明确知道删的是哪条
```

**★ 风控要点**：`live.pinduoduo.com` 是独立域（与 mms 后台 SSO 打通但 Cookie 域不同）。
上传前若页面被关掉（detached Frame），等 3~5 分钟再试，别连续重试。

## 何时使用

- 用户说「多多视频」「我的视频」「发了什么视频」→ `list`
- 要看**单个视频的数据**（播放/点赞/评论/分享）→ `detail`
- 要看店铺带货数据 → `data`
- 要看主播/达人身份信息 → `anchor`
- 要确认能不能发视频 → `qualify`
- 要找话题标签 → `topics`

## 能力

| 模式 | 类型 | 接口 | 说明 |
|------|------|------|------|
| `list` | 只读 | `POST /mms/amco/prePublish/query` | 待发布队列（视频 ID/URL/封面/裁剪点/商品） |
| `published` | 只读 | `POST /api/backbone/video/query` | 已发布视频列表 |
| `detail` | 只读 | `POST /api/backbone/video/query` | **单个视频数据**（播放/点赞/评论/分享/vv） |
| `data` | 只读 | `stats/overview` + `stats/trend` + `weekly_report` + `diagnosis_and_suggest` | 带货数据总览 + 30 日趋势 + 周报 + 建议 |
| `anchor` | 只读 | `GET /kiwi/obs/anchor/info` | 主播信息 |
| `qualify` | 只读 | `POST /api/backbone/video/publish_qualification` | 发布资格 |
| `permission` | 只读 | `signed_contract/query` + `video_flow_card/entrance` + `mall_promotion_config` | 带货/内容权限 + 流量卡奖励 |
| `topics` | 只读 | `POST /api/orpheus-obs/topic/list` | 话题列表（空则输出内容声明清单） |
| `upload` | **L2 写** | 见上传链路 | 上传视频 + 加入待发布（`--publish true` 可直接发布） |
| `delete` | **L2 写** | `/mms/amco/prePublish/delete` | 删除视频 |

## 上传完整链路（2026-10-24 逆向，已实证跑通）

```
① POST /mms/amco/prePublish/clear              清空待发布队列
② POST /api/backbone/video/publish/page/query  拿发布页配置 + 内容声明清单
③ POST /live/galerie/signature                 ★ 拿视频上传票据
   body: {"bucket_tag":"backbone-video-sign"}
④ POST /api/galerie/large_file/v1/video/upload_init     拿 uploadId + partSize
⑤ POST /api/galerie/large_file/v1/video/upload_part     二进制分片
⑥ POST /api/galerie/large_file/v1/video/upload_complete 合并
⑦ POST /api/backbone/video/meta/query           拿 vid
⑧ POST /live/galerie/signature                 ★ 封面票据
   body: {"bucket_tag":"backbone-cover-b"}
⑨ POST /v3/store_image                          封面上传
⑩ POST /mms/amco/prePublish/add                 加入待发布 ★
```

### ★ 关键坑：不拿签名票据 → upload_init 403

```
实测：跳过 ③ 直接调 ④ → {"error_code":40003}
     先调 ③ 再调 ④ → success
```

## 发布链路（2026-10-24 逆向，参数结构已实证正确）

```
POST /api/backbone/video/publish
body: { feeds: [ feed, ... ] }

feed 结构（chunk 2990-59211e1343c3e949.js 官方构造逻辑）：
  {
    desc: "",                    // 描述
    scheduleTime: null,          // 定时发布（毫秒），null = 立即
    goodsIdList: [],             // 带货商品 ID 列表
    outVideoUrl: "",             // 外部视频 URL（同步视频用）
    useRecRelatedGoods: false,   // 用推荐商品
    anchorDeclarationType: 11,   // ★ 内容声明类型（必填）
    cover: "https://...",        // 封面 URL
    cutStartTime: null,          // 裁剪起点（毫秒）
    cutEndTime: null,            // 裁剪终点（毫秒）
    vid: "backbone-video-sign-b#xxx",   // ★ 上传拿到的 vid
    topicId: null,               // 话题 ID
    syncVideo: false,            // 同步到店铺动态
    needCreateCoverUrl: null,
    newPushPxq: null,
  }

内容声明类型（anchorDeclarationType）：
  11 = 内容无需标注      1 = 含AI生成内容     5 = 含虚构演绎内容
   7 = 内容含营销信息    3 = 内容为转载       8 = 个人观点，仅供参考

★ cutStartTime/cutEndTime 官方会 × 1000（秒→毫秒）

发布后清理草稿：
  POST /mms/amco/prePublish/delete
  body: { urlList: [...], vidList: [vid] }
```

### 发布前置条件

```
实测：参数结构正确时，账号权限不足会返回
  {"success":false,"errorCode":2000000,"errorMsg":"您的账号被系统判定不适合发布"}

→ 需先开通（用 --mode permission 查）：
    goodsFeedPermission   商品带货权限
    commonFeedPermission  普通内容权限
```

## 接口方法差异（踩坑）

```
/kiwi/obs/anchor/info              GET   （POST 会 405）
/api/backbone/anchor/query         POST  （会 54001，需 VerifyAuthToken）
/mms/amco/prePublish/*             POST
/api/galerie/large_file/v1/video/* POST（二进制 body）
/api/backbone/video/query          POST
```

## 已挖接口实测状态

成功 12 个：
```
/api/backbone/video/publish/page/query        发布页配置 + 内容声明
/api/orpheus-obs/official/topic/list          官方话题
/api/orpheus-obs/topic/list                   话题
/api/backbone/video/promotion_goods/wait_list_v2   待绑商品
/api/backbone/video/allow_sync                false
/api/backbone/video/signed_contract/query     权限查询
/api/backbone/video/meta/query                元数据
/carllive/replay/query_publish_feed_earn_stream   收益流
/carllive/replay/mall_promotion_config        带货配置
/element/obs/video_flow_card/entrance          流量卡入口
/chassis/obs/creator/service/platform          平台信息
/mms/amco/prePublish/{query,add,clear,delete}  草稿队列
```

失败 2 个：
```
/api/backbone/video/quality/check   3000000 非目标用户（灰度）
/api/backbone/anchor/query          54001（需 VerifyAuthToken）
```

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
  1. mms 已登录 -> 访问 live 域
  2. POST /janus/api/subSystem/generateAccessToken  {redirectUrl}
  3. GET  /login/checker
  4. POST /calpis/mms/user/login  {token_type:1, out_token}
  5. 进入 n-creator/video/home
```

## 已知坑

| 坑 | 说明 |
|---|---|
| `live.pinduoduo.com` 是独立域 | 但通过 `generateAccessToken` + `calpis/mms/user/login` 打通，**不用单独扫码** |
| 接口不在 mms 域 | 所以 `pdd-client` 的三通道签名用不上，走浏览器页面上下文 |
| `prePublish/query` 返回结构 | **双层 result**：`{result:{result:{list,total,hasMore}}}`，已做多形态兼容 |
| 埋点接口噪声 | `/api/pmm/*` `/xg/pfb/*` 是埋点，已排除 |
| **不拿签名票据 → upload_init 403** | 必须先调 `/live/galerie/signature`（`bucket_tag=backbone-video-sign`） |
| `/kiwi/obs/anchor/info` 是 GET | POST 会 405 |
| `/api/backbone/video/query` 的 status | 0~4 有效，5 报 BAD_PARAMS，-1 = 全部 |

## 上传要求（页面提示）

- 格式：`.mp4 .wmv .mov .avi .m4v`，支持批量
- 内容：有真人、商品稳定出镜、有人声介绍、**竖版视频** → 更容易拿流量
- 快捷发布：**用商品 id 命名视频文件**，上传后平台自动匹配商品
- 激励：上传成功 + 添加有流量奖励的商品 + 审核通过 → 得大额流量卡

## 单个视频数据（detail）

```
POST /api/backbone/video/query
  {status, pageSize, page, startTime, endTime}
```

**字段来源**：chunk `3973-d417d75a06c76a22.js` 的卡片组件定义：

```js
{label:"点赞",           key:"likes"}
{label:"评论",           key:"comments"}
{label:"分享",           key:"shares"}
{label:"播放量",         key:"views"}
{label:"7日推荐有效vv",  key:"vv"}
```

完整字段：

| 字段 | 说明 |
|------|------|
| `feedId` / `vid` | 视频 ID |
| `feedType` | 1=视频，2=图文 |
| `title` / `desc` | 标题 / 描述 |
| `coverUrl` | 封面 |
| `mediaUrl` | 视频地址 |
| `pictureUrls` | 图文图片列表 |
| `audioInfo` | 音频信息 |
| `isHotTag` | 是否热门 |
| `status` | 状态 |
| `publishTime` | 发布时间 |
| `likes` / `comments` / `shares` | 点赞 / 评论 / 分享 |
| `views` | 播放量 |
| `vv` | 7 日推荐有效 vv |
| `goodsList` | 带货商品 |

**status 取值**：`0~4` 有效（`5` 报 BAD_PARAMS），`-1` = 全部

**派生指标**（脚本自动算）：
```
点赞率 = likes / views
互动率 = (likes + comments + shares) / views
```

**没有已发布视频时**：自动兜底查待发布队列（`source: "queue"`），
至少有 vid / 封面 / 视频地址 / 商品，但没有互动数据。

## 待挖（下一版）

- 视频流量卡 / 历史推广记录
- 图文发布（`/api/backbone/video/pictures/publish`）
- 已发布视频的删除接口
- 单视频的「流量来源」拆分

## 用法

```bash
# 读
node scripts/video.mjs --mode list                        # 待发布队列
node scripts/video.mjs --mode published                   # 已发布视频
node scripts/video.mjs --mode detail                      # 单个视频数据（全部）
node scripts/video.mjs --mode detail --feed-id 12345      # 指定视频
node scripts/video.mjs --mode detail --status -1          # 全部状态
node scripts/video.mjs --mode data                        # 带货数据
node scripts/video.mjs --mode data --date-type 3          # 近30日
node scripts/video.mjs --mode anchor                      # 主播信息
node scripts/video.mjs --mode qualify                     # 发布资格
node scripts/video.mjs --mode permission                  # 权限与流量卡奖励
node scripts/video.mjs --mode topics                      # 话题/内容声明

# 写（L2，两步：先预览，后 --confirm true）
 待发布队列
node scripts/video.mjs --mode published                   # 已发布视频
node scripts/video.mjs --mode detail                      # 单个视频数据（全部）
node scripts/video.mjs --mode published --status -1       # 全部状态
node scripts/video.mjs --mode anchor                      # 主播信息
node scripts/video.mjs --mode qualify                     # 发布资格
node scripts/video.mjs --mode permission                  # 带货/内容权限 + 流量卡奖励
node scripts/video.mjs --mode topics                      # 话题 / 内容声明

# 写（L2，两步：先预览，后 --confirm true）
node scripts/video.mjs --mode upload --file /path/video.mp4 [--title 标题] [--desc 描述] [--goods-id 123]
node scripts/video.mjs --mode upload --file /path/video.mp4 --confirm true
node scripts/video.mjs --mode upload --file /path/video.mp4 --confirm true --publish true --declaration 11
node scripts/video.mjs --mode delete --video-id 123
node scripts/video.mjs --mode delete --video-id 123 --confirm true
```
