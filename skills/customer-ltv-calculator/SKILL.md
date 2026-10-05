---
name: customer-ltv-calculator
description: "计算并运用客户生命周期价值（CLV / LTV）：区分历史 CLV 与预测 CLV，按公式估算客户长期价值，反推可承受的获客成本（CAC）目标、回本周期，并设计 VIP 识别与高价值流失召回流程。触发：CLV、LTV、客户生命周期价值、获客成本、CAC、回本周期、LTV/CAC 比、VIP 识别、客户价值预测、留存投入决策。数据可来自 sycm-customer 或用户自有订单明细。"
metadata:
  dsagent:
    display_name: "客户生命周期价值（CLV）"
    emoji: "💰"
    requires: {}
---

# Calculate and Act on Customer Lifetime Value (CLV)

> **数据来源（DSAgent 适配）**：本技能原版给出的是 Shopify / WooCommerce / BigCommerce 后台的取数路径。在 DSAgent 中优先使用以下方式：
>
> | 需要的数据 | 用哪个技能 | 说明 |
> |---|---|---|
> | 店铺客户概览与客户画像 | `sycm-customer` | 生意参谋客户分析，含消费层级等画像属性 |
> | 客户消费层级明细 | `sycm-customer`（深度画像） | 用于估算客户价值分层 |
> | 自有订单明细 | 直接读用户文件 | 需要字段：客户标识、订单日期、订单金额、毛利（可选）、首单渠道 UTM（可选） |
>
> **强制口径**：计算前必须剔除取消单、退款单、测试单与异常大额 B2B 单（会严重拉高均值），并优先看**中位数**而非平均值。
> 下方原文中出现的具体平台菜单路径与付费第三方工具（Lifetimely / Triple Whale / Metorik 等）仅作参考，本环境未接入。

## 前置条件

- 已取得订单明细（客户标识、订单日期、金额），以及可选的毛利与首单渠道字段。
- 计算前剔除取消单、退款单、测试单与异常大额订单。
- 需要毛利率才能算毛利调整后 CLV；缺毛利率时只能给营收口径，必须显式标注。

## 工作流

1. **确认口径**：区分历史 CLV（已发生）与预测 CLV（外推），并声明本次采用哪种。
2. **清洗数据**：剔除取消、退款、测试与异常大额订单。
3. **计算 CLV**：`CLV = AOV × 年购买频次 × 客户生命周期年数 × 毛利率`。
4. **反推 CAC 上限**：按 3:1 的 LTV/CAC 基准，`目标 CAC = 毛利调整后 CLV ÷ 3`。
5. **算回本周期**：`回本周期 = CAC ÷ (AOV × 毛利率)`，超过 12 个月需预警。
6. **按渠道拆分**：按首单渠道分组，找出高质量渠道并给出预算调整建议。

## 错误处理

- 单个大额订单拉高均值：改用**中位数** CLV，并说明已剔除离群值。
- 缺少毛利数据：只给营收口径并明确标注"未做毛利调整"，不得默认 100% 毛利。
- 样本过少或生命周期不足一个周期：说明预测不可靠，只输出历史口径。

## Overview

Customer Lifetime Value (CLV) represents the total net revenue a customer is expected to generate throughout their entire relationship with your store. Understanding CLV allows for data-driven decisions on acquisition spend (CAC), retention investment, and tiered loyalty programming.

## When to Use This Skill

- When setting acquisition cost (CAC) targets for marketing channels.
- When identifying high-value customers for a VIP or referral program.
- When predicting customer churn to trigger automated win-back sequences.
- When evaluating the long-term ROI of specific products or categories.
- When calculating the payback period of newly acquired customers.

## Core Instructions

### Step 1: Historical vs. Predictive CLV

*   **Historical CLV:** The sum of all actual revenue from a customer to date. (Sum of all orders minus refunds/cancellations).
*   **Predictive CLV:** An estimate of future revenue based on historical behavior (Recency, Frequency, and Monetary value).

#### Mathematical Formula (Simple Parametric):
`CLV = (Average Order Value) × (Average Order Frequency per Year) × (Average Customer Lifespan in Years) × (Gross Margin Rate)`

*   **Example Calculation:**
    *   AOV = $100
    *   Frequency = 4 times/year
    *   Lifespan = 3 years
    *   Margin = 50%
    *   **CLV** = $100 × 4 × 3 × 0.50 = **$600**

### Step 2: Accessing Platform Data

#### Shopify
1.  **Direct View:** Go to **Admin → Analytics → Reports → Customers**.
2.  **Export:** Go to **Customers → Export** to get a CSV containing `Total Spent` and `Number of Orders` for every customer.
3.  **Third-Party Tools:** Apps like **Lifetimely** or **Triple Whale** provide more granular CLV curves and cohort analysis, but the raw data is natively available via Shopify Admin.

#### WooCommerce & BigCommerce
1.  Use the platform's built-in **Analytics → Customers** reports to view lifetime spend and order history.
2.  Filter by date to view CLV for specific acquisition cohorts.
3.  Analytics tools like **Metorik** are commonly used to provide more advanced retention and churn reporting.

### Step 3: Predictive Segmentation (Automated Flows)

Create dynamic segments to target different customer value tiers:

#### VIP Recognition Sequence
*   **Trigger Segment:** Historical CLV > $500 OR Total Orders > 5.
*   **Automation:** When a customer enters this segment, send a personalized "VIP Welcome" email.
*   **Action:** Offer early access to sales, exclusive products, or a dedicated customer success contact.

#### Win-Back Flow for At-Risk High-Value Customers
*   **Trigger Segment:** CLV > $200 AND Last Order Date > 90 days ago.
*   **Automation:**
    *   **Day 0:** Personalized "We miss you" email with recommendations based on prior purchases.
    *   **Day 7:** Email with a small incentive (e.g., Free Shipping or 10% off).
    *   **Day 14:** Final "founder-style" outreach.

### Step 4: Decision Criteria & Deepening

#### CLV by Acquisition Channel Calculation
Calculate the average CLV for customers acquired from Facebook vs. Google vs. Email:
1.  Export your customer list with **Total Spent** and **First UTM Source**.
2.  Group by source and average the spent.
3.  *Decision:* If Facebook CLV is $50 and Google CLV is $120, shift budget from Facebook to Google even if Facebook's initial CAC is lower.

#### Setting CAC Targets from CLV
Use the **3:1 LTV/CAC Ratio** as a benchmark:
*   `Target CAC = (Predicted CLV × Gross Margin) / 3`
*   *Example:* If your margin-adjusted CLV is $300, you can spend up to $100 to acquire a new customer and remain profitable.

#### Payback Period Calculation
The time it takes for a customer to become profitable after acquisition.
*   `Payback Period = CAC / (AOV × Gross Margin)`
*   *Strategy:* If the payback period is >12 months, your business is "cash-flow negative" on acquisition; you must focus on increasing AOV or initial conversion rate.

## Best Practices

- **Filter Out Noise:** Always exclude cancelled, refunded, and fraudulent orders from CLV calculations to avoid overstating value.
- **Segment by Product Category:** Identify which "entry product" leads to the highest CLV. Promote these products in top-of-funnel ads.
- **Refresh Quarterly:** Predictive models should be updated every 3 months as market conditions and customer behavior shift.
- **Focus on the Median:** Single-order outliers (e.g., a massive B2B order) can skew average CLV. Use **Median CLV** for a more realistic view of the typical customer.

## Common Pitfalls

| Problem | Solution |
|---------|----------|
| Overspending on CAC | Ensure your CAC targets are based on *Margin-adjusted CLV*, not just Top-line Revenue. |
| Win-Back too early | A "churn" signal varies by product. Coffee (30 days) vs. Furniture (2 years). Align win-back triggers to your typical purchase cycle. |
| Ignoring early churn | If 80% of customers never make a second purchase, focus on **post-purchase experience** before scaling acquisition spend. |
| Stale Segments | Static lists fail. Always use **Dynamic Segments** that automatically add/remove customers based on their real-time behavior. |

---

## 证据分级（输出结论前必读）

本技能输出任何"结论"前，先按**证据四分级**标注级别（Observed 直采 / Calculated 计算 /
Proxy 代理推断 / Unknown 未知），并遵守五条禁止推断——尤其是：
**sycm/万相台指数一律标 Proxy，不得当绝对量**；**Unknown 不得当 0 参与平均**。

完整分级表、五条禁止推断与国内场景注释见 [references/evidence-rules.md](references/evidence-rules.md)。
