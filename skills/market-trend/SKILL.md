---
name: market-trend
description: |
  生意参谋市场排行趋势：指定类目 4 周期（周/月）商品排行，分析上升/下降/新上榜/跌出榜/持平，输出 JSON + CSV。
  榜单：交易总量、交易增速、流量总量、加购收藏、新品流量。
  触发：市场排行趋势、排名变化、新上榜、跌出榜、持续上升商品。
  排除：关键词拓词/排行榜（关键词助手）、商品搜索大盘（淘宝SEO结果）。
  凭证：平台连接里绑定的 **sycm（生意参谋）** 账号。
metadata:
  builtin_skill_version: "1.2"
  dsagent:

    display_name: "生意参谋市场排行分析"
    emoji: "📈"
---

> `cd "{this_skill_dir}" && python -m market_trend ...`
> 依赖：Python 3.10+、`httpx`；运行时由 DeepSeek Agent 注入 `{workspace}/.dsagent/runtime/`（`workspace_cache` + `platform_client`）
> 绑定：Connect `GET /api/v1/accounts?include_cookie=false`；平台 API：`POST /api/v1/proxy`（cookie 不进入技能进程）
> 产物：stdout JSON + CSV 在 `{workspace}/artifacts/`；payload 写入 Connect skill-cache

# 重要：命令格式

**数据获取命令没有子命令名，直接传参数：**
```bash
# 正确
python -m market_trend --cate_id 29

# 错误 — 没有 trend 子命令！
python -m market_trend trend --cate_id 29 ...
```

**参数用下划线（`_`）不是连字符（`-`）：**
```bash
# 正确: --rank_type, --trend_mode
# 错误: --rank-type, --trend-mode
```

**输出说明：JSON 默认 stdout；CSV 写入 `{workspace}/artifacts/`；完整 payload 写入 Connect skill-cache。**
- CSV 路径记录在 stdout JSON 的 `csv_path` 字段中

## 前置条件

1. 在 **平台连接** 添加并登录 **生意参谋**（`platform=sycm`）
2. 将该账号 **绑定到当前对话的智能体**
3. 用 `get_platform_bindings` 确认 `sycm` 为 `valid`（可选）

> 会话失效时退出码为 2，请在平台连接重新登录 sycm。

---

# 能力说明

本 Skill 提供三个独立能力，Agent 根据用户意图**按需组合**。

| 能力 | 命令 | 适用场景 |
|------|------|----------|
| **类目查询** | `python -m market_trend list-categories ...` | 不知道类目ID时，按名称搜索类目 |
| **数据获取** | `python -m market_trend --cate_id <ID>` | 查趋势数据、对比排名变化 |
| **洞察生成** | Agent 读取 JSON 自行撰写 | 深度分析、策略建议 |
| **HTML 报告** | `python -m market_trend inject-report ...` | 蓝白主题可视化报告（含可选 AI 洞察） |

## 如何判断该走几步

- **不知道类目ID**：用户说"宠物类目""猫粮类目"但没给 cate_id → 先执行 `list-categories --keyword 宠物` 查询类目ID，向用户确认后再获取数据。搜索会自动返回父类目及其所有子类目，方便用户选择具体品类。
- **只需数据**：用户问"xx类目排名变化""有哪些新上榜商品" → 只执行数据获取，直接用 JSON 数据回答
- **需要分析**：用户说"帮我分析市场趋势""找持续上升的商品" → 数据获取 + 洞察生成，以文字形式交付
- **需要报告**：用户说"出一份趋势分析报告" → 三步全走

## 注意事项

- **任何一步失败立即停止，不要跳过失败的步骤继续往下走。**
- **单次数据获取耗时约 15-30 秒**（4 周期 × 5 页），多榜单查询请**逐个串行执行**，不要用 `&&` 串联多条命令（容易超时）。
- **不要重复生成 CSV** — 数据获取已自动生成 CSV 到 `artifacts/`，JSON 的 `csv_path` 即真实路径。

---

# 类目查询

当用户提到类目名称但不知道类目 ID 时，先用此命令查询。

## 按名称搜索类目

```bash
cd "{this_skill_dir}" && python -m market_trend list-categories --keyword 宠物
```

## 查询所有可用类目

```bash
cd "{this_skill_dir}" && python -m market_trend list-categories
```

## 参数一览

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--keyword` | 类目名称搜索关键词（模糊匹配） | 空（列出全部） |

## JSON 输出结构

```json
{
  "status": "success",
  "keyword": "狗",
  "total": 159,
  "categories": [
    {
      "cate_id": 217309,
      "cate_name": "狗狗",
      "path": "宠物/宠物食品及用品 > 狗狗",
      "level": 2,
      "is_leaf": true,
      "root_cate_id": 29,
      "root_cate_name": "宠物/宠物食品及用品",
      "children_count": 0,
      "match_type": "direct"
    },
    {
      "cate_id": 201816206,
      "cate_name": "全价狗主粮",
      "path": "宠物/宠物食品及用品 > 全价狗主粮",
      "level": 2,
      "is_leaf": false,
      "root_cate_id": 29,
      "root_cate_name": "宠物/宠物食品及用品",
      "children_count": 6,
      "match_type": "direct"
    }
  ]
}
```

- `match_type: "direct"` — 名称直接匹配关键词的类目
- `match_type: "child"` — 父类目匹配后自动展开的子类目

## Agent 使用流程

1. 用户说 "查看宠物类目市场趋势"
2. Agent 执行: `python -m market_trend list-categories --keyword 宠物`
3. 返回父类目 + 所有子类目，Agent 向用户确认: "找到宠物类目下有以下子类目：水族食品、猫/狗保健品、猫/狗如厕用品等，你想查哪个？还是查整个宠物大类？"
4. 用户确认后，用对应 `cate_id` 执行趋势分析

---

# 数据获取

## 基础用法

```bash
cd "{this_skill_dir}" && python -m market_trend --cate_id <类目ID>
```

## 指定榜单类型

```bash
# 交易总量（默认）
python -m market_trend --cate_id 50011999 --rank_type gmv

# 交易增速
python -m market_trend --cate_id 50011999 --rank_type growth

# 流量总量
python -m market_trend --cate_id 50011999 --rank_type flow

# 加购收藏
python -m market_trend --cate_id 50011999 --rank_type add

# 新品流量
python -m market_trend --cate_id 50011999 --rank_type newitm_ipv
```

## 月趋势模式

```bash
python -m market_trend --cate_id 50011999 --trend_mode month
```

## 指定日期范围

```bash
# 指定基准周（会自动向前推 3 周，共 4 周数据）
python -m market_trend --cate_id 50011999 --date_range "2026-03-17|2026-03-23"
```

## 限制页数（加速）

```bash
# 每个周期只取前 3 页（60 条），共 4 周期
python -m market_trend --cate_id 50011999 --max_pages 3
```

## 参数一览

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--cate_id` | 类目 ID（必填） | — |
| `--cate_flag` | 类目标记 | 空 |
| `--rank_type` | 榜单类型: `gmv`/`growth`/`flow`/`add`/`newitm_ipv` | `gmv` |
| `--trend_mode` | 趋势模式: `week`=周趋势, `month`=月趋势 | `week` |
| `--date_range` | 基准日期范围 `YYYY-MM-DD\|YYYY-MM-DD` | 自动计算上周/上月 |
| `--max_pages` | 每个周期最大页数（每页20条），0=全部 | `5`（100条） |
| `--seller_type` | 店铺类型: `-1`=全部, `0`=淘宝, `1`=天猫 | `-1` |
| `--price_seg` | 价格带筛选 | 空 |
| `--output_format` | 输出格式: `json`/`text`/`table` | `json` |

- 退出码=0 继续 | =2 引导用户重新登录 | =4 检查类目ID
- 验证：stdout JSON 中 `"status":"success"`，`trend_items` 有数据
- 产出：stdout JSON + CSV 在 `{workspace}/artifacts/`；排行与报告 payload 缓存于 Connect skill-cache（表 `cache_market_trend_*`）

---

# 洞察生成（Agent 职责，非 Skill 命令）

读取数据获取阶段的 JSON，撰写 insights.md 文件。**格式约束**：
- 只用 `##` 二级标题（禁止 `#` 一级标题）
- 标题禁止 emoji
- 至少 3 个 `##` 模块（推荐 7-8 个），内容 >= 500 字
- 必须包含：趋势概览、上升/下降商品分析、策略建议

推荐模块结构：
```
## 市场趋势概览        （时间范围、商品总数、各趋势分布）
## 持续上升商品TOP5    （连续4周排名提升的商品）
## 新上榜商品分析      （本周新进入排行的商品特征）
## 排名下滑商品        （需要关注的下滑商品）
## 天猫vs淘宝格局      （天猫/淘宝商品占比与趋势差异）
## 流量与转化洞察      （访客数、支付买家数变化趋势）
## 竞品动态            （主要竞品排名变化）
## 核心策略建议        （短期/中期/长期方案）
```

---

# HTML 报告生成

```bash
cd "{this_skill_dir}" && python -m market_trend inject-report \
  --insights_md "{workspace}/artifacts/洞察.md" [--cate_id 29] [--rank_type gmv] [--trend_mode week]
```

- 从 Connect skill-cache 读取趋势 payload（默认最近一次，或按 cate_id/rank_type/trend_mode 匹配）
- 输出 stdout JSON 含 `report_path` 和 `csv_path`

---

# 使用示例

## 不知道类目ID（先查后用）

用户："帮我看看宠物类目的市场趋势"
```bash
# Step 1: 查询类目ID
cd "{this_skill_dir}" && python -m market_trend list-categories --keyword 宠物
```
→ 返回匹配类目列表，Agent 向用户确认是哪个子类目（如猫粮 50011999）。
```bash
# Step 2: 用确认的类目ID查趋势
cd "{this_skill_dir}" && python -m market_trend --cate_id 50011999
```

## 只查数据（一步完成）

用户："女装类目最近有哪些新上榜商品？"
```bash
cd "{this_skill_dir}" && python -m market_trend --cate_id 16 --max_pages 3
```
→ 读取 JSON 中 `trend_items` 里 `trend=="new"` 的商品，直接回答。

## 查数据 + 深度分析（两步）

用户："帮我分析猫粮类目的市场趋势"
```bash
cd "{this_skill_dir}" && python -m market_trend --cate_id 50011999
```
→ 读取 JSON，撰写洞察分析（持续上升商品、新上榜、竞争格局、策略建议）。

## 多榜单对比

用户："对比猫粮类目的交易和流量排名"

**逐个执行，不要用 `&&` 串联（会超时）：**
```bash
# 第1次执行：交易总量
cd "{this_skill_dir}" && python -m market_trend --cate_id 50011999 --rank_type gmv
```
```bash
# 第2次执行：流量总量
cd "{this_skill_dir}" && python -m market_trend --cate_id 50011999 --rank_type flow
```
→ 两次都成功后，读取两个 JSON，对比分析交易排名 vs 流量排名的差异。

## 月趋势分析

用户："看看最近几个月的趋势变化"
```bash
cd "{this_skill_dir}" && python -m market_trend --cate_id 50011999 --trend_mode month
```

---

# 退出码速查

| 退出码 | 含义 | 处理 |
|--------|------|------|
| 0 | 成功 | 继续 |
| 1 | 参数错误 | 检查 cate_id 是否正确 |
| 2 | 会话无效 | 在平台连接重新登录 sycm 并绑定智能体 |
| 3 | API限流 | 5分钟后重试 |
| 4 | API错误 | 检查类目ID是否有权限 |

# JSON 输出结构

```json
{
  "status": "success",
  "rank_type": "gmv",
  "rank_type_label": "交易总量",
  "trend_mode": "week",
  "date_ranges": [
    "2026-03-03|2026-03-09",
    "2026-03-10|2026-03-16",
    "2026-03-17|2026-03-23",
    "2026-03-24|2026-03-30"
  ],
  "cate_id": "50011999",
  "total_items": 150,
  "trend_items": [
    {
      "item_id": "...",
      "title": "...",
      "pict_url": "...",
      "detail_url": "...",
      "shop_title": "...",
      "is_tmall": true,
      "ranks": {
        "period1": 5,
        "period2": 3,
        "period3": 2,
        "period4": 1
      },
      "weekly_metrics": {
        "period1": {"payByrCnt": "5000~7500", "uv": "10万~15万"},
        "period2": {"payByrCnt": "7500~1万", "uv": "15万~20万"},
        "period3": {"payByrCnt": "7500~1万", "uv": "15万~20万"},
        "period4": {"payByrCnt": "1万~1.5万", "uv": "20万~30万"}
      },
      "trend": "up",
      "rank_change": -4,
      "current_rank": 1,
      "first_appear_period": 1,
      "core_keyword": "猫粮,全价猫粮"
    }
  ],
  "summary": {
    "total": 150,
    "rising_count": 30,
    "falling_count": 20,
    "new_count": 15,
    "dropped_count": 10,
    "stable_count": 25,
    "continuously_rising": 8
  },
  "periods_summary": [
    {"period_index": 0, "date_range": "2026-03-03|2026-03-09", "date_label": "03.03-03.09", "record_count": 100, "loaded_count": 100},
    {"period_index": 1, "date_range": "2026-03-10|2026-03-16", "date_label": "03.10-03.16", "record_count": 100, "loaded_count": 100},
    {"period_index": 2, "date_range": "2026-03-17|2026-03-23", "date_label": "03.17-03.23", "record_count": 100, "loaded_count": 100},
    {"period_index": 3, "date_range": "2026-03-24|2026-03-30", "date_label": "03.24-03.30", "record_count": 100, "loaded_count": 100}
  ],
  "csv_path": "/path/to/市场排行_趋势分析_交易总量_20260303~20260330_153522.csv",
  "error_code": 0
}
```

## 榜单类型与指标字段对照

| 榜单类型 | rank_type | 指标字段 |
|----------|-----------|----------|
| 交易总量 | `gmv` | payByrCnt（支付买家数）, uv（访客数）, coreKeyWord |
| 交易增速 | `growth` | payByrCnt, uv, coreKeyWord |
| 流量总量 | `flow` | uv（访客数）, searchUv（搜索人数） |
| 加购收藏 | `add` | cartByrCnt（加购人数）, cltByrCnt（收藏人数）, uv |
| 新品流量 | `newitm_ipv` | uv, payByrCnt, cartByrCnt |

# 数据存储

每次数据获取成功后，经 HTTP 写入 Connect skill-cache：

- 表 `cache_market_trend_rank` / `cache_market_trend_runs`，按 `shop_key` 隔离
- 入库失败则命令失败（无软吞）

---

# 常见问题

- **不知道 cate_id** → 使用 `list-categories --keyword 类目名` 查询，或在生意参谋市场排行页面 URL 中找 `cateId=xxx`
- **数据量太大加载慢** → 使用 `--max_pages 3` 限制每周期只取前 60 条
- **提示会话无效** → 在平台连接重新登录 sycm
