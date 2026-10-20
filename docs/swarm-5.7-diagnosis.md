# Swarm 5.7 运行诊断报告

## 结论

**Swarm 5.7 在当前 API 端点（`http://8.163.52.51:7863/v1` + `deepseek-v4-flash`）上无法完成复刻任务。** 6 个任务运行 6 分钟，0 提交、0 完成，worker 空转。

---

## 问题 1：模型端点不兼容 tool_choice = "required"

### 现象

Worker 启动后，token 消耗呈脉冲式（一阵 249k/370k tok/s，然后长时间 0），但没有任何文件写入或任务提交。

### 根因

`deepseek-v4-flash` 在 `tool_choice: "required"` 约束下，对 swarm 的开放式 prompt（"你有一个任务队列，用工具完成"）**仍然返回纯文本**，而不是 tool_calls。

5.5 加的纯文本重试机制（`maxPlainTextRetries = 3`）流程：

1. 模型返回纯文本 "I will help you..."
2. swarm 追加 user 消息："You MUST call a tool now..."
3. 模型再次返回纯文本
4. 重复 3 次后放弃，worker 空转退出

### 实测验证

用明确指令（"Write a hello world in Go"）测试同一端点，**能正常返回 tool_calls**。说明端点支持 tool calling，但**对开放式/多步推理 prompt 的 tool_choice 约束不敏感**。

### 影响

这是 **API 端点/模型层面**的问题，不是 swarm 代码 bug。5.5/5.7 的修复对"偶尔不遵守 tool_choice"有效，但对"系统性忽略开放式 prompt 的 tool_choice"无效。

---

## 问题 2：Prompt 结构不适合该模型

### swarm 的 prompt 风格

```
You are an autonomous coding agent...
You have tools: bash, write, http, finish...
Claim work from the board, make progress, submit when done...
```

这是典型的 **ReAct/Agent 风格 prompt**，需要模型：
1. 理解任务队列概念
2. 主动调用 `http POST /claim` 获取任务
3. 分析任务内容
4. 调用 `write`/`bash` 执行
5. 调用 `http POST /submit` 提交

### deepseek-v4-flash 的实际行为

- 对明确指令（"写 hello world"）→ 正常 tool_calls
- 对开放式 agent prompt → 返回纯文本解释，不调用工具

### 根因

该模型可能：
- 训练数据里 agent-style prompt 较少
- 对 `tool_choice: "required"` 的实现是"软约束"而非"硬约束"
- 或代理层（`8.163.52.51:7863`）修改了 tool_choice 行为

---

## 问题 3：Swarm 架构依赖"模型主动性"

### 设计假设

Swarm 假设模型能：
1. 理解"任务队列"抽象
2. 主动发起 HTTP 调用 claim/submit
3. 在多轮对话中保持上下文

### 实际

`deepseek-v4-flash` 更适合：
- 单轮明确指令
- 直接代码生成
- 不需要复杂工具编排的场景

### 对比

| 场景 | 模型表现 |
|---|---|
| "Write hello world" | ✅ tool_calls |
| "Claim task from board, write file, submit" | ❌ 纯文本 |
| "Create a skill file for taobao publish" | 未测试（可能可以）|

---

## 问题 4：Windows 环境副作用（已解决但值得记录）

### worktree 锁

- `.swarm/worktrees/w2` 被 Trae CN 的 git 扩展锁定
- 3 个僵尸 git 进程（PID 9768/33996/47596）持有句柄
- 5.7 官方提供 `dev/swarm-clean.ps1` 清理脚本
- 临时方案：`--worktree-root` 指向 `.swarm2` 绕过

### 建议

将 `--worktree-root` 参数 upstream 到 swarm-go 主仓库，或改用环境变量 `SWARM_WORKTREE_ROOT`。

---

## 改进建议

### 短期（让 swarm 跑起来）

**方案 A：换模型/端点**
- 换支持严格 tool_choice 的模型（如 GPT-4、Claude、Qwen-Max）
- 或换 DeepSeek 官方 API（`api.deepseek.com`），而非第三方代理

**方案 B：改 prompt 风格**
- 把开放式 agent prompt 拆成**单轮明确指令**
- 例如："读取文件 X，提取 Y 选择器，写入 skills/Z/SKILL.md"
- 缺点：失去 swarm 的自动任务队列优势

**方案 C：不用 swarm，手动并行**
- 用 6 个独立子 agent 并行写 6 个 skill
- 每个子 agent 用明确指令："写 taobao-publish-mqs skill，参考觅千手 pageHooks.js"
- 完成后手动合并

### 长期（swarm 架构优化）

1. **Prompt 模板化**：为不同模型提供不同 prompt 模板（agent-style vs instruction-style）
2. **Fallback 机制**：纯文本重试失败后，自动降级为"单轮指令模式"
3. **Tool 封装**：把 `http POST /claim` 等操作封装成更简单的工具（如 `get_task()`），减少模型认知负担

---

## 当前状态

| 指标 | 值 |
|---|---|
| swarm 版本 | 5.7.0（093496f + worktree-root 补丁） |
| API 端点 | `http://8.163.52.51:7863/v1` |
| 模型 | `deepseek-v4-flash` |
| 任务数 | 6 |
| 运行时长 | ~6 分钟 |
| 提交数 | 0 |
| 完成数 | 0 |
| token 消耗 | ~1.3M（脉冲式） |

---

## 推荐行动

**立即执行：方案 C（手动并行写 6 个 skill）**

原因：
- 任务明确（6 个平台 skill 复刻）
- 素材已齐（觅千手 pageHooks.js）
- 不需要任务队列/自动集成
- 最快 30 分钟完成，不等 swarm 调试

要我现在开始吗？
