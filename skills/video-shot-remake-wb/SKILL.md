---
name: video-shot-remake-wb
description: "视频拉片复刻（Codex 适配版）。参考原片做模板化复刻：保留镜头语言、节奏和风格，替换角色、产品或内容。遵循阶段式视频模板复刻 SOP；元素图和关键帧图使用 Codex 内置订阅 image_gen（Image-2），视频使用 runninghub-seedance-video 调用 RunningHub Seedance 2.0。触发词：视频拉片、拉片复刻、参考视频复刻、模板复刻、镜头复刻、原片当模板、shot remake。"
---

# 视频拉片复刻 · Codex 适配版

遵循阶段式视频模板复刻 SOP 的阶段、依赖与确认节奏。  
**不改流程骨架**；只把生图执行层切换到 Codex 内置订阅通道。

执行工具时按需读取 [`references/tool_mapping.md`](references/tool_mapping.md)；编写生成提示词时按需读取 [`references/prompt_rules.md`](references/prompt_rules.md)。

## 目标（说清楚）

- 目标是 **模板化复刻**，不是像素级克隆。
- 保留：剪辑点、景别、运镜、节奏、构图习惯、光色风格。
- 替换：角色 / 产品 / 台词 / 品牌内容。
- 原片 = 镜头语法模板；你的内容 = 新主体。

## 工具映射（执行层）

| 原 SOP 抽象 | Codex 落地 |
|---|---|
| resource_prepare_and_analyze / multimodal_analyze | 读参考视频 + 抽关键帧描述（本地看片/抽帧 + 模型描述） |
| text_editor | 直接写项目 Markdown |
| storyboard_designer | 写分镜 Markdown |
| TextToImage / ImageToImage / Nano Banana | **只用 Codex 内置 `image_gen`（订阅 Image-2）**；用户已给角色图则作为参考绑定，不无故重画 |
| MultiModalToVideo / Seedance 2.0 | 使用 `$runninghub-seedance-video` 调用 RunningHub Seedance 2.0 多模态视频 |
| 旁白 / BGM | 镜头内音频或独立中文 TTS / BGM，按故事板决定 |
| video_assembler | ffmpeg / 剪映 / 达芬奇（引导用户导出） |

### 角色一致性铁律（必读）

1. **纯文生视频无法锁死用户三视图**——需要一致性时必须传入已审核角色图。
2. 正确链路：  
   **用户角色图绑定 →（可选）Image-2 出单镜首帧/状态图 → 停给用户审图 → RunningHub Seedance 2.0 多模态参考生视频**。
3. 图片、视频、音频按上传顺序用 `@Image 1`、`@Video 1`、`@Audio 1` 在 prompt 中逐一引用。
4. 不要声称参考输入能保证像素级一致；完成每个试点镜头后仍需审片。

### MultiModalToVideo 说明

`MultiModalToVideo` **不是** Codex 内置工具名，而是原 SOP 的能力抽象：  
「提示词 + 元素/关键帧约束 → 单镜视频」。  
本 skill 中该能力 **一律由 `$runninghub-seedance-video` 实现**。

## 时长策略

RunningHub Seedance 2.0 官方接口支持 **4–15 秒**。本复刻 skill 默认按 15 秒以内单镜规划，实际提交前根据故事板选择时长并获取官方价格预估。

- 优先 10–15 秒完整叙事节拍。
- 复杂动作先做 4–5 秒试点镜头，审核通过后再生成长镜头。
- 超过 15 秒的叙事单元拆成多个子镜，合成时接回。

拉片分段建议：

- 叙事节拍可仍按完整 beat 描述。
- **生成单元默认 ≤15s**（优先 10–15s；能一镜说完就不拆）。
- 超过 15s 的叙事单元：拆成多个 ≤15s 子镜，合成时接回。

## 何时使用

用户要：

- 参考现有视频做复刻 / 仿拍 / 改主体重做
- 拉片 → 分镜 → 出元素 → 出镜 → 合成
- 明确「原片当模板，换我的内容」

## 前置条件

1. 用户提供参考视频路径，或可描述的参考片 + 可选元素图。
2. 生图直接使用 Codex 内置 `image_gen`；**不需要 `OPENAI_API_KEY`，也不依赖 CLIProxyAPI**。
3. 视频阶段使用 `$runninghub-seedance-video`；API Key 只从 `RUNNINGHUB_API_KEY` 或 `~/.config/runninghub-codex/api_key` 读取，不写进项目。
4. RunningHub Model API 需要企业级-共享 API Key；先运行该 Skill 的非付费 `check`，再开始视频阶段。

---

## Planner（流程不变）

完整阶段与依赖：

1. 详尽分析参考视频；提取关键参考帧（构图/取景/时刻）→ **resource_prepare_and_analyze**
2. 写 `Final_Video_Spec.md`（标题、类型、比例、时长、视觉风格、语言、模型偏好）→ **text_editor**
3. 故事板：key_elements、镜头列表、音频层 → **storyboard_designer**
4. 元素设置  
   - 用户已上传元素 → 直接绑定  
   - 否则用 Codex 内置 `image_gen`（订阅 Image-2）出图  
   - 有对话/旁白 → 预留 voice_reference（可后接 TTS）
5. 逐镜出视频：严格参考元素图、关键帧和动作视频 → **media_generator = RunningHub Seedance 2.0**
6. 按故事板出音频层（旁白/BGM）
7. 合成；引导导出 → **video_assembler**

依赖：`2→1；3→1,2；4→1,3；5→1,3,4；6→3；7→3,4,5,6`

用户已提供媒体：先绑定到分镜位，避免重复生成。

**何时暂停（强制）：**  
规格确认后 / 故事板后 / 元素图后 / 关键帧后 / 分镜视频后 / 音频后 —— 每阶段停，请用户审核再继续。  
不要一口气跑完全流程。

---

## 1) 视频分析（拉片）

对参考视频做完整镜头拆解。每段输出：

`00:00–00:15, 镜头描述`

描述用自然语言，包含：

- 角色动作、对话
- 场景/背景与动态
- 取景、摄像机运动、镜头类型与角度
- 其他摄像机语言

分段规则：

- 按完整叙事节拍分段，不必每个硬切都单开段
- **生成向分段默认 ≤15s**（适配 Seedance 2.0 官方时长范围）
- 超过 15s 的 beat：文档可保留完整叙事，生成时拆成多个 ≤15s 子镜

额外输出：

- 可替换槽位：`[角色]` `[产品]` `[台词]` `[品牌色]`
- 风格锚点：光色、质感、参考导演/片种关键词
- 关键帧列表：`keyframe_01…`（每镜至少 1 张高光/起始意图帧）

---

## 2) Final_Video_Spec.md

最少字段：

- Title / Type（广告、口播、剧情短片…）
- Aspect ratio：`16:9` / `9:16` / `1:1`
- Target duration
- Visual style
- Output language（旁白/对话语言）
- Image model：Codex 内置 `image_gen`（订阅 Image-2）
- Video model：`runninghub-seedance-video`（RunningHub Seedance 2.0）
- Remake mode：`template`（模板复刻）
- Source video path
- Replacement brief：新主体/产品/卖点

---

## 3) 故事板设计

### 关键元素

- 始终包含：关键主体、关键地点/场景、关键道具（如有）
- `element_id` 示例：`[Element_Detective_Li]`、`[Element_Office_Noir]`
- 角色描述含多种外观时写清外观 1/2；并写声音/音色
- 场景写清重要物体位置与朝向
- 用户提供资产时，描述不得与资产矛盾

### 镜头

- 每个镜头与拉片段落一一映射
- 保留参考片剪辑点、镜头类型、运镜、取景、节奏
- 只替换「谁在做什么 / 什么产品」
- 优先 10–15s 长节拍；镜内可含内部剪辑描述
- 镜内多剪辑时用：`镜头1（0–5s）… 剪到（5–10s）… 剪到（10–15s）…`
- 每镜必须含：
  - 场景（元素 ID）
  - 故事内容（动作 + 确切台词 + 元素 ID）
  - 摄像机语言 + 关键帧引用（如 `构图参考 keyframe_02`）

### 独立音频

- 至少一条全局 BGM；有情绪变化则拆 `audio_id` 与范围
- 旁白/对话进 `audio_layers`（type=`narration`），写清内容、声线、时间范围

---

## 4) 媒体生成（Codex）

### 元素出图

使用 Codex 内置 `image_gen` 工具，走当前 Codex 订阅的 Image-2 通道。不要用 shell、API/CLI 或 `grok-imagine-generator --type image` 代替。

执行规则：

- 全新图片：直接调用 `image_gen`，不传参考图参数。
- 本地参考图：先用 `view_image` 检查；目标图都有本地路径时，用 `referenced_image_paths` 传给 `image_gen`。
- 仅存在于当前对话的附件/最近生成图：用最小必要的 `num_last_images_to_include`。
- 多张不同元素图或关键帧图：每个资产分别调用一次 `image_gen`，不要把多个不同资产当成同一提示词的 variants。
- 生成后先审图；项目资产再复制到 `<project>/elements` 或项目关键帧目录，并报告最终路径。
- 内置生图失败时，不要静默切换到 API/CLI、Gemini 或 Grok，也不要索要 `OPENAI_API_KEY`。

规则：

- 用户已给图 → 直接绑定，不重画
- 角色优先多视图（正/侧/背）分别生成，保证跨镜一致
- 同角色多状态：先出主视图，再在 prompt 中强锚定同一身份特征

### 镜头视频（替换 MultiModalToVideo）

调用 `$runninghub-seedance-video`，使用其 `estimate → 用户确认费用 → submit → status/download` 固定流程。不要跳过价格预估直接调用模型接口。

参数约定：

- 时长 4–15 秒，跟故事板镜头长度一致
- 画幅跟 `Final_Video_Spec`
- 图片最多 9 张、视频最多 3 段、音频最多 3 段
- 输出目录使用 `<project>/shots`，并保留 plan/job JSON 防止重复提交

多模态 prompt 锚定顺序：

1. 先上传并编号元素图、关键帧、动作参考视频和音频。
2. 在 prompt 中逐一写 `@Image N` / `@Video N` / `@Audio N`，不得传入却不引用。
3. 再按 Seedance 顺序写运动：摄像机 → 主体 → 空间 → 音频约束。
4. 独立旁白/BGM 时关闭原生音频；需要原生对白或环境声时显式开启。

提交前必须向用户展示 RunningHub 返回的预计费用；用户明确确认后才生成，不批量自动续单。

### 旁白 / BGM

- 旁白：按分镜文本与声线；可后接中文 TTS（豆包等）或英文 elevenlabs（外部）
- BGM：风格对齐参考片；时间范围跟 audio_layers
- 合成时：若镜头无需要的对白，**静音镜头内嵌音频**，只用独立音频层

---

## 5) 提示词规则（保留原 SOP 精神）

### 语言

- 用户中文环境：组织说明用中文
- **图像/视频生成 prompt**：可用中文写主体与动作；风格锚点可用专业英文术语混写
- 旁白/对话内容语言严格跟 `Final_Video_Spec.Output Language`

### 图像 prompt

像导演+调色师下指令：

- 只写可见内容，不写内心戏解释
- 融合：专业风格术语、取景镜头、光线（含负向补光/对比）、克制调色、渲染质感、情绪微表情
- 主色调克制（约 90% 单一主调），避免无意义霓虹红蓝对冲

关键元素 prompt：身份 + 必须跨镜一致的细节 + 情绪基调。  
关键帧 prompt：只冻结那一瞬间（起/终/高光）。

### 视频 prompt 顺序

1. 摄像机（运动/剪辑）
2. 主体（动作与表情，含身体部位与幅度）
3. 空间（位置/环境变化）
4. 音频约束（独立旁白则不要写旁白文本；默认 `no music`；`no subtitles`）

多节拍可用 `Shot1 / Shot2 / cut to`，**不要**强行精确到「第 2.0 秒」这种不可靠时钟。

可选包装（若需要模型区分）：

- 音乐：`( ... )` —— 模板复刻默认不用，改独立 BGM
- 音效：`<...>`
- 对话：`{...}`
- 屏上文字：`【...】`

---

## 6) 合成

按分镜时间轴组装镜头 + 旁白 + BGM。  
推荐：

- 剪映 / 达芬奇：人工精修
- 或 ffmpeg 按 shot list 顺序拼接后铺音轨

交付清单：

- `Final_Video_Spec.md`
- `storyboard.md`
- `elements/`
- `shots/`
- `audio/`
- 最终成片路径

---

## 阶段确认话术（简版）

每阶段结束只问一件事，例如：

1. 「拉片与关键帧是否 OK？要改哪几段？」
2. 「Final Spec 是否确认？（比例/时长/风格/替换内容）」
3. 「分镜与可替换槽位是否确认？」
4. 「元素定妆图是否通过？」
5. 「先出 1–2 个试点镜头，通过后再批量。」
6. 「音频层是否确认？然后合成。」

---

## 项目目录建议

```text
<project>/
  Final_Video_Spec.md
  analysis_shots.md
  storyboard.md
  elements/
  keyframes_notes.md
  shots/
  audio/
  export/
```

---

## 失败降级

| 情况 | 处理 |
|---|---|
| `image_gen` 网络错误或不可用 | 最多重试 1 次；仍失败就停止并报告，不切换 API/CLI/Gemini/Grok，不索要 API Key |
| RunningHub Key 类型不支持 | 停止并提示确认企业级-共享 API Key；不要让用户把 Key 发到聊天中 |
| RunningHub 上传/预估失败 | 保留错误，不提交任务；确认没有 `taskId` 后才重试 |
| 已获得 `taskId` 后查询中断 | 用 job JSON 恢复查询，禁止重新提交同一镜头 |
| 15s 生成失败 / 质量崩 | 改 10s，再不行 4–5s，并拆子镜；重新预估费用并确认 |
| 角色跨镜漂 | 回元素图，强化身份锚点，重做失败镜 |
| 动作过复杂 | 拆 Shot1/Shot2，降低单镜信息密度 |
| 用户要像素级克隆 | 明确做不到；改回模板复刻目标 |

## 不要做的事

- 不要跳过阶段确认一口气全生成
- 不要把 MultiModalToVideo 当成真实二进制/API 名去找
- 不要把 Codex 生图切到 API/CLI、Gemini、Grok 或 Veo，除非用户明确改口
- 不要为内置订阅生图请求 `OPENAI_API_KEY`
- 不要绕过 RunningHub 价格预估和用户费用确认
- 不要在已有 `taskId` 时因轮询中断而重复提交
- 不要声称像素级 1:1 复刻

## 来源

- 流程基础：阶段式视频模板复刻 SOP（本仓库公开版）
- 图像执行：Codex 内置 `image_gen`（订阅 Image-2）
- 视频执行：`$runninghub-seedance-video` → RunningHub Seedance 2.0 多模态视频
- 视频接口：`/openapi/v2/rhart-video/sparkvideo-2.0/multimodal-video`
