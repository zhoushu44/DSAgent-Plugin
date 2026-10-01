---
name: competitor-indicator
description: |
  达摩盘商品竞品核心指标对比：按竞品 ID、分析/对比周期拉取整体、流量、人群画像，生成 HTML 报告。
  触发：竞品分析、竞品指标、达摩盘、商品对比、competitorIds、entityId、流量来源、人群画像。
  排除：关键词趋势（关键词流量解析）、建计划（推广管理助手）。
  凭证：DeepSeek Agent 平台连接绑定的 sycm（生意参谋/万相台/达摩盘）账号。
license: MIT
metadata:
  builtin_skill_version: "1.0"
  dsagent:

    display_name: "达摩盘竞品指标对比"
    emoji: "🎯"
---

# 达摩盘竞品指标对比

## 运行环境

```bash
# cwd 须在 DeepSeek Agent workspace（含 skill.json），二选一：
cd "{workspace}"
# 或
cd "{workspace}/skills/competitor-indicator"

python -m competitor_indicator <子命令> ...
```

- 依赖 Gateway 代理达摩盘 API（`platform=sycm`），Cookie 不落地到 Skill
- stdout 为 **UTF-8 JSON**；HTML 写入 `{workspace}/artifacts/`
- Windows 勿用 PowerShell `>` 重定向保存 JSON（会带 UTF-16 BOM）

---

## 何时用哪个子命令

```
用户要什么？
├─ 只要整体指标卡          → overall
├─ 只要流量渠道树          → flow
├─ 只要人群画像            → audience
├─ 完整竞品报告（含 AI）   → analyze → 写洞察 md → report
└─ 已有 JSON，重出 HTML    → report --input ...
```

| 子命令 | 模块 | 拉取 | 输出 |
|--------|------|------|------|
| `overall` | 整体 | shop + base 指标 | `competitors` |
| `flow` | 流量 | 渠道树 | `competitor_channels` |
| `audience` | 画像 | insight 标签/图表 | `competitor_audience` |
| `analyze` | **组合** | 整体 + 流量 + 画像 | JSON；洞察齐全时含 HTML |
| `report` | — | 不拉 API | JSON + HTML |
| `history` | — | 查本地历史 | JSON |

---

## 参数

### 共用（overall / flow / audience / analyze）

| CLI 参数 | 说明 |
|----------|------|
| `--competitor-ids` | 竞品商品 ID，逗号分隔，至少 1 个 |
| `--entity-id` | 达摩盘对比基准商品 ID（API 必填；**报告只展示竞品**） |
| `--begin-date` / `--end-date` | 分析周期 `YYYY-MM-DD` |
| `--peer-begin-date` / `--peer-end-date` | 对比周期 `YYYY-MM-DD` |
| `--competition-type` | 默认 `2`（商品） |

### 人群（audience / analyze）

| CLI 参数 | 说明 |
|----------|------|
| `--audience-action` | 默认「搜索+购买」。支持：浏览/搜索/收藏/加购/购买 或 `1~5`，逗号分隔 |
| `--audience-days` | 默认 `30`。支持：7 / 15 / 30 / 90 |

**行为码（竞争分析页，勿与 dmp_jzfx 混淆）**：`1`浏览 `2`搜索 `3`收藏 **`4`购买 **`5`加购

### report / history

| CLI 参数 | 说明 |
|----------|------|
| `report --input` | Step 1 保存的 JSON 路径 |
| `report --output` | 可选，自定义 HTML 路径 |
| `history --competitor-id` | 可选，模糊筛选 |
| `history --limit` | 默认 50 |

### 示例

```bash
python -m competitor_indicator analyze \
  --competitor-ids 1025781404398,955607354840 \
  --entity-id 720562597763 \
  --begin-date 2026-06-01 --end-date 2026-06-07 \
  --peer-begin-date 2026-05-25 --peer-end-date 2026-05-31
```

---

## stdout JSON 结构

成功时：

```json
{
  "status": "success",
  "error_code": 0,
  "competitor_ids": ["..."],
  "entity_id": "...",
  "analysis_period": { "begin_date": "...", "end_date": "..." },
  "comparison_period": { "begin_date": "...", "end_date": "..." },
  "competitors": { "<id>": { "pv": { "base", "growth_rate" }, ... } },
  "competitor_channels": { "<id>": [ ... ] },
  "competitor_audience": { "<id>": { "profiles": [ ... ] } },
  "audience_config": { "action_values", "action_labels", "time_range" },
  "data_modules": ["overall", "flow", "audience"],
  "insights_required": ["flow", "audience"],
  "insights_pending": [],
  "insights_artifacts": { "flow_md": "...", "audience_md": "..." },
  "report_path": "...",
  "stage": "analyze"
}
```

- `data_modules`：JSON 里实际有哪些模块数据
- 单模块命令只含本模块字段：`overall`→`competitors`；`flow`→`competitor_channels`；`audience`→`competitor_audience`
- 指标项仅 `{ "base", "growth_rate" }`（不含对比期 `base_period`）
- **`competitors`（顶部指标卡片）**：仅来自 `shop/indicator` + `base/indicator`，**不混入** `flow` 渠道汇总或 `audience` 数据；流量/画像仅在对应 Tab 展示
- `insights_required` / `insights_pending`：出 HTML 前还缺哪些模块的 AI 洞察文件
- 单模块命令（如 `overall`）只有对应字段；`analyze` 为全量

失败时 `status: "error"`，`error_code` 见下表；**缺洞察时 error JSON 仍含完整 metrics**，可保存后继续写 md。

| error_code | 含义 |
|------------|------|
| 0 | 成功 |
| 1 | 参数错误 / 缺洞察文件 / 洞察校验失败 |
| 2 | Cookie 或绑定无效 |
| 3 | 限流 |
| 4 | API 或解析失败 |

---

## 完整 HTML 报告工作流

### 1. 拉数

```bash
python -m competitor_indicator analyze ...参数...
```

将 stdout JSON 保存为 `{workspace}/artifacts/竞品分析.json`。

若缺洞察，会报错但 JSON 含 `competitors`、`competitor_channels`、`competitor_audience` 及 `insights_artifacts` 路径 → **继续 Step 2，不要重跑 analyze**。

### 2. 写 AI 洞察（固定路径，唯一来源）

| Tab | 模块 | 路径 |
|-----|------|------|
| 流量来源 | `flow` | `{workspace}/artifacts/竞品流量洞察.md` |
| 人群画像 | `audience` | `{workspace}/artifacts/竞品画像洞察.md` |

模板：`references/insights_flow_template.md`、`references/insights_audience_template.md`

**撰写规则**

- 只分析**竞品**，禁止出现：本店、我方、我们店铺、我们店
- 至少 **2 个 `##` 小节**，全文 **≥80 字**
- 可用 `**加粗**`、`-` 列表；按 `##` 小节拆成报告卡片
- JSON 里有哪个模块，就写对应 md；两者都有则两份都写

### 3. 生成 HTML

```bash
python -m competitor_indicator report --input artifacts/竞品分析.json
```

- 只读磁盘 md，JSON 内嵌洞察无效
- 按 JSON 中模块校验：有 `flow` 才要求流量 md，有 `audience` 才要求画像 md
- 成功时 stderr 尾行 `[OUTPUT_FILES] HTML: ...`

### 报告 UI 说明

- 顶部：核心指标卡片（仅 shop+base：IPV、加购率、转化率、成交笔数、笔单价、新客占比、付费点击、点击成本、引导 ROI、引导成交笔数等）
- Tab：**流量来源**（渠道树表 + AI 卡片）、**人群画像**（搜索/购买等行为分表 + AI 卡片）
- 增速：**红涨绿跌**（正增长红色，负增长绿色）
- 多竞品时按商品 ID 分块展示

---

## 分模块用法（不出 HTML）

仅需某一类数据时，用原子命令，stdout 存 JSON 即可，**无需写洞察 md**：

```bash
python -m competitor_indicator overall  ...共用参数...
python -m competitor_indicator flow     ...共用参数...
python -m competitor_indicator audience ...共用参数... [--audience-action 搜索,购买] [--audience-days 30]
```

出完整 HTML 请直接跑 `analyze`，不要手动拼 JSON。

---

## 常见问题

| 现象 | 处理 |
|------|------|
| 未找到 workspace / runtime | 确认 cwd 在 DeepSeek Agent workspace 内 |
| Cookie 无效 | 检查平台绑定 sycm 账号是否过期 |
| 限流 | 等待后重试（接口串行间隔 ≥1.2s） |
| 缺洞察文件 | 按 `insights_artifacts` 路径写 md 后 `report` |
| 洞察校验失败 | 补全 `##` 小节、字数，去掉禁用词 |
| 报告无加粗 | 依赖 `markdown` 包，确保环境已安装 |

---

## 参考

- 接口与字段映射：`references/api_notes.md`
- 洞察模板：`references/insights_flow_template.md`、`references/insights_audience_template.md`

## 代码结构

```
competitor_indicator/
├── fetch/       # 数据原子：overall / flow / audience
├── parse/       # 解析原子；merge.py 仅 analyze 合并
├── insights/    # AI 洞察：读/校验 artifacts 下 md
├── report/      # HTML + insights 卡片渲染
├── storage/     # SQLite 历史
└── cli/         # 子命令编排
```
