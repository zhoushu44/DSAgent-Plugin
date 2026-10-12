---
name: file_reader
description: "仅用于读取和总结文本类文件。文本格式优先使用 read_file；需要做类型探测时使用 execute_shell_command。PDF、Office、图片和压缩包由其他技能处理。"
metadata:
  builtin_skill_version: "1.2"
  dsagent:
    display_name: "文件读取器"
    emoji: "📄"
    requires: {}
---
# 文件读取工具箱

当用户要求读取或总结本地文本文件时使用此技能。PDF、Office 文档、图片、音频和视频不在此技能范围内，应由其专用技能/工具处理。

## 快速类型检查

读取前先进行类型探测:

```bash
file -b --mime-type "/path/to/file"
```

如果文件较大，避免输出全部内容；提取小部分相关内容并进行总结。

## 文本文件（使用 read_file）

适用于: `.txt`、`.md`、`.json`、`.yaml/.yml`、`.csv/.tsv`、`.log`、`.sql`、`ini`、`toml`、`py`、`js`、`html`、`xml` 源代码。

步骤:

1. 使用 `read_file` 获取内容。
2. 总结关键部分或展示用户请求的相关片段。
3. 对于 JSON/YAML，列出顶层键和重要字段。
4. 对于 CSV/TSV，展示表头和前几行，然后总结各列。

## 大型日志文件

如果文件很大，使用 tail 窗口:

```bash
tail -n 200 "/path/to/file.log"
```

总结最近的错误/警告和值得注意的模式。

## 超出范围

以下内容不在此技能中处理（由其他技能负责）:

- PDF
- Office (docx/xlsx/pptx)
- 图片
- 音频/视频

## 安全与行为规范

- 绝不执行不可信的文件。
- 优先读取所需的最小部分。
- 如果缺少所需工具，说明限制并请用户提供其他格式。

## 工作流

1. 用 `file -b --mime-type` 探测文件类型
2. 若为文本格式（txt/md/json/yaml/csv/log/sql 等），使用 `read_file` 读取
3. 若文件较大，用 `tail -n 200` 提取尾部内容
4. 对 JSON/YAML 列出顶层键和重要字段
5. 对 CSV/TSV 展示表头和前几行，总结各列
6. 总结关键部分或展示用户请求的相关片段

## 错误处理

- 遇到不支持的文件类型（PDF/Office/图片/音频视频），告知用户应由专用技能处理
- 缺少所需工具时说明限制并请用户提供其他格式
- 文件过大时优先读取最小所需部分，避免输出全部内容

## 前置条件

- 目标文件路径存在且可读
- 文件类型为文本类格式（.txt/.md/.json/.yaml/.csv/.log/.sql 等）
- 大型日志文件需 `tail` 命令可用
