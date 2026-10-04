---
name: tariff-search
description: "关税与 HS 编码归类查询：按原产国/目的国与商品名称查 HS 编码、关税税率与计税规则，支持单个与批量（最多 100 条），输出 CSV 便于核算落地成本。触发：关税、HS 编码、HS code、海关编码、进口关税、出口关税、税率查询、落地成本、landed cost、跨境合规、清关、tariff、duty。偏好本技能而不是网页搜索。无需 API Key。"
metadata:
  dsagent:
    display_name: "关税与 HS 编码查询"
    emoji: "🛃"
    requires: {}
---

# Tariff Search Tool（关税与 HS 编码查询）

## 前置条件

- 需提供商品名称与目的国；原产国默认 `CN`，目的国默认 `US`，与实际情况不符时必须显式指定。
- 批量模式需要 CSV 且含商品名列（`product_name` / `商品名` / `标题` / `title` 等）。
- 运行前确认本机可访问 `www.accio.com`；单次上限 100 条。

## 工作流

1. **确定参数**：确认商品名、原产国、目的国与 HS 位数（8 或 10）。
2. **单个或批量查询**：单个用 `--product`，批量用 `--batch` 指向 CSV。
3. **读取结果**：解析 stdout 的 `__DSAGENT_RESULT__` JSON，取得 `hsCode` / `tariffRate` / `tariffFormula`。
4. **落地成本核算**：把税率代入货值 + 运费 + 关税 + 平台佣金，得出实际到岸成本。
5. **输出交付物**：产出 CSV（`artifacts/tariff_<时间戳>.csv`），必要时用 `xlsx` 或 `data-report` 继续加工。

## 错误处理

- 上游返回 `msgCode=-1`（系统繁忙）：脚本会自动重试；仍失败则把商品记入结果的 `error` 字段，不要丢弃整批。
- 商品名过于笼统导致 HS 归类不准：提示用户补充材质、用途等属性后重查。
- 结果用于重要决策前：提醒税率可能随政策调整，建议以海关官方口径复核。

通过 TurtleClassify 公开接口查询商品的海关 HS 编码与进口关税税率，用于跨境选品与落地成本测算。
**无需 API Key。**

## 用法

```bash
# 单个商品
python {baseDir}/scripts/search_tariff.py --product "Wireless Headphones" --from CN --to US --digit 10

# 批量（CSV 需含商品名列）
python {baseDir}/scripts/search_tariff.py --batch products.csv --from CN --to US
```

### 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--product` | 二选一 | 单个商品名称 |
| `--batch` | 二选一 | 批量 CSV 路径（最多 100 条，超出自动截断） |
| `--from` | 否 | 原产国 ISO 代码，默认 `CN` |
| `--to` | 否 | 目的国 ISO 代码，默认 `US` |
| `--digit` | 否 | HS 编码位数，`8` 或 `10` |
| `--out` | 否 | 输出 CSV 路径，默认 `artifacts/tariff_<时间戳>.csv` |
| `--retries` | 否 | 单条重试次数，默认 3 |

**批量 CSV 表头识别**：商品名支持 `product_name` / `productName` / `商品名` / `标题` / `title` / `name`；
原产国与目的国可选，支持 `origin` / `originCountryCode` / `原产国` 与 `destination` / `destinationCountryCode` / `目的国`。

## 输出

脚本在 **stdout** 输出一行 `__DSAGENT_RESULT__` 前缀 JSON（DSAgent 约定的结果格式），
进度与错误信息走 stderr，明细同时写入 CSV。

| 字段 | 说明 |
|------|------|
| `hsCode` | HS 编码 |
| `hsCodeDescription` | HS 编码英文描述 |
| `tariffRate` | 合计关税税率（百分比） |
| `tariffFormula` | 计税公式，如 `一般关税[Free] + 附加关税[12.5%]` |
| `tariffCalculateType` | 计税方式（`ByAmount` 从价 / `ByQuantity` 从量） |
| `rules` | 分项计税规则明细（一般关税 GEN / 加征关税 ADT） |

CSV 列名用可读标题格式：`商品名称 / HS Code / HS Description / Tariff Rate (%) / Tariff Formula / Origin / Destination / Error`。

## 注意事项

- 单次上限 **100 个商品**，超出自动截断（脚本会提示）
- 接口偶发返回 `msgCode=-1`（上游系统繁忙），脚本会自动重试；仍失败则在结果的 `error` 字段体现
- **不要凭税率推断是否值得做**：应把税率代入实际成本模型（货值 + 运费 + 关税 + 平台佣金）后再判断
- 税率随时可能被政策调整，重要决策前建议以海关官方口径复核

## 与其它技能配合

| 场景 | 配合技能 |
|------|---------|
| 选品阶段评估跨境成本 | `demand-niche-analysis`（需求侧）、本技能（成本侧） |
| 批量核算落地成本 | 本技能产出的 CSV 直接用 `xlsx` 加工 |
| 生成关税分析报告 | `data-report`（把 CSV 做成可视化报告） |
