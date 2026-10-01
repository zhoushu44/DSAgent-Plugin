# blackboard — 企业公告

管理钉钉企业公告：查询当前用户可见的公告列表、创建并发送全员公告。

## 命令概览

| 子命令 | MCP 工具 | 说明 |
|--------|----------|------|
| `dws blackboard list` | `list_user_blackboards` | 查询当前用户可见的公告列表 |
| `dws blackboard create` | `create_blackboard` | 创建并发送企业全员公告 |

## 命令详情

### list（查询公告列表）

```
Usage:
  dws blackboard list [flags]
Example:
  dws blackboard list
  dws blackboard list --unread
  dws blackboard list --start "2026-05-10T00:00:00+08:00" --end "2026-05-18T23:59:59+08:00"
Flags:
      --start string   起始时间 ISO-8601（例如 2026-05-10T00:00:00+08:00）（不传则不限）
      --end string     结束时间 ISO-8601（例如 2026-05-18T23:59:59+08:00）（不传则不限）
      --unread         仅显示未读公告（不传则显示全部）
```

返回字段包含：标题（title）、正文（content，HTML 富文本）、作者（author）、创建时间（gmtCreate，毫秒时间戳）、已读状态（isRead）、公告 ID（id）、公告链接（url）。

### create（创建并发送公告）

```
Usage:
  dws blackboard create [flags]
Example:
  dws blackboard create --title "系统升级通知" --content "<p>今晚22点系统维护</p>"
  dws blackboard create --title "重要公告" --content "<p>内容</p>" --push-top --send-ding
Flags:
      --title string    公告标题（必填）
      --content string  公告正文，支持 HTML 富文本（必填）
      --push-top        是否置顶公告，默认 false
      --send-ding       是否同时发送 DING 通知，默认 false
      --send-todo       是否给接收人发起待办任务，默认 false
```

> 当前默认发送范围为全员（`receivers.deptIds = ["-1"]`）。

## 意图判断

- 用户说"公告/通知/企业公告":
  - 查看/查询/列表 → `blackboard list`
  - 创建/发布/发送 → `blackboard create`

- **时间范围处理**：当用户提到时间范围（如"最近三天""本周""上周"等），必须将自然语言时间转换为 ISO-8601 格式并传入 `--start` / `--end`：
  - "最近 N 天" → `--start "<N天前的ISO-8601>"` `--end "<当前时间的ISO-8601>"`
  - "本周" → `--start "<本周一00:00:00+08:00>"` `--end "<当前时间的ISO-8601>"`
  - "上周" → `--start "<上周一00:00:00+08:00>"` `--end "<上周日23:59:59+08:00>"`
  - 示例：用户说"看看最近三天的通知" → `dws blackboard list --start "2026-05-15T00:00:00+08:00" --end "2026-05-18T23:59:59+08:00" --format json`

## 注意事项

- `--content` 支持 HTML 富文本，如 `<p>段落内容</p>`
- 公告创建后立即发送，不可撤回
- 查询结果按创建时间倒序排列
- uid 和 corpId 由 MCP 网关自动注入，CLI 无需传递
