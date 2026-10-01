---
name: multi_agent_collaboration
description: 当需要其他 agent 的专长、上下文或协作支持，或用户明确要求调用其他 agent 时，使用本 skill。先 list_agents()，再用 chat_with_agent / submit_to_agent 协作。
metadata:
  builtin_skill_version: "1.5"
  dsagent:
    display_name: "多智能体协作"
    emoji: "🤝"
---

# 多智能体协作

## 什么时候用

当你**需要其他 agent 的专业能力、上下文、workspace 内容或协作支持**时，使用本 skill。  
如果**用户明确要求某个 agent 参与/协助/回答**，也应使用本 skill。

### 应该使用

- 当前任务明显更适合某个专用 agent
- 需要另一个 agent 的 workspace / 文件 / 上下文
- 需要第二意见或专业复核
- 用户明确要求某个 agent 参与或调用其他 agent

### 不应使用

- 你自己可以直接完成，且用户没有明确要求调用其他 agent
- 只是普通问答，不需要专门 agent
- 信息不足，应先追问用户
- 刚收到 Agent B 的消息，**不要再调用 Agent B**，避免循环

## 决策规则

1. **如果用户明确要求调用其他 agent，优先按要求执行**
2. **否则，能自己做，就不要调用**
3. **调用前先 `list_agents()`，不要猜 ID**
4. **需要上下文续聊时，必须传 `session_id`**
5. **不要回调消息来源 agent**
6. **必须使用内置工具，不要运行 `dsagent agents ...` shell 命令**（阶段 1 后无 JWT 会 401）

## 使用流程

1. `list_agents()` — 查看可用 agent，按描述选择目标 **ID**（不是 name）
2. 简单协作、需要即时回复 → `chat_with_agent(to_agent=..., text=...)`
3. 复杂任务（分析、批处理、长耗时）→ `submit_to_agent(...)`，再用 `check_agent_task(task_id=...)` 查状态
4. 多轮对话时，从首轮返回的 `[SESSION: ...]` 取出 `session_id`，后续调用传入同一值

## 最小调用示例

### 实时协作

```text
list_agents()

chat_with_agent(
  to_agent="<target_agent_id>",
  text="[Agent <your_agent_id> requesting] 请帮我复核这份方案的可行性。",
)
```

### 后台协作

```text
submit_to_agent(
  to_agent="<target_agent_id>",
  text="[Agent <your_agent_id> requesting] 请在后台完成数据分析并给出结论。",
)

check_agent_task(task_id="<task_id>")
```

### 续接会话

```text
chat_with_agent(
  to_agent="<target_agent_id>",
  text="[Agent <your_agent_id> requesting] 请基于上次结论补充第 2 点细节。",
  session_id="<previous_session_id>",
)
```

## 注意事项

- 建议在 `text` 开头加 `[Agent <your_agent_id> requesting]`，便于对方识别调用方
- 后台任务提交后**不要频繁轮询**；间隔合理再 `check_agent_task`
- 区分 ID 与 name：`to_agent` 必须是 `list_agents()` 返回的 `id` 字段
