---
name: cron
description: 仅在需要未来定时执行或周期执行任务时，使用本 skill。使用 dsagent cron list/create/get/state/pause/resume/delete/run 管理任务，并始终显式传入 --agent-id。
metadata:
  builtin_skill_version: "1.7"
  dsagent:
    display_name: "定时任务管理"
    emoji: "⏰"
---

# 定时任务管理

## 什么时候用

只有在需要**未来某个时间自动执行**，或**按周期重复执行**时，使用本 skill。

### 应该使用
- 用户要求"每天 / 每周 / 每小时"执行某事
- 用户要求"明天 9 点 / 下周一 / 某个时间"自动提醒或执行
- 需要长期周期性通知、检查、汇报

### 不应使用
- 只是要**现在立即执行一次**
- 只是当前会话中的正常回复
- 用户没有明确执行时间或周期
- 目标 channel / user / session 还不明确

## 决策规则

1. **只有在未来定时执行或周期执行时才使用 cron**
2. **如果只是立即做一次，通常不要创建 cron**
3. **创建前必须确认执行时间/周期、目标 channel、target-user、target-session**
4. **所有 cron 命令都必须显式传 `--agent-id`**
5. **不要依赖默认 agent，否则任务可能落到 default workspace**

---

## 硬规则

### 必须显式指定 `--agent-id`

所有 `dsagent cron` 命令都**必须**传：

```bash
--agent-id <your_agent_id>
```

你的 agent_id 在系统提示中的 Agent Identity 部分（Your agent id is ...）。
不得省略，否则任务可能错误创建到 default agent 的 workspace。

---

## 常用命令

```bash
# 列出任务
dsagent cron list --agent-id <agent_id>

# 查看任务详情
dsagent cron get <job_id> --agent-id <agent_id>

# 查看任务状态
dsagent cron state <job_id> --agent-id <agent_id>

# 创建任务
dsagent cron create --agent-id <agent_id> ...

# 删除任务
dsagent cron delete <job_id> --agent-id <agent_id>

# 暂停 / 恢复任务
dsagent cron pause <job_id> --agent-id <agent_id>
dsagent cron resume <job_id> --agent-id <agent_id>

# 立即执行一次已有任务
dsagent cron run <job_id> --agent-id <agent_id>
```

---

## 创建任务

支持两种类型：
- **text**：定时发送固定消息
- **agent**：定时向 agent 提问，并把回复发送到目标 channel

支持两种调度形态：
- **cron**（`--schedule-type cron`）：经典 cron 周期（如每天 9 点、每 2 小时），与循环任务相对应
- **scheduled**（`--schedule-type scheduled`）：日程任务（从 `--run-at` 开始，可一次性或按天重复）

### 调度选择规则（必须遵守）
- 用户表达“每小时/每天/每周”且不强调具体起始日时，优先用 `cron`
- 用户表达“明天/下周一/从某天开始/未来两周/有明确截止时间”时，优先用 `scheduled`
- `scheduled` 不重复时（即一次性任务）：只传 `--run-at`，不要传 `--repeat-*`
- `scheduled` 重复时：传 `--repeat-every-days`，并根据结束条件传：
  - 限定次数：`--repeat-end-type count --repeat-count N`
  - 限定结束时间：`--repeat-end-type until --repeat-until <ISO8601>`
  - 不设结束：`--repeat-end-type never`

### 超时设置

默认超时 120 秒（2 分钟）。对于较长的 agent 任务，应显式设置更大的超时时间，避免任务被提前取消：

```bash
--timeout 600   # 10 分钟
--timeout 3600   # 1 小时
```

**核心规则**：
1. 如果 agent 任务涉及联网搜索、代码执行或多步工具调用，建议设置 `--timeout 600` 或更高
2. **timeout 必须小于调度周期**，避免前一次执行未完成时下一次已触发，导致任务重叠运行。例如：
   - 每 15 分钟执行：`--timeout` 不应超过 900 秒
   - 每 10 分钟执行：`--timeout` 建议不超过间隔的 80%（即 480 秒）
   - 每天执行：`--timeout` 可以设置较大，不需要特别限制
3. 对于高频任务（间隔 ≤ 10 分钟），遵循 **timeout ≤ 调度间隔的 80%**；低频任务（每小时及以上）按实际需要设置即可

### 创建前最少要确认
- `--type`
- `--name`
- `--schedule-type`
- `--cron`（当 `--schedule-type cron`）
- `--run-at`（当 `--schedule-type scheduled`）
- `--channel`
- `--target-user`
- `--target-session`
- `--text`
- `--agent-id`
- `--timeout`（对于 agent 类型任务，根据预期执行时间设置合适的超时）

如果缺少这些信息，应先向用户确认，再创建任务。

### 创建示例

```bash
# 循环任务（对应 --schedule-type cron）
dsagent cron create \
  --agent-id <agent_id> \
  --type text \
  --schedule-type cron \
  --name "每日早安" \
  --cron "0 9 * * *" \
  --channel imessage \
  --target-user "CHANGEME" \
  --target-session "CHANGEME" \
  --text "早上好！"
```

```bash
# 循环任务（对应 --schedule-type cron）
dsagent cron create \
  --agent-id <agent_id> \
  --type agent \
  --schedule-type cron \
  --name "检查待办" \
  --cron "0 */2 * * *" \
  --channel dingtalk \
  --target-user "CHANGEME" \
  --target-session "CHANGEME" \
  --text "我有什么待办事项？" \
  --timeout 600
```

```bash
# 日程一次性：明天 9 点提醒（不重复）
dsagent cron create \
  --agent-id <agent_id> \
  --type text \
  --schedule-type scheduled \
  --name "明早提醒" \
  --run-at "2026-05-13T09:00:00+08:00" \
  --channel dingtalk \
  --target-user "CHANGEME" \
  --target-session "CHANGEME" \
  --text "9 点开组会" \
  --save-result-to-inbox
```

```bash
# 日程重复：未来两周每天 9 点（共 14 次）
dsagent cron create \
  --agent-id <agent_id> \
  --type text \
  --schedule-type scheduled \
  --name "未来两周组会提醒" \
  --run-at "2026-05-13T09:00:00+08:00" \
  --repeat-every-days 1 \
  --repeat-end-type count \
  --repeat-count 14 \
  --channel dingtalk \
  --target-user "CHANGEME" \
  --target-session "CHANGEME" \
  --text "9 点开组会" \
  --save-result-to-inbox
```

### 从 JSON 创建

```bash
dsagent cron create --agent-id <agent_id> -f job_spec.json
```

---

## 直接写 jobs.json（必须遵守的文件格式）

如果需要直接写或编辑 `jobs.json` 文件（而非通过 CLI / API 创建），**必须**严格遵循下面的 schema。
**CLI 参数名（`--schedule-type`、`--target-user` 等）不是 JSON 字段名**，直接照搬会导致智能体启动时崩溃。

### 文件结构

```json
{
  "version": 1,
  "jobs": [
    {
      "id": "可选，留空让系统自动生成",
      "name": "任务名称",
      "enabled": true,
      "task_type": "agent | text",
      "schedule": {
        "type": "cron | once",
        "cron": "0 9 * * *",
        "timezone": "Asia/Shanghai"
      },
      "dispatch": {
        "type": "channel",
        "channel": "dingtalk | qq | wechat | imessage",
        "target": {
          "user_id": "目标用户 ID",
          "session_id": "目标会话 ID"
        },
        "mode": "stream | final",
        "meta": {}
      },
      "runtime": {
        "timeout_seconds": 600,
        "max_concurrency": 1,
        "misfire_grace_seconds": 60,
        "share_session": true
      },
      "meta": {}
    }
  ]
}
```

### 字段映射（CLI 参数 → JSON 路径）

| CLI 参数 | JSON 路径 | 说明 |
|---------|----------|------|
| `--type` | `jobs[].task_type` | 注意是 `task_type` 不是 `type` |
| `--schedule-type` | `jobs[].schedule.type` | 嵌套在 `schedule` 对象内 |
| `--cron` | `jobs[].schedule.cron` | 嵌套在 `schedule` 对象内 |
| `--run-at` | `jobs[].schedule.run_at` | 仅 `schedule.type` 为 `once` 时使用 |
| `--timezone` | `jobs[].schedule.timezone` | 默认 `UTC` |
| `--channel` | `jobs[].dispatch.channel` | 嵌套在 `dispatch` 对象内 |
| `--target-user` | `jobs[].dispatch.target.user_id` | 注意是 `user_id` 不是 `target-user` |
| `--target-session` | `jobs[].dispatch.target.session_id` | 注意是 `session_id` 不是 `target-session` |
| `--text`（text 类型） | `jobs[].text` | 顶层字段 |
| `--text`（agent 类型） | `jobs[].request.input` | 消息数组，见下方示例 |
| `--timeout` | `jobs[].runtime.timeout_seconds` | 注意是 `timeout_seconds` 不是 `timeout` |
| `--agent-id` | 不写入 jobs.json | 仅作为 CLI/API 的 `--agent-id` 参数 |

### 完整示例：agent 类型（cron 周期）

```json
{
  "version": 1,
  "jobs": [
    {
      "name": "自动拉取新订单",
      "enabled": true,
      "task_type": "agent",
      "schedule": {
        "type": "cron",
        "cron": "0 * * * *",
        "timezone": "Asia/Shanghai"
      },
      "request": {
        "input": [
          {
            "role": "user",
            "type": "message",
            "content": [
              { "type": "text", "text": "检查是否有新订单并汇报" }
            ]
          }
        ]
      },
      "dispatch": {
        "type": "channel",
        "channel": "qq",
        "target": {
          "user_id": "CHANGEME",
          "session_id": "CHANGEME"
        },
        "mode": "stream",
        "meta": {}
      },
      "runtime": {
        "timeout_seconds": 600,
        "max_concurrency": 1,
        "misfire_grace_seconds": 60,
        "share_session": true
      },
      "meta": {}
    }
  ]
}
```

### 完整示例：text 类型（一次性日程）

```json
{
  "version": 1,
  "jobs": [
    {
      "name": "明早提醒",
      "enabled": true,
      "task_type": "text",
      "schedule": {
        "type": "once",
        "run_at": "2026-07-15T09:00:00+08:00",
        "timezone": "Asia/Shanghai"
      },
      "text": "9 点开组会",
      "dispatch": {
        "type": "channel",
        "channel": "dingtalk",
        "target": {
          "user_id": "CHANGEME",
          "session_id": "CHANGEME"
        },
        "mode": "stream",
        "meta": {}
      },
      "runtime": {
        "timeout_seconds": 120,
        "max_concurrency": 1,
        "misfire_grace_seconds": 60,
        "share_session": true
      },
      "meta": {}
    }
  ]
}
```

### 常见错误（直接写文件时）

1. **把 CLI 参数名当 JSON 字段名**：写 `"schedule-type": "cron"` 而不是 `"schedule": {"type": "cron"}` → 崩溃
2. **把 `type` 当 `task_type`**：写 `"type": "agent"` 而不是 `"task_type": "agent"` → 崩溃
3. **扁平化 dispatch**：写 `"channel": "qq"` 而不是 `"dispatch": {"channel": "qq"}` → 崩溃
4. **扁平化 target**：写 `"target-user": "xxx"` 而不是 `"dispatch": {"target": {"user_id": "xxx"}}` → 崩溃
5. **省略 `version` 和 `jobs` 包装**：直接写单个 job 对象而不是 `{"version": 1, "jobs": [...]}` → 崩溃

---

## 最小工作流

```
1. 判断是否真的是"未来定时"或"周期执行"
2. 确认执行时间/周期
3. 确认 channel、target-user、target-session
4. 显式带上 --agent-id
5. dsagent cron create 创建任务
6. 后续用 list / state / pause / resume / delete 管理
```

---

## Cron 表达式示例

```
0 9 * * *      每天 9:00
0 */2 * * *    每 2 小时
30 8 * * 1-5   工作日 8:30
0 0 * * 0      每周日零点
*/15 * * * *   每 15 分钟
```

---

## 常见错误

### 错误 1：把一次性立即执行当成 cron

如果只是现在执行一次，通常不要创建 cron。

### 错误 2：没传 --agent-id

这会导致任务落到错误的 agent / workspace。所有 cron 命令都必须显式传 `--agent-id`。

### 错误 3：信息没补全就创建

如果用户没说明时间、周期、目标 channel 或目标 session，应先追问。

### 错误 4：操作已有任务前不先查

暂停、恢复、删除前，先用：

```bash
dsagent cron list --agent-id <agent_id>
```

找到正确的 `job_id`。

---

## 使用建议

- 缺少参数时，先问用户再创建
- 修改/暂停/删除前，先 `dsagent cron list --agent-id <agent_id>`
- 排查问题时，用 `dsagent cron state <job_id> --agent-id <agent_id>`
- 给用户展示命令时，提供完整、可直接复制的版本
- 用户提到“结果进收件箱/不进收件箱”时，显式加 `--save-result-to-inbox` 或 `--no-save-result-to-inbox`，否则不要添加该项。

---

## 帮助信息

```bash
dsagent cron -h
dsagent cron list -h
dsagent cron create -h
dsagent cron get -h
dsagent cron state -h
dsagent cron pause -h
dsagent cron resume -h
dsagent cron delete -h
dsagent cron run -h
```
