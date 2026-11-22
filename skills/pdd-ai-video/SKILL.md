---
name: pdd-ai-video
description: "拼多多·AI 素材工具图生视频（aid 域）：本地图批量上传到图片空间 → 生成 AI 短视频 → 下载。全链路纯 HTTP，零浏览器常驻、零 anti-content。支持两阶段流水线（先全传再统一生成）、断点续跑、额度预检、并发控制。触发：拼多多AI视频、图生视频、AI商品视频、aid图生视频、批量生成商品视频、pdd ai video。排除：多多视频上传（用 pdd-video）、商品上架（用 pdd-publish）、图片空间管理（用 pdd-works）。需绑定「拼多多商家后台」账号。"
metadata:
  builtin_skill_version: "1.0.0"
  dsagent:
    display_name: "拼多多·AI 图生视频"
    emoji: "🎬"
    requires: {}
---

# 拼多多 · AI 图生视频（aid 域）

> 生成器：`aid.pinduoduo.com/design/ai-generator`（独立 Next.js 应用）
> 与本插件 `pdd-video`（多多视频 live 域）**不是一回事**：
> - `pdd-ai-video`：AI 生成短视频 → 商品素材
> - `pdd-video`：商家自传视频 → 多多视频内容流

## 一句话

**全链路纯 HTTP**：图片走 mms 图片空间上传（`get_signature` + `store_image`），生成走 aid 的 `smartTool/video/*`。**不需要 anti-content，不需要常驻浏览器。**

---

## ⚠ 先读：五条硬约束（实测）

`genVideo` **不做任何入参校验**——乱传 duration/uid/source/url 全都返回 `1000000` + uuid。真实校验在后台异步做，**失败静默返回 40000，且额度照扣不退**。

| # | 约束 | 违反后果 |
|---|---|---|
| 1 | 图片必须在 `img.pddpic.com` 域 | 外部域名一律 40000 |
| 2 | 图片 ≥480px，比例 1:1 / 3:4 / 16:9 | 否则 40000 |
| 3 | 轮询必须 `res.uuid === 你的uuid` | 否则拿到旧结果或死等 |
| 4 | 并发 ≤2，提交间隔 ≥2s | 否则互相踢槽，仍扣额度 |
| 5 | 图片 ≤3MB（store_image 上限 5MB） | 超限上传失败 |

脚本已在提交前做强校验（`--dry` 可先演练）。

---

## 工作流

### W1：批量出片（推荐，两阶段）

**阶段 1 — 全部上传，拿 manifest**

```bash
node {baseDir}/scripts/gen-video.mjs --mode upload --dir "D:/imgs"
```

- 逐张预检（尺寸/比例/大小/格式），不合格直接剔除，**不浪费生成额度**
- 上传走 `mms get_signature` → `file.pddpic.com/v3/store_image`
- 产出 `artifacts/manifest-<ts>.json`，含每张图的 `imgUrl`

**阶段 2 — 统一生成**

```bash
node {baseDir}/scripts/gen-video.mjs --mode gen --manifest "<manifest路径>" --limit 20
```

- 从 manifest 读 URL，**不再碰本地文件、不再重复上传**
- 额度不足自动截断（不会跑到一半报错）
- 并发 2 + 错峰 2.2s
- 视频落 `artifacts/`

**一条龙**（内部仍是两阶段）：

```bash
node {baseDir}/scripts/gen-video.mjs --mode run --dir "D:/imgs" --limit 20
```

### W2：单张 / 少量

```bash
node {baseDir}/scripts/gen-video.mjs --mode run --file "D:/a.png,D:/b.png"
```

### ★ W2.5：生成 + 自动发布到多多视频（一体化）

默认**只生成**；加 `--publish` 才会发。发布必须带商品。

```bash
node {baseDir}/scripts/gen-video.mjs --mode gen \
  --manifest ".../manifest-xxx.json" --limit 10 \
  --publish --goods-id 930630868294 \
  --video-title "纸杯带货" \
  --video-desc "加厚双层中空，热饮不烫手"
```

内部会做：

```
① 生成 AI 视频 → 下载到 artifacts/
② 上传到多多视频（DOM 注入 input[type=file]）
③ 绑定商品（CDP：商品ID tab → 选中 → 下一步）
④ 选内容声明（默认「内容无需标注」，即 anchorDeclarationType 11）
⑤ 点击「一键发布」（CDP 真实鼠标点击）
⑥ 返回 feedId
```

**为什么发布必须走 CDP 点击而不是 HTTP：**

`/api/backbone/video/publish` 是**强校验接口**。页面点「发布」时浏览器拦截器会注入 `anti-content`
（SDK 实时指纹 + 时间戳），而 `page.evaluate + fetch` 走不到那条链路，稳定返回
`2000000 您的账号被系统判定不适合发布`。

实测对照（同一 vid / 同一 body / 同一 cookie）：

| 方式 | anti-content | 结果 |
|---|---|---|
| UI 真实点击 | ✅ 有 | ✅ success |
| page.evaluate + fetch | ❌ 无 | ❌ 2000000 |

**商品绑定必须 `specialType: 2`：**

```js
// prePublish/add
goodsList: [{ goodsId: "930630868294", specialType: 2 }]
```

`specialType=2` 对应「商品ID」tab；用 `1` 或 `null` 会导致队列里 `goodsItemList` 仍为空，
后续 publish 被拒。**验证方法：查 `prePublish/query` 的 `goodsItemList` 是否非空。**


### W3：已有图片 URL，直接生成

```bash
node {baseDir}/scripts/gen-video.mjs --mode gen --file "https://img.pddpic.com/xxx.png"
```

### W4：查询

```bash
node {baseDir}/scripts/gen-video.mjs --mode quota     # 今日剩余额度
node {baseDir}/scripts/gen-video.mjs --mode status    # 当前任务状态
```

---

## 凭证管理（一次取，长期用）

| 凭证 | 来源 | 有效期 | 刷新频率 |
|---|---|---|---|
| `ptj_token`（aid 子域） | 自动开浏览器导出 | **24h** | 过期才自动刷，平时不碰浏览器 |
| mms cookie | 凭证库 `pdd_mms` | 跟随登录态 | 掉登录需扫码 |

`ptj_token` 缓存在 `.cache/ptj-token.json`，带 `expiresAt`。**每次运行先校验有效期，有效直接复用，不反复拿。**

`mallId` 自动从 token payload 里解（`base64` 解出 `{"m":844492650}`），无需手工传。

手动刷新（一般不用，脚本会自己判断）：

```bash
node {baseDir}/scripts/gen-video.mjs --mode refresh-token
```

---

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--dir` | — | 图片目录（png/jpg/jpeg） |
| `--file` | — | 单图或多图逗号分隔；`gen` 模式可传 URL |
| `--manifest` | — | `gen` 模式必填 |
| `--limit` | 全部 | 只生成前 N 个 |
| `--concurrency` | 2 | **上限 2**，传更大也会被压到 2 |
| `--gap` | 2200 | 同批次提交间隔 ms，**低于 2000 会失败** |
| `--maxwait` | 420000 | 单任务超时 ms |
| `--out` | `skills/pdd-ai-video/artifacts` | 视频输出目录 |
| `--uid` | 自动 | mallId，一般不用传 |
| `--dry` | false | 只预检，不上传不生成 |

---

## 接口（纯 HTTP）

| 接口 | 域 | 用途 |
|---|---|---|
| `POST /galerie/business/get_signature` | mms | 拿上传签名 `{bucket_tag:"mms-material-img"}` |
| `POST /v3/store_image` | **file**.pinduoduo.com | 上传图片（`upload_sign` + `image`） |
| `POST /api/banner-intelligent/smartTool/video/genVideo` | aid | 建任务 `{url,duration:5,uid,source:"mms"}` |
| `POST /api/banner-intelligent/smartTool/video/getResult` | aid | 轮询 `{uid,uuid,source}` |
| `POST /api/banner-intelligent/smartTool/video/get/status` | aid | 查当前任务（只跟最后一个） |
| `POST /api/banner-intelligent/smartTool/video/set/free` | aid | 取消（**不退额度**） |
| `POST /api/banner-intelligent/smartTool/imageSpace/save/video` | aid | 存图片空间 |

统一成功码 **1000000**。

### ★ store_image 字段名（踩过坑）

```js
// 图片：必须是 upload_sign + image
fd.append("upload_sign", sig)
fd.append("image", file, name.toLowerCase())
fd.append("forbid_override", "false")

// 非图片（视频）：sign + file
```

用 `sign` + `file` 传图片会报 `40003 图片参数为空`。

---

## 产出规律

| 项 | 值 |
|---|---|
| 时长 | **~5.09s**（少数 4.91s），固定 112 帧 |
| 分辨率 | 624×624 |
| 编码 | h264 + aac |
| 日均额度 | **100 个**，每日重置 |
| 单条耗时 | 30~110s，平均 ~35s |
| 20 条总耗时 | 约 12 分钟 |
| `duration` 参数 | **完全无效**，服务端不读 |

---

## 错误码

| code | 含义 | 处置 |
|---|---|---|
| `1000000` | 成功 | — |
| `40022` | ptj_token 失效/缺失 | 脚本自动刷新 |
| `43001` | mms 会话过期 | 需重新扫码登 mms |
| `40000` | 后台生成失败 | 图片规格不符 / 并发冲突，**额度已扣不退** |
| `40003` | 图片参数为空 | store_image 字段名错了 |
| `40029` | aid 上传要 anti-content | 不要用 aid 的 material/upload，走 mms |

---

## 已知坑

1. **`getResult` 会返回上一个已完成任务**——必须 `res.uuid === uuid` 才认。
2. **完成态 `smartToolStatusEnum` 是 `null`**，不是 `SUCCESS`。查不存在的 uuid 返回 `uuid:null` + `RUNNING`，看着像在跑。
3. **`get/status` 只跟踪最后提交的任务**，多任务必须逐个 `getResult`。
4. **`set/free` 不退额度**，别拿来试。
5. **失败/取消均不退额度**，所以脚本先预检、先查额度再开跑。
6. `--start-maximized` 偶发导致 Chrome 启动失败，脚本内置 5 次重试。
7. 凭证库快照的 cookie 对 `generateAccessToken` 无效，必须用浏览器实时导出。

---

## 示例：20 张图出 20 条视频

```bash
# 1. 上传（预检 + 上传，约 15s）
node {baseDir}/scripts/gen-video.mjs --mode upload --dir "D:/my-images"

# 输出：
#   图片上传完成：成功 20 / 共 20
#   manifest: .../manifest-1793930231350.json

# 2. 生成（并发 2，约 12 分钟）
node {baseDir}/scripts/gen-video.mjs --mode gen \
  --manifest ".../manifest-1793930231350.json" --limit 20

# 输出：
#   图生视频：成功 20/20｜额度 100→80（扣 20，失败不退）｜耗时 693s
```

## 示例：生成 + 自动发布（10 条实测）

```bash
node {baseDir}/scripts/gen-video.mjs --mode run \
  --dir "D:/my-images" --limit 10 \
  --publish --goods-id 930630868294 \
  --video-title "纸杯带货" \
  --video-desc "加厚双层中空设计，热饮不烫手，冷饮不冒汗"
```

实测结果（2026-11-06）：

```
图生视频：成功 10/10｜额度 77→67（扣 10）
发布多多视频：成功 8/10｜商品 930630868294
耗时 1558s（约 26 分钟）
```

单条成功记录：

| # | feedId |
|---|---|
| 1 | 7042269704934292653 |
| 3 | 7042272014645905715 |
| 4 | 7042272728540782881 |
| 5 | 7042273442805607741 |
| 7 | 7042277343055731020 |
| 8 | 7042278056431044243 |
| 9 | 7042278771560281402 |
| 10 | 7042279485002496689 |

失败 2 条均为**页面时序问题**（「找不到发布按钮」/「无响应」），不是权限问题。
脚本已内置一次补救重试；若仍失败，视频已生成，可单独补发。

## 性能基线

| 阶段 | 单条耗时 | 10 条总耗时 |
|---|---|---|
| 图片上传 | ~1s | ~2s |
| AI 生成 | 30~110s（并发2） | ~5 分钟 |
| 发布（CDP） | 80~120s（串行） | ~20 分钟 |

**发布阶段是瓶颈**，因为每条都要重启浏览器走完整 UI 流程。

