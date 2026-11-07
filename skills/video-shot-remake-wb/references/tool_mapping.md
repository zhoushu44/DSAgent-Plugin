# 工具映射

## 抽象 → 实现

| 原 SOP | 实现 |
|---|---|
| MultiModalToVideo | `$runninghub-seedance-video` |
| Seedance 2.0 | RunningHub `sparkvideo-2.0/multimodal-video` |
| TextToImage / ImageToImage | Codex 内置 `image_gen`（订阅 Image-2） |
| video_assembler | 外部剪辑或 ffmpeg |

## 推荐命令

### 元素图 / 关键帧图

- 直接调用 Codex 内置 `image_gen`；不要改走 shell 或 API/CLI。
- 本地参考图先用 `view_image` 检查，再通过 `referenced_image_paths` 传入。
- 对话中的附件或最近生成图使用最小必要的 `num_last_images_to_include`。
- 每个不同资产分别生成；审图通过后再复制到项目目录。
- 不需要 `OPENAI_API_KEY` 或 CLIProxyAPI。

### 镜头视频

使用 `$runninghub-seedance-video` 的固定费用闸门：

1. `estimate` 上传参考媒体并返回预计价格。
2. 展示费用，等待用户确认。
3. `submit --confirm CONFIRM --max-price <上限>`。
4. `status --wait` 查询并下载到项目 `shots/`。

官方时长范围为 4–15 秒。图片、视频、音频必须按顺序在 prompt 中通过 `@Image N`、`@Video N`、`@Audio N` 引用。
