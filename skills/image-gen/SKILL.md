---
name: image-gen
description: "AI 出图执行层：把提示词真正变成图片文件。接 NewAPI 网关（gpt-image-2.5），支持文生图、图生图（参考图）、批量逐屏生成、透明底、多尺寸档。触发：生图、出图、生成图片、画一张、改图、图生图、白底图、主图、详情页出图、批量出图、image generate、render。排除：提示词怎么写与平台合规（用 image-prompt-guide）、纯排版合成图（PIL 代码绘制，如 xianyu-listing-prep）。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "AI 出图执行"
    emoji: "🖼️"
    requires:
      bins: [python3]
---

# AI 出图执行层

把提示词变成真实图片文件。**本技能只负责出图与落盘**，不管提示词策略和平台合规——那两条归 `image-prompt-guide`。

## 前置条件

- Python 3（宿主自带即可，**无需 pip 装 requests**，脚本纯标准库 + Pillow）
- 网关可达：`http://45.205.27.41:3001/v1`（实测直连，绕开系统代理）
- 有效 key，放环境变量 `NEWAPI_KEY`
- Pillow 仅透明底后处理需要；缺失时该步骤会被跳过，不影响出图

先跑一次 `probe` 确认网关与模型都在，再批量跑：

```bash
python3 {baseDir}/scripts/gen.py probe
```

## 工作流

1. **确认分工**：没有成品提示词 → 先走 `image-prompt-guide`；已有提示词 → 直接本技能
2. **probe**：确认 `model_present: true`，避免拿错 model 白跑
3. **单张直出**：`generate`（文生图）或 `edit`（有参考图，必须用 edit，保真度高）
4. **批量**：把每屏/每槽写成一个 plan item，一次性 `batch`；单项失败不中断
5. **核对产物**：读 `files` 拿路径，看 `usage.total_tokens` 确认真的出了图（不是空响应）
6. **透明底**：带 `--background transparent` 会自动产出 `*-alpha.png`，用 `alpha_files` 里的路径
7. **交付/上架**：出图后要发布走对应平台发布技能

## 错误处理

| 现象 | 原因 | 处理 |
|---|---|---|
| `连接失败` + `拒绝连接 127.0.0.1:8888` | 系统代理劫持 | 脚本已强制 `ProxyHandler({})`；若仍报，检查本机是否有透明代理 |
| `HTTP 401` | key 错或过期 | 重新向用户确认 key，不要重试同一 key |
| `HTTP 404` + `model_not_found` | model 名不对 | 先跑 `probe`，从 `image_models` 里选 |
| 响应无 `url` 也无 `b64_json` | 网关未返回图（多因 prompt 被拒或额度不足） | 打印完整响应原文给用户，不要静默失败 |
| 出了图但 `mode` 是 RGB 不是 RGBA | 网关吞掉 alpha | 用自动生成的 `*-alpha.png`，不要用原图当透明底 |
| `size` 传了非 16 倍数 | 工具限制 | 脚本会等比修正并保留比例；回报里看实际尺寸 |
| 单张跑很久 | 出图本身慢（1K 约 20–60s，2K 更久） | 交给后台任务，不要重复提交 |

## 分工（重要）

| 层 | 谁负责 |
|---|---|
| 场景路由、提示词组装、平台规格与合规红线、出图后保真核对 | `image-prompt-guide` |
| 调网关、传参、下载图片、按名字落盘、批量并发控制 | **本技能** |

标准链路：先用 `image-prompt-guide` 产出成品提示词 → 再用本技能执行。

## 什么时候直接用本技能

- 已有明确提示词，只想出图
- 要批量跑一组（主图套图、PDP 逐屏）
- 要图生图（拿实拍图当参考，改背景 / 换场景）

## 什么时候必须先走 image-prompt-guide

- 用户说"做主图/详情页/白底图/SKU 图"但没给提示词
- 涉及平台规格与合规（1688/淘宝/天猫/抖音/京东/拼多多/Amazon 等）
- 需要保真（不能改商品本身）—— 那边有 Identity Match 条款和 Result Check

## 运行

```bash
# 探测（确认网关、模型可用）
python3 {baseDir}/scripts/gen.py --mode probe

# 文生图
python3 {baseDir}/scripts/gen.py --mode generate \
  --prompt "..." --size 1024x1024 --out ./out --name main01

# 图生图（参考图可多张）
python3 {baseDir}/scripts/gen.py --mode edit \
  --prompt "..." --ref ./实拍.png --out ./out --name hero

# 批量（套图 / PDP 逐屏）
python3 {baseDir}/scripts/gen.py --mode batch --plan ./plan.json --out ./out

# 长提示词：写进文件避免 shell 转义
python3 {baseDir}/scripts/gen.py --mode generate --prompt-file ./p1.txt --out ./out
```

> `--mode X` 与 `gen.py X` 两种写法都接受。**推荐 `--mode`** —— 宿主若按首条用例自动补子命令，显式 `--mode` 会优先生效。

## 参数

| 参数 | 说明 |
|---|---|
| `--mode` | `generate` / `edit` / `batch` / `probe` / `from-pack` |
| `--prompt` / `--prompt-file` | 二选一；长提示词用文件 |
| `--ref` | 参考图路径，可多次（= 多图参考） |
| `--size` | `1024x1024` / `1536x1024` / `1024x1536` / `2048x2048` / `auto`；非 16 倍数或面积越界会自动等比修正并回报 |
| `--n` | 每张提示词出几张，默认 1 |
| `--quality` | `low` / `medium` / `high` / `auto` |
| `--background` | `transparent`（自动补出 `*-alpha.png`）/ `opaque` / `auto` |
| `--out` | 输出目录，默认 `./image-gen-out` |
| `--name` | 文件名前缀，自动加时间戳与序号 |
| `--workers` | batch / from-pack 并发线程数，默认 8 |
| `--pack` | **from-pack**：1688 素材包目录（含 `product.json` + `src/`） |
| `--category` | **from-pack**：品类名（拼进 prompt），默认 `儿童睡衣` |
| `--base` / `--key` | 覆盖配置文件 |

## from-pack 模式（1688 素材包 → 整套 15 张）

```bash
python3 scripts/gen.py from-pack --pack <素材包> --out <输出目录> --workers 8 --category 儿童睡衣
```

**自动做的事**：

1. 读素材包 `product.json` + `src/` 原图
2. 组装 15 条 prompt：**主图 5 张**（白底/模特/面料/做工/多色）+ **详情 10 张**（参考布局：竖排大字标题 + 副题、模特居中、左下细节小图、底部英文卖点）
3. **双参考**：`src` 第 1 张锁款式配色 + 第 2 张锁模特脸部发型年龄（不人工挑，自动取）
4. 8 线程并发跑（15 张约 90 秒）
5. **顺手生成 `product.json`**（调 `build_product.py`，1688 真实 SKU + 属性别名 + 价格×系数），供 `pdd-publish-http --product-file` 直接上架

**batch 模式并发**：`--workers` 默认 8，15 张从串行 8 分钟降到 74 秒。

### batch 计划格式补充

```jsonc
{ "items": [
  { "out": "main_1.jpg", "refs": ["商品图.jpg", "模特图.jpg"], "prompt": "..." },
  { "out": "detail_1.jpg", "refs": ["...", "..."], "size": "1000x1849", "prompt": "..." }
]}
```

`refs` 传多张 = 多图参考（第 1 张锁商品、第 2 张锁模特）。

## 凭据配置

优先级：命令行 `--key` > 环境变量 > 配置文件。

配置文件（推荐，脚本自动读取，无需每次传参）：

```
~/.dsh/image-gen.local.json
{"base":"http://45.205.27.41:3001/v1","key":"<key>","model":"gpt-image-2.5"}
```

环境变量等价写法：`NEWAPI_BASE` / `NEWAPI_KEY` / `NEWAPI_IMAGE_MODEL`。

**key 不要写进 plan.json，也不要提交进仓库。**

## 批量计划格式

```json
{
  "items": [
    {"name": "01-hero",  "prompt": "...", "size": "1024x1024"},
    {"name": "02-scene", "prompt": "...", "size": "1536x1024", "ref": "./实拍.png"},
    {"name": "03-sku-red", "prompt": "...", "ref": "./实拍.png", "background": "transparent"},
    {"name": "04-long",  "prompt_file": "./p4.txt", "size": "1024x1536"}
  ]
}
```

单个 item 失败不会中断整批，末尾汇总 `ok: false` 的条目。

## 实测能力边界（2026-10-26）

| 项 | 实测结果 |
|---|---|
| `/v1/images/generations` | ✅ 通 |
| `/v1/images/edits`（multipart 单图/多图参考） | ✅ 通，`input_tokens.image_tokens≈1659` 证明确实读了参考图 |
| `size` | ✅ `1024x1024` / `1536x1024` / `1024x1536` / `2048x2048` / `auto` 全通 |
| `quality` | ✅ `low` / `high` 均被接受 |
| `background=transparent` | ⚠️ 网关接受但**返回 RGB，alpha 被丢**；脚本本地补抠图，产出 `*-alpha.png`（已验证 RGBA、角部 alpha=0） |
| `moderation=low` | ✅ 被接受（非标准参数，网关透传） |
| 返回形态 | 远端 URL，脚本自动下载并按 magic 修正扩展名 |
| 网络 | 网关**直连可达**；脚本已 `ProxyHandler({})` 强制绕开系统代理（本机 127.0.0.1:8888 对该网关拒绝连接） |
| 依赖 | 纯标准库；仅透明底后处理需要 Pillow |
| 耗时 | 1K 约 25–60s，2K 更久 —— 脚本每 8s 吐心跳，防止宿主 idle 超时 |

## 边界

- 不编造商品事实（尺寸、材质、认证、功效）—— 提示词里出现的事实必须来自用户或实拍图
- 不替代 `image-prompt-guide` 的合规判断
- 不负责平台发布；出完图要上架走对应平台发布技能
