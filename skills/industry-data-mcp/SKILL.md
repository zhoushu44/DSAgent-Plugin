---
name: industry-data-mcp
description: "当用户希望分析行业库（参谋长）中的类目数据时使用。包括：查询类目归属、获取汇总指标、按天趋势、热搜词、商品榜单，最后生成可视化的 HTML 分析报告。触发词：分析XX类目、看看XX的数据、做份类目报告、行业类目分析、参谋长数据、商品榜单、热词分析。"
metadata:
  dsagent:
    display_name: "淘宝行业类目分析"
---

# 淘宝行业类目分析



基于行业库（参谋长）数据，对指定类目进行全维度分析并生成交互式 HTML 报告。



## 主要数据来源



| 工具 | 用途 |

|------|------|

| `list_my_categories` | 查看已订购的一级类目 |

| `list_my_subcategories` | 查看类目下的子类目树，定位目标类目归属 |

| `latest_data_date` | 查询最新数据日及最大可回看天数 |

| `qiwrok_category_stats` | 类目维度汇总和按天趋势（GMV/UV/IV/点击率等） |

| `qiwrok_hot_words` | 获取热搜关键词榜 |

| `qiwrok_list` | 获取热销商品榜单 |

| `present_files` | 交付最终 HTML 报告给用户 |



## 执行流程



### 1. 查询已订购类目，定位目标类目归属



先通过 `list_my_categories` 查看用户订购了哪些一级类目。



```python

list_my_categories()

```



返回的 `categories` 数组包含已订购的一级类目列表。根据用户提到的品类（如"polo衫"），判断它属于哪个一级类目。



然后用 `list_my_subcategories` 查看该类目下的完整子类目树，找到目标品类的确切归属（一级 → 二级 → 三级）。



```python

list_my_subcategories(

    primary_category="<一级类目名>"

)

```



**示例：** 用户说"分析polo衫" → 一级类目"男装" → 二级类目"Polo衫"（id: 365，level: 2）



### 2. 查询最新数据日和可回看窗口



```python

latest_data_date(

    primary_category="<一级类目>",

    cate_name="<类目名>"

)

```



返回 `latest_stat_date`（最新数据日）和 `max_lookback_days`（最大回看天数）。计算 `start_date = latest_stat_date - max_lookback_days + 1`。



**注意：** `start_date` 不能早于 `latest_stat_date - max_lookback_days + 1`，否则会报错。



### 3. 获取类目汇总指标



```python

qiwrok_category_stats(

    primary_category="<一级类目>",

    secondary_category="<二级类目>",

    start_date="YYYY-MM-DD",

    end_date="YYYY-MM-DD",

    view="summary"

)

```



**参数说明：**

- `primary_category`：必填，一级类目名（须在订购范围内）

- `secondary_category`：二级类目名，查询二级类目时填入

- `cate_name`：也可以用这个指定类目名（与 secondary_category 二选一）

- `view`：可选 `summary`（合计）、`series`（按天）、`children`（下钻子类目）



**返回的 `summary` 字段说明：**



| 字段 | 含义 |

|------|------|

| `tradeIndex` | 交易指数，综合热度指标 |

| `gmv` | 预估 GMV（销售额） |

| `uv` | 访客数 |

| `iv` | 浏览量 |

| `seImpsPvIndex` | 搜索曝光量 |

| `seIpvIndex` | 搜索点击量 |

| `clickThroughRate` | 点击率（CTR） |



### 4. 拉取按天趋势数据



```python

qiwrok_category_stats(

    primary_category="<一级类目>",

    secondary_category="<二级类目>",

    start_date="YYYY-MM-DD",

    end_date="YYYY-MM-DD",

    view="series"

)

```



返回的 `series` 数组包含每天的数据，按 `stat_date` 排列。每条记录包含 `tradeIndex`、`gmv`、`uv`、`iv`、`seImpsPvIndex`、`seIpvIndex`、`clickThroughRate`。



### 5. 获取热搜关键词榜



```python

qiwrok_hot_words(

    primary_category="<一级类目>",

    cate_name="<类目名>",

    list_type="tradeIndex",

    start_date="YYYY-MM-DD",

    end_date="YYYY-MM-DD",

    page_size=20

)

```



**list_type 可选值：** `tradeIndex`（交易指数排序，推荐）、`rexiao`（热销）、`resou`（热搜）、`biaosheng`（飙升）



### 6. 获取商品榜单



```python

qiwrok_list(

    primary_category="<一级类目>",

    cate_name="<类目名>",

    list_type="rexiao",

    start_date="YYYY-MM-DD",

    end_date="YYYY-MM-DD",

    page_size=20

)

```



**注意：** `qiwrok_list` 的 `list_type` 推荐使用 `rexiao`（热销），因为 `tradeIndex` 可能不可用（返回 404）。如果一次不行，换其他 list_type 试。



返回的 `list` 数组包含商品级数据，关键字段：



| 字段 | 含义 |

|------|------|

| `itemId` | 商品 ID |

| `title` | 商品标题 |

| `tradeIndex` | 交易指数 |

| `gmv` | 预估 GMV |

| `uv` | 访客数 |

| `iv` | 浏览量 |

| `seImpsPvIndex` | 搜索曝光 |

| `seIpvIndex` | 搜索点击 |

| `seCtrRate` | 点击率 |

| `sePayRate` | 支付转化率 |

| `itemPriceRange` | 价格区间 [最低, 最高] |

| `oppImgUrl` | 商品图片 URL |



### 7. 品牌与价格带分析（基于商品榜单数据）



从商品榜中提取品牌信息（从 `title` 中识别品牌关键词），进行：



- **品牌集中度分析：** 统计各品牌上榜商品数、合计交易指数、合计 GMV、平均点击率、平均支付转化率

- **价格带划分：** 按商品售价将商品分为 ¥0~100（经济型）、¥100~200（中端）、¥200~400（中高端）、¥400+（高端），统计各价格带指标



### 8. 生成 HTML 报告并交付



**使用模板快速生成：** 本 skill 附带了标准报告模板 `templates/report_template.html`。复制该模板到 `artifacts/` 目录下，修改模板中的 `DATA` 对象（JS 中约第 110 行开始）填入实际数据即可生成报告。



模板覆盖了以下固定结构，**无需自行编写 CSS 或 Chart.js 代码**：



- **顶部：** 深色渐变 Header + 日期/商品数徽章

- **核心指标卡片：** 8 张卡片，带不同颜色左边框（accent-1~8）

- **趋势图：** 交易指数&GMV 柱线混合图 + UV&点击率 柱线混合图

- **5 个 Tab 页签：**

  - Tab 1「类目概览」：每日明细表 + 热搜关键词 TOP10

  - Tab 2「商品榜单」：商品 TOP20 表（含排名、品牌标签、价格）

  - Tab 3「品牌分析」：品牌份额饼图 + 均价柱图 + 品牌数据表

  - Tab 4「价格带分析」：价格带商品数柱图 + GMV饼图 + 数据表

  - Tab 5「综合洞察」：6~8 张洞察卡片

- **响应式适配：** 移动端自动适配

- **Tab 切换交互：** 内置 JS 事件绑定



**使用方法：**



1. 读取模板文件内容：

   ```python

   read_file(file_path="<本skill目录>/templates/report_template.html")

   ```

2. 将 `<本skill目录>` 替换为 system prompt 中显示的 skill 绝对路径

3. 复制内容到 `artifacts/<文件名>.html`，只修改 `DATA` 对象部分

4. 使用 `present_files` 交付



**DATA 对象结构说明（模板 JS 中约第 110 行）：**

- `DATA.stats` — 8 个核心指标对象（icon, label, value, unit?, accent）

- `DATA.dailySeries` — 按天数据数组（date, weekday, tradeIdx, gmv, uv, iv, seImps, seClicks, ctr, change）

- `DATA.hotWords` — 热搜词数组（rank, word, tradeIdx, gmv, uv, imps, clicks, ctr, payRate, impsRatio）

- `DATA.products` — 商品数组（rank, title, brand, price, tradeIdx, gmv, uv, imps, clicks, ctr, payRate）

- `DATA.brands` — 品牌数组（name, count, tradeIdxSum, gmvSum, uvSum, avgPrice, avgCtr, avgPayRate）

- `DATA.priceSegments` — 价格带数组（name, count, tradeIdxSum, gmvSum, uvSum, avgCtr, avgPayRate, eval）

- `DATA.insights` — 洞察卡片数组（color, label, text）



> **模板修改原则：** 只改 DATA 对象中的值，不动模板的 HTML/CSS/JS 结构。如需新增卡片或行，按模板中已有对象的格式追加即可。



使用 `present_files` 将生成的 HTML 文件交付给用户。



```python

present_files(file_paths=["artifacts/<文件名>.html"])

```



## 数据洞察撰写指南



报告中应包含以下维度的洞察分析（基于实际数据撰写，不编造）：



1. **时间趋势洞察：** 工作日 vs 周末差异，峰值谷值分析

2. **精准词 vs 泛词：** CTR 对比，支付转化率对比，流量效率分析

3. **品牌格局：** 头部品牌集中度、竞争格局

4. **价格锚点：** 主力价格带、高客单价策略

5. **功能卖点趋势：** 从标题高频词提炼的消费者关注点



## 注意事项



1. `qiwrok_list` 如果 list_type=`tradeIndex` 返回 404，换 `rexiao` 重试

2. 日期范围不能超过 `max_lookback_days`，否则 API 会报错

3. HTML 报告使用 Chart.js CDN（`https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js`）

4. 报告支持移动端响应式布局

5. 商品价格区间取 `itemPriceRange` 的均值作为代表售价

6. 品牌识别：从商品标题中提取品牌关键词（如"优衣库""海澜之家""蕉下""罗蒙"等），无明确品牌的归类为"其他"

7. 分 Tab 页签展示时，默认激活 Tab 1（类目概览），用 JS 的 class 切换控制显示



## 完整示例（基于 Polo衫 分析）



### 定位类目

```

一级：男装

二级：Polo衫（id: 365）

```



### 数据周期

```

latest_stat_date: 2026-07-13

max_lookback_days: 7

start_date: 2026-07-07

```



### 关键指标（7天合计）

```

交易指数: 116,383

GMV: ¥1,538.8万

UV: 382.8万

IV: 1,608.7万

CTR: 4.43%

商品数: 2,015件

```



### Hotwords TOP5

```

1. polo衫男       tradeIdx: 5,224, CTR: 9.20%

2. polo衫男款     tradeIdx: 3,465, CTR: 8.12%

3. 男士短袖t恤    tradeIdx: 2,871, CTR: 6.24%

4. 男士polo衫     tradeIdx: 2,454, CTR: 8.48%

5. 短袖           tradeIdx: 2,107, CTR: 5.13%

```



### 品牌 TOP3

```

1. 海澜之家 — 7款上榜，交易指数合计 11,907

2. 优衣库 — 2款上榜，交易指数合计 7,663（单品王 AIRism）

3. 罗蒙 — 3款上榜，交易指数合计 3,356

```

---

## 证据分级（输出结论前必读）

本技能输出任何"结论"前，先按**证据四分级**标注级别（Observed 直采 / Calculated 计算 /
Proxy 代理推断 / Unknown 未知），并遵守五条禁止推断——尤其是：
**sycm/万相台指数一律标 Proxy，不得当绝对量**；**Unknown 不得当 0 参与平均**。

完整分级表、五条禁止推断与国内场景注释见 [references/evidence-rules.md](references/evidence-rules.md)。
