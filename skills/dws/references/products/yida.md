# 宜搭 (yida) 命令参考

## 命令总览

### 一、应用管理 (app)

#### 获取宜搭应用列表
```
Usage:
  dws yida app list [flags]
Example:
  dws yida app list --keyword "项目管理" --page 1 --size 20
Flags:
      --keyword string   按应用名搜索 (可选)
      --filter string    过滤条件，枚举值（可选）：
                           all          全部应用
                           createdByMe  我创建的应用
                           managedByMe  我管理的应用
      --page string      分页页码，默认 1 (可选)
      --size string      每页条数，默认 20，最大 100 (可选)
      --language string  语言：zh_CN / en_US (可选)
```

#### 获取应用内表单列表
```
Usage:
  dws yida app list-forms [flags]
Example:
  dws yida app list-forms --app <appType> --form-types receipt --page 1 --size 20
Flags:
      --app string         应用编码 (必填)
      --form-types string  表单类型：receipt（单据）/ process（流程），不传默认全选 (可选)
      --page string        分页页码，默认 1 (可选)
      --size string        每页条数，默认 20，最大 100 (可选)
      --language string    语言：zh_CN / en_US (可选)
```

---

### 二、表单定义 (form)

#### 获取表单字段定义
```
Usage:
  dws yida form components [flags]
Example:
  dws yida form components --app <appType> --form <formUuid>
Flags:
      --app string        应用编码 (必填)
      --form string  表单 UUID (必填)
      --language string   语言 (可选)
      --version string    表单版本，默认最新版本 (可选)
```

---

### 三、表单数据 (data)

#### 表单数据条件查询
```
Usage:
  dws yida data search [flags]
Example:
  dws yida data search --app <appType> --form <formUuid>
  dws yida data search --app <appType> --form <formUuid> --page 1 --size 20
  dws yida data search --app <appType> --form <formUuid> --search-field '{"textField_abc":"hello"}'
Flags:
      --app string              应用编码 (必填)
      --form string      表单 UUID (必填)
      --page string           分页页码，默认 1 (可选)
      --size string           每页记录数，默认 20，最大 100 (可选)
      --search-field string   按组件值过滤查询，JSON 字符串 (可选)
      --use-alias             开启后 searchFieldJson 支持别名形式传入组件 ID (可选)
      --originator-id string  按流程发起人工号过滤 (可选)
      --create-from string    创建时间起始 ISO-8601 (可选)
      --create-to string      创建时间截止 ISO-8601 (可选)
      --modified-from string  修改时间起始 ISO-8601 (可选)
      --modified-to string    修改时间截止 ISO-8601 (可选)
      --language string       语言：zh_CN / en_US (可选)
```

#### 获取单条记录详情
```
Usage:
  dws yida data detail [flags]
Example:
  dws yida data detail --app <appType> --instance-id <formInstId>
Flags:
      --app string             应用标识 (必填)
      --instance-id string     实例 ID (必填)
      --form string       表单 UUID (可选)
      --need-inst-value string 是否返回 instValue，传 n 不返回 (可选)
```

---

### 四、待办任务 (task)

#### 查询当前用户待办任务
```
Usage:
  dws yida task list [flags]
Example:
  dws yida task list
  dws yida task list --apps <appType> --keyword "报销"
  dws yida task list --apps APP_AAA,APP_BBB              # 多个应用用逗号分隔
  dws yida task list --page 1 --size 20
Flags:
      --apps string                 指定应用的待办，多个 appType 用逗号分隔，如 APP_AAA,APP_BBB (可选)
      --process-codes string        指定流程 code 的待办，多个用逗号分隔 (可选)
      --keyword string              待办关键字（如标题）(可选)
      --status string               任务状态 (可选)
      --page string                 分页页码，默认 1 (可选)
      --size string                 每页条数，默认 20，最大 100 (可选)
      --create-from string          任务创建时间起始 ISO-8601 (可选)
      --create-to string            任务创建时间截止 ISO-8601 (可选)
      --instance-create-from string 实例创建时间起始 ISO-8601 (可选)
      --instance-create-to string   实例创建时间截止 ISO-8601 (可选)
      --task-finish-from string     任务完成时间起始 ISO-8601 (可选)
      --task-finish-to string       任务完成时间截止 ISO-8601 (可选)
```

---

### 五、流程审批 (process)

#### 查询流程运行中的任务节点
```
Usage:
  dws yida process running-tasks [flags]
Example:
  dws yida process running-tasks --app <appType> --instance-id <processInstanceId>
Flags:
      --app string         应用编码 (必填)
      --instance-id string 流程实例 ID (必填)
      --language string    语言 (可选)
```

#### 获取流程审批操作记录
```
Usage:
  dws yida process records [flags]
Example:
  dws yida process records --app <appType> --instance-id <processInstanceId>
Flags:
      --app string         应用编码 (必填)
      --instance-id string 流程实例 ID (必填)
      --language string    语言 (可选)
```

#### 执行审批（同意/拒绝）

> **NOTE:** 审批决策一经写入不可逆，请确保已收到用户的明确指令再调用。

```
Usage:
  dws yida process execute [flags]
Example:
  dws yida process execute --app <appType> --form <formUuid> --task <taskId> --result "agree"
  dws yida process execute --app <appType> --form <formUuid> --task <taskId> --result "disagree" --remark "<审批意见>"
Flags:
      --app string               应用编码 (必填)
      --form string              表单 UUID (必填)
      --task string              任务 ID (必填)
      --result string            审批结果：agree / disagree (必填)
      --remark string            审批意见，不传默认用 result 值 (可选)
      --instance-id string       流程实例 ID (可选)
      --form-data string         审批时修改的表单数据 JSON (可选)
      --digital-sign-url string  电子签名 URL (可选)
      --no-execute-expressions   是否跳过表达式执行 (可选)
```

#### 转交审批任务

> **NOTE:** 转交操作一经写入不可逆，请确保已收到用户的明确指令再调用。

```
Usage:
  dws yida process redirect [flags]
Example:
  dws yida process redirect --app <appType> --task <taskId> --instance-id <processInstanceId> --to-user <userId>
  dws yida process redirect --app <appType> --task <taskId> --instance-id <processInstanceId> --to-user <userId> --remark "<用户备注>"
Flags:
      --app string         应用编码 (必填)
      --task string        任务 ID (必填)
      --instance-id string 流程实例 ID (必填)
      --to-user string     转交后的新执行人 userId (必填)
      --form string        表单 UUID (可选)
      --remark string      转交备注 (可选)
      --instance-id string 流程实例 ID (可选)
      --by-manager         是否由管理员转交 (可选)
```

#### 发起流程表单实例

> **NOTE:** 发起流程后会触发审批流转，一经写入不可逆，请确保已收到用户的明确指令再调用。

```
Usage:
  dws yida process start [flags]
Example:
  dws yida process start --app <appType> --form <formUuid> --form-data '{"textField_abc":"hello"}'
  dws yida process start --app <appType> --form <formUuid> --form-data '{"textField_abc":"hello"}' --dept-id <deptId>
  dws yida process start --app <appType> --form <formUuid> --form-data '{"textField_abc":"hello"}' --process-code <processCode> --use-alias
Flags:
      --app string            应用编码 (必填)
      --form string           表单 UUID (必填)
      --form-data string      表单数据 JSON (必填)
      --dept-id string        部门 ID (可选)
      --process-code string   流程编码 (可选)
      --process-data string   流程数据 (可选)
      --business-id string    业务自定义 ID (可选)
      --instance-id string    流程实例 ID (可选)
      --use-alias             是否使用组件别名 (可选)
      --language string       语言：zh_CN / en_US (可选)
```
MCP 工具: `start_process_instance`；参数: appType, formUuid, formDataJson, deptId, processCode, processData, businessId, processInstanceId, useAlias, language（对应 --app/--form/--form-data/--dept-id/--process-code/--process-data/--business-id/--instance-id/--use-alias/--language）。

---

## 意图判断

用户说"宜搭应用/应用列表" → `app list`
用户说"表单列表/应用内的表单" → `app list-forms`
用户说“表单字段/字段定义/组件” → `form components`
用户说“查询数据/表单数据/搜索记录” → `data search`
用户说“记录详情/数据详情” → `data detail`
用户说"待办/待办任务/宜搭待办" → `task list`
用户说"运行中的任务/审批进度" → `process running-tasks`
用户说"审批记录/操作记录" → `process records`
用户说"同意/拒绝/审批" → `process execute`
用户说"转交/转给别人处理" → `process redirect`
用户说"发起流程/提交流程/新建流程实例" → `process start`

## 核心工作流

```bash
# 1. 查看宜搭应用列表 — 获取 appType
dws yida app list --format json
# 按名字搜：
dws yida app list --keyword "项目管理" --format json
# 仅查我创建/管理的：
dws yida app list --filter createdByMe --format json
dws yida app list --filter managedByMe --format json

# 2. 查看应用内的表单列表 — 获取 formUuid
dws yida app list-forms --app <appType> --format json

# 3. 了解表单字段结构 — 为查询做准备
dws yida form components --app <appType> --form <formUuid> --format json

# 4. 查询表单数据
dws yida data search --app <appType> --form <formUuid> --page 1 --size 20 --format json

# 5. 获取单条记录详情
dws yida data detail --app <appType> --instance-id <formInstId> --format json

# 6. 查看待办任务列表 — 获取 taskId
dws yida task list --format json

# 7. 查看流程运行中的任务节点
dws yida process running-tasks --app <appType> --instance-id <processInstanceId> --format json

# 8. 查看流程审批记录
dws yida process records --app <appType> --instance-id <processInstanceId> --format json

# 9. 执行审批（同意/拒绝）
dws yida process execute --app <appType> --form <formUuid> --task <taskId> --result "agree" --remark "<审批意见>" --format json

# 10. 转交审批任务
dws yida process redirect --app <appType> --task <taskId> --instance-id <processInstanceId> --to-user <userId> --remark "<转交备注>" --format json

# 11. 发起流程表单实例
dws yida process start --app <appType> --form <formUuid> --form-data '{"textField_abc":"hello"}' --format json
```

## 上下文传递表

| 操作 | 从返回中提取 | 用于 |
|------|-------------|------|
| `app list` | `appType` | 所有需要 --app 的命令 |
| `app list-forms` | `formUuid` | form components / data search / process execute 的 --form |
| `data search` | `formInstId` | data detail 的 --instance-id |
| `task list` | `taskId`, `processInstanceId` | process execute / redirect 的 --task，running-tasks / records 的 --instance-id |
| `process running-tasks` | `taskId` | process execute / redirect 的 --task |

## 注意事项

- `--app` 是宜搭中最核心的标识，大多数命令都需要它，可从 `app list` 获取
- `--form` 可从 `app list-forms` 获取
- `--filter` 只接受英文枚举：`all` / `createdByMe` / `managedByMe`，**不接受中文**
- 时间参数统一使用 ISO-8601 格式（如 2026-03-10T00:00:00+08:00），CLI 自动转换为毫秒时间戳
- `process start` / `execute` / `redirect` 是不可逆操作（触发审批流转、改变任务状态），调用前确保收到用户明确指令；
- `--remark` 必须使用用户在对话中明确给出的原文，**不要把文档 example 里的占位字符串当作真实值**
- `form components` 是理解数据结构的基础工具，查询/写入数据前建议先调用
- 分页参数统一使用 `--page` 和 `--size`，默认值：page=1，size=20，最大 100
- `--search-field` 接受 JSON 字符串，字段 ID 可从 `form components` 获取
