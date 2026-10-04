---
name: customer-rfm-analyzer
description: "基于 RFM 打分（Recency 最近购买 / Frequency 购买频次 / Monetary 累计消费）做客户分层、队列留存分析与生命周期划分，输出可直接执行的分群动作，驱动复购与留存收入。触发：RFM、客户分层、客户分群、复购分析、留存分析、队列留存、cohort、VIP 客户识别、流失预警、客户价值分析。数据可来自 sycm-customer（生意参谋客户分析）导出的客户概览与画像，或用户自有的订单明细。"
metadata:
  dsagent:
    display_name: "RFM 客户分层分析"
    emoji: "📊"
    requires: {}
---

# Analyze Customer Behavior and RFM Segments

> **数据来源（DSAgent 适配）**：本技能原版假设数据来自 Shopify / WooCommerce / BigCommerce 后台导出的客户明细。在 DSAgent 中，取数与导出走以下兄弟技能，也可以直接使用用户提供的订单/客户明细表（CSV / Excel）：
>
> | 需要的数据 | 用哪个技能 | 说明 |
> |---|---|---|
> | 店铺客户概览（新访/未购回访/已购回访）+ 客户画像 | `sycm-customer` | 生意参谋客户分析，输出 JSON/CSV/HTML |
> | 商品评价（用于判断产品是否「留得住人」） | `product-reviews` | 与 RFM 配合判断复购受阻原因 |
> | 自有订单明细 | 直接读用户文件 | 需要字段：客户标识、订单日期、订单金额、是否取消/退款 |
>
> **字段要求**：至少包含「客户唯一标识 + 每笔订单日期 + 订单金额」。取消单、退款单、测试单必须在计算前剔除。
> 平台后台的具体菜单路径（Shopify/WooCommerce 等）保留在下方原文中，作为参考，不代表本环境已接入该平台。

## 前置条件

- 已取得订单级明细，且至少包含「客户唯一标识 + 订单日期 + 订单金额」三个字段。
- 计算前必须剔除取消单、退款单、测试单与异常大额 B2B 单。
- 观察窗口需覆盖至少 2 个完整购买周期，否则 R/F 分数不稳定。

## 工作流

1. **清洗数据**：剔除取消、退款、测试与异常订单，统一客户标识。
2. **计算 RFM**：分别算出每位客户的最近购买间隔、购买次数、累计消费。
3. **分档打分**：按分位数给出 R/F/M 各 1–5 分，并按组合归入 Champions / Loyal / At Risk / One-Time / About to Sleep。
4. **做队列留存**：按首购月份分组，计算后续各月仍活跃的比例。
5. **对齐基准**：与行业基准（一次性买家 60–70%、复购 30–40%、Power User 5–10%）对比，标出偏离。
6. **输出动作**：对每个分层给出可执行的触达策略与优先级。

## 错误处理

- 数据窗口过短或订单量过小：说明分层结果不稳健，只输出方向性判断。
- 季节性品类：不得用统一 90 天流失口径，改用「去年同期的购买窗口」判断。
- 客户标识缺失或串号：停止计算并报告数据质量问题，不要用近似值蒙混。

## Overview

Customer analytics transforms raw order data into actionable insights about purchase patterns, lifecycle stages, and churn risk. By segmenting customers based on their actual behavior rather than demographics, merchants can deploy targeted interventions that increase Customer Lifetime Value (CLV).

The core of this analysis relies on three frameworks:
1.  **RFM Scoring**: Ranking customers by Recency, Frequency, and Monetary value.
2.  **Cohort Retention**: Tracking how groups of customers acquired at the same time behave over their first 12 months.
3.  **Purchase Frequency**: Measuring the "stickiness" of the product and the speed of the second-purchase conversion.

## When to Use This Skill

- When your acquisition costs (CAC) are rising and you need to maximize the value of existing customers.
- When you need to identify "VIP" or "Champion" customers for loyalty programs or early-access launches.
- When the business needs to predict future revenue based on historical cohort performance.
- When you need to identify acquisition channels (Google, Meta, Organic) that produce the highest-quality long-term buyers.

## The RFM Framework

RFM is the industry standard for behavioral segmentation. Assign a score (typically 1-5) to each customer for each category:

- **Recency (R)**: Days since the last order. Recent buyers are the most likely to buy again.
- **Frequency (F)**: Total number of orders. High frequency indicates brand loyalty.
- **Monetary (M)**: Total lifetime spend. High monetary value identifies your "whales" or VIPs.

### Segment Definitions and Actions

| Segment | RFM Profile | Strategic Objective | Recommended Action |
|---------|-------------|---------------------|--------------------|
| **Champions** | High R, High F, High M | Reward & Retain | Invite to VIP program; early access to new products; request reviews. |
| **Loyal Customers** | Med-High R, High F | Upsell | Cross-sell higher-margin items; offer subscription options. |
| **At Risk** | Low R, Med F | Re-engage | Multi-step win-back sequence: reminder → small incentive → final "we miss you" offer. |
| **One-Time Buyers** | High R, Low F | Convert to Repeat | "Next-best-product" recommendation based on their first purchase. |
| **About to Sleep** | Low R, Low F | Reactivate | aggressive discount or low-cost re-engagement attempt. |

## Platform-Agnostic Segmentation Logic

In your ecommerce platform's customer admin or your email marketing tool, create segments using these logical filters:

- **VIP Segment**: `Total Spent > [2x Average Order Value] AND Total Orders >= 3`
- **At-Risk Segment**: `Last Order Date > 90 Days Ago AND Last Order Date < 180 Days Ago AND Total Orders >= 2`
- **New High-Value Segment**: `First Order Date < 30 Days Ago AND Total Spent > [1.5x Average Order Value]`
- **Churned Segment**: `Last Order Date > 180 Days Ago` (Consider suppressing these from paid ads to save costs).

## Retention Benchmarks

Measure your performance against these industry standards for DTC and B2B ecommerce:

### 1. Purchase Frequency Distribution
- **One-time buyers**: 60–70% (Typical). If higher, your onboarding or product quality may be failing.
- **Repeat buyers (2+ orders)**: 30–40% (Healthy).
- **Power users (5+ orders)**: 5–10% (Excellent).

### 2. Cohort Retention Targets
A cohort retention grid shows what percentage of customers acquired in a specific month are still active in subsequent months.

| Months After First Order | Minimum Viable | Healthy | Excellent |
|--------------------------|---------------|---------|-----------|
| **Month 1** (Second purchase) | 15% | 25% | 40%+ |
| **Month 3** | 10% | 20% | 35%+ |
| **Month 12** | 5% | 15% | 30%+ |

## Deepening the Analysis

### 1. CLV by Acquisition Channel
Total LTV is a vanity metric; you must calculate it by channel to inform budget allocation.
- **Method**: Segment your customers by their *first* order source (UTM source).
- **Formula**: `(Total Revenue from Channel Cohort) / (Total Number of Customers in Channel Cohort)`
- **Nuance**: You may find that Meta ads have a higher CAC but produce 3x the 12-month LTV compared to Google Search. This justifies higher front-end spending on Meta.

### 2. Multi-Touch Attribution Nuance
When calculating CLV, use **First-Touch Attribution** to understand which channel actually "built" the customer relationship. Using Last-Touch will over-attribute value to "Direct" or "Email," masking the effectiveness of your top-of-funnel discovery channels.

### 3. Handling Seasonal Buyers
Standard churn logic (e.g., "haven't bought in 90 days") fails for seasonal businesses.
- **The Seasonal Flag**: If a customer only buys in November/December for two consecutive years, flag them as "Seasonal."
- **Strategy**: Do not send them win-back emails in July. Instead, move them to a "Seasonal Reactivation" list that only triggers 30 days before their expected annual purchase window.

### 4. Discount Guard Logic
Before sending an incentive to an "At-Risk" customer, check their historical discount usage.
- If a customer has **never** used a discount, send a "brand-led" re-engagement email first (new arrivals, content).
- If a customer **always** uses a discount, they are likely "discount-sensitive." Only a coupon will bring them back. This preserves your margins on full-price loyalists.

## Operational Checklist

- [ ] **Monthly RFM Update**: Refresh scores every 30 days.
- [ ] **Second-Purchase Window**: Identify the average days between order 1 and order 2. Set your first automated retention trigger 5 days *before* this window ends.
- [ ] **Data Hygiene**: Ensure "Test" orders and "Canceled" orders are excluded from your LTV and frequency calculations.
- [ ] **Cohort Baseline**: Establish a 12-month retention baseline before launching a new loyalty program to measure its true impact.
