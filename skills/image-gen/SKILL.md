---
name: image-gen
description: "AI 出图（合并版）：提示词与出图在同一个技能里完成，提示词原样透传、不做校验、不做预览，一次性全并发（默认 200 路）出完整套图。触发：生图、出图、主图、详情页、套图、批量出图、改图、图生图、白底图、场景图、电商图片、image generate、render。"
metadata:
  builtin_skill_version: "2.0"
  dsagent:
    display_name: "AI 出图（合并·全并发）"
    emoji: "🖼️"
    requires:
      bins: [python3]
---

# AI 出图（合并版）

提示词和出图在同一个技能里。**不再拆成两个技能，不再做任何校验。**

## 三条硬规则

1. **提示词原样透传** —— 写什么发什么。不重写、不套模板、不加块标签、不做 Prompt-Intent Gate、不询问确认。
2. **不校验** —— 不做出图前检查、不做出图后 Result Check、不自动重试重画（只做网络层重试）、不拦截"可能不合格"的图。
3. **一次性全并发 + 不等** —— 所有条目同时发射，默认 `--workers 200`。**起后台任务后立刻去做排版，不要轮询、不要中途读图、不要等出完才动手。**

> 第 3 条里的"不等"是等时间的一半来源。出图和排版必须并行：先发图，再写排版脚本，图回来直接渲染。

## Preconditions

- Python 3（脚本纯标准库，不需要 pip 装包）
- 网关可达：`http://45.205.27.41:3001/v1`
- key 在 `~/.dsh/image-gen.local.json`：`{"base":"...","key":"...","model":"gpt-image-2.5-2k"}`

## 执行入口（宿主按「脚本型」调用本技能）

宿主靠 SKILL.md 里带 `{baseDir}` 占位符的命令行判断技能能不能被执行。
**下面第一行就是本技能的可执行入口**（from-pack 模式：1688 素材包 → 15 张图 + product.json）：

```bash
# from-pack：素材包目录 → 主图 5 + 详情 10，并顺手产出 product.json（供 pdd-publish-http --product-file 用）
python {baseDir}/scripts/gen.py --mode from-pack --pack "<素材包目录>" --out "<输出目录>" --workers 8 --category 儿童睡衣

# 单张 / plan 批量
python {baseDir}/scripts/gen.py --prompt "<提示词>" --ref "<参考图路径>" --size 1024x1024 --name hero --out "./out"
```

⚠ 入口脚本改动必须同步这两行，否则技能会退化成「纯指令型」：
调用方只拿到这份文档、看起来调用成功，实际一张图都不出（工作流里则直接判该步骤不可用）。

## Workflow

1. **写 plan** —— 把每张图的 `name / prompt / size`（有参考图就加 `ref`）写成 `plan.json`。**size 一律 `1024x1024`（1K），不要写 2K/4K**。
2. **一次性发射** —— `python scripts/fanout.py --plan plan.json --out ./out --workers 200`。所有条目同时发，不等前一张。
3. **并发期间不等待** —— 起后台任务后**立刻**并行写排版脚本/准备文案，不要 `job_output(wait=true)` 反复轮询，也不要中途读图。
4. **读结果** —— stdout 的 JSON 里 `succeeded / failed / seconds / results[].files` 就是落盘路径，直接交付。

单张：`python scripts/fanout.py --prompt "..." --size 1024x1024 --name hero`
带参考：`python scripts/fanout.py --prompt-file p.txt --ref ref.png --size 1024x1024 --name hero`

环境变量：`NEWAPI_IMAGE_MODEL`（默认 **gpt-image-2.5-1k**）、`IMAGEGEN_WORKERS`（默认 200）、`IMAGEGEN_TIMEOUT`（默认 900s）、`IMAGEGEN_RETRIES`（默认 2）。

> **默认 1K（1024×1024），这是硬规则。** 2K/4K 单张耗时 100–180 秒，1K 只要 25–60 秒；电商主图/详情屏最终交付尺寸 1200×1200 / 1440×2160，1K 放大后完全够用，且省掉一半以上等待。
> 只有用户明确要求 2K/4K 时才升级。

### plan.json

```json
{"items":[
  {"name":"01","prompt":"...","size":"2048x2048","quality":"high"},
  {"name":"02","prompt_file":"./p2.txt","ref":"ref.png","size":"2048x2048","quality":"high"},
  {"name":"03","prompt":"...","refs":["a.png","b.png"],"size":"1440x2160","quality":"high"}
]}
```

字段：`name` / `prompt` 或 `prompt_file` / `ref` 或 `refs` / `size` / `quality` / `background` / `n` / `model` / `retries`。
有 `ref` 走 `/images/edits`，无 `ref` 走 `/images/generations`。单条失败不影响整批。

## 模型与尺寸

可用：`gpt-image-2-1k` `gpt-image-2-2k` `gpt-image-2-4k` `gpt-image-2.5-1k` `gpt-image-2.5-2k` `gpt-image-2.5-4k`
**默认 `gpt-image-2.5-1k` + `1024x1024`。** 实测：1K 单张 25–60s，2K 100–180s。
交付尺寸 1200×1200 / 1440×2160 由 1K 底图 LANCZOS 放大 + 轻锐化达成，肉眼看不出差别。
只有用户明确说“要 2K/4K”才升级，别自作主张。

## 电商套图提示词要点（内联，不另开技能）

写 prompt 时按这套写，一次到位，不再二次校验：

- **身份锁**：`Keep the product identity unchanged — preserve geometry, proportions, color, material, texture, prints, logo, and on-product text.`
- **画面**：用途 / 主体数量 / 构图与占比 / 机位焦段 / 场景（6–9 个具名元素 + 材质 + 位置）/ 光线方向与阴影 / 材质与配色 / 风格（非 3D、非插画）
- **文字**：中文尽量**不要交给模型画**。需要字的图，只出**无字底图**，文案用 PIL 排（宋体标题 + 等线黑副文），中文才清晰可控。
- **合规**：不编造材质、尺寸、认证、功效、销量；不生成买家收不到的东西。

## 出图后

直接交付。**不做保真核对、不做文字回读、不自动返工。** 需要重画就改 prompt 再跑一次，或只重跑单条。

## 与旧版差异

| 项 | 旧 gen.py | 本版 fanout.py |
|---|---|---|
| 并发 | 默认 8，线程池 | 默认 **200**，一次性全发 |
| 提示词 | 可被 SKILL 模板重写 | **原样透传** |
| 校验 | Prompt Gate + Result Check | **无** |
| 技能数 | image-gen + image-prompt-guide 两个 | **一个** |
| 失败处理 | 中断/报错 | 网络层重试 2 次，其余照跑 |

`scripts/gen.py` 保留，仅作单张调试用。

## Pitfalls

| 现象 | 原因 | 处理 |
|---|---|---|
| `HTTP 400 ... cannot unmarshal string into Go struct field Alias.n` | `n` 必须传整数 | 已修：`n = int(item.get("n", 1))` |
| `HTTP 503 model_not_found` | 模型名不带分辨率后缀 | 用 `gpt-image-2.5-1k / -2k / -4k` |
| 输出扩展名是 `.png` 但实际是 JPEG | 网关返回 JPEG，脚本按 magic 落盘 | 正常，读图/上传都按内容识别 |
| 200 并发下大面积超时 | 网关限流 | 降到 50–80 重跑；失败的条目单独补跑即可 |
| 中文被画成乱码/错字 | 模型画字不可控 | 只出无字底图，文案用 PIL 排（本机有 simsun / msyh / simhei） |
