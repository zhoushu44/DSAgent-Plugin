---
name: skill-creator
description: "DeepSeek Agent 技能创建指南。当用户想创建或更新 Skill、扩展 Agent 的专业能力时使用。触发词：创建 skill、新建技能、skill-creator、更新 skill、写 SKILL.md、把工作流变成 skill。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "技能创建"
    emoji: "🛠️"
    requires: {}
---

> **DeepSeek Agent 说明：** 所有 `scripts/` 路径均相对于此技能目录。
> 运行：`cd {this_skill_dir} && python scripts/...`
> 用户技能目录：`~/.DeepSeek Agent/users/{uid}/workspaces/{aid}/skills/`。
> 若要把**当前对话**快速沉淀为 skill，优先使用内置 `make-skill`（`/make-skill` + `materialize_skill`）。

# Skill Creator（技能创建指南）

本技能指导你在 DeepSeek Agent 中创建有效的 workspace skill。

## 关于 Skill

Skill 是可复用的模块化目录，为 DeepSeek Agent Agent 提供专业知识、工作流和工具集成，
把通用 Agent 变成领域专家。

### Skill 能提供什么

1. **专用工作流** — 特定领域的多步骤流程
2. **工具集成** — 文件格式、API、CLI 的使用说明
3. **领域知识** — Schema、业务逻辑、公司规范
4. **捆绑资源** — 脚本、参考文档、模板等

## 核心原则

### 精简至上

Skill 与系统提示、对话历史、其他 skill 元数据共享上下文窗口。只补充 Agent
原本不知道的信息，用简洁示例代替冗长解释。

### 自由度要匹配任务

- **高自由度（文字说明）：** 多种做法都合理、依赖上下文
- **中自由度（带参脚本）：** 有推荐模式但允许变化
- **低自由度（固定脚本）：**  fragile 操作、必须严格按序执行

### Skill 结构

```
skill-name/
├── SKILL.md（必填）
│   ├── YAML frontmatter（name + description 必填）
│   └── Markdown 正文
└── 可选资源
    ├── scripts/       — 可执行代码
    ├── references/    — 按需加载的文档
    └── assets/        — 模板、图标、字体等产出资源
```

格式细节见 [skill_format.md](references/skill_format.md)。

#### SKILL.md

- **Frontmatter：** `name` 与 `description`；**description 是主要触发信号**，所有「何时使用」信息写在这里，不要写在正文。
- **正文：** 仅在 skill 触发后加载。

#### 捆绑资源

- **scripts/** — 确定性或可重复执行的代码，可不读入上下文直接运行
- **references/** — 详细文档，按需加载，保持 SKILL.md 精简
- **assets/** — 产出用资源，不读入上下文

**不要包含：** README.md、CHANGELOG.md 等与 Agent 执行无关的辅助文档。

### 渐进式披露

1. **元数据**（name + description）— 始终在上下文中（约 100 词）
2. **SKILL.md 正文** — 触发后加载（<5000 词）
3. **捆绑资源** — 按需（脚本可执行而不全文加载）

SKILL.md 建议控制在约 500 行以内；超出则拆到 `references/` 并在正文注明何时阅读。

## 创建流程

1. 用具体例子理解 skill 用途
2. 规划可复用内容（scripts、references、assets）
3. 初始化目录（`init_skill.py`）
4. 编辑资源与 SKILL.md
5. 校验（`quick_validate.py`）
6. 在控制台 → 技能 中启用，或编辑 `skill.json`
7. 根据实际使用迭代

### 命名规则

- 仅小写字母、数字、连字符；最长 64 字符
- 优先简短、动词开头（`pdf-merge`、`deploy-aws`）
- 目录名须与 frontmatter 的 `name` 一致

### 步骤 1：用具体例子理解需求

适度询问使用场景和触发短语。功能清晰后即可进入下一步。

用户未指定路径时，默认：

```
~/.DeepSeek Agent/users/{uid}/workspaces/{aid}/skills/
```

### 步骤 2：规划可复用内容

对每个例子，分析重复执行时哪些脚本、参考文档或资源最有帮助。

### 步骤 3：初始化 Skill

若 skill 已存在则跳过。否则运行：

```bash
cd {this_skill_dir}
python scripts/init_skill.py <skill-name> \
  --path ~/.DeepSeek Agent/users/{uid}/workspaces/{aid}/skills \
  [--resources scripts,references,assets] [--examples]
```

脚本会创建目录、SKILL.md 模板及可选资源文件夹。

### 步骤 4：编辑 Skill

为「另一个 Agent 实例」而写，包含非显而易见的流程知识。

**Frontmatter：**
- `description` 须涵盖做什么 + 何时触发（短语、文件类型、场景）
- 可选 `metadata.requires.bins` / `metadata.requires.env` 声明依赖

**正文：** 祈使句。引用 scripts/references 时说明何时阅读。

### 步骤 5：校验

```bash
cd {this_skill_dir}
python scripts/quick_validate.py /path/to/skill-folder
```

修复问题后重新运行。

### 步骤 6：启用与迭代

- 手动创建的 skill 在 `skill.json` 中默认**禁用** — 需在控制台或 CLI 启用
- 内置 skill 从打包源码自动 sync
- 用真实任务测试；若触发不足则加强 description

## skill-creator 与 make-skill 的区别

| 目标 | 使用 |
|------|------|
| 通用 skill 设计方法论 | **skill-creator**（本技能） |
| 把当前对话变成 skill | **make-skill**（`/make-skill`、`materialize_skill`） |
| 导入已有 skill 包 | 控制台 → 技能 → 安装技能（ZIP） |
| 随安装包分发 | 放入 `skills/{name}-en/` 与 `{name}-zh/` |

## 快速参考

```bash
# 初始化
python scripts/init_skill.py my-skill --path <workspace>/skills --resources scripts

# 校验
python scripts/quick_validate.py <workspace>/skills/my-skill
```

格式细节：[references/skill_format.md](references/skill_format.md)
