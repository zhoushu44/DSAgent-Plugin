---
name: keyword-pick
description: "关键词列表按轮次取词：把逗号分隔的关键词串按 index 取第 N 个，输出给下游步骤。工作流批量循环时用，保证每一轮处理**不同**的关键词而不是同一个词重复采。触发：按轮次取词、关键词分轮、批量工作流取词、keyword index。纯计算技能，不联网、不占浏览器、无副作用。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "关键词按轮次取词"
    emoji: "🔑"
    requires: {}
disable-model-invocation: false
---

# 关键词按轮次取词

工作流 `mode: batch` 时，引擎每轮只递增 `{{loop.index}}`，**输入变量本身不会变**。
所以一行写多个关键词 + 绑定 `{{loop.index}}`，必须有一个纯计算步骤把它切成当轮那一个词 —— 否则循环 N 轮就是同一个词采 N 次。

## 工作流

1. 读入 `--keywords`（逗号 / 顿号 / 换行 / 竖线分隔都认）与 `--index`（从 1 开始）
2. 去掉空白项与重复项（保序，首个位置为准）
3. 按 `index` 取词；`index` 超过列表长度时**回绕**（取模），保证轮次多于词数时仍有产出
4. 输出结构化结果：`keyword` 为当轮关键词，另附 `index` / `total` / `all` 便于排查

展开示例：

| index | keywords | 输出 keyword |
|---|---|---|
| 1 | Kimi K3, DeepSeek API, GLM API | Kimi K3 |
| 2 | Kimi K3, DeepSeek API, GLM API | DeepSeek API |
| 4 | Kimi K3, DeepSeek API, GLM API | Kimi K3（回绕） |

## 错误处理

- `--keywords` 为空 → 结构化失败输出 `failure_kind: skill_error`，退出码 1
- `--index` 非数字或 < 1 → 按 1 处理（宽松，不让拼写问题废掉整轮）
- 输出走 `__DSAGENT_RESULT__` 单行协议，进度日志走 stderr，不与 stdout 混

## 用法

```bash
python3 {baseDir}/scripts/pick.py --keywords "Kimi K3,DeepSeek API,GLM API" --index 1
```

## 边界

- 不做关键词研究、不做搜索量估算 —— 选词请用 `keyword-assistant` / `xianyu-crawl` 实测想要数
- 不联网、不读写业务文件，只做字符串切分
