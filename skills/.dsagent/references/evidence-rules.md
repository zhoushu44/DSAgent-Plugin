# 证据四分级纪律（全部分析类技能共享）

> 本文件是 `market-analysis` / `store-patrol-manager` / `demand-niche-analysis` / `competitor-*` /
> `market-trend` / `keyword-*` / `sycm-customer` / `customer-voice-analyzer` / `product-reviews` /
> `product-wdj` / `industry-data-mcp` / `data-report` 等分析类技能的**共享前置纪律**。
> 技能输出任何"结论"前，先按本文分级；**分级决定措辞强度**。

来源：`market-insight-product-selection/references/evidence-and-scoring.md`（Accio v0.0.104）
移植时未改动判据，仅中文化并补充国内场景注释。

---

## 一、四级分类（每条结论必标其一）

| 级别 | 含义 | 允许的措辞 | 例子 |
|---|---|---|---|
| **Observed 直采** | 平台接口**直接返回**的原始值 | 可以下事实断言；须引用来源与周期 | 搜索人气 12345 `[obs: sycm 关联词拓展]` |
| **Calculated 计算** | 从直采值经**可复现算术**得出 | 必须给出公式与纳入/排除项 | 价格中位数 79 `[calc: P50 of 120 samples]` |
| **Proxy 代理推断** | 间接证据，**只能指示方向** | 用方向性措辞，并解释推断依据 | "该人群价格敏感" `[proxy: 标题词频中"便宜/平价"占 18%]` |
| **Unknown 未知** | 缺失 / 过期 / 不可比 / 不可靠 | **不得乐观计分**；标注下一步验证 | 竞品评价数据 `[unknown: 未采集]` |

**标注格式**：结论后缀 `[obs: 来源]` / `[calc: 公式]` / `[proxy: 依据]` / `[unknown]`。

## 二、五条禁止推断（硬规则，逐条对应国内场景）

1. **Never present a proxy as an observed fact.** —— 永远不得把代理推断包装成直采事实。
   > 国内最常见违例：生意参谋「搜索人气 8500」是**相对指数**，不是 8500 次搜索。把指数当绝对量用，等于凭空造了一个 Observed。**所有 sycm/万相台指数一律标 Proxy。**

2. **Selling price or a generic markup does not establish margin.** —— 售价或通用加价率不能 establish 利润。
   > 国内对应：类目均价 ≠ 你的成本结构（佣金 2–5% + 支付 0.6% + 淘客 + 履约）。任何毛利率必须是 Calculated（给出成本构成），不得从售价直接推。

3. **Average rating does not establish positive-review rate.** —— 平均评分不能 establish 好评率，除非有分布数据。
   > 国内对应：4.8 分可能是「98% 五星」也可能是「大量无文字默认好评」。没有分布，好评率只能是 Unknown。

4. **Source authority alone does not make two figures comparable.** —— 来源权威不等于两数可比。
   > 必须核对六项：**地域 / 渠道 / 周期 / 类目-SKU 层级 / 样本 / 指标定义**。反例：近 7 天类目 GMV vs 近 30 天店铺 GMV，都来自官方后台，仍不可比。

5. **Do not average Unknown as if it were neutral or zero.** —— 不得把 Unknown 当 0 或中性值参与平均。
   > 把"不知道"当 0，会把未知机会算成确定烂机会；当中性值，会稀释真实信号。**Unknown 必须保持可见，单独列出。**

## 三、配套纪律

- **不做小数排名与任意权重**（Avoid decimal rankings and arbitrary weights）：给"7.32 分"这种精度是伪精确。
- **Confidence measures evidence quality, not opportunity attractiveness**：置信度衡量的是**证据质量**，不是机会好坏。一个绝佳的机会若只有 Proxy 级证据，它就是 Proxy 级置信度——不得因"项目很棒"而调高。
- **样本量门限**（配合各技能自己的门限）：n 不足时结论降级为"初步观察"或直接返回 `INSUFFICIENT_DATA`，不得用小样本套阈值下断言。
- **逃逸阀**：若证据无法支撑有用排序，**直接说明并返回验证计划，而不是硬造一个赢家**。

## 四、报告输出要求

分析类报告在「数据来源」节之后，加一行体系声明，并在**每条核心结论**后带分级标注：

```text
[证据分级体系: Observed 直采 / Calculated 计算 / Proxy 代理推断 / Unknown 未知]
```

第 9.5 节（或等价位置）输出**证据审计**：逐条列出核心结论的级别，Proxy 与 Unknown 单独成段、
每个 Unknown 附「最小下一步」怎么补这个数据。
