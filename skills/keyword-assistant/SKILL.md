---
name: keyword-assistant
description: |
  生意参谋关键词挖掘：关联词拓展（搜索人气/点击率/转化率/供需比/环比）与热搜/飙升/新词排行榜。
  触发：关键词分析、蓝海词、长尾词、高转化词、标题优化、热搜榜、飙升词、供需比。
  排除：13 个月流量趋势（万相台关键词解析）、商品市场大盘（淘宝SEO结果）。
  凭证：平台连接里绑定的 **sycm（生意参谋）** 账号。
metadata:
  builtin_skill_version: "1.2"
  dsagent:

    display_name: "生意参谋关键词排行"
    emoji: "🔑"
---

> `cd "{this_skill_dir}" && python -m keyword_assistant ...`
> 依赖：Python 3.10+、`httpx`；运行时由 DeepSeek Agent 注入 `{workspace}/.dsagent/runtime/`（`workspace_cache` + `platform_client` + `runtime_http`）
> 绑定：Connect `GET /api/v1/accounts?include_cookie=false`；平台 API：`POST /api/v1/proxy`（cookie 不进入技能进程）
> 产物：stdout JSON + CSV/HTML 在 `{workspace}/artifacts/`；payload 写入 Connect `skill_cache.db`（按 shop_key）

## 前置条件

1. 在 **平台连接** 添加并登录 **生意参谋**（`platform=sycm`）
2. 将该账号 **绑定到当前对话的智能体**
3. 用 `get_platform_bindings` 确认 `sycm` 为 `valid`（可选）
4. 在 Chat 中由 Agent 执行本技能（cwd 为智能体 workspace）

> 会话失效时退出码为 2，请在平台连接重新登录 sycm。

---

# 能力说明

本 Skill 提供三个独立能力，Agent 根据用户意图**按需组合**，不必每次都走完全部步骤。

| 能力 | 命令 | 适用场景 |
|------|------|----------|
| **数据获取** | `python -m keyword_assistant ...` | 查数据、回答具体问题、对比关键词 |
| **洞察生成** | Agent 读取 JSON 自行撰写 | 用户要深度分析、策略建议 |
| **HTML 报告** | `python -m keyword_assistant inject-report ...` | 用户要完整可视化报告 |

## 如何判断该走几步

- **只需数据**：用户问"xx关键词搜索人气多少""帮我查下热搜榜""猫粮和猫砂哪个搜索人气高" → 只执行数据获取，直接用 JSON 数据回答
- **需要分析**：用户说"帮我分析xx关键词""找蓝海词""给我选品建议" → 数据获取 + 洞察生成，以文字形式交付
- **需要报告**：用户说"生成报告""出一份分析报告""要HTML报告" → 三步全走

**原则：任何一步失败立即停止，不要跳过失败的步骤继续往下走。**

---

# 数据获取

## 关联词拓展（默认模式）
```bash
cd "{this_skill_dir}" && python -m keyword_assistant "关键词"
```

多关键词批量拓展：
```bash
cd "{this_skill_dir}" && python -m keyword_assistant "关键词1" "关键词2" "关键词3"
```

## 搜索排行榜
```bash
cd "{this_skill_dir}" && python -m keyword_assistant --mode rank
```

排行榜子类型：
```bash
# 热搜榜（默认）
python -m keyword_assistant --mode rank --rank_type hot
# 飙升榜
python -m keyword_assistant --mode rank --rank_type rise
# 新词榜
python -m keyword_assistant --mode rank --rank_type new
```

## 参数一览

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--mode` | 查询模式：`expand`=关联词拓展, `rank`=搜索排行榜 | `expand` |
| `--rank_type` | 排行榜类型（仅 rank 模式）：`hot`=热搜, `rise`=飙升, `new`=新词 | `hot` |
| `--kw_type` | 搜索词类型（仅 rank 模式）：`search`=搜索词, `category`=类目词 | `search` |
| `--order_by` | 排序字段：`seIpvUvHits`=搜索人气, `payByrCnt`=支付买家数, `clickThroughRate`=点击率 | `seIpvUvHits` |
| `--cate_id` | 淘宝类目ID（可选，解决权限问题） | 空 |
| `--max_pages` | 最大页数（expand每页10条，rank每页50条） | `10` |
| `--date_range` | 日期范围 `YYYY-MM-DD\|YYYY-MM-DD`，或 `recent7`/`recent30` | 近7天 |
| `--output_format` | 输出格式：`json`/`text`/`table` | `json` |

- 退出码=0 继续 | =2 引导用户在平台连接重新登录 sycm | =3 提示稍后重试 | =4 加 `--cate_id` 重试
- 验证：stdout JSON 中 `"status":"success"`，expand 模式 `top_keywords` 有数据，rank 模式 `keywords` 有数据
- 产出：stdout JSON（Agent 读取）+ CSV 在 `{workspace}/artifacts/`；完整 payload 写入 Connect skill-cache

## 数据存储

每次数据获取成功后，经 HTTP 写入 Connect 用户级 `skill_cache.db`：

- 表：`cache_keyword_assistant_*` + `cache_keyword_assistant_runs`
- `runs` 表保存完整报告 payload，供 `inject-report` 读取（不写 artifacts JSON）
- 按 `shop_key` 隔离；技能进程不打开 SQLCipher

---

# 洞察生成（Agent 职责，非 Skill 命令）

读取数据获取阶段 stdout JSON 或 DB 缓存，撰写 insights.md 文件。**格式约束（inject-report 自动验证，不通过则终止）**：
- 只用 `##` 二级标题（禁止 `#` 一级标题）
- 标题禁止 emoji（写 `## 蓝海词TOP5` 不要写 `## [diamond] 蓝海词TOP5`）
- 至少 3 个 `##` 模块（推荐 7-8 个），内容 >= 500 字
- 必须包含：TOP 排名、转化率、搜索人气、策略建议

推荐模块结构（expand 模式）：
```
## 市场数据概览        （时间、词数、核心指标）
## 蓝海机会词TOP5      （供需比最高的词+分析）
## 高转化词TOP3        （转化率最高的词+策略）
## 搜索人气环比变化     （利用环比数据分析趋势上升/下降词）
## 季节性/趋势洞察     （热点词、周期性）
## 品牌/竞争格局       （品牌词占比）
## 风格/细分市场       （差异化机会）
## 核心策略建议        （短期/中期/长期方案）
```

推荐模块结构（rank 模式）：
```
## 热搜词数据概览      （排行榜类型、时间范围、总词数）
## 热搜TOP10分析       （搜索人气最高的词+趋势）
## 高转化热搜词        （转化率最高的热搜词）
## 免费流量机会        （免费点击率高的词）
## 飙升词/新词洞察     （如使用rise/new类型）
## 核心策略建议        （选品/标题优化方向）
```

---

# HTML 报告生成

```bash
cd "{this_skill_dir}" && python -m keyword_assistant inject-report \
  --insights_md "{workspace}/artifacts/洞察.md" [--mode expand] [--seed_keyword 男装]
```
- 从 Connect skill-cache 读取最近一次同 mode 的 payload（无需 `--data_json`）
- 输出 stdout JSON 含 `report_path` 和 `csv_path`
- **必须从输出 JSON 中解析 `report_path`，然后执行 `open <report_path>` 在浏览器中打开 HTML 报告**
- 交付给用户：HTML 报告 + CSV 文件 + 文字摘要

---

# 使用示例

## 只查数据（一步完成）

用户："猫粮的搜索人气是多少？"
```bash
cd "{this_skill_dir}" && python -m keyword_assistant "猫粮" --max_pages 1
```
→ 读取 JSON，直接回答用户问题，不需要洞察和报告。

## 只查数据 + 简单对比

用户："猫粮和猫砂哪个搜索人气高？"
```bash
cd "{this_skill_dir}" && python -m keyword_assistant "猫粮" "猫砂" --max_pages 1
```
→ 读取 JSON，对比两个关键词的数据，直接回答。

## 查数据 + 深度分析（两步）

用户："帮我分析男装市场，找蓝海词"
```bash
cd "{this_skill_dir}" && python -m keyword_assistant "男装"
```
→ 读取 JSON，撰写洞察分析，以文字形式交付（蓝海词 TOP5、高转化词、策略建议）。

## 完整报告（三步）

用户："帮我出一份男装关键词分析报告"

**1. 获取数据：**
```bash
cd "{this_skill_dir}" && python -m keyword_assistant "男装"
```

**2. 生成洞察：** Agent 读取 stdout JSON，将洞察写入 `{workspace}/artifacts/男装洞察.md`

**3. 生成报告：**
```bash
cd "{this_skill_dir}" && python -m keyword_assistant inject-report \
  --insights_md "{workspace}/artifacts/男装洞察.md" --seed_keyword 男装
```
→ 从输出 JSON 取 `report_path`，在浏览器打开 HTML 报告。

## 搜索排行榜

用户："现在淘宝热搜都搜什么？"
```bash
cd "{this_skill_dir}" && python -m keyword_assistant --mode rank
```
→ 读取 JSON，直接告诉用户热搜 TOP10。

## 多关键词 + 自定义排序

```bash
cd "{this_skill_dir}" && python -m keyword_assistant "猫粮" "猫砂" "猫玩具" \
  --order_by payByrCnt --max_pages 5
```

---

# 退出码速查

| 退出码 | 含义 | 处理 |
|--------|------|------|
| 0 | 成功 | 继续 |
| 1 | 参数错误 | 检查关键词非空 |
| 2 | 会话无效 | 在平台连接重新登录 sycm 并绑定智能体 |
| 4 | API权限错误 | 加 `--cate_id` 重试 |

# JSON 输出结构

## expand 模式（关联词拓展）

Step 1 成功（单关键词返回对象，多关键词返回数组）：
```json
{
  "status": "success",
  "seed_keyword": "男装",
  "date_range": "2026-03-17|2026-03-23",
  "total_results": 100,
  "top_keywords": [
    {
      "rank": 1,
      "keyword": "男装",
      "search_popularity": "15万~30万",
      "click_rate": "1.32",
      "pay_buyer_cnt": "5000~7500",
      "pay_conv_rate": "5%~7.5%",
      "demand_supply_ratio": "1.94",
      "tmall_click_ratio": "0.528",
      "free_click_rate": "0.85",
      "search_popularity_change": "0.15",
      "click_rate_change": "-0.03"
    }
  ],
  "csv_path": "/path/to/data.csv",
  "error_code": 0
}
```

新增字段说明：
- `free_click_rate`：免费点击率
- `search_popularity_change`：搜索人气环比变化
- `click_rate_change`：点击率环比变化

## rank 模式（搜索排行榜）

```json
{
  "status": "success",
  "mode": "rank",
  "rank_type": "hot",
  "kw_type": "search",
  "date_range": "2026-03-17|2026-03-23",
  "total_results": 50,
  "keywords": [
    {
      "rank": 1,
      "keyword": "连衣裙",
      "search_popularity": "30万~50万",
      "pay_rate": "5%~7.5%",
      "click_rate": "1.85",
      "free_click_rate": "0.92"
    }
  ],
  "csv_path": "/path/to/搜索排行_热搜.csv",
  "error_code": 0
}
```

## Step 3 成功（两种模式通用）：
```json
{"report_path":"/path/to/keyword_report_20260324_153522.html","csv_path":"/path/to/关键词数据_男装.csv"}
```

# 技能协作链路

本 Skill 是电商分析三步链的中间环节：

```
市场分析 → 关键词助手 → 关键词流量解析 → 智能数据分析
（看大盘）   （拓展选词）   （长期趋势）     （深度挖掘）
```

用户可能从「市场分析」的追问链路进入本 Skill，分析完成后应继续引导到「关键词流量解析」。

## 完成后追问：13个月流量趋势

**当数据获取成功（退出码=0）且用户分析了具体关键词时**，在交付结果后主动追问：

> "需要查看「{关键词}」过去13个月的付费搜索流量趋势吗？可以帮你判断这个词的季节性规律和当前是否适合加大投放。"

用户同意后，调用「关键词流量解析」Skill：
```bash
cd "{keyword_traffic_dir}" && python -m keyword_traffic trend "{关键词}"
```

- 仅对 expand 模式中用户明确关注的关键词追问（种子词或分析中重点提及的词），不要对 rank 模式追问
- 如果用户查询了多个关键词，选最有代表性的 1-2 个词追问
- 追问仅一次，用户拒绝后不再重复
- 趋势数据获取成功后，可进一步引导用「智能数据分析」对 CSV 做深度挖掘（季节性规律、流量拐点、环比波动等）

---

# 常见错误

1. **insights.md 只有 1-2 个模块** → 报告只有 1 张卡片，至少 3 个，推荐 7-8 个
2. **标题带 emoji** (如 `## [emoji] 蓝海词`) → 验证报错，改为纯文字
3. **用了一级标题** (`# 分析`) → 验证报错，只能用 `##`
4. **inject-report 缺少 insights_md** → 生成报告前必须先有洞察文件
