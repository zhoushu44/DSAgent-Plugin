# Accio 技能内容层学习报告 · 方法论与可直接移植的资产

> **分析对象**：`D:\软件\Accio`（Electron 应用）技能内容层
> **与既有文档的分工**：[ACCIO-REVERSE-ANALYSIS.md](./ACCIO-REVERSE-ANALYSIS.md) 覆盖**架构层**（质量门禁 / tool_triggers / SkillHarvest / 渐进披露 / 技能 ID）。
> 本文覆盖**内容层**——130 个官方技能里真正值得抄的**方法论、阈值、公式、契约与反幻觉机制**。
> **语料来源**：
> | 来源 | 内容 | 位置 |
> |---|---|---|
> | 远程技能库 | **130 个官方 skill**（v0.0.104），已全量下载解包 | `_accio_probe/skills/`（1204 文件 / 383 md） |
> | 用户本地技能 | 6 个（含 image-prompt-guide 103KB + 24 references） | `~/.accio/accounts/*/skills/` |
> | 明文 wiki 技能 | merchant-wiki-compiler（八域本体） | `D:\软件\Accio\_staging\resources\wiki-skills\` |
> | 声明式 RPA DSL | 10 个平台身份探测 | `_staging\resources\global-memory-workflow\dsl\` |
> | 已装插件 | geo-agent / multi-channel-inquiry 等 | `~/.accio/accounts/*/plugins/installed/` |
> | 插件市场 | 80 个插件 / 17 分类 | `remote-catalog-cache-zh.json` |
> **分析方法**：自写 ASAR 解析器 + Node fetch 拉取全部远程 zip，再按主题分 8 路深读（含 references/scripts/templates，不只是 SKILL.md）

---

## 0. 一句话结论

**Accio 的内容层价值不在「功能」，而在「判断的确定性」。**

它的 130 个技能里，真正稀缺的不是功能覆盖（选品/生图/投放你都有），而是这三类可复用资产：

1. **把模型的主观判断替换成可执行的门禁** —— 打分卡写在 Python 里、判决矩阵有硬 veto、季节性有 CV 阈值和「样本不足」分支。
2. **把「不知道」做成一等公民** —— Observed/Calculated/Proxy/Unknown 四分级 + 「Unknown 不得当 0 平均」+「证据不足就返回验证计划而不是编一个赢家」。
3. **把「一图一屏」变成类型化的能力栈** —— Composite Slot Model（L0-L5 层）+ 富化强制令，用结构而非审美消灭「N 张近似图」这个最常见的失效模式。

而它最大的**反面教材**同样重要：**过时/无来源的基准数字**（Amazon $20 门槛、FBA 尺寸档、email 基准）在中国电商场景下基本失真，且部分文件之间存在**互相矛盾的公式**（6 个已确认 bug）。

---

## 1. 已经吃掉的 / 不要重复投入

对照本仓库现状（已核实源码）：

| 能力 | 状态 | 证据 |
|---|---|---|
| 技能质量评分（Accio 加权 rubric，双语化） | ✅ 已移植 | [src/services/skill-quality.ts](src/services/skill-quality.ts)：权重 Workflow .20 / name .15 / desc .15 / body .15 / section .15 / err .10 / precond .10；阈值 BODY_MIN 200、WORKFLOW_MAX_STEPS 7、DESC 72–420 |
| `tool_triggers` 解析与匹配 | ✅ 已移植 | [src/services/tool-triggers.ts](src/services/tool-triggers.ts) |
| 技能使用统计（useCount/lastUsedAt + 评分） | ✅ 已移植 | [src/services/skill-stats.ts](src/services/skill-stats.ts) |
| `SKILL.patch.md` 现场修正层 | ✅ 已移植 | [src/services/skill-patch.ts](src/services/skill-patch.ts) |
| 质量审计脚本 | ✅ 已有 | [dev/audit-skill-quality.mjs](dev/audit-skill-quality.mjs) |
| 自进化模板/示例/脚本 | ✅ 已移植并适配路径 | [skills/self-improvement/](skills/self-improvement/) |
| 部分 Accio 技能（14 个同名） | ✅ 已导入并中文化 | 见 §7.1 |

**关键空白（本文档主要针对）**：**没有任何评测基础设施**——`skills/**/evals/**` 为空，无 assertions、无 baseline、无 benchmark、无 timing 采集。意味着**没有一个技能被证明过它比不写技能更好**。`SKILL-CHECKLIST.md` 的 24/24 是人类 UI 对话验收，不是可回归评测。

---

## 2. 跨板块「元机制」——最高价值，优先级高于任何单点阈值

这 6 条横跨选品/数据/推广/生图，是整套语料里**平台无关、可直接泛化**的部分。

### M1 · 证据四分级 + 五条禁止推断（`market-insight-product-selection/references/evidence-and-scoring.md`）

| 标签 | 含义 | 允许的结论强度 |
|---|---|---|
| **Observed** | 来源直接报告该指标 | 可支撑事实断言；须引用市场/周期/口径 |
| **Calculated** | 基于已披露观测值的可复现算术 | 须给出公式与纳入/排除项 |
| **Proxy** | 间接证据，只能指示方向 | 用方向性措辞并解释推断 |
| **Unknown** | 缺失/过期/不可比/不可靠 | 不得乐观计分；标注下一步验证 |

硬规则逐字：
- "**Never present a proxy as an observed fact.**"
- "Selling price or a generic markup **does not establish margin**."
- "**Average rating does not establish positive-review rate** unless the rating distribution and threshold are available."
- "**Source authority alone does not make two figures comparable.**"（须核对地域/渠道/周期/类目层级/样本/口径）
- "**Do not average `Unknown` as if it were neutral or zero**; keep the uncertainty visible."
- "**Avoid decimal rankings and arbitrary weights.**"
- "**Confidence measures evidence quality, not opportunity attractiveness.**"

> **对国内场景的额外价值**：生意参谋返回的是**指数**而非绝对值——这**字面就是 Proxy**。这条 schema 天然适配，应强制要求「不得把指数当 Observed 呈现」。

### M2 · 证据预算 + 停止规则 + 逃逸阀

- "target **three to five decision-relevant sources** rather than broad coverage"
- "keep the default investigation to **at most eight external research tool calls total**, counting each search and fetch operation separately even when issued in a batch"
- "**Do not continue researching merely because new entities appear.** Stop when additional evidence is unlikely to change the ranking, confidence, or next action."
- **逃逸阀**："**If evidence cannot support a useful ranking, say so directly and return a validation plan instead of manufacturing a winner.**"

### M3 · 交叉验证 ≥2/3 + 「Mixed Signals」标签

> "The final stage classification must be consistent across **at least 2 of 3 signal sources** (ads, trends, marketplace). If signals conflict, flag as **'Mixed Signals — Further Research Needed'**."

可泛化为：**任何结论须 ≥2 个独立来源**。

### M4 · 利润门优先于一切定性结论 + 强制降级

> "**Profitability Gate** (must pass regardless of stage): Gross margin ≥50%; Net profit per sale (after ads) Positive; Ad cost ratio <30% of selling price."
> "**If Early Growth but fails profitability gate, downgrade to Cautious.**"

一句话固定了「择时/故事性」与「经济性」的优先级，防止模型给出乐观叙事。

### M5 · 双层门：分数门 AND 硬 veto 门

`market-viability-logic-auditor/scripts/product_criteria_checker.py`（100 分起扣）：

```python
score = 100
if monthly_sales < 100:            score -= 20
elif monthly_sales > 300:          score -= 10
if price < 20:                     score -= 25   # 权重最高
if competition_level == "high":    score -= 20
if is_electronic:                  score -= 15
if is_bulky:                       score -= 15
if is_fragile:                     score -= 15
if has_major_brand:                score -= 20

passed = score >= 60 and not (is_electronic or is_bulky or is_fragile or has_major_brand)
```

**设计要点**：分数达标还不够，4 个布尔 veto 任一为真直接 FAIL。这个「评分 + 一票否决」的双层结构可直接复用到任何准入判定。

### M6 · 反浅薄答案的量化下限

`jungle-scout-deep-dive-analyzer`：
- 子问题须同时满足 5 条：Data-Premised（以具体数字开头）/ Cross-Referential（引用 ≥2 个 CSV）/ Decision-Oriented（以决策含义结尾）/ Calculable（要求计算而非复述）/ Non-Obvious
- `answer_text` **≥150 词且 ≥3 个具体数字**；`analysis_reasoning` **≥100 词且至少一次计算**
- 报告总字数 **≥4000**，每节 **≥200 词**
- 自检："If any question is just a dimension name rephrased (e.g., 'Analyze the competitive landscape'), regenerate it."

**配套的 Direct-answer boundary（HARD RULE）**：
> "An ordinary request to analyze, identify, compare, or recommend is a chat answer, **not authorization to create an artifact**. … **Do not call file-writing, editing, or presentation tools; create or present a report; or start a research/verifier Agent.** Only do so when the user explicitly requests a downloadable file or report, exhaustive/deep research, or independent verification."

这条直接对治「Agent 过度产出」。

---

## 3. 电商选品

### 3.1 六类选品哲学（不是流水线，而是路由）

| # | 框架 | 技能 | 核心问题 | 适用 |
|---|---|---|---|---|
| 1 | 四段漏斗：行业→消费者→选品→供应商 | `product-selection` | 从零到一个可下单 SKU | 只有模糊行业。**入口由上下文决定**（无行业→Step1+2；有行业无品类→Step2+3；有行业+品类→Step3；要供应商→Step4） |
| 2 | 决策框架 + 证据分级 | `market-insight-product-selection` | 碎片信号 → 可审计排序 | 已有候选。**明确反对跑全流程**："A narrow question should receive a narrow answer." |
| 3 | 场景驱动（3 购物时刻 × 20 策略） | `scenario-driven-product-scout` | 从需求场景反推创意 | 创意生成而非数据筛选 |
| 4 | 风险优先筛除 → 阈值 → 利润 → 判决 | `market-viability-logic-auditor` | Go / Further Research / Reject | **先跑排除清单再谈数据** |
| 5 | 生命周期择时 | `trend-stage-timing-analyzer` | Early / Peak / Saturation | 回答「进场晚不晚」，不回答「卖什么」 |
| 6 | 逆向解码爆款 | `bestseller-pattern-decoder` | 从 top 1% 反推 listing 蓝图 | 已定品类 |

**核心路由手法**：每个技能用 description 里的 `Do NOT use for` + 开头的 `> **Scope:** For X use other-skill` 互相划界。**这个防歧义手法应直接照搬到我们的插件。**

### 3.2 排除清单（7 条 auto-reject）

| Filter | 风险理由（原文） |
|---|---|
| Electronics | High return rates (15-30%), certification requirements, technical support burden |
| Bulky (>20 lbs or >18"×14"×8") | Excessive storage/shipping fees |
| Fragile | Damage in transit → high return rates |
| Major-brand-dominated | Prohibitive ad costs; suppressed organic visibility |
| Restricted/gated | Requires platform approval; unpredictable timeline |
| Highly seasonal (**仅第一个产品**) | Inventory cash-flow risk; dead stock in off-season |
| Compliance-heavy (FDA, CPSC) | Regulatory barriers; liability exposure |

### 3.3 三态判决矩阵

| Verdict | Criteria |
|---|---|
| **Go** | 过全部排除项 + 全指标 PASS + margin ≥25% + profit ≥$5/unit + 趋势稳定/上升 |
| **Further Research** | 过排除项 + 多数指标 PASS 但 1-2 项需深查 |
| **Reject** | 触发任一排除项，OR margin <25%，OR 趋势下滑，OR **≥3 项市场指标 FAIL** |

### 3.4 可移植的算法（平台无关，直接可用）

**① CV 季节性检验**（少见的带「数据不足」分支的可用算法）：

```
mean = sum(values) / N
std  = sqrt(sum((vi - mean)²) / N)
cv   = std / mean

cv > 0.5  → "Seasonal"        cv ≤ 0.5 → "Non-seasonal"
N < 12    → "Insufficient data"    mean == 0 → "No search volume"
```

**② 品牌垄断度算法**：

```
top_brand_share = max(combined_weighted_sov)
top3_share      = sum(top 3 combined_weighted_sov)

top_brand_share > 0.30 → 🔴 "Single brand monopoly"
top3_share      > 0.60 → 🟡 "Concentrated market"
otherwise              → 🟢 "Fragmented market"
```

**③ 关键词机会分**：`opportunity score = search_volume / organic_product_count`（分母换国内竞争度指标即可）

**④ 属性加权铁律**：
> "Use **sales-weighted** share, not listing-weighted. A tag on 15% of listings might capture 40% of sales (undersupplied opportunity); a tag on 30% of listings might drive only 10% of sales (oversupplied, avoid)."

**⑤ 产品可行性 /70 打分卡**（7 维）：Market Demand / Competition (lower better) / Trend Potential / Differentiation / Profit Margin / Production Feasibility / Personal Interest。判据：**50-70 Excellent；35-49 Average；<35 Not recommended**。

**⑥ 测试止损判据**：
- Success（**满足 ≥2**）：前 2 周至少 1 单；收藏率 **>5% of views**；浏览持续增长
- Failure（**满足 ≥1**）：**2 周内浏览 <50**；2 周内无收藏无成交；差评/退货率高

### 3.5 阈值总表（标注可用性）

| 指标 | 阈值 | 国内可用性 |
|---|---|---|
| 月搜索量 | ≥5,000 | 🔄 换生意参谋搜索人气，按类目分层 |
| 每卖家月销量 | 100-300 units | 🔄 换类目基准 |
| 评论验证带 | 300-1,000 | ❌ 国内评价体系 + 刷单干扰 |
| 首页评论数 | <500 | 🔄 换「累计评价/月销比」 |
| BSR 甜点区 | 100-5,000 | ❌ Amazon 独有 |
| 广告数 | <20 早期 / 100+ 饱和 | 🔄 换抖音/小红书投放数 |
| sponsored_ratio | >0.80 ⚠️ 高广告依赖 | 🔄 换全站推广占比 |
| Profit margin | min 25% / target 30-40% | ✅ 通用 |
| Profit per unit | min $5 / target $8+ | 🔄 换人民币档 |
| 售价 | ≥$20 | 🔄 **换毛利率门槛更稳**（9.9 包邮生态下 $20 完全失真） |
| 广告投入 | 初期 10-15% of revenue | 🔄 换 ROI/ACOS |
| 退货率 | <10% | ❌ 国内服饰 30-50% |
| 迭代预期 | 评估 50-100 个候选才出 1 个 | ✅ 通用 |

### 3.6 20 个选品策略（可枚举的创意生成器）

4 组 × 5：**现有产品**（互补/替代/升级/简化/套装）· **市场需求**（解决问题/追趋势/季节/节日/怀旧）· **目标人群**（小众/职业/爱好/生活方式/身份认同）· **产品创新**（功能/材料/设计/个性化/可持续）

组合规则："**Combine 2-3 strategies** for stronger differentiation."（例：Seasonal + Personalized + Sustainable）

---

## 4. 生图（AI 图像生成）

### 4.1 Composite Slot Model —— 全语料最高价值的单一设计

> **核心规则**："a planned set image is a **slot**, not a single scene. One slot = one **base visual layer** + the overlay layers that slot's message requires."

| 层 | 角色 | 是否计入富化 |
|---|---|---|
| **L0 Base** | 拍摄环境；scene-base（支撑槽**默认**）或 clean studio（仅 hero / A4 cutaway / A6·A8 contents） | 必有 |
| **L1 Copy** | 标题 + 副标 + 短标签，**至少两级文字** | ✅ 富化层 |
| **L2 Graphics** | L2-anno（引线/箭头/剖切）· L2-geo（等分栏/步骤徽章/网格/平铺）· L2-ui（屏内卡片） | 可选；**L2-anno 每套限 1 槽** |
| **L3 Human** | 模特/手/使用动作 | 按产品规划，通常 1-2 槽 |
| **L4 Accessory** | 开箱清单、配件阵列 | ✅ 富化层 |
| **L5 Second subject** | 手机/App 屏、控制器、配套设备 | ✅ 富化层 |

**富化强制令（HARD）**：
> "In every platform image set, only the first/hero slot may be a single-capability image. **Every other slot MUST be a composite slot.**" → 每个支撑槽 = `L0 + ≥2 富化层`

**明确禁止作为支撑槽**（这四种只能作为「额外图」交付）：
1. 换角度的白底图，没加任何东西
2. 无标签、无引线、无交互的微距裁切
3. 没有文案、没有图形、没有人、没有配件的纯场景照
4. 与另一槽**仅机位不同**的图

**栈规则**：`L0(+L3) only` → standard 档；含 L1/L2/L4/L5 任一 → dense-layout 档。**"layer count never multiplies AI calls"**（每槽 1 次合并调用）。

**事实门**：L1/L4/L5 内容必须来自用户或源图可见。"Never invent copy, accessory counts, battery/runtime data, UI features, or certifications just to fill a layer."

> **为何这是 #1 可移植资产**：它把「给我做几张图」从审美问题变成**结构问题**，用一个硬性最小值消灭「N 张近似底图」这个最常见的失效模式。而且它不限于图像——任何「底素材 + 叠加层」的交付物都适用。

### 4.2 槽位差异化契约

**10 项封闭消息分类**（每槽必须独占一条，不得重复）：
`what it is` · `where it is used` · `who uses it and how it feels` · `how it works inside` · `how it is operated` · `how it is cleaned` · `what is included` · `configuration/state options` · `scale vs human` · `material and finish quality`

**差异化矩阵**（写 prompt 前先填；"Two slots may not share the same value in more than two columns"）：`Place` | `Shot scale + camera height` | `Product position & occupancy %` | `Expression mode` | `Enrichment layers` | `Person present?`

**反作弊定义（关键）**：
> "flipping the composition left↔right, nudging the camera a few degrees, or swapping which side the person's arm enters from produces a **duplicate**. A real variation changes at least the message plus one of {place, shot scale, expression mode, interaction level}."

**修复顺序**：**先改消息，再改底场景，最后改景别。绝不用「加更多文字或更多引线」来修复相似度。**

### 4.3 表达模式多样性（配额可门禁化）

| 模式 | 承载方式 | 文案角色 |
|---|---|---|
| **M1 编辑摄影** | 一张强照片 + 留白区标题 | 卖点/场景标题，**产品上无标签** |
| **M2 叙事场景** | 人/宠物/动作讲故事 | 场景标题 + 一行支撑 |
| **M3 几何驱动** | 等分栏、双联、编号步骤、平铺 | 每栏短说明 或 一条功能条 |
| **M4 标注技术** | 引线、点锚、箭头、剖切 | **唯一允许标注部件的模式** |
| **M5 第二主体演示** | 手机/App/控制器入镜 | 精确 UI 字符串 + 标题 |

| 请求张数 | 需覆盖的不同模式 | 上限 |
|---|---|---|
| **4** | **≥3** | M4 ≤ 1；其余模式不超过 2 次 |
| **5-6** | **≥4** | M4 ≤ 1；其余不超过 2 次 |
| **7+** | **≥5** | M4 ≤ 1；其余不超过 3 次 |

**「一槽标注」硬规则**：全套只有 M4 那一槽可以有引线/点锚/箭头；其余信息移进说明、步骤栏或环境里。

### 4.4 排版系统（selling-point.md Step 5）

**它要杀死的三种失效**："type pasted over a photo, **every image in a set wearing the same bold-black-headline + grey-subhead uniform**, and — for Chinese copy — **every slot set in the same flat 黑体**."

**字号层级**（关键数字）：
| 层级 | 尺寸 | 约束 |
|---|---|---|
| **H1 标题** | cap height **≈6–9% 画布高** | ≤2 行；**≤12 汉字或 ≤6 英文词/行** |
| **H2 副标** | **H1 的 45–60%** | 1-2 行 |
| **H3 功能条** | **H1 的 30–40%** | 可选，每图 1 条 |
| **标签/说明** | **H1 的 25–35%** | ≤6 词 |

- "**avoid H1/H2 within 20% of each other**"
- **每图最多三级文字，绝不超过四级**
- **断行必须写死在 prompt 里**："never let the model choose the break"

**文字块质量规则（核心）**：
> "**Block footprint**: the text block occupies roughly **8–18%** of the canvas for a corner block, lower third, or side column, and **18–28%** for a top band, split header, or numeral-led block. Below that range, add the second level or another device — **never just enlarge one line**."

> "A single four-character headline at the low end of the H1 range occupies **under 3%** of the canvas: fully compliant on font size, and still reads as a watermark someone forgot to remove."

- **每个带字图至少两级**（H1+H2 或 H1+H3 条）；**"There is no single-line option."**
- 单个 <8 汉字（或 <4 英文词）且无第二级、无装置的一行**不构成文字块**
- **先把区块区域预留为负空间**，让文字落在「规划好的空」里，而不是「碰巧安静的角落」
- **"Mass comes from level count, device count, and the block's footprint. Stretching L1 past its word cap to fill the space it leaves is a failure, not a fix."**

**对比方向 3 档**：dark-on-light（用场景最深的中性色，或**调过色**的深中性——espresso/bronze/walnut/forest/navy/plum，**不用纯黑**）· light-on-dark（纯白/柔白/暖象牙/奶油，**"a first-class option, not a fallback"**）· tone-on-tone
- 允许 **15–40% 不透明度的柔边染色遮罩**承载浅色字
- **"Never gain contrast through outlines, drop shadows, or glows"**

**装置清单（14 项 + 5 项中文专属）**：eyebrow/kicker · headline · subhead · hairline rule · tracked feature strip · numbered badge · per-column caption · small-caps spec block · pull-quote · footnote/safety note · in-frame leader label（仅标注槽）· oversized numeral · translucent scrim band · italic accent word
中文专属：**竖排标题条** · **全角分隔功能条**（定时喂养｜份量设置｜余粮可视）· **括注副标题**（【】/（））· **方框细线标题** · **印章式小色块**
- 每槽用 **2-3 个装置**；4 图套至少 **4 个不同装置**；6+ 图至少 **6 个**

**12 类中文字体语气**（反「清一色黑体」）——这是全套里最稀缺的中文排版资产：
| 语域 | 中文字体 | 具体属性 |
|---|---|---|
| 中式文化/茶酒/高端编辑感 | **宋体/明朝体** | 横细竖粗高对比、三角衬线；标题可用中粗宋 |
| 说明/规格/克制文书感 | **仿宋** | 笔画均匀偏细、瘦长、行距宽松；用于参数条，不做大标题 |
| 传统手作/礼赠/老铺食品 | **楷体** | 手写楷书骨架、起收笔柔和；一行标题上限 |
| 国潮/白酒/力量感国风 | **魏碑** | 刀刻方峻、笔锋外扩；仅标题，副文改黑体 |
| 节庆/文创/茶酒礼盒 | **书法行书毛笔体** | 连笔墨韵；每图最多一行，必须配黑体或宋体副文 |
| 传统食品/中药/匾额感 | **隶书** | 横向扁平、蚕头燕尾、字距略宽 |
| 科技/家电/商务/参数 | **黑体** | 等粗方正、字距紧凑；一个冷调强调色 |
| 母婴/宠物/儿童/甜品 | **圆体** | 圆角收笔、低压迫、中等字重 |
| 极简美妆/护肤/香氛 | **方头黑/等线体** | 极细至常规等线、几何骨架、眉题宽字距、大留白 |
| 工业/五金/B2B/OEM | **长体黑/压缩黑体** | 窄体、技术标签、克制石板灰；数字用等宽字形 |
| 复古国货/老招牌 | **美术字/复古招牌体** | 几何化手绘字形；仅标题，不加立体描边 |
| 大促/量贩性价比 | **综艺体/粗方头标题体** | 高字面率、紧排；**平台受限，不得作为「让标题更醒目」的捷径** |

**中文执行 7 条**：配对不混排（**"Never set Latin words in a CJK face, and never set the Chinese headline in a Latin face"**）· 用字号和颜色而非字重建立层级（**"Never fake bold or fake italic (伪粗/伪斜)"**）· 每槽**至少移动 2 个杠杆**（字重档位/字号/skeleton/竖排vs横排/对比方向/全角分隔符）· **字形完整性条款** · 简繁锁定 · 标点与断行（标题不带句末句号；不得以 `，。、）」` 开头）· 字距（**"a Chinese headline is never letter-spaced character by character"**）

**字形完整性条款（每个中文带字图强制写入 prompt，逐字）**：
```
每个汉字必须笔画完整、结构正确，无错字、缺笔、多笔、变形或生造字；不得渲染成近似字形。
```
配套："Keep each line short (≤12 characters) and prefer common characters."

**表现性效果预算（7 条门禁全须满足）**：
1. **每图最多 1 种效果，只作用于 1 个层级**——"an outlined + shadowed + gradient headline is exactly the 牛皮癣 look this budget exists to prevent"
2. **语域门**：语域表未列出的效果不可用，"no borrowing it 'for variety'"
3. **平台门**：**"a treatment is an overlay, not a font"**——平台禁文字/推广语/装饰叠加的槽，这些效果同样被禁
4. **绝不能当可读性补救**："If contrast is the problem, change placement, flip the contrast direction, or use the translucent scrim"
5. **套级上限**：4-8 图套最多 **1-2 槽**带效果，**绝不用在 hero / 剖切槽 / 参数槽**
6. **prompt 里写具体参数**，"never 'cool text effect'"
7. **中文守则**：描边/投影/渐变/金属仅可大字号单一使用且必带字形完整性条款；**膨胀、扭曲、弧形、浮雕变形绝不能作用于汉字**

**两个经典失效模式**（极好的 few-shot 诊断样本）：
- **失效 1「角落印章」**：暖调生活照角上放一行纯黑粗黑体。四重错误：默认粗无衬线 vs 温馨人文语域、未经取样的纯黑压在木纹上、无光学对齐无预留区、**文案在描述照片而非陈述卖点**。**"Fix the copy first, then design it — never fix it by enlarging or bolding the same line."**
- **失效 2「设计良好的孤行」**：每个排版决策都正确，结果仍然失败——**"one level plus one rule is not a text block"**，只占画布 ~3%。**"This is the failure the two-level minimum exists to stop."**

### 4.5 平台规格：⚠️ 国内 6 平台只有 1688 有主图数字规格

**这是全语料最重要的诚实性发现**（**主图层** `platform-specs-china.md`）：

| § | 平台 | 数字上传规格 |
|---|---|---|
| 11 | **1688** | ✅ 覆盖 |
| 12 | Taobao 淘宝 | ❌ **not covered — verify officially** |
| 13 | Tmall 天猫 | ❌ **not covered** |
| 14 | Douyin 抖音电商 | ❌ **not covered** |
| 15 | JD 京东 | ❌ **not covered** |
| 16 | Pinduoduo 拼多多 | ❌ **not covered** |

> **⚠️ 更正说明**：本节此前误写为「只有 2/16 平台有数字规格」。按源文件逐字核实，**主图层海外 10 平台全部有完整数字规格**，国内 6 个里只有 1688 有 → 准确表述是 **11/16 有，5/16 未覆盖**。

> **⭐ 另有独立的详情页层**（`pdp-platform-specs.md`）——**那一层国内平台是有数字的**：
> | 平台 | 详情页宽度 | 其他 |
> |---|---|---|
> | 淘宝 | **≥1440px 推荐** | 每图 高÷宽 ≤2；总高 ≤100000px；≤20 张 |
> | 天猫 | **1440px** | 每图 高÷宽 ≤2 |
> | 京东 | **990px (PC) / 750px (移动)** | 每图 ≤500KB 推荐（影响搜索排名） |
> | 拼多多 | **720–750px** | 长图形式；~15 屏内（~20000–25000px）；≤2MB |
> | 抖音 | **620–1290px** | 统一画布 1200 或 1280px；后台展示 ≤50 张 |
> | 小红书 | **1200–1500px** | 1–100 张；单图 ≤5000×15000px；总高 ≤50000px |
> | 1688 | **750–790px 推荐** | 高度不限，总长控制在 ~10 屏内 |
>
> **两层不可混用。** 文件自己也警告："quoting Taobao's 1440px width for a Pinduoduo page is a rejected upload, not a typo"。
> 另注意：**两个文件的 §14 不是同一个平台**——`platform-specs-china.md` §14 是抖音，`pdp-platform-specs.md` §14 是京东。必须在**正在读的文件内**解析平台→章节。

文件明文（两处）禁止凭记忆补数字：
> "**Never fill a missing numeric spec from memory**: an invented pixel size or ratio is a No-Hallucination violation and a rejected listing."

**1688 完整规格（唯一有数字的国内平台）**：
| 字段 | 值 |
|---|---|
| 图片数 | **≥5**（1 主图 + ≥4 支撑） |
| 尺寸 | **≥800×800**；AI 生成目标 2K（2048 长边）后降采样 |
| 比例 | **严格 1:1** |
| 格式 | JPG / JPEG / PNG |
| 单图上限 | **≤5MB** |
| 分辨率 | 工业/技术图 **≥150 dpi**，关键尺寸标注 **mm** |
| 主体占比 | **75%–80%**，居中清晰 |
| 背景 | 纯白 **RGB 255,255,255**，无阴影或极淡阴影 |
| 详情图 | 宽 **≤752px（最大 790px）** |
| 视频 | **MP4, ≤30s, ≥720P** |
| 禁止 | 水印（尤其其他平台的）、消息二维码、外链、过量文字叠加、误导性促销语 |

**海外 10 平台关键差异**（防跨平台串号——文件明确警告"quoting Walmart's 2200×2200 for an Amazon listing is a rejected listing, not a typo"）：

| 平台 | 张数 | 尺寸 | 比例 | 单图上限 | 背景 |
|---|---|---|---|---|---|
| Amazon | 主图 1 + 推荐 ≥6 + 1 视频 | 长边 500–10000，推荐 ≥1600 | 无强制 | 10MB | **强制纯白**，主体 ≥85% |
| eBay | 1–24 | 最小 500×500，推荐 1600×1600 | 1:1 或 16:9 | 12MB | 强烈建议白/中性 |
| Walmart | ≥1，推荐 ≥4 | **US 2200×2200 / CA 2000×2000 @300ppi** | 1:1 | **US 5MB / CA 1MB** | **强制无缝纯白**；<500px 自动下架 |
| Shopify | 1–250 媒体 | 2048×2048 | 推荐 1:1 | 图 20MB | 不强制 |
| Etsy | ≤20 | 长宽 ≥2000；首图 ≥635 | 4:3 或 1:1 | **≤1MB 推荐** | 不强制；禁占位 mockup |
| AliExpress | 1–6（部分 ≤8） | ≥800×800 | 1:1 | 2 或 5MB | 首图强制白底 |
| TikTok Shop | 1–9（推荐 ≥5） | ≥600×600 | **1:1 强制** | 图 ≤2MB 推荐 / 视频 ≤5MB | 首图纯白；**禁文字/图形叠加** |
| Shopee | 1–9；Mall 需 ≥3 角度 | Mall ≥500×500，推荐 1024×1024 | **1:1 强制**（可选 3:4） | ≤2MB | 封面纯色（白优先）；封面主体 ≥60% |
| Lazada | 3–8 | 最小 330×330，推荐 1000 或 1600 | 1:1 | ≤3MB | 首图纯白 RGB 255 |
| Alibaba.com | **4-6 槽（基础 4）** | ≥640×640，推荐 1000×1000 | 1:1 | ≤5MB | 首图强制白底真品，**禁 3D 渲染**；**禁拼图/边框** |

**国内平台「有什么」比「没什么」更重要** —— 5 个平台无数字规格，但有**实质合规硬规则**：

| 平台 | 可执行的硬规则 |
|---|---|
| **淘宝** | **AI 明确允许**（换背景 / 扩图 / 修图 / 生成模特或场景图）——最宽松。定制/预售效果图**必须标 `效果图 / 定制示意`**；二手/样机/残次**必须用实物照片**，不得擦除划痕污渍缺件 |
| **天猫** | AI 允许但**多一条完整性门槛**：信息须真实、准确、**完整**、不误导——**"an image that omits a material fact can fail even when nothing in it is false"** |
| **抖音** | **全球购主图**：正面实物照，**除品牌 logo 外无文字无水印**。禁 **大字报/牛皮癣**、拼图拼接、压缩变形、过度修图。**AI 生成内容有标注义务**，不得假设无标注可接受。内衣「猜你喜欢」封面**不得真人穿着**（且禁一切变通手法） |
| **京东** | 禁自制平台标记（**「京东物流」「京东超市」「官方认证」**）；禁其他平台名称/logo/联系方式/URL/二维码/站外引流。促销图**必须写明活动条件与有效期**；赠品须写种类/规格/数量/时限/获取方式 |
| **拼多多** | **图片不得变形**——"stretch/squash to force a ratio is a compliance failure here, not just a quality one"（直接堵死「拉伸到 1:1」这个常见捷径）。禁**有明确指向性**的误导对比图 |

**国内 8 条共享红线**（每个平台都适用，真正的合规实质）：
1. **一致性契约** —— 图中数量/颜色/规格/销售单位须与标题、属性、SKU、详情页、实物一致
2. **不得生成买家收不到的东西** —— 配件、赠品、道具、功能、包装、认证、奖项、销量、使用效果
3. **SKU 图对应真实变体** —— 不得用高配图配低配 SKU，不得把另售配件当标配
4. **二手/残次是拍的不是生成的** —— 须展示真实状况、磨损、维修、缺件；禁擦除划痕污渍
5. **受监管类目标签绝不重绘** —— 化妆品/食品/保健/母婴的包装、中文标签、成分、净含量、备案信息、适用人群、警示必须来自实物；**绝不编造认证标记（小金盾、有机、专利、检测）**
6. **无医疗或绝对功效宣称** —— 禁疾病治疗/医疗/医美/保健功能宣称；禁伪造前后对比；禁「第一」「最有效」
7. **不侵犯第三方权利** —— 禁未授权品牌、包装装潢、IP 形象、名人肖像；禁「某品牌同款」类混淆表述
8. **卖家承担责任** —— 即使图来自平台自有 AI 工具，商家仍须审核并对结果负责

### 4.6 提示词工程模式（可跨领域复用）

**内容 vs 格式分离**：
| 层 | 负责 | 不得 |
|---|---|---|
| Reference | 操作措辞、模板、固定约束文本、硬约束、安全规则 | 定义标签名、块顺序、必需块集合 |
| Final Prompt Assembly | 标签名、块顺序、分档必需块、分档判定 | 改写、软化、缩短、丢弃 reference 内容 |

**13 块标签化 prompt schema**（固定标签、固定顺序，只能出现这 13 个）：
`1 Asset type` → `2 Input images`（条件）→ `3 Primary request` → `4 Canvas and composition` → `5 Camera` → `6 Scene/backdrop` → `7 Lighting and grounding` → `8 Materials, color and style` → `9 Typography` → `10 Graphics and callouts` → `11 Product invariants` → `12 Allowed changes` → `13 Avoid`

**分档（tier）规则**：
| Tier | 适用 | 必需块 |
|---|---|---|
| `minimal` | 精确单一操作（缩放/超分/去水印/纯白底/单区文字/翻译/换色） | 1, 3, 11–13 |
| `standard` | 需要完整摄影设定（场景/背景、白底 hero、模特、细节、logo 定制、合并保真编辑） | 1, 3–8, 11–13 |
| `dense` | 密集排版（卖点/对比/技术图/流程/logo 生成/多区文字/整版海报） | 1, 3–13 |

**三条硬上限（防 prompt 膨胀）**：
- `Product invariants:` **≤3 行**——"Do not enumerate 20+ protected items — it does not improve compliance and degrades execution"
- `Avoid:` **≤8 项**，并**"Never name a paintable object"**（说「不要花」反而招来花）——道具控制放在块 6 正向列举
- `Allowed changes:` 封闭列表，以 `only` 结尾

**验收检查留在 agent 侧，不写进 prompt**：
> "Acceptance checks are agent-side, not prompt-side. … An image model cannot execute a checklist, and the text merely repeats blocks 11–13 while risking being rendered as on-image text."

**Prompt-Intent Validation Gate（每次调用前必过）**：检查 intent match / no contradiction / no fabricated content / constraint preservation / schema conformance。裁定：
- **仅 schema 违规** → 静默重装 prompt 并重跑 gate，**不得打扰用户**
- **冲突或真实歧义** → 不调用工具，一次性问清（合并其他待决项）
- **用户自己的话就能解决的冲突** → 解决并继续，不算歧义

**Rewriter Output Contract**（场景图）：用户原始输入**绝不直接送 `image_edit`**，必须先经 Rewriter 产出**只有 `prompt` 一个字段的 JSON**，**逐字**用作 `Primary request:`——"do not rephrase, trim, reorder, or summarize it"；且它是**组装输入，不是最终 prompt**。

### 4.7 视频生成（video-prompt-guide）

**按最终时长路由**：≤15s / 15–30s / >30s（拒绝，建议分段）。**按时长而非镜头数路由。**

**DAG 任务协议**（可复用的编排模式）：
1. 首个回复里**并行一次性 `task_create` 全部节点**——"**Do not create tasks in batches, and do not append or insert tasks later.**"
2. `task_list` 取真实 id → 并行 `task_update addBlockedBy` 串联依赖 → 再 `task_list` 校验
3. 按依赖序迭代执行：开始前标 `in_progress`，完成立即标 `completed`
4. **Gate 回环重置现有节点，不创建新节点**（T1 Research 仍有效则保持 completed，不重跑）
5. **结束前不得留任何 `in_progress`**

**分镜表 6 列**：`Shot | Timeline | Visual Content | Camera / Rhythm | Sound / Dialogue | Reference Image`
参考图角色：`visual_anchor`（默认）vs `first_frame`（用户明确要求首帧且模型支持 i2v）

**一个 gate**：Research → 文本脚本 + 模型推荐 → `ask_user` 确认（带 `quickReplies`）→ 模型特定编译 → 生成

---

## 5. 数据判断与经营分析

### 5.1 利润瀑布（最严谨的一版）

```
Gross Revenue − discounts − returns/refunds            = Net Revenue
Net Revenue   − COGS(landed)                            = Gross Profit
Gross Profit  − 支付费 − 平台佣金 − 出库运费 − 履约费      = Fulfillment-Adjusted GP
              − 变动营销费                               = Contribution Margin
              − 固定间接费                               = Operating Profit

Landed Cost = unit price + inbound freight/units + duties/units + prep/units
```

**贡献毛利公式**（evidence-and-scoring.md）：
```
net selling price − product cost − inbound freight − marketplace/payment fees
− fulfillment − expected returns/refunds − advertising/promotion − duties/tax
− variable support costs
```

**利润带（Danger / Healthy / Elite 三列格式本身即可复用为输出模板）**：
| 指标 | Danger | Healthy | Elite |
|---|---|---|---|
| Gross margin | <30% | 50–65% | >75% |
| Contribution margin | <15% | 25–40% | >50% |
| Net margin | <2% | 8–15% | >20% |
| 退货率（硬货） | >12% | 3–7% | <2% |

### 5.2 RFM 绝对过滤（注意：语料里**没有**五分位定义）

| 分层 | 规则 |
|---|---|
| VIP | `Total Spent > 2× AOV AND Orders ≥ 3` |
| At-Risk | `Last Order 90–180 天 AND Orders ≥ 2` |
| New High-Value | `First Order < 30 天 AND Total Spent > 1.5× AOV` |
| Churned | `Last Order > 180 天` |

**队列留存网格**：M1 15/25/40+ · M3 10/20/35+ · M12 5/15/30+（min viable / healthy / excellent）
一次性买家 60–70% / 复购 2+ 30–40% / 高价值 5+ 5–10%（典型值）

**CLV / LTV:CAC**：`CLV = AOV × 年频次 × 生命周期(年) × 毛利率`；`LTV:CAC = 3:1`；回本 `= CAC/(AOV×GM)`，**>12 个月即现金流为负**

### 5.3 库存三公式（含算例，可直接做单元测试）

```
ADD          = 期间销量 / 期间天数
Safety stock = (最大日需求 − 平均日需求) × 提前期天数
Reorder point= (平均日需求 × 提前期天数) + Safety stock
```

**算例**：ADD 5，提前期 14 天，最大日需求 8 → **SS = (8−5)×14 = 42**；**ROP = (5×14)+42 = 112**

**数据质量前置门**：排除取消/退款单 · 标记异常尖峰（闪购、达人带货、一次性促销）为 outlier · **最小历史 6 个月**（基础季节检测）/ **12–24 个月**（同比趋势）

**季节指数**：`月均 = 年总量/12`；`季节指数 = 某月销量/月均`；`预测 = 预期 ADD × 季节指数`

**ABC 分类**：A = 前 20% SKU / 80% 营收 / **每周复盘**；B = 次 30% / 15% / **双周**；C = 余 50% / 5% / **每月**，用大安全库存

**新品无历史降级层级**：Proxy Data（同类历史）→ Market Intelligence → 保守缓冲（先 30 天量，14 天后按实际调）

**服务水平与成本权衡**：
- `缺货成本 = 损失件数 × 单件毛利 + 潜在获客成本`
- `压货成本 = 平均库存价值 × 持有率（通常年 15–25%）`
- `决策：若缺货成本 > 压货成本，提高服务水平（安全库存）`
- `服务水平：畅销 95%，滞销 85%`

### 5.4 动态定价安全包络（给任何会改价的 agent）

- **地板价 = 成本 × 1.15**（硬编码，覆盖一切其他逻辑）
- 天花板 = MSRP
- 单次调整幅度 **≤ ±20%**；仅当变化 **>2%** 才更新；**>10%** 需人工复核
- 促销期间锁定；**2 小时冷却**；竞品跟随 **1–2% 迟滞**
- 数据 **>4–6 小时**则跳过；**7 天 dry-run**；记录 `(timestamp, old_price, new_price, reason_code)`
- 竞品低于 MSRP **>30%** 时触发 stop-loss
- **弹性测试**：选 5–10 个高销量 SKU；50/50 或时序 7天/7天；指标用 **每 session 毛利**（**不是转化率**）；按 5% 步长迭代

### 5.5 A/B 测试套件

**假设语法**："Because [observation], we believe [change] will cause [outcome] for [audience]. We'll know this is true when [metrics]."

**样本量表**（基线 1% / 提升 10% → 每变体 **150k**；基线 5% / 提升 50% → **1.2k**）；95% 置信 / 80% 功效

**时长公式**：`(每变体样本量 × 变体数) / (日流量 × 转化率)`；**最少 1–2 个完整商业周期**

### 5.6 噪声 vs 信号（极实用）

- 30 日均值的 **±20% 内 = 噪声**
- **24 小时内转化率跌 >30% 且流量无尖峰 = 技术信号**
- **AOV 尖峰 +50% 或任一订单 >均值 10 倍 = 需审计**
- **退款滞后 7–14 天**（实时营收总是比结算后好看）

### 5.7 重要性阈值与差异说明

`>$5,000` / `>10%` / `>20%`（**>20% 需书面根因分析 RCA**）
**Varience Commentary 要求**：解释指标**为何**未达或超出目标——不只是报数

### 5.8 DCF 三段校验门（模式比公式更重要）

`FCF = NOPAT + 折旧 − 资本开支 − ΔNWC`
`WACC = E/V×(Rf + β×MRP) + D/V×kd×(1−t)`，其中 `E = 1/(1+D/E)`，`D = (D/E)/(1+D/E)`

**编码默认值**：税率 25% · 增长率 10% · EBITDA 利润率 = 历史均值（否则 20%）· 资本开支 = 营收 5% · NWC = 营收 10% · 永续增长 3% · 退出倍数 10×
**技能默认值**：Rf 4% · ERP 5–6% · kd 5–6%（税前）· 增长率封顶 15% · 年衰减 5%（×0.95/0.90/0.85/0.80）· 永续增长 2.5%

**校验门**：EV 与报告值差 **<30%** · 终值占 EV **50–80%**（>90% 增长过高，<40% 近期过激）· 每股 × 15–25 交叉验算 · WACC 应比 ROIC 低 **2–4%**
**敏感性**：3×3 矩阵 = WACC(±1%) × 永续增长(2.0/2.5/3.0%)

> **值得抄的是这个模式**：先算 → 3 个独立合理性校验 → **任一不过就拒绝呈现**。

### 5.9 ⚠️ 6 个已确认的 bug —— 不要照抄

1. **`customer-ltv-calculator`**：`Target CAC = (Predicted CLV × Gross Margin)/3` **重复计算了毛利率**（CLV 定义里已含毛利）。取其自身算例自相矛盾（"margin-adjusted CLV $300 → 最多花 $100"）。**必须二选一口径。**
2. **`profit-margin-analyzer`**：「若渠道贡献毛利率低于目标 CAC 则在亏钱」——**百分比与美元比较**。应改为每单贡献金额 vs 每单 CAC 金额。
3. **`ecommerce-sales-dashboard`**：Net Sales **定义两次且互相矛盾**（公式表 = `GMV − 折扣 − 退款`，其中 GMV 含税运；排障段 = "excluding tax/shipping"）。
4. **`customer-rfm-analyzer`**：R 定义为「距上次购买天数」（**大 = 陈旧**），但分层表写 "Champions = High R"——**照抄必然反向实现**。且相对表与绝对 90/180 天过滤是两套未协调的系统。
5. **`inventory-demand-forecaster`**：SS 用的是粗糙的 `max−avg` 版本，**无服务水平参数**，但 Best Practices 却要求 95%/85% 服务水平。应升级为 z 值版。
6. **`creating-financial-models`**：代码注释明确假设 **折旧 = 资本开支**——对轻资产电商是真实的现金流扭曲。

### 5.10 语料的系统性缺失

- **相关性 vs 因果几乎从不正面处理**（无混杂变量/遗漏变量/选择偏差措辞）
- **小样本**：只有历史长度下限 + "small samples ⇒ Low confidence"，**没有最小 n、没有置信区间宽度规则**
- **异常值**：仅一条规则（>均值 10 倍）+ 手工平滑，**无 winsorizing**
- **无不确定性量化**（market-insight 有意避免数字："Prefer qualitative levels… Avoid decimal rankings"）
- **无按类目的毛利率表**（只有按渠道：DTC 72% / Amazon FBA 45% / Wholesale 35%）
- **无折扣深度上限**（定价技能约束的是改价幅度，不是促销深度）

---

## 6. 推广与增长

### 6.1 ⭐ 三个 ACoS 的分离（评审认为全语料最高价值的单一想法）

来源 `amazon-prelaunch-ad-budget`（17 个技能里**唯一达到生产级工程标准**的一个）：

| 口径 | 公式 | 含义 |
|---|---|---|
| **市场预期 ACoS** | `CPC / (Price × CVR)` | 市场当前水平 |
| **保本 ACoS** | `pre_ad_profit_per_unit / Price` | 盈亏平衡点 |
| **目标 ACoS** | `0.7 × 保本 ACoS` | 留 30% 利润 |

> **"Never collapse them into one 'target ACoS'."**

**保本 ROAS**：`1 / (1 − COGS% − VarCost%)`，与保本 ACoS 的关系是 `ACoS_be = 1/ROAS_be`——**但语料从未说明这层等价**（见 §6.5 矛盾 1）。

**渠道目标倍数表**：Prospecting **1.2–1.5×** 保本 · Retargeting **2–3×** · Branded **5×+** · Generic **1.5–2×** · Email **10×+**

### 6.2 竞价规则（全数字化，可编码）

| 触发 | 动作 |
|---|---|
| **50+ 点击 / 0 订单** | 暂停关键词 |
| CVR < 2% | 降价 10–20% |
| ACoS > 保本，持续 **14+ 天** | 降价 10–20% |
| ACoS > 2× 保本，持续 **30 天** | 暂停 |
| **30+ 点击 / 0 订单** | 加否定词 |

### 6.3 预算再分配门

- 1P ROAS 连续 **7 天**高于目标 **>20%** → **+20%**
- 低于保本连续 **3 天** → **−20%**
- 低于保本 **<50%** 或落地页 CVR 跌 **>50%** → 暂停
- 节奏带：**>110% / <90%** 为越界
- 预算扩容上限：**每 48–72 小时 +20%**（另一处写「每 24–48 小时 +20-30%」——见矛盾 2）

### 6.4 每周计划审计清单（6 项，可直接做运维 runbook）

`amazon-ppc-campaign-manager` L133-140

### 6.5 ⚠️ 4 处必须解决的内部矛盾（不要两边都抄）

1. **两个保本公式未打通**：`ACoS_be = margin%`（amazon-ppc）vs `ROAS_be = 1/(1−COGS%−Var%)`（roas-analyzer）。二者数学一致，但**等价关系 `ACoS_be = 1/ROAS_be` 从未写明**——同时读两个技能的 agent 会输出矛盾数字。
2. **两个预算扩容上限**："20% every 48-72h" vs "20-30% every 24-48h"
3. **两个欢迎语节奏**：Day 0/2/5 vs Day 0/2/5/10
4. **购物车挽回绝对/相对时间歧义**：正文说 Message 4 在 "+48 hours"，图示增量加起来 49h

### 6.6 弃购挽回 4 消息瀑布

| 时点 | 内容 | 折扣 |
|---|---|---|
| **1h** | 提醒 | **无** |
| **5h** | 紧迫感 | **无** |
| **19h** | 10% / 免运费（48h 有效码） | 有 |
| **24h** | 短信 | — |

- **硬上限 4 条消息**
- **"30-50% of recoveries happen at Message 1 without any incentive."**

### 6.7 生命周期与留存

**按类目的流失阈值表**：
| 类目 | 复购周期 | At-risk | Churned |
|---|---|---|---|
| 消耗品 | 30–45 天 | 45+ | 90+ |
| 服饰 | 60–90 | 90+ | 180+ |
| 家居 | 120–180 | 200+ | 365+ |
| 电子 | 365+ | 400+ | 730+ |

**Email 基准**（渠道绑定，国内需整体重估）：Welcome $2-5 RPR / 45-60% 打开 / 8-12% 点击 · Browse $1.5-4 · Post-purchase $0.5-1.5 · Winback $0.2-0.8
配套：每周上限 4 封 · 16–24h 静默窗 · 180 天 sunset · **1,000 收件人/变体**（>95% 置信）

### 6.8 ⭐ 反幻觉契约（`amazon-prelaunch-ad-budget` L225-271 + methodology L169-190）

> "observed empty ≠ zero demand" · "dropped and reported, not guessed" · schema-drift 停止 · "**not computable instead of estimated**" · 每个数字带证据 + 假设 + 置信标签 · "**a budget whose basis is hidden is not trustworthy**"

**建议**：把它作为**横切契约挂到每个数据绑定技能上**。

### 6.9 真实缺口（只能自己写）

- **Dayparting**：无实质内容（只有"计划在 18:00 前花完日预算"和邮件发送时钟）
- **命名规范**：完全缺失
- **广告政策/受限类目合规**：**完全缺失**，全语料无任何政策引用
- **折扣提升/弹性假设**：缺失——该集群刻意拒绝建模提升，只封顶深度

---

## 7. 商家运营 / 客服 / 供应链

### 7.1 ⭐ 6 维 VOC schema + 三维阈值（ROI 最高的一块）

`customer-voice-analyzer` 的 6 维（建议作为主 schema）：

| 维度 | 捕捉什么 | 例 |
|---|---|---|
| **User Persona** | 谁在买？人群、经验水平、购买情境 | "Beginner gardeners" |
| **Usage Scenarios** | 在哪/何时/如何用 | "Home gym", "Winter camping" |
| **Positive Highlights (Pros)** | 被验证的卖点 | "Surprisingly quiet motor" |
| **Negative Pain Points (Cons)** | 关键缺陷、技术抱怨、质量问题 | "Lid leaks after 2 weeks" |
| **Unmet Expectations** | 用户希望有的功能——迭代路线图 | "Wish it came in larger sizes" |
| **Buying Motives** | 触发加购的钩子 | "Saw it on TikTok", "Needed a gift under $30" |

**标注规则**："A single review often contributes to multiple dimensions."

**三条硬阈值（全篇最可移植的 rubric）**：
```
Cons 提及率 >10%              = critical product flaw, must fix
Pros 提及率 >15%              = validated selling point, amplify in marketing
Unmet Expectations 提及率 >5% = iteration opportunity worth exploring
Buying Motives 高频           = use as ad hooks and listing copy angles
```

**反噪规则**："A flaw mentioned by 30% of reviewers is fundamentally different from one mentioned by 2% — **always quantify**" / "A single passionate 1-star rant ≠ a systematic product flaw"

**平衡采样（含理由链）**：
- "Aim for **100-200 reviews** total; ensure balanced representation (don't over-sample 5-star)"
- "5-star reviews reveal validated selling points; 1-2 star reviews expose critical flaws; **3-star reviews often contain the richest 'wish list' insights**"
- **"Focus on the 'Middle': 3-star reviews often contain the most balanced and detailed technical feedback."**

**数据清洗**：删激励评论（vine / 试用品）+ 一词评论（"Good"）· 富媒体（图片/视频）作为高参与度代理 · **增速异常检测**："A sudden spike in negative reviews often points to a recent manufacturing/QC issue"（把评论流变成批次质量事故预警）

**维度表 schema**：`| Rank | Finding | Mention Count | Mention Rate % | Key Quote |`，其中 `Mention Rate % = Mention Count / Total Reviews × 100%`

**Iteration Gap 输出块（关键设计：把改进项与文案钩子并列）**：
```
TOP PRODUCT IMPROVEMENT OPPORTUNITIES:
1. [Pain point] — Mention rate: X% — Fix: [Specific recommendation]
CORE COPYWRITING HOOKS (from validated Pros + Motives):
1. [Hook] — Based on: [Pro/Motive with X% mention rate]
PERSONA-SCENARIO MATRIX:
- Primary buyer: [Persona] using product for [Scenario]
```
**评论情报直连 listing 优化**——这是本节最有价值的设计。

**评论分析 JSON schema**（`review-analyst-agent`）：
```json
{ "rank": 1, "issue": "Battery drains too fast", "frequency": 47,
  "percentage": "23% of negative reviews", "severity": "High",
  "sample_quotes": [...], "root_cause": "...", "recommendation": "...",
  "expected_impact": "Could improve rating by 0.3-0.5 stars" }
```
> 注意 **percentage 的分母是 "of negative reviews"**，不是全部评论——容易搞错。

`action_plan` 四元组：`{priority, effort, impact, expected_outcome}`，其中 **expected_outcome 量化成星级/比例**（"Could reduce 1-star reviews by 15%"）——很值得移植。

### 7.2 供应商记分卡

| Metric | Definition | Benchmark |
|---|---|---|
| **Fill Rate** | 实收件数 / 下单件数 | >95% |
| **On-Time Delivery** | 在报价交期内送达的 PO 占比 | >90% |
| **Defect Rate** | QC 拒收占比 | <1.5% |
| **Lead Time Variance** | 历史交期标准差 | <3 天 |

`score = onTimeRate × 0.5 + fillRate × 0.5`（注意：**原公式未纳入 Defect Rate**——建议改成三因子加权）

**三分区基准（可直接做红灯阈值）**：
| Indicator | Danger | Healthy | Elite |
|---|---|---|---|
| Fill Rate | <85% | 95% | >99% |
| On-Time Delivery | <70% | 90% | >97% |
| QC Rejection | >5% | <2% | <0.5% |
| Response Time | >48h | <24h | <4h |

**跨章节耦合规则（聪明）**："If a supplier has a Lead Time Variance of **>5 days**, automatically increase the 'Reorder Point' for their SKUs by **15%**."

### 7.3 B2C 卖家五维红绿表（`aliexpress-supplier-evaluator`）

> "**Do not rely on star ratings alone.**"

| Metric | 🔴 Red Flag | 🟡 Neutral | 🟢 Green Flag |
|---|---|---|---|
| 店铺年限 | <6 个月 | 6 月–2 年 | >3 年 |
| 粉丝数 | <500 | 500–5,000 | >10,000 |
| 响应速度 | >24h | 12–24h | <12h |
| 好评率 | <94% | 94–97% | >98% |
| 评价质量 | 只有 5 星无文字 | 泛泛 "Good" | 买家图文 |

**三级放行模式**：
- `Strict`：5 项全绿。建议用于高价（>$100）商品
- `Standard`：≥3 绿且无红
- `Risk`：任一红，只能小样试单

**交叉验证三步**：反向图搜（10+ 卖家共用工厂图 → 价格是唯一杠杆）· 评价差异（A 比 B 便宜 50% 但无图评 → 材质差或调包）· 样品对比（3 个高分卖家各买 1 件比实物）

**维权时效**："Unboxing" 规则（开箱全程录像）· 预计到货 **5 天后**开 INR · 确认收货 **10 天内**开质量争议 · **"If the seller asks you to close the dispute to 'process a refund,' REFUSE. Closing a dispute often voids your platform protection."**

### 7.4 SLA 分层 + VIP 路由 + CSAT 回流

| 客户层级 | 首次响应 | 解决时长 |
|---|---|---|
| **VIP / 高 LTV** | **<1 小时** | **<12 小时** |
| **标准** | **<24 小时** | **<48 小时** |
| **访客 / 潜客** | <4 小时（在线客服） | <24 小时 |

按渠道 FRT：Email <24h（标准）/<2h（VIP）· 在线客服 <1 分钟 · 社媒 <2 小时
CSAT：Good >85% / Excellent >90%
订单上下文收益：`"reduces average handle time (AHT) by 40–60%"`

**VIP 路由（原文 TypeScript，可直译）**：
```ts
const isVIP = ['champions','cannot_lose_them'].includes(customer.segmentScore?.segment ?? '');
const isHighValue = customer.totalSpentCents >= 100000;  // $1,000+
if (isVIP || isHighValue) { priority: 'urgent', tags: ['vip-customer','high-ltv'] }
```

**CSAT 回流闭环**：`CSAT < 2` 的 VIP → 触发创始人外联/高值礼品卡；`CSAT = 5` → 触发推荐计划邀请或索评

**三级升级路径**：Tier 1 通用（政策/订单状态/账号）→ Tier 2 履约/技术（缺件/损坏/站点错误）→ VIP 留存（高 LTV 需高触达或酌情退款）

### 7.5 退货决策与经济性

| 处理方式 | 业务成本 | 留存价值 | 适用 |
|---|---|---|---|
| 原路退款 | 高（现金流出 + 手续费） | 低 | 残次品、首次买家不满 |
| 店铺余额 | 低（钱留在店内） | 高 | 「改主意」、尺码问题 |
| 直接换货 | 中（运费） | 极高 | 尺码、颜色偏好 |
| **「不用退了」** | 变动（商品成本） | 高 | 退运费 > 商品价值的低价品 |

**反退货欺诈三条**：
- **空箱检测**：承运商揽收时称重，若比出库低 **>20%** 则转人工审计
- **序列号核对**：高价电子品出库记录序列号，退货质检时核验
- **退货频率限制**：**90 天内退货率 >50%** 标记「账号复核」

**履约硬门**："**Never auto-restock items without a physical inspection.**" / "Only after the 'Pass' scan should the API trigger the issue_refund or issue_store_credit call"

**基准**：退货率（通用）健康 5–15% / 精英 <3% · 服饰 20–35% / <15%（⚠️ **国内服饰 30–50%，此阈值严重失准**）· 换货率 10% / >25% · 处理时长 3–5 天 / <24h

**最关键的一处日期口径纠错**：
> "**The 'Order Date' Trap**: Calculating the return window from the Order Date instead of the Delivery Date. This penalizes customers for shipping delays. **Always use the delivered_at timestamp** from your carrier tracking."

### 7.6 关税与合规

**输出 schema（逐字）**：
```jsonc
{ "hsCode": "61044200", "hsCodeDescription": "...",
  "tariffRate": 39.0,
  "tariffFormula": "一般关税[11.5%] + 附加关税[27.5%]",   // ⭐ 分解是最值得移植的一点
  "tariffCalculateType": "ByAmount",                      // ByAmount / ByQuantity
  "originCountryCode": "CN", "destinationCountryCode": "US",
  "productName": "Woman Dress", "calculationDetails": {...} }
```
> **`tariffFormula` 拆出「一般关税 + 附加关税」**：对美线（301 附加税）必须展示分解，单给总税率会误导定价。`tariffCalculateType` 决定从价/从量计征，影响低单价商品真实税负。

**De Minimis 免税额度表（必备参考）**：US **$800** · UK **£135** · EU **€150（VAT 从 €0 起征）** · AU **AUD $1,000**

**受限品筛查（按 HS 前缀匹配目的地，在 checkout 阶段拦截而非等报关失败）**：
```ts
const RESTRICTIONS = { AU: ['9305'], IN: ['2207'], CN: ['8517'] };
const isBlocked = countryRestrictions.some(prefix => line.hsCode.startsWith(prefix));
```

**退货政策资格判定（可直接照抄）**：
```ts
const POLICIES = {
  'electronics': { windowDays: 15, restockingFeePct: 15, isReturnable: true },
  'apparel':     { windowDays: 30, restockingFeePct: 0,  isReturnable: true },
  'final-sale':  { windowDays: 0,  restockingFeePct: 0,  isReturnable: false }
};
if (!policy.isReturnable) return { eligible: false, reason: 'Final Sale' };
if (daysSinceDelivery > policy.windowDays) return { eligible: false, reason: 'Outside Window' };
return { eligible: true, fee: policy.restockingFeePct };
```

**法域硬约束**：EU/UK 撤回权法定 **≥14 天**冷静期（须退标准出库运费）· **卫生封条**破封即法定失效 · **11/1–12/24 下单延至次年 1/31** 是行业惯例

**税务三段式时序（缺一段就多缴税）**：先算税 → **支付成功后**才 commit → **退款必须 void**

### 7.7 ⭐ 1688 反幻觉护栏范式（最完整的一个）

`严格禁止` 清单：
```
- 禁止配置、读取、提示用户粘贴或管理 AK。
- 禁止调用 scripts/_http.py、旧 service 层、浏览器或网页搜索引擎请求 1688 商品数据。
- 禁止在 MCP 调用失败后自行通过浏览器访问 1688 网站搜索商品。
- 禁止让 AI 直接改写 MCP 原始商品列表为最终表格；必须调用 Python 后处理脚本输出 markdown。
- 禁止编造商品价格、链接、productId、规格、销量、库存或供货信息。
```
`输出完整性要求`：
```
- 禁止省略、截断或重排表格行。  - 禁止丢失商品链接。
- 禁止把表格改写成列表、卡片或自行组织的格式。
- 除「语言处理」允许的语言转换外，禁止修改 markdown 中的任何数据内容。
- Agent 的补充分析只能追加在 markdown 之后，不能混入表格。
```
错误处理：**原样输出 MCP 错误** / 禁止提示用户配置 AK / **禁止浏览器降级或网页搜索降级**

> **核心范式三元组**：**「确定性计算归脚本、语言转换归模型、且模型不得改动任何数字/ID/URL」+ 失败时禁止降级 + 原样透传错误 + 免责声明模板。**

**三种职责边界显式声明**（很值得抄成模板开头）：
1. 鉴权与 API 调用全部交给 MCP 连接器 —— Agent 不处理 AK / Token / 浏览器授权 / 签名 / HTTP
2. 数据后处理必须交给 Python 脚本
3. **语言由 Agent 显式告知脚本**（脚本不推断语言）

**免责声明模板**："技能运行结果和输出内容可能因适用的 AI agent、大模型不同而产生差异或幻觉，请您对重要信息进行甄别核实。"

---

## 8. 元技能与技能治理（弥补本插件最大空白）

### 8.1 SKILL.md 硬约束（可做 CI 门禁）

**frontmatter 白名单（唯一权威来源 `quick_validate.py:42`）**：
```python
ALLOWED_PROPERTIES = {'name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility'}
```
任何其他顶层键 **硬拒**。

| 字段 | 约束 |
|---|---|
| `name` | `^[a-z0-9-]+$`；不得首尾连字符；不得 `--`；**≤64 字符** |
| `description` | 不得含 `<` `>`；**≤1024 字符**（建议 100–200 词） |
| `compatibility` | 可选，≤500 字符 |

**目录布局与三级渐进披露**：
```
skill-name/
├── SKILL.md          # frontmatter + 指令（<500 行理想）
└── Bundled Resources
    ├── scripts/      # 确定性/重复任务的代码
    ├── references/   # 按需加载的文档（>300 行需 TOC）
    └── assets/       # 输出用文件（模板、图标、字体）
```
> **"Keep SKILL.md under 500 lines"** · 多域用 variant 组织（`cloud-deploy/references/{aws,gcp,azure}.md`）· **分次写入**避免单次 `write` 被 token 上限截断

**description 是唯一触发信号**：
> "This is the primary triggering mechanism - include both what the skill does AND specific contexts for when to use it. **All 'when to use' info goes here, not in the body.** … agents have a tendency to '**undertrigger**' skills … please make the skill descriptions a little bit **'pushy'**."

**文风**：祈使句 · **解释为什么比堆砌 MUST 更有效** · 反向信号："**If you find yourself writing ALWAYS or NEVER in all caps, or using super rigid structures, that's a yellow flag**"

### 8.2 ⭐ 评测闭环（最难自研、最该补的部分）

**目录产物契约**：
```
<skill>-workspace/iteration-N/eval-<name>/
├── eval_metadata.json      {eval_id, eval_name, prompt, assertions[]}
├── with_skill/  { outputs/{metrics.json,user_notes.md}, timing.json, grading.json }
├── without_skill/ | old_skill/
├── timing.json
└── grading.json
→ benchmark.json / benchmark.md / feedback.json
```
全部 JSON 结构集中在 `references/schemas.md`——**单一事实来源**。

**流程（9 步）**：
1. 先写 **2-3 条真实用户会说的话**，给用户看；**只写 prompt，不写断言**
2. **在同一轮同时 spawn with-skill 和 baseline 两个子 agent**——"don't spawn the with-skill runs first and then come back for baselines later"
   - 新建：baseline = 完全不给技能
   - 改进：baseline = **旧版本快照**（`cp -r`）
3. 跑测**进行中**起草断言（客观可验证、描述性命名）
4. **从完成通知里捕获 `total_tokens` / `duration_ms`** —— "the only opportunity to capture this data"
5. 用 `agents/grader.md` 打分
6. `python -m scripts.aggregate_benchmark <ws>/iteration-N --skill-name <n>`
7. analyst pass（看聚合数字掩盖的模式）
8. 起 `eval-viewer/generate_review.py`（无显示环境用 `--static`）
9. 读 `feedback.json`

**Grader 的两个亮点**：

(a) **判定极严**：
> "**PASS when**: … The evidence reflects genuine substance, not just surface compliance (**e.g., a file exists AND contains correct content, not just the right filename**)"
> "**When uncertain**: The burden of proof to pass is on the expectation."
> "**No partial credit**: Each expectation is pass or fail, not partial"

(b) **它同时批评评测本身**：
> "You have two jobs: grade the outputs, and **critique the evals themselves**. **A passing grade on a weak assertion is worse than useless — it creates false confidence.**"
> 产出 `eval_feedback.suggestions[]`，形如 `{"assertion":"...mentions the name 'John Smith'","reason":"A hallucinated document that mentions the name would also pass"}`

**benchmark.json 字段契约（viewer 依赖精确字段名）**：
> "Using `config` instead of `configuration`, or putting `pass_rate` at the top level of a run instead of nested under `result`, will cause the viewer to show empty/zero values."

`grading.json` 的 expectations 必须是 `text` / `passed` / `evidence` 三字段。

**analyst pass 的逐断言分类**：
- 两边都过 → "may not differentiate skill value"
- 两边都失败 → 断言坏了或超出能力
- 有技能过/无技能失败 → 技能确实有价值
- **有技能失败/无技能过 → "skill may be hurting"**
- 高方差 → flaky

**改进循环四心法**：泛化（别过拟合）· 保持 prompt 精简（**读 transcript，不只看最终产物**）· 解释为什么 · **跨测试用例找重复劳动**：
> "If all 3 test cases resulted in the subagent writing a `create_docx.py` … that's a strong signal the skill should bundle that script. … **This saves every future invocation from reinventing the wheel.**"

### 8.3 ⭐ description 触发优化环（本插件完全缺失的能力）

**Step 1 造 20 条查询**（8-10 should-trigger / 8-10 should-not-trigger）：
> "The queries must be realistic and something a Claude Code or Claude.ai user would actually type. … **file paths, personal context about the user's job or situation, column names and values, company names, URLs. A little bit of backstory. Some might be in lowercase or contain abbreviations or typos or casual speech.**"

Bad: `"Format this data"` → Good: `"ok so my boss just sent me this xlsx file (its in my downloads, called something like 'Q4 sales final FINAL v2.xlsx')..."`

**负例必须难（关键）**：
> "don't make should-not-trigger queries obviously irrelevant. **'Write a fibonacci function' as a negative test for a PDF skill is too easy — it doesn't test anything.** The negative cases should be genuinely tricky." → 近失（near-miss）、相邻领域、关键词命中但意图不符

**run_loop.py 参数与机制**：
| 参数 | 默认 | 作用 |
|---|---|---|
| `--runs-per-query` | 3 | 每查询跑 3 次得可靠触发率 |
| `--trigger-threshold` | 0.5 | 正例需 ≥0.5 触发 |
| `--max-iterations` | 5 | 上限 |
| `--holdout` | 0.4 | 按 `should_trigger` **分层**切分 train/test |
| `--num-workers` | 10 | 并行 |

关键工程细节：
- 用 `--include-partial-messages` 从 `content_block_start` **流式早期检测**触发（不等完整 message）
- 每轮**只把 train 结果给改进模型**；"**Strip test scores from history so improvement model can't see them**"
- **最终选优按 test 分**：`best = max(history, key=lambda h: h["test_passed"] or 0)`——"**selected by test score rather than train score to avoid overfitting**"
- 报告指标是 run 级 TP/FP/TN/FN 推出的 `precision` / `recall` / `accuracy`
- `improve_description.py` **硬强制 1024 字符**，超限再发一次自动压缩调用

**一条机制性洞察（决定测试集质量）**：
> "the agent only consults skills for tasks it can't easily handle on its own — simple, one-step queries like 'read this PDF' may not trigger a skill even if the description matches perfectly… **Simple queries like 'read file X' are poor test cases.**"

### 8.4 自进化的六道防膨胀闸门

1. **搜索优先去重**：`grep -r "keyword" diary/` → 加 `See Also` → 在原条目 **bump Count**
2. **3-Count 确认流**：count 3 时**停下来问用户**：
   ```
   I've noticed you prefer X over Y (corrected 3 times). Should I always do this?
     - Yes, always → promote to SOUL.md / MEMORY.md
     - Only in [context] → add scoped note
     - No, case by case → mark case_by_case, stop counting
   ```
   例外（跳过计数立即晋升）：用户明说 "Always do X" / "Never do Y" / "I prefer..." / "Remember that I..."
3. **明确的「不要记录」清单**：一次性指令 · 上下文特定指令 · 假设性讨论 · 第三方偏好（无同意）· **已在 SOUL/AGENTS/MEMORY 中的信息** · **沉默**（"never infer preferences from lack of feedback"）· 任何模糊的单次实例
4. **晋升门槛**：跨多文件适用 / 任何贡献者都该知道 / 防复发 / 记录项目特有约定 / 用户明确表达偏好
5. **压缩**：日记 >~100 条触发；三条 `Use tabs`/`Indent with tabs`/`Tab indentation please` → 合并为一行 `- Indentation: tabs (confirmed 3x)`，原条目 `archived`。规则：**"Never delete diary entries — append-only"** / **"Never lose confirmed preferences during compaction"**
6. **状态机闭环**：`pending → resolved / in_progress / wont_fix / promoted / case_by_case / archived / promoted_to_skill`，每个终态写溯源行

**技能提炼准入（满足任意一条）**：Recurring（`See Also` 链到 **2+** 同类）· Verified（`resolved` 且有可用修复）· Non-obvious（需实际调试才发现）· Broadly applicable · User-flagged

**落盘前 5 项质量闸门**：方案已测试可用 · description 脱离原始上下文仍清晰 · 代码示例自包含 · 无项目特定硬编码 · 遵循命名规范
**落盘后验证**："**Read skill in a fresh session to ensure it's self-contained**"（与 `doc-coauthoring` 的 Reader Testing 同源）

**SKILL-TEMPLATE 三档**（因成熟度不同）：完整版（Quick Reference 表 → Background → Solution → Common Variations → **Gotchas** → Related → **Source**）· 最小版 · 带脚本版
四个设计要点：**`## Quick Reference` 表放最前**（给未来 agent 的 30 秒速查）· **`## Source` 强制回链**（`Learning ID: LRN-YYYYMMDD-XXX`）· **`## Gotchas` 是一等公民** · 命名写成 Good/Bad 对照

**安全边界**：凭据/财务/医疗/第三方 PII/位置模式一律不存
**透明度三原则**：每个基于记忆的动作引用来源（"Using X (from MEMORY.md)"）· 用户可问 "what do you know about me?" · **"If it affects behavior, it must be visible in agent-core files"**

### 8.5 技能发现与安全审查

**skill-finder 分层 + 早停 + 信任与检索顺序解耦**：
```
① 内部目录（已审，~60 个，经常 miss）  ‖  同时发起  ② skills.sh → 首个好结果即 STOP
        ↓ 都未命中
③ Web 搜索（GitHub 全量召回，dry-run 门控）→ 并行验证候选 → STOP
        ↓ 失败
④ ClawHub → SkillsMP（噪声尾部）
```
> "**trust is gated separately from search order** — every external install passes the confirmation gate, so searching broad-but-noisy sources is safe."

**确定性校验（而非判断力）**：
> "**Never install on the strength of a search snippet.** … run a `--dry-run` — it resolves the source and **validates that a real `SKILL.md` exists at that path**. This check is deterministic."

**多 agent 环境关键教训**：
> "**Never `ls …/accounts/*/agents/*/…/skill-finder*` to find the script.** That glob is the #1 failure mode… `head -1` picks some *other* agent's copy… **The load-time base dir is the only reliable anchor.**"

**查询纪律**：多词概念连字符化（`code-review` 111K vs `code review` 449）· 不要过度限定（`testing` 86.7K vs `react-testing` 913）· 避免超短通用词

**skill-vetter 权限风险表（逐字）**：
| Permission | Risk | Justification Required |
|---|---|---|
| `fileRead` | Low | Almost always legitimate |
| `fileWrite` | Medium | Must explain what files are written |
| `network` | High | Must explain which endpoints and why |
| `shell` | **Critical** | Must explain exact commands used |

> **"Flag any skill that requests `network` + `shell` together — this combination enables data exfiltration via shell commands."**

**Critical（立即阻断）**：引用 `~/.ssh`/`~/.aws`/`~/.env` 或凭据文件 · 指令含 `curl`/`wget`/`nc`/`bash -i` · base64 或混淆内容 · **指示关闭安全设置或沙箱** · 引用外部服务器/IP/未知 URL
**Warning**：过宽文件模式（`/**/*`、`/etc/`）· 修改 `.bashrc`/crontab · `sudo` · **提示注入模式**（"ignore previous instructions", "you are now..."）
**抢注检测**：单字符增删改、同形字（l/1、O/0）、多余连字符 — 例：`git-commiter` / `gihub-push` / `code-reveiw`

**四条铁律**："Never skip vetting, even for popular skills" / "**A skill that was safe in v1.0 may have changed in v1.1**" / 存疑先沙箱跑 / 上报可疑技能
> 值得注意：skill-vetter 自己的 frontmatter 就带**自我描述的权限清单 + `trust-score: 97` + `last-audited`**——即**审查所需的元数据必须由技能自己声明**。

**打包排除规则**：`ROOT_EXCLUDE_DIRS = {"evals"}`（**evals 永不随技能分发**）+ `EXCLUDE_DIRS = {"__pycache__","node_modules"}`；打包前先跑 validate

---

## 9. 国内电商适配对照表

### 9.1 可直接平移（平台无关）

| 资产 | 国内对应 |
|---|---|
| 证据四分级 + 五条禁止推断 | 全部分析类技能的地基；**生意参谋指数 = Proxy，必须强制标注** |
| 利润瀑布 + Landed Cost | 换成天猫佣金(2–5%) + 支付宝/微信(~0.6%) + 淘宝客佣金 + 平台服务费 |
| 利润带三列格式（Danger/Healthy/Elite） | **格式本身即输出模板** |
| CV 季节性算法 | 完全通用；日历换双11/618/年货节/春节 |
| 库存 ADD/SS/ROP + 算例 | 完全通用（通用 OR 常识） |
| ABC 分类 + 复盘频率 | 通用 |
| 动态定价安全包络 | ⚠️ 国内还需叠加**价保 / 大促最低价承诺 / 虚构原价**合规层 |
| A/B 设计套件 | ⚠️ 样本量常不可行，改用直通车 AB 测图/测款、万相台计划对比 |
| 噪声 vs 信号 | 通用 |
| 6 维 VOC + 三维阈值 | **淘宝/天猫/拼多多/抖音评论与「问大家」**——中文评论更长更具体，per-aspect 抽取收益更大 |
| 3 星最富矿 / 增速异常检测 | 抖音快手评论增速快，对直播间/短视频爆量后的质量事故预警尤其对口 |
| 供应商记分卡 | 1688 供应商考核：`Response Time` 换「响应/发货速度、复购率、退款率」 |
| 多渠道原子扣减 `WHERE available >= ?` | 淘系 + 抖音 + 拼多多多店共用库存的核心问题 |
| SLA 分层 + VIP 路由 | 旺旺/抖店客服分层（VIP 阈值换店铺 GMV 分层） |
| 退货政策资格判定 | **EU 14 天冷静期 ≈ 《消法》七日无理由** |
| `delivered_at` 口径纠错 | **直接适用** |
| 关税 `tariffFormula` 拆分 + HS | 9610/9710/9810 出口与直邮小包 |
| 组合槽模型 + 富化强制令 | **完全平台无关，最高价值** |
| 槽位差异化契约 | 完全平台无关 |
| 表达模式配额 | 完全平台无关 |
| 12 类中文字体语气 | **中文生图最稀缺的资产** |
| 字形完整性条款 | **直接可用** |
| 13 块 prompt schema + 三档 | 完全平台无关 |
| 反幻觉契约（ad-budget） | 建议横切到每个数据绑定技能 |
| 1688 反幻觉护栏范式 | **国内技能的默认立场** |

### 9.2 必须重写（Amazon/US 专属）

**指标层**：BSR · FBA 费用/尺寸档 · Amazon referral 15% · Amazon's Choice/Best Seller badge · A+ Content · LQS · Bullet Points · ABA/AMZ123 · Share of Voice · `$20` 最低售价 · `$5/单` · Etsy/Shopify 费率 · Google Trends · Facebook Ad Library · `sponsored_ratio` · Vine 评论

**定价法**：AliExpress 2.5–4 倍定价法（基于跨境套利链条，国内内销不适用）

**支付风控全家桶**：AVS/CVV · 3D Secure · Stripe Radar · Authorize-then-Capture · Visa CE 3.0 · Visa/MC Dispute Monitoring（0.65%/0.90%/1.00%）· 拒付理由码（10.4/13.1/13.3/13.5/83/30/53/41）· 签名确认 `>$250`
→ **国内无拒付链路**，替换为「**仅退款率 / 平台介入率 / 纠纷退款率 / 恶意退款与薅羊毛识别 / 虚假发货申诉**」。可借鉴的是**分级阈值 + 证据包清单 + fight-vs-concede 决策结构**这三样抽象物。

**税务**：Economic Nexus `$100k or 200 transactions` · OSS/IOSS `€10,000` · VIES 反向征税 · 7 年留档 · `>5 州自动化申报`
→ 国内替换为发票/税控/小规模与一般纳税人；**但「先算税 → 支付成功后再 commit → 退款必须 void」的三段式时序**仍适用于开票/冲红。

**物流报关**：CN22/CN23 · DDP/DDU · USMCA COO · Duty Drawback · USPS/Royal Mail · EDI 850/856

**平台后台路径**：大量 Shopify/WooCommerce/BigCommerce 点击路径（`Settings > Returns`、`Analytics → Reports → Inventory`、`Channel Manager`）**完全不可移植**

**Email/lifecycle 全半区**：国内 email 近乎失效——节奏纪律须**改嫁到短信/旺旺/订阅/粉丝群**，且每个基准都要重新推导

### 9.3 危险失准（必须重标，不能删）

| 原规则 | 国内重标 |
|---|---|
| 搜索量 ≥5,000/月 | 换生意参谋搜索人气/支付买家数，按类目分层 |
| 每卖家月销量 100–300 | 换类目基准（部分 9.9 包邮类目需 10 万+ 单） |
| 售价 ≥$20 | **换毛利率门槛（≥30%）比绝对价更稳** |
| 广告成本 <30% | 换直通车/万相台 ROI 或 ACOS |
| Top10 平均评论 <500 | 换「累计评价/月销比」或「TOP 店铺集中度」 |
| MOQ <500 / 资本 <$5K | 换人民币档位 |
| 广告数 <20/100+ | 换抖音/小红书投放数或商品数竞争度 |
| 退货率 danger >12% | ⚠️ **国内服饰 30–50%**，且**仅退款**在这 12 个文件里毫无对应物，可能是最大利润漏洞 |
| 退款滞后 7–14 天 | 国内 7 天无理由 → 滞后更短，准备金比例与时滞都要改 |
| Electronics 扣 15 分 / veto | 国内 3C 配件（手机壳等）风险结构完全不同 |
| TikTok 学习期「7 天内 50 转化」 | 千川阈值不同，**参数化不要硬编码** |

### 9.4 中国特有、语料完全缺失的（须自建）

1. **补单/刷单**污染订单与排名数据——outlier 标记与平滑**机制**存在，但没有中国触发条件
2. **价保 / 大促最低价承诺 / 价格力 / 百亿补贴** —— ±20% 每周期 + 1–2% 迟滞**不足够**，需要平台政策守则层
3. **仅退款** 三分支（退货退款/仅退款/换货）+ 运费险成本
4. **直播**（场观/GPM/退货率按场次、达人带货 vs 自播的毛利拆分含**佣金+坑位费**）——整个指标家族缺失
5. **复购窗口按类目重推**（美妆 60–90 天、食品 30 天、家电 2 年+）
6. **无固定投诉/工单分类树**，也没有「样本不足时拒绝下结论」的门限——两处都需自建

---

## 10. 落地优先级

### P0（低成本，立刻见效）

| # | 动作 | 依据 |
|---|---|---|
| 1 | **引入证据四分级 + 五条禁止推断**，作为全部分析类技能共享的 reference | §2 M1 |
| 2 | **引入 evals 目录范式**：先只做 `evals/evals.json` + 断言，跑**人工** baseline，验证范式可维护性 | §8.2 |
| 3 | **修 §5.9 的 6 个 bug 与 §6.5 的 4 个矛盾**（若要移植对应技能） | §5.9 / §6.5 |
| 4 | **接入 `ALLOWED_PROPERTIES` 硬约束为落盘前置校验** | §8.1 |

### P1（中等工作量，高收益）

| # | 动作 | 依据 |
|---|---|---|
| 5 | **移植 grader 契约**（作为独立 subagent 指令）+ benchmark 字段协议 | §8.2 |
| 6 | **为 3–5 个高频技能各写 20 条触发查询**（正负各半、负例必须近失），跑一次 description 优化，实测提升幅度 | §8.3 |
| 7 | **把 Composite Slot Model + 富化强制令**做成生图技能的核心结构 | §4.1 |
| 8 | **把 12 类中文字体语气 + 字形完整性条款 + 双级文字下限**落进生图技能 | §4.4 |
| 9 | **把反幻觉契约（ad-budget）横切到每个数据绑定技能** | §6.8 |

### P2（运营化）

| # | 动作 | 依据 |
|---|---|---|
| 10 | **`.skill-stats.json` 使用统计接入市场页排序**（只提醒，不自动淘汰） | 已有 skill-stats.ts，未接线到 UI |
| 11 | **引入 SKILL.patch.md**，把 FIX-LOG #45–#65 这类现场修正从主文档迁出 | §1 表格 |
| 12 | **6 维 VOC + 三维阈值**做成评价洞察技能 | §7.1 |
| 13 | **三个 ACoS 分离 + 竞价规则 + 再分配门**做成投放核心 | §6.1–6.3 |

### P3（补齐能力面）

| # | 动作 |
|---|---|
| 14 | **skill-vetter 清单**（安装前必跑）+ 第三方技能 `--dry-run` 校验与确认闸门 |
| 15 | **打包/分发步骤**（含 `evals/` 排除规则） |
| 16 | **直播指标家族**（场观/GPM/佣金+坑位费）—— 语料完全缺失，须从零写 |
| 17 | **投诉/工单封闭分类树 + 最小样本量门限** —— 语料完全缺失 |

---

## 11. 不需要抄的部分

| Accio 做法 | 为什么不建议抄 |
|---|---|
| 自动淘汰人工技能 | 本插件技能是人工精编的连接器，误删代价高；只做统计 + 提醒 |
| 全自动 SkillHarvest 直接落盘 | 需先有审核流程 + `created_by` 溯源 |
| 未注明来源的基准数字表 | 评审明确结论：这些是**无来源、无日期的民间传说**（2.5% CR、50–65% GM、3:1 LTV:CAC） |
| SkillQuality 里对中文标题的英文正则 | 已双语化修正，保持现状 |
| 美国税务 Nexus / 支付拒付 / Email 渠道数字 | 国内无对应链路或已失效 |
| 平台后台点击路径 | 完全不可移植 |
| 5 个国内平台缺失的数字规格 | **不要凭记忆补**——保持「verify officially」的诚实 |

---

## 附：分析产物位置

| 路径 | 说明 |
|---|---|
| `_accio_probe/skills/` | **130 个 Accio 官方技能的完整解包**（可离线检索，1204 文件） |
| `_accio_probe/zips/` | 130 个原始 zip |
| `_accio_probe/asar_list.cjs` | 自写 ASAR 解析器（`node asar_list.cjs <asar> [regex]`） |
| `_accio_probe/fetch.cjs` / `fetch_all.cjs` | Node fetch 下载器（绕过 PowerShell/curl 的 TLS 失败） |
| `_accio_probe/asar_files.txt` | app.asar 全量文件清单（1578 条） |

**工具备注**：本机 `Invoke-WebRequest` 与 `curl.exe` 对 `skill.accio.com` 均因证书凭据失败（`SEC_E_NO_CREDENTIALS`），**必须用 Node 全局 `fetch`**。ASAR 解析脚本须以 `.cjs` 扩展名运行（工作区 `package.json` 有 `"type": "module"`）。
