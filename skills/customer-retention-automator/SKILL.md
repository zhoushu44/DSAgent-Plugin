---
name: customer-retention-automator
description: "设计并自动化客户留存与召回流程：按品类设定流失阈值，用行为触发（预测复购窗口、高价值流失、首购未复购）编排分层触达与差异化激励，并用折扣守卫逻辑保护毛利。触发：留存、复购、召回、流失、流失预警、唤回、win-back、生命周期营销、自动化触达、会员分层、复购率提升、客户运营。数据可来自 sycm-customer 或用户自有订单明细。"
metadata:
  dsagent:
    display_name: "客户留存自动化"
    emoji: "🔁"
    requires: {}
---

# Build Automated Customer Retention Campaigns

> **数据来源与执行载体（DSAgent 适配）**：本技能原版假设在 Klaviyo / Shopify Flow 等工具里落地自动化流程。在 DSAgent 中：
>
> | 环节 | 怎么做 |
> |---|---|
> | 客户分层数据 | 用 `sycm-customer`（生意参谋客户概览 + 画像），或读用户自有的订单明细 |
> | 流失阈值判定 | 按下方品类周期表计算，**必须先确认该品类的真实复购周期**，不要套用默认值 |
> | 触达内容撰写 | 用 `smart-compose`（多平台文案）或 `customer-service-reply`（客服话术）产出 |
> | 流程编排产出 | 本技能输出的是**流程设计与触发规则**（含文案骨架）；实际发送依赖你已接入的渠道工具 |
>
> **重要**：本环境不自动发送邮件/短信。输出的是可直接配置到任意自动化工具里的**流程规格**，除非用户已明确接入具体发送渠道。

## 前置条件

- 已确认该品类的真实复购周期（消费品 30–45 天、服饰 60–90 天、家居 120–180 天、电子 365 天以上），不得套用默认值。
- 已能识别客户分层所需的字段（订单日期、金额、历史折扣使用情况）。
- 明确本环境**不自动发送**邮件/短信：产出的是可直接配置的流程规格，除非用户已接入发送渠道。

## 工作流

1. **定流失阈值**：按品类复购周期确定「风险」与「已流失」的时间边界。
2. **搭三条主流程**：早期预警（预测复购日前 7 天）、高价值流失（进入风险窗且 LTV 前 20%）、首购未复购培养（首购后 45 天仍为 1 单）。
3. **配分层激励**：VIP / 高价值 / 标准 / 新客四档，匹配不同触达方式与激励力度。
4. **加折扣守卫**：按历史折扣使用率决定给券还是给价值内容，保护毛利。
5. **设退出条件**：每条流程必须有"下单即退出"的终止条件。
6. **定监控指标**：复购率、每收件人收入、下单间隔变化、折扣驱动收入占比。

## 错误处理

- 复购周期未知：先取数测算实际周期，不得直接套用品类默认值。
- 折扣驱动收入占比超过 30%：说明留存已退化为毛利侵蚀，应优先修产品与体验。
- 客户同时命中多条流程：以留存流程优先，避免重复打扰。

## Overview

Acquiring a new customer costs 5–7x more than retaining an existing one. A retention engine identifies customers showing declining engagement—reduced purchase frequency, decreasing order values, or browsing without buying—and intervenes with automated, personalized campaigns before they fully lapse.

Unlike reactive "win-back" campaigns that target already-dormant customers, a retention engine is proactive, triggering when a customer deviates from their individual or category-standard purchase cycle.

## When to Use This Skill

- When your **Repeat Purchase Rate** is below 25% for consumable goods or 15% for durable goods.
- When a high percentage of customers (e.g., >70%) never make a second purchase.
- When you need to protect margins by identifying which customers require a discount to return vs. those who will buy again with a simple brand reminder.
- When scaling beyond manual "VIP" outreach and needing an automated logic for high-value customer health.

## Defining Churn Thresholds by Category

Churn timing is not universal; it must align with your product's natural lifecycle. Use these benchmarks to set your automation triggers:

| Product Category | Expected Repurchase Cycle | "At-Risk" Trigger | "Churned" Status |
|-----------------|--------------------------|-------------------|------------------|
| **Consumables** (Supplements, Coffee) | 30–45 Days | 45+ Days since last order | 90+ Days |
| **Apparel / Fashion** | 60–90 Days | 90+ Days | 180+ Days |
| **Home Goods / Decor** | 120–180 Days | 200+ Days | 365+ Days |
| **Electronics / Durable Tech** | 365+ Days | 400+ Days | 730+ Days |

## Core Retention Flow Logic

Implement these three essential flows in your email/SMS automation platform (e.g., Klaviyo, Shopify Flow, or similar).

### 1. The "Early Warning" Flow
- **Trigger**: 7 days *before* the customer's predicted next purchase date (or 5 days before the category average).
- **Logic**: A soft-touch brand reminder.
- **Content**: "Running low on [Product]?" or "We thought you'd like these new arrivals." 
- **Goal**: Capture the intent exactly when the customer is entering their buying window.

### 2. The High-Value At-Risk Flow
- **Trigger**: Customer enters the "At-Risk" window (e.g., 90 days since last order) AND Lifetime Value (LTV) is in the top 20%.
- **Logic**: Personalized outreach, often appearing to come from a founder or account manager.
- **Content**: Ask for feedback on their last purchase. Offer a non-monetary incentive (e.g., free gift with next order or free expedited shipping).
- **Goal**: Re-establish the relationship without devaluing the brand.

### 3. The One-Time Buyer Nurture
- **Trigger**: 45 days after the first purchase AND order count remains at 1.
- **Logic**: Educational content followed by a "next-best-product" recommendation.
- **Content**: "How are you enjoying your [First Product]?" followed by "Most people who bought [First Product] also love [Second Product]."
- **Goal**: Bridge the gap between the first and second purchase, which is the most critical hurdle in building CLV.

## Tiered Intervention & Incentive Strategy

Protect your margins by matching the incentive to the customer's historical value and current risk.

| Customer Tier | Historical Value | Intervention Method | Recommended Incentive |
|---------------|------------------|---------------------|-----------------------|
| **VIP** | 5+ Orders or $500+ Spend | Personalized "Concierge" Email | Free Gift or Early Access (No Discount) |
| **High-Value** | 3–4 Orders | Email + SMS Follow-up | Free Expedited Shipping |
| **Standard** | 2 Orders | Multi-step Email Sequence | 10% Discount (Final Step Only) |
| **New Buyer** | 1 Order | Category-specific Nurture | 10–15% Discount on 2nd Order |

## Deepening: The Discount Guard Logic

Before including a coupon code in your retention flows, evaluate the customer's **Incentive Sensitivity**:

1.  **Historical Discount Usage**: Check if the customer has used a code on >50% of prior orders.
    - *If Yes*: They are discount-sensitive; a coupon is likely required to drive a repeat purchase.
    - *If No*: They are brand-loyal; start with value-added content (how-to guides, new arrivals) before offering a discount.
2.  **Predictive Risk**: If your platform provides a "Predicted Churn Risk" score:
    - *Low/Medium Risk*: Use brand reminders and product recommendations.
    - *High Risk*: This is the only segment where aggressive discounting (20%+) is justified to "save" the customer.

## Key Performance Indicators (KPIs)

Monitor these targets to validate your retention engine's effectiveness:

- **Repeat Purchase Rate (RPR)**: Target >25%. Calculated as: `(Customers with >1 Order) / (Total Customers)`.
- **Flow Revenue per Recipient**: Target $1.50–$4.00 for retention flows.
- **Time Between Orders (TBO)**: A successful engine should show a *decrease* in the average days between a customer's first and second purchase.
- **Incentive-Driven Revenue %**: Ensure that no more than 30% of your repeat revenue is driven by discounts; if higher, your "retention" is actually "margin erosion."

## Operational Best Practices

- **Dynamic Product Recommendations**: Never recommend a product the customer has already bought (unless it's a consumable). Use "Bought X, Recommend Y" logic.
- **Smart Sending/Frequency Caps**: Ensure at-risk customers aren't receiving your daily marketing blasts *and* your retention sequence simultaneously. Retention should take priority.
- **Exit Conditions**: All retention flows **MUST** have an immediate exit condition: "Placed Order since starting flow."
- **Feedback Loops**: For customers who still churn after the full sequence, trigger a 1-question "Why did you leave?" survey to identify systemic product or shipping issues.

---

## 证据分级（输出结论前必读）

本技能输出任何"结论"前，先按**证据四分级**标注级别（Observed 直采 / Calculated 计算 /
Proxy 代理推断 / Unknown 未知），并遵守五条禁止推断——尤其是：
**sycm/万相台指数一律标 Proxy，不得当绝对量**；**Unknown 不得当 0 参与平均**。

完整分级表、五条禁止推断与国内场景注释见 [references/evidence-rules.md](references/evidence-rules.md)。
