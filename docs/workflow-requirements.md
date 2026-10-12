# 工作流功能需求文档

> 版本：v1.1（含评审修订）  
> 日期：2026-10-11  
> 状态：待评审

---

## 一、概述

在 DSAgent 插件的中心面板中，现有「账号连接」和「DSAgent 技能」两个 Tab，新增第三个 Tab「工作流」。

工作流是一种**数据驱动的任务编排机制**：用户通过 YAML 模板定义工作流的输入字段和执行步骤，引擎按模板调度现有 Skill 完成批量自动化任务（如上架、视频生成、内容发布等）。

### 设计原则

1. **通用化**：不绑定特定业务（不只是上架），视频生成、内容发布、采集等均可通过模板定义
2. **数据驱动**：工作流 = YAML 模板文件，新增工作流不改代码
3. **复用现有体系**：执行步骤 = 调度已有 Skill，不引入新执行引擎
4. **简单可落地**：UI 用表单 + 列表，不依赖拖拽/画布库，与项目 HTML 模板 + 事件委托模式一致
5. **物理隔离**：代码集中 `src/workflow/` 独立文件夹，现有文件只加极少量入口代码；样式、数据、服务均与现有模块隔离，对现有功能零影响

---

## 二、Tab 结构

中心面板新增第三个 Tab「工作流」，内部包含两个子标签页：

```
┌─────────────────────────────────────────────────────────────┐
│ [账号连接] [DSAgent 技能] [工作流]                            │  ← 主 Tab 栏
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  [工作流任务]  [工作流编排]  [+ 新建] [导入]                    │  ← 子 Tab 栏
│                                                               │
│  ┌─ 选中"工作流任务" ──────────────────────────────────────┐  │
│  │  顶部配置区 + 筛选栏 + 任务列表                          │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─ 选中"工作流编排" ──────────────────────────────────────┐  │
│  │  工作流模板列表(左) + 编排编辑器(右)                      │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、子标签一：工作流任务

### 3.1 顶部配置区

用户在此选择工作流模板和输入参数，点击「开始批量运行」创建一条新任务。

| 控件 | 说明 |
|------|------|
| 工作流下拉框 | 选择预设工作流模板（从 `skills/workflows/` 目录扫描） |
| 账号下拉 | 选择要操作的目标店铺（从已连接账号列表读取） |
| 动态输入区 | 根据所选工作流模板的 `inputs` 定义自动渲染表单字段 |
| 开始批量运行 | 红色主按钮，点击触发任务创建 |

**动态输入区**根据模板 `inputs` 字段类型自动渲染：

| 字段类型 | UI 控件 | 示例 |
|----------|---------|------|
| `text` | 单行文本框 | 关键词输入 |
| `number` | 数字输入框 + 步进按钮 | 数量快速调整 |
| `textarea` | 多行文本框 | 商品描述、脚本内容 |
| `select` | 下拉选择框 | 店铺选择、平台选择 |
| `date` | 日期选择器 | 开始日期 |

切换工作流模板时，动态输入区重新渲染。

### 3.2 批量任务筛选栏

> 标题：批量任务  
> 小字：可组合筛选全部历史任务

| 筛选项 | 说明 |
|--------|------|
| 运行状态 | 下拉：全部状态 / 已完成 / 运行中 / 失败 / 排队 |
| 时间区间 | 开始日期 + 结束日期 |
| 店铺筛选 | 下拉：全部店铺 / 指定店铺（从已连接账号动态填充） |

### 3.3 批量任务列表

核心表格，展示所有历史任务记录：

| 字段 | 说明 | 示例 |
|------|------|------|
| 开始时间 | 任务启动的本地时间 | 2026-10-11 14:30:25 |
| 工作流 | 本次任务使用的工作流模板名称 | 1688找款式+上架 |
| 店铺 | 任务绑定的目标店铺，可选「未指定」 | 希音 4 店 |
| 输入 | 本次任务的输入摘要 | 关键词：连衣裙；数量：50 |
| 状态 | 任务整体状态 | 已完成 / 运行中 / 失败 / 排队 |
| 进度 | 成功数量 / 目标数量 + 失败数量 | 成功 50/50 · 失败 0 |
| 操作 | 查看详情、停止（仅运行中） | — |

**进度字段格式**：`成功 {success}/{target} · 失败 {failed}`  
其中 `target` = 工作流模板中 `count_input` 引用的输入字段值（批量循环次数）。

### 3.4 任务生命周期

```
用户选择工作流 + 店铺 + 输入参数
         │
         ▼
  点击【开始批量运行】
         │
         ▼
  新建一行任务记录，状态=排队
         │
         ▼
  引擎拾取任务，状态=运行中
         │
         ▼
  按模板 steps 串行执行每一轮
  （每轮内步骤串行，不同任务间并发）
         │
         ▼
  全部轮次完成 → 状态=已完成，回填成功/失败条数
```

- 历史任务永久保存，可筛选回溯查看
- 运行中的任务可点击「停止」中止

### 3.5 任务详情弹窗

点击列表「查看详情」打开 Modal（复用 `.dsa-mask` / `.dsa-modal` 组件）：

- **基本信息区**：工作流、店铺、输入参数（键值对）、状态、进度、开始/结束时间
- **轮次明细表**：每轮一行 —— 轮次号、状态徽标（成功=绿 / 失败=红）、耗时、失败原因（超长截断，悬停看全文）
- 数据来源：任务记录的 `rounds` 数组（见 7.2），成功与失败轮次均持久化

---

## 四、子标签二：工作流编排（影刀式变量管理）

### 4.0 核心理念：影刀式变量管理

借鉴影刀（YingDao）的变量管理模式，**用户不需要手打 `{{}}` 占位符**，而是通过可视化变量面板管理所有变量：

1. **变量面板**：统一管理所有变量（输入变量、循环变量、步骤输出变量），可添加/删除/选择类型
2. **步骤参数绑定**：步骤的每个参数从变量下拉中选择，不手打
3. **输出变量声明**：每个步骤声明输出变量名，自动注册到变量面板供后续步骤使用
4. **变量来源分三类**：输入变量（用户填）、循环变量（引擎生成）、步骤输出（上游产生）

### 4.1 布局

左侧为模板列表，中间为编排主区，右侧为变量面板（影刀风格三栏）。

```
┌─ 模板列表 ─┬─ 编排主区 ───────────────────────┬─ 变量面板 ──────┐
│            │                                    │                │
│ ▸ 1688上架 │  基本信息                          │  变量管理       │
│ ▸ 视频生成 │  ┌──────────────────────────────┐ │                │
│ ▸ 内容发布 │  │ 名称: [___________]          │ │  ▾ 输入变量    │
│ ▸ 藏色长裤 │  │ 分类: [内容发布 ▼]            │ │  keyword  文本 │
│            │  │ 执行模式: [批量循环 ▼]        │ │  count    数字 │
│ ─────────  │  │ 数量字段: [count ▼]           │ │  shop     下拉 │
│ [+ 新建]   │  └──────────────────────────────┘ │  [+ 添加变量]  │
│ [导入]     │                                    │                │
│            │  步骤列表                          │  ▾ 循环变量    │
│            │  ┌─ Step 1: 找款式 ────────────┐  │  loop.index    │
│            │  │ 调用技能: [pdd_crawl ▼]     │  │  loop.total    │
│            │  │ 参数:                       │  │  loop.round_ok │
│            │  │   keyword [keyword    ▼]   │  │                │
│            │  │   index   [loop.index ▼]   │  │  ▾ 步骤输出    │
│            │  │ 输出变量: [styles     ▼]   │  │  styles  找款式 │
│            │  │ 失败策略: [继续     ▼]     │  │  publish 上架  │
│            │  │ [↑][↓][✕]                  │  │  [+ 添加变量]  │
│            │  └──────────────────────────────┘  │                │
│            │  ┌─ Step 2: 上架 ──────────────┐  │  变量类型：     │
│            │  │ 调用技能: [pdd_publish ▼]   │  │  文本 / 数字   │
│            │  │ 参数:                       │  │  下拉 / 长文本  │
│            │  │   items [styles.results ▼] │  │  日期 / 对象   │
│            │  │   shop  [shop          ▼] │  │                │
│            │  │ 输出变量: [publish    ▼]   │  │  点击变量名     │
│            │  │ [↑][↓][✕]                  │  │  可编辑/删除    │
│            │  └──────────────────────────────┘  │                │
│            │  [+ 添加步骤]                     │                │
│            │                                    │                │
│            │  ┌─ YAML 预览（只读）──────────┐  │                │
│            │  │ name: 1688上架              │  │                │
│            │  │ ...                         │  │                │
│            │  └──────────────────────────────┘  │                │
│            │                                    │                │
│            │  [导出 YAML]  [保存]               │                │
└────────────┴────────────────────────────────────┴────────────────┘
```

### 4.2 基本信息

| 字段 | 类型 | 说明 |
|------|------|------|
| 名称 | 文本 | 工作流模板名称 |
| 分类 | 下拉 | 内容发布 / 视频生成 / 数据采集 / 店铺经营 / 自定义 |
| 执行模式 | 下拉 | `batch`（按数量循环）/ `single`（单次执行） |
| 数量字段 | 下拉 | 当执行模式为 batch 时，选择引用哪个输入变量作为循环次数 |

### 4.3 变量面板（影刀式）

右侧面板统一管理三种来源的变量：

#### 4.3.1 输入变量（用户自定义）

用户在此添加工作流需要的输入参数，等同于原"输入字段编辑"：

| 操作 | 说明 |
|------|------|
| 添加变量 | 点击 `[+ 添加变量]`，弹出表单填写变量名/类型/标签/默认值/选项 |
| 编辑变量 | 点击变量名，进入编辑状态 |
| 删除变量 | 点击变量行右侧 `✕` |
| 排序 | 变量行 `↑` `↓` 按钮调整顺序（影响顶部配置区的渲染顺序） |

每个变量定义：

| 属性 | 说明 | 示例 |
|------|------|------|
| 变量名 (key) | 英文标识符 | `keyword` |
| 标签 (label) | 显示名称 | `关键词` |
| 类型 | text / number / textarea / select / date | `text` |
| 默认值 | 可选 | `""` |
| 必填 | 是/否 | `true` |
| 选项 | 仅 select 类型，逗号分隔 | `希音4店,希音7店` |

#### 4.3.2 循环变量（引擎自动生成）

执行模式为 `batch` 时自动出现，不可编辑/删除：

| 变量名 | 含义 |
|--------|------|
| `loop.index` | 当前循环轮次（从 1 开始） |
| `loop.total` | 循环总次数 |
| `loop.round_ok` | 当前轮次是否成功（true/false） |

#### 4.3.3 步骤输出变量（步骤自动注册）

每个步骤声明的输出变量自动出现在此分组，供后续步骤的参数下拉选择：

| 变量名 | 来源步骤 | 可用字段 |
|--------|----------|----------|
| `styles.results` | Step 1: 找款式 | 步骤返回的对象/数组 |
| `styles.raw` | Step 1: 找款式 | 步骤返回的原始数据 |
| `publish.success` | Step 2: 上架 | 步骤返回的对象 |

> 步骤输出变量的可用字段：技能 contract.json 声明了 `output.fields` 时，下拉展示真实字段名；未声明的提供通用 `.results` 和 `.raw` 兜底。

### 4.4 步骤列表编辑

可增删、可上下排序，每个步骤定义：

| 字段 | 类型 | 说明 |
|------|------|------|
| 步骤名称 | 文本 | 如「找款式」「上架」 |
| 调用技能 | 下拉 | 从现有 Skill 列表读取（复用 skill-service），**过滤掉 instructions 型技能**（纯指令型只给 LLM 看，引擎无法直接执行） |
| 参数 | 变量绑定列表 | 参数名优先读技能 contract.json 的 `input.args`（name/type/required）；无契约的技能自由填 key。**每个参数值从变量下拉选择**，不手打 `{{}}`（见下方） |
| 输出变量 | 下拉/输入 | **自动生成默认名** `step1`、`step2`…（按步骤序号递增），用户可改；当前步骤结果存入此变量，自动注册到变量面板的"步骤输出" |
| 失败策略 | 下拉（折叠在「高级」区） | 默认 `continue`（继续下一轮），可改 `abort`（停止整个任务）；折叠进步骤卡片底部的「高级」折叠项，90% 场景无需展开 |

**易用性设计**：
- **新建模板给最小骨架**：新建时预置 1 个输入变量（`keyword` 文本）+ 1 个步骤（输出变量 `step1`），照着改比从零填快
- **输出变量名自动生成**：添加步骤时自动填 `stepN`（跳过重名），避免用户起名负担
- **失败策略默认「继续」**：最常用值作默认，且收进折叠区减少视觉噪音

**参数绑定方式（影刀式）**：

每个参数一行，左侧为参数名（来自技能的参数定义），右侧为变量下拉框：

```
┌─ Step 1: 找款式 ──────────────────────────┐
│  调用技能: [pdd_crawl        ▼]            │
│                                           │
│  参数绑定:                                 │
│  ┌────────────┬─────────────────────────┐ │
│  │ keyword    │ [▾ 输入变量: keyword]   │ │  ← 从变量面板下拉选择
│  │ index      │ [▾ 循环变量: loop.index]│ │  ← 自动列出可用变量
│  └────────────┴─────────────────────────┘ │
│  [+ 添加参数]                              │
│                                           │
│  输出变量: [styles          ▼]            │  ← 输出到变量面板
│  失败策略: [继续            ▼]            │
│  [↑ 上移] [↓ 下移] [✕ 删除]              │
└───────────────────────────────────────────┘
```

变量下拉框按分组排列，显示来源标签：

```
┌─────────────────────────────┐
│  输入变量                    │
│   keyword   (文本)          │
│   count     (数字)          │
│   shop      (下拉)          │
│  循环变量                    │
│   loop.index (数字)         │
│   loop.total (数字)         │
│  步骤输出                    │
│   styles.results (对象)     │
│   styles.raw     (对象)     │
│ ─────────────────           │
│  ✎ 自定义常量...             │  ← 也可手动输入固定值
└─────────────────────────────┘
```

> 也支持直接输入固定值（不引用变量），通过下拉底部的"自定义常量"切换为文本输入框。

### 4.5 YAML 预览与导入导出

- **YAML 预览**（只读）：编辑器底部实时显示当前编排对应的 YAML 内容，变量引用自动生成 `{{}}` 语法
- **导出 YAML**：下载为 `.yaml` 文件到 `skills/workflows/` 目录
- **导入 YAML**：上传 `.yaml` 文件，编辑器加载内容并自动解析变量到变量面板
- **保存**：写入 `skills/workflows/{name}.yaml`，模板列表即时刷新

---

## 五、YAML 模板规范

### 5.1 完整示例

```yaml
# 基本信息
name: 1688找款式+上架
category: 内容发布
mode: batch              # batch=按数量循环 / single=单次执行
count_input: count       # 引用哪个输入字段作为循环次数（仅 batch 模式）
description: 根据关键词在1688找款式并批量上架

# 输入字段定义
inputs:
  - key: keyword
    label: 关键词
    type: text
    required: true
    default: ""
  - key: count
    label: 数量
    type: number
    required: true
    default: 10
    min: 1
    max: 100
  - key: shop
    label: 店铺
    type: select
    required: true
    options:
      - 希音4店
      - 希音7店
      - 希音8店
  - key: description
    label: 商品描述
    type: textarea
    required: false
    default: ""

# 执行步骤
steps:
  - name: 找款式
    skill: pdd_crawl            # 技能 id（有 contract.json 的契约技能优先）
    args:
      keyword: "{{keyword}}"
      index: "{{loop.index}}"
    output: styles
    on_failure: continue

  - name: 上架
    skill: pdd_publish
    args:
      items: "{{styles.results}}"
      shop: "{{shop}}"
    output: publish_result
    on_failure: continue

  - name: 记录结果
    skill: log_result
    args:
      success: "{{publish_result.success}}"
      index: "{{loop.index}}"
    on_failure: continue
```

**step.args 的执行映射**（引擎内部行为，用户无感）：

| 技能形态 | args 处理方式 |
|----------|--------------|
| 有 contract.json（契约技能） | args 键值按契约参数表顺序展平为 `explicitArgs: string[]`，`fromContract: true` 传 executeSkillCore |
| 无契约技能 | args 拼为 requestStr 传 executeSkillCore（`request` 参数），引擎跳过契约路径 |

### 5.2 变量引用规则

| 变量 | 含义 | 示例 |
|------|------|------|
| `{{input_key}}` | 引用用户输入的字段值 | `{{keyword}}` → "连衣裙" |
| `{{loop.index}}` | 当前循环轮次（从1开始） | 第3轮 → 3 |
| `{{loop.total}}` | 循环总次数 | 50 |
| `{{step_name.output_field}}` | 引用某步骤的输出字段 | `{{styles.results}}` |
| `{{step_name.raw}}` | 引用某步骤的完整原始输出 | `{{styles.raw}}` |

### 5.3 执行逻辑

```
mode: batch →
  for i in 1..count:
    for step in steps:
      渲染参数 (替换 {{}} 变量)
      调用 step.skill (传入渲染后的参数)
      存储结果到 step.output 变量
      失败 → 按 on_failure 策略处理
    更新进度 (success/failed + 1)

mode: single →
  for step in steps:
    渲染参数
    调用 step.skill
    存储结果
    失败 → 按 on_failure 策略处理
```

- **同一任务内部串行**：每轮的步骤按序执行，第 N 轮全部完成后才进入第 N+1 轮
- **不同任务之间并发，浏览器互斥**：不同任务可同时运行，但**浏览器自动化类技能共享全局单例浏览器，必须互斥**——用全局浏览器锁排队，同一时刻只有一个浏览器步骤在执行；纯计算类步骤（无浏览器）不受限
- 某轮某步失败 → 按 `on_failure` 策略：`continue` 跳到下一轮 / `abort` 停止整个任务
- **停止机制**：stopTask 置 `stopRequested` 标志，当前步骤跑完后停止（不强杀子进程，避免半成品状态）；停止后状态置 `stopped`
- **重启对账**：插件启动时扫描 workflow-tasks.json，孤儿 `running`/`queued` 任务一律标记 `failed`，error 写「插件重启，任务中断」

### 5.4 技能调用链（复用 executeSkillCore，P0）

执行引擎**不直接调 `skill.run()`**——那只做 spawn，不带账号注入。平台类技能会全部拿不到 Cookie。必须复用 [index.ts 的 executeSkillCore](../src/index.ts) 完整链路：

```
executeSkillCore
├── 平台解析 requiredPlatform(skillId)
├── fetchBindingContext → 未绑定拦截 / 登录态预检
├── 网关三件套（DSCONNECT_URL/TOKEN/AGENT_ID）
├── Cookie 注入 env（DSAGENT_COOKIE 等 5 个变量）
└── skill.run(...)（spawn 子进程）
```

**实现方式**：index.ts 里 `executeSkillCore` 定义后，把引用传入 `registerWorkflowApi({ executeSkill: executeSkillCore, ... })`，workflow service 每个步骤调用它。注意：

- **账号选定**：任务级「账号下拉」的 shopKey → 传 `chosenShopKey`，跳过 executeSkillCore 里「多账号问用户选号」环节（UI 已选好，`need_account_choice` 不会触发）
- **参数形态**：
  - 有 contract.json 的技能：args 对象按契约参数表展平为 `explicitArgs`，`fromContract: true`
  - 无契约技能：args 拼为 requestStr（或 argv 字符串）
- **失败类型透传**：executeSkillCore 失败返回 `failureKind`（risk_control / token_expired / not_bound / rate_limit…），记入轮次 `rounds[].error` 摘要（前缀如 `[token_expired] ...`），详情弹窗直接展示失败类型
- **错误摘要区分超时**：技能子进程有 5 分钟看门狗超时；轮次 error 需区分「看门狗超时」与「业务失败」（failureKind=time_out vs 业务 failureKind）
- token_expired / risk_control / not_bound 属于「环境级失败」——**该轮记失败并直接 abort 整个任务**（重试无意义，Cookie 问题不会自愈），error 写明引导文案；其余 failureKind 按模板 on_failure 策略处理

### 5.5 Agent 工具（LLM 调用入口）

除 UI 外，注册一个 host 工具 `dsagent_workflow`，让模型/智能体能查看和管理工作流——「通过对话查看工作流、改工作流」：

| 参数 | 类型 | 说明 |
|------|------|------|
| `action` | string（必填） | `list` / `get` / `create` / `update` / `delete` / `run` / `stop` / `tasks` |
| `name` | string | 模板名（get/update/delete/run 用） |
| `yaml` | string | 模板 YAML 全文（create/update 用，走 7.4 校验） |
| `inputs` | object | 运行输入（run 用） |
| `shopKey` | string | 目标账号（run 用） |
| `taskId` | string | 任务 ID（stop/tasks 用） |

- 内部直接调 workflow service（与 HTTP action 同一套底层，不重复实现）
- `run` 复用「开始批量运行」同一条 createTask 链路（含输入校验、账号绑定检查）
- 返回值面向 LLM：list 返回模板摘要表、get 返回 YAML 原文、run 返回 taskId + 进度查询方式、tasks 返回任务列表（含状态/进度/最近错误）
- 工具描述里写明：「用户要求查看/修改/新建工作流、或按工作流批量执行时调用本工具」
- 注册方式：与现有工具同一处 defineTool 注册，实现放在 `src/workflow/api.ts`（`buildWorkflowTool()`），不散落进 index.ts

---

## 六、任务状态定义

| 状态 | 说明 | 颜色 |
|------|------|------|
| `queued` | 排队中，等待引擎拾取 | 灰色 |
| `running` | 执行中 | 蓝色 |
| `completed` | 全部轮次完成 | 绿色 |
| `failed` | 任务异常终止（非单步失败，而是引擎级错误） | 红色 |
| `stopped` | 用户手动停止 | 橙色 |

进度明细：
- `success`：成功完成的轮次数
- `failed`：失败的轮次数
- `target`：目标轮次数（= count_input 的值）
- `current`：当前轮次

---

## 七、存储设计

### 7.1 工作流模板

- 位置：`skills/workflows/*.yaml`
- 格式：YAML 文件（每个文件一个工作流模板），**新增 `yaml` npm 依赖**（纯 JS、esbuild 可打包），host 侧解析、浏览器侧导入时也用它
- 读写：host 半区 `src/workflow/service.ts` 扫描目录，读取/写入文件；浏览器侧通过 HTTP API 间接访问（见 7.3）

### 7.2 任务记录

- 位置：`{storePath}/workflow-tasks.json`
- 格式：JSON 数组，每条记录一个任务
- 结构：

```json
[
  {
    "id": "wf_task_1734038425000",
    "workflowName": "1688找款式+上架",
    "shop": "希音4店",
    "inputs": {
      "keyword": "连衣裙",
      "count": 50,
      "shop": "希音4店"
    },
    "inputSummary": "关键词：连衣裙；数量：50",
    "status": "running",
    "success": 12,
    "failed": 1,
    "target": 50,
    "current": 13,
    "startedAt": "2026-10-11T14:30:25+08:00",
    "finishedAt": null,
    "error": null,
    "rounds": [
      { "index": 1, "status": "ok", "durationMs": 4200, "error": null },
      { "index": 2, "status": "failed", "durationMs": 1500, "error": "技能 pdd_crawl 返回 exitCode=1：风控验证失败" }
    ]
  }
]
```

- 重启不丢失，历史任务永久保存
- `rounds` 轮次明细**成功与失败均持久化**（成功轮记状态和耗时，失败轮额外记错误摘要，超长截断到 500 字符），供详情弹窗回溯
- 定时轮询（每 5 秒）刷新前端进度

### 7.3 HTTP API（浏览器 ↔ host 通信）

浏览器半区（client.ts 侧）**不能**直接读文件、执行技能，全部数据操作走现有 `/dsagent/api` 单入口（POST + `{action, ...}`），在 host 半区 handler 里新增 action 分支：

| action | 参数 | 返回 | 说明 |
|--------|------|------|------|
| `list_workflow_templates` | — | `{ok, templates: [{name, category, mode, description}]}` | 扫描 skills/workflows/，含模板摘要 |
| `get_workflow_template` | `{name}` | `{ok, yaml}` | 返回单个模板原文（YAML 字符串） |
| `save_workflow_template` | `{yaml}` | `{ok, name, issues?}` | 校验通过后写入文件；重名覆盖 |
| `delete_workflow_template` | `{name}` | `{ok}` | 删除模板文件 |
| `list_workflow_tasks` | `{status?, shop?, fromDate?, toDate?}` | `{ok, tasks}` | 任务列表（服务端过滤） |
| `create_workflow_task` | `{workflowName, shop, inputs}` | `{ok, taskId}` | 校验输入 → 新建 queued 任务并异步启动 |
| `stop_workflow_task` | `{taskId}` | `{ok}` | 置 stopRequested 标志 |
| `get_workflow_task_detail` | `{taskId}` | `{ok, task}` | 单任务全量（含 rounds） |

**架构分层**：
- **host 半区**：index.ts handler 只加 1 行分发，`workflow_` 前缀 action 全部委托给 `src/workflow/api.ts` 的 `handleAction`，内部再调组件的 service
- **浏览器半区**：`src/workflow/page.ts` 薄 fetch 封装调用上述 action，渲染 UI
- **安全边界**：`/dsagent/api` 仅监听 localhost，workflow action 与现有 action 同边界，无需额外鉴权（不过度设计）

### 7.4 模板保存校验

保存模板时执行以下校验，不通过则拒绝保存并列出 issues：

| 校验项 | 规则 |
|--------|------|
| 名称 | 非空且唯一（作为文件名，过滤非法字符） |
| 步骤技能存在 | 每个 step.skill 必须存在于 skill-service 且 enabled |
| 步骤技能可执行 | 排除 instructions 入口型技能 |
| batch 完整性 | mode=batch 时 count_input 必填且指向存在的 number 类型输入变量 |
| 输出变量唯一 | steps 的 output 变量名互不重复，且不与输入变量冲突 |
| 参数引用有效 | args 里的 `{{}}` 引用必须指向存在的变量（输入 / loop.* / 上游步骤输出） |

---

## 八、文件结构（独立功能组件）

### 隔离原则

- **专属文件夹**：工作流全部代码集中在 `src/workflow/`，自成组件，不散落在现有目录
- **现有文件只加入口**：现有文件只加"接线"代码，逻辑全部在组件内
- **数据隔离**：模板（`skills/workflows/`）和任务记录（`workflow-tasks.json`）用独立文件，不与现有数据混放
- **样式隔离**：类名统一 `dsa-wf-` 前缀，见第九章

### 新增文件（src/workflow/ 文件夹）

| 文件 | 职责 |
|------|------|
| `src/workflow/types.ts` | 共享类型：WorkflowTemplate / WorkflowTask / RoundRecord 等 |
| `src/workflow/service.ts` | host 半区：模板扫描/校验/CRUD、任务 CRUD、执行引擎（经 executeSkill 引用调 executeSkillCore）、浏览器互斥锁、重启对账 |
| `src/workflow/api.ts` | host 半区入口：① `registerWorkflowApi(deps)` → `handleAction(action, payload)` 统一处理 8 个 HTTP action；② `buildWorkflowTool()` 生成 `dsagent_workflow` 工具定义（见 5.5），两者共用 service |
| `src/workflow/page.ts` | 浏览器半区：页面组件（HTML 模板 + 事件委托），含两个子标签；薄 fetch 封装调 /dsagent/api |
| `skills/workflows/*.yaml` | 工作流模板目录（运行时数据） |

### 现有文件改动（仅入口）

| 文件 | 改动 | 量级 |
|------|------|------|
| `src/index.ts` | +1 行 import；webServer handler 顶部加 1 行分发（`workflow_` 前缀 action 全部委托组件）；executeSkillCore 定义后传引用给组件；defineTool 加 1 个 `dsagent_workflow`；启动时 +1 行 reconcile | ~10 行 |
| `src/client.ts` | +1 行 import；新增第三个 Tab 按钮（与现有按钮代码同构）+ 一个挂载分支；locale 加 2 词条 | ~25 行 |
| `package.json` | dependencies 加 `yaml` | 1 行 |

### 文件职责详述

**service.ts**（host 半区）

```
createWorkflowService({ skill, config })
├── listTemplates()          → 扫描 skills/workflows/*.yaml，返回模板摘要列表
├── getTemplate(name)        → 读取单个模板原文/解析结果
├── saveTemplate(yaml)       → 校验（见 7.4）→ 写入 skills/workflows/{name}.yaml
├── deleteTemplate(name)     → 删除模板文件
├── listTasks(filter?)       → 读取 workflow-tasks.json，按条件过滤
├── getTaskDetail(taskId)    → 单任务全量（含 rounds）
├── createTask(template, inputs, shop) → 校验输入 → 新建 queued → 异步 runTask
├── stopTask(taskId)         → 置 stopRequested 标志
├── runTask(taskId)          → 执行引擎：渲染变量 → 调技能 → 记轮次 → 更新进度
├── reconcile()              → 重启对账：孤儿 running/queued → failed
└── browserLock              → 全局浏览器互斥锁（acquire/release）
```

**page.ts**（浏览器半区）

```
workflowPage({ config })
├── api(action, payload)     → fetch('/dsagent/api') 薄封装
├── html()                   → 返回页面 HTML（含子标签切换）
└── mount(root)               → 绑定事件：
    ├── 子标签切换逻辑
    ├── 工作流任务子页
    │   ├── 工作流下拉切换 → 动态渲染输入区（含 required/min/max 校验）
    │   ├── 开始批量运行 → 创建任务
    │   ├── 筛选栏联动 → 刷新任务列表
    │   ├── 查看详情 → Modal 展示轮次明细
    │   └── 定时轮询 → 更新进度
    └── 工作流编排子页
        ├── 模板列表 → 加载到编辑器
        ├── 变量面板：输入变量增删/编辑、类型选择
        ├── 步骤增删行、排序；技能下拉（过滤 instructions 型）
        ├── 参数名读技能 contract（有契约时）
        ├── YAML 实时预览
        └── 保存（含服务端校验回显 issues）/导入/导出
```

---

## 九、UI 统一化规范

### 9.0 设计原则

**工作流页的 CSS 类名、配色、字体、间距、组件形态全部复用现有账号页和技能页**，不引入新设计语言。两个现有页面已有两套 CSS 前缀（账号页 `dsa-`、技能页 `dsm-`），工作流页统一使用 `dsa-` 前缀（与账号页同源），新增样式只补充现有 CSS 未覆盖的组件（子标签栏、筛选栏、编排编辑器），且配色/字号/圆角与现有保持一致。

### 9.1 CSS 变量与配色（复用现有）

| 变量/色值 | 用途 | 来源 |
|-----------|------|------|
| `#1f2430` | 主文字色 | account-page |
| `#8b93a7` | 次要文字色 | account-page |
| `#67708a` | 辅助文字色 | account-page |
| `#2b6cff` | 主色（按钮/链接/选中态） | account-page |
| `#1f5ae0` | 主色 hover | account-page |
| `#e6eaf2` | 分割线 | client.ts tab 栏 |
| `#f4f6fa` | 内容区背景 | client.ts |
| `#fff` | 卡片/表格/弹窗背景 | account-page |
| `#eceff5` | 表格/卡片边框 | account-page |
| `#e8f7ee` / `#1a9f4d` | 成功态（badge 绿） | account-page |
| `#fff6e5` / `#c47f00` | 警告态（badge 橙） | account-page |
| `#fdecec` / `#d93b3b` | 错误态（badge 红） | account-page |
| `#eef1f7` / `#67708a` | 待定态（badge 灰） | account-page |
| `rgba(24,28,40,.9)` | Toast 背景 | account-page |

### 9.2 字体与间距（复用现有）

```css
/* 页面根字体：与 account-page 完全一致 */
.dsa-page {
  font: 13px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: #1f2430;
}

/* 标题：与 account-page h2 一致 */
.dsa-hd h2 { margin: 0 0 4px; font-size: 17px; }

/* 次要说明文字 */
.dsa-dim { color: #8b93a7; margin: 0; }

/* 内容区间距：与 client.ts 内容区一致 */
内容区 padding: 16px; background: #f4f6fa;
```

### 9.3 组件复用映射

| 组件 | 复用来源 | 现有类名 | 工作流页用法 |
|------|----------|----------|-------------|
| 页面容器 | account-page | `.dsa-page` | 直接复用 |
| 页头（标题+说明+操作按钮） | account-page | `.dsa-hd` / `.dsa-hd-ops` | 直接复用 |
| 按钮（普通） | account-page | `.dsa-btn` | 直接复用 |
| 按钮（主操作） | account-page | `.dsa-btn.dsa-btn-primary` | 直接复用 |
| 按钮（危险操作） | 新增 | `.dsa-btn.dsa-btn-danger` | `background:#d93b3b;border-color:#d93b3b;color:#fff` |
| 表格 | account-page | `.dsa-table` | 直接复用（thead/tbody/td/tr） |
| 状态徽标 | account-page | `.dsa-badge.dsa-{ok/warn/bad/idle}` | 直接复用 |
| 分页器 | account-page | `.dsa-pager` / `.dsa-pg` | 直接复用 |
| 空状态 | account-page | `.dsa-empty` / `.dsa-empty-ico` / `.dsa-empty-title` / `.dsa-empty-sub` | 直接复用 |
| 弹窗（Modal） | account-page | `.dsa-mask` / `.dsa-modal` / `.dsa-modal-hd` / `.dsa-modal-bd` / `.dsa-modal-ft` | 直接复用 |
| Toast | account-page | `.dsa-toast` | 直接复用 |
| 复制按钮 | account-page | `.dsa-copy` | 如需复制任务 ID 时复用 |
| 下拉选择框 | 原生 `<select>` | — | `border:1px solid #d8dde8;border-radius:6px;padding:6px 12px;font-size:13px` 与 `.dsa-btn` 同高 |
| 文本输入框 | 原生 `<input>` / `<textarea>` | — | 同上下拉框样式 |
| Tab 栏（子标签） | skill-market-page | `.dsm-tabs` / `.dsm-tab` | **改名 `dsa-` 前缀复用样式**：`.dsa-subtabs` / `.dsa-subtab`，配色/字号/选中态完全照搬 |

### 9.4 新增组件样式（与现有风格对齐）

以下组件是工作流页特有，CSS 新增但配色/圆角/字号与现有保持一致：

**子标签栏**（复用 skill-market-page 的 `.dsm-tabs` 结构，改 `dsa-` 前缀）：
```css
.dsa-subtabs{display:flex;gap:6px;border-bottom:1px solid #eceff5;margin-bottom:14px}
.dsa-subtab{border:none;background:none;padding:8px 14px;cursor:pointer;color:#67708a;font-size:13px;
  border-bottom:2px solid transparent;font-family:inherit}
.dsa-subtab.on{color:#2b6cff;border-bottom-color:#2b6cff;font-weight:600}
```

**筛选栏**（横向排列，与 skill-market-page 的 `.dsm-filter-row` 同风格）：
```css
.dsa-filter-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;
  padding:10px 14px;background:#fff;border:1px solid #eceff5;border-radius:8px}
.dsa-filter-bar select,.dsa-filter-bar input[type=date]{
  border:1px solid #d8dde8;border-radius:6px;padding:6px 12px;font-size:13px;outline:none}
.dsa-filter-bar select:focus,.dsa-filter-bar input:focus{border-color:#2b6cff}
.dsa-filter-label{color:#8b93a7;font-size:12px;flex:none}
```

**编排编辑器**（左列表+中编排+右变量面板，三栏式，影刀风格）：
```css
.dsa-editor{display:flex;gap:14px;min-height:400px}
.dsa-editor-list{width:180px;flex:none;border:1px solid #eceff5;border-radius:8px;
  background:#fff;overflow:auto}
.dsa-editor-item{padding:10px 12px;border-bottom:1px solid #f2f4f9;cursor:pointer;font-size:13px}
.dsa-editor-item:hover{background:#f7faff}
.dsa-editor-item.on{background:#f7faff;color:#2b6cff;font-weight:600}
.dsa-editor-main{flex:1;border:1px solid #eceff5;border-radius:8px;background:#fff;padding:16px;overflow:auto}
.dsa-editor-vars{width:220px;flex:none;border:1px solid #eceff5;border-radius:8px;
  background:#fff;padding:12px;overflow:auto}
.dsa-var-group{margin-bottom:14px}
.dsa-var-group-title{font-size:12px;color:#8b93a7;font-weight:600;margin-bottom:6px;
  padding-bottom:4px;border-bottom:1px solid #f2f4f9}
.dsa-var-item{display:flex;align-items:center;justify-content:space-between;
  padding:4px 8px;border-radius:4px;font-size:12.5px;cursor:pointer}
.dsa-var-item:hover{background:#f7faff}
.dsa-var-name{color:#1f2430;font-family:ui-monospace,Consolas,monospace}
.dsa-var-type{color:#8b93a7;font-size:11px;background:#eef1f7;border-radius:3px;padding:0 4px}
.dsa-var-del{border:none;background:none;color:#d93b3b;cursor:pointer;font-size:12px;opacity:.5}
.dsa-var-del:hover{opacity:1}
.dsa-field-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.dsa-field-row input,.dsa-field-row select{border:1px solid #d8dde8;border-radius:6px;
  padding:6px 10px;font-size:13px;outline:none}
.dsa-field-row input:focus,.dsa-field-row select:focus{border-color:#2b6cff}
.dsa-step-card{border:1px solid #eceff5;border-radius:8px;padding:14px;margin-bottom:10px}
.dsa-step-card-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.dsa-step-card-title{font-weight:600;font-size:13px;color:#1f2430}
.dsa-step-move{border:none;background:#f2f4f9;border-radius:4px;padding:2px 8px;cursor:pointer;
  font-size:13px;color:#67708a}
.dsa-step-move:hover{background:#e8ecf4}
.dsa-param-bind{display:grid;grid-template-columns:100px 1fr;gap:6px 8px;margin-bottom:8px}
.dsa-param-name{color:#67708a;font-size:12px;align-self:center}
.dsa-yaml-preview{background:#f7f9fc;border:1px solid #eceff5;border-radius:6px;
  padding:12px;font-size:12px;color:#4b5466;overflow:auto;
  font-family:ui-monospace,Consolas,monospace;white-space:pre-wrap;margin-top:14px}
```

### 9.5 子标签切换

子标签用 `subtab` state 控制（`'tasks'` | `'editor'`），切换时只替换内容区 `innerHTML`，不重新加载整个页面，与 skill-market-page 的 tab 切换模式一致。

### 9.6 任务列表轮询

- 进入「工作流任务」子标签时启动定时器，每 5 秒调用 `listTasks()` 刷新列表
- 切走子标签时清除定时器
- 只在有 `running` 或 `queued` 状态任务时轮询

### 9.7 Toast 提示

复用现有 `.dsa-toast` 组件，创建任务、停止任务、保存模板等操作后提示：
```css
/* 已存在于 account-page CSS，直接复用 */
.dsa-toast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%);
  background:rgba(24,28,40,.9);color:#fff;padding:8px 18px;border-radius:20px;
  font-size:13px;z-index:120}
.dsa-toast[hidden]{display:none}
```

---

## 十、实现步骤

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | 创建 `src/workflow/types.ts` + `service.ts`：模板扫描/校验 + 任务 CRUD + 执行引擎 | 无 |
| 2 | 创建 `src/workflow/api.ts`：handleAction 统一分发 8 个 action | 步骤 1 |
| 3 | 创建 `src/workflow/page.ts`：两个子标签的 HTML 模板 + 事件绑定 | 步骤 2 |
| 4 | 修改 `client.ts`：注册第三个 Tab（入口接线） | 步骤 3 |
| 5 | 修改 `index.ts`：handler 加 1 行 `workflow_` 前缀分发 + reconcile（入口接线）；package.json 加 `yaml` | 步骤 2 |
| 6 | 预设工作流模板：在 `skills/workflows/` 下创建示例 YAML | 步骤 1 |

---

## 十一、需求清单

### 功能需求

| 编号 | 需求 | 优先级 |
|------|------|--------|
| WF-01 | 中心面板新增「工作流」主 Tab | P0 |
| WF-02 | 工作流 Tab 内含「工作流任务」和「工作流编排」两个子标签 | P0 |
| WF-03 | 顶部配置区：工作流下拉、账号下拉、动态输入区、开始批量运行按钮 | P0 |
| WF-04 | 动态输入区根据模板 inputs 自动渲染：text/number/textarea/select/date | P0 |
| WF-05 | 批量任务筛选栏：状态、时间区间、店铺筛选 | P1 |
| WF-06 | 批量任务列表：开始时间、工作流、店铺、输入、状态、进度、操作 | P0 |
| WF-07 | 任务状态：queued/running/completed/failed/stopped | P0 |
| WF-08 | 进度显示：成功数/目标数 + 失败数 | P0 |
| WF-09 | 任务串行执行：同一任务内步骤串行 + 批量循环串行 | P0 |
| WF-10 | 任务并发执行：不同任务之间可并发 | P0 |
| WF-10a | 全局浏览器互斥锁：浏览器类技能跨任务排队，同一时刻仅一个 | P0 |
| WF-10b | 重启对账：孤儿 running/queued 任务标记 failed | P0 |
| WF-11 | 失败策略：on_failure=continue/abort | P0 |
| WF-11a | 停止机制：stopRequested 标志，当前步骤完成后停止 | P1 |
| WF-12 | 任务历史永久保存，可筛选回溯 | P0 |
| WF-12a | 轮次明细 rounds 持久化（成功记耗时、失败记错误摘要） | P0 |
| WF-12b | 任务详情弹窗：基本信息 + 轮次明细表 | P1 |
| WF-13 | 定时轮询刷新进度（每5秒） | P1 |
| WF-13a | HTTP API：8 个 workflow action 走 /dsagent/api | P0 |
| WF-14 | 运行中任务可手动停止 | P1 |
| WF-15 | 工作流编排：模板列表（左侧） | P0 |
| WF-16 | 编排编辑器：基本信息（名称、分类、执行模式、数量字段） | P0 |
| WF-17 | 编排编辑器：输入变量增删/编辑、类型选择（变量面板） | P0 |
| WF-18 | 编排编辑器：步骤增删行、上下排序 | P0 |
| WF-19 | 编排编辑器：技能下拉从 skill-service 读取，过滤 instructions 型 | P0 |
| WF-19a | 编排编辑器：参数名优先读技能 contract.json（有契约时） | P1 |
| WF-20 | 编排编辑器：变量引用 `{{}}` 输入提示 | P1 |
| WF-20a | 输出变量下拉展示契约 output.fields 真实字段（有契约时） | P1 |
| WF-21 | YAML 实时预览（只读） | P1 |
| WF-22 | 导入 YAML 文件 | P1 |
| WF-23 | 导出/保存 YAML 到 skills/workflows/ | P0 |
| WF-23a | 模板保存校验（6 项规则，见 7.4），issues 回显 | P0 |
| WF-24 | 新建工作流模板预置最小骨架（1 输入变量 + 1 步骤） | P1 |
| WF-25 | 删除工作流模板 | P1 |
| WF-26 | 输入校验：required / number min-max，行内错误提示 | P1 |
| WF-27 | 输出变量名自动生成 stepN（可改） | P1 |
| WF-28 | 失败策略默认 continue 并折叠进「高级」区 | P1 |
| WF-29 | 输入变量排序用 ↑↓ 按钮（无拖拽） | P1 |
| WF-30 | 执行引擎复用 executeSkillCore（账号注入/网关/预检完整链路） | P0 |
| WF-31 | failureKind 透传轮次记录，环境级失败（token_expired/risk_control/not_bound）直接 abort 任务 | P0 |
| WF-32 | 轮次错误区分看门狗超时与业务失败 | P1 |
| WF-33 | Agent 工具 `dsagent_workflow`：list/get/create/update/delete/run/stop/tasks 八个 action | P1 |
| WF-34 | Agent 工具与 UI/HTTP 共用同一套 workflow service，不重复实现 | P0 |

### 非功能需求

| 编号 | 需求 |
|------|------|
| NF-01 | UI 风格与现有账号页/技能页一致（CSS 变量、字体、配色） |
| NF-02 | HTML 模板 + 事件委托模式，不引入 React 组件库 |
| NF-03 | 工作流模板 YAML 格式（新增 `yaml` npm 依赖），人类可读可编辑，可读性主要由 UI 呈现 |
| NF-04 | 任务记录本地 JSON 存储，重启不丢失；重启对账把孤儿任务标记 failed |
| NF-05 | 兼容热重载（client.ts 的 step/isolate 模式） |
| NF-06 | 执行引擎在 host 半区运行；浏览器半区仅通过 /dsagent/api 交互 |
| NF-07 | 浏览器自动化类技能全局互斥（单例浏览器），纯计算类不受限 |
