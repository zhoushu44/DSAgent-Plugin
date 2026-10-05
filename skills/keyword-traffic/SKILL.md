---
name: keyword-traffic
description: |
  万相台无界版关键词流量趋势：类目匹配、最多 13 个月日趋势（展现/点击/CTR/CVR/竞争/均价）、市场总结、HTML 报告。
  触发：关键词趋势、流量趋势、万相台、展现指数、竞争指数、市场均价。
  排除：拓词/排行榜（关键词助手）、建计划（推广管理助手）。
  凭证：平台连接里绑定的 **sycm（生意参谋/万相台/达摩盘）** 账号。
license: MIT
metadata:
  builtin_skill_version: "1.2"
  dsagent:

    display_name: "万相台关键词解析"
    emoji: "📈"
---

> `cd "{this_skill_dir}" && python -m keyword_traffic <command> ...`
> 依赖：Python 3.10+、`httpx`；运行时由 DeepSeek Agent 注入 `{workspace}/.dsagent/runtime/`
> 绑定：Connect `GET /api/v1/accounts?include_cookie=false`；平台 API：`POST /api/v1/proxy`
> 凭证：控制台 **平台连接** 登录 **sycm** 并 **绑定到当前智能体**

## 前置条件

1. 在 **平台连接** 添加并登录 **生意参谋/万相台/达摩盘**（`platform=sycm`）
2. 将该店铺 **绑定到当前对话的智能体**
3. 用 `get_platform_bindings` 确认 `sycm` 为 `valid`（可选）
4. 在 Chat 中由 Agent 执行本技能（cwd 为智能体 workspace）

## 命令

| 命令 | 说明 |
|------|------|
| `categories <词>` | 匹配行业类目（供 `--cate_id`） |
| `trend <词>` | 日趋势 JSON + CSV + HTML 报告，自动入库 |
| `summary <词>` | 市场总结（词性/流量/竞争/人群/时间） |
| `history` | 本 workspace 已抓取关键词列表 |

```bash
python -m keyword_traffic trend "充电宝" --cate_id 201272600 --months 6
python -m keyword_traffic history --keyword 充电
```

## 参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `--cate_id` | 自动首个有效类目 | 行业类目 ID |
| `--months` | 13 | 趋势月数 1–13 |

`trend` 成功时 stdout JSON 含 `csv_path`（UTF-8 BOM）和 `report_path`（HTML 可视化）；趋势明细写入 Connect skill-cache，不写 artifacts JSON。

## 退出码

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | 参数错误 |
| 2 | 未绑定 sycm / 会话无效 |
| 3 | 限流（约 5 分钟后重试） |
| 4 | API 业务错误 |

## trend 成功后（Agent）

仅 `trend` 且退出码 0 时追问一次是否做深度分析；用户同意后用 `csv_path` 调「智能数据分析」。

## 协作链

市场分析 → 关键词助手 → **本 Skill** → 智能数据分析

## 存储与产物（当前智能体 workspace）

| 类型 | 路径 |
|------|------|
| Connect skill-cache | 表 `cache_keyword_traffic_*`（按 shop_key；`history` 从此读） |
| CSV/HTML | `{workspace}/artifacts/` |
| stdout | JSON 摘要（Agent 读取；明细已入库，不写 artifacts JSON） |

## 数据说明

万相台付费搜索场景；展现/点击指数为相对指数。接口细节见 `references/api_notes.md`。

---

## 证据分级（输出结论前必读）

本技能输出任何"结论"前，先按**证据四分级**标注级别（Observed 直采 / Calculated 计算 /
Proxy 代理推断 / Unknown 未知），并遵守五条禁止推断——尤其是：
**sycm/万相台指数一律标 Proxy，不得当绝对量**；**Unknown 不得当 0 参与平均**。

完整分级表、五条禁止推断与国内场景注释见 [references/evidence-rules.md](references/evidence-rules.md)。
