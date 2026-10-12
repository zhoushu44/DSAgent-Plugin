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

万相台付费搜索场景；展现/点击指数为相对指数。接口细节见下方「API 接口」章节。

---

## API 接口

> 通过 Chrome DevTools 网络抓包获取，2026-04-10

### Base URL

`https://one.alimama.com/`

### 请求头

```
Content-Type: application/json;charset=UTF-8
X-Requested-With: XMLHttpRequest
Origin: https://one.alimama.com
Referer: https://one.alimama.com/index.html
Accept: application/json, text/javascript, */*; q=0.01
```

### 端点总览

| 端点 | moduleId | 功能 |
|------|----------|------|
| `POST /cube/triggerDynamicModule.json` | 1571 | 关键词类目匹配 |
| `POST /cube/triggerDynamicModule.json` | 1541 | 市场趋势时间序列（最多13个月） |
| `POST /cube/triggerDynamicModule.json` | 1465 | 市场数据总结（AI 生成） |

Query params: `csrfId=<token>&bizCode=universalBP`

### 通用请求体

```json
{
  "moduleId": <int>,
  "params": { ... },
  "csrfId": "<token>",
  "bizCode": "universalBP",
  "loginPointId": "<token>"
}
```

### moduleId=1571 — 关键词类目匹配

获取关键词对应的行业类目列表。

params:
```json
{
  "bizCode": "onebpSearch",
  "originalWordList": ["充电宝"],
  "adgroupIds": "",
  "needGray": true
}
```

返回示例:
- `201272600` = "3C数码配件 便携电源"
- `201687701` = "汽车用品/电子/清洗/改装 汽车电子防盗安防"
- `50024094` = "3C数码配件 手机配件"
- `-999` = "全部"

### moduleId=1541 — 市场趋势时间序列

获取关键词在指定时间范围内的每日趋势数据。支持最多13个月。

params:
```json
{
  "wordCategoryList": [{"word": "充电宝", "cateId": 201272600}],
  "startTime": "2025-03-10",
  "endTime": "2026-04-09",
  "isShowWordVs": 1,
  "isShowAdgroupVs": 0,
  "isShowShopVs": 0,
  "wordList": "充电宝",
  "strategyBidwordNameEqual": "充电宝",
  "vsName": "",
  "campaignAdgroupText": "&nbsp;",
  "needGray": true
}
```

返回数据:
- `chartGroup` 数组，每个元素代表一个指标的图表
- 每个 chartGroup 中有 `dataList`，每项为一天的数据点
- 数据字段（注意：字段名带关键词前缀）:
  - `theDate`: 日期
  - `{keyword}impressionIndex`: 展现指数
  - `{keyword}clickIndex`: 点击指数
  - `{keyword}ctr`: 点击率
  - `{keyword}cvr`: 点击转化率
  - `{keyword}competitionIndex`: 竞争指数
  - `{keyword}avgPrice`: 市场均价

6个指标:
1. impressionIndex（展现指数）— 格式: 整数
2. clickIndex（点击指数）— 格式: 整数
3. ctr（点击率）— 格式: 百分比
4. cvr（点击转化率）— 格式: 百分比
5. competitionIndex（竞争指数）— 格式: 整数
6. avgPrice（市场均价）— 格式: 金额

### moduleId=1465 — 市场数据总结

获取 AI 生成的关键词市场分析总结。

params:
```json
{
  "originalWord": "充电宝",
  "categoryId": 201272600,
  "startTime": "2026-03-11",
  "endTime": "2026-04-09",
  "needGray": true
}
```

返回 5+1 个总结卡片:
1. 流量趋势: 7天展现指数、周环比、平均CVR
2. 竞争情况: 竞争指数、最优出价区间
3. 人群特征: 性别和消费层级
4. 地域特征: 高曝光地域和高转化地域
5. 时间特征: 流量高峰时段和高CTR时段
6. 词的特性: 搜索指数、竞争指数、均价、CVR、展现指数

### 限流

建议请求间隔 >= 1.2 秒，与推广管理助手一致。

---

## 证据分级（输出结论前必读）

本技能输出任何"结论"前，先按**证据四分级**标注级别（Observed 直采 / Calculated 计算 /
Proxy 代理推断 / Unknown 未知），并遵守五条禁止推断——尤其是：
**sycm/万相台指数一律标 Proxy，不得当绝对量**；**Unknown 不得当 0 参与平均**。

完整分级表、五条禁止推断与国内场景注释见 [references/evidence-rules.md](references/evidence-rules.md)。

## 工作流

1. 确认用户已绑定 sycm 账号并绑定到当前智能体
2. 若不确定类目 ID，先执行 `categories <词>` 匹配行业类目
3. 执行 `trend <词> --cate_id <ID> --months <N>` 获取日趋势数据
4. 读取 stdout JSON，检查 `csv_path` 和 `report_path` 是否存在
5. 若用户需要市场总结，执行 `summary <词>`
6. trend 成功后追问是否需要深度分析，用户同意则调用智能数据分析技能

## 错误处理

- 退出码=2 时提示未绑定 sycm 或会话无效，需在平台连接重新登录
- 退出码=3 时为限流，约 5 分钟后重试
- 退出码=4 时为 API 业务错误，检查参数和类目 ID 是否正确
- 请求间隔建议 >= 1.2 秒以避免限流
