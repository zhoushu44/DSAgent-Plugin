---
name: demand-niche-analysis
description: |
  细分需求裂变选品分析：从核心关键词出发，采集关键词趋势与商品市场数据，
  按「人群×场景×功能×痛点×价格」五维拆解需求，输出分层的需求裂变方向报告。
  触发：细分需求、需求裂变、裂变选品、需求拆解、关键词拆解、选品分析、细分选品。
  排除：单纯的市场行情分析（用 market-analysis）、关键词排行（用 keyword-assistant）。
  凭证：需绑定 taobao（淘宝买家）账号；其他平台适配器后续按同接口扩展。
license: MIT
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "细分需求裂变选品"
    emoji: "🧬"
    platform: taobao
    risk: L0
    requires:
      bins: [python3]
---

# 细分需求裂变选品分析

> 数据与结论仅供选品决策参考；缺失字段提示复核，不用零值替代；推测与事实分开标注。

## 何时使用

- 用户说「细分需求分析」「需求裂变」「裂变选品」→ 本技能
- 用户说「把 XX 关键词拆解一下」「XX 有什么细分方向」「XX 适合什么人群/场景」→ 本技能
- 用户只想要市场行情 / 价格分布 → 用 `market-analysis`，不要用本技能
- 用户只要关键词排行 / 拓词 → 用 `keyword-assistant`，不要用本技能

## 输入

| 参数 | 必填 | 说明 |
|------|:----:|------|
| `keyword` | ✓ | 核心关键词，如「便携榨汁杯」 |
| `audience` |   | 目标人群约束，如「通勤和健身人群」 |
| `scenario` |   | 使用场景约束，如「办公室、户外、旅行」 |
| `price_min` / `price_max` |   | 价格带约束（元） |
| `platform` |   | 目标平台，默认 `taobao`（当前唯一适配器） |
| `item_limit` |   | 商品采集数量，默认 120，上限 200 |

输入示例：

```
keyword=便携榨汁杯 audience=通勤和健身人群 scenario=办公室、户外、旅行
```

或自然语言：「细分需求分析 便携榨汁杯，主要看通勤健身人群，50 到 150 元价位」

## 执行流程

### 1. 平台适配器采集

```bash
python3 {baseDir}/scripts/collect.py --keyword 便携榨汁杯 [--audience ...] [--scenario ...] [--price-min 50] [--price-max 150] [--item-limit 120]
```

适配器架构（多平台通用设计）：

```
adapters/
├── base.py      # PlatformAdapter 抽象基类：统一数据源接口
├── taobao.py    # 淘宝适配器（本期实现）：复用 market-analysis + keyword-assistant 数据链路
└── (后续) douyin.py / pdd.py ...  # 新平台只实现同一个接口
```

**统一数据契约**（任何平台的适配器都必须产出这份结构）：

```json
{
  "platform": "taobao",
  "keyword": "便携榨汁杯",
  "collected_at": "2026-10-02 12:00:00",
  "keyword_trend": [
    {"word": "拓展词", "search_popularity": 12345, "popularity_change": "+5.2%",
     "click_rate": 3.1, "pay_conv_rate": 2.8, "demand_supply_ratio": 0.6}
  ],
  "products": [
    {"title": "...", "price": 89.0, "sales_count": 5000, "is_tmall": false,
     "location": "浙江", "page_rank": 1}
  ],
  "price_distribution": {"p10": 39, "p50": 79, "p90": 199, "mode": "59-99"},
  "data_gaps": ["评价数据未采集（痛点层本期未启用）"]
}
```

### 2. 数据整理层

- 字段统一命名（跨平台字段映射在适配器内完成）
- 去重：标题相似度去重、拓展词去空格归并
- **三层数据标记**：`原始数据`（平台直采）/ `计算数据`（如价格分位、词频统计）/ `AI 判断`（报告里的结论）
- 缺失字段进 `data_gaps`，报告必须显式提示，**不用零值替代**

### 3. AI 分析（Agent 执行）

技能采集完成后输出 `__DSAGENT_RESULT__`，其中 `analysis_prompt` 字段是给 Agent 的完整分析指令。
Agent 按该提示词完成六维拆解与裂变方向生成，把洞察写入 Markdown 后可用 `--report` 生成 HTML。

分析提示词框架（Agent 必须遵守）：

```
你是一名电商需求分析助手。基于输入的关键词趋势、拓展词、商品数据，完成：
1. 清洗标记：缺失、重复、异常数据不得当作有效值；
2. 六维拆解：人群、场景、功能、痛点、价格、竞争——每维给出数据依据；
3. 趋势与周期：判断需求处于萌芽/上升/放量/成熟/衰退，说明依据；
4. 裂变方向：方向 = 核心需求 + 人群 + 场景 + 痛点 + 可验证商品形式；
   每个方向必须含：方向名称、目标人群、使用场景、需求依据、产品建议、
   竞争判断、验证动作、风险提示；
5. 分层：A 类（优先验证）/ B 类（观察测试）/ C 类（暂缓），给出分层理由；
6. 不得把推测描述成事实，不得承诺必然爆款；
7. 数据不足时明确说明需要补充哪些数据；
8. 先结论后依据，按固定报告结构输出。
```

### 4. 报告输出（固定 11 节结构）

| # | 节 | 内容 |
|---|----|----|
| 01 | 关键词概览 | 关键词、平台、采集日期、数据来源、样本量 |
| 02 | 趋势判断 | 近期变化、方向、稳定性（依据拓展词环比） |
| 03 | 人群画像 | 核心人群、动机、关注因素（依据标题词频） |
| 04 | 需求拆解 | 功能需求、体验痛点、价格敏感点 |
| 05 | 商品方向 | 建议研究的商品形态、功能组合、规格、价格带 |
| 06 | 竞争分析 | 竞品集中方向、同质化风险、进入难度 |
| 07 | 产品周期 | 萌芽/上升/放量/成熟/衰退 + 依据 |
| 08 | 切入建议 | 尽快验证 / 持续观察 / 暂缓 |
| 09 | 裂变方向 | A/B/C 分层的可验证方向清单 |
| 10 | 风险提示 | 数据时效、平台规则、供应链、利润、内容投放 |
| 11 | 一句话结论 | 是否值得继续研究 + 下一步动作 |

## 环境变量

执行时由 DSAgent 插件自动注入：`DSCONNECT_URL` / `DSCONNECT_TOKEN` / `DSCONNECT_AGENT_ID` / `DSAGENT_REQUEST` / `DSAGENT_WORKSPACE` / `DSAGENT_SKILL_ROOT`。

## 输出格式

stdout 输出 `__DSAGENT_RESULT__` 单行 JSON：

```json
{
  "ok": true,
  "skill": "demand-niche-analysis",
  "platform": "taobao",
  "keyword": "便携榨汁杯",
  "data_summary": {"related_words": 45, "products": 120, "price_median": 79},
  "data_gaps": ["评价数据未采集"],
  "analysis_prompt": "（给 Agent 的六维拆解指令全文）",
  "files": {"json": "artifacts/niche_数据.json", "csv": "artifacts/niche_数据.csv"}
}
```

## 平台扩展指南（新适配器怎么写）

1. 在 `adapters/` 下新建 `<平台>.py`，继承 `base.py` 的 `PlatformAdapter`
2. 实现 `collect(keyword, constraints) -> NicheData`，把平台原始字段映射到统一数据契约
3. 在 `adapters/__init__.py` 的 `ADAPTERS` 注册表加一行
4. **不需要改**分析层、整理层、报告层——它们只认统一契约

## 错误处理

| 场景 | failure_kind | 处理 |
|------|-------------|------|
| 平台未绑定账号 | `not_bound` | 引导到「账号连接」绑定 taobao |
| 登录失效 | `token_expired` | 重新登录 |
| 采集被风控 | `risk_control` | 调 `dsagent_risk_verify` 后重试 |
| 未实现的平台 | `skill_error` | 提示当前仅支持 taobao，其余开发中 |
| 字段缺失 | — | 进 `data_gaps`，报告提示，不用零值 |
