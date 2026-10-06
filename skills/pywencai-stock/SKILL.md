---
name: pywencai-stock
description: >
  A股行情与榜单数据查询（东方财富公开接口，无需登录、无需 API Key）。
  覆盖涨幅榜/跌幅榜、涨停跌停股池、概念与行业板块榜、板块成分股、个股行情与财务、
  主力资金流向、龙虎榜、市盈率/ROE/净利润排行、股票代码与名称检索。
  Use when: (1) 用户问"今日涨幅前10""涨停板有哪些""今天跌停的股票",
  (2) 用户问"主力资金净流入排名""今日龙虎榜", (3) 用户问"市盈率最低""ROE最高""净利润最高",
  (4) 用户问"芯片概念股""行业板块涨幅", (5) 用户给 6 位股票代码或股票名查行情/财务。
  Distinct from: a-stock-diagnosis（个股技术面诊断、K线均线支撑压力分析）,
  a-stock-realtime（单只股票实时行情快查）。
  Do NOT trigger: 用户要求技术分析/支撑压力位/买卖建议（用 a-stock-diagnosis）；
  用户查港美股/基金/期货/可转债（本技能仅支持 A 股）。
license: MIT
metadata:
  dsagent:
    display_name: "A股行情与榜单"
---

# A股行情数据查询

通过东方财富免费公开接口获取 A 股市场行情、榜单与财务数据，无需登录、无需 API Key、无第三方依赖。

## 核心能力

- ✅ 榜单：沪深A股涨幅榜 / 跌幅榜
- ✅ 涨跌停：涨停股池（连板数、封单资金、炸板次数）/ 跌停股池
- ✅ 板块：概念板块榜 / 行业板块榜 / 指定板块成分股
- ✅ 个股：行情 + 财务（营收、净利、毛利率、负债率、ROE）
- ✅ 资金：主力资金净流入榜（超大单/大单/中单/小单拆解）
- ✅ 龙虎榜：净买额、买入额、卖出额、上榜原因
- ✅ 估值与业绩：市盈率最低 / ROE 最高 / 净利润最高
- ✅ 检索：股票代码与名称模糊查询

## 使用方式

执行脚本，stdout 只输出一行 `__DSAGENT_RESULT__{json}`，直接读取其中的 `data` 字段。

```bash
# 默认榜单：按请求意图自动选择（默认沪深A股涨幅榜），取前 20 条
python {baseDir}/scripts/search.py --n 20

# 显式指定子命令
python {baseDir}/scripts/search.py gainers --n 10
python {baseDir}/scripts/search.py losers --n 10
python {baseDir}/scripts/search.py limitup --n 30
python {baseDir}/scripts/search.py limitdown --n 30
python {baseDir}/scripts/search.py concepts --n 20
python {baseDir}/scripts/search.py sectors --n 20
python {baseDir}/scripts/search.py board --name 芯片 --n 20
python {baseDir}/scripts/search.py stock --code 600519
python {baseDir}/scripts/search.py flow --n 20
python {baseDir}/scripts/search.py billboard --n 30
python {baseDir}/scripts/search.py billboard --date 2026-09-19 --n 30
python {baseDir}/scripts/search.py pe --n 20
python {baseDir}/scripts/search.py roe --n 20
python {baseDir}/scripts/search.py profit --n 20
python {baseDir}/scripts/search.py search --query 茅台
```

`uv` 不可用时改用 `python3 {baseDir}/scripts/search.py` 执行。

## 子命令表

| 子命令 | 用途 | 关键参数 |
|--------|------|---------|
| `gainers` | 沪深A股涨幅榜 | `--n 10` |
| `losers` | 沪深A股跌幅榜 | `--n 10` |
| `limitup` | 涨停股池 | `--n 30` |
| `limitdown` | 跌停股池 | `--n 30` |
| `concepts` | 概念板块涨幅榜 | `--n 20` |
| `sectors` | 行业板块涨幅榜 | `--n 20` |
| `board` | 板块成分股涨幅榜 | `--name 芯片` 或 `--code BK0493` |
| `stock` | 个股行情 + 财务 | `--code 600519` |
| `flow` | 主力资金净流入榜 | `--n 20` |
| `billboard` | 龙虎榜 | `--n 30`、`--date 2026-09-19`（可选） |
| `pe` | 市盈率(动)最低 | `--n 20` |
| `roe` | ROE 最高 | `--n 20` |
| `profit` | 净利润最高（最新报告期） | `--n 20` |
| `search` | 代码/名称检索 | `--query 茅台` |

`--n` 取值范围 1~100（涨停/跌停池上限 200，龙虎榜/业绩报表上限 500），缺省为 10。

## 意图映射

未显式给出子命令时，脚本会从请求文本中识别意图，识别不到则默认 `gainers`。

| 用户说 | 映射子命令 |
|--------|-----------|
| "今日涨幅前10""领涨的股票" | `gainers` |
| "跌幅榜""今天跌得最多的" | `losers` |
| "涨停""封板""连板" | `limitup` |
| "跌停" | `limitdown` |
| "龙虎榜""席位" | `billboard` |
| "资金流""主力净流入" | `flow` |
| "净利润最高" | `profit` |
| "市盈率最低""估值最低" | `pe` |
| "ROE最高""净资产收益率" | `roe` |
| "概念板块" | `concepts` |
| "行业板块""板块涨幅" | `sectors` |
| 出现 6 位股票代码 | `stock` |

## 输出格式

```json
{
  "ok": true,
  "source": "eastmoney",
  "title": "沪深A股涨幅榜 TOP10",
  "data": [ { "代码": "300750", "名称": "宁德时代", "最新价": 231.5, "涨跌幅": 12.34, "...": "..." } ],
  "total": 5400
}
```

失败时 `ok: false` 并带 `error` / `error_message` / `failure_kind`（如 `api_error`），`data` 为空数组。

各子命令字段：

| 子命令 | 主要字段 |
|--------|---------|
| `gainers` / `losers` / `pe` / `roe` | 代码、名称、最新价、涨跌幅、涨跌额、成交量(手)、成交额、振幅、换手率、市盈率(动)、量比、最高、最低、今开、昨收、总市值、流通市值、市净率（`roe` 额外含 ROE） |
| `limitup` | 代码、名称、最新价、涨跌幅、成交额、换手率、连板数、首次封板、最后封板、封单资金、炸板次数、流通市值、所属行业 |
| `limitdown` | 代码、名称、最新价、涨跌幅、成交额、换手率、封单资金、最后封板、连续跌停天数、开板次数、流通市值、所属行业 |
| `concepts` / `sectors` | 代码、名称、涨跌幅、涨跌额、换手率、上涨家数、下跌家数、领涨股、领涨股代码 |
| `stock` | 行情 + 净利润、营业收入、营收同比、净利同比、毛利率、净利率、负债率、ROE、市盈率、市净率、总市值、流通市值 |
| `flow` | 代码、名称、最新价、涨跌幅、主力净流入、主力净占比、超大单净额/净占比、大单净额/净占比、中单净额、小单净额 |
| `billboard` | 交易日期、代码、名称、收盘价、涨跌幅、换手率、龙虎榜净买额、买入额、卖出额、上榜原因 |
| `profit` | 代码、名称、报告期、净利润、营业收入、每股收益、每股净资产、加权ROE、营收同比、净利同比、毛利率、行业 |
| `search` | 代码、名称、类型、市场、secid |

## 注意事项

- 数据来自东方财富公开接口，为**最近交易日**数据；非交易时段与节假日返回上一交易日收盘数据
- 涨停/跌停池自动向前回溯最多 7 个自然日，以取到最近一个有数据的交易日
- 请勿高频调用，建议单次调用间隔 ≥1 秒
- 接口字段为免费公开数据，可能存在个别缺失值（以 `null` 表示）

## 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| 网络异常 / 接口不可达 | 返回 `ok: false` + `failure_kind: api_error`，告知用户稍后重试 |
| 板块名不存在 | 提示未找到该板块，建议改用板块代码（如 `BK0493`）或换关键词 |
| 股票代码无效 | 提示需提供 6 位 A 股代码（沪市 6xxxxx、深市 0xxxxx/3xxxxx） |
| 涨跌停池近 7 日无数据 | 如实告知近期无涨跌停数据（如长期休市） |
| 龙虎榜指定日期无数据 | 提示该日期无龙虎榜数据，可去掉 `--date` 取最近一期 |

## 数据源

| 数据 | 接口 |
|------|------|
| 行情列表（榜单/板块/资金流） | `push2.eastmoney.com/api/qt/clist/get` |
| 个股行情与财务 | `push2.eastmoney.com/api/qt/stock/get` |
| 涨停/跌停股池 | `push2ex.eastmoney.com/getTopicZTPool` / `getTopicDTPool` |
| 龙虎榜、业绩报表 | `datacenter-web.eastmoney.com/api/data/v1/get` |
| 代码/名称检索 | `searchapi.eastmoney.com/api/suggest/get` |

## 限制

- 仅支持 A 股（沪深京），不支持港股/美股/基金/期货/可转债
- 龙虎榜与业绩报表为**最新报告期**口径，非实时
- 不提供技术分析、买卖建议、量化回测（此类需求用 `a-stock-diagnosis`）
