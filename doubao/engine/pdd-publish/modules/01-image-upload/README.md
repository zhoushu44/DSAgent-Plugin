# 图片/视频上传

**元素**：`input[type=file]（藏在「本地上传」按钮里，display:none）`

## 定位方式

| target | tracking-id | 说明 |
|---|---|---|
| `carousel-step1` | `local_upload` | 第1步主图 |
| `carousel` | `carousel_img_localfile_upload` | 第2步主图 |
| `carousel-any` | 两个都试 | 自动兼容两步 |
| `detail` | `detail_img_localfile_upload` | 详情图（多图）|
| `whiteBg` | `white_bg_img_localfile_upload` | 白底图 |
| `imageLabel` | `upload_image_label` | 图片标签 |
| `merchandiseVideo` | `merchandise_video_localfile_upload` | 商品视频 |
| `introVideo` | `intro_video_localfile_upload` | 介绍视频 |
| `detailVideo` | `detail_video_localfile_upload` | 详情视频 |

## 用法

```js
import { uploadImages, probeImageRegion, UPLOAD_TARGETS } from './01-image-upload/index.mjs'

// 主图（自动兼容第1步/第2步）
await uploadImages(page, { files: ['E:/a.png'], target: 'carousel-any' })

// 详情图多张
await uploadImages(page, { files: ['E:/d1.png','E:/d2.png'], target: 'detail' })

// 视频（组件内部自动点「上传视频」展开）
await uploadImages(page, { files: ['E:/v.mp4'], target: 'merchandiseVideo' })

// 探测
await probeImageRegion(page, 'detail')
```

## 输入要求

### 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `files` | string[] | ✅ | 本地文件绝对路径数组。**不要传 URL，组件不下载网络图** |
| `target` | string | ✅ | 上传区，见下表 |
| `max` | number | ❌ | 覆盖该区上限（默认从页面读） |
| `timeoutMs` | number | ❌ | 等待上传完成超时，默认 120000 |
| `onProgress` | function | ❌ | `(got, max) => void` 进度回调 |

### 注入方式（自动选择）

| 条件 | 方式 | 实测耗时 |
|---|---|---|
| 总量 ≤ 50MB | **纯 JS**（DataTransfer）| 0.33MB→29ms / 4.6MB→342ms / 10MB→587ms / 30MB→2021ms |
| 总量 > 50MB 或 `forceCdp:true` | CDP uploadFile | 毫秒级，不吃内存 |

纯 JS 注入实测全通过（含 30MB 视频），默认全走 JS。返回 `method` 字段说明用了哪种：
- `'js-datatransfer'` — 纯 JS
- `'cdp-uploadFile'` — CDP
- `'cdp-fallback'` — JS 失败后降级

参数 `jsMaxMB`（默认 50）可调阈值，`forceCdp:true` 强制走 CDP。
### 图片要求

| 项 | 要求 | 说明 |
|---|---|---|
| **格式** | `jpg` / `jpeg` / `png` | ⚠️ 不收 webp、gif、bmp |
| **大小** | **≤ 3 MB** | 超了平台拒收 |
| **宽高比** | **1:1 或 3:4** | 主图必须；其他比例会被裁 |
| **最小尺寸** | **宽、高均 ≥ 480px** | 两个都要满足 |
| **推荐尺寸** | 800×800 或 1024×1024 | 清晰且不超限 |
| **数量** | 主图 1~10 张；详情图 1~50 张 | 主图至少 1 张 |
| **内容** | 主体清晰、白底或浅底 | 模糊/拼接/带水印会被驳回 |

### 视频要求

| 项 | 要求 |
|---|---|
| **格式** | `mp4` / `mov` / `m4v` / `flv` / `mkv` / `wmv` / `avi` / `rmvb` / `3gp` |
| **大小** | **≤ 100 MB** |
| **时长** | 建议 6~60 秒 |
| **比例** | 1:1 或 16:9 |
| **数量** | 每个视频位 1 个 |

### 各 target 的要求

| target | 图片/视频 | 数量 | 特殊要求 |
|---|---|---|---|
| `carousel-step1` | 图片 | 1~10 | 第1步主图 |
| `carousel` | 图片 | 1~10 | 第2步主图 |
| `detail` | 图片 | 1~50 | 详情图，建议 750px 宽 |
| `whiteBg` | 图片 | 1 | **必须纯白底**，主体占比 >70% |
| `imageLabel` | 图片 | 1 | 图片标签 |
| `merchandiseVideo` | 视频 | 1 | 商品视频 |
| `introVideo` | 视频 | 1 | 介绍视频 |
| `detailVideo` | 视频 | 1 | 详情视频 |

### 前置校验（组件内部已做）

组件会先过滤，不合格的直接跳过并记入 `errors`：

```
① 文件存在性        → 不存在: xxx
② 大小              → 超 3MB: xxx (4.2MB)
③ 扩展名            → 图片只收 jpg/png: xxx.webp
④ 剩余空间          → 主图已满（10/10）
```

## 注意事项

- 用 CDP `uploadFile()`，**元素隐藏也能传**，不需要先让 input 可见
- 视频区 input 默认不渲染 → 组件内部自动点「上传视频」展开（幂等，已展开会跳过）
- 上传后轮询 `(n/max)` 计数确认真的传完，不是只塞进去
- 校验：图片 jpg/png ≤3MB；视频 mp4/mov/... ≤100MB

