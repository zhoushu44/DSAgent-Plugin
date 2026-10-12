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

---

## API 接口

> 通过 Chrome DevTools 网络抓包获取，2026-04-10。本技能使用两个平台的 API：淘宝 MTOP（商品搜索）+ 生意参谋（关联词拓展）。

### API 1: 淘宝 MTOP 商品搜索

**POST /h5/{api}/{version}/**

获取淘宝搜索商品列表（价格/标题/销量等），用于价格分布和竞争分析。

- Base URL: `https://h5api.m.taobao.com`
- API: `mtop.relationrecommend.wirelessrecommend.recommend`
- Version: `2.0`
- App Key: `12574478`

请求结构（MTOP JSONP 协议）:
```json
{
  "appId": "34385",
  "params": "{\"device\":\"HMA-AL00\",\"q\":\"充电宝\",\"page\":1,\"n\":48,...}"
}
```

`params` 内的关键字段:
- `q`: URL 编码的搜索关键词
- `page`/`n`: 页码/每页数量（48）
- `sort`: 排序方式（default/price-asc/price-desc/sale-desc）
- `start_price`/`end_price`: 价格区间
- `myCNA`: 来自绑定上下文的 cna（缺失会 FAIL_BIZ_PARAM_ERR）
- `userAgent`: UA 字符串

extra_params:
```json
{ "timeout": "10000", "appKey": "12574478" }
```

返回结构:
```json
{
  "data": {
    "resultList": [
      {
        "item": {
          "item_id": "123",
          "title": "充电宝...",
          "price": "59.9",
          "pic_path": "...",
          "sold": "1000"
        }
      }
    ]
  }
}
```

重试策略: `call_json_with_retries(max_retries=3, retry_on=("rate_limit",))`
- MTOP 首次调用会返回 `FAIL_SYS_TOKEN_EMPTY`（token 引导响应），网关合并新 `_m_h5_tk` 后报 `rate_limit` — 重试一次即成功。

### API 2: 生意参谋关联词拓展

**GET /mc/rest/productSearchWord/relatedSearchWord.json**

获取指定关键词的关联搜索词列表（搜索人气/点击率/支付转化率/供需比）。

- Base URL: `https://sycm.taobao.com`
- Endpoint: `/mc/rest/productSearchWord/relatedSearchWord.json`

params:
```json
{
  "dateRange": "2026-04-03|2026-04-09",
  "dateType": "recent7",
  "pageSize": 50,
  "page": 1,
  "order": "desc",
  "orderBy": "seIpvUvHits",
  "keyWord": "充电宝",
  "cycleFlag": "cycle",
  "rankType": "related",
  "device": "0",
  "marketVersion": "free"
}
```

返回结构:
```json
{
  "data": {
    "data": [
      {
        "relatedSekeyword": { "value": "充电宝快充" },
        "seIpvUvHits": { "value": "12345", "cycleCrc": "↑" },
        "clickThroughRate": { "value": "3.5%" },
        "payConvRate": { "value": "2.1%" },
        "simWeight": { "value": "0.85" }
      }
    ]
  }
}
```

**注意**: sycm 与 taobao 是两套域会话，sycm 未登录很常见。此时降级为「只基于商品数据」分析，并在 `data_gaps` 里提示用户重新登录，绝不因可选层失败而让整个技能失败。

### 请求头

网关自动注入 Cookie/UA/Referer/Accept。adapter 手动指定：
```
Referer: https://sycm.taobao.com/
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
```

### 限流

- 网关层: 账号间隔 4s（`ACCOUNT_INTERVAL_SECONDS`）
- MTOP 层: `MTOP_THROTTLE = CallThrottle(min_interval=4.5, jitter=1.5)`
- sycm 层: `SYCM_THROTTLE = CallThrottle(min_interval=1.8, jitter=0.7)`
- 分页间隔: `time.sleep(random.uniform(0.5, 1.0))`

---

## 证据分级（输出结论前必读）

本技能输出任何"结论"前，先按**证据四分级**标注级别（Observed 直采 / Calculated 计算 /
Proxy 代理推断 / Unknown 未知），并遵守五条禁止推断——尤其是：
**sycm/万相台指数一律标 Proxy，不得当绝对量**；**Unknown 不得当 0 参与平均**。

完整分级表、五条禁止推断与国内场景注释见 [references/evidence-rules.md](references/evidence-rules.md)。
