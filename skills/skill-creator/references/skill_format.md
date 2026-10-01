# QIWork Skill 格式参考

## 目录结构

```
my-skill/
├── SKILL.md          （必填）
├── scripts/          （可选 — 可执行脚本）
├── references/       （可选 — 按需加载的文档）
└── assets/           （可选 — 模板、图片、字体等产出资源）
```

QIWork **不需要** Codex 风格的 `agents/openai.yaml`。UI 元数据来自
`SKILL.md` frontmatter 和 `skill.json`。

## SKILL.md frontmatter

必填字段：

```yaml
---
name: my-skill
description: "技能做什么、何时触发。所有触发短语写在这里。"
metadata:
  requires:
    bins: [ffmpeg]          # 可选 — 外部二进制依赖
    env: [MY_API_KEY]       # 可选 — 所需环境变量
---
```

**内置技能**（随 QIWork 打包）还需：

```yaml
metadata:
  builtin_skill_version: "1.0"
  qiwork:
    emoji: "🛠️"
    requires: {}
```

## 技能存放位置

| 类型 | 路径 |
|------|------|
| 用户技能 | `~/.QIWork/users/{uid}/workspaces/{aid}/skills/{name}/` |
| 内置（源码） | `src/qiwork/agents/skills/{name}-en/` 与 `{name}-zh/` |
| 清单 | `~/.QIWork/users/{uid}/workspaces/{aid}/skill.json` |

内置技能自动 sync；用户技能可通过控制台、ZIP 导入、`materialize_skill`（见 `make-skill`）或手动创建。

## 命名规则

- 仅小写字母、数字、连字符（`my-skill`，不要 `My Skill`）
- 最长 64 字符
- 目录名须与 frontmatter 的 `name` 一致
- 内置变体：`{name}-en` / `{name}-zh`（canonical ID 为 `{name}`）

## 校验

```bash
cd {this_skill_dir} && python scripts/quick_validate.py /path/to/skill-folder
```
